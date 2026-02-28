/**
 * JuriTask — dashboard.js
 * Dashboard admin: KPIs, gestión de usuarios, equipos, backups.
 *
 * NOTA DE PERMISOS:
 * Firestore no permite listar /users/ completa desde el cliente aunque el
 * usuario sea admin (las reglas de seguridad no soportan "list" en colecciones
 * donde cada doc tiene regla individual sin un índice de colección global).
 * Solución: el dashboard usa STATE.tramites (ya en memoria) para métricas propias,
 * y lee usuarios individualmente solo de los que conoce (propio uid + miembros de equipos).
 */

// ============================================================
// BACKUPS
// ============================================================
async function createBackup() {
  if (!AUTH.userProfile?.uid) return;
  await db.collection('users').doc(AUTH.userProfile.uid).collection('backups').add({
    creadoEn: new Date().toISOString(),
    tramites: STATE.tramites,
    order:    STATE.order,
    config:   STATE.config,
  });
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
      row.innerHTML = `<span style="font-size:13px">📦 ${fecha} <span style="color:var(--text-muted)">(${count} trámites)</span></span>
        <div style="display:flex;gap:6px">
          <button class="btn-small" data-restore="${doc.id}">↩ Restaurar</button>
          <button class="btn-small btn-danger" data-del="${doc.id}">✕</button>
        </div>`;
      row.querySelector('[data-restore]').addEventListener('click', () => restoreBackup(doc.id, b));
      row.querySelector('[data-del]').addEventListener('click',    () => deleteBackup(doc.id));
      el.appendChild(row);
    });
  } catch(e) {
    el.innerHTML = '<p style="font-size:13px;color:var(--danger)">Error cargando backups.</p>';
  }
}

async function restoreBackup(id, b) {
  if (!confirm(`¿Restaurar backup del ${new Date(b.creadoEn).toLocaleString('es-CO')}?\nSe reemplazarán todos los trámites actuales.`)) return;
  if (b.tramites) STATE.tramites = b.tramites;
  if (b.order)    STATE.order    = b.order;
  if (b.config)   STATE.config   = Object.assign({...DEFAULT_CONFIG}, b.config);
  saveAll(true); applyCssColors(); applyTheme(STATE.config.theme||'claro');
  populateModuloSelects(); updateAbogadoSelects(); renderAll();
  showToast('Backup restaurado.');
}

async function deleteBackup(id) {
  if (!confirm('¿Eliminar este backup?')) return;
  await db.collection('users').doc(AUTH.userProfile.uid).collection('backups').doc(id).delete();
  renderBackupList(); showToast('Backup eliminado.');
}

function startAutoBackup() {
  if (!AUTH.userProfile?.uid) return;
  setInterval(async () => {
    try {
      await createBackup();
      const cutoff = new Date(Date.now() - 24*60*60*1000).toISOString();
      const old = await db.collection('users').doc(AUTH.userProfile.uid)
        .collection('backups').where('creadoEn','<',cutoff).get();
      old.forEach(doc => doc.ref.delete());
    } catch(e) { console.warn('Error backup automático:', e); }
  }, 2*60*60*1000);
}

// ============================================================
// DASHBOARD
// ============================================================
let _dashUsers   = [];
let _dashEquipos = [];

async function renderDashboard() {
  if (AUTH.userProfile?.role !== 'admin') return;

  // Indicador de carga en KPIs
  ['kpiUsuarios','kpiTramites','kpiVencidos','kpiHoy','kpiTerminados','kpiEquipos','kpiUrgentes','kpiCompartidos']
    .forEach(id => setText(id, '…'));

  const hoy        = today();
  const tramites   = STATE.tramites;
  const activos    = tramites.filter(t => !t.terminado);
  const terminados = tramites.filter(t =>  t.terminado);
  const vencidos   = activos.filter(t => t.fechaVencimiento && t.fechaVencimiento < hoy && !t.gestion?.cumplimiento);
  const hoyVenc    = activos.filter(t => t.fechaVencimiento === hoy && !t.gestion?.cumplimiento);
  const urgentes   = activos.filter(t => (t.seguimiento||[]).some(s => s.urgente && s.estado === 'pendiente'));
  const compartidos= activos.filter(t => t._scope === 'team');

  // Leer equipos (usuarios autenticados pueden leerlos)
  _dashEquipos = [];
  try {
    const eSnap = await db.collection('teams').get();
    eSnap.forEach(doc => _dashEquipos.push({ id: doc.id, ...doc.data() }));
  } catch(e) { console.warn('No se pudieron cargar equipos:', e); }

  // Leer todos los UIDs desde el índice global /meta/userIndex
  const knownUids = new Set([AUTH.userProfile.uid]);
  try {
    const idxDoc = await db.collection('meta').doc('userIndex').get();
    if (idxDoc.exists) {
      (idxDoc.data().uids || []).forEach(uid => knownUids.add(uid));
    }
  } catch(e) { console.warn('No se pudo leer userIndex:', e); }
  // También agregar miembros de equipos por si acaso
  _dashEquipos.forEach(eq => (eq.members||[]).forEach(uid => knownUids.add(uid)));

  // Leer cada perfil de usuario individualmente (permitido por reglas)
  _dashUsers = [];
  for (const uid of knownUids) {
    try {
      const uDoc = await db.collection('users').doc(uid).get();
      if (uDoc.exists) {
        _dashUsers.push({ uid, ...uDoc.data() });
      } else if (uid === AUTH.userProfile.uid) {
        // Fallback: al menos el propio admin
        _dashUsers.push({ ...AUTH.userProfile });
      }
    } catch(e) {
      // Si falla leer un usuario, incluirlo con datos básicos si es el admin
      if (uid === AUTH.userProfile.uid) _dashUsers.push({ ...AUTH.userProfile });
    }
  }
  if (!_dashUsers.length) {
    _dashUsers = [{ ...AUTH.userProfile }];
  }

  // KPIs
  setText('kpiUsuarios',    knownUids.size);
  setText('kpiTramites',    activos.length);
  setText('kpiVencidos',    vencidos.length);
  setText('kpiHoy',         hoyVenc.length);
  setText('kpiTerminados',  terminados.length);
  setText('kpiEquipos',     _dashEquipos.length);
  setText('kpiUrgentes',    urgentes.length);
  setText('kpiCompartidos', compartidos.length);

  // Métricas visuales
  renderDashMetrics(activos, vencidos);

  // Tabla usuarios
  const tbody = document.getElementById('dashUsersBody');
  if (tbody) {
    tbody.innerHTML = '';
    _dashUsers.forEach(u => {
      const equipo = _dashEquipos.find(e => (e.members||[]).includes(u.uid));
      const isMe   = u.uid === AUTH.userProfile.uid;
      const tr = document.createElement('tr');
      tr.className = 'dash-user-row' + (isMe ? ' dash-self-row' : '');
      tr.innerHTML = `
        <td>
          <div class="dash-user-cell">
            <div class="dash-avatar-initials">${(u.displayName||u.email||'?').slice(0,2).toUpperCase()}</div>
            <div>
              <div style="font-weight:600;font-size:13px">${u.displayName||'—'}</div>
              ${isMe ? '<span class="dash-self-badge">Tú</span>' : ''}
            </div>
          </div>
        </td>
        <td class="dash-email">${u.email||'—'}</td>
        <td>
          <select class="role-select" data-uid="${u.uid}" ${isMe?'disabled':''} style="font-size:12px;padding:3px 6px;border-radius:6px;border:1px solid var(--border)">
            <option value="user"  ${u.role!=='admin'?'selected':''}>👤 Usuario</option>
            <option value="admin" ${u.role==='admin'?'selected':''}>👑 Admin</option>
          </select>
        </td>
        <td>${equipo
          ? `<span style="font-size:12px;background:var(--accent-light);color:var(--accent);padding:2px 8px;border-radius:8px">${equipo.nombre}</span>`
          : '<span style="color:var(--text-muted);font-size:12px">Sin equipo</span>'}</td>
        <td class="dash-num">${isMe ? activos.length : '—'}</td>
        <td>${isMe ? '' : `<button class="btn-small btn-danger" data-deluser="${u.uid}">✕</button>`}</td>`;
      tr.querySelector('.role-select')?.addEventListener('change', async e => {
        await db.collection('users').doc(u.uid).update({ role: e.target.value });
        showToast('Rol actualizado.'); u.role = e.target.value;
      });
      tr.querySelector('[data-deluser]')?.addEventListener('click', async () => {
        if (!confirm(`¿Eliminar a ${u.displayName||u.email}?`)) return;
        await db.collection('users').doc(u.uid).delete();
        showToast('Usuario eliminado.'); renderDashboard();
      });
      tbody.appendChild(tr);
    });
  }

  renderTeamsGrid(_dashEquipos);

  // Vencidos
  const vbody = document.getElementById('dashVencidosBody');
  if (vbody) {
    vbody.innerHTML = '';
    if (!vencidos.length) {
      vbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px">¡No hay trámites vencidos! 🎉</td></tr>';
    } else {
      vencidos.sort((a,b)=>(a.fechaVencimiento||'').localeCompare(b.fechaVencimiento||'')).forEach(t => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="dash-num">#${t.numero}</td>
          <td>${t.descripcion||'—'}</td>
          <td>${AUTH.userProfile.displayName||AUTH.userProfile.email}</td>
          <td class="dash-danger">${formatDate(t.fechaVencimiento)}</td>
          <td>${t.modulo||'—'}</td>`;
        vbody.appendChild(tr);
      });
    }
  }
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
      <div class="dash-metric-title">📊 Trámites por módulo</div>
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
      <div class="dash-metric-title">⚖️ Trámites por abogado</div>
      ${abogadoEntries.length
        ? abogadoEntries.map(([a,n])=>`
          <div class="dash-metric-bar-row">
            <span class="dash-metric-bar-label">${a}</span>
            <div class="dash-metric-bar-track">
              <div class="dash-metric-bar-fill" style="width:${Math.round(n/maxAb*100)}%;background:var(--color-abogado1)"></div>
            </div>
            <span class="dash-metric-bar-val">${n}</span>
          </div>`).join('')
        : '<p style="color:var(--text-muted);font-size:13px;margin-top:8px">Sin datos todavía</p>'}
    </div>

    <div class="dash-metric-card">
      <div class="dash-metric-title">✅ Estado de tareas</div>
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

// ============================================================
// EQUIPOS
// ============================================================
function renderTeamsGrid(equipos) {
  const grid = document.getElementById('dashTeamsGrid');
  if (!grid) return;
  if (!equipos.length) {
    grid.innerHTML = '<p style="padding:16px 20px;color:var(--text-muted);font-size:13px">No hay equipos creados aún.</p>';
    return;
  }
  grid.innerHTML = '';
  equipos.forEach(eq => {
    const memberCount = (eq.members||[]).length;
    const card = document.createElement('div');
    card.className = 'dash-team-card';
    card.innerHTML = `
      <div class="dash-team-name">👥 ${eq.nombre}</div>
      <div class="dash-team-meta">${memberCount} miembro${memberCount!==1?'s':''}</div>
      <div class="dash-team-actions">
        <button class="btn-small" data-editteam="${eq.id}">✎ Editar</button>
        <button class="btn-small btn-danger" data-delteam="${eq.id}">✕ Eliminar</button>
      </div>`;
    card.querySelector('[data-editteam]').addEventListener('click', () => openTeamModal(eq));
    card.querySelector('[data-delteam]').addEventListener('click', async () => {
      if (!confirm(`¿Eliminar el equipo "${eq.nombre}"?`)) return;
      await db.collection('teams').doc(eq.id).delete();
      for (const uid of (eq.members||[])) {
        await db.collection('users').doc(uid).update({ teamId: null }).catch(()=>{});
      }
      showToast('Equipo eliminado.'); renderDashboard();
    });
    grid.appendChild(card);
  });
}

function openTeamModal(equipo = null) {
  const overlay = document.getElementById('createTeamOverlay');
  if (!overlay) return;
  document.getElementById('editTeamId').value  = equipo?.id || '';
  document.getElementById('newTeamName').value = equipo?.nombre || '';
  const list = document.getElementById('teamMemberList');
  list.innerHTML = '';
  _dashUsers.forEach(u => {
    const checked = equipo ? (equipo.members||[]).includes(u.uid) : false;
    const row = document.createElement('label');
    row.className = 'team-member-row';
    row.innerHTML = `<input type="checkbox" value="${u.uid}" ${checked?'checked':''}/>
      <span>${u.displayName||u.email}${u.role==='admin'?' 👑':''}</span>`;
    list.appendChild(row);
  });
  overlay.classList.add('open');
}

function closeTeamModal() {
  document.getElementById('createTeamOverlay')?.classList.remove('open');
}

async function saveTeam() {
  const nombre = document.getElementById('newTeamName').value.trim();
  if (!nombre) { showToast('El nombre del equipo es obligatorio.'); return; }
  const members = [...document.querySelectorAll('#teamMemberList input:checked')].map(cb => cb.value);
  const id      = document.getElementById('editTeamId').value;
  const data    = { nombre, members, actualizadoEn: new Date().toISOString() };
  let teamId;
  if (id) {
    await db.collection('teams').doc(id).update(data); teamId = id;
  } else {
    data.creadoEn = new Date().toISOString();
    const ref = await db.collection('teams').add(data); teamId = ref.id;
  }
  for (const u of _dashUsers) {
    const en = members.includes(u.uid);
    await db.collection('users').doc(u.uid).update({ teamId: en ? teamId : null }).catch(()=>{});
  }
  showToast(`✓ Equipo "${nombre}" guardado.`);
  closeTeamModal(); renderDashboard();
}

// ============================================================
// GESTIÓN USUARIOS (vista config)
// ============================================================
async function loadAdminUsers() {
  const el = document.getElementById('adminUserList');
  if (!el || AUTH.userProfile?.role !== 'admin') return;
  const users = _dashUsers.length ? _dashUsers : [{ ...AUTH.userProfile }];
  el.innerHTML = '';
  users.forEach(u => {
    const uid = u.uid; const isMe = uid === AUTH.userProfile.uid;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border-light);flex-wrap:wrap';
    row.innerHTML = `
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:13px">${u.displayName||'(sin nombre)'} ${isMe?'<span style="color:var(--text-muted)">(tú)</span>':''}</div>
        <div style="font-size:12px;color:var(--text-secondary)">${u.email||''}</div>
      </div>
      <select class="role-select" data-uid="${uid}" ${isMe?'disabled':''} style="font-size:12px;padding:4px 8px;border-radius:6px;border:1px solid var(--border)">
        <option value="user"  ${u.role!=='admin'?'selected':''}>👤 Usuario</option>
        <option value="admin" ${u.role==='admin'?'selected':''}>👑 Admin</option>
      </select>
      ${!isMe?`<button class="btn-small btn-danger del-user-btn" data-uid="${uid}">✕</button>`:''}`;
    row.querySelector('.role-select')?.addEventListener('change', async e => {
      await db.collection('users').doc(uid).update({ role: e.target.value });
      showToast('Rol actualizado.');
    });
    row.querySelector('.del-user-btn')?.addEventListener('click', async () => {
      if (!confirm(`¿Eliminar a ${u.displayName||u.email}?`)) return;
      await db.collection('users').doc(uid).delete();
      loadAdminUsers(); showToast('Usuario eliminado.');
    });
    el.appendChild(row);
  });
}

// ============================================================
// INIT
// ============================================================
function initDashboard() {
  document.getElementById('dashRefreshBtn')?.addEventListener('click', renderDashboard);
  document.getElementById('dashCreateTeamBtn')?.addEventListener('click', () => openTeamModal());
  document.getElementById('createTeamClose')?.addEventListener('click', closeTeamModal);
  document.getElementById('createTeamClose2')?.addEventListener('click', closeTeamModal);
  document.getElementById('confirmCreateTeamBtn')?.addEventListener('click', saveTeam);
  document.getElementById('createTeamOverlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('createTeamOverlay')) closeTeamModal();
  });
}

// Alias para config.js
function loadDashboardData() { renderDashboard(); }
