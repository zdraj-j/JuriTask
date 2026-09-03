/**
 * JuriTask — archivo.js
 * La base de datos: un JSON en el disco del usuario, vía File System Access API.
 *
 * ── El modelo ───────────────────────────────────────────────
 *
 * El usuario elige **una carpeta** y la app trabaja dentro:
 *
 *   <carpeta elegida>/
 *     juritask.json                  ← la base de datos
 *     copias/juritask-AAAA-MM-DD.json  ← una copia por día, 7 en retención
 *
 * Se pide una carpeta y no un archivo suelto por una razón concreta: un
 * `FileSystemFileHandle` **no da acceso a su directorio** —no existe
 * `getParent()`—, así que con un solo archivo la app no puede escribir las
 * copias al lado. Y quedarse sin copias es exactamente lo que ya costó días de
 * trabajo una vez. Ver [copias-seguridad.md](../docs/copias-seguridad.md).
 *
 * ── Dónde NO funciona ───────────────────────────────────────
 *
 * `showDirectoryPicker` existe **solo en Chrome, Edge y Opera de escritorio**.
 * No hay soporte en Firefox, en Safari ni en ningún navegador de móvil, y no es
 * algo que se pueda rellenar con un polyfill: no hay forma de escribir en el
 * disco del usuario sin esta API. En esos navegadores la app arranca en modo
 * lectura sobre la caché de `localStorage` y lo dice claramente.
 *
 * ── Las tres reglas que sostienen esto ──────────────────────
 *
 *  1. **Una escritura a la vez.** `createWritable()` reemplaza el contenido del
 *     archivo. Dos escrituras solapadas dejan un JSON a medias, y un JSON a
 *     medias es la base de datos entera perdida. `_cola` las serializa.
 *  2. **Nunca escribir un estado vacío sobre un archivo que tiene datos.**
 *     Un fallo de carga que deje STATE en blanco no puede convertirse en un
 *     archivo en blanco. `_esBorradoSospechoso()` lo corta.
 *  3. **Detectar cambios de fuera.** Si el archivo cambió desde la última vez
 *     que lo escribimos —otro equipo por Drive/Dropbox, o edición a mano—, se
 *     avisa en vez de pisarlo sin más.
 */

const ARCHIVO_NOMBRE   = 'juritask.json';
const ARCHIVO_VERSION  = 3;
const CARPETA_COPIAS   = 'copias';

// ============================================================
// SOPORTE DEL NAVEGADOR
// ============================================================

/** ¿Este navegador puede usar un archivo del disco como base de datos? */
function soportaArchivo() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

// ============================================================
// EL HANDLE, ENTRE SESIONES
// ============================================================
// Un `FileSystemDirectoryHandle` se puede guardar en IndexedDB y recuperar en
// la siguiente visita: es la única forma de no volver a pedir la carpeta cada
// vez. Lo que **no** sobrevive siempre es el permiso, que hay que volver a
// pedir con un gesto del usuario (ver `reconectarCarpeta`).

const IDB_NOMBRE = 'juritask-fs';
const IDB_STORE  = 'handles';
const IDB_CLAVE  = 'carpeta';

function _idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NOMBRE, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function _idbGuardar(handle) {
  try {
    const db = await _idb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(handle, IDB_CLAVE);
      tx.oncomplete = resolve;
      tx.onerror    = () => reject(tx.error);
    });
  } catch (e) { console.warn('No se pudo recordar la carpeta:', e); }
}

async function _idbLeer() {
  try {
    const db = await _idb();
    return await new Promise((resolve, reject) => {
      const tx  = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(IDB_CLAVE);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror   = () => reject(req.error);
    });
  } catch (e) { console.warn('No se pudo recuperar la carpeta:', e); return null; }
}

async function _idbOlvidar() {
  try {
    const db = await _idb();
    await new Promise(resolve => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(IDB_CLAVE);
      tx.oncomplete = resolve;
      tx.onerror    = resolve;
    });
  } catch (_) { /* nada que olvidar */ }
}

// ============================================================
// ESTADO DE LA CONEXIÓN
// ============================================================

const ARCHIVO = {
  carpeta: null,          // FileSystemDirectoryHandle
  fichero: null,          // FileSystemFileHandle de juritask.json
  nombreCarpeta: '',
  /** `lastModified` de la última lectura o escritura nuestra. */
  visto: 0,

  get conectado() { return !!ARCHIVO.fichero; },
};

// ============================================================
// CONECTAR
// ============================================================

/**
 * Pide la carpeta al usuario. **Necesita un gesto**: solo se puede llamar desde
 * el manejador de un clic.
 */
async function elegirCarpeta() {
  if (!soportaArchivo()) {
    showToast('Este navegador no puede abrir carpetas del equipo. Usa Chrome o Edge en el computador.');
    return false;
  }
  let dir;
  try {
    dir = await window.showDirectoryPicker({ id: 'juritask-datos', mode: 'readwrite', startIn: 'documents' });
  } catch (e) {
    if (e?.name === 'AbortError') return false;   // el usuario cerró el diálogo
    console.warn('No se pudo abrir la carpeta:', e);
    showToast('No se pudo abrir la carpeta.');
    return false;
  }
  if (!(await _asegurarPermiso(dir, true))) {
    showToast('Sin permiso de escritura sobre la carpeta.');
    return false;
  }
  await _fijarCarpeta(dir);
  await _idbGuardar(dir);
  return true;
}

/**
 * Reconecta con la carpeta de la sesión anterior.
 *
 * Devuelve `'listo'` si quedó conectada, `'permiso'` si la carpeta se recuerda
 * pero el navegador exige un gesto del usuario para volver a autorizarla, y
 * `'ninguna'` si no hay carpeta recordada.
 *
 * Sin `gesto: true` **no se pide permiso**: `requestPermission()` fuera de un
 * clic falla, y gastar ahí el intento dejaría al usuario sin forma de reconectar.
 */
async function reconectarCarpeta({ gesto = false } = {}) {
  if (!soportaArchivo()) return 'ninguna';
  const dir = await _idbLeer();
  if (!dir) return 'ninguna';

  if (!(await _asegurarPermiso(dir, gesto))) return 'permiso';

  try {
    await _fijarCarpeta(dir);
    return 'listo';
  } catch (e) {
    // La carpeta puede haberse borrado, movido o estar en un disco desconectado.
    console.warn('La carpeta recordada ya no sirve:', e);
    return 'permiso';
  }
}

async function _asegurarPermiso(dir, pedir) {
  const opciones = { mode: 'readwrite' };
  if ((await dir.queryPermission(opciones)) === 'granted') return true;
  if (!pedir) return false;
  return (await dir.requestPermission(opciones)) === 'granted';
}

async function _fijarCarpeta(dir) {
  ARCHIVO.carpeta       = dir;
  ARCHIVO.nombreCarpeta = dir.name || '';
  ARCHIVO.fichero       = await dir.getFileHandle(ARCHIVO_NOMBRE, { create: true });
}

/** Suelta la carpeta actual sin tocar su contenido. */
async function desconectarCarpeta() {
  ARCHIVO.carpeta = null;
  ARCHIVO.fichero = null;
  ARCHIVO.nombreCarpeta = '';
  ARCHIVO.visto = 0;
  await _idbOlvidar();
}

// ============================================================
// LEER
// ============================================================

/**
 * Lee `juritask.json`. Devuelve `null` si el archivo está recién creado (vacío),
 * que es distinto de que falle: un archivo vacío significa "primer arranque,
 * sube lo que tengas", y un fallo significa "no toques nada".
 */
async function leerArchivo() {
  if (!ARCHIVO.conectado) throw new Error('Sin carpeta conectada.');
  const file = await ARCHIVO.fichero.getFile();
  ARCHIVO.visto = file.lastModified;

  const texto = (await file.text()).trim();
  if (!texto) return null;

  const datos = JSON.parse(texto);
  if (!datos || typeof datos !== 'object') throw new Error('El archivo no tiene el formato esperado.');
  return datos;
}

/**
 * ¿Cambió el archivo por fuera desde la última vez que lo miramos?
 *
 * Pasa si la carpeta está en Drive/Dropbox y otro equipo escribió, o si alguien
 * editó el JSON a mano. Pisarlo sin avisar borraría ese trabajo.
 */
async function archivoCambiadoFuera() {
  if (!ARCHIVO.conectado || !ARCHIVO.visto) return false;
  try {
    const file = await ARCHIVO.fichero.getFile();
    return file.lastModified > ARCHIVO.visto;
  } catch (_) { return false; }
}

// ============================================================
// ESCRIBIR
// ============================================================

/** Lo que se guarda. El formato es el mismo que exporta e importa Ajustes. */
function _cuerpoArchivo() {
  return {
    version:   ARCHIVO_VERSION,
    guardadoEn: new Date().toISOString(),
    tramites:  STATE.tramites,
    order:     STATE.order || [],
    config:    STATE.config,
  };
}

/**
 * Corta el caso que convierte un fallo en una pérdida: escribir un estado vacío
 * encima de un archivo que sí tenía trámites.
 *
 * Un vaciado legítimo existe —"Borrar todos mis datos"— y por eso hay una
 * puerta explícita (`permitirVaciado`), no una excepción silenciosa.
 */
// De un solo uso: la autorización se consume en la siguiente escritura. Dejarla
// puesta desarmaría la defensa para el resto de la sesión.
let _vaciadoAutorizado = false;
function autorizarVaciado() { _vaciadoAutorizado = true; }

async function _esBorradoSospechoso() {
  if (STATE.tramites.length) return false;
  if (_vaciadoAutorizado) { _vaciadoAutorizado = false; return false; }
  try {
    const previo = await leerArchivo();
    return !!(previo?.tramites?.length);
  } catch (_) {
    // Si no se puede leer, se asume lo peor: no escribir encima.
    return true;
  }
}

// Una escritura a la vez, en orden. `_cola` es la promesa de la última en
// curso; cada nueva se encadena detrás.
let _cola = Promise.resolve();
let _timerArchivo = null;

/** Escribe ya, sin esperar al debounce. Devuelve `true` si el archivo quedó al día. */
function guardarArchivoAhora() {
  clearTimeout(_timerArchivo);
  _cola = _cola.then(_escribir, _escribir);
  return _cola;
}

/** Escritura con debounce de 600 ms: absorbe las ráfagas de tecleo. */
function guardarArchivo() {
  if (!ARCHIVO.conectado) return;
  clearTimeout(_timerArchivo);
  _timerArchivo = setTimeout(guardarArchivoAhora, 600);
}

async function _escribir() {
  if (!ARCHIVO.conectado) return false;
  try {
    if (await _esBorradoSospechoso()) {
      console.warn('Escritura cancelada: STATE está vacío y el archivo tiene trámites.');
      showToast('No se guardó: la app está vacía y el archivo tiene datos. Recarga antes de seguir.');
      return false;
    }

    if (await archivoCambiadoFuera()) {
      // No se pisa a ciegas, pero tampoco se descarta lo que el usuario acaba
      // de escribir: se deja una copia al lado y se avisa.
      await _copiaDeConflicto();
    }

    const w = await ARCHIVO.fichero.createWritable();
    await w.write(JSON.stringify(_cuerpoArchivo(), null, 2));
    await w.close();

    ARCHIVO.visto = (await ARCHIVO.fichero.getFile()).lastModified;
    limpiarCambiosPendientes();
    _avisarPendientes();
    return true;
  } catch (e) {
    console.warn('No se pudo escribir el archivo:', e);
    // La marca de pendientes se queda puesta: es lo que impide que la próxima
    // carga pise lo que no llegó al disco.
    _avisarPendientes();
    return false;
  }
}

/**
 * El archivo cambió por fuera y vamos a escribir encima. Antes se guarda lo que
 * había, con la hora en el nombre, para que nada se pierda sin remedio.
 */
async function _copiaDeConflicto() {
  try {
    const previo = await ARCHIVO.fichero.getFile();
    const texto  = await previo.text();
    if (!texto.trim()) return;
    const sello  = new Date().toISOString().replace(/[:.]/g, '-');
    const dir    = await ARCHIVO.carpeta.getDirectoryHandle(CARPETA_COPIAS, { create: true });
    const h      = await dir.getFileHandle(`conflicto-${sello}.json`, { create: true });
    const w      = await h.createWritable();
    await w.write(texto);
    await w.close();
    showToast(`El archivo había cambiado por fuera. Se guardó copias/conflicto-${sello}.json`);
  } catch (e) {
    console.warn('No se pudo guardar la copia de conflicto:', e);
  }
}

// ============================================================
// CARGA INICIAL
// ============================================================

/**
 * Vuelca el archivo en STATE. Es el equivalente de lo que hacía
 * `cargarDeFirestore()`, con la misma precaución: si la caché local trae
 * cambios que no llegaron al disco, **mandan los de la caché**.
 *
 * El razonamiento no cambia con el soporte: `saveAll()` escribe `localStorage`
 * primero y el archivo después, así que la caché nunca va por detrás.
 */
async function cargarDeArchivo() {
  const localPrevio = STATE.tramites;
  const pendiente   = cambiosPendientesDesde();

  const datos = await leerArchivo();

  // Archivo vacío o recién creado: la app estrena carpeta. Se vuelca lo que
  // haya en memoria en vez de borrarlo.
  if (!datos) {
    if (STATE.tramites.length) await guardarArchivoAhora();
    return;
  }

  const delArchivo = dedupeTramites(Array.isArray(datos.tramites) ? datos.tramites : []);

  const localManda = !!pendiente && localPrevio.length > 0;
  STATE.tramites = localManda ? _fusionarConLocal(localPrevio, delArchivo) : delArchivo;

  // Con cambios locales sin guardar, `order` y `config` también se conservan:
  // el archivo no los tiene todavía. La excepción es un orden local vacío, que
  // no es una preferencia que defender.
  if (Array.isArray(datos.order) && (!localManda || !STATE.order?.length)) {
    STATE.order = dedupeOrder(datos.order);
  }
  if (datos.config && !localManda) {
    STATE.config = Object.assign(
      { ...DEFAULT_CONFIG,
        abogados: DEFAULT_CONFIG.abogados.map(a => ({ ...a })),
        modulos:  [...DEFAULT_CONFIG.modulos] },
      datos.config
    );
  }

  STATE.tramites.forEach(migrateTramite);
  _flushSave();   // deja la caché local al día

  if (localManda) {
    showToast(`Se recuperaron cambios que no se habían guardado (desde el ${pendiente.toLocaleDateString('es-CO')}).`);
    await guardarArchivoAhora();
  }
}

/**
 * Une la copia local con la del archivo conservando lo local ante el conflicto.
 *
 * No es un merge por campos ni hace falta: la app escribe `localStorage` antes
 * que el archivo, así que para un trámite que está en los dos, la versión local
 * es la misma o es más nueva. Lo que sí aporta el archivo son los trámites que
 * la caché no conoce, y esos se añaden.
 *
 * El precio es explícito: un trámite borrado con la caché desincronizada puede
 * reaparecer. Frente a perder una jornada de trabajo, un trámite de vuelta se
 * borra en un clic.
 */
function _fusionarConLocal(locales, delArchivo) {
  const fusionados = dedupeTramites(Array.isArray(locales) ? [...locales] : []);
  const vistos     = new Set(fusionados.map(t => t.id));
  const vistosNum  = new Set(fusionados.map(t => String(t.numero ?? '')).filter(Boolean));

  for (const r of delArchivo) {
    if (!r || typeof r !== 'object') continue;
    if (tieneIdTramite(r) && vistos.has(r.id)) continue;
    const num = String(r.numero ?? '');
    if (num && vistosNum.has(num)) continue;
    fusionados.push(r);
    if (tieneIdTramite(r)) vistos.add(r.id);
    if (num) vistosNum.add(num);
  }
  return fusionados;
}

// ============================================================
// UI — Ajustes › Archivo de datos
// ============================================================

function renderArchivo() {
  const el = document.getElementById('archivoCarpeta');
  if (!el) return;
  if (ARCHIVO.conectado) {
    el.textContent = `${ARCHIVO.nombreCarpeta}/${ARCHIVO_NOMBRE}`;
    el.title = 'La base de datos de la app.';
  } else {
    el.textContent = soportaArchivo() ? 'Sin conectar' : 'No disponible en este navegador';
    el.title = soportaArchivo() ? '' : 'Necesita Chrome o Edge de escritorio.';
  }
  const guardar = document.getElementById('archivoGuardarBtn');
  if (guardar) guardar.disabled = !ARCHIVO.conectado;
}

// ============================================================
// AVISO DE CAMBIOS SIN GUARDAR
// ============================================================
// Vive en el pie de la barra lateral y solo aparece cuando hay algo que contar.
// Un fallo de guardado que no se ve es el que acaba costando una jornada.

function _avisarPendientes() {
  const el = document.getElementById('syncEstado');
  if (!el) return;

  if (!ARCHIVO.conectado) {
    el.hidden = false;
    el.textContent = soportaArchivo() ? 'Sin carpeta de datos' : 'Solo lectura en este navegador';
    el.title = soportaArchivo()
      ? 'Los cambios se quedan en este navegador. Conecta la carpeta en Ajustes › Archivo de datos.'
      : 'Este navegador no puede escribir en el disco. Abre la app en Chrome o Edge de escritorio.';
    return;
  }

  const desde = cambiosPendientesDesde();
  if (!desde) { el.hidden = true; el.textContent = ''; el.removeAttribute('title'); return; }

  const dias = Math.floor((Date.now() - desde.getTime()) / 86400000);
  el.hidden = false;
  el.textContent = dias >= 1 ? `Sin guardar en el archivo (${dias} d)` : 'Sin guardar en el archivo';
  el.title = `Hay cambios desde el ${desde.toLocaleString('es-CO')} que no están en ${ARCHIVO_NOMBRE}. `
           + 'Vuelve a conectar la carpeta desde Ajustes, o exporta el JSON.';
}

// El cierre de pestaña no espera al debounce. `_escribir` es asíncrona y
// `beforeunload` no la puede esperar, pero la escritura ya está encolada y
// `localStorage` —que sí es síncrono— conserva todo hasta la próxima carga.
window.addEventListener('beforeunload', () => {
  if (ARCHIVO.conectado && cambiosPendientesDesde()) guardarArchivoAhora();
});
