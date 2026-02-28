/**
 * JuriTask — auth.js
 * UI de autenticación: login, registro, recuperar contraseña,
 * modal de perfil, y logout.
 *
 * SEGURIDAD (doble capa):
 *   1. Verificación de email — Firebase envía un correo; el usuario
 *      no puede entrar hasta hacer clic en el enlace.
 *   2. Aprobación de admin — incluso con email verificado, el admin
 *      debe activar la cuenta desde el panel de administración.
 */

// ─── PANTALLA DE "ESPERANDO VERIFICACIÓN" ─────────────────────
// Se muestra tras el registro hasta que el usuario verifique su correo.
let _verifyPollingInterval = null;

function showVerifyEmailScreen(email) {
  // Ocultar el formulario de registro y mostrar aviso
  document.getElementById('registerForm').style.display = 'none';
  document.getElementById('loginForm').style.display    = 'none';
  document.getElementById('resetForm').style.display    = 'none';

  let screen = document.getElementById('verifyEmailScreen');
  if (!screen) {
    screen = document.createElement('div');
    screen.id        = 'verifyEmailScreen';
    screen.className = 'verify-email-screen';
    // Insertar dentro del auth-card (contenedor de los formularios)
    const card = document.querySelector('.auth-card') || document.getElementById('authScreen');
    card.appendChild(screen);
  }

  screen.innerHTML = `
    <div class="verify-email-icon">✉️</div>
    <h2 class="verify-email-title">Verifica tu correo</h2>
    <p class="verify-email-body">
      Enviamos un enlace de verificación a<br>
      <strong>${email}</strong><br><br>
      Haz clic en ese enlace y luego vuelve aquí.
      Una vez verificado, tu cuenta quedará pendiente de
      <strong>aprobación por el administrador</strong>.
    </p>
    <button class="btn-primary" id="verifyCheckBtn" style="margin-top:1.2rem;width:100%">
      Ya verifiqué mi correo
    </button>
    <button class="btn-secondary" id="verifyResendBtn" style="margin-top:.6rem;width:100%">
      Reenviar correo
    </button>
    <button class="btn-ghost" id="verifyCancelBtn" style="margin-top:.4rem;width:100%;font-size:.85rem">
      Cancelar y volver al inicio de sesión
    </button>
    <p id="verifyMsg" style="margin-top:.8rem;font-size:.85rem;text-align:center"></p>
  `;
  screen.style.display = '';

  // Verificar manualmente
  document.getElementById('verifyCheckBtn').addEventListener('click', async () => {
    await checkEmailVerified(email);
  });

  // Reenviar
  document.getElementById('verifyResendBtn').addEventListener('click', async () => {
    try {
      await auth.currentUser?.sendEmailVerification();
      setVerifyMsg('✓ Correo reenviado. Revisa tu bandeja.', 'success');
    } catch(e) {
      setVerifyMsg(friendlyAuthError(e.code), 'error');
    }
  });

  // Cancelar → volver al login
  document.getElementById('verifyCancelBtn').addEventListener('click', () => {
    stopVerifyPolling();
    AUTH.logout().catch(()=>{});
    hideVerifyEmailScreen();
    switchAuthTab('login');
  });

  // Sondeo automático cada 5 s para detectar verificación sin que el usuario
  // tenga que pulsar el botón
  _verifyPollingInterval = setInterval(() => checkEmailVerified(email, true), 5000);
}

function hideVerifyEmailScreen() {
  const screen = document.getElementById('verifyEmailScreen');
  if (screen) screen.style.display = 'none';
}

function stopVerifyPolling() {
  clearInterval(_verifyPollingInterval);
  _verifyPollingInterval = null;
}

function setVerifyMsg(msg, type = 'info') {
  const el = document.getElementById('verifyMsg');
  if (!el) return;
  el.textContent = msg;
  el.style.color = type === 'success' ? 'var(--success,#16a34a)'
                 : type === 'error'   ? 'var(--danger,#dc2626)'
                 : 'var(--text-muted,#6b7280)';
}

/**
 * Recarga el usuario de Firebase para obtener el estado actualizado de
 * emailVerified. Si ya está verificado muestra la pantalla de espera de
 * aprobación o entra en la app (si el admin ya la aprobó).
 *
 * @param {string}  email        — solo para mensajes informativos
 * @param {boolean} silent       — si true, no muestra mensajes de "no verificado"
 */
async function checkEmailVerified(email, silent = false) {
  try {
    await auth.currentUser?.reload();
    const user = auth.currentUser;
    if (!user) return;

    if (user.emailVerified) {
      stopVerifyPolling();
      hideVerifyEmailScreen();
      // onAuthStateChanged se disparará automáticamente y completará el flujo
      // pero como ya estábamos logueados, lo forzamos manualmente:
      setAuthLoading(true);
      // onAuthStateChanged no vuelve a dispararse si el usuario ya estaba logueado
      // y solo cambió emailVerified, así que comprobamos el perfil directamente.
      await handleVerifiedUser(user);
    } else {
      if (!silent) setVerifyMsg('Tu correo todavía no ha sido verificado.', 'error');
    }
  } catch(e) {
    if (!silent) setVerifyMsg(friendlyAuthError(e.code), 'error');
  }
}

/**
 * Lógica compartida entre onAuthStateChanged y checkEmailVerified
 * para usuarios con email ya verificado.
 */
async function handleVerifiedUser(user) {
  const appEl     = document.getElementById('appContainer');
  const authEl    = document.getElementById('authScreen');
  const loadingEl = document.getElementById('authLoadingOverlay');

  AUTH.userProfile = {
    uid:         user.uid,
    displayName: user.displayName || '',
    email:       user.email       || '',
    photoURL:    user.photoURL    || null,
    role:        'user',
    teamId:      null,
    approved:    false,
  };

  try {
    const uDoc = await db.collection('users').doc(user.uid).get();
    if (uDoc.exists) {
      const d = uDoc.data();

      // ── Cuenta bloqueada ─────────────────────────────────
      if (d.blocked) {
        await auth.signOut();
        showAuthMessage('Tu cuenta ha sido bloqueada. Contacta al administrador.', 'error');
        if (loadingEl) loadingEl.style.display = 'none';
        return;
      }

      AUTH.userProfile.role     = d.role     || 'user';
      AUTH.userProfile.teamId   = d.teamId   || null;
      AUTH.userProfile.approved = d.approved ?? false;
      AUTH.userProfile.displayName = d.displayName || AUTH.userProfile.displayName;

      // ── Pendiente de aprobación ──────────────────────────
      if (!AUTH.userProfile.approved && AUTH.userProfile.role !== 'admin') {
        await auth.signOut();
        showAuthMessage(
          '⏳ Tu cuenta está pendiente de aprobación por el administrador. ' +
          'Recibirás acceso en breve.',
          'info'
        );
        if (loadingEl) loadingEl.style.display = 'none';
        return;
      }

    } else {
      // Doc no existe todavía (primer login tras verificar correo)
      AUTH.userProfile.role = await ensureUserProfile(user);
      // El primer usuario (admin) se aprueba automáticamente
      if (AUTH.userProfile.role === 'admin') {
        AUTH.userProfile.approved = true;
      } else {
        // Usuarios normales: pending hasta que el admin apruebe
        await auth.signOut();
        showAuthMessage(
          '⏳ Tu cuenta está pendiente de aprobación por el administrador.',
          'info'
        );
        if (loadingEl) loadingEl.style.display = 'none';
        return;
      }
    }
  } catch(_) {}

  // ── Todo OK: cargar app ──────────────────────────────────
  await loadFromFirestore();

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
  if (typeof showView             === 'function') showView('all');
  if (typeof purgeExpiredFinished === 'function') purgeExpiredFinished();
  if (typeof startAutoBackup      === 'function') startAutoBackup();
  if (typeof loadTeamMembers      === 'function') loadTeamMembers();
}

// ─── HELPERS UI ──────────────────────────────────────────────
function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('loginForm').style.display    = tab === 'login'    ? '' : 'none';
  document.getElementById('registerForm').style.display = tab === 'register' ? '' : 'none';
  document.getElementById('resetForm').style.display    = 'none';
  clearAuthError();
}

/** Muestra un mensaje persistente debajo del formulario (distinto de authError) */
function showAuthMessage(msg, type = 'info') {
  let el = document.getElementById('authMessage');
  if (!el) {
    el = document.createElement('p');
    el.id = 'authMessage';
    const card = document.querySelector('.auth-card') || document.getElementById('authScreen');
    card.appendChild(el);
  }
  el.textContent = msg;
  el.style.display = '';
  el.style.textAlign = 'center';
  el.style.padding   = '.8rem';
  el.style.borderRadius = '.5rem';
  el.style.marginTop = '.8rem';
  el.style.fontSize  = '.9rem';
  if (type === 'error') {
    el.style.background = 'var(--danger-bg,#fee2e2)';
    el.style.color      = 'var(--danger,#dc2626)';
  } else if (type === 'success') {
    el.style.background = 'var(--success-bg,#dcfce7)';
    el.style.color      = 'var(--success,#16a34a)';
  } else {
    el.style.background = 'var(--info-bg,#dbeafe)';
    el.style.color      = 'var(--info,#1d4ed8)';
  }
}

function clearAuthMessage() {
  const el = document.getElementById('authMessage');
  if (el) { el.style.display = 'none'; el.textContent = ''; }
}

// ============================================================
// INIT AUTH UI
// ============================================================
function initAuthUI() {
  // ── Tabs ────────────────────────────────────────────────
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      switchAuthTab(tab.dataset.tab);
      clearAuthMessage();
    });
  });

  // ── Olvidé contraseña ───────────────────────────────────
  document.getElementById('forgotPassBtn')?.addEventListener('click', () => {
    document.getElementById('loginForm').style.display    = 'none';
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('resetForm').style.display    = '';
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    clearAuthError();
    clearAuthMessage();
  });

  // ── LOGIN ────────────────────────────────────────────────
  document.getElementById('loginForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    clearAuthMessage();
    const email = document.getElementById('loginEmail').value.trim();
    const pass  = document.getElementById('loginPass').value;
    if (!email || !pass) { showAuthError('Completa todos los campos.'); return; }
    setAuthLoading(true);
    try {
      await AUTH.loginEmail(email, pass);
      // onAuthStateChanged manejará el resto
    } catch(err) {
      setAuthLoading(false);
      showAuthError(friendlyAuthError(err.code));
    }
  });

  // ── REGISTRO ─────────────────────────────────────────────
  document.getElementById('registerForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    clearAuthMessage();
    const name  = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const pass  = document.getElementById('regPass').value;
    const pass2 = document.getElementById('regPass2').value;

    if (!name || !email || !pass || !pass2) { showAuthError('Completa todos los campos.'); return; }
    if (pass !== pass2)  { showAuthError('Las contraseñas no coinciden.'); return; }
    if (pass.length < 6) { showAuthError('La contraseña debe tener al menos 6 caracteres.'); return; }

    setAuthLoading(true);
    try {
      const cred = await AUTH.registerEmail(email, pass);
      await cred.user.updateProfile({ displayName: name });

      // Crear el perfil en Firestore ANTES de enviar el correo,
      // con approved:false para que quede pendiente de revisión.
      await ensureUserProfile({ ...cred.user, displayName: name });

      // Enviar correo de verificación
      await cred.user.sendEmailVerification();

      setAuthLoading(false);
      showVerifyEmailScreen(email);

    } catch(err) {
      setAuthLoading(false);
      showAuthError(friendlyAuthError(err.code));
    }
  });

  // ── RESET ────────────────────────────────────────────────
  document.getElementById('resetForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const email = document.getElementById('resetEmail').value.trim();
    if (!email) { showAuthError('Ingresa tu correo.'); return; }
    setAuthLoading(true);
    try {
      await AUTH.resetPassword(email);
      setAuthLoading(false);
      showAuthError('✓ Enlace enviado. Revisa tu correo.', 'success');
    } catch(err) {
      setAuthLoading(false);
      showAuthError(friendlyAuthError(err.code));
    }
  });

  // ── GOOGLE ───────────────────────────────────────────────
  // Google siempre verifica el correo automáticamente, así que solo
  // necesitamos comprobar la aprobación del admin.
  document.querySelector('.btn-google-login')?.addEventListener('click', async () => {
    clearAuthMessage();
    setAuthLoading(true);
    try {
      const cred = await AUTH.loginGoogle();
      await ensureUserProfile(cred.user);
      // onAuthStateChanged se encarga del resto
    } catch(err) {
      setAuthLoading(false);
      if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') return;
      if (err.code === 'auth/unauthorized-domain') {
        showAuthError('Dominio no autorizado. Agrega "zdraj-j.github.io" en Firebase → Authentication → Authorized domains.');
      } else {
        showAuthError(friendlyAuthError(err.code));
      }
    }
  });
}

// ── Loading ───────────────────────────────────────────────────
function setAuthLoading(on) {
  const overlay = document.getElementById('authLoadingOverlay');
  if (overlay) overlay.style.display = on ? 'flex' : 'none';
}

// ── Mensajes ──────────────────────────────────────────────────
function showAuthError(msg, type = 'error') {
  const el = document.getElementById('authError');
  if (!el) return;
  el.textContent   = msg;
  el.style.display = '';
  el.style.color   = type === 'success' ? 'var(--success, #16a34a)' : 'var(--danger, #dc2626)';
}

function clearAuthError() {
  const el = document.getElementById('authError');
  if (el) { el.style.display = 'none'; el.textContent = ''; }
}

function friendlyAuthError(code) {
  const map = {
    'auth/user-not-found':         'No existe una cuenta con ese correo.',
    'auth/wrong-password':         'Contraseña incorrecta.',
    'auth/email-already-in-use':   'Ya existe una cuenta con ese correo.',
    'auth/invalid-email':          'El correo no es válido.',
    'auth/weak-password':          'La contraseña es demasiado débil.',
    'auth/too-many-requests':      'Demasiados intentos. Espera un momento.',
    'auth/network-request-failed': 'Sin conexión. Verifica tu internet.',
    'auth/popup-blocked':          'El popup fue bloqueado por el navegador.',
    'auth/invalid-credential':     'Correo o contraseña incorrectos.',
    'auth/operation-not-allowed':  'Google no está habilitado. Ve a Firebase → Authentication → Sign-in method → Google y actívalo.',
    'auth/unauthorized-domain':    'Dominio no autorizado. Agrega tu dominio en Firebase → Authentication → Authorized domains.',
  };
  return map[code] || `Error inesperado (${code || 'desconocido'}). Intenta de nuevo.`;
}

// ── Logout ────────────────────────────────────────────────────
function logout() {
  if (!confirm('¿Cerrar sesión?')) return;
  AUTH.logout().catch(console.error);
}

// ── Overlay avatar: resumen rápido + ir a editar + logout ─────
function openProfileModal() {
  const p = AUTH.userProfile;
  if (!p) return;
  const initials = (p.displayName || p.email || '?').slice(0, 2).toUpperCase();
  const avatarBig = document.getElementById('profileAvatarBig');
  if (avatarBig) avatarBig.textContent = initials;
  const nd = document.getElementById('profileNameDisplay');
  const ed = document.getElementById('profileEmailDisplay');
  const rd = document.getElementById('profileRoleDisplay');
  if (nd) nd.textContent = p.displayName || '(sin nombre)';
  if (ed) ed.textContent = p.email || '';
  if (rd) rd.textContent = p.role === 'admin' ? '👑 Administrador' : '👤 Usuario';
  document.getElementById('profileOverlay').classList.add('open');
}

function closeProfileModal() {
  document.getElementById('profileOverlay').classList.remove('open');
}

// ── Modal editar perfil (abre desde config) ───────────────────
function openEditProfileModal() {
  const p = AUTH.userProfile;
  if (!p) return;
  const nameEl  = document.getElementById('profileName');
  const emailEl = document.getElementById('profileEmail');
  if (nameEl)  nameEl.value  = p.displayName || '';
  if (emailEl) emailEl.value = p.email || '';
  document.getElementById('editProfileOverlay')?.classList.add('open');
}

function closeEditProfileModal() {
  document.getElementById('editProfileOverlay')?.classList.remove('open');
  ['currentPass','newPass','confirmPass'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
}

function initAuth() {
  // Overlay avatar
  document.getElementById('profileClose')?.addEventListener('click', closeProfileModal);
  document.getElementById('profileOverlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('profileOverlay')) closeProfileModal();
  });
  document.getElementById('goToEditProfileBtn')?.addEventListener('click', () => {
    closeProfileModal();
    if (typeof showView === 'function') showView('config');
    setTimeout(openEditProfileModal, 80);
  });
  document.getElementById('profileLogoutBtn')?.addEventListener('click', () => {
    closeProfileModal(); logout();
  });
  document.getElementById('userAvatarBtn')?.addEventListener('click', openProfileModal);

  // Modal editar perfil
  document.getElementById('editProfileClose')?.addEventListener('click', closeEditProfileModal);
  document.getElementById('editProfileOverlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('editProfileOverlay')) closeEditProfileModal();
  });
  document.getElementById('configEditProfileBtn')?.addEventListener('click', openEditProfileModal);

  // Guardar nombre
  document.getElementById('saveProfileBtn')?.addEventListener('click', async () => {
    const name = document.getElementById('profileName').value.trim();
    if (!name) { showToast('El nombre no puede estar vacío.'); return; }
    try {
      await AUTH.updateDisplayName(name);
      await db.collection('users').doc(AUTH.userProfile.uid).update({ displayName: name });
      AUTH.userProfile.displayName = name;
      syncConfigAccountUI();
      const avEl   = document.getElementById('userAvatar');
      const nameEl = document.getElementById('userNameDisplay');
      if (avEl)   avEl.textContent   = name.slice(0, 2).toUpperCase();
      if (nameEl) nameEl.textContent = name.split(' ')[0];
      showToast('Nombre actualizado.');
    } catch(err) { showToast('Error: ' + err.message); }
  });

  // Cambiar contraseña
  document.getElementById('changePassBtn')?.addEventListener('click', async () => {
    const current  = document.getElementById('currentPass').value;
    const newPass  = document.getElementById('newPass').value;
    const confirm2 = document.getElementById('confirmPass').value;
    if (!current || !newPass || !confirm2) { showToast('Completa todos los campos.'); return; }
    if (newPass !== confirm2)              { showToast('Las contraseñas no coinciden.'); return; }
    if (newPass.length < 6)               { showToast('Mínimo 6 caracteres.'); return; }
    try {
      await AUTH.reauthenticate(current);
      await AUTH.updatePassword(newPass);
      ['currentPass','newPass','confirmPass'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      showToast('Contraseña cambiada correctamente.');
      closeEditProfileModal();
    } catch(err) { showToast(friendlyAuthError(err.code)); }
  });
}
