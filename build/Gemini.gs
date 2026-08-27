/**
 * JuriTask — Gemini.gs
 * Cliente de la API de Gemini, del lado del servidor.
 *
 * El motivo de que esto viva aquí y no en el navegador es la **clave**. Una app
 * sin backend no puede ocultar un secreto: la key viajaba al cliente y se
 * guardaba junto a los datos. Ahora vive en Script Properties, no sale del
 * servidor y no aparece en el JSON de Drive.
 */

const JT_GEMINI_MODELO = 'gemini-2.0-flash';
const JT_GEMINI_CLAVE  = 'GEMINI_API_KEY';

function hayGeminiKey() {
  return !!PropertiesService.getScriptProperties().getProperty(JT_GEMINI_CLAVE);
}

function guardarGeminiKey(key) {
  const props = PropertiesService.getScriptProperties();
  const limpia = String(key || '').trim();
  if (!limpia) { props.deleteProperty(JT_GEMINI_CLAVE); return { ok: true, configurada: false }; }
  props.setProperty(JT_GEMINI_CLAVE, limpia);
  return { ok: true, configurada: true };
}

/**
 * Llama a Gemini y devuelve el texto generado.
 *
 * Lanza en caso de error para que `withFailureHandler` del cliente lo reciba
 * como excepción; el mensaje se traduce a algo legible antes de salir, porque
 * el usuario no ve los logs del servidor.
 */
function geminiGenerar(promptText, comoJson) {
  const key = PropertiesService.getScriptProperties().getProperty(JT_GEMINI_CLAVE);
  if (!key) throw new Error('Falta la API key de Gemini. Configúrala en Ajustes.');

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
              JT_GEMINI_MODELO + ':generateContent?key=' + encodeURIComponent(key);

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: comoJson
        ? { responseMimeType: 'application/json', temperature: 0.2 }
        : { temperature: 0.3 },
    }),
  });

  const codigo = res.getResponseCode();
  const cuerpo = res.getContentText();

  if (codigo !== 200) {
    if (codigo === 400 && /API_?KEY|invalid/i.test(cuerpo)) throw new Error('La API key de Gemini no es válida.');
    if (codigo === 403) throw new Error('Gemini rechazó la clave (revisa sus restricciones).');
    if (codigo === 429) throw new Error('Límite de uso de Gemini alcanzado. Intenta más tarde.');
    throw new Error('Error de Gemini (' + codigo + ')');
  }

  const data  = JSON.parse(cuerpo);
  const cand  = data && data.candidates && data.candidates[0];
  const parts = cand && cand.content && cand.content.parts;
  return Array.isArray(parts) ? parts.map(function (p) { return p.text || ''; }).join('') : '';
}
