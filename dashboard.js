/**
 * JuriTask — dashboard.js
 * Dashboard admin: KPIs globales, gestión de usuarios, equipos, backups.
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
  showToast('✓ Backup restaurado.');
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
// DASHBOARD — cargar datos globales y renderizar
// ============================================================
let _dashUsers = [];

async function renderDashboard() {
  if (AUTH.userProfile?.role !== 'admin') return;

  let usersSnap;
  try {
    usersSnap = await db.collection('users').get();
  } catch(e) {
    showToast('Error de permisos. Actualiza las reglas de Firestore.');
    return;
  }

  _dashUsers = [];
  usersSnap.forEach(doc => {
    if (doc.data().email) _dashUsers.push({ uid: doc.id, ...doc.data() });
  });

  let allTramites = [];
  let tramitesByUser = {};
  for (const u of _dashUsers) {
    try {
      const tSnap = await db.collection('users').doc(u.uid).collection('tramites').get();
      const ut = [];
      tSnap.forEach(doc => ut.push({ id: doc.id, ...doc.data(), _ownerUid: u.uid, _ownerName: u.displayName || u.email }));
      tramitesByUser[u.uid] = ut;
      allTramites = allTramites.concat(ut);
    } catch(_) {}
  }

  let equipos = [];
  try {
    const eSnap = await db.collection('teams').get();
    eSnap.forEach(doc => equipos.push({ id: doc.id, ...doc.data() }));
  } catch(_) {}

  const hoy = today();
  const activos     = allTramites.filter(t => !t.terminado);
  const terminados  = allTramites.filter(t => t.terminado);
  const vencidos    = activos.filter(t => t.fechaVencimiento && t.fechaVencimiento < hoy && !t.gestion?.cumplimiento);
  const hoyVenc     = activos.filter(t => t.fechaVencimiento === hoy && !t.gestion?.cumplimiento);
  const urgentes    = activos.filter(t => (t.seguimiento||[]).some(s => s.urgente && s.estado === 'pendiente'));
  const compartidos = activos.filter(t => t._scope === 'team');

  setText('kpiUsuarios',   _dashUsers.length);
  setText('kpiTramites',   activos.length);
  setText('kpiVencidos',   vencidos.length);
  setText('kpiHoy',        hoyVenc.length);
  setText('kpiTerminados', terminados.length);
  setText('kpiEquipos',    equipos.length);
  setText('kpiUrgentes',   urgentes.length);
  setText('kpiCompartidos',compartidos.length);

  // Tabla usuarios
  const tbody = document.getElementById('dashUsersBody');
  if (tbody) {
    tbody.innerHTML = '';
    _dashUsers.forEach(u => {
      const count  = (tramitesByUser[u.uid]||[]).filter(t => !t.terminado).length;
      const equipo = equipos.find(e => (e.members||[]).includes(u.uid));
      const isMe   = u.uid === AUTH.userProfile.uid;
      const tr = document.createElement('tr');
      tr.className = 'dash-user-row';
      tr.innerHTML = `
        <td><strong>${u.displayName||'—'}</strong>${isMe?' <span style="color:var(--text-muted);font-size:11px">(tú)</span>':''}</td>
        <td>${u.email}</td>
        <td>
          <select class="role-select" data-uid="${u.uid}" ${isMe?'disabled':''} style="font-size:12px;padding:3px 6px;border-radius:6px;border:1px solid var(--border)">
            <option value="user"  ${u.role!=='admin'?'selected':''}>👤 Usuario</option>
            <option value="admin" ${u.role==='admin'?'selected':''}>👑 Admin</option>
          </select>
        </td>
        <td>${equipo ? equipo.nombre : '<span style="color:var(--text-muted)">Sin equipo</span>'}</td>
        <td>${count}</td>
        <td>${isMe?'':
          `<button class="btn-small btn-danger" data-deluser="${u.uid}">✕</button>`
        }</td>`;
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

  renderTeamsGrid(equipos);

  // Vencidos globales
  const vbody = document.getElementById('dashVencidosBody');
  if (vbody) {
    vbody.innerHTML = '';
    if (!vencidos.length) {
      vbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px">No hay trámites vencidos 🎉</td></tr>';
    } else {
      vencidos.sort((a,b) => (a.fechaVencimiento||'').localeCompare(b.fechaVencimiento||'')).forEach(t => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>#${t.numero}</td><td>${t.descripcion||'—'}</td><td>${t._ownerName}</td>
          <td style="color:var(--danger)">${formatDate(t.fechaVencimiento)}</td><td>${t.modulo||'—'}</td>`;
        vbody.appendChild(tr);
      });
    }
  }
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
    await db.collection('teams').doc(id).update(data);
    teamId = id;
  } else {
    data.creadoEn = new Date().toISOString();
    const ref = await db.collection('teams').add(data);
    teamId = ref.id;
  }

  // Actualizar teamId en usuarios
  for (const u of _dashUsers) {
    const enEquipo = members.includes(u.uid);
    await db.collection('users').doc(u.uid).update({ teamId: enEquipo ? teamId : null }).catch(()=>{});
  }

  showToast(`✓ Equipo "${nombre}" guardado.`);
  closeTeamModal();
  renderDashboard();
}

// ============================================================
// GESTIÓN DE USUARIOS (en vista configuración)
// ============================================================
async function loadAdminUsers() {
  const el = document.getElementById('adminUserList');
  if (!el || AUTH.userProfile?.role !== 'admin') return;
  el.innerHTML = '<p style="font-size:13px;color:var(--text-muted)">Cargando usuarios…</p>';
  try {
    const snap = await db.collection('users').get();
    if (snap.empty) { el.innerHTML = '<p style="font-size:13px;color:var(--text-muted)">No hay usuarios.</p>'; return; }
    el.innerHTML = '';
    snap.forEach(doc => {
      const u = doc.data(); const uid = doc.id;
      if (!u.email) return;
      const isMe = uid === AUTH.userProfile.uid;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border-light);flex-wrap:wrap';
      row.innerHTML = `
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:13px">${u.displayName||'(sin nombre)'} ${isMe?'<span style="color:var(--text-muted)">(tú)</span>':''}</div>
          <div style="font-size:12px;color:var(--text-secondary)">${u.email}</div>
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
  } catch(e) {
    el.innerHTML = '<p style="font-size:13px;color:var(--danger)">Error de permisos. Actualiza las reglas de Firestore.</p>';
  }
}

// ============================================================
// INICIALIZAR EVENTOS
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
