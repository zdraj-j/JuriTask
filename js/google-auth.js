/**
 * JuriTask — google-auth.js
 * Punto único de obtención del token OAuth de Google (Gmail, Drive).
 *
 * El token sale de la sesión de Firebase: `signInWithPopup` con el proveedor de
 * Google devuelve, junto a las credenciales de Firebase, un `accessToken` de
 * Google con los scopes que se pidieron. Ese es el que aceptan las APIs de
 * Gmail y el selector de Drive.
 *
 * El detalle que importa: **Firebase no lo guarda ni lo renueva.** Solo llega
 * en el momento del login, y caduca en torno a una hora. Cuando Gmail responde
 * 401, `resetGoogleToken()` lo borra y la siguiente llamada abre otra vez el
 * popup de Google para conseguir uno nuevo, sin tocar la sesión de Firebase.
 *
 * Por eso todo pasa por aquí y nadie lee `AUTH.googleAccessToken` directamente:
 * así el reintento vive en un solo sitio. Ver docs/google-auth.md.
 */

const GOOGLE = {
  get accessToken() { return (typeof AUTH !== 'undefined' && AUTH.googleAccessToken) || null; },
};

let _pidiendoToken = null;

async function ensureGoogleToken() {
  if (typeof AUTH === 'undefined' || !AUTH.activa) {
    showToast('Inicia sesión para acceder al correo.');
    return null;
  }
  if (AUTH.googleAccessToken) return AUTH.googleAccessToken;

  // Un solo popup aunque varios módulos pidan el token a la vez: dos
  // `reauthenticateWithPopup` simultáneos se cancelan entre sí.
  if (_pidiendoToken) return _pidiendoToken;

  _pidiendoToken = AUTH.refrescarTokenGoogle()
    .catch(e => {
      if (e?.code === 'auth/popup-blocked') {
        showToast('El navegador bloqueó la ventana de Google. Permite las ventanas emergentes.');
      } else if (e?.code !== 'auth/popup-closed-by-user' && e?.code !== 'auth/cancelled-popup-request') {
        console.warn('No se pudo obtener el token de Google:', e);
        showToast('No se pudo obtener el permiso de Google.');
      }
      return null;
    })
    .finally(() => { _pidiendoToken = null; });

  return _pidiendoToken;
}

/** Invalidar el token cacheado ante un 401. */
function resetGoogleToken() {
  if (typeof AUTH !== 'undefined') AUTH.googleAccessToken = null;
}
