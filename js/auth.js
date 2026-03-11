/**
 * JuriTask — auth.js
 * UI de autenticación: login, registro, recuperar contraseña,
 * modal de perfil, y logout.
 */

function initAuthUI() {
  // ── Olvidé contraseña ───────────────────────────────────
  document.getElementById('forgotPassBtn')?.addEventListener('click', () => {
    document.getElementById('loginForm').style.display    = 'none';
    document.getElementById('resetForm').style.display    = '';
    clearAuthError();
  });

  // ── LOGIN ────────────────────────────────────────────────
  document.getElementById('loginForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    let email = document.getElementById('loginEmail').value.trim();
    const pass  = document.getElementById('loginPass').value;
    if (!email || !pass) { showAuthError('Completa todos los campos.'); return; }
    // Si no tiene @, es un nombre de usuario creado por admin
    if (!email.includes('@')) email = email.toLowerCase().replace(/\s/g, '') + '@juritask.local';
    setAuthLoading(true);
    try {
      await AUTH.loginEmail(email, pass);
      // onAuthStateChanged se encarga de todo lo siguiente
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

  // ── Volver a login desde reset ─────────────────────────
  document.getElementById('backToLoginBtn')?.addEventListener('click', () => {
    document.getElementById('resetForm').style.display = 'none';
    document.getElementById('loginForm').style.display = '';
    clearAuthError();
  });

  // ── GOOGLE ───────────────────────────────────────────────
  document.querySelector('.btn-google-login')?.addEventListener('click', async () => {
    setAuthLoading(true);
    try {
      const cred = await AUTH.loginGoogle();
      await ensureUserProfile(cred.user);
      // onAuthStateChanged se encarga
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

// ── Mensajes de error ─────────────────────────────────────────
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
    'auth/weak-password':          'La contraseña es demasiado débil (mínimo 6 caracteres).',
    'auth/too-many-requests':      'Demasiados intentos. Espera un momento.',
    'auth/network-request-failed': 'Sin conexión. Verifica tu internet.',
    'auth/popup-blocked':          'El popup fue bloqueado por el navegador.',
    'auth/invalid-credential':     'Correo o contraseña incorrectos.',
    'auth/operation-not-allowed':  'Método de acceso no habilitado en Firebase.',
    'auth/unauthorized-domain':    'Dominio no autorizado en Firebase.',
  };
  return map[code] || `Error inesperado (${code || 'desconocido'}). Intenta de nuevo.`;
}

// ── Logout ────────────────────────────────────────────────────
function logout() {
  if (!confirm('¿Cerrar sesión?')) return;
  AUTH.logout().catch(console.error);
}

// ── Popover de perfil (anclado al avatar) ────────────────────
function openProfileModal() {
  const p = AUTH.userProfile;
  if (!p) return;
  const panel = document.getElementById('profileOverlay');
  if (!panel) return;

  // Toggle — si ya está abierto, cerrar
  if (panel.classList.contains('open')) { closeProfileModal(); return; }

  const initials = (p.displayName || p.email || '?').slice(0, 2).toUpperCase();
  const avatarBig = document.getElementById('profileAvatarBig');
  if (avatarBig) avatarBig.textContent = initials;
  const nd = document.getElementById('profileNameDisplay');
  const ed = document.getElementById('profileEmailDisplay');
  const rd = document.getElementById('profileRoleDisplay');
  if (nd) nd.textContent = p.displayName || '(sin nombre)';
  if (ed) ed.textContent = p.email || '';
  if (rd) rd.textContent = p.role === 'admin' ? 'Administrador' : 'Usuario';

  // Posicionar popover encima del botón de avatar
  const btn = document.getElementById('userAvatarBtn');
  if (btn) {
    const rect = btn.getBoundingClientRect();
    panel.style.left   = rect.left + 'px';
    panel.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
    panel.style.top    = 'auto';
    panel.style.right  = 'auto';
  }

  panel.classList.add('open');

  // Cerrar al hacer click fuera
  setTimeout(() => {
    function onOutside(e) {
      if (!panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
        closeProfileModal();
        document.removeEventListener('click', onOutside);
      }
    }
    document.addEventListener('click', onOutside);
  }, 50);
}

function closeProfileModal() {
  document.getElementById('profileOverlay')?.classList.remove('open');
}

// ── Modal editar perfil (desde config) ───────────────────────
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
  // Popover de perfil
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
      ['currentPass','newPass','confirmPass'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
      });
      showToast('Contraseña cambiada correctamente.');
      closeEditProfileModal();
    } catch(err) { showToast(friendlyAuthError(err.code)); }
  });
}
