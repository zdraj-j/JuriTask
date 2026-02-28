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
// APROBACIÓN DE CUENTAS PENDIENTES
// ============================================================

/**
 * Aprueba una cuenta de usuario.
 */
async function approveUserAction(uid, displayName, btn) {
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    await db.collection('users').doc(uid).update({ approved: true });
    showToast(`✓ Cuenta de ${displayName} aprobada.`);
    const u = _dashUsers.find(x => x.uid === uid);
    if (u) u.approved = true;
    await renderPendingUsersPanel();
    await loadAdminUsers();
    _updatePendingBadge();
  } catch(e) {
    showToast('Error al aprobar: ' + (e.message || e.code));
    if (btn) { btn.disabled = false; btn.textContent = '✓ Aprobar'; }
  }
}

/**
 * Rechaza y bloquea una cuenta pendiente.
 */
async function rejectUserAction(uid, displayName, btn) {
  const ok = await showConfirm(`¿Rechazar y bloquear la cuenta de ${displayName}?\nNo podrá iniciar sesión.`);
  if (!ok) return;
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    await db.collection('users').doc(uid).update({ approved: false, blocked: true });
    showToast(`Cuenta de ${displayName} bloqueada.`);
    const u = _dashUsers.find(x => x.uid === uid);
    if (u) { u.approved = false; u.blocked = true; }
    await renderPendingUsersPanel();
    await loadAdminUsers();
    _updatePendingBadge();
  } catch(e) {
    showToast('Error al rechazar: ' + (e.message || e.code));
    if (btn) { btn.disabled = false; btn.textContent = '✕ Rechazar'; }
  }
}

/**
 * Renderiza el panel de cuentas pendientes en el dashboard y en config.
 */
async function renderPendingUsersPanel() {
  let pendingUsers = [];
  try {
    const idx  = await db.collection('meta').doc('userIndex').get();
    const uids = idx.exists ? (idx.data().uids || []) : [];
    for (const uid of uids) {
      try {
        const doc = await db.collection('users').doc(uid).get();
        if (doc.exists) {
          const d = doc.data();
          if (!d.approved && !d.blocked && d.role !== 'admin') {
            pendingUsers.push({ uid, ...d });
          }
        }
      } catch(_) {}
    }
  } catch(e) { console.warn('Error leyendo pendientes:', e); }

  // ── Dashboard ──────────────────────────────────────────────
  const dashSection = document.getElementById('pendingUsersSection');
  const dashBody    = document.getElementById('pendingUsersBody');
  if (dashSection && dashBody) {
    dashSection.style.display = pendingUsers.length ? '' : 'none';
    if (pendingUsers.length) {
      dashBody.innerHTML = '';
      pendingUsers.forEach(u => _buildPendingRow(u, dashBody));
    }
  }

  // ── Configuración ──────────────────────────────────────────
  const cfgWrap = document.getElementById('adminPendingWrap');
  const cfgList = document.getElementById('adminPendingList');
  if (cfgWrap && cfgList) {
    cfgWrap.style.display = pendingUsers.length ? '' : 'none';
    if (pendingUsers.length) {
      cfgList.innerHTML = '';
      pendingUsers.forEach(u => _buildPendingCard(u, cfgList));
    }
  }
  return pendingUsers;
}

function _buildPendingRow(u, tbody) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>
      <div class="dash-user-cell">
        <div class="dash-avatar-initials" style="background:var(--warning,#f59e0b);color:#1a1a1a">
          ${(u.displayName||u.email||'?').slice(0,2).toUpperCase()}
        </div>
        <div>
          <div style="font-weight:600;font-size:13px">${u.displayName||'(sin nombre)'}</div>
          <div style="font-size:11px;color:var(--text-muted)">${u.creadoEn ? new Date(u.creadoEn).toLocaleDateString('es-CO') : ''}</div>
        </div>
      </div>
    </td>
    <td class="dash-email">${u.email||'—'}</td>
    <td><span class="pending-badge">⏳ Pendiente de aprobación</span></td>
    <td>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn-small btn-success" data-approve="${u.uid}">✓ Aprobar</button>
        <button class="btn-small btn-danger"  data-reject="${u.uid}">✕ Rechazar</button>
      </div>
    </td>`;
  tr.querySelector('[data-approve]').addEventListener('click', e => approveUserAction(u.uid, u.displayName||u.email, e.currentTarget));
  tr.querySelector('[data-reject]').addEventListener('click',  e => rejectUserAction(u.uid,  u.displayName||u.email, e.currentTarget));
  tbody.appendChild(tr);
}

function _buildPendingCard(u, container) {
  const card = document.createElement('div');
  card.className = 'pending-user-card';
  card.innerHTML = `
    <div class="pending-user-avatar">${(u.displayName||u.email||'?').slice(0,2).toUpperCase()}</div>
    <div class="pending-user-info">
      <div class="pending-user-name">${u.displayName||'(sin nombre)'}</div>
      <div class="pending-user-email">${u.email||''}</div>
      <div class="pending-user-date">Solicitud: ${u.creadoEn ? new Date(u.creadoEn).toLocaleString('es-CO',{dateStyle:'short',timeStyle:'short'}) : '—'}</div>
    </div>
    <div class="pending-user-actions">
      <button class="btn-small btn-success" data-approve="${u.uid}">✓ Aprobar</button>
      <button class="btn-small btn-danger"  data-reject="${u.uid}">✕ Rechazar</button>
    </div>`;
  card.querySelector('[data-approve]').addEventListener('click', e => approveUserAction(u.uid, u.displayName||u.email, e.currentTarget));
  card.querySelector('[data-reject]').addEventListener('click',  e => rejectUserAction(u.uid,  u.displayName||u.email, e.currentTarget));
  container.appendChild(card);
}

async function _updatePendingBadge() {
  try {
    const idx  = await db.collection('meta').doc('userIndex').get();
    const uids = idx.exists ? (idx.data().uids || []) : [];
    let count  = 0;
    for (const uid of uids) {
      try {
        const doc = await db.collection('users').doc(uid).get();
        if (doc.exists) { const d = doc.data(); if (!d.approved && !d.blocked && d.role !== 'admin') count++; }
      } catch(_) {}
    }
    let badge = document.getElementById('pendingApprovalBadge');
    if (!badge) {
      const navBtn = document.querySelector('[data-view="dashboard"]');
      if (navBtn) {
        badge = document.createElement('span');
        badge.id = 'pendingApprovalBadge';
        badge.className = 'badge';
        badge.style.cssText = 'background:var(--warning,#f59e0b);color:#1a1a1a;margin-left:auto';
        navBtn.appendChild(badge);
      }
    }
    if (badge) { badge.textContent = count||''; badge.style.display = count ? '' : 'none'; }
    setText('kpiPendientes', count);
    const cfgBadge = document.getElementById('adminPendingCount');
    if (cfgBadge) { cfgBadge.textContent = count ? `${count} pendiente${count!==1?'s':''}` : ''; cfgBadge.style.display = count ? '' : 'none'; }
  } catch(_) {}
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

  // Leer cada perfil de usuario individualmente + sus trámites
  _dashUsers = [];
  let totalTramitesAll = 0;
  let totalVencidosAll = 0;
  for (const uid of knownUids) {
    try {
      const uDoc = await db.collection('users').doc(uid).get();
      let userData = uDoc.exists ? { uid, ...uDoc.data() } : (uid === AUTH.userProfile.uid ? { ...AUTH.userProfile } : null);
      if (!userData) continue;
      // Cargar conteo de trámites del usuario
      try {
        const tSnap = await db.collection('users').doc(uid).collection('tramites').get();
        const uTramites = [];
        tSnap.forEach(doc => uTramites.push({ id: doc.id, ...doc.data() }));
        const uActivos   = uTramites.filter(t => !t.terminado);
        const uVencidos  = uActivos.filter(t => t.fechaVencimiento && t.fechaVencimiento < hoy);
        userData._tramitesActivos  = uActivos.length;
        userData._tramitesTotal    = uTramites.length;
        userData._tramitesVencidos = uVencidos.length;
        userData._tramitesList     = uTramites; // para vista admin
        totalTramitesAll += uActivos.length;
        if (uid !== AUTH.userProfile.uid) totalVencidosAll += uVencidos.length;
      } catch(e) {
        userData._tramitesActivos  = uid === AUTH.userProfile.uid ? activos.length : '?';
        userData._tramitesVencidos = uid === AUTH.userProfile.uid ? vencidos.length : '?';
        userData._tramitesList     = uid === AUTH.userProfile.uid ? STATE.tramites : [];
      }
      _dashUsers.push(userData);
    } catch(e) {
      if (uid === AUTH.userProfile.uid) _dashUsers.push({ ...AUTH.userProfile, _tramitesActivos: activos.length, _tramitesVencidos: vencidos.length, _tramitesList: STATE.tramites });
    }
  }
  if (!_dashUsers.length) {
    _dashUsers = [{ ...AUTH.userProfile, _tramitesActivos: activos.length, _tramitesVencidos: vencidos.length, _tramitesList: STATE.tramites }];
  }
  totalVencidosAll += vencidos.length;

  // KPIs — usar totales reales de todos los usuarios
  setText('kpiUsuarios',    knownUids.size);
  // kpiPendientes se actualiza en _updatePendingBadge()
  setText('kpiTramites',    totalTramitesAll || activos.length);
  setText('kpiVencidos',    totalVencidosAll || vencidos.length);
  setText('kpiHoy',         hoyVenc.length);
  setText('kpiTerminados',  terminados.length);
  setText('kpiEquipos',     _dashEquipos.length);
  setText('kpiUrgentes',    urgentes.length);
  setText('kpiCompartidos', compartidos.length);

  // Métricas visuales
  renderDashMetrics(activos, vencidos);

  // ── Pendientes ──────────────────────────────────────────────
  await renderPendingUsersPanel();
  await _updatePendingBadge();

  // Tabla usuarios (solo aprobados)
  const tbody = document.getElementById('dashUsersBody');
  if (tbody) {
    tbody.innerHTML = '';
    const approvedUsers = _dashUsers.filter(u => u.approved !== false || u.role === 'admin' || u.uid === AUTH.userProfile.uid);
    approvedUsers.forEach(u => {
      const equipo   = _dashEquipos.find(e => (e.members||[]).includes(u.uid));
      const isMe     = u.uid === AUTH.userProfile.uid;
      const nAct     = u._tramitesActivos  ?? '?';
      const nVenc    = u._tramitesVencidos ?? '?';
      const blocked  = u.blocked;
      const tr = document.createElement('tr');
      tr.className = 'dash-user-row' + (isMe ? ' dash-self-row' : '') + (blocked ? ' dash-blocked-row' : '');
      tr.innerHTML = `
        <td>
          <div class="dash-user-cell">
            <div class="dash-avatar-initials" style="${blocked?'background:var(--danger)':''}">
              ${(u.displayName||u.email||'?').slice(0,2).toUpperCase()}
            </div>
            <div>
              <div style="font-weight:600;font-size:13px">${u.displayName||'—'} ${blocked?'<span style="font-size:10px;background:var(--danger);color:#fff;padding:1px 5px;border-radius:6px">Bloqueado</span>':''}</div>
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
        <td class="dash-num" style="${nVenc>0?'color:var(--danger)':''}">
          ${nAct} ${nVenc>0?`<span style="font-size:11px;color:var(--danger)">(${nVenc} venc.)</span>`:''}
        </td>
        <td>
          <div style="display:flex;gap:4px;flex-wrap:wrap">
            ${!isMe ? `<button class="btn-small" data-viewtramites="${u.uid}" title="Ver trámites">📋 Ver</button>` : ''}
            ${!isMe ? `<button class="btn-small" data-resetpwd="${u.uid}" title="Enviar reset de contraseña">🔑</button>` : ''}
            ${!isMe ? `<button class="btn-small ${blocked?'':'btn-warning'}" data-toggleblock="${u.uid}" data-blocked="${blocked?'1':'0'}" title="${blocked?'Desbloquear':'Bloquear'} usuario">${blocked?'🔓':'🔒'}</button>` : ''}
            ${!isMe ? `<button class="btn-small btn-danger" data-deluser="${u.uid}" title="Eliminar usuario">✕</button>` : ''}
          </div>
        </td>`;
      tr.querySelector('.role-select')?.addEventListener('change', async e => {
        await db.collection('users').doc(u.uid).update({ role: e.target.value });
        showToast('Rol actualizado.'); u.role = e.target.value;
      });
      tr.querySelector('[data-viewtramites]')?.addEventListener('click', () => {
        openAdminTramitesModal(u);
      });
      tr.querySelector('[data-resetpwd]')?.addEventListener('click', async () => {
        if (!u.email) { showToast('Este usuario no tiene email registrado.'); return; }
        try {
          await auth.sendPasswordResetEmail(u.email);
          showToast(`✓ Email de recuperación enviado a ${u.email}`);
        } catch(e) { showToast('Error enviando email: ' + (e.message||e.code)); }
      });
      tr.querySelector('[data-toggleblock]')?.addEventListener('click', async btn => {
        const nowBlocked = !u.blocked;
        const ok = await showConfirm(nowBlocked
          ? `¿Bloquear a ${u.displayName||u.email}? No podrá iniciar sesión.`
          : `¿Desbloquear a ${u.displayName||u.email}?`);
        if (!ok) return;
        await db.collection('users').doc(u.uid).update({ blocked: nowBlocked });
        u.blocked = nowBlocked;
        showToast(nowBlocked ? 'Usuario bloqueado.' : 'Usuario desbloqueado.');
        renderDashboard();
      });
      tr.querySelector('[data-deluser]')?.addEventListener('click', async () => {
        const ok = await showConfirm(`¿Eliminar permanentemente a ${u.displayName||u.email}? Esta acción no se puede deshacer.`);
        if (!ok) return;
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
  if (members.length > 10) { showToast('El equipo puede tener máximo 10 miembros.'); return; }
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
  // Refresh pending panel in config view
  await renderPendingUsersPanel();
  const users = _dashUsers.length ? _dashUsers : [{ ...AUTH.userProfile }];
  const activeUsers = users.filter(u => u.approved !== false || u.role === 'admin' || u.uid === AUTH.userProfile.uid);
  el.innerHTML = '';
  activeUsers.forEach(u => {
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
// ============================================================
// ADMIN — VER/EDITAR TRÁMITES DE OTRO USUARIO
// ============================================================
let _adminViewUser = null;

function openAdminTramitesModal(u) {
  _adminViewUser = u;
  let overlay = document.getElementById('adminTramitesOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'adminTramitesOverlay';
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="modal modal-large" style="max-height:85vh">
        <div class="modal-header">
          <div>
            <h2 id="adminTramitesTitle">Trámites del usuario</h2>
            <div class="modal-subtitle" id="adminTramitesSubtitle"></div>
          </div>
          <button class="modal-close" id="adminTramitesClose">✕</button>
        </div>
        <div class="modal-body" style="padding:0">
          <div id="adminTramitesList" style="padding:16px"></div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById('adminTramitesClose').addEventListener('click', () => {
      overlay.classList.remove('open');
    });
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); });
  }

  document.getElementById('adminTramitesTitle').textContent = `Trámites de ${u.displayName||u.email}`;
  document.getElementById('adminTramitesSubtitle').textContent = `${u._tramitesActivos||0} activos · ${u._tramitesVencidos||0} vencidos`;

  const list = document.getElementById('adminTramitesList');
  const tramites = u._tramitesList || [];
  if (!tramites.length) {
    list.innerHTML = '<p style="color:var(--text-muted);font-style:italic;text-align:center;padding:32px">Este usuario no tiene trámites.</p>';
  } else {
    const hoy = today();
    list.innerHTML = '';
    const activos = tramites.filter(t => !t.terminado);
    const terminados = tramites.filter(t => t.terminado);
    [...activos, ...terminados].forEach(t => {
      const venc = t.fechaVencimiento;
      const isVenc = venc && venc < hoy && !t.terminado;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 12px;border-bottom:1px solid var(--border-light);cursor:pointer;transition:background .15s';
      row.innerHTML = `
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-family:var(--mono);font-size:12px;font-weight:700;color:var(--accent)">#${t.numero||'—'}</span>
            <span style="font-size:11px;background:var(--accent-light);color:var(--accent);padding:1px 6px;border-radius:8px">${t.modulo||''}</span>
            ${t.terminado ? '<span style="font-size:11px;background:var(--success-light);color:var(--success);padding:1px 6px;border-radius:8px">✓ Terminado</span>' : ''}
            ${isVenc ? '<span style="font-size:11px;background:var(--danger-light);color:var(--danger);padding:1px 6px;border-radius:8px">Vencido</span>' : ''}
          </div>
          <div style="font-size:13px;font-weight:500;color:var(--text-primary);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.descripcion||'Sin descripción'}</div>
          ${venc ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">Vence: ${formatDate(venc)}</div>` : ''}
        </div>
        <button class="btn-small" data-adminedit="${t.id}" style="flex-shrink:0">✎ Editar</button>`;
      row.addEventListener('mouseenter', () => row.style.background = 'var(--surface-2)');
      row.addEventListener('mouseleave', () => row.style.background = '');
      row.querySelector('[data-adminedit]').addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = await showConfirm(`Vas a editar el trámite #${t.numero} de ${u.displayName||u.email}. Cualquier cambio se guardará en su cuenta.`);
        if (!ok) return;
        // Cargar el trámite en STATE temporalmente y abrir modal de edición
        const existing = STATE.tramites.find(x => x.id === t.id);
        if (!existing) STATE.tramites.push(t);
        overlay.classList.remove('open');
        if (typeof openModal === 'function') {
          openModal(t);
          // Cuando se guarde, también guardar en el uid del otro usuario
          const origSave = window._adminSaveTarget;
          window._adminSaveTarget = u.uid;
        }
      });
      list.appendChild(row);
    });
  }

  overlay.classList.add('open');
}

// Intercept saveTramiteFS para admin editing otro usuario
const _originalSaveTramiteFS = typeof saveTramiteFS !== 'undefined' ? saveTramiteFS : null;

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
