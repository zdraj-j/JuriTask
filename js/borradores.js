/**
 * JuriTask — borradores.js
 * Fase 4 y 5:
 *   · Borradores de correo por tarea (requerimientos, reiteraciones, actas…).
 *   · Bitácora de actividades a partir de los correos ENVIADOS, en lenguaje
 *     neutro, lista para copiar al aplicativo de la empresa.
 *
 * Todo se genera con Gemini a partir de las plantillas institucionales
 * (plantillas-correo.js) y del hilo real del trámite en Gmail. Nada se envía
 * ni se registra automáticamente: siempre se muestra para revisar y copiar.
 */

// ============================================================
// BORRADOR DE CORREO PARA UNA TAREA
// ============================================================

function _resumenHilo(emails, max = 8) {
  return emails.slice(-max).map((e, i) =>
`--- Correo ${i + 1} ---
Fecha: ${e.fecha}
De: ${e.de}
Asunto: ${e.asunto}
Cuerpo: ${e.cuerpo}`).join('\n');
}

function _promptBorrador(t, act, plantilla, emails) {
  const radicado = _extractRadicado(t);
  const doc      = docDeModulo(t.modulo);
  const polizas  = llevaPolizas(t.modulo);

  return `Eres el asistente del área Jurídica de Comfenalco Valle. Redactas correos de seguimiento de trámites.

DATOS DEL TRÁMITE
- Número: ${t.numero}${radicado ? ' (radicado ' + radicado + ')' : ''}
- Módulo: ${t.modulo} — el documento se denomina "${doc}"
- Descripción: ${t.descripcion || '(sin descripción)'}
- Tarea a realizar hoy: "${act.descripcion}"
- Gestión: ${plantilla ? plantilla.etiqueta : 'requerimiento'}
${polizas ? '' : '- En este módulo normalmente NO se solicitan pólizas: omite toda mención a pólizas.\n'}
${plantilla && plantilla.cuerpo ? `TEXTO BASE INSTITUCIONAL (respétalo casi literal; ajusta solo lo necesario para dar coherencia con el hilo):
"""
${plantilla.cuerpo}
"""` : 'No hay texto base: redacta el correo en el mismo estilo formal, breve y cortés de la entidad.'}

HILO DE CORREOS DEL TRÁMITE (del más antiguo al más reciente):
${emails.length ? _resumenHilo(emails) : '(no se encontraron correos previos)'}

INSTRUCCIONES
1. Revisa el hilo y el ÚLTIMO correo antes de redactar: el borrador debe tener coherencia con lo que ya ocurrió.
2. Si en el hilo ya se recibió parte de lo solicitado (por ejemplo ya enviaron pólizas o el correo del representante legal), NO lo vuelvas a pedir: pide solo lo que falta.
3. Sustituye los datos variables (nombres, fechas, documento) por los reales del hilo. No inventes datos.
4. Destinatario: deduce del hilo a quién va dirigido (contratista, área solicitante, centro de conciliación).
5. Mantén el tono formal e institucional. No agregues firma ni datos de contacto.

Responde SOLO con JSON:
{
  "para": "correo(s) del destinatario deducidos del hilo, o '' si no es claro",
  "asunto": "asunto del correo (incluye el número de trámite ${t.numero})",
  "cuerpo": "cuerpo del correo listo para enviar",
  "advertencia": "una frase corta si algo del hilo exige tu atención (por ejemplo que ya respondieron), o cadena vacía"
}`;
}

async function generarBorradorTarea(t, act, btn) {
  if (!geminiConfigured()) { showToast('Configura tu API key de Gemini en Ajustes.'); return; }

  const tipo = tipoGestionDesdeTarea(act.descripcion);
  if (!tipo) {
    showToast('Esta tarea no parece un requerimiento (usa "1er req", "reiterar sol", etc.).');
    return;
  }

  const orig = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '…'; }
  try {
    const emails = await fetchEmailsForTramite(t);
    if (emails === null) return;                     // error de Gmail (ya avisado)

    const plantilla = plantillaPara(t.modulo, tipo);

    // "reiterar sol": si el área ya respondió enviando lo solicitado, no se reitera.
    const res = await geminiGenerateJSON(
      _promptBorrador(t, act, plantilla, emails) +
      (tipo === 'reiterarSol'
        ? '\n\nIMPORTANTE: si en el hilo el área YA respondió enviando lo que el abogado solicitó, responde {"para":"","asunto":"","cuerpo":"","advertencia":"YA_RESPONDIDO: el área ya envió lo solicitado; no es necesario reiterar."}'
        : '')
    );
    if (!res) return;                                // error de Gemini (ya avisado)

    if (/^YA_RESPONDIDO/.test(res.advertencia || '')) {
      showToast('El área ya respondió a la solicitud: no hace falta reiterar.');
      return;
    }
    _abrirModalBorrador(t, act, res, plantilla);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = orig; }
  }
}

// ── Modal del borrador ───────────────────────────────────────
let _borradorModalEl = null;

function _buildBorradorModal() {
  if (_borradorModalEl) return _borradorModalEl;
  const el = document.createElement('div');
  el.id = 'borradorOverlay';
  el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;z-index:1200;padding:16px';
  el.innerHTML = `
    <div style="background:var(--card,#fff);color:var(--text,#111);max-width:680px;width:100%;max-height:88vh;overflow:auto;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid var(--border,#e5e7eb)">
        <h2 id="borradorTitulo" style="margin:0;font-size:17px">Borrador de correo</h2>
        <button id="borradorClose" class="btn-icon" aria-label="Cerrar" style="font-size:20px;line-height:1">✕</button>
      </div>
      <div id="borradorBody" style="padding:14px 18px"></div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', e => { if (e.target === el) el.style.display = 'none'; });
  el.querySelector('#borradorClose').addEventListener('click', () => { el.style.display = 'none'; });
  _borradorModalEl = el;
  return el;
}

function _copiar(texto, msg) {
  navigator.clipboard.writeText(texto)
    .then(() => showToast(msg || 'Copiado.'))
    .catch(() => showToast('No se pudo copiar.'));
}

function _abrirModalBorrador(t, act, res, plantilla) {
  const el = _buildBorradorModal();
  el.querySelector('#borradorTitulo').textContent =
    `${plantilla ? plantilla.etiqueta : 'Borrador'} — #${t.numero}`;

  const body = el.querySelector('#borradorBody');
  const adv = res.advertencia && !/^YA_RESPONDIDO/.test(res.advertencia)
    ? `<div style="background:#fef3c7;color:#92400e;border-radius:8px;padding:8px 10px;font-size:12.5px;margin-bottom:10px">${escapeHtml(res.advertencia)}</div>`
    : '';

  body.innerHTML = `
    ${adv}
    <div class="form-group" style="margin-bottom:10px">
      <label style="font-size:12px">Para</label>
      <input type="text" id="borradorPara" value="${escapeAttr(res.para || '')}" />
    </div>
    <div class="form-group" style="margin-bottom:10px">
      <label style="font-size:12px">Asunto</label>
      <input type="text" id="borradorAsunto" value="${escapeAttr(res.asunto || '')}" />
    </div>
    <div class="form-group" style="margin-bottom:12px">
      <label style="font-size:12px">Cuerpo</label>
      <textarea id="borradorCuerpo" rows="14" style="width:100%;font-family:inherit;font-size:13px;line-height:1.5">${escapeHtml(res.cuerpo || '').replace(/<br>/g, '\n')}</textarea>
    </div>
    <div class="config-btns-row">
      <button class="btn btn-primary" id="borradorCopiarCuerpo">Copiar cuerpo</button>
      <button class="btn-small" id="borradorCopiarTodo">Copiar todo</button>
      <button class="btn-small" id="borradorAbrirGmail">Abrir en Gmail</button>
    </div>
    <p style="font-size:11.5px;color:var(--text-secondary);margin-top:10px">Revisa siempre el texto antes de enviarlo. JuriTask no envía correos automáticamente.</p>`;

  const getCuerpo = () => body.querySelector('#borradorCuerpo').value;
  const getPara   = () => body.querySelector('#borradorPara').value;
  const getAsunto = () => body.querySelector('#borradorAsunto').value;

  body.querySelector('#borradorCopiarCuerpo').addEventListener('click', () => _copiar(getCuerpo(), 'Cuerpo copiado.'));
  body.querySelector('#borradorCopiarTodo').addEventListener('click', () =>
    _copiar(`Para: ${getPara()}\nAsunto: ${getAsunto()}\n\n${getCuerpo()}`, 'Borrador copiado.'));
  body.querySelector('#borradorAbrirGmail').addEventListener('click', () => {
    const url = 'https://mail.google.com/mail/?view=cm&fs=1'
      + '&to='  + encodeURIComponent(getPara())
      + '&su='  + encodeURIComponent(getAsunto())
      + '&body=' + encodeURIComponent(getCuerpo());
    window.open(url, '_blank', 'noopener');
  });

  el.style.display = 'flex';
}

// ============================================================
// BITÁCORA DESDE LOS CORREOS ENVIADOS
// ============================================================

// Extrae posibles números de trámite del asunto (5-6 dígitos o radicado).
function _numerosEnAsunto(asunto) {
  const s = String(asunto || '');
  const nums = new Set();
  (s.match(/\b\d{5,6}\b/g) || []).forEach(n => nums.add(n));
  (s.match(/\b[A-Za-z]{2,5}-\d{4}-\d+\b/g) || []).forEach(n => nums.add(n));
  return [...nums];
}

// Busca correos enviados recientemente que correspondan a trámites activos.
async function scanSentForBitacora(dias = 7) {
  const activos = (STATE.tramites || []).filter(t => !t.terminado);
  if (!activos.length) return [];

  const porNumero = new Map();
  activos.forEach(t => {
    porNumero.set(String(t.numero), t);
    const r = _extractRadicado(t);
    if (r) porNumero.set(r, t);
  });

  return _withGmailToken(async (token) => {
    const q = `in:sent newer_than:${dias}d`;
    const data = await _gmailFetch('messages?maxResults=25&q=' + encodeURIComponent(q), token);
    const refs = data.messages || [];
    const hits = [];
    const yaRegistrados = new Set(STATE.config.bitacoraRegistrados || []);

    for (const ref of refs) {
      const msg = await _getMessage(ref.id, token);
      const payload = msg.payload || {};
      const asunto = _stripHtml(_headerValue(payload, 'Subject'));
      const nums = _numerosEnAsunto(asunto);
      const t = nums.map(n => porNumero.get(n)).find(Boolean);
      if (!t) continue;
      if (yaRegistrados.has(ref.id)) continue;    // ya se generó su bitácora

      hits.push({
        messageId: ref.id,
        threadId:  msg.threadId,
        tramite:   t,
        fecha:     _headerValue(payload, 'Date'),
        para:      _stripHtml(_headerValue(payload, 'To')),
        asunto,
        cuerpo:    _stripHtml(_extractBody(payload)).slice(0, 1500),
      });
    }
    return hits;
  });
}

// Trae el correo anterior del hilo (el del tercero al que se responde).
async function _correoPrevioDelHilo(threadId, messageId) {
  return _withGmailToken(async (token) => {
    const data = await _gmailFetch('threads/' + threadId + '?format=full', token);
    const msgs = (data.messages || []).filter(m => m.id !== messageId);
    if (!msgs.length) return null;
    const prev = msgs[msgs.length - 1];
    const payload = prev.payload || {};
    return {
      de:     _stripHtml(_headerValue(payload, 'From')),
      asunto: _stripHtml(_headerValue(payload, 'Subject')),
      cuerpo: _stripHtml(_extractBody(payload)).slice(0, 1200),
    };
  });
}

function _promptBitacoraEnvio(hit, previo) {
  return `Eres el asistente del área Jurídica de Comfenalco Valle. Redactas el registro de actividades (bitácora) que se consigna en el aplicativo interno de la empresa.

TRÁMITE ${hit.tramite.numero} — módulo ${hit.tramite.modulo} (${docDeModulo(hit.tramite.modulo)})

${previo ? `CORREO RECIBIDO PREVIAMENTE
De: ${previo.de}
Asunto: ${previo.asunto}
Cuerpo: ${previo.cuerpo}
` : ''}
CORREO QUE YO ENVIÉ
Para: ${hit.para}
Asunto: ${hit.asunto}
Cuerpo: ${hit.cuerpo}

INSTRUCCIONES
- Redacta UNA sola anotación breve (1-2 frases), en lenguaje neutro e impersonal ("se realiza…", "se solicita…", "se remite…").
- Describe QUÉ se solicitó o se informó. Ejemplo de estilo: "Se realiza primer requerimiento al contratista solicitando su aprobación del contrato, indicar el correo del representante legal y enviar las pólizas".
${previo ? '- Como se está respondiendo a un tercero, resume ambos en conjunto. Ejemplo: "El contratista solicita X, por tanto se le remite Y".' : ''}
- No incluyas fechas, saludos, firmas ni nombres de correo. No uses primera persona.

Responde SOLO con JSON: { "bitacora": "texto de la anotación" }`;
}

async function generarBitacoraEnvio(hit) {
  const previo = await _correoPrevioDelHilo(hit.threadId, hit.messageId);
  const res = await geminiGenerateJSON(_promptBitacoraEnvio(hit, previo));
  return res && res.bitacora ? String(res.bitacora).trim() : null;
}

// Marca un correo como ya registrado para no volver a proponerlo.
function _marcarBitacoraRegistrada(messageId) {
  STATE.config.bitacoraRegistrados = STATE.config.bitacoraRegistrados || [];
  if (!STATE.config.bitacoraRegistrados.includes(messageId)) {
    STATE.config.bitacoraRegistrados.push(messageId);
    // Conservar solo los últimos 300 para no inflar la config.
    if (STATE.config.bitacoraRegistrados.length > 300) {
      STATE.config.bitacoraRegistrados = STATE.config.bitacoraRegistrados.slice(-300);
    }
    if (typeof saveAll === 'function') saveAll();
  }
}

// ── Panel de bitácoras pendientes ────────────────────────────
let _bitacoraModalEl = null;

function _buildBitacoraModal() {
  if (_bitacoraModalEl) return _bitacoraModalEl;
  const el = document.createElement('div');
  el.id = 'bitacoraEnvioOverlay';
  el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;z-index:1200;padding:16px';
  el.innerHTML = `
    <div style="background:var(--card,#fff);color:var(--text,#111);max-width:680px;width:100%;max-height:88vh;overflow:auto;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid var(--border,#e5e7eb)">
        <h2 style="margin:0;font-size:17px">Actividades por registrar</h2>
        <button id="bitacoraEnvioClose" class="btn-icon" aria-label="Cerrar" style="font-size:20px;line-height:1">✕</button>
      </div>
      <div id="bitacoraEnvioBody" style="padding:14px 18px"></div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', e => { if (e.target === el) el.style.display = 'none'; });
  el.querySelector('#bitacoraEnvioClose').addEventListener('click', () => { el.style.display = 'none'; });
  _bitacoraModalEl = el;
  return el;
}

async function runBitacoraScan(btn) {
  if (!geminiConfigured()) { showToast('Configura tu API key de Gemini en Ajustes.'); return; }
  const orig = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '…'; }
  showToast('Revisando correos enviados…');

  try {
    const hits = await scanSentForBitacora(STATE.config.bitacoraDias || 7);
    if (hits === null) return;

    const el = _buildBitacoraModal();
    const body = el.querySelector('#bitacoraEnvioBody');
    el.style.display = 'flex';

    if (!hits.length) {
      _updateBitacoraBadge(0);
      body.innerHTML = `<p style="margin:8px 0 4px;color:var(--text-secondary)">No hay correos enviados pendientes de registrar. 🎉</p>`;
      return;
    }
    _updateBitacoraBadge(hits.length);

    body.innerHTML = `<p style="margin:0 0 12px;color:var(--text-secondary);font-size:13px">
        ${hits.length} correo(s) enviado(s) de trámites activos. Genera el texto y cópialo al aplicativo de la empresa.</p>
      <div id="bitacoraEnvioList" style="display:flex;flex-direction:column;gap:10px"></div>`;
    const list = body.querySelector('#bitacoraEnvioList');

    hits.forEach(hit => {
      const card = document.createElement('div');
      card.dataset.card = '1';
      card.style.cssText = 'border:1px solid var(--border,#e5e7eb);border-radius:10px;padding:12px 14px';
      card.innerHTML = `
        <div style="font-weight:700;font-size:13.5px">#${escapeHtml(hit.tramite.numero)}
          <span style="font-weight:500;color:var(--text-secondary)">· ${escapeHtml(hit.tramite.modulo || '')}</span></div>
        <div style="font-size:12px;color:var(--text-secondary);margin:3px 0 8px">${escapeHtml(hit.asunto)}</div>
        <div data-out></div>
        <div class="config-btns-row" style="margin-top:8px">
          <button class="btn btn-primary" data-act="gen" style="font-size:12.5px;padding:6px 11px">Generar anotación</button>
          <button class="btn-small" data-act="omitir" style="font-size:12px">Omitir</button>
        </div>`;

      const out = card.querySelector('[data-out]');
      card.querySelector('[data-act="gen"]').addEventListener('click', async e => {
        const b = e.currentTarget; const t0 = b.innerHTML;
        b.disabled = true; b.innerHTML = 'Generando…';
        try {
          const texto = await generarBitacoraEnvio(hit);
          if (!texto) return;
          out.innerHTML = `<textarea rows="3" style="width:100%;font-family:inherit;font-size:13px;line-height:1.45">${escapeHtml(texto)}</textarea>`;
          b.innerHTML = 'Regenerar';
          if (!card.querySelector('[data-act="copiar"]')) {
            const copyBtn = document.createElement('button');
            copyBtn.className = 'btn-small';
            copyBtn.dataset.act = 'copiar';
            copyBtn.style.fontSize = '12px';
            copyBtn.textContent = 'Copiar y marcar registrada';
            copyBtn.addEventListener('click', () => {
              _copiar(out.querySelector('textarea').value, 'Anotación copiada.');
              _marcarBitacoraRegistrada(hit.messageId);
              card.remove();
              _updateBitacoraBadge(list.querySelectorAll('[data-card]').length);
              if (!list.querySelector('[data-card]')) {
                body.innerHTML = `<p style="margin:8px 0 4px;color:var(--text-secondary)">No quedan actividades por registrar. 🎉</p>`;
              }
            });
            card.querySelector('.config-btns-row').appendChild(copyBtn);
          }
        } finally {
          b.disabled = false;
          if (b.innerHTML === 'Generando…') b.innerHTML = t0;
        }
      });
      card.querySelector('[data-act="omitir"]').addEventListener('click', () => {
        _marcarBitacoraRegistrada(hit.messageId);
        card.remove();
        if (!list.querySelector('[data-card]')) {
          body.innerHTML = `<p style="margin:8px 0 4px;color:var(--text-secondary)">No quedan actividades por registrar. 🎉</p>`;
        }
      });
      list.appendChild(card);
    });
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = orig; }
  }
}

// ============================================================
// AUDIENCIAS — detectar fecha en el correo y agendar en Calendar
// ============================================================
// Requiere el scope calendar.events y la Calendar API habilitada en el
// proyecto de Google Cloud. La reunión dura 3 horas desde la hora de inicio.

async function _ensureCalendarToken() {
  if (AUTH._calendarAccessToken) return AUTH._calendarAccessToken;
  const user = (typeof auth !== 'undefined') ? auth.currentUser : null;
  if (!user) return null;
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/calendar.events');
    provider.addScope('https://www.googleapis.com/auth/gmail.readonly');
    const result = await user.reauthenticateWithPopup(provider);
    if (result.credential && result.credential.accessToken) {
      AUTH._calendarAccessToken = result.credential.accessToken;
      AUTH._gmailAccessToken    = result.credential.accessToken;
      return AUTH._calendarAccessToken;
    }
  } catch (e) {
    if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return null;
    showToast('No se pudo acceder al calendario: ' + (e.code || e.message));
  }
  return null;
}

// Pregunta a Gemini por la fecha/hora de la audiencia dentro del hilo.
async function detectarAudiencia(t, emails) {
  const prompt = `Analiza estos correos de un trámite jurídico y determina si citan a una AUDIENCIA (conciliación, diligencia o similar).

TRÁMITE ${t.numero} — ${t.descripcion || ''}

CORREOS:
${_resumenHilo(emails, 10)}

Responde SOLO con JSON:
{
  "hay_audiencia": true/false,
  "fecha": "YYYY-MM-DD o ''",
  "hora": "HH:MM en formato 24h o ''",
  "lugar": "lugar o enlace de la audiencia, o ''",
  "asunto": "descripción breve (por ejemplo: Audiencia de conciliación — proceso de X)"
}
No inventes datos: si la fecha u hora no aparecen explícitamente, deja el campo vacío.`;
  return geminiGenerateJSON(prompt);
}

// Crea el evento de 3 horas en Google Calendar e invita al abogado responsable.
async function crearEventoAudiencia(t, info) {
  const token = await _ensureCalendarToken();
  if (!token) return null;

  const inicio = new Date(`${info.fecha}T${info.hora || '09:00'}:00`);
  if (isNaN(inicio.getTime())) { showToast('La fecha/hora de la audiencia no es válida.'); return null; }
  const fin = new Date(inicio.getTime() + 3 * 60 * 60 * 1000);   // 3 horas

  // Invitar al abogado responsable si su clave es un uid con correo conocido.
  const invitados = [];
  const uid = t.abogado || (t.sharedWith || [])[0];
  if (uid && typeof _teamMembers !== 'undefined') {
    const m = _teamMembers.find(x => x.uid === uid);
    if (m && m.email) invitados.push({ email: m.email });
  }

  const evento = {
    summary: info.asunto || `Audiencia — trámite ${t.numero}`,
    description: `Trámite ${t.numero} · ${t.modulo || ''}\n${t.descripcion || ''}`,
    location: info.lugar || '',
    start: { dateTime: inicio.toISOString() },
    end:   { dateTime: fin.toISOString() },
    attendees: invitados,
  };

  try {
    const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(evento),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.warn('Calendar error', res.status, txt);
      showToast(res.status === 403
        ? 'Habilita la Calendar API en Google Cloud para agendar audiencias.'
        : 'No se pudo crear el evento: ' + res.status);
      return null;
    }
    return res.json();
  } catch (e) {
    showToast('No se pudo conectar con Google Calendar.');
    return null;
  }
}

// Flujo completo: buscar la audiencia en el correo y ofrecer agendarla.
async function agendarAudienciaDesdeCorreo(t, btn) {
  if (!geminiConfigured()) { showToast('Configura tu API key de Gemini en Ajustes.'); return; }
  const orig = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = 'Buscando audiencia…'; }
  try {
    const emails = await fetchEmailsForTramite(t);
    if (emails === null) return;
    if (!emails.length) { showToast('No encontré correos de este trámite.'); return; }

    const info = await detectarAudiencia(t, emails);
    if (!info) return;
    if (!info.hay_audiencia || !info.fecha) {
      showToast('No encontré una fecha de audiencia en el correo.');
      return;
    }

    const cuando = `${formatDate(info.fecha)}${info.hora ? ' a las ' + info.hora : ''}`;
    const ok = await showConfirm(
      `Audiencia detectada: ${cuando}. ¿Crear el evento de 3 horas en tu calendario?`,
      { confirmLabel: 'Agendar' });
    if (!ok) return;

    const ev = await crearEventoAudiencia(t, info);
    if (!ev) return;

    t.audienciaFecha = info.fecha;
    t.audienciaHora  = info.hora || '';
    if (typeof saveTramiteFS === 'function') saveTramiteFS(t);
    if (typeof saveAll === 'function') saveAll();
    showToast(`Audiencia agendada para el ${cuando}.`);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = orig; }
  }
}

// ============================================================
// VIGILANCIA AUTOMÁTICA DE CORREOS ENVIADOS
// ============================================================
// Sin backend no es posible que Gmail "avise" a la app estando cerrada, así que
// mientras JuriTask esté abierto se revisan los enviados cada pocos minutos y
// se marca el botón con el número de actividades por registrar.
// Solo consume Gmail API (gratis): Gemini se llama al pulsar "Generar".

let _bitacoraTimer = null;

function _updateBitacoraBadge(n) {
  const btn = document.getElementById('bitacoraScanBtn');
  if (!btn) return;
  let badge = btn.querySelector('.bitacora-badge');
  if (!n) { if (badge) badge.remove(); return; }
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'notif-badge bitacora-badge';
    btn.style.position = 'relative';
    btn.appendChild(badge);
  }
  badge.textContent = n > 99 ? '99+' : String(n);
  badge.style.display = '';
}

// Revisión silenciosa: no abre ventanas ni pide permisos (si no hay token
// vigente simplemente no hace nada hasta que el usuario use el correo una vez).
async function checkBitacoraPendientes({ silencioso = true } = {}) {
  if (STATE.config.bitacoraAuto === false) return;
  if (!AUTH || !AUTH._gmailAccessToken) return;      // sin permiso activo aún
  if (!(STATE.tramites || []).some(t => !t.terminado)) return;

  try {
    const hits = await scanSentForBitacora(STATE.config.bitacoraDias || 7);
    if (!hits || !hits.length) { _updateBitacoraBadge(0); return; }

    _updateBitacoraBadge(hits.length);

    // Avisar una sola vez por lote nuevo.
    const firma = hits.map(h => h.messageId).sort().join(',');
    if (!silencioso || firma !== _bitacoraUltimaFirma) {
      _bitacoraUltimaFirma = firma;
      showToast(`${hits.length} correo(s) enviado(s) por registrar en el aplicativo.`);
    }
  } catch (e) {
    // Silencioso: un fallo de red no debe molestar al usuario.
    console.warn('Vigilancia de bitácora:', e && (e.code || e.message));
  }
}

let _bitacoraUltimaFirma = '';

function startBitacoraWatcher() {
  stopBitacoraWatcher();
  const minutos = parseInt(STATE.config.bitacoraIntervalo) || 10;
  _bitacoraTimer = setInterval(() => checkBitacoraPendientes(), minutos * 60 * 1000);
  // Revisar también al volver a la pestaña (típico tras enviar un correo).
  document.addEventListener('visibilitychange', _onVisibleCheck);
}

function _onVisibleCheck() {
  if (document.visibilityState === 'visible') checkBitacoraPendientes();
}

function stopBitacoraWatcher() {
  if (_bitacoraTimer) { clearInterval(_bitacoraTimer); _bitacoraTimer = null; }
  document.removeEventListener('visibilitychange', _onVisibleCheck);
  _updateBitacoraBadge(0);
}

// ── Enganche del botón de bitácora ───────────────────────────
function initBitacoraScan() {
  const btn = document.getElementById('bitacoraScanBtn');
  if (btn && !btn.dataset.wired) {
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => runBitacoraScan(btn));
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initBitacoraScan);
  else initBitacoraScan();
}
