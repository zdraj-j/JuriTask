/**
 * JuriTask — gemini.js
 * Cliente mínimo de la API de Gemini (Google AI Studio).
 *
 * La API key NO vive en el repositorio: se lee de STATE.config.geminiApiKey,
 * que el usuario pega en Ajustes y se guarda en su Firestore privado.
 *
 * IMPORTANTE (seguridad): al ser una app sin backend, la key viaja al
 * navegador. Restríngela en Google Cloud por referrer (tu dominio) y por API
 * ("Generative Language API"). Ver docs/gmail-integracion.md.
 */

const GEMINI_MODEL = 'gemini-2.0-flash';

function geminiConfigured() {
  return !!(STATE && STATE.config && STATE.config.geminiApiKey);
}

// Llama a Gemini y devuelve el texto generado (o null si falla).
async function geminiGenerate(promptText, { json = false } = {}) {
  const key = STATE.config && STATE.config.geminiApiKey;
  if (!key) { showToast('Configura tu API key de Gemini en Ajustes.'); return null; }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    contents: [{ parts: [{ text: promptText }] }],
    generationConfig: json ? { responseMimeType: 'application/json', temperature: 0.2 } : { temperature: 0.3 },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.warn('Gemini error', res.status, txt);
      if (res.status === 400 && /API_?KEY|invalid/i.test(txt)) showToast('La API key de Gemini no es válida o está mal configurada.');
      else if (res.status === 403)  showToast('Gemini rechazó la clave (revisa las restricciones de referrer/API).');
      else if (res.status === 429)  showToast('Límite de uso de Gemini alcanzado. Intenta más tarde.');
      else showToast('Error de Gemini: ' + res.status);
      return null;
    }
    const data = await res.json();
    const parts = data && data.candidates && data.candidates[0] &&
                  data.candidates[0].content && data.candidates[0].content.parts;
    return Array.isArray(parts) ? parts.map(p => p.text || '').join('') : '';
  } catch (e) {
    console.warn('Gemini fetch fail', e);
    showToast('No se pudo conectar con Gemini.');
    return null;
  }
}

// Igual que geminiGenerate pero parsea la respuesta como JSON.
async function geminiGenerateJSON(promptText) {
  const txt = await geminiGenerate(promptText, { json: true });
  if (!txt) return null;
  try {
    return JSON.parse(txt);
  } catch (_) {
    // Rescate: extraer el primer objeto {...} del texto.
    const m = txt.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch (__) {} }
    console.warn('Gemini: respuesta no es JSON válido:', txt.slice(0, 300));
    return null;
  }
}
