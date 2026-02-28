/**
 * JuriTask — auth.js
 * UI de autenticación: login, registro, recuperar contraseña,
 * modal de perfil, y logout.
 * Depende de firebase.js (AUTH, auth).
 */

// ============================================================
// TABS DE AUTH (Login / Registro)
// ============================================================
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

  // ── Formulario LOGIN ────────────────────────────────────
  document.getElementById('loginForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const pass  = document.getElementById('loginPass').value;
    if (!email || !pass) { showAuthError('Completa todos los campos.'); return; }
    setAuthLoading(true);
    try {
      await AUTH.loginEmail(email, pass);
      // onAuthStateChanged en firebase.js se encarga del resto
    } catch (err) {
      setAuthLoading(false);
      showAuthError(friendlyAuthError(err.code));
    }
  });

  // ── Formulario REGISTRO ─────────────────────────────────
  document.getElementById('registerForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const name  = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const pass  = document.getElementById('regPass').value;
    const pass2 = document.getElementById('regPass2').value;

    if (!name || !email || !pass || !pass2) { showAuthError('Completa todos los campos.'); return; }
    if (pass !== pass2)                     { showAuthError('Las contraseñas no coinciden.'); return; }
    if (pass.length < 6)                    { showAuthError('La contraseña debe tener al menos 6 caracteres.'); return; }

    setAuthLoading(true);
    try {
      const cred = await AUTH.registerEmail(email, pass);
      // Guardar nombre
      await cred.user.updateProfile({ displayName: name });

      // El primer usuario registrado se convierte en admin
      const usersSnap = await db.collection('users').get();
      const isFirstUser = usersSnap.empty || (usersSnap.size === 1 && usersSnap.docs[0].id === cred.user.uid);
      const role = isFirstUser ? 'admin' : 'user';

      await db.collection('users').doc(cred.user.uid).set({
        displayName: name,
        email:       email,
        role:        role,
        creadoEn:    new Date().toISOString(),
      });

      // onAuthStateChanged se encarga del resto
    } catch (err) {
      setAuthLoading(false);
      showAuthError(friendlyAuthError(err.code));
    }
  });

  // ── Formulario RESET ────────────────────────────────────
  document.getElementById('resetForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const email = document.getElementById('resetEmail').value.trim();
    if (!email) { showAuthError('Ingresa tu correo.'); return; }
    setAuthLoading(true);
    try {
      await AUTH.resetPassword(email);
      setAuthLoading(false);
      showAuthError('✓ Enlace enviado. Revisa tu correo.', 'success');
    } catch (err) {
      setAuthLoading(false);
      showAuthError(friendlyAuthError(err.code));
    }
  });

  // ── Botón Google ────────────────────────────────────────
  document.querySelector('.btn-google-login')?.addEventListener('click', async () => {
    setAuthLoading(true);
    try {
      // signInWithRedirect no devuelve promesa con resultado;
      // el resultado se captura en firebase.js con getRedirectResult()
      await AUTH.loginGoogle();
      // La página hará redirect, el loading se queda visible intencionalmente
    } catch (err) {
      setAuthLoading(false);
      if (err.code === 'auth/unauthorized-domain') {
        showAuthError('Dominio no autorizado. Ve a Firebase Console → Authentication → Authorized domains y agrega tu dominio.');
      } else {
        showAuthError(friendlyAuthError(err.code));
      }
    }
  });
}

// ── Helper: mostrar/ocultar spinner de carga ──────────────
function setAuthLoading(on) {
  const overlay = document.getElementById('authLoadingOverlay');
  if (overlay) overlay.style.display = on ? 'flex' : 'none';
}

// ── Helper: mensajes de error ─────────────────────────────
function showAuthError(msg, type = 'error') {
  const el = document.getElementById('authError');
  if (!el) return;
  el.textContent  = msg;
  el.style.display = '';
  el.style.color   = type === 'success' ? 'var(--success, #16a34a)' : 'var(--danger, #dc2626)';
}

function clearAuthError() {
  const el = document.getElementById('authError');
  if (el) { el.style.display = 'none'; el.textContent = ''; }
}

function friendlyAuthError(code) {
  const map = {
    'auth/user-not-found':        'No existe una cuenta con ese correo.',
    'auth/wrong-password':        'Contraseña incorrecta.',
    'auth/email-already-in-use':  'Ya existe una cuenta con ese correo.',
    'auth/invalid-email':         'El correo no es válido.',
    'auth/weak-password':         'La contraseña es demasiado débil.',
    'auth/too-many-requests':     'Demasiados intentos. Espera un momento.',
    'auth/network-request-failed':'Sin conexión. Verifica tu internet.',
    'auth/popup-blocked':         'El popup fue bloqueado. Permite popups para este sitio.',
    'auth/invalid-credential':    'Correo o contraseña incorrectos.',
  };
  return map[code] || 'Error inesperado. Intenta de nuevo.';
}

// ============================================================
// LOGOUT
// ============================================================
function logout() {
  if (!confirm('¿Cerrar sesión?')) return;
  AUTH.logout().catch(console.error);
}

// ============================================================
// MODAL DE PERFIL
// ============================================================
function openProfileModal() {
  const p = AUTH.userProfile;
  if (!p) return;
  document.getElementById('profileName').value  = p.displayName || '';
  document.getElementById('profileEmail').value = p.email       || '';
  document.getElementById('profileRole').textContent = p.role === 'admin' ? '👑 Administrador' : '👤 Usuario';
  document.getElementById('profileOverlay').classList.add('open');
}

function closeProfileModal() {
  document.getElementById('profileOverlay').classList.remove('open');
}

// ── Inicializar listeners del modal de perfil ─────────────
function initAuth() {
  // Cerrar modal perfil
  document.getElementById('profileClose')?.addEventListener('click', closeProfileModal);
  document.getElementById('profileOverlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('profileOverlay')) closeProfileModal();
  });

  // Guardar nombre
  document.getElementById('saveProfileBtn')?.addEventListener('click', async () => {
    const name = document.getElementById('profileName').value.trim();
    if (!name) { showToast('El nombre no puede estar vacío.'); return; }
    try {
      await AUTH.updateDisplayName(name);
      await db.collection('users').doc(AUTH.userProfile.uid).update({ displayName: name });
      AUTH.userProfile.displayName = name;
      syncConfigAccountUI();
      // Actualizar avatar en topbar
      const avEl   = document.getElementById('userAvatar');
      const nameEl = document.getElementById('userNameDisplay');
      if (avEl)   avEl.textContent   = name.slice(0, 2).toUpperCase();
      if (nameEl) nameEl.textContent = name.split(' ')[0];
      showToast('Nombre actualizado.');
    } catch (err) {
      showToast('Error al guardar: ' + err.message);
    }
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
      document.getElementById('currentPass').value = '';
      document.getElementById('newPass').value     = '';
      document.getElementById('confirmPass').value = '';
      showToast('Contraseña cambiada.');
    } catch (err) {
      showToast(friendlyAuthError(err.code));
    }
  });

  // User avatar button → abrir perfil
  document.getElementById('userAvatarBtn')?.addEventListener('click', openProfileModal);
}
