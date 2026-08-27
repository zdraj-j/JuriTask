/**
 * JuriTask — google-auth.js
 * Punto único de obtención del token OAuth de Google (Gmail, Drive, Calendar).
 *
 * Hasta ahora lo daba Firebase Auth con `reauthenticateWithPopup`. Al retirar
 * Firebase, el navegador se queda sin forma de pedirlo, y no tiene sentido
 * montar un segundo mecanismo de OAuth de cliente: el sustituto es el servidor
 * de Apps Script, que se autoriza una sola vez y expone el token con
 * `ScriptApp.getOAuthToken()`.
 *
 * Mientras llega esa fase, `ensureGoogleToken()` avisa y devuelve null. Todo lo
 * que cuelga de él —búsqueda y parseo de correos, plantillas, prompts— sigue
 * intacto, que es justo lo que se porta al servidor.
 */

const GOOGLE = {
  accessToken: null,   // lo llenará `google.script.run` en la Fase 4
};

async function ensureGoogleToken() {
  if (GOOGLE.accessToken) return GOOGLE.accessToken;
  showToast('El acceso al correo se está trasladando al servidor. Aún no disponible.');
  return null;
}

// Invalidar el token cacheado ante un 401.
function resetGoogleToken() {
  GOOGLE.accessToken = null;
}
