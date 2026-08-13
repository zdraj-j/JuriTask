/**
 * JuriTask — dashboard.js
 * Panel de indicadores.
 *
 * Se calcula **entero** sobre `STATE.tramites`, que ya está en memoria, de
 * forma síncrona y sin backend.
 */

// ============================================================
// PANEL — KPIs y métricas
// ============================================================
// Todo se calcula sobre `STATE.tramites`, que ya está en memoria: el panel no
// consulta Firestore ni conoce usuarios. Antes leía perfiles y equipos uno a
// uno porque las reglas no permiten `list` sobre /users/; sin usuarios esa
// gimnasia sobra.

function renderDashboard() {
  ['kpiTramites','kpiVencidos','kpiHoy','kpiTerminados','kpiUrgentes']
    .forEach(id => setText(id, '…'));

  const hoy        = today();
  const tramites   = STATE.tramites;
  const activos    = tramites.filter(t => !t.terminado);
  const terminados = tramites.filter(t =>  t.terminado);
  const vencidos   = activos.filter(t => t.fechaVencimiento && t.fechaVencimiento < hoy && !t.gestion?.cumplimiento);
  const hoyVenc    = activos.filter(t => t.fechaVencimiento === hoy && !t.gestion?.cumplimiento);
  const urgentes   = activos.filter(t => (t.seguimiento||[]).some(s => s.urgente && s.estado === 'pendiente'));

  setText('kpiTramites',   activos.length);
  setText('kpiVencidos',   vencidos.length);
  setText('kpiHoy',        hoyVenc.length);
  setText('kpiTerminados', terminados.length);
  setText('kpiUrgentes',   urgentes.length);

  renderDashMetrics(activos, vencidos);
  _renderVencidosTable(vencidos);
}

function _renderVencidosTable(vencidos) {
  const body = document.getElementById('dashVencidosBody');
  if (!body) return;
  body.innerHTML = '';

  if (!vencidos.length) {
    body.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px">¡No hay trámites vencidos!</td></tr>';
    return;
  }

  [...vencidos]
    .sort((a, b) => (a.fechaVencimiento || '').localeCompare(b.fechaVencimiento || ''))
    .forEach(t => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="dash-num">#${escapeHtml(t.numero)}${copyNumBtn(t.numero)}</td>
        <td>${escapeHtml(t.descripcion || '—')}</td>
        <td>${escapeHtml(abogadoName(t.abogado || 'yo', t))}</td>
        <td class="dash-danger">${formatDate(t.fechaVencimiento)}</td>
        <td>${escapeHtml(t.modulo || '—')}</td>`;
      body.appendChild(tr);
    });
}


// ── Métricas visuales ─────────────────────────────────────────
function renderDashMetrics(activos, vencidos) {
  const el = document.getElementById('dashMetricsRow');
  if (!el) return;

  const hoy = today();

  // Por módulo
  const byModulo = {};
  activos.forEach(t => { const m = t.modulo||'Sin módulo'; byModulo[m]=(byModulo[m]||0)+1; });
  const moduloEntries = Object.entries(byModulo).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const maxMod = moduloEntries[0]?.[1] || 1;

  // Por abogado
  const byAbogado = {};
  activos.forEach(t => { const a = abogadoName(t.abogado||'yo'); byAbogado[a]=(byAbogado[a]||0)+1; });
  const abogadoEntries = Object.entries(byAbogado).sort((a,b)=>b[1]-a[1]);
  const maxAb = abogadoEntries[0]?.[1] || 1;

  // Tareas
  let tareasPend=0, tareasComp=0;
  activos.forEach(t => (t.seguimiento||[]).forEach(s => {
    if(s.estado==='pendiente') tareasPend++; else tareasComp++;
  }));
  const totalT = tareasPend+tareasComp;
  const pctComp = totalT ? Math.round(tareasComp/totalT*100) : 0;
  const pctVenc = activos.length ? Math.round(vencidos.length/activos.length*100) : 0;

  el.innerHTML = `
    <div class="dash-metric-card">
      <div class="dash-metric-title"><i data-lucide="bar-chart-3"></i> Trámites por módulo</div>
      ${moduloEntries.length
        ? moduloEntries.map(([m,n])=>`
          <div class="dash-metric-bar-row">
            <span class="dash-metric-bar-label" title="${m}">${m.length>12?m.slice(0,11)+'…':m}</span>
            <div class="dash-metric-bar-track">
              <div class="dash-metric-bar-fill" style="width:${Math.round(n/maxMod*100)}%;background:var(--accent)"></div>
            </div>
            <span class="dash-metric-bar-val">${n}</span>
          </div>`).join('')
        : '<p style="color:var(--text-muted);font-size:13px;margin-top:8px">Sin datos todavía</p>'}
    </div>

    <div class="dash-metric-card">
      <div class="dash-metric-title"><i data-lucide="scale"></i> Trámites por abogado</div>
      ${abogadoEntries.length
        ? abogadoEntries.map(([a,n])=>`
          <div class="dash-metric-bar-row">
            <span class="dash-metric-bar-label">${escapeHtml(a)}</span>
            <div class="dash-metric-bar-track">
              <div class="dash-metric-bar-fill" style="width:${Math.round(n/maxAb*100)}%;background:var(--color-abogado1)"></div>
            </div>
            <span class="dash-metric-bar-val">${n}</span>
          </div>`).join('')
        : '<p style="color:var(--text-muted);font-size:13px;margin-top:8px">Sin datos todavía</p>'}
    </div>

    <div class="dash-metric-card">
      <div class="dash-metric-title"><i data-lucide="circle-check"></i> Estado de tareas</div>
      <div style="display:flex;gap:20px;align-items:center;margin-top:8px">
        <div style="text-align:center">
          <div style="font-size:28px;font-weight:700;color:var(--warning)">${tareasPend}</div>
          <div style="font-size:12px;color:var(--text-muted)">Pendientes</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:28px;font-weight:700;color:var(--success)">${tareasComp}</div>
          <div style="font-size:12px;color:var(--text-muted)">Completadas</div>
        </div>
        <div style="flex:1">
          <div style="height:8px;border-radius:4px;background:var(--border);overflow:hidden">
            <div style="height:100%;width:${pctComp}%;background:var(--success);transition:width .5s"></div>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${pctComp}% completadas</div>
        </div>
      </div>
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border-light)">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px">
          <span style="color:var(--text-secondary)">Tasa de vencimiento</span>
          <span style="font-weight:700;color:${pctVenc>20?'var(--danger)':pctVenc>5?'var(--warning)':'var(--success)'}">${pctVenc}%</span>
        </div>
        <div style="height:6px;border-radius:3px;background:var(--border);overflow:hidden">
          <div style="height:100%;width:${pctVenc}%;background:${pctVenc>20?'var(--danger)':pctVenc>5?'var(--warning)':'var(--success)'};transition:width .5s"></div>
        </div>
      </div>
    </div>`;
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}


function initDashboard() {
  document.getElementById('dashRefreshBtn')?.addEventListener('click', renderDashboard);
}

function loadDashboardData() {
  renderDashboard();
}
