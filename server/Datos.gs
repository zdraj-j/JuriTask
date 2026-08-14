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
 * ## Por qué aquí nunca se busca por nombre
 *
 * El scope declarado es `drive.file`, que da acceso **solo a lo que el propio
 * script crea**. Buscar por nombre o listar una carpeta —`getFoldersByName`,
 * `getFilesByName`, `getFiles` sobre una carpeta— es un barrido del Drive
 * entero y Google lo rechaza con *"Specified permissions are not
 * sufficient"*, aunque el fichero buscado sea nuestro.
 *
 * `tools/build.js` corta el build si vuelven a aparecer.
 *
 * Por eso todo va **por id**, y los ids viven en Script Properties:
 *
 * | Propiedad | Qué guarda |
 * |---|---|
 * | `CARPETA_ID` | la carpeta contenedora |
 * | `DATOS_ID`   | el JSON de estado |
 * | `BACKUPS`    | el índice de backups (JSON), porque no se puede listar la carpeta |
 *
 * La alternativa era pedir el scope `drive` completo. Se descartó: es un scope
 * *restringido* —otra ronda de aprobación del administrador de Workspace— y
 * entregaría el Drive entero a cambio de nada.
 */

const JT_CARPETA        = 'JuriTask';
const JT_ARCHIVO        = 'juritask-datos.json';
const JT_PREFIJO_BACKUP = 'juritask-backup-';
const JT_BACKUP_DIAS    = 30;          // retención
const JT_LOCK_MS        = 30000;

function _jtProps() {
  return PropertiesService.getScriptProperties();
}

/** Carpeta contenedora; se crea la primera vez y su id queda cacheado. */
function _jtCarpeta() {
  const props = _jtProps();
  const id = props.getProperty('CARPETA_ID');
  if (id) {
    try {
      const c = DriveApp.getFolderById(id);
      if (!c.isTrashed()) return c;
    } catch (e) { /* borrada o inaccesible: recrear */ }
  }
  const carpeta = DriveApp.createFolder(JT_CARPETA);
  props.setProperty('CARPETA_ID', carpeta.getId());
  return carpeta;
}

/** Fichero de datos; `null` si aún no existe (primer arranque). */
function _jtArchivo() {
  const props = _jtProps();
  const id = props.getProperty('DATOS_ID');
  if (!id) return null;
  try {
    const f = DriveApp.getFileById(id);
    if (f.isTrashed()) { props.deleteProperty('DATOS_ID'); return null; }
    return f;
  } catch (e) {
    props.deleteProperty('DATOS_ID');   // borrado de verdad: se recreará al guardar
    return null;
  }
}

// ============================================================
// LECTURA / ESCRITURA
// ============================================================

/**
 * Devuelve el estado como cadena JSON, o '' si todavía no hay nada guardado
 * (primer arranque: el cliente se queda con lo que tenga en local).
 */
function getEstado() {
  const f = _jtArchivo();
  if (!f) return '';
  return f.getBlob().getDataAsString('UTF-8');
}

/**
 * Guarda el estado. `json` es la cadena completa.
 *
 * El lock importa: el trigger diario de borradores (Fase 5) también escribe, y
 * sin él una corrida a las 6:00 podría pisar lo que estés editando.
 */
function guardarEstado(json) {
  if (typeof json !== 'string' || !json) throw new Error('guardarEstado espera una cadena JSON');
  JSON.parse(json);   // validar antes de escribir: mejor fallar que corromper

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(JT_LOCK_MS)) throw new Error('No se pudo tomar el lock de escritura');
  try {
    const f = _jtArchivo();
    if (f) {
      f.setContent(json);
    } else {
      const nuevo = _jtCarpeta().createFile(JT_ARCHIVO, json, 'application/json');
      _jtProps().setProperty('DATOS_ID', nuevo.getId());
    }
    _jtProps().setProperty('ULTIMO_GUARDADO', new Date().toISOString());
    return { ok: true, guardadoEn: new Date().toISOString(), bytes: json.length };
  } finally {
    lock.releaseLock();
  }
}

/** Datos para el panel: cuándo se guardó por última vez y cuánto ocupa. */
function estadoDelAlmacen() {
  const f = _jtArchivo();
  return {
    existe:        !!f,
    bytes:         f ? f.getSize() : 0,
    modificado:    f ? f.getLastUpdated().toISOString() : '',
    ultimoGuardado: _jtProps().getProperty('ULTIMO_GUARDADO') || '',
    carpetaUrl:    _jtCarpeta().getUrl(),
  };
}

// ============================================================
// BACKUPS
// ============================================================
// Copias fechadas del JSON dentro de la misma carpeta. Sustituyen a los
// backups que vivían en Firestore.
//
// El índice va en Script Properties porque con `drive.file` no se puede
// listar la carpeta (ver la cabecera). Cabe de sobra: 30 entradas de ~120
// bytes contra los 9 KB que admite una propiedad.

function _jtIndiceBackups() {
  try { return JSON.parse(_jtProps().getProperty('BACKUPS') || '[]'); } catch (e) { return []; }
}

function _jtGuardarIndice(lista) {
  _jtProps().setProperty('BACKUPS', JSON.stringify(lista));
}

function crearBackup() {
  const f = _jtArchivo();
  if (!f) throw new Error('Todavía no hay datos que respaldar');
  const sello = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HH-mm');
  const contenido = f.getBlob().getDataAsString('UTF-8');
  const copia = _jtCarpeta().createFile(
    `${JT_PREFIJO_BACKUP}${sello}.json`,
    contenido,
    'application/json'
  );
  const entrada = {
    id:       copia.getId(),
    nombre:   copia.getName(),
    bytes:    contenido.length,
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
  const vivos = _jtIndiceBackups().filter(function (b) {
    try { return !DriveApp.getFileById(b.id).isTrashed(); } catch (e) { return false; }
  });
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
  return DriveApp.getFileById(id).getBlob().getDataAsString('UTF-8');
}

function borrarBackup(id) {
  _jtExigirBackup(id);
  DriveApp.getFileById(id).setTrashed(true);
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
