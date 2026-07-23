/**
 * JuriTask — gmail.js
 * Fase 1 — Detección de trámites nuevos desde el correo (Google Workspace).
 *
 * Flujo (100% en el navegador, sin backend):
 *   1. El usuario pulsa "Revisar correo".
 *   2. Se obtiene un token de Google con permiso `gmail.readonly`.
 *   3. Se buscan los correos de notificación de trámite (remitente + asunto).
 *   4. Se parsea cada correo y se extraen los campos del "nuevo trámite".
 *   5. Se descartan los que ya existen (por número) y se muestra un panel
 *      de revisión; al confirmar se abre el modal de "nuevo trámite" prellenado.
 *
 * NOTA: no usa IA. Los correos de notificación tienen un formato fijo, así que
 * la extracción es por etiquetas ("Fecha Vencimiento:", "Trámite:", …).
 */

// ── Configuración de la búsqueda ─────────────────────────────
const GMAIL_QUERY = 'from:comjuridico@comfenalcovalle.com.co subject:("Notificación de trámite" OR "Notificacion de tramite") newer_than:120d';

// Alias de prefijo de radicado → sigla de módulo de la app.
// El radicado (p. ej. OTRD-2026-864) trae un prefijo que no siempre coincide
// con la sigla configurada. Aquí se mapean los casos conocidos.
const MODULO_PREFIX_ALIAS = {
  OTRD: 'OTR',
};

// ── Token de Gmail ────────────────────────────────────────────
async function _ensureGmailToken(forceNew = false) {
  if (!forceNew && AUTH._gmailAccessToken) return AUTH._gmailAccessToken;
  const user = (typeof auth !== 'undefined') ? auth.currentUser : null;
  if (!user) return null;
  const hasGoogle = user.providerData.some(p => p.providerId === 'google.com');
  if (!hasGoogle) {
    showToast('Inicia sesión con Google para revisar el correo.');
    return null;
  }
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/gmail.readonly');
    // Conservar el permiso de Drive para no perderlo al re-autenticar.
    provider.addScope('https://www.googleapis.com/auth/drive.file');
    const result = await user.reauthenticateWithPopup(provider);
    if (result.credential && result.credential.accessToken) {
      AUTH._gmailAccessToken = result.credential.accessToken;
      // El token también sirve para Drive (mismo scope pedido).
      AUTH._googleAccessToken = result.credential.accessToken;
      return AUTH._gmailAccessToken;
    }
  } catch (e) {
    if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return null;
    console.warn('Gmail re-auth:', e.code, e.message);
    showToast('No se pudo acceder al correo: ' + (e.code || e.message || 'error'));
  }
  return null;
}

// ── Llamadas a la Gmail API ──────────────────────────────────
async function _gmailFetch(path, token) {
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/' + path, {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (res.status === 401) { const err = new Error('unauthorized'); err.code = 401; throw err; }
  if (!res.ok) { const err = new Error('gmail-http-' + res.status); err.code = res.status; throw err; }
  return res.json();
}

async function _listTramiteMessages(token) {
  const data = await _gmailFetch('messages?maxResults=25&q=' + encodeURIComponent(GMAIL_QUERY), token);
  return data.messages || [];
}

async function _getMessage(id, token) {
  return _gmailFetch('messages/' + id + '?format=full', token);
}

// ── Decodificación de cuerpo ─────────────────────────────────
function _b64urlToText(data) {
  try {
    const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch (_) {
    return '';
  }
}

function _extractBody(payload) {
  let html = '', text = '';
  (function walk(p) {
    if (!p) return;
    if (p.mimeType === 'text/html' && p.body && p.body.data)      html += _b64urlToText(p.body.data);
    else if (p.mimeType === 'text/plain' && p.body && p.body.data) text += _b64urlToText(p.body.data);
    (p.parts || []).forEach(walk);
  })(payload);
  return html || text;
}

function _stripHtml(s) {
  return String(s || '')
    .replace(/<\s*br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|tr|td|span|strong|b|font)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&aacute;/gi, 'á').replace(/&eacute;/gi, 'é').replace(/&iacute;/gi, 'í')
    .replace(/&oacute;/gi, 'ó').replace(/&uacute;/gi, 'ú').replace(/&ntilde;/gi, 'ñ')
    .replace(/\s+/g, ' ')
    .trim();
}

function _headerValue(payload, name) {
  const h = (payload.headers || []).find(x => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

// ── Fecha DD/MM/YYYY → YYYY-MM-DD ─────────────────────────────
function _fechaISOFromDMY(dmy) {
  const m = /([0-3]?\d)\/([01]?\d)\/(\d{4})/.exec(dmy || '');
  if (!m) return '';
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

// ── Normalización de nombres para emparejar abogados ─────────
function _normName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z\s]/g, '').replace(/\s+/g, ' ').trim();
}

// Empareja el "Responsable" del correo con un abogado configurado.
// Devuelve { key, nombre } si lo encuentra; si no, { key:null, nombre } (sugerencia).
function _matchAbogado(responsable) {
  const target = _normName(responsable);
  if (!target) return { key: null, nombre: '' };

  const candidates = [];
  (STATE.config.abogados || []).forEach(a => candidates.push({ key: a.key, nombre: a.nombre }));
  if (typeof _teamMembers !== 'undefined' && Array.isArray(_teamMembers)) {
    _teamMembers.forEach(m => candidates.push({ key: m.uid, nombre: m.displayName || m.email || '' }));
  }

  // Coincidencia exacta normalizada, o por inclusión (nombre config ⊆ responsable
  // o viceversa) para tolerar segundos nombres/apellidos abreviados.
  for (const c of candidates) {
    const cn = _normName(c.nombre);
    if (cn && (cn === target || target.includes(cn) || cn.includes(target))) {
      return { key: c.key, nombre: c.nombre };
    }
  }
  return { key: null, nombre: titleCase(responsable.toLowerCase()) };
}

// Mapea el prefijo del radicado a una sigla de módulo existente.
function _matchModulo(radicado) {
  const prefix = String(radicado || '').split('-')[0].toUpperCase();
  if (!prefix) return '';
  const sigla = MODULO_PREFIX_ALIAS[prefix] || prefix;
  const exists = (STATE.config.modulos || []).some(m => m.sigla === sigla);
  return exists ? sigla : '';
}

// ── Parseo de un correo → objeto de detección ────────────────
function parseTramiteEmail(message) {
  const payload = message.payload || {};
  const rawBody = _extractBody(payload);
  const body    = _stripHtml(rawBody);
  const subject = _stripHtml(_headerValue(payload, 'Subject'));

  const pick = (re, src = body) => { const m = re.exec(src); return m ? m[1].trim() : ''; };

  let radicado = pick(/radicado\s+([A-Za-z]+-\d{4}-\d+)/i);
  if (!radicado) radicado = pick(/([A-Za-z]{2,5}-\d{4}-\d+)/, subject); // fallback: asunto

  const tramiteNum  = pick(/Tr[aá]mite:\s*(\d{4,8})/i);
  const vencDMY     = pick(/vencimiento[:\s]*([0-3]?\d\/[01]?\d\/\d{4})/i);
  const tipo        = pick(/TIPO\s+SOLICITUD:\s*([^/]+?)\s*\/\s*SOLICITANTE:/i);
  const solicitante = pick(/SOLICITANTE:\s*([^/]+?)\s*\/\s*AREA:/i);
  const area        = pick(/AREA:\s*([^/]+?)\s*\/\s*RESUMEN:/i);
  let   resumen     = pick(/RESUMEN:\s*(.+?)\s*Detalles:/i);
  if (!resumen) resumen = pick(/RESUMEN:\s*(.+?)(?:Tr[aá]mite:|$)/i);
  let   responsable = pick(/Responsable:\s*(.+?)\s*Auxiliar:/i);
  if (!responsable) responsable = pick(/Responsable:\s*([A-Za-zÁÉÍÓÚÑáéíóúñ.\s]{3,60})/i);

  // Número del trámite = campo "Trámite:" (no el radicado). Fallback: radicado.
  const numero = tramiteNum || radicado;
  if (!numero) return null; // sin identificador no sirve

  const modulo   = _matchModulo(radicado);
  const abogado  = _matchAbogado(responsable);

  // Descripción: resumen + radicado (para no perderlo).
  const resumenTxt = resumen ? sentenceCase(resumen) : (tipo ? sentenceCase(tipo) : 'Trámite');
  const descripcion = radicado ? `${resumenTxt} [${radicado}]` : resumenTxt;

  // Nota inicial con el detalle completo del correo.
  const notaPartes = [];
  if (radicado)    notaPartes.push(`Radicado: ${radicado}`);
  if (tipo)        notaPartes.push(`Tipo: ${sentenceCase(tipo)}`);
  if (solicitante) notaPartes.push(`Solicitante: ${titleCase(solicitante.toLowerCase())}`);
  if (area)        notaPartes.push(`Área: ${titleCase(area.toLowerCase())}`);
  if (responsable) notaPartes.push(`Responsable: ${titleCase(responsable.toLowerCase())}`);
  const nota = notaPartes.join(' · ');

  return {
    numero,
    radicado,
    modulo,
    descripcion,
    fechaVencimiento: _fechaISOFromDMY(vencDMY),
    responsableNombre: abogado.nombre,
    abogadoKey: abogado.key,
    tipo: sentenceCase(tipo || ''),
    solicitante: titleCase((solicitante || '').toLowerCase()),
    area: titleCase((area || '').toLowerCase()),
    nota,
    _messageId: message.id,
  };
}

// ── Escaneo completo ─────────────────────────────────────────
async function scanTramiteEmails() {
  let token = await _ensureGmailToken();
  if (!token) return null;

  const doScan = async (tk) => {
    const list = await _listTramiteMessages(tk);
    const detections = [];
    for (const ref of list) {
      try {
        const msg = await _getMessage(ref.id, tk);
        const d   = parseTramiteEmail(msg);
        if (d) detections.push(d);
      } catch (e) {
        if (e.code === 401) throw e;
        console.warn('Error parseando correo', ref.id, e.message);
      }
    }
    return detections;
  };

  try {
    return await doScan(token);
  } catch (e) {
    if (e.code === 401) {
      // Token vencido: renovar una vez.
      AUTH._gmailAccessToken = null;
      token = await _ensureGmailToken(true);
      if (!token) return null;
      try { return await doScan(token); }
      catch (e2) { showToast('Error leyendo el correo: ' + (e2.code || e2.message)); return null; }
    }
    showToast('Error leyendo el correo: ' + (e.code || e.message));
    return null;
  }
}

// Quita las detecciones cuyo número ya existe como trámite.
function _filterNuevos(detections) {
  const existentes = new Set((STATE.tramites || []).map(t => String(t.numero)));
  const vistos = new Set();
  return detections.filter(d => {
    const n = String(d.numero);
    if (existentes.has(n) || vistos.has(n)) return false;
    vistos.add(n);
    return true;
  });
}

// ── Prellenar el modal de "nuevo trámite" ────────────────────
function prefillNewTramite(d) {
  if (typeof openModal !== 'function') return;
  openModal();                       // abre el modal en modo "nuevo"
  const set = (id, val) => { const el = document.getElementById(id); if (el != null && val != null) el.value = val; };
  set('fNumero', d.numero);
  set('fDescripcion', d.descripcion);
  if (d.modulo) set('fModulo', d.modulo);
  if (d.fechaVencimiento) set('fFechaVencimiento', d.fechaVencimiento);

  // Nota inicial con el detalle del correo.
  if (d.nota) {
    set('fNota', sentenceCase(d.nota));
    const wrap = document.getElementById('nuevaNotaFieldsModal');
    if (wrap) wrap.style.display = 'block';
  }

  // Abogado: si se emparejó con un colaborador manual, preseleccionarlo.
  if (d.abogadoKey && typeof populateModalAssign === 'function') {
    populateModalAssign([d.abogadoKey]);
  } else if (d.responsableNombre) {
    showToast(`Responsable "${d.responsableNombre}" no está en tu lista — asígnalo o agrégalo.`);
  }
}

// ── Panel de revisión ────────────────────────────────────────
let _gmailModalEl = null;

function _buildGmailModal() {
  if (_gmailModalEl) return _gmailModalEl;
  const el = document.createElement('div');
  el.id = 'gmailScanOverlay';
  el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;z-index:1200;padding:16px';
  el.innerHTML = `
    <div style="background:var(--card,#fff);color:var(--text,#111);max-width:640px;width:100%;max-height:85vh;overflow:auto;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid var(--border,#e5e7eb)">
        <h2 style="margin:0;font-size:17px">Trámites detectados en el correo</h2>
        <button id="gmailScanClose" class="btn-icon" aria-label="Cerrar" style="font-size:20px;line-height:1">✕</button>
      </div>
      <div id="gmailScanBody" style="padding:14px 18px"></div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', e => { if (e.target === el) _closeGmailModal(); });
  el.querySelector('#gmailScanClose').addEventListener('click', _closeGmailModal);
  _gmailModalEl = el;
  return el;
}

function _closeGmailModal() {
  if (_gmailModalEl) _gmailModalEl.style.display = 'none';
}

function _openGmailModal(detections) {
  const el = _buildGmailModal();
  const body = el.querySelector('#gmailScanBody');

  if (!detections.length) {
    body.innerHTML = `<p style="margin:8px 0 4px;color:var(--muted,#6b7280)">No se encontraron trámites nuevos en el correo. 🎉</p>
      <p style="font-size:12px;color:var(--muted,#9ca3af)">Se revisan los correos de "Notificación de trámite" de los últimos 120 días que aún no estén registrados.</p>`;
    el.style.display = 'flex';
    return;
  }

  body.innerHTML = `<p style="margin:0 0 12px;color:var(--muted,#6b7280);font-size:13px">
      Se detectaron <b>${detections.length}</b> trámite(s) nuevo(s). Revisa y crea los que quieras.</p>
    <div id="gmailScanList" style="display:flex;flex-direction:column;gap:10px"></div>`;

  const list = body.querySelector('#gmailScanList');
  detections.forEach((d, i) => {
    const card = document.createElement('div');
    card.style.cssText = 'border:1px solid var(--border,#e5e7eb);border-radius:10px;padding:12px 14px';
    const moduloTxt = d.modulo || '<span style="color:#b45309">(elige módulo)</span>';
    const abogadoTxt = d.abogadoKey
      ? escapeHtml(d.responsableNombre)
      : `${escapeHtml(d.responsableNombre || '—')} <span style="color:#b45309">(no está en tu lista)</span>`;
    const vencTxt = d.fechaVencimiento ? formatDate(d.fechaVencimiento) : '—';
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
        <div style="min-width:0">
          <div style="font-weight:700;font-size:14px">#${escapeHtml(d.numero)}
            <span style="font-weight:500;color:var(--muted,#6b7280)">· ${moduloTxt}</span></div>
          <div style="font-size:13px;margin-top:3px">${escapeHtml(d.descripcion)}</div>
          <div style="font-size:12px;color:var(--muted,#6b7280);margin-top:5px">
            Vence: <b>${vencTxt}</b> · Responsable: ${abogadoTxt}</div>
        </div>
        <button class="btn btn-primary" data-idx="${i}" style="white-space:nowrap;font-size:13px;padding:7px 12px">Revisar y crear</button>
      </div>`;
    card.querySelector('button').addEventListener('click', () => {
      _closeGmailModal();
      prefillNewTramite(d);
    });
    list.appendChild(card);
  });

  el.style.display = 'flex';
}

// ── Punto de entrada (botón) ─────────────────────────────────
async function runGmailScan(btn) {
  const orig = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.dataset.busy = '1'; btn.innerHTML = '…'; }
  showToast('Revisando el correo…');
  try {
    const detections = await scanTramiteEmails();
    if (detections === null) return;                 // error o cancelado (ya avisado)
    _openGmailModal(_filterNuevos(detections));
  } finally {
    if (btn) { btn.disabled = false; delete btn.dataset.busy; btn.innerHTML = orig; }
  }
}

// ── Enganche del botón ───────────────────────────────────────
function initGmailScan() {
  const btn = document.getElementById('scanMailBtn');
  if (btn && !btn.dataset.wired) {
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => runGmailScan(btn));
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGmailScan);
  } else {
    initGmailScan();
  }
}
