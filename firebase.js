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

// URL de la app (para continueUrl en correos de verificación)
const APP_URL = 'https://zdraj-j.github.io/juritask/';

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
  resetPassword(email)    { return auth.sendPasswordResetEmail(email, { url: APP_URL }); },
  updateDisplayName(name) { return auth.currentUser?.updateProfile({ displayName: name }); },
  updatePassword(pw)      { return auth.currentUser?.updatePassword(pw); },

  reauthenticate(currentPassword) {
    const user = auth.currentUser;
    const cred = firebase.auth.EmailAuthProvider.credential(user.email, currentPassword);
    return user.reauthenticateWithCredential(cred);
  },

  // Enviar verificación de correo con continueUrl correcto
  sendVerificationEmail(user) {
    const actionCodeSettings = {
      url: APP_URL,
      handleCodeInApp: false,
    };
    return (user || auth.currentUser)?.sendEmailVerification(actionCodeSettings);
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

// ─── CREAR/COMPLETAR PERFIL EN FIRESTORE ─────────────────────
// preApproved = true cuando viene con invitación válida
async function ensureUserProfile(user, preApproved = false) {
  const uRef = db.collection('users').doc(user.uid);
  const uDoc = await uRef.get();

  if (!uDoc.exists) {
    // Verificar si es el primer usuario del sistema
    let isFirstUser = false;
    try {
      const idx  = await db.collection('meta').doc('userIndex').get();
      const uids = (idx.exists && idx.data().uids) ? idx.data().uids : [];
      if (uids.length === 0) isFirstUser = true;
    } catch(_) {}

    const role     = isFirstUser ? 'admin' : 'user';
    // approved = true si es primer admin O viene con invitación válida
    const approved = isFirstUser || preApproved;

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
  if (existing.approved === undefined) patch.approved = true;
  if (existing.blocked  === undefined) patch.blocked  = false;
  if (Object.keys(patch).length) {
    await uRef.update(patch).catch(() => uRef.set(patch, { merge: true }));
  }

  await registerInUserIndex(user.uid);
  return existing.role || 'user';
}

// ─── PANTALLA DE ESPERA ───────────────────────────────────────
function showWaitScreen(type, extraData) {
  const authEl  = document.getElementById('authScreen');
  const appEl   = document.getElementById('appContainer');
  const waitEl  = document.getElementById('waitScreen');

  if (!waitEl) return;

  if (authEl) authEl.style.display = 'none';
  if (appEl)  appEl.style.display  = 'none';
  waitEl.style.display = 'flex';

  const iconEl    = document.getElementById('waitIcon');
  const titleEl   = document.getElementById('waitTitle');
  const msgEl     = document.getElementById('waitMsg');
  const actionEl  = document.getElementById('waitAction');
  const resendEl  = document.getElementById('waitResend');
  const logoutEl  = document.getElementById('waitLogout');

  if (type === 'verify') {
    if (iconEl)  iconEl.textContent  = '📧';
    if (titleEl) titleEl.textContent = 'Verifica tu correo electrónico';
    if (msgEl)   msgEl.textContent   = `Enviamos un enlace de verificación a ${extraData || 'tu correo'}. Haz clic en el enlace y luego regresa aquí.`;
    if (actionEl) {
      actionEl.textContent = '✓ Ya verifiqué mi correo';
      actionEl.style.display = '';
      actionEl.onclick = async () => {
        actionEl.disabled = true;
        actionEl.textContent = 'Verificando…';
        try {
          await auth.currentUser?.reload();
          const u = auth.currentUser;
          if (u?.emailVerified) {
            // Correo verificado — recargar para disparar onAuthStateChanged
            location.reload();
          } else {
            actionEl.disabled = false;
            actionEl.textContent = '✓ Ya verifiqué mi correo';
            showToast('Aún no se detecta la verificación. Revisa tu correo o reenvíalo.');
          }
        } catch(e) {
          actionEl.disabled = false;
          actionEl.textContent = '✓ Ya verifiqué mi correo';
        }
      };
    }
    if (resendEl) {
      resendEl.style.display = '';
      resendEl.textContent   = '↺ Reenviar correo de verificación';
      resendEl.onclick = async () => {
        try {
          await AUTH.sendVerificationEmail(auth.currentUser);
          showToast('✓ Correo reenviado.');
          resendEl.textContent = '✓ Enviado';
          setTimeout(() => { resendEl.textContent = '↺ Reenviar correo de verificación'; }, 3000);
        } catch(e) { showToast('Error: ' + (e.message || e.code)); }
      };
    }
  } else if (type === 'pending') {
    if (iconEl)  iconEl.textContent  = '⏳';
    if (titleEl) titleEl.textContent = 'Solicitud de acceso enviada';
    if (msgEl)   msgEl.textContent   = 'Tu correo fue verificado. Un administrador revisará tu solicitud y te dará acceso pronto. Puedes cerrar esta ventana y volver cuando recibas confirmación.';
    if (actionEl) actionEl.style.display = 'none';
    if (resendEl) resendEl.style.display = 'none';
  } else if (type === 'blocked') {
    if (iconEl)  iconEl.textContent  = '🚫';
    if (titleEl) titleEl.textContent = 'Cuenta bloqueada';
    if (msgEl)   msgEl.textContent   = 'Tu cuenta ha sido bloqueada. Contacta al administrador para más información.';
    if (actionEl) actionEl.style.display = 'none';
    if (resendEl) resendEl.style.display = 'none';
  }

  if (logoutEl) {
    logoutEl.onclick = () => { auth.signOut(); };
  }
}

function hideWaitScreen() {
  const waitEl = document.getElementById('waitScreen');
  if (waitEl) waitEl.style.display = 'none';
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
      db.collection('users').doc(t.abogado).collection('tramites').doc(id).delete().catch(()=>{});
    }
  }
  if (t && t._sharedFrom) {
    db.collection('users').doc(t._sharedFrom).collection('tramites').doc(id).delete().catch(()=>{});
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
    if (loadingEl) loadingEl.style.display = 'none';

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

        // Cuenta bloqueada → mostrar pantalla y salir
        if (d.blocked) {
          await auth.signOut();
          showWaitScreen('blocked');
          return;
        }

        AUTH.userProfile.role        = d.role    || 'user';
        AUTH.userProfile.teamId      = d.teamId  || null;
        AUTH.userProfile.displayName = d.displayName || AUTH.userProfile.displayName;

        // Correo no verificado (solo cuentas email+pass, no Google/admin)
        const isEmailPass = user.providerData?.[0]?.providerId === 'password';
        if (isEmailPass && !user.emailVerified && d.role !== 'admin') {
          // Seguir esperando en la pantalla de verificación
          showWaitScreen('verify', user.email);
          return;
        }

        // Cuenta no aprobada → mostrar pantalla de espera
        if (!d.approved && d.role !== 'admin') {
          showWaitScreen('pending');
          return;
        }

      } else {
        // Perfil no existe: crearlo
        AUTH.userProfile.role = await ensureUserProfile(user);
        // Si es email+pass y no está verificado, enviar correo
        const isEmailPass = user.providerData?.[0]?.providerId === 'password';
        if (isEmailPass && !user.emailVerified && AUTH.userProfile.role !== 'admin') {
          try { await AUTH.sendVerificationEmail(user); } catch(_) {}
          showWaitScreen('verify', user.email);
          return;
        }
      }
    } catch(e) {
      console.warn('Error leyendo perfil:', e);
    }

    // ── Usuario OK: cargar la app ─────────────────────────
    hideWaitScreen();
    await loadFromFirestore();

    const savedCols = STATE.config.columns || 1;
    document.querySelectorAll('.col-btn').forEach(b =>
      b.classList.toggle('active', parseInt(b.dataset.cols) === savedCols));
    document.querySelectorAll('.mob-col-btn').forEach(b =>
      b.classList.toggle('active', parseInt(b.dataset.cols) === savedCols));

    if (authEl) authEl.style.display = 'none';
    if (appEl)  appEl.style.display  = 'flex';

    if (typeof renderAll            === 'function') renderAll();
    if (typeof syncConfigAccountUI  === 'function') syncConfigAccountUI();
    if (typeof switchView           === 'function') switchView('all');
    if (typeof purgeExpiredFinished === 'function') purgeExpiredFinished();
    if (typeof startAutoBackup      === 'function') startAutoBackup();
    if (typeof loadTeamMembers      === 'function') loadTeamMembers();
    // Admin: arrancar listener de cuentas pendientes
    if (AUTH.userProfile.role === 'admin' && typeof startPendingListener === 'function') {
      startPendingListener();
    }

  } else {
    // Sin sesión
    AUTH.userProfile = null;
    hideWaitScreen();
    if (appEl)     appEl.style.display     = 'none';
    if (loadingEl) loadingEl.style.display = 'none';
    if (authEl)    authEl.style.display    = '';
  }
});
