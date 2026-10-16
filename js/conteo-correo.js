/**
 * JuriTask — conteo-correo.js
 * Conteo de correos por día de la cuenta de Google con la que se inició sesión.
 *
 * Sirve para cualquier buzón al que se pueda entrar con "Conectar Google",
 * p. ej. el de notificaciones judiciales: se cierra la sesión, se entra con esa
 * cuenta, se cuenta, y se vuelve a la propia.
 *
 * Cómo cuenta (100% en el navegador, solo lectura):
 *   - Un día = de 00:00 a 24:00 en la hora local del equipo (Bogotá). Por eso la
 *     búsqueda usa `after:`/`before:` con **segundos Unix** y no con fechas
 *     `AAAA/MM/DD`, que Gmail interpreta en hora del Pacífico y correría el
 *     conteo unas horas.
 *   - Por cada día se llama a `messages.list` pidiendo solo los ids (hasta 500
 *     por página) y se cuentan. Es exacto —a diferencia de `resultSizeEstimate`,
 *     que es una estimación— y barato: un mes son ~30 llamadas.
 *   - Cuenta **mensajes**, no conversaciones: cada correo de un hilo suma.
 *   - Spam y papelera quedan fuera salvo que se marque la casilla.
 *
 * Reutiliza de gmail.js `_gmailFetch` y `_withGmailToken` (token y reintento
 * ante 401), y de xlsx.js `xlsxDownload` para la exportación.
 */

const CONTEO_MAX_DIAS     = 366;
const CONTEO_CONCURRENCIA = 4;   // llamadas simultáneas a la Gmail API

const CONTEO_TIPOS = {
  recibidos: { label: 'Recibidos',          q: '-in:sent -in:draft -in:chats' },
  enviados:  { label: 'Enviados',           q: 'in:sent' },
  todos:     { label: 'Todos',              q: '-in:draft -in:chats' },
};

const _DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

let _conteoEl        = null;
let _conteoCancelado = false;
let _conteoResultado = null;   // { cuenta, desde, hasta, tipo, filtro, filas:[{fecha, n}] }

// ── Fechas ────────────────────────────────────────────────────
function _conteoISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _conteoFechaLocal(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);            // medianoche local
}

/** Lista de días 'AAAA-MM-DD' entre dos fechas, ambas incluidas. */
function _conteoDias(desde, hasta) {
  const out = [];
  const d   = _conteoFechaLocal(desde);
  const fin = _conteoFechaLocal(hasta);
  while (d <= fin) {
    out.push(_conteoISO(d));
    d.setDate(d.getDate() + 1);            // setDate respeta cambios de horario
  }
  return out;
}

function _conteoQueryDia(iso, base) {
  const ini = _conteoFechaLocal(iso);
  const fin = new Date(ini); fin.setDate(fin.getDate() + 1);
  const s = x => Math.floor(x.getTime() / 1000);
  return `after:${s(ini)} before:${s(fin)} ${base}`.trim();
}

// ── Conteo de un día ──────────────────────────────────────────
async function _conteoContarDia(iso, base, incluirSpam, token) {
  const q = _conteoQueryDia(iso, base);
  let n = 0, pageToken = '';
  do {
    if (_conteoCancelado) throw Object.assign(new Error('cancelado'), { code: 'cancelado' });
    const params = new URLSearchParams({
      q,
      maxResults: '500',
      fields: 'messages(id),nextPageToken',
    });
    if (incluirSpam) params.set('includeSpamTrash', 'true');
    if (pageToken)   params.set('pageToken', pageToken);
    const data = await _conteoFetchConReintento('messages?' + params.toString(), token);
    n += (data.messages || []).length;
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return n;
}

// Gmail devuelve 429 si se le pide demasiado rápido: se espera y se reintenta.
async function _conteoFetchConReintento(path, token) {
  for (let intento = 0; ; intento++) {
    try {
      return await _gmailFetch(path, token);
    } catch (e) {
      if ((e.code === 429 || e.code === 503) && intento < 4) {
        await new Promise(r => setTimeout(r, 800 * 2 ** intento));
        continue;
      }
      throw e;
    }
  }
}

/** Cuenta todos los días con unas pocas llamadas en paralelo. */
async function _conteoContarRango(dias, base, incluirSpam, token, onProgreso) {
  const res = new Array(dias.length);
  let siguiente = 0, hechos = 0;
  async function trabajador() {
    while (siguiente < dias.length) {
      const i = siguiente++;
      res[i] = await _conteoContarDia(dias[i], base, incluirSpam, token);
      onProgreso(++hechos, dias.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONTEO_CONCURRENCIA, dias.length) }, trabajador));
  return dias.map((fecha, i) => ({ fecha, n: res[i] }));
}

// ── Panel ─────────────────────────────────────────────────────
function _conteoBuild() {
  if (_conteoEl) return _conteoEl;
  const el = document.createElement('div');
  el.id = 'conteoCorreoOverlay';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Conteo de correos por día');
  el.style.cssText = 'position:fixed;inset:0;background:var(--overlay-bg,rgba(0,0,0,.45));display:none;align-items:center;justify-content:center;z-index:1200;padding:16px';
  el.innerHTML = `
    <div style="background:var(--surface,#fff);color:var(--text-primary,#111);max-width:620px;width:100%;max-height:88vh;display:flex;flex-direction:column;border-radius:14px;box-shadow:var(--shadow-lg)">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:16px 18px;border-bottom:1px solid var(--border,#e5e7eb)">
        <h2 style="margin:0;font-size:17px">Conteo de correos por día</h2>
        <button id="conteoCerrar" class="btn-icon" aria-label="Cerrar" style="font-size:20px;line-height:1">✕</button>
      </div>
      <div style="padding:14px 18px;overflow:auto">
        <div id="conteoCuenta" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:10px 12px;border-radius:10px;background:var(--accent-light,#eef);font-size:13px;margin-bottom:14px"></div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px">
          <div class="form-group"><label for="conteoDesde">Desde</label>
            <input type="date" id="conteoDesde" /></div>
          <div class="form-group"><label for="conteoHasta">Hasta</label>
            <input type="date" id="conteoHasta" /></div>
          <div class="form-group"><label for="conteoTipo">Qué contar</label>
            <select id="conteoTipo">
              ${Object.entries(CONTEO_TIPOS).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join('')}
            </select></div>
        </div>
        <div class="form-group" style="margin-top:12px"><label for="conteoFiltro">Filtro adicional (opcional, como en el buscador de Gmail)</label>
          <input type="text" id="conteoFiltro" placeholder="ej. from:juzgado label:notificaciones" /></div>
        <label style="display:flex;align-items:center;gap:6px;font-size:12.5px;margin-top:8px;color:var(--text-secondary,#6b7280)">
          <input type="checkbox" id="conteoSpam" /> Incluir spam y papelera</label>

        <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
          <button id="conteoContar" class="btn btn-primary" style="font-size:13px;padding:8px 16px">Contar</button>
          <button id="conteoCancelar" class="btn-small" style="display:none">Cancelar</button>
        </div>
        <div id="conteoEstado" style="font-size:12.5px;color:var(--text-secondary,#6b7280);margin-top:10px" aria-live="polite"></div>
        <div id="conteoResultado"></div>
      </div>
    </div>`;
  document.body.appendChild(el);

  el.addEventListener('click', e => { if (e.target === el) _conteoCerrar(); });
  el.addEventListener('keydown', e => { if (e.key === 'Escape') _conteoCerrar(); });
  el.querySelector('#conteoCerrar').addEventListener('click', _conteoCerrar);
  el.querySelector('#conteoContar').addEventListener('click', runConteoCorreos);
  el.querySelector('#conteoCancelar').addEventListener('click', () => { _conteoCancelado = true; });

  // Por defecto: los últimos 30 días hasta hoy.
  const hoy = new Date();
  const ini = new Date(hoy); ini.setDate(ini.getDate() - 29);
  el.querySelector('#conteoDesde').value = _conteoISO(ini);
  el.querySelector('#conteoHasta').value = _conteoISO(hoy);
  el.querySelector('#conteoHasta').max   = _conteoISO(hoy);

  _conteoEl = el;
  return el;
}

function _conteoCerrar() {
  if (!_conteoEl) return;
  _conteoCancelado = true;
  _conteoEl.style.display = 'none';
}

/** Muestra con qué cuenta se va a contar, y cómo cambiarla. */
function _conteoRenderCuenta() {
  const caja = _conteoEl?.querySelector('#conteoCuenta');
  if (!caja) return;
  const activa = typeof AUTH !== 'undefined' && AUTH.activa;
  caja.innerHTML = activa
    ? `<span>Cuenta: <b>${escapeHtml(AUTH.email)}</b></span>
       <button id="conteoCambiar" class="btn-small" style="font-size:12px">Cambiar de cuenta</button>`
    : `<span>No hay una cuenta de Google conectada.</span>
       <button id="conteoCambiar" class="btn-small" style="font-size:12px">Conectar Google</button>`;
  caja.querySelector('#conteoCambiar').addEventListener('click', _conteoCambiarCuenta);
}

async function _conteoCambiarCuenta() {
  // `prompt: select_account` en el proveedor hace que Google pregunte la cuenta.
  if (typeof AUTH !== 'undefined' && AUTH.activa) await AUTH.logout();
  if (typeof conectarGoogle === 'function') await conectarGoogle();
  _conteoResultado = null;
  _conteoEl.querySelector('#conteoResultado').innerHTML = '';
  _conteoEl.querySelector('#conteoEstado').textContent = '';
  _conteoRenderCuenta();
}

function openConteoCorreos() {
  const el = _conteoBuild();
  _conteoRenderCuenta();
  el.style.display = 'flex';
  el.querySelector('#conteoDesde').focus();
}

// ── Ejecución ─────────────────────────────────────────────────
async function runConteoCorreos() {
  const el      = _conteoEl;
  const desde   = el.querySelector('#conteoDesde').value;
  const hasta   = el.querySelector('#conteoHasta').value;
  const tipo    = el.querySelector('#conteoTipo').value;
  const filtro  = el.querySelector('#conteoFiltro').value.trim();
  const spam    = el.querySelector('#conteoSpam').checked;
  const estado  = el.querySelector('#conteoEstado');
  const btn     = el.querySelector('#conteoContar');
  const cancel  = el.querySelector('#conteoCancelar');

  if (!desde || !hasta)  { estado.textContent = 'Elige las dos fechas.'; return; }
  if (desde > hasta)     { estado.textContent = '"Desde" no puede ser posterior a "Hasta".'; return; }
  const dias = _conteoDias(desde, hasta);
  if (dias.length > CONTEO_MAX_DIAS) { estado.textContent = `Máximo ${CONTEO_MAX_DIAS} días por conteo.`; return; }

  const base = `${CONTEO_TIPOS[tipo].q} ${filtro}`.trim();
  _conteoCancelado = false;
  btn.disabled = true;
  cancel.style.display = '';
  el.querySelector('#conteoResultado').innerHTML = '';
  estado.textContent = 'Conectando con Gmail…';

  try {
    const filas = await _withGmailToken(token =>
      _conteoContarRango(dias, base, spam, token, (h, t) => {
        estado.textContent = `Contando… día ${h} de ${t}`;
      }));
    if (!filas) { estado.textContent = 'No se pudo leer el correo.'; return; }
    _conteoResultado = { cuenta: AUTH.email, desde, hasta, tipo, filtro, spam, filas };
    estado.textContent = '';
    _conteoRenderResultado();
  } catch (e) {
    estado.textContent = e.code === 'cancelado' ? 'Conteo cancelado.' : 'Error al contar: ' + (e.code || e.message);
  } finally {
    btn.disabled = false;
    cancel.style.display = 'none';
    _conteoRenderCuenta();
  }
}

function _conteoRenderResultado() {
  const r     = _conteoResultado;
  const caja  = _conteoEl.querySelector('#conteoResultado');
  const total = r.filas.reduce((s, f) => s + f.n, 0);
  const max   = Math.max(...r.filas.map(f => f.n), 0);
  const top   = r.filas.find(f => f.n === max);
  const prom  = r.filas.length ? total / r.filas.length : 0;
  const fmt   = n => n.toLocaleString('es-CO');

  const filasHtml = r.filas.map(f => {
    const d   = _conteoFechaLocal(f.fecha);
    const fin = d.getDay() === 0 || d.getDay() === 6;
    const pct = max ? Math.round(f.n / max * 100) : 0;
    return `<tr style="${fin ? 'color:var(--text-muted,#9ca3af)' : ''}">
      <td style="padding:5px 8px;white-space:nowrap">${formatDate(f.fecha)}</td>
      <td style="padding:5px 8px">${_DIAS_SEMANA[d.getDay()]}</td>
      <td style="padding:5px 8px;width:45%"><div style="height:8px;border-radius:4px;background:var(--accent,#3d5af1);opacity:.75;width:${pct}%"></div></td>
      <td style="padding:5px 8px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600">${fmt(f.n)}</td>
    </tr>`;
  }).join('');

  caja.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0 10px;text-align:center">
      ${[['Total', fmt(total)], ['Promedio diario', prom.toLocaleString('es-CO', { maximumFractionDigits: 1 })],
         ['Día con más', top && max ? `${fmt(max)} <span style="font-size:11px;font-weight:500">(${formatDate(top.fecha)})</span>` : '—']]
        .map(([k, v]) => `<div style="border:1px solid var(--border,#e5e7eb);border-radius:10px;padding:8px">
          <div style="font-size:11.5px;color:var(--text-secondary,#6b7280)">${k}</div>
          <div style="font-size:17px;font-weight:700">${v}</div></div>`).join('')}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      <button id="conteoXlsx" class="btn-small">Descargar Excel</button>
      <button id="conteoCopiar" class="btn-small">Copiar tabla</button>
    </div>
    <div style="border:1px solid var(--border,#e5e7eb);border-radius:10px;overflow:auto;max-height:42vh">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="text-align:left;background:var(--bg,#f3f4f6);position:sticky;top:0">
          <th style="padding:6px 8px">Fecha</th><th style="padding:6px 8px">Día</th><th></th>
          <th style="padding:6px 8px;text-align:right">Correos</th></tr></thead>
        <tbody>${filasHtml}</tbody>
      </table>
    </div>
    <p style="font-size:11.5px;color:var(--text-muted,#9ca3af);margin:8px 0 0">
      ${escapeHtml(CONTEO_TIPOS[r.tipo].label)} de ${escapeHtml(r.cuenta)}${r.filtro ? ` · filtro: ${escapeHtml(r.filtro)}` : ''}${r.spam ? ' · con spam y papelera' : ''}.
      Cuenta correos individuales, no conversaciones; días de 00:00 a 24:00 hora local.</p>`;

  caja.querySelector('#conteoXlsx').addEventListener('click', conteoExportarXLSX);
  caja.querySelector('#conteoCopiar').addEventListener('click', conteoCopiarTabla);
}

// ── Exportación ───────────────────────────────────────────────
function _conteoFilasPlanas() {
  return _conteoResultado.filas.map(f =>
    [f.fecha, _DIAS_SEMANA[_conteoFechaLocal(f.fecha).getDay()], f.n]);
}

function conteoExportarXLSX() {
  const r = _conteoResultado;
  if (!r) return;
  const cuenta = String(r.cuenta || 'cuenta').split('@')[0].replace(/[^a-zA-Z0-9]+/g, '-');
  const total  = r.filas.reduce((s, f) => s + f.n, 0);
  xlsxDownload(`correos-por-dia_${cuenta}_${r.desde}_${r.hasta}.xlsx`, [{
    name: 'Correos por día',
    columns: [{ header: 'Fecha', width: 14 }, { header: 'Día', width: 12 }, { header: 'Correos', width: 12 }],
    rows: [
      ..._conteoFilasPlanas().map(([f, d, n]) => [{ v: f, t: 'date' }, d, n]),
      [],
      ['Total', '', total],
      ['Cuenta', r.cuenta],
      ['Qué se contó', CONTEO_TIPOS[r.tipo].label + (r.filtro ? ` · ${r.filtro}` : '')],
    ],
  }]);
}

async function conteoCopiarTabla() {
  if (!_conteoResultado) return;
  // Separado por tabulaciones: se pega directo en Excel o Sheets en columnas.
  const tsv = [['Fecha', 'Día', 'Correos'], ..._conteoFilasPlanas().map(([f, d, n]) => [formatDate(f), d, n])]
    .map(r => r.join('\t')).join('\n');
  try {
    await navigator.clipboard.writeText(tsv);
    showToast('Tabla copiada. Pégala en Excel.');
  } catch (_) {
    showToast('No se pudo copiar. Usa "Descargar Excel".');
  }
}

// ── Enganche del botón ───────────────────────────────────────
function initConteoCorreos() {
  const btn = document.getElementById('conteoCorreoBtn');
  if (btn && !btn.dataset.wired) {
    btn.dataset.wired = '1';
    btn.addEventListener('click', openConteoCorreos);
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initConteoCorreos);
  else initConteoCorreos();
}
