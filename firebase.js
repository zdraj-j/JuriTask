/**
 * JuriTask — firebase.js
 * Inicialización de Firebase, autenticación y sincronización con Firestore.
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
    // signInWithPopup funciona en GitHub Pages cuando el dominio está autorizado
    // en Firebase Console → Authentication → Authorized domains
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
// Como Firestore no permite listar /users/ desde el cliente,
// mantenemos un documento /meta/userIndex con array de UIDs.
// Esto permite al admin leer todos los perfiles individualmente.
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
async function ensureUserProfile(user) {
  const uRef = db.collection('users').doc(user.uid);
  const uDoc = await uRef.get();

  if (!uDoc.exists) {
    // Nuevo usuario: determinar rol
    let role     = 'user';
    let approved = false;
    try {
      const idx  = await db.collection('meta').doc('userIndex').get();
      const uids = (idx.exists && idx.data().uids) ? idx.data().uids : [];
      // Primer usuario del sistema → admin aprobado automáticamente
      if (uids.length === 0) { role = 'admin'; approved = true; }
    } catch(_) {}

    // IMPORTANTE: approved y blocked deben estar presentes explícitamente
    // para que las Firestore Rules de "create" los validen correctamente.
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

  // Ya existe: completar campos faltantes
  const existing = uDoc.data();
  const patch = {};
  if (!existing.email       && user.email)       patch.email       = user.email;
  if (!existing.displayName && user.displayName) patch.displayName = user.displayName;
  if (!existing.creadoEn)                        patch.creadoEn    = new Date().toISOString();
  // Migración: añadir approved/blocked si no existen (usuarios anteriores a esta versión)
  if (existing.approved === undefined) patch.approved = true;  // usuarios pre-existentes → aprobados
  if (existing.blocked  === undefined) patch.blocked  = false;
  if (Object.keys(patch).length) {
    await uRef.update(patch).catch(() => uRef.set(patch, { merge: true }));
  }

  await registerInUserIndex(user.uid);
  return existing.role || 'user';
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
      // Poblar caché de nombres desde trámites compartidos
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

  // Guardar en el propio Firestore
  const own = userRef().collection('tramites').doc(tramite.id).set(data)
    .catch(e => console.error('Error guardando trámite:', e));

  // Si es compartido con un miembro del equipo, sincronizar también a ellos
  if (tramite._scope === 'team' && tramite.abogado) {
    const isTeamMember = typeof _teamMembers !== 'undefined' && _teamMembers.find(m => m.uid === tramite.abogado);
    const isSharedFrom = tramite._sharedFrom; // El trámite viene del otro lado
    if (isTeamMember || isSharedFrom) {
      const targetUid = isSharedFrom ? tramite._sharedFrom : tramite.abogado;
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
  // Si era compartido, eliminar del colaborador también
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

// (sin redirect — se usa signInWithPopup)

// ─── CAMBIOS DE SESIÓN ────────────────────────────────────────
auth.onAuthStateChanged(async user => {
  const appEl     = document.getElementById('appContainer');
  const authEl    = document.getElementById('authScreen');
  const loadingEl = document.getElementById('authLoadingOverlay');

  if (user) {
    AUTH.userProfile = {
      uid:         user.uid,
      displayName: user.displayName || '',
      email:       user.email       || '',
      photoURL:    user.photoURL    || null,
      role:        'user',
      teamId:      null,
    };

    try {
      const uDoc = await db.collection('users').doc(user.uid).get();
      if (uDoc.exists) {
        const d = uDoc.data();
        // Verificar si el usuario está bloqueado
        if (d.blocked) {
          await auth.signOut();
          const msgEl = document.getElementById('authMessage');
          if (msgEl) { msgEl.className = 'auth-message auth-error'; msgEl.textContent = 'Tu cuenta ha sido bloqueada. Contacta al administrador.'; msgEl.style.display = ''; }
          if (loadingEl) loadingEl.style.display = 'none';
          return;
        }
        AUTH.userProfile.role        = d.role    || 'user';
        AUTH.userProfile.teamId      = d.teamId  || null;
        AUTH.userProfile.displayName = d.displayName || AUTH.userProfile.displayName;
      } else {
        AUTH.userProfile.role = await ensureUserProfile(user);
      }
    } catch(_) {}

    await loadFromFirestore();

    // Sincronizar botones de columna con el valor guardado en Firestore
    const savedCols = STATE.config.columns || 1;
    document.querySelectorAll('.col-btn').forEach(b =>
      b.classList.toggle('active', parseInt(b.dataset.cols) === savedCols));
    document.querySelectorAll('.mob-col-btn').forEach(b =>
      b.classList.toggle('active', parseInt(b.dataset.cols) === savedCols));

    if (authEl)    authEl.style.display    = 'none';
    if (loadingEl) loadingEl.style.display = 'none';
    if (appEl)     appEl.style.display     = 'flex';

    if (typeof renderAll            === 'function') renderAll();
    if (typeof syncConfigAccountUI  === 'function') syncConfigAccountUI();
    if (typeof switchView           === 'function') switchView('all'); // Siempre iniciar en Todos los trámites
    if (typeof purgeExpiredFinished === 'function') purgeExpiredFinished();
    if (typeof startAutoBackup      === 'function') startAutoBackup();
    if (typeof loadTeamMembers      === 'function') loadTeamMembers();

  } else {
    AUTH.userProfile = null;
    if (appEl)     appEl.style.display     = 'none';
    if (loadingEl) loadingEl.style.display = 'none';
    if (authEl)    authEl.style.display    = '';
  }
});
