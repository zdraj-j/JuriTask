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
 */

const JT_CARPETA        = 'JuriTask';
const JT_ARCHIVO        = 'juritask-datos.json';
const JT_PREFIJO_BACKUP = 'juritask-backup-';
const JT_BACKUP_DIAS    = 30;          // retención
const JT_LOCK_MS        = 30000;

function _jtProps() {
  return PropertiesService.getScriptProperties();
}

/** Carpeta contenedora; se crea la primera vez. */
function _jtCarpeta() {
  const props = _jtProps();
  const id = props.getProperty('CARPETA_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* borrada: recrear */ }
  }
  const it = DriveApp.getFoldersByName(JT_CARPETA);
  const carpeta = it.hasNext() ? it.next() : DriveApp.createFolder(JT_CARPETA);
  props.setProperty('CARPETA_ID', carpeta.getId());
  return carpeta;
}

/** Fichero de datos; `null` si aún no existe. */
function _jtArchivo() {
  const props = _jtProps();
  const id = props.getProperty('DATOS_ID');
  if (id) {
    try { return DriveApp.getFileById(id); } catch (e) { /* borrado: rebuscar */ }
  }
  const it = _jtCarpeta().getFilesByName(JT_ARCHIVO);
  if (!it.hasNext()) return null;
  const f = it.next();
  props.setProperty('DATOS_ID', f.getId());
  return f;
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

function crearBackup() {
  const f = _jtArchivo();
  if (!f) throw new Error('Todavía no hay datos que respaldar');
  const sello = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HH-mm');
  const copia = _jtCarpeta().createFile(
    `${JT_PREFIJO_BACKUP}${sello}.json`,
    f.getBlob().getDataAsString('UTF-8'),
    'application/json'
  );
  purgarBackups();
  return { id: copia.getId(), nombre: copia.getName(), creadoEn: new Date().toISOString() };
}

function listarBackups() {
  const out = [];
  const it = _jtCarpeta().getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf(JT_PREFIJO_BACKUP) !== 0) continue;
    out.push({
      id:       f.getId(),
      nombre:   f.getName(),
      bytes:    f.getSize(),
      creadoEn: f.getDateCreated().toISOString(),
    });
  }
  out.sort(function (a, b) { return b.creadoEn.localeCompare(a.creadoEn); });
  return out;
}

/** Devuelve el contenido de un backup para que el cliente decida qué hacer. */
function leerBackup(id) {
  const f = DriveApp.getFileById(id);
  if (f.getName().indexOf(JT_PREFIJO_BACKUP) !== 0) throw new Error('Ese fichero no es un backup de JuriTask');
  return f.getBlob().getDataAsString('UTF-8');
}

function borrarBackup(id) {
  const f = DriveApp.getFileById(id);
  if (f.getName().indexOf(JT_PREFIJO_BACKUP) !== 0) throw new Error('Ese fichero no es un backup de JuriTask');
  f.setTrashed(true);
  return { ok: true };
}

/** Manda a la papelera los backups pasados de `JT_BACKUP_DIAS`. */
function purgarBackups() {
  const corte = new Date();
  corte.setDate(corte.getDate() - JT_BACKUP_DIAS);
  let n = 0;
  listarBackups().forEach(function (b) {
    if (new Date(b.creadoEn) < corte) { DriveApp.getFileById(b.id).setTrashed(true); n++; }
  });
  return n;
}
