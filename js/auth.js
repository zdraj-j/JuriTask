/**
 * JuriTask — auth.js
 * El pie de sesión y la puerta de entrada.
 *
 * ── Lo que cambió ───────────────────────────────────────────
 *
 * Antes la sesión de Google **era** la puerta: sin login no había datos, porque
 * los datos estaban en Firestore y Firestore necesita saber de quién son.
 *
 * Ahora los datos están en un JSON del disco
 * ([archivo-datos.md](../docs/archivo-datos.md)), así que la sesión no pinta
 * nada para entrar. Lo que gatea la app es **la carpeta de datos**, y el login
 * pasa a ser una acción opcional dentro de la app, para lo único que sigue
 * necesitando Google: leer el correo y guardar adjuntos en Drive.
 *
 * Consecuencia práctica: se puede abrir JuriTask y trabajar sin conexión y sin
 * cuenta. El correo simplemente no está disponible hasta que se conecte.
 */

// ============================================================
// LA PUERTA — carpeta de datos
// ============================================================

/**
 * Muestra la pantalla de entrada. `estado` viene de `reconectarCarpeta()`:
 *
 * - `'ninguna'` → nunca se eligió carpeta (o se olvidó).
 * - `'permiso'` → la carpeta se recuerda, pero el navegador exige un clic para
 *   volver a autorizarla. Es lo normal al abrir una pestaña nueva: el permiso
 *   no siempre sobrevive al cierre, y `requestPermission()` sin gesto falla.
 */
function mostrarPuerta(estado) {
  document.getElementById('splashScreen')?.remove();
  const puerta = document.getElementById('gateScreen');
  const app    = document.getElementById('appContainer');
  if (app) app.style.display = 'none';
  if (!puerta) return;
  puerta.style.display = 'flex';

  const soportado = soportaArchivo();
  const recordada = estado === 'permiso';

  _mostrar('gateElegir',    soportado && !recordada);
  _mostrar('gateReconectar', soportado && recordada);
  _mostrar('gateSinSoporte', !soportado);
  _mostrar('gateSinArchivo', true);

  if (window.lucide) lucide.createIcons();
}

function _mostrar(id, visible) {
  const el = document.getElementById(id);
  if (el) el.style.display = visible ? '' : 'none';
}

function mostrarApp() {
  document.getElementById('splashScreen')?.remove();
  const puerta = document.getElementById('gateScreen');
  const app    = document.getElementById('appContainer');
  if (puerta) puerta.style.display = 'none';
  if (app)    app.style.display    = '';

  renderSesion();
  init();
}

// ============================================================
// PIE DE LA BARRA LATERAL
// ============================================================

/**
 * Quién está dentro. Con sesión muestra la cuenta y el botón de salir; sin
 * sesión, un botón para conectar Google — que ya no es "entrar", sino
 * "habilitar el correo".
 */
function renderSesion() {
  const nombre  = document.getElementById('sesionNombre');
  const avatar  = document.getElementById('sesionAvatar');
  const salir   = document.getElementById('btnLogout');
  const conecta = document.getElementById('btnConectarGoogle');
  const activa  = typeof AUTH !== 'undefined' && AUTH.activa;

  _mostrar('btnConectarGoogle', !activa);
  if (salir) salir.style.display = activa ? '' : 'none';
  if (avatar) avatar.style.display = activa ? '' : 'none';

  if (nombre) {
    nombre.textContent = activa ? (AUTH.nombre || AUTH.email || '') : 'Sin conectar a Google';
    nombre.classList.toggle('sesion-nombre-apagado', !activa);
  }
  if (conecta) conecta.title = 'Conectar Google para el correo y los adjuntos';

  if (!avatar || !activa) return;
  if (AUTH.foto) {
    avatar.innerHTML = `<img src="${escapeAttr(AUTH.foto)}" alt="" referrerpolicy="no-referrer" />`;
  } else {
    avatar.textContent = (AUTH.nombre || AUTH.email || '?').trim().charAt(0).toUpperCase();
  }
}

function _mostrarErrorAcceso(msg) {
  const caja = document.getElementById('authError');
  if (caja) { caja.textContent = msg; caja.style.display = 'block'; }
  else showToast(msg);
}

// ============================================================
// CONECTAR / DESCONECTAR GOOGLE
// ============================================================

async function conectarGoogle() {
  try {
    await AUTH.loginGoogle();
    renderSesion();
    showToast('Google conectado. Ya puedes revisar el correo.');
  } catch (e) {
    // Cerrar el popup no es un error que merezca un mensaje.
    if (e?.code === 'auth/popup-closed-by-user' || e?.code === 'auth/cancelled-popup-request') return;
    if (e?.code === 'auth/popup-blocked') {
      _mostrarErrorAcceso('El navegador bloqueó la ventana de Google. Permite las ventanas emergentes para este sitio.');
      return;
    }
    console.error('Error de acceso:', e);
    _mostrarErrorAcceso('No se pudo conectar con Google. Revisa la conexión e inténtalo de nuevo.');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btnConectarGoogle')?.addEventListener('click', conectarGoogle);

  document.getElementById('btnLogout')?.addEventListener('click', async () => {
    // Desconectar Google ya **no** toca los datos: viven en el archivo del
    // disco, no en la nube. Lo único que se pierde es el acceso al correo, así
    // que tampoco hace falta vaciar `localStorage` —hacerlo borraría la caché
    // de trabajo por una acción que no tiene nada que ver con ella—.
    if (!confirm('¿Desconectar Google? Los trámites no se tocan; solo dejarán de funcionar el correo y los adjuntos.')) return;
    await AUTH.logout();
    renderSesion();
    showToast('Google desconectado.');
  });
});
