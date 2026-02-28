/**
 * JuriTask — firebase.js
 * Inicialización de Firebase, autenticación y sincronización con Firestore.
 * Debe cargarse DESPUÉS de storage.js y tramites.js, y ANTES de config.js.
 */

// ─── CONFIGURACIÓN ────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyBQ3T-6vaF-C74gcikCpDP3HXNbq_rYrYg",
  authDomain:        "juritask-5df51.firebaseapp.com",
  projectId:         "juritask-5df51",
  storageBucket:     "juritask-5df51.firebasestorage.app",
  messagingSenderId: "373351064304",
  appId:             "1:373351064304:web:2b99fc567606ee33089835"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db   = firebase.firestore();

// ─── OBJETO AUTH (usado por ui.js / filters.js) ───────────────
const AUTH = {
  userProfile: null,

  loginGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    return auth.signInWithPopup(provider);
  },

  loginEmail(email, password) {
    return auth.signInWithEmailAndPassword(email, password);
  },

  registerEmail(email, password) {
    return auth.createUserWithEmailAndPassword(email, password);
  },

  logout() {
    return auth.signOut();
  },

  resetPassword(email) {
    return auth.sendPasswordResetEmail(email);
  },

  updateDisplayName(name) {
    return auth.currentUser?.updateProfile({ displayName: name });
  },

  updatePassword(newPassword) {
    return auth.currentUser?.updatePassword(newPassword);
  },

  reauthenticate(currentPassword) {
    const user       = auth.currentUser;
    const credential = firebase.auth.EmailAuthProvider.credential(user.email, currentPassword);
    return user.reauthenticateWithCredential(credential);
  },
};

// ─── RUTAS EN FIRESTORE ───────────────────────────────────────
// /users/{uid}/tramites/{tramiteId}
// /users/{uid}/meta/config
// /users/{uid}/meta/order

function userRef() {
  return db.collection('users').doc(AUTH.userProfile.uid);
}

// ─── CARGAR DATOS DESDE FIRESTORE ────────────────────────────
async function loadFromFirestore() {
  const uid = AUTH.userProfile?.uid;
  if (!uid) return;

  try {
    // Config
    const metaDoc = await userRef().collection('meta').doc('config').get();
    if (metaDoc.exists) {
      const saved = metaDoc.data();
      STATE.config = Object.assign(
        {
          ...DEFAULT_CONFIG,
          abogados: DEFAULT_CONFIG.abogados.map(a => ({ ...a })),
          modulos:  [...DEFAULT_CONFIG.modulos],
        },
        saved
      );
    }

    // Order
    const orderDoc = await userRef().collection('meta').doc('order').get();
    if (orderDoc.exists) STATE.order = orderDoc.data().order || [];

    // Trámites
    const snap = await userRef().collection('tramites').get();
    STATE.tramites = [];
    snap.forEach(doc => {
      const t = { id: doc.id, ...doc.data() };
      migrateTramite(t);
      STATE.tramites.push(t);
    });

    applyCssColors();
    applyTheme(STATE.config.theme || 'claro');
    if (typeof populateModuloSelects === 'function') populateModuloSelects();
    if (typeof updateAbogadoSelects  === 'function') updateAbogadoSelects();

  } catch (e) {
    console.error('Error cargando desde Firestore:', e);
    showToast('Error al cargar datos desde la nube.');
  }
}

// ─── GUARDAR TRÁMITE INDIVIDUAL ───────────────────────────────
function saveTramiteFS(tramite) {
  if (!AUTH.userProfile?.uid) return;
  const data = { ...tramite };
  delete data.id;
  userRef().collection('tramites').doc(tramite.id).set(data)
    .catch(e => console.error('Error guardando trámite:', e));
}

// ─── ELIMINAR TRÁMITE ─────────────────────────────────────────
function deleteTramiteFS(id) {
  if (!AUTH.userProfile?.uid) return;
  userRef().collection('tramites').doc(id).delete()
    .catch(e => console.error('Error eliminando trámite:', e));
}

// ─── GUARDAR CONFIG + ORDER (con debounce 800ms) ──────────────
let _fsConfigTimer = null;
function saveConfigDebounced() {
  clearTimeout(_fsConfigTimer);
  _fsConfigTimer = setTimeout(() => {
    if (!AUTH.userProfile?.uid) return;
    userRef().collection('meta').doc('config').set(STATE.config)
      .catch(e => console.error('Error guardando config:', e));
    userRef().collection('meta').doc('order').set({ order: STATE.order })
      .catch(e => console.error('Error guardando order:', e));
    STATE.tramites.forEach(t => saveTramiteFS(t));
  }, 800);
}

// ─── ESCUCHAR CAMBIOS DE SESIÓN ───────────────────────────────
auth.onAuthStateChanged(async user => {
  const appEl    = document.getElementById('appContainer');
  const authEl   = document.getElementById('authScreen');
  const loadingEl = document.getElementById('authLoadingOverlay');

  if (user) {
    AUTH.userProfile = {
      uid:         user.uid,
      displayName: user.displayName || '',
      email:       user.email       || '',
      photoURL:    user.photoURL    || null,
      role:        'user',
    };

    // Verificar si es admin en Firestore
    try {
      const uDoc = await db.collection('users').doc(user.uid).get();
      if (uDoc.exists && uDoc.data().role === 'admin') {
        AUTH.userProfile.role = 'admin';
      }
    } catch (_) {}

    // Cargar datos y mostrar app
    await loadFromFirestore();
    if (authEl) authEl.style.display  = 'none';
    if (loadingEl) loadingEl.style.display = 'none';
    if (appEl)  appEl.style.display   = '';

    if (typeof renderAll            === 'function') renderAll();
    if (typeof syncConfigAccountUI  === 'function') syncConfigAccountUI();
    if (typeof purgeExpiredFinished === 'function') purgeExpiredFinished();
    if (typeof startAutoBackup      === 'function') startAutoBackup();

  } else {
    AUTH.userProfile = null;
    if (appEl)  appEl.style.display  = 'none';
    if (loadingEl) loadingEl.style.display = 'none';
    if (authEl) authEl.style.display = '';
  }
});
