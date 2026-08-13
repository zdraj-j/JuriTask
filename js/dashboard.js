/**
 * JuriTask — dashboard.js
 * Panel de indicadores + backups.
 *
 * El panel se calcula **entero** sobre `STATE.tramites`, que ya está en
 * memoria: no consulta Firestore ni sabe nada de usuarios. Los backups sí
 * siguen contra Firestore, y viven aquí aunque su UI esté en Ajustes.
 */

// ============================================================
// BACKUPS
// ============================================================
/**
 * Elimina recursivamente propiedades `undefined` de un objeto/array
 * para que Firestore no rechace la escritura.
 */
function sanitizeForFirestore(obj) {
  return JSON.parse(JSON.stringify(obj));
}

async function createBackup() {
  if (!AUTH.userProfile?.uid) return;
  const data = {
    creadoEn: new Date().toISOString(),
    tramites: sanitizeForFirestore(STATE.tramites),
    order:    sanitizeForFirestore(STATE.order),
    config:   sanitizeForFirestore(STATE.config),
  };
  await db.collection('users').doc(AUTH.userProfile.uid).collection('backups').add(data);
}

async function renderBackupList() {
  const el = document.getElementById('backupList');
  if (!el || !AUTH.userProfile?.uid) return;
  el.innerHTML = '<p style="font-size:13px;color:var(--text-muted)">Cargando…</p>';
  try {
    const snap = await db.collection('users').doc(AUTH.userProfile.uid)
      .collection('backups').orderBy('creadoEn','desc').limit(10).get();
    if (snap.empty) { el.innerHTML = '<p style="font-size:13px;color:var(--text-muted)">No hay backups aún.</p>'; return; }
    el.innerHTML = '';
    snap.forEach(doc => {
      const b = doc.data();
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border-light);gap:8px';
      const fecha = new Date(b.creadoEn).toLocaleString('es-CO',{dateStyle:'short',timeStyle:'short'});
      const count = (b.tramites||[]).length;
      row.innerHTML = `<span style="font-size:13px"><i data-lucide="package"></i> ${fecha} <span style="color:var(--text-muted)">(${count} trámites)</span></span>
        <div style="display:flex;gap:6px">
          <button class="btn-small" data-restore="${doc.id}"><i data-lucide="undo-2"></i> Restaurar</button>
          <button class="btn-small btn-danger" data-del="${doc.id}"><i data-lucide="x"></i></button>
        </div>`;
      row.querySelector('[data-restore]').addEventListener('click', () => restoreBackup(doc.id, b));
      row.querySelector('[data-del]').addEventListener('click',    () => deleteBackup(doc.id));
      el.appendChild(row);
    });
  } catch(e) {
    console.error('Error cargando backups:', e);
    el.innerHTML = `<p style="font-size:13px;color:var(--danger)">Error cargando backups: ${e.code || e.message}</p>`;
  }
}

async function restoreBackup(id, b) {
  if (!(await showConfirm(`¿Restaurar backup del ${new Date(b.creadoEn).toLocaleString('es-CO')}? Se reemplazarán todos los trámites actuales.`, { confirmLabel: 'Restaurar' }))) return;
  if (b.tramites) STATE.tramites = b.tramites;
  if (b.order)    STATE.order    = b.order;
  if (b.config)   STATE.config   = Object.assign({...DEFAULT_CONFIG}, b.config);

  // Persistencia AUTORITATIVA. Con Firebase activo, saveAll solo programa una
  // escritura debounced (800ms) que se pierde si el usuario recarga/cierra la
  // pestaña justo después, y que además nunca borra los trámites divergentes.
  // Como Firestore es la fuente de verdad al recargar, un restore "perdido"
  // hace que los trámites reaparezcan un instante y vuelvan a desaparecer.
  // Restauramos de forma síncrona y esperada para que quede persistido.
  try {
    if (typeof restoreToFirestore === 'function' && AUTH.userProfile?.uid) {
      await restoreToFirestore(STATE.tramites, STATE.order, STATE.config);
      if (typeof _flushSave === 'function') _flushSave(); // respaldo local inmediato
    } else {
      saveAll(true);
    }
  } catch (e) {
    console.error('Error restaurando backup:', e);
    showToast('No se pudo restaurar el backup. Revisa tu conexión e inténtalo de nuevo.');
    return;
  }

  applyCssColors(); applyTheme(STATE.config.theme||'claro');
  populateModuloSelects(); updateAbogadoSelects(); renderAll();
  showToast('Backup restaurado.');
}

async function deleteBackup(id) {
  if (!(await showConfirm('¿Eliminar este backup?', { danger: true, confirmLabel: 'Eliminar' }))) return;
  await db.collection('users').doc(AUTH.userProfile.uid).collection('backups').doc(id).delete();
  renderBackupList(); showToast('Backup eliminado.');
}

let _autoBackupTimers = [];

function stopAutoBackup() {
  _autoBackupTimers.forEach(id => { clearTimeout(id); clearInterval(id); });
  _autoBackupTimers = [];
}

function startAutoBackup() {
  if (!AUTH.userProfile?.uid) return;

  // Limpiar timers anteriores (cambio de cuenta sin recargar)
  stopAutoBackup();

  const RETENTION = 7 * 24 * 60 * 60 * 1000; // conservar 7 días
  const SCHEDULE  = [ [8, 0], [13, 20], [16, 20] ]; // horas programadas

  async function runBackupCycle() {
    if (!AUTH.userProfile?.uid) return;
    try {
      await createBackup();
      // eliminar backups con más de 7 días
      const cutoff = new Date(Date.now() - RETENTION).toISOString();
      const old = await db.collection('users').doc(AUTH.userProfile.uid)
        .collection('backups').where('creadoEn', '<', cutoff).get();
      old.forEach(doc => doc.ref.delete());
    } catch (e) { console.warn('Error backup automático:', e); }
  }

  function msUntil(hour, min) {
    const now = new Date();
    const target = new Date(now);
    target.setHours(hour, min, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return target - now;
  }

  function scheduleDaily(hour, min) {
    const DAY = 24 * 60 * 60 * 1000;
    const id = setTimeout(() => {
      runBackupCycle();
      const intervalId = setInterval(runBackupCycle, DAY);
      _autoBackupTimers.push(intervalId);
    }, msUntil(hour, min));
    _autoBackupTimers.push(id);
  }

  // backup inmediato para garantizar que todo usuario tenga al menos uno
  runBackupCycle();
  SCHEDULE.forEach(([h, m]) => scheduleDaily(h, m));
}

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
