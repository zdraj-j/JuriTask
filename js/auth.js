/**
 * JuriTask — auth.js
 * La pantalla de acceso y el pie de sesión.
 *
 * Es deliberadamente pequeña. La versión anterior traía registro por correo,
 * verificación, recuperación de contraseña, aprobación por un administrador y
 * pantallas de espera para cada estado intermedio. Nada de eso tiene sentido en
 * una app de un solo usuario: aquí solo hay un botón de Google.
 *
 * Ver [autenticacion.md](../docs/autenticacion.md).
 */

function mostrarPantallaAcceso() {
  document.getElementById('splashScreen')?.remove();
  const acceso = document.getElementById('authScreen');
  const app    = document.getElementById('appContainer');
  if (acceso) acceso.style.display = 'flex';
  if (app)    app.style.display    = 'none';
  if (window.lucide) lucide.createIcons();
}

function mostrarApp() {
  document.getElementById('splashScreen')?.remove();
  const acceso = document.getElementById('authScreen');
  const app    = document.getElementById('appContainer');
  if (acceso) acceso.style.display = 'none';
  if (app)    app.style.display    = '';

  renderSesion();
  init();
}

/** Quién está dentro, en el pie de la barra lateral. */
function renderSesion() {
  const nombre = document.getElementById('sesionNombre');
  const avatar = document.getElementById('sesionAvatar');
  if (nombre) nombre.textContent = AUTH.nombre || AUTH.email || '';
  if (!avatar) return;

  if (AUTH.foto) {
    avatar.innerHTML = `<img src="${escapeAttr(AUTH.foto)}" alt="" referrerpolicy="no-referrer" />`;
  } else {
    const inicial = (AUTH.nombre || AUTH.email || '?').trim().charAt(0).toUpperCase();
    avatar.textContent = inicial;
  }
}

function _mostrarErrorAcceso(msg) {
  const caja = document.getElementById('authError');
  if (!caja) return;
  caja.textContent = msg;
  caja.style.display = 'block';
}

function _cargando(activo) {
  const capa = document.getElementById('authLoading');
  if (capa) capa.style.display = activo ? 'flex' : 'none';
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btnGoogleLogin')?.addEventListener('click', async () => {
    _cargando(true);
    try {
      await AUTH.loginGoogle();
      // No hace falta pintar nada: `onAuthStateChanged` arranca la app.
    } catch (e) {
      _cargando(false);
      // Cerrar el popup no es un error que merezca un mensaje.
      if (e?.code === 'auth/popup-closed-by-user' || e?.code === 'auth/cancelled-popup-request') return;
      if (e?.code === 'auth/popup-blocked') {
        _mostrarErrorAcceso('El navegador bloqueó la ventana de Google. Permite las ventanas emergentes para este sitio e inténtalo otra vez.');
        return;
      }
      console.error('Error de acceso:', e);
      _mostrarErrorAcceso('No se pudo iniciar sesión. Revisa la conexión e inténtalo de nuevo.');
    }
  });

  document.getElementById('btnLogout')?.addEventListener('click', async () => {
    if (!confirm('¿Cerrar sesión?')) return;
    // El orden importa: primero se corta el guardado, porque el `beforeunload`
    // de la recarga volvería a volcar STATE sobre el localStorage recién
    // vaciado —clave de Gemini incluida—.
    pausarGuardadoLocal();
    // Vaciar la caché local: en un equipo compartido, los datos no se quedan
    // esperando al siguiente que abra la app.
    try {
      localStorage.removeItem(KEYS.tramites);
      localStorage.removeItem(KEYS.order);
      localStorage.removeItem(KEYS.config);
    } catch (_) { /* sin localStorage: nada que limpiar */ }
    await AUTH.logout();
    location.reload();
  });
});
