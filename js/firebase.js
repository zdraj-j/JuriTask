/**
 * JuriTask — firebase.js
 * Sesión de Google y sincronización con Firestore.
 *
 * La app es de **un solo usuario**: no hay equipos, ni compartir, ni registro
 * por correo, ni aprobación de administrador. El login existe por dos razones,
 * y conviene tenerlas claras porque determinan lo que se puede quitar:
 *
 *  1. Firestore necesita saber de quién son los datos para poder protegerlos
 *     (ver firebase.rules).
 *  2. **De ahí sale el token de Google** que usan Gmail, el selector de Drive y
 *     la lectura de correos para Gemini ([google-auth.md](../docs/google-auth.md)).
 *     Sin sesión no hay token, y sin token no hay correo.
 *
 * Los datos viven en `users/{uid}`: un documento por trámite, más `meta/config`
 * y `meta/order`. `localStorage` sigue escribiéndose como caché inmediata, para
 * sobrevivir a una recarga rápida antes de que suba nada.
 */

const firebaseConfig = {
  apiKey:            "AIzaSyCTcuxDMUd1K9LSfdy0hjnBwsOaDM5A2S4",
  authDomain:        "juritask-5df51.firebaseapp.com",
  projectId:         "juritask-5df51",
  storageBucket:     "juritask-5df51.firebasestorage.app",
  messagingSenderId: "373351064304",
  appId:             "1:373351064304:web:2b99fc567606ee33089835"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db   = firebase.firestore();
db.settings({ ignoreUndefinedProperties: true });

// Persistencia offline: cachea en IndexedDB para consultar sin conexión. Debe
// llamarse antes de cualquier otra operación de Firestore.
db.enablePersistence({ synchronizeTabs: true }).catch(err => {
  // failed-precondition: varias pestañas sin synchronizeTabs.
  // unimplemented: navegador sin soporte (incógnito en algunos).
  console.warn('Persistencia offline de Firestore no disponible:', err && err.code);
});

// ============================================================
// SESIÓN
// ============================================================

const AUTH = {
  uid:   null,
  email: '',
  nombre: '',
  foto:  '',

  /**
   * Token de acceso de Google, para Gmail y el selector de Drive.
   * Solo llega en el momento del login: Firebase no lo guarda ni lo renueva,
   * así que `ensureGoogleToken()` vuelve a pedirlo cuando caduca.
   */
  googleAccessToken: null,

  get activa() { return !!AUTH.uid; },

  loginGoogle() {
    return auth.signInWithPopup(_proveedorGoogle()).then(_guardarToken);
  },

  /**
   * Reautentica solo para refrescar el token de Google. Se usa cuando Gmail
   * responde 401: la sesión de Firebase sigue viva, lo que caducó es el token.
   */
  refrescarTokenGoogle() {
    const u = auth.currentUser;
    if (!u) return Promise.resolve(null);
    return u.reauthenticateWithPopup(_proveedorGoogle()).then(_guardarToken);
  },

  logout() { return auth.signOut(); },
};

function _proveedorGoogle() {
  const p = new firebase.auth.GoogleAuthProvider();
  // Los scopes que necesitan los módulos de correo y adjuntos.
  p.addScope('https://www.googleapis.com/auth/drive.file');
  p.addScope('https://www.googleapis.com/auth/gmail.modify');
  p.setCustomParameters({ prompt: 'select_account' });
  return p;
}

function _guardarToken(result) {
  const token = result?.credential?.accessToken || null;
  if (token) AUTH.googleAccessToken = token;
  return token;
}

// ============================================================
// FIRESTORE — REFERENCIAS
// ============================================================

function _userRef()     { return db.collection('users').doc(AUTH.uid); }
function _tramitesRef() { return _userRef().collection('tramites'); }

/**
 * El documento de un trámite. **Nunca** `doc(t.id)` a pelo: con `t.id` vacío o
 * indefinido el SDK genera un id nuevo en cada llamada, y cada guardado
 * dejaría otra copia del mismo trámite en la nube (ver `js/storage.js`).
 */
function _docTramite(t) {
  if (!tieneIdTramite(t)) t.id = genId();
  return _tramitesRef().doc(t.id);
}

// ============================================================
// CARGA INICIAL
// ============================================================

/**
 * Trae todo lo del usuario y lo vuelca en STATE. Sustituye a lo que hubiera en
 * `localStorage`: Firestore es la fuente de verdad, la caché local solo cubre
 * el hueco entre que arranca la app y que responde la red.
 */
async function cargarDeFirestore() {
  // La caché local tal como quedó la última vez, **antes** de que la nube la
  // pise. Si trae cambios sin subir, es la única copia que existe.
  const localPrevio    = STATE.tramites;
  const orderPrevio    = STATE.order;
  const desdePendiente = cambiosPendientesDesde();

  const [snapT, docCfg, docOrd] = await Promise.all([
    _tramitesRef().get(),
    _userRef().collection('meta').doc('config').get(),
    _userRef().collection('meta').doc('order').get(),
  ]);

  // Una lectura servida por la caché de IndexedDB no es un error: `get()` cae
  // en ella cuando no alcanza el servidor. Sin este dato la app presentaría una
  // foto vieja como si fuera la de la nube.
  const desdeCache = snapT.metadata?.fromCache === true;

  const documentos = [];
  snapT.forEach(d => {
    const data = d.data();
    if (data && typeof data === 'object') documentos.push({ docId: d.id, data });
  });

  const { tramites, sobrantes, recolocados } = _reconciliarTramites(documentos);

  // Primer arranque con datos solo en local: se sube lo que haya en vez de
  // borrarlo. Pasa al estrenar equipo o tras limpiar el proyecto.
  if (!tramites.length && STATE.tramites.length) {
    await subirTodoAFirestore();
    limpiarCambiosPendientes();
    return;
  }

  // ── Quién manda ────────────────────────────────────────────
  // Por defecto la nube: es la fuente de verdad y viene de un servidor.
  //
  // Pero si quedaron cambios sin subir, la copia local va por delante (la app
  // escribe local y **después** sube), y aceptar la nube a ciegas borraría ese
  // trabajo —y con `_flushSave()` lo borraría también de la caché, que era el
  // último sitio donde estaba—. Ahí se fusiona conservando lo local.
  //
  // Lo mismo si la lectura salió de la caché de Firestore: esa foto no prueba
  // nada sobre el estado real de la nube.
  const localManda = !!desdePendiente || desdeCache;

  STATE.tramites = localManda ? _fusionarConLocal(localPrevio, tramites) : tramites;
  STATE.tramites.forEach(migrateTramite);

  // `order` y `config` siguen la misma regla: con cambios locales sin subir se
  // conserva lo local, porque la nube no los tiene todavía. La excepción es un
  // orden local vacío, que no es una preferencia: no hay nada que defender.
  if (docOrd.exists && (!localManda || !orderPrevio?.length)) {
    STATE.order = dedupeOrder(docOrd.data().order);
  }

  if (docCfg.exists && !localManda) {
    STATE.config = Object.assign(
      { ...DEFAULT_CONFIG,
        abogados: DEFAULT_CONFIG.abogados.map(a => ({ ...a })),
        modulos:  [...DEFAULT_CONFIG.modulos] },
      docCfg.data()
    );
  }

  _sellarEstado();
  // Los trámites que hay que reubicar no se sellan: así el comparador los ve
  // como cambiados y los escribe en el documento que les toca.
  recolocados.forEach(id => _sello.delete(id));
  _flushSave();          // deja la caché local al día

  if (localManda) {
    // El sello se vacía a propósito: obliga a la siguiente pasada a subir todo
    // lo local, que es justamente lo que no llegó a la nube.
    _sello.clear();
    sincronizarConFirestore();
    const cuando = desdePendiente ? ` (desde el ${desdePendiente.toLocaleDateString('es-CO')})` : '';
    showToast(desdeCache && !desdePendiente
      ? 'Sin conexión con la nube: trabajando con la copia local.'
      : `Se recuperaron cambios que no se habían subido${cuando}. Subiéndolos ahora.`);
  }

  if (sobrantes.length) {
    _borrarDocumentosSobrantes(sobrantes);
    showToast(`Se limpiaron ${sobrantes.length} copia(s) duplicada(s) de la nube.`);
  }
  if (recolocados.length) sincronizarConFirestore();
}

/**
 * Une la copia local con la de la nube conservando lo local ante el conflicto.
 *
 * No es un merge por campos ni hace falta: la app escribe local antes que la
 * nube, así que para un trámite que existe en las dos, la versión local es la
 * misma o es más nueva. Lo que sí aporta la nube son los trámites que la copia
 * local no conoce —creados en otro equipo, o de antes de limpiar este—, y esos
 * se añaden.
 *
 * El precio es explícito: un trámite borrado en otro equipo reaparece. Se
 * acepta, porque frente a perder una jornada de trabajo, un trámite de vuelta
 * se borra en un clic.
 */
function _fusionarConLocal(locales, remotos) {
  const fusionados = dedupeTramites(Array.isArray(locales) ? [...locales] : []);
  const vistos     = new Set(fusionados.map(t => t.id));
  const vistosNum  = new Set(fusionados.map(t => String(t.numero ?? '')).filter(Boolean));

  for (const r of remotos) {
    if (!r || typeof r !== 'object') continue;
    if (tieneIdTramite(r) && vistos.has(r.id)) continue;
    const num = String(r.numero ?? '');
    if (num && vistosNum.has(num)) continue;   // el mismo trámite por número
    fusionados.push(r);
    if (tieneIdTramite(r)) vistos.add(r.id);
    if (num) vistosNum.add(num);
  }
  return fusionados;
}

/**
 * Un trámite, un documento: `users/{uid}/tramites/{id}`. Si la nube trae varios
 * documentos del mismo trámite, la lista sale con el trámite repetido —el fallo
 * que aparecía al abrir la app por la mañana—.
 *
 * Aquí se decide cuál es el bueno y qué documentos sobran:
 *
 * - Gana el documento **canónico**, el que se llama como el trámite que
 *   contiene. Entre copias sueltas gana la más completa, que es la más
 *   reciente (ver `pesoTramite`).
 * - Un documento **sin `id`** adopta el del propio documento, que sí es único,
 *   y se marca para reescribirlo con el campo puesto.
 * - Un documento cuyo `id` **no coincide** con su nombre se reescribe en el
 *   suyo y el viejo se borra.
 *
 * Devuelve los trámites que se quedan, los documentos a borrar y los ids que
 * hay que volver a subir.
 */
function _reconciliarTramites(documentos) {
  // Ante una copia siempre gana el original: los canónicos se miran primero, y
  // entre los sueltos manda el que más contenido acumula.
  const ordenados = [...documentos].sort((a, b) => {
    const ca = a.data.id === a.docId ? 1 : 0;
    const cb = b.data.id === b.docId ? 1 : 0;
    if (ca !== cb) return cb - ca;
    if (ca) return 0;                                   // orden de llegada
    return pesoTramite(b.data) - pesoTramite(a.data);
  });

  const tramites    = [];
  const sobrantes   = [];
  const recolocados = [];
  const vistosId    = new Set();
  const vistosNum   = new Set();

  for (const { docId, data } of ordenados) {
    const id  = tieneIdTramite(data) ? data.id : '';
    const num = String(data.numero ?? '');

    if (id && vistosId.has(id))           { sobrantes.push(docId); continue; }
    if (!id && num && vistosNum.has(num)) { sobrantes.push(docId); continue; }

    if (!id) {
      data.id = docId;
      recolocados.push(data.id);        // le falta el campo `id`: hay que grabarlo
    } else if (id !== docId) {
      recolocados.push(id);
      sobrantes.push(docId);
    }

    vistosId.add(data.id);
    if (num) vistosNum.add(num);
    tramites.push(data);
  }

  // Un documento que sobra puede ser, a la vez, la casa que le toca a otro
  // trámite (cadenas de ids cruzados). Esos no se borran: se reescriben.
  return { tramites, recolocados, sobrantes: sobrantes.filter(docId => !vistosId.has(docId)) };
}

/**
 * Borra los documentos que sobran. Sin `await` desde la carga: es limpieza, no
 * puede retrasar el arranque de la app ni tumbarlo si falla.
 */
async function _borrarDocumentosSobrantes(docIds) {
  try {
    for (let i = 0; i < docIds.length; i += 400) {   // el tope del lote es 500
      const lote = db.batch();
      docIds.slice(i, i + 400).forEach(id => lote.delete(_tramitesRef().doc(id)));
      await lote.commit();
    }
    console.info(`Limpieza: ${docIds.length} documento(s) duplicado(s) borrados de Firestore.`);
  } catch (e) {
    console.warn('No se pudieron borrar los documentos duplicados:', e);
  }
}

/** Sube el estado entero. Solo en el primer arranque y al importar un JSON. */
async function subirTodoAFirestore() {
  if (!AUTH.activa) return;
  // Firestore corta los lotes en 500 operaciones.
  const trozos = [];
  for (let i = 0; i < STATE.tramites.length; i += 400) trozos.push(STATE.tramites.slice(i, i + 400));

  for (const trozo of trozos) {
    const lote = db.batch();
    trozo.forEach(t => lote.set(_docTramite(t), t));
    await lote.commit();
  }
  await _userRef().collection('meta').doc('order').set({ order: STATE.order || [] });
  await _userRef().collection('meta').doc('config').set(STATE.config);
  _sellarEstado();
}

// ============================================================
// SINCRONIZACIÓN
// ============================================================
// El enganche es `saveAll()` (storage.js) y no una llamada por cada sitio que
// modifica un trámite. Antes había 28 `saveTramiteFS(t)` repartidos por ui.js,
// tramites.js y selection.js: bastaba olvidar uno para que un cambio no
// subiera. Aquí se compara con lo último escrito y sube lo que cambió, así que
// cualquier código que toque STATE y llame a saveAll queda cubierto.

let _sello = new Map();     // id → JSON de lo último subido
let _selloCfg = '';
let _selloOrd = '';
let _syncTimer = null;
let _syncEnCurso = false;

function _sellarEstado() {
  _sello = new Map(STATE.tramites.map(t => [t.id, JSON.stringify(t)]));
  _selloCfg = JSON.stringify(STATE.config);
  _selloOrd = JSON.stringify(STATE.order);
}

/** Lo llama `saveAll()`. Agrupa ráfagas de cambios en una sola subida. */
function sincronizarConFirestore() {
  if (!AUTH.activa) return;
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(_subirCambios, 1200);
}

/**
 * Cuánto se espera a que Firestore confirme un lote antes de dar la subida por
 * no confirmada.
 *
 * `commit()` no resuelve hasta que el servidor responde, y sin red **no
 * rechaza: se queda pendiente para siempre**. Con el candado tomado y sin
 * `finally` que lo suelte, una sola subida sin red dejaba la sincronización
 * muerta el resto de la sesión: todo lo que el usuario escribiera después se
 * guardaba en local y no salía de ahí, en silencio. A la mañana siguiente la
 * carga traía la nube —sin ese trabajo— y lo pisaba. Ese era el camino por el
 * que se perdían días enteros.
 */
const SYNC_TIMEOUT_MS = 20000;

/** `commit()` con tope de espera. El SDK sigue reintentando por su cuenta. */
function _commitConTope(lote) {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error('sync-timeout')), SYNC_TIMEOUT_MS);
    lote.commit().then(
      v => { clearTimeout(id); resolve(v); },
      e => { clearTimeout(id); reject(e); }
    );
  });
}

async function _subirCambios() {
  if (!AUTH.activa || _syncEnCurso) return;
  _syncEnCurso = true;
  try {
    const lote = db.batch();
    let n = 0;

    const vivos = new Set();
    for (const t of STATE.tramites) {
      const ref = _docTramite(t);   // asigna id si falta: nunca un documento suelto
      vivos.add(t.id);
      const json = JSON.stringify(t);
      if (_sello.get(t.id) === json) continue;
      lote.set(ref, t);
      _sello.set(t.id, json);
      n++;
    }

    for (const id of [..._sello.keys()]) {
      if (vivos.has(id)) continue;
      lote.delete(_tramitesRef().doc(id));
      _sello.delete(id);
      n++;
    }

    const cfg = JSON.stringify(STATE.config);
    if (cfg !== _selloCfg) {
      lote.set(_userRef().collection('meta').doc('config'), STATE.config);
      _selloCfg = cfg;
      n++;
    }

    const ord = JSON.stringify(STATE.order);
    if (ord !== _selloOrd) {
      lote.set(_userRef().collection('meta').doc('order'), { order: STATE.order });
      _selloOrd = ord;
      n++;
    }

    if (n) await _commitConTope(lote);
    // Confirmado por el servidor: ahora, y solo ahora, la nube está al día y la
    // caché local deja de ser la única copia de nada.
    limpiarCambiosPendientes();
    _avisarPendientes();
  } catch (e) {
    console.warn('No se pudo sincronizar con Firestore:', e);
    // El sello no se revierte a propósito: el SDK reintenta la escritura por su
    // cuenta cuando vuelve la conexión, y los datos siguen en localStorage.
    // La marca de pendientes **sí** se queda: es lo que impide que la carga de
    // mañana pise este trabajo.
    _avisarPendientes();
  } finally {
    _syncEnCurso = false;
  }
}

// ============================================================
// AVISO DE CAMBIOS SIN SUBIR
// ============================================================
// Un fallo de subida que no se ve es un fallo que se descubre cuando ya no hay
// nada que hacer. El indicador vive en el pie de la barra lateral, junto a la
// sesión, y solo aparece cuando hay algo que contar.

function _avisarPendientes() {
  const el = document.getElementById('syncEstado');
  if (!el) return;
  const desde = cambiosPendientesDesde();
  if (!desde) { el.hidden = true; el.textContent = ''; el.removeAttribute('title'); return; }

  const dias = Math.floor((Date.now() - desde.getTime()) / 86400000);
  el.hidden = false;
  el.textContent = dias >= 1 ? `Sin guardar en la nube (${dias} d)` : 'Sin guardar en la nube';
  el.title = `Hay cambios desde el ${desde.toLocaleString('es-CO')} que la nube todavía no tiene. `
           + 'Se reintenta solo; si no cede, exporta el JSON desde Ajustes.';
}

/** Reintenta las subidas paradas en cuanto vuelve la conexión. */
window.addEventListener('online', () => {
  if (AUTH.activa && cambiosPendientesDesde()) sincronizarConFirestore();
});

// Un cierre de pestaña no espera al debounce.
window.addEventListener('beforeunload', () => {
  if (AUTH.activa) { clearTimeout(_syncTimer); _subirCambios(); }
});

// ============================================================
// ARRANQUE
// ============================================================

auth.onAuthStateChanged(async user => {
  if (!user) {
    AUTH.uid = null;
    mostrarPantallaAcceso();
    return;
  }

  AUTH.uid    = user.uid;
  AUTH.email  = user.email || '';
  AUTH.nombre = user.displayName || user.email || '';
  AUTH.foto   = user.photoURL || '';

  // La caché local primero: si la red tarda o falla, la app arranca igual, y
  // `cargarDeFirestore` necesita saber si había algo en local para decidir
  // entre bajar o subir.
  loadAll();

  try {
    await cargarDeFirestore();
  } catch (e) {
    console.error('Error cargando de Firestore:', e);
    // Se sigue con lo que haya en localStorage: mejor la app con datos de hace
    // un rato que una pantalla en blanco.
    //
    // El sello se deja vacío a propósito: la nube no se ha leído, así que no hay
    // nada contra lo que comparar y la próxima pasada subirá todo lo local. Sin
    // esto, una lectura fallida dejaba los cambios del día sin subir.
    _sello.clear();
    if (STATE.tramites.length) marcarCambiosPendientes();
    showToast('No se pudo leer de la nube. Trabajando con la copia local.');
  }

  mostrarApp();
  _avisarPendientes();

  // La copia del día, después de pintar: no debe retrasar el arranque ni
  // tumbarlo si falla.
  if (typeof crearCopiaDiaria === 'function') crearCopiaDiaria();
});
