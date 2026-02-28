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
    // Verificar si ya existe un primer admin en el sistema
    let isFirstUser = false;
    try {
      const firstAdminDoc = await db.collection('meta').doc('firstAdminCreated').get();
      if (!firstAdminDoc.exists) {
        // Verificar también el userIndex para mayor seguridad
        const idx  = await db.collection('meta').doc('userIndex').get();
        const uids = (idx.exists && idx.data().uids) ? idx.data().uids : [];
        if (uids.length === 0) isFirstUser = true;
      }
    } catch(_) {}

    // Paso 1: crear perfil con los campos que las reglas permiten (role=user, approved=false)
    await uRef.set({
      displayName: user.displayName || '',
      email:       user.email       || '',
      role:        'user',
      approved:    false,
      blocked:     false,
      creadoEn:    new Date().toISOString(),
    });
    await registerInUserIndex(user.uid);

    if (isFirstUser) {
      // Paso 2: promover al primer usuario a admin.
      // Las reglas permiten este update cuando /meta/firstAdminCreated no existe.
      try {
        await uRef.update({ role: 'admin', approved: true });
        // Marcar que ya existe un primer admin (impide que otro usuario se auto-promueva)
        await db.collection('meta').doc('firstAdminCreated').set({
          uid:       user.uid,
          email:     user.email || '',
          creadoEn:  new Date().toISOString(),
        });
        return 'admin';
      } catch(e) {
        console.warn('Error auto-promoviendo primer admin:', e.code);
        // Si falla (ej: reglas estrictas en deploy inicial), intentar con set+merge
        await uRef.set({ role: 'admin', approved: true }, { merge: true }).catch(console.warn);
        return 'user'; // seguirá como user pendiente si todo falla
      }
    }

    return 'user'; // nuevo usuario normal, pendiente de aprobación
  }

  // Ya existe: completar campos faltantes
  const existing = uDoc.data();
  const patch = {};
  if (!existing.email       && user.email)       patch.email       = user.email;
  if (!existing.displayName && user.displayName) patch.displayName = user.displayName;
  if (!existing.creadoEn)                        patch.creadoEn    = new Date().toISOString();
  // Migración: añadir approved/blocked si no existen (usuarios anteriores a esta versión)
  if (existing.approved === undefined) patch.approved = true;
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

// ─── PANTALLA DE ESPERA (correo no verificado / cuenta pendiente) ──
function showPendingScreen(reason, user) {
  const authEl    = document.getElementById('authScreen');
  const pendingEl = document.getElementById('pendingScreen');

  if (!pendingEl) {
    // Si no existe el elemento, al menos mostrar la pantalla de login
    if (authEl) authEl.style.display = '';
    return;
  }

  // Ocultar app y login
  const appEl = document.getElementById('appContainer');
  if (appEl)  appEl.style.display  = 'none';
  if (authEl) authEl.style.display = 'none';

  // Configurar mensaje según razón
  const icon  = pendingEl.querySelector('#pendingIcon');
  const title = pendingEl.querySelector('#pendingTitle');
  const msg   = pendingEl.querySelector('#pendingMsg');
  const resendBtn = pendingEl.querySelector('#resendVerificationBtn');
  const logoutPendingBtn = pendingEl.querySelector('#logoutPendingBtn');

  if (reason === 'unverified') {
    if (icon)  icon.textContent  = '📧';
    if (title) title.textContent = 'Verifica tu correo electrónico';
    if (msg)   msg.textContent   = `Enviamos un enlace de verificación a ${user?.email || 'tu correo'}. Haz clic en el enlace y luego vuelve aquí para continuar.`;
    if (resendBtn) {
      resendBtn.style.display = '';
      resendBtn.onclick = async () => {
        try {
          await auth.currentUser?.sendEmailVerification();
          resendBtn.textContent = '✓ Enviado';
          setTimeout(() => { resendBtn.textContent = '↺ Reenviar correo'; }, 3000);
        } catch(e) { showToast('Error: ' + (e.message || e.code)); }
      };
    }
  } else if (reason === 'unapproved') {
    if (icon)  icon.textContent  = '⏳';
    if (title) title.textContent = 'Cuenta pendiente de aprobación';
    if (msg)   msg.textContent   = 'Tu correo ya fue verificado. Un administrador revisará tu solicitud y te dará acceso pronto.';
    if (resendBtn) resendBtn.style.display = 'none';
  } else if (reason === 'blocked') {
    if (icon)  icon.textContent  = '🚫';
    if (title) title.textContent = 'Cuenta bloqueada';
    if (msg)   msg.textContent   = 'Tu cuenta ha sido bloqueada. Contacta al administrador para más información.';
    if (resendBtn) resendBtn.style.display = 'none';
  }

  // Botón "Actualizar / recargar" para que el usuario vuelva a intentar después de verificar
  const reloadBtn = pendingEl.querySelector('#reloadStatusBtn');
  if (reloadBtn) {
    reloadBtn.onclick = async () => {
      reloadBtn.disabled = true; reloadBtn.textContent = 'Verificando…';
      try {
        await auth.currentUser?.reload();
        // onAuthStateChanged se dispara de nuevo con los datos actualizados
        auth.onAuthStateChanged(() => {}); // forzar re-evaluación
        location.reload();
      } catch(e) {
        reloadBtn.disabled = false; reloadBtn.textContent = '↺ Ya verifiqué mi correo';
      }
    };
  }

  if (logoutPendingBtn) {
    logoutPendingBtn.onclick = () => { auth.signOut(); };
  }

  pendingEl.style.display = 'flex';
}

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

        // 1. Usuario bloqueado
        if (d.blocked) {
          await auth.signOut();
          if (loadingEl) loadingEl.style.display = 'none';
          showPendingScreen('blocked');
          return;
        }

        // 2. Correo no verificado (solo para cuentas email+pass, no Google)
        if (!user.emailVerified && user.providerData?.[0]?.providerId === 'password') {
          if (loadingEl) loadingEl.style.display = 'none';
          showPendingScreen('unverified', user);
          return;
        }

        // 3. Cuenta no aprobada por admin
        if (!d.approved && d.role !== 'admin') {
          if (loadingEl) loadingEl.style.display = 'none';
          showPendingScreen('unapproved');
          return;
        }

        AUTH.userProfile.role        = d.role    || 'user';
        AUTH.userProfile.teamId      = d.teamId  || null;
        AUTH.userProfile.displayName = d.displayName || AUTH.userProfile.displayName;
      } else {
        AUTH.userProfile.role = await ensureUserProfile(user);
        // Recién creado: enviar verificación de correo si es email+pass
        if (user.providerData?.[0]?.providerId === 'password' && !user.emailVerified) {
          try { await user.sendEmailVerification(); } catch(_) {}
          if (loadingEl) loadingEl.style.display = 'none';
          showPendingScreen('unverified', user);
          return;
        }
      }
    } catch(e) {
      console.warn('Error cargando perfil:', e);
    }

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
    // Ocultar pantalla de espera si estaba visible
    const pendEl = document.getElementById('pendingScreen');
    if (pendEl) pendEl.style.display = 'none';
    if (authEl) authEl.style.display = '';
  }
});
