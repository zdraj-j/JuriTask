/**
 * JuriTask — auth.js
 * UI de autenticación: login, registro, recuperar contraseña,
 * modal de perfil, y logout.
 */

function initAuthUI() {
  // ── Tabs ────────────────────────────────────────────────
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t === tab));
      document.getElementById('loginForm').style.display    = target === 'login'    ? '' : 'none';
      document.getElementById('registerForm').style.display = target === 'register' ? '' : 'none';
      document.getElementById('resetForm').style.display    = 'none';
      clearAuthError();
    });
  });

  // ── Olvidé contraseña ───────────────────────────────────
  document.getElementById('forgotPassBtn')?.addEventListener('click', () => {
    document.getElementById('loginForm').style.display    = 'none';
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('resetForm').style.display    = '';
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    clearAuthError();
  });

  // ── LOGIN ────────────────────────────────────────────────
  document.getElementById('loginForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const pass  = document.getElementById('loginPass').value;
    if (!email || !pass) { showAuthError('Completa todos los campos.'); return; }
    setAuthLoading(true);
    try {
      await AUTH.loginEmail(email, pass);
    } catch(err) {
      setAuthLoading(false);
      showAuthError(friendlyAuthError(err.code));
    }
  });

  // ── REGISTRO ─────────────────────────────────────────────
  document.getElementById('registerForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const name  = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const pass  = document.getElementById('regPass').value;
    const pass2 = document.getElementById('regPass2').value;

    if (!name || !email || !pass || !pass2) { showAuthError('Completa todos los campos.'); return; }
    if (pass !== pass2)    { showAuthError('Las contraseñas no coinciden.'); return; }
    if (pass.length < 6)   { showAuthError('La contraseña debe tener al menos 6 caracteres.'); return; }

    setAuthLoading(true);
    try {
      const cred = await AUTH.registerEmail(email, pass);
      await cred.user.updateProfile({ displayName: name });
      // ensureUserProfile crea el doc y decide el rol
      const role = await ensureUserProfile({ ...cred.user, displayName: name });
      AUTH.userProfile = {
        uid: cred.user.uid, displayName: name, email, role, photoURL: null, teamId: null,
      };
      // onAuthStateChanged se encarga del resto
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
  document.querySelector('.btn-google-login')?.addEventListener('click', async () => {
    setAuthLoading(true);
    try {
      const cred = await AUTH.loginGoogle();
      // Asegurar perfil en Firestore (ensureUserProfile está en firebase.js)
      await ensureUserProfile(cred.user);
      // onAuthStateChanged se encarga de mostrar la app
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
    if (typeof switchView === 'function') switchView('config');
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
