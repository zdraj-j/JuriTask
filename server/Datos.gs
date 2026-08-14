/**
 * JuriTask — Datos.gs
 * Persistencia en Drive: un único JSON con todo el estado, más backups.
 *
 * Sustituye a Firestore. El fichero vive en una carpeta "JuriTask" del Drive
 * del usuario que despliega, y su id se cachea en Script Properties para no
 * buscarlo en cada llamada.
 *
 * El cliente habla con esto por `google.script.run` (ver js/backend.js). Los
 * estados viajan como **cadena JSON**, no como objeto: evita sorpresas de
 * serialización y deja el control del formato en un solo sitio.
 *
 * ## Por qué aquí no se usa DriveApp
 *
 * El scope declarado es `drive.file`, que da acceso **solo a lo que el propio
 * script crea** — el mínimo para una app que se fabrica su propia carpeta.
 * `DriveApp` no lo entiende: es un servicio de grano grueso y casi todos sus
 * métodos exigen el scope `drive` entero. Buscar por nombre falla con
 * *"Required permissions: drive.readonly || drive"*, y hasta `createFolder`
 * falla con *"Required permissions: drive"*. No hay forma de crear nada con
 * `drive.file` a través de ese servicio.
 *
 * La API REST de Drive sí lo respeta, así que se llama directamente con
 * `UrlFetchApp` — el mismo patrón que `Correo.gs` usa con Gmail. A cambio:
 *
 *  - **Nada se busca por nombre.** `drive.file` tampoco permite consultar el
 *    Drive, así que todo va por id y los ids viven en Script Properties.
 *
 * | Propiedad | Qué guarda |
 * |---|---|
 * | `CARPETA_ID` | la carpeta contenedora |
 * | `DATOS_ID`   | el JSON de estado |
 * | `BACKUPS`    | el índice de backups (JSON), porque no se puede listar la carpeta |
 *
 * La alternativa era pedir el scope `drive` completo y seguir con `DriveApp`.
 * Se descartó: es un scope *restringido* —otra ronda de aprobación del
 * administrador de Workspace— y entregaría el Drive entero de una cuenta
 * corporativa a cambio de ahorrar este fichero.
 *
 * `tools/build.js` corta el build si vuelve a aparecer `DriveApp` aquí.
 */

const JT_CARPETA        = 'JuriTask';
const JT_ARCHIVO        = 'juritask-datos.json';
const JT_PREFIJO_BACKUP = 'juritask-backup-';
const JT_BACKUP_DIAS    = 30;          // retención
const JT_LOCK_MS        = 30000;

const JT_DRIVE     = 'https://www.googleapis.com/drive/v3/files';
const JT_DRIVE_SUB = 'https://www.googleapis.com/upload/drive/v3/files';
const JT_MIME_CARPETA = 'application/vnd.google-apps.folder';

function _jtProps() {
  return PropertiesService.getScriptProperties();
}

// ============================================================
// DRIVE POR REST
// ============================================================

function _jtAuth() {
  return { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
}

/**
 * Respuesta de Drive. Devuelve el texto crudo; `null` si el fichero ya no
 * está (404/403 sobre un id concreto), que es un caso normal —alguien lo
 * borró a mano— y no un error que deba cortar la app.
 */
function _jtResp(res, opcional) {
  const codigo = res.getResponseCode();
  if (codigo >= 200 && codigo < 300) return res.getContentText();
  if (opcional && (codigo === 404 || codigo === 403)) return null;
  if (codigo === 401) throw new Error('drive-401: hay que volver a autorizar el script');
  if (codigo === 403) {
    throw new Error('Drive rechazó la operación. ¿Está habilitada la Drive API en el proyecto de Cloud?');
  }
  throw new Error('Error de Drive (' + codigo + '): ' + res.getContentText().slice(0, 300));
}

/** GET/POST/PATCH con cuerpo JSON. */
function _jtDrive(metodo, url, cuerpo, opcional) {
  const opts = { method: metodo, headers: _jtAuth(), muteHttpExceptions: true };
  if (cuerpo !== undefined) {
    opts.contentType = 'application/json; charset=UTF-8';
    opts.payload = JSON.stringify(cuerpo);
  }
  const texto = _jtResp(UrlFetchApp.fetch(url, opts), opcional);
  return texto === null ? null : JSON.parse(texto);
}

/** Metadatos de un fichero, o `null` si no existe o está en la papelera. */
function _jtMeta(id, campos) {
  const url = JT_DRIVE + '/' + id + '?fields=' + encodeURIComponent(campos || 'id,name,trashed');
  const m = _jtDrive('get', url, undefined, true);
  return (m && !m.trashed) ? m : null;
}

/**
 * Crea un fichero con contenido en una sola llamada (subida multipart): los
 * metadatos y el cuerpo van en la misma petición, así no queda un fichero
 * vacío si la segunda falla.
 */
function _jtCrearArchivo(nombre, contenido, padreId, mime) {
  const meta = { name: nombre, parents: [padreId] };
  const limite = 'jt' + Utilities.getUuid().replace(/-/g, '');
  const cuerpo =
    '--' + limite + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(meta) + '\r\n' +
    '--' + limite + '\r\nContent-Type: ' + (mime || 'application/json') + '; charset=UTF-8\r\n\r\n' +
    contenido + '\r\n' +
    '--' + limite + '--';

  const res = UrlFetchApp.fetch(JT_DRIVE_SUB + '?uploadType=multipart&fields=id,name,size', {
    method: 'post',
    contentType: 'multipart/related; boundary=' + limite,
    payload: Utilities.newBlob(cuerpo).getBytes(),   // bytes: el contenido lleva acentos
    headers: _jtAuth(),
    muteHttpExceptions: true,
  });
  return JSON.parse(_jtResp(res));
}

/** Reemplaza el contenido de un fichero existente. */
function _jtEscribirArchivo(id, contenido) {
  const res = UrlFetchApp.fetch(JT_DRIVE_SUB + '/' + id + '?uploadType=media&fields=id', {
    method: 'patch',
    contentType: 'application/json; charset=UTF-8',
    payload: Utilities.newBlob(contenido).getBytes(),
    headers: _jtAuth(),
    muteHttpExceptions: true,
  });
  return JSON.parse(_jtResp(res));
}

/** Contenido de un fichero como texto, o `null` si ya no está. */
function _jtLeerArchivo(id) {
  const res = UrlFetchApp.fetch(JT_DRIVE + '/' + id + '?alt=media', {
    headers: _jtAuth(),
    muteHttpExceptions: true,
  });
  return _jtResp(res, true);
}

function _jtPapelera(id) {
  _jtDrive('patch', JT_DRIVE + '/' + id, { trashed: true }, true);
}

// ============================================================
// LA CARPETA Y EL FICHERO
// ============================================================

/** Carpeta contenedora; se crea la primera vez y su id queda cacheado. */
function _jtCarpeta() {
  const props = _jtProps();
  const id = props.getProperty('CARPETA_ID');
  if (id && _jtMeta(id, 'id,trashed')) return id;

  const carpeta = _jtDrive('post', JT_DRIVE + '?fields=id',
    { name: JT_CARPETA, mimeType: JT_MIME_CARPETA });
  props.setProperty('CARPETA_ID', carpeta.id);
  return carpeta.id;
}

/** Id del fichero de datos, o `null` si aún no existe (primer arranque). */
function _jtArchivoId() {
  const props = _jtProps();
  const id = props.getProperty('DATOS_ID');
  if (!id) return null;
  if (_jtMeta(id, 'id,trashed')) return id;
  props.deleteProperty('DATOS_ID');   // borrado de verdad: se recreará al guardar
  return null;
}

// ============================================================
// LECTURA / ESCRITURA
// ============================================================

/**
 * Devuelve el estado como cadena JSON, o '' si todavía no hay nada guardado
 * (primer arranque: el cliente se queda con lo que tenga en local).
 */
function getEstado() {
  const id = _jtArchivoId();
  if (!id) return '';
  return _jtLeerArchivo(id) || '';
}

/**
 * Guarda el estado. `json` es la cadena completa.
 *
 * El lock importa: el trigger diario de borradores (Fase 5) también escribe el
 * estado, y sin él una corrida a las 6:00 podría pisar lo que estés editando.
 */
function guardarEstado(json) {
  if (typeof json !== 'string' || !json) throw new Error('guardarEstado espera una cadena JSON');
  JSON.parse(json);   // validar antes de escribir: mejor fallar que corromper

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(JT_LOCK_MS)) throw new Error('No se pudo tomar el lock de escritura');
  try {
    const id = _jtArchivoId();
    if (id) {
      _jtEscribirArchivo(id, json);
    } else {
      const nuevo = _jtCrearArchivo(JT_ARCHIVO, json, _jtCarpeta());
      _jtProps().setProperty('DATOS_ID', nuevo.id);
    }
    _jtProps().setProperty('ULTIMO_GUARDADO', new Date().toISOString());
    return { ok: true, guardadoEn: new Date().toISOString(), bytes: json.length };
  } finally {
    lock.releaseLock();
  }
}

/** Datos para el panel: cuándo se guardó por última vez y cuánto ocupa. */
function estadoDelAlmacen() {
  const id = _jtArchivoId();
  const m = id ? _jtMeta(id, 'id,size,modifiedTime') : null;
  return {
    existe:         !!m,
    bytes:          m ? Number(m.size || 0) : 0,
    modificado:     m ? m.modifiedTime : '',
    ultimoGuardado: _jtProps().getProperty('ULTIMO_GUARDADO') || '',
    carpetaUrl:     'https://drive.google.com/drive/folders/' + _jtCarpeta(),
  };
}

// ============================================================
// BACKUPS
// ============================================================
// Copias fechadas del JSON en la misma carpeta. Sustituyen a los backups que
// vivían en Firestore.
//
// El índice va en Script Properties porque con `drive.file` no se puede listar
// la carpeta (ver la cabecera). Cabe de sobra: 30 entradas de ~120 bytes
// contra los 9 KB que admite una propiedad.

function _jtIndiceBackups() {
  try { return JSON.parse(_jtProps().getProperty('BACKUPS') || '[]'); } catch (e) { return []; }
}

function _jtGuardarIndice(lista) {
  _jtProps().setProperty('BACKUPS', JSON.stringify(lista));
}

function crearBackup() {
  const id = _jtArchivoId();
  if (!id) throw new Error('Todavía no hay datos que respaldar');
  const sello = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HH-mm');

  // Copiar en Drive en vez de leer y reescribir: es una sola llamada y el
  // contenido no pasa por aquí.
  const copia = _jtDrive('post', JT_DRIVE + '/' + id + '/copy?fields=id,name,size', {
    name: JT_PREFIJO_BACKUP + sello + '.json',
    parents: [_jtCarpeta()],
  });

  const entrada = {
    id:       copia.id,
    nombre:   copia.name,
    bytes:    Number(copia.size || 0),
    creadoEn: new Date().toISOString(),
  };
  _jtGuardarIndice([entrada].concat(_jtIndiceBackups()));
  purgarBackups();
  return entrada;
}

/**
 * Devuelve el índice, más reciente primero, depurando de paso lo que ya no
 * está en Drive: el usuario puede borrar un backup a mano y el índice no se
 * entera de otra forma.
 */
function listarBackups() {
  const vivos = _jtIndiceBackups().filter(function (b) { return !!_jtMeta(b.id, 'id,trashed'); });
  vivos.sort(function (a, b) { return b.creadoEn.localeCompare(a.creadoEn); });
  _jtGuardarIndice(vivos);
  return vivos;
}

/** El id tiene que estar en el índice: es lo que impide leer cualquier fichero del Drive. */
function _jtExigirBackup(id) {
  const esta = _jtIndiceBackups().some(function (b) { return b.id === id; });
  if (!esta) throw new Error('Ese fichero no es un backup de JuriTask');
}

/** Devuelve el contenido de un backup para que el cliente decida qué hacer. */
function leerBackup(id) {
  _jtExigirBackup(id);
  const texto = _jtLeerArchivo(id);
  if (texto === null) throw new Error('Ese backup ya no está en Drive');
  return texto;
}

function borrarBackup(id) {
  _jtExigirBackup(id);
  _jtPapelera(id);
  _jtGuardarIndice(_jtIndiceBackups().filter(function (b) { return b.id !== id; }));
  return { ok: true };
}

/** Manda a la papelera los backups pasados de `JT_BACKUP_DIAS`. */
function purgarBackups() {
  const corte = new Date();
  corte.setDate(corte.getDate() - JT_BACKUP_DIAS);
  let n = 0;
  listarBackups().forEach(function (b) {
    if (new Date(b.creadoEn) < corte) { borrarBackup(b.id); n++; }
  });
  return n;
}
