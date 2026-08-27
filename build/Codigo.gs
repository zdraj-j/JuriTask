/**
 * JuriTask — Codigo.gs
 * Punto de entrada de la web app.
 */

function doGet() {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('JuriTask')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/**
 * Inserta un fichero .html del proyecto **sin evaluar sus scriptlets**.
 *
 * Es lo que permite que el código con "<?xml …?>" (xlsx.js escribe XML) viaje
 * intacto: `createHtmlOutputFromFile` devuelve el contenido tal cual, mientras
 * que `createTemplateFromFile` intentaría interpretarlo y fallaría.
 */
function include(nombre) {
  return HtmlService.createHtmlOutputFromFile(nombre).getContent();
}

/**
 * Token OAuth del usuario que despliega, para que el cliente hable con las
 * APIs de Google sin popup. Lo consume `ensureGoogleToken()` (js/google-auth.js).
 */
function getOAuthToken() {
  return ScriptApp.getOAuthToken();
}
