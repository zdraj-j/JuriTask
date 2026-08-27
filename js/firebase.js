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

// ============================================================
// CARGA INICIAL
// ============================================================

/**
 * Trae todo lo del usuario y lo vuelca en STATE. Sustituye a lo que hubiera en
 * `localStorage`: Firestore es la fuente de verdad, la caché local solo cubre
 * el hueco entre que arranca la app y que responde la red.
 */
async function cargarDeFirestore() {
  const [snapT, docCfg, docOrd] = await Promise.all([
    _tramitesRef().get(),
    _userRef().collection('meta').doc('config').get(),
    _userRef().collection('meta').doc('order').get(),
  ]);

  const tramites = [];
  snapT.forEach(d => tramites.push(d.data()));

  // Primer arranque con datos solo en local: se sube lo que haya en vez de
  // borrarlo. Pasa al estrenar equipo o tras limpiar el proyecto.
  if (!tramites.length && STATE.tramites.length) {
    await subirTodoAFirestore();
    return;
  }

  STATE.tramites = tramites;
  STATE.tramites.forEach(migrateTramite);

  if (docOrd.exists) STATE.order = docOrd.data().order || [];
  if (docCfg.exists) {
    STATE.config = Object.assign(
      { ...DEFAULT_CONFIG,
        abogados: DEFAULT_CONFIG.abogados.map(a => ({ ...a })),
        modulos:  [...DEFAULT_CONFIG.modulos] },
      docCfg.data()
    );
  }

  _sellarEstado();
  _flushSave();          // deja la caché local al día
}

/** Sube el estado entero. Solo en el primer arranque y al importar un JSON. */
async function subirTodoAFirestore() {
  if (!AUTH.activa) return;
  // Firestore corta los lotes en 500 operaciones.
  const trozos = [];
  for (let i = 0; i < STATE.tramites.length; i += 400) trozos.push(STATE.tramites.slice(i, i + 400));

  for (const trozo of trozos) {
    const lote = db.batch();
    trozo.forEach(t => lote.set(_tramitesRef().doc(t.id), t));
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

async function _subirCambios() {
  if (!AUTH.activa || _syncEnCurso) return;
  _syncEnCurso = true;
  try {
    const lote = db.batch();
    let n = 0;

    const vivos = new Set();
    for (const t of STATE.tramites) {
      vivos.add(t.id);
      const json = JSON.stringify(t);
      if (_sello.get(t.id) === json) continue;
      lote.set(_tramitesRef().doc(t.id), t);
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

    if (n) await lote.commit();
  } catch (e) {
    console.warn('No se pudo sincronizar con Firestore:', e);
    // El sello no se revierte a propósito: el SDK reintenta la escritura por su
    // cuenta cuando vuelve la conexión, y los datos siguen en localStorage.
  } finally {
    _syncEnCurso = false;
  }
}

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
    showToast('No se pudo leer de la nube. Trabajando con la copia local.');
  }

  mostrarApp();
});
