/**
 * JuriTask — firebase.js
 * Inicialización de Firebase, autenticación y sincronización con Firestore.
 *
 * SEGURIDAD (doble capa):
 *   1. emailVerified  — Firebase verifica que el correo le pertenece al usuario.
 *   2. approved       — El admin activa la cuenta desde el panel de administración.
 *      Los usuarios que inician sesión con Google se consideran con correo
 *      verificado pero igualmente quedan pendientes de aprobación del admin
 *      (excepto el primer usuario que crea el sistema, que se convierte en admin
 *      y se aprueba automáticamente).
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

// ─── OBJETO AUTH ──────────────────────────────────────────────
const AUTH = {
  userProfile: null,

  loginGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    return auth.signInWithPopup(provider);
  },

  loginEmail(email, password) {
    return auth.signInWithEmailAndPassword(email, password);
  },

  registerEmail(email, password) {
    return auth.createUserWithEmailAndPassword(email, password);
  },

  logout()                { return auth.signOut(); },
  resetPassword(email)    { return auth.sendPasswordResetEmail(email); },
  updateDisplayName(name) { return auth.currentUser?.updateProfile({ displayName: name }); },
  updatePassword(pw)      { return auth.currentUser?.updatePassword(pw); },

  reauthenticate(currentPassword) {
    const user = auth.currentUser;
    const cred = firebase.auth.EmailAuthProvider.credential(user.email, currentPassword);
    return user.reauthenticateWithCredential(cred);
  },
};

// ─── REFERENCIA AL DOC DEL USUARIO ───────────────────────────
function userRef() {
  return db.collection('users').doc(AUTH.userProfile.uid);
}

// ─── ÍNDICE GLOBAL DE USUARIOS ────────────────────────────────
async function registerInUserIndex(uid) {
  try {
    await db.collection('meta').doc('userIndex').set(
      { uids: firebase.firestore.FieldValue.arrayUnion(uid) },
      { merge: true }
    );
  } catch(e) { console.warn('userIndex write failed:', e.code); }
}

async function removeFromUserIndex(uid) {
  try {
    await db.collection('meta').doc('userIndex').set(
      { uids: firebase.firestore.FieldValue.arrayRemove(uid) },
      { merge: true }
    );
  } catch(e) { console.warn('userIndex remove failed:', e.code); }
}

// ─── CREAR/COMPLETAR PERFIL EN FIRESTORE ─────────────────────
/**
 * Crea o actualiza el perfil del usuario en Firestore.
 *
 * Campos clave para el sistema de seguridad:
 *   - approved {boolean}  — false por defecto; el admin lo pone en true.
 *   - role     {string}   — 'admin' para el primer usuario, 'user' para el resto.
 *   - blocked  {boolean}  — true si el admin bloqueó la cuenta.
 *
 * El primer usuario que se registra en el sistema se convierte automáticamente
 * en admin y se marca como approved:true. Todos los demás arrancan con
 * approved:false y deben ser activados por el admin.
 */
async function ensureUserProfile(user) {
  const uRef = db.collection('users').doc(user.uid);
  const uDoc = await uRef.get();

  if (!uDoc.exists) {
    // ── Nuevo usuario: decidir rol ──────────────────────
    let role     = 'user';
    let approved = false;

    try {
      const idx  = await db.collection('meta').doc('userIndex').get();
      const uids = (idx.exists && idx.data().uids) ? idx.data().uids : [];
      if (uids.length === 0) {
        // Primer usuario del sistema → admin aprobado automáticamente
        role     = 'admin';
        approved = true;
      }
    } catch(_) {}

    await uRef.set({
      displayName: user.displayName || '',
      email:       user.email       || '',
      role,
      approved,
      blocked:     false,
      creadoEn:    new Date().toISOString(),
    });
    await registerInUserIndex(user.uid);
    return role;
  }

  // ── Ya existe: completar campos faltantes ───────────────
  const existing = uDoc.data();
  const patch = {};
  if (!existing.email       && user.email)       patch.email       = user.email;
  if (!existing.displayName && user.displayName) patch.displayName = user.displayName;
  if (!existing.creadoEn)                        patch.creadoEn    = new Date().toISOString();
  // Garantizar que el campo approved exista en registros previos a esta versión
  if (existing.approved === undefined) {
    // Los admin existentes se aprueban automáticamente;
    // los usuarios existentes también (migración no disruptiva).
    patch.approved = true;
  }
  if (existing.blocked === undefined) patch.blocked = false;
  if (Object.keys(patch).length) {
    await uRef.update(patch).catch(() => uRef.set(patch, { merge: true }));
  }

  await registerInUserIndex(user.uid);
  return existing.role || 'user';
}

// ─── PANEL DE APROBACIÓN (solo admin) ────────────────────────
/**
 * Devuelve todos los usuarios pendientes de aprobación.
 * Solo ejecutable con el rol admin (las reglas de Firestore lo refuerzan).
 */
async function getPendingUsers() {
  try {
    const idx = await db.collection('meta').doc('userIndex').get();
    if (!idx.exists) return [];
    const uids = idx.data().uids || [];
    const pending = [];
    for (const uid of uids) {
      try {
        const doc = await db.collection('users').doc(uid).get();
        if (doc.exists) {
          const d = doc.data();
          if (!d.approved && !d.blocked && d.role !== 'admin') {
            pending.push({ uid, ...d });
          }
        }
      } catch(_) {}
    }
    return pending;
  } catch(e) {
    console.error('Error obteniendo pendientes:', e);
    return [];
  }
}

/**
 * Aprueba una cuenta de usuario. El admin llama a esta función.
 * @param {string} uid
 */
async function approveUser(uid) {
  await db.collection('users').doc(uid).update({ approved: true });
}

/**
 * Rechaza/bloquea una cuenta de usuario.
 * @param {string} uid
 */
async function rejectUser(uid) {
  await db.collection('users').doc(uid).update({ approved: false, blocked: true });
}

// ─── CARGAR DATOS DESDE FIRESTORE ────────────────────────────
async function loadFromFirestore() {
  if (!AUTH.userProfile?.uid) return;

  try {
    const metaDoc = await userRef().collection('meta').doc('config').get();
    if (metaDoc.exists) {
      STATE.config = Object.assign(
        { ...DEFAULT_CONFIG, abogados: DEFAULT_CONFIG.abogados.map(a=>({...a})), modulos:[...DEFAULT_CONFIG.modulos] },
        metaDoc.data()
      );
    }

    const orderDoc = await userRef().collection('meta').doc('order').get();
    if (orderDoc.exists) STATE.order = orderDoc.data().order || [];

    const snap = await userRef().collection('tramites').get();
    STATE.tramites = [];
    snap.forEach(doc => {
      const t = { id: doc.id, ...doc.data() };
      migrateTramite(t);
      STATE.tramites.push(t);
      if (t._sharedFrom && t._sharedFromName) cacheUidName(t._sharedFrom, t._sharedFromName);
    });

    applyCssColors();
    applyTheme(STATE.config.theme || 'claro');
    if (typeof populateModuloSelects === 'function') populateModuloSelects();
    if (typeof updateAbogadoSelects  === 'function') updateAbogadoSelects();

  } catch(e) {
    console.error('Error cargando Firestore:', e);
    showToast('Error al cargar datos desde la nube.');
  }
}

// ─── GUARDAR TRÁMITE ──────────────────────────────────────────
function saveTramiteFS(tramite) {
  if (!AUTH.userProfile?.uid) return Promise.resolve();
  const data = { ...tramite }; delete data.id;

  const own = userRef().collection('tramites').doc(tramite.id).set(data)
    .catch(e => console.error('Error guardando trámite:', e));

  if (tramite._scope === 'team' && tramite.abogado) {
    const isTeamMember = typeof _teamMembers !== 'undefined' && _teamMembers.find(m => m.uid === tramite.abogado);
    const isSharedFrom = tramite._sharedFrom;
    if (isTeamMember || isSharedFrom) {
      const targetUid  = isSharedFrom ? tramite._sharedFrom : tramite.abogado;
      const sharedData = { ...data, _sharedFrom: AUTH.userProfile.uid, _sharedFromName: AUTH.userProfile.displayName || AUTH.userProfile.email };
      db.collection('users').doc(targetUid).collection('tramites').doc(tramite.id).set(sharedData)
        .catch(e => console.warn('Error sincronizando trámite compartido:', e.code));
    }
  }

  return own;
}

function deleteTramiteFS(id) {
  if (!AUTH.userProfile?.uid) return;
  const t = typeof getById === 'function' ? getById(id) : null;
  userRef().collection('tramites').doc(id).delete()
    .catch(e => console.error('Error eliminando trámite:', e));
  if (t && t._scope === 'team' && t.abogado) {
    const isTeamMember = typeof _teamMembers !== 'undefined' && _teamMembers.find(m => m.uid === t.abogado);
    if (isTeamMember) {
      db.collection('users').doc(t.abogado).collection('tramites').doc(id).delete()
        .catch(()=>{});
    }
  }
  if (t && t._sharedFrom) {
    db.collection('users').doc(t._sharedFrom).collection('tramites').doc(id).delete()
      .catch(()=>{});
  }
}

// ─── GUARDAR CONFIG + ORDER ───────────────────────────────────
let _fsConfigTimer = null;
function saveConfigDebounced() {
  clearTimeout(_fsConfigTimer);
  _fsConfigTimer = setTimeout(() => {
    if (!AUTH.userProfile?.uid) return;
    userRef().collection('meta').doc('config').set(STATE.config)
      .catch(e => console.error('Error config:', e));
    userRef().collection('meta').doc('order').set({ order: STATE.order })
      .catch(e => console.error('Error order:', e));
    STATE.tramites.forEach(t => saveTramiteFS(t));
  }, 800);
}

// ─── CAMBIOS DE SESIÓN ────────────────────────────────────────
auth.onAuthStateChanged(async user => {
  const appEl     = document.getElementById('appContainer');
  const authEl    = document.getElementById('authScreen');
  const loadingEl = document.getElementById('authLoadingOverlay');

  if (user) {
    // ── CAPA 1: Verificación de email ───────────────────
    // Los usuarios de Google siempre tienen emailVerified = true.
    // Los usuarios de email/contraseña deben verificar antes de continuar.
    if (!user.emailVerified) {
      // Puede que el usuario esté en la pantalla de "verifica tu correo".
      // No hacemos nada aquí; el sondeo de auth.js se encarga.
      if (loadingEl) loadingEl.style.display = 'none';
      return;
    }

    // ── CAPA 2 + carga de app ───────────────────────────
    // handleVerifiedUser está definido en auth.js y aplica
    // el chequeo de aprobación + blocked antes de abrir la app.
    if (typeof handleVerifiedUser === 'function') {
      await handleVerifiedUser(user);
    }

  } else {
    // Sesión cerrada
    AUTH.userProfile = null;
    if (typeof stopVerifyPolling === 'function') stopVerifyPolling();
    if (typeof hideVerifyEmailScreen === 'function') hideVerifyEmailScreen();
    if (appEl)     appEl.style.display     = 'none';
    if (loadingEl) loadingEl.style.display = 'none';
    if (authEl)    authEl.style.display    = '';
  }
});
