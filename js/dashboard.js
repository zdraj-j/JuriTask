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
    console.error('Error cargando backups:', e);
    el.innerHTML = `<p style="font-size:13px;color:var(--danger)">Error cargando backups: ${e.code || e.message}</p>`;
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
// DASHBOARD
// ============================================================
let _dashUsers   = [];
let _dashEquipos = [];
let _ghostUids   = []; // UIDs en userIndex sin doc en Firestore

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

  // Leer cada perfil de usuario individualmente + sus trámites (en paralelo)
  _dashUsers = [];
  _ghostUids = [];
  let totalTramitesAll = 0;
  let totalVencidosAll = 0;

  const userPromises = [...knownUids].map(async (uid) => {
    try {
      const uDoc = await db.collection('users').doc(uid).get();
      if (!uDoc.exists && uid !== AUTH.userProfile.uid) {
        _ghostUids.push(uid); // UID en userIndex sin doc → fantasma
      }
      let userData = uDoc.exists ? { uid, ...uDoc.data() } : (uid === AUTH.userProfile.uid ? { ...AUTH.userProfile } : null);
      if (!userData) return null;
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
        userData._tramitesList     = uTramites;
        return { userData, activosCount: uActivos.length, vencidosCount: uVencidos.length, isSelf: uid === AUTH.userProfile.uid };
      } catch(e) {
        userData._tramitesActivos  = uid === AUTH.userProfile.uid ? activos.length : '?';
        userData._tramitesVencidos = uid === AUTH.userProfile.uid ? vencidos.length : '?';
        userData._tramitesList     = uid === AUTH.userProfile.uid ? STATE.tramites : [];
        return { userData, activosCount: uid === AUTH.userProfile.uid ? activos.length : 0, vencidosCount: uid === AUTH.userProfile.uid ? vencidos.length : 0, isSelf: uid === AUTH.userProfile.uid };
      }
    } catch(e) {
      if (uid === AUTH.userProfile.uid) {
        return { userData: { ...AUTH.userProfile, _tramitesActivos: activos.length, _tramitesVencidos: vencidos.length, _tramitesList: STATE.tramites }, activosCount: activos.length, vencidosCount: vencidos.length, isSelf: true };
      }
      return null;
    }
  });

  const results = await Promise.all(userPromises);
  results.forEach(r => {
    if (!r) return;
    _dashUsers.push(r.userData);
    totalTramitesAll += r.activosCount;
    if (!r.isSelf) totalVencidosAll += r.vencidosCount;
  });

  // Determinar el admin original (primer admin registrado basado en fecha de creación)
  const admins = _dashUsers.filter(u => u.role === 'admin');
  if (admins.length) {
    admins.sort((a, b) => (a.creadoEn || '9999').localeCompare(b.creadoEn || '9999'));
    admins[0]._isOriginalAdmin = true;
  }
  if (!_dashUsers.length) {
    _dashUsers = [{ ...AUTH.userProfile, _tramitesActivos: activos.length, _tramitesVencidos: vencidos.length, _tramitesList: STATE.tramites }];
  }
  totalVencidosAll += vencidos.length;

  // KPIs — usar totales reales de todos los usuarios
  setText('kpiUsuarios',    _dashUsers.length);
  setText('kpiTramites',    totalTramitesAll || activos.length);
  setText('kpiVencidos',    totalVencidosAll || vencidos.length);
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
      const equipo   = _dashEquipos.find(e => (e.members||[]).includes(u.uid));
      const isMe     = u.uid === AUTH.userProfile.uid;
      const nAct     = u._tramitesActivos  ?? '?';
      const nVenc    = u._tramitesVencidos ?? '?';
      const blocked  = u.blocked;
      const tr = document.createElement('tr');
      // Determinar si el usuario es el admin original (primer administrador)
      const isOriginalAdmin = u.role === 'admin' && u._isOriginalAdmin;
      const canChangeRole = !isMe && !isOriginalAdmin;
      const canBlock = !isMe && !isOriginalAdmin;
      const canDelete = !isMe && !isOriginalAdmin;
      tr.className = 'dash-user-row' + (isMe ? ' dash-self-row' : '') + (blocked ? ' dash-blocked-row' : '');
      tr.innerHTML = `
        <td>
          <div class="dash-user-cell">
            <div class="dash-avatar-initials" style="${blocked?'background:var(--danger)':''}">
              ${(u.displayName||u.email||'?').slice(0,2).toUpperCase()}
            </div>
            <div>
              <div style="font-weight:600;font-size:13px">${u.displayName||'—'} ${blocked?'<span style="font-size:10px;background:var(--danger);color:#fff;padding:1px 5px;border-radius:6px">Bloqueado</span>':''}${isOriginalAdmin?'<span style="font-size:10px;background:var(--accent);color:#fff;padding:1px 5px;border-radius:6px;margin-left:4px">Admin principal</span>':''}</div>
              ${isMe ? '<span class="dash-self-badge">Tú</span>' : ''}
            </div>
          </div>
        </td>
        <td class="dash-email">${u.email||'—'}</td>
        <td>
          <select class="role-select" data-uid="${u.uid}" ${!canChangeRole?'disabled':''} style="font-size:12px;padding:3px 6px;border-radius:6px;border:1px solid var(--border)${!canChangeRole?';opacity:.6':''}">
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
            ${canBlock ? `<button class="btn-small ${blocked?'':'btn-warning'}" data-toggleblock="${u.uid}" data-blocked="${blocked?'1':'0'}" title="${blocked?'Desbloquear':'Bloquear'} usuario">${blocked?'🔓':'🔒'}</button>` : ''}
            ${canDelete ? `<button class="btn-small btn-danger" data-deluser="${u.uid}" title="Eliminar usuario">✕</button>` : ''}
          </div>
        </td>`;
      tr.querySelector('.role-select')?.addEventListener('change', async e => {
        if (isOriginalAdmin) {
          e.target.value = u.role;
          showToast('No puedes cambiar el rol del administrador principal.');
          return;
        }
        const newRole = e.target.value;
        if (newRole === 'admin') {
          const ok = await showConfirm(`¿Convertir a ${u.displayName||u.email} en administrador? Tendrá acceso al panel de administración, pero NO podrá modificar al administrador principal.`);
          if (!ok) { e.target.value = u.role; return; }
        }
        await db.collection('users').doc(u.uid).update({ role: newRole });
        showToast('Rol actualizado.'); u.role = newRole;
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
        // Limpiar userIndex para que el UID no quede como fantasma
        db.collection('meta').doc('userIndex').update({
          uids: firebase.firestore.FieldValue.arrayRemove(u.uid)
        }).catch(() => {});
        // Guardar email para mejorar mensajes de re-registro
        if (u.email) {
          db.collection('meta').doc('deletedEmails').set({
            emails: firebase.firestore.FieldValue.arrayUnion(u.email)
          }, { merge: true }).catch(() => {});
        }
        showToast('Usuario eliminado.'); renderDashboard();
      });
      tbody.appendChild(tr);
    });
  }

  renderTeamsGrid(_dashEquipos);

  // Mostrar botón de purga si hay fantasmas
  const purgeBtn = document.getElementById('dashPurgeGhostsBtn');
  if (purgeBtn) {
    purgeBtn.style.display = _ghostUids.length ? '' : 'none';
    purgeBtn.textContent = `🧹 Purgar ${_ghostUids.length} fantasma${_ghostUids.length !== 1 ? 's' : ''}`;
    purgeBtn.onclick = purgeGhostUids;
  }

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

// ── Purgar UIDs fantasma del índice ───────────────────────────
async function purgeGhostUids() {
  if (!_ghostUids.length) { showToast('No hay fantasmas que purgar.'); return; }
  const ok = await showConfirm(`¿Eliminar ${_ghostUids.length} UID${_ghostUids.length !== 1 ? 's' : ''} fantasma del índice? Esto limpia registros de cuentas que ya fueron eliminadas.`);
  if (!ok) return;
  try {
    await db.collection('meta').doc('userIndex').update({
      uids: firebase.firestore.FieldValue.arrayRemove(..._ghostUids)
    });
    showToast(`✓ ${_ghostUids.length} fantasma${_ghostUids.length !== 1 ? 's' : ''} eliminado${_ghostUids.length !== 1 ? 's' : ''} del índice.`);
    renderDashboard();
  } catch(e) {
    showToast('Error purgando: ' + (e.message || e.code));
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
  // Leer miembros anteriores ANTES de actualizar (para saber quién fue removido)
  let oldMembers = [];
  if (id) {
    try {
      const oldDoc = await db.collection('teams').doc(id).get();
      oldMembers = oldDoc.exists ? (oldDoc.data().members || []) : [];
    } catch(_) {}
    await db.collection('teams').doc(id).update(data); teamId = id;
  } else {
    data.creadoEn = new Date().toISOString();
    const ref = await db.collection('teams').add(data); teamId = ref.id;
  }
  // Asignar teamId a los miembros seleccionados
  for (const uid of members) {
    await db.collection('users').doc(uid).update({ teamId }).catch(()=>{});
  }
  // Limpiar teamId solo de usuarios que estaban en ESTE equipo y fueron removidos
  for (const uid of oldMembers) {
    if (!members.includes(uid)) {
      await db.collection('users').doc(uid).update({ teamId: null }).catch(()=>{});
    }
  }
  showToast(`✓ Equipo "${nombre}" guardado.`);
  closeTeamModal(); renderDashboard();
}

// ============================================================
// GESTIÓN USUARIOS — Listener en tiempo real, aprobación, invitaciones
// ============================================================

// ── Listener en tiempo real para usuarios pendientes ─────────
let _pendingListener = null;

function startPendingListener() {
  if (_pendingListener) return;
  if (AUTH.userProfile?.role !== 'admin') return;

  _pendingListener = db.collection('users')
    .where('approved', '==', false)
    .where('blocked',  '==', false)
    .onSnapshot(snap => {
      const pending = [];
      snap.forEach(doc => {
        const d = doc.data();
        if (d.role !== 'admin') pending.push({ uid: doc.id, ...d });
      });
      // Actualizar badge en el nav del dashboard
      _updatePendingBadge(pending.length);
      // Si el dashboard está visible, actualizar la tabla
      const dashView = document.getElementById('view-dashboard');
      if (dashView && dashView.classList.contains('active')) {
        _renderPendingTable(pending);
      }
    }, err => console.warn('Pending listener error:', err.code));
}

function stopPendingListener() {
  if (_pendingListener) { _pendingListener(); _pendingListener = null; }
}

function _updatePendingBadge(count) {
  // KPI card
  const kpiEl = document.getElementById('kpiPendientes');
  if (kpiEl) kpiEl.textContent = count || '0';

  // Badge rojo en el nav
  const navBtn = document.querySelector('.nav-item[data-view="dashboard"]');
  if (!navBtn) return;
  let badge = navBtn.querySelector('.pending-nav-badge');
  if (count > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'pending-nav-badge';
      badge.style.cssText = 'display:inline-block;margin-left:6px;background:#ef4444;color:#fff;border-radius:10px;padding:0 6px;font-size:10px;font-weight:700;line-height:16px;vertical-align:middle';
      navBtn.appendChild(badge);
    }
    badge.textContent = count;
  } else if (badge) {
    badge.remove();
  }
}

function _renderPendingTable(pending) {
  const section = document.getElementById('pendingUsersSection');
  const tbody   = document.getElementById('pendingUsersBody');
  const label   = document.getElementById('pendingCountLabel');
  if (!section || !tbody) return;

  section.style.display = pending.length ? '' : 'none';
  if (label) label.textContent = `${pending.length} pendiente${pending.length !== 1 ? 's' : ''}`;
  tbody.innerHTML = '';

  pending.forEach(u => {
    const fecha = u.creadoEn
      ? new Date(u.creadoEn).toLocaleString('es-CO', { dateStyle:'short', timeStyle:'short' })
      : '—';
    // emailVerified no está en Firestore — lo inferimos: si aprobado=false y no bloqueado,
    // no podemos saber si verificó. Mostramos la fecha de registro solamente.
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div class="dash-user-cell">
          <div class="dash-avatar-initials" style="width:32px;height:32px;font-size:12px">
            ${(u.displayName||u.email||'?').slice(0,2).toUpperCase()}
          </div>
          <div>
            <div style="font-weight:600;font-size:13px">${u.displayName||'(sin nombre)'}</div>
            <div style="font-size:11px;color:var(--text-muted)">${fecha}</div>
          </div>
        </div>
      </td>
      <td class="dash-email">${u.email||'—'}</td>
      <td><span style="font-size:11px;background:var(--warning-light,#fef3c7);color:var(--warning-dark,#92400e);padding:2px 8px;border-radius:20px;font-weight:600">⏳ Pendiente</span></td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn-small" style="background:var(--success,#16a34a);color:#fff;border:none;border-radius:8px" data-approve="${u.uid}">✓ Aprobar</button>
          <button class="btn-small btn-danger" data-reject="${u.uid}">✕ Rechazar</button>
        </div>
      </td>`;
    tr.querySelector('[data-approve]').addEventListener('click', async () => {
      await db.collection('users').doc(u.uid).update({ approved: true, blocked: false });
      showToast(`✓ ${u.displayName||u.email} aprobado. Ya puede acceder.`);
      // El listener actualizará la tabla automáticamente
    });
    tr.querySelector('[data-reject]').addEventListener('click', async () => {
      const ok = await showConfirm(`¿Rechazar y bloquear a ${u.displayName||u.email}?`);
      if (!ok) return;
      await db.collection('users').doc(u.uid).update({ approved: false, blocked: true });
      showToast('Usuario rechazado y bloqueado.');
    });
    tbody.appendChild(tr);
  });
}

// ── Invitaciones ──────────────────────────────────────────────
async function createInvitation() {
  const emailEl = document.getElementById('inviteEmailInput');
  const noteEl  = document.getElementById('inviteNoteInput');
  const email   = emailEl ? emailEl.value.trim().toLowerCase() : '';
  if (!email || !email.includes('@')) { showToast('Ingresa un correo válido.'); return; }

  const code = Math.random().toString(36).slice(2, 10).toUpperCase();
  const data = {
    email,
    note:      noteEl ? noteEl.value.trim() : '',
    code,
    createdBy: AUTH.userProfile.uid,
    createdAt: new Date().toISOString(),
    used:      false,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };

  const btn = document.getElementById('createInviteBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Creando…'; }

  try {
    await db.collection('invitations').add(data);
    if (emailEl) emailEl.value = '';
    if (noteEl)  noteEl.value  = '';

    const invLink = `https://zdraj-j.github.io/JuriTask/?invite=${code}`;
    _showInviteResult(email, code, invLink);
    showToast('✓ Invitación creada.');
    loadInvitations();
  } catch(e) {
    showToast('Error: ' + (e.message || e.code));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '＋ Crear invitación'; }
  }
}

function _showInviteResult(email, code, link) {
  const el = document.getElementById('inviteResult');
  if (!el) return;
  el.style.display = '';
  el.innerHTML = `
    <div style="background:var(--success-light,#f0fdf4);border:1px solid var(--success,#16a34a);border-radius:10px;padding:14px 16px;margin-top:14px">
      <div style="font-size:13px;font-weight:600;color:var(--success,#16a34a);margin-bottom:10px">✓ Invitación generada para <strong>${email}</strong></div>
      <div style="display:flex;align-items:center;gap:8px">
        <code style="flex:1;font-size:11px;background:var(--surface-2);padding:7px 10px;border-radius:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block">${link}</code>
        <button class="btn-small" onclick="navigator.clipboard.writeText('${link}').then(()=>showToast('✓ Link copiado'))">📋 Copiar</button>
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:6px">Código: <strong>${code}</strong> · Expira en 7 días · El usuario que use este link se aprueba automáticamente</div>
    </div>`;
}

async function loadInvitations() {
  const list = document.getElementById('invitationsList');
  if (!list || AUTH.userProfile?.role !== 'admin') return;
  list.innerHTML = '<p style="font-size:12px;color:var(--text-muted)">Cargando…</p>';
  try {
    const snap = await db.collection('invitations')
      .orderBy('createdAt', 'desc').limit(15).get();
    if (snap.empty) {
      list.innerHTML = '<p style="font-size:13px;color:var(--text-muted);font-style:italic">No hay invitaciones creadas.</p>';
      return;
    }
    list.innerHTML = '';
    const now = new Date().toISOString();
    snap.forEach(doc => {
      const inv = { id: doc.id, ...doc.data() };
      const expired = inv.expiresAt < now;
      const st = inv.used ? { label:'✓ Usada', bg:'var(--success-light)', color:'var(--success)' }
               : expired  ? { label:'Expirada', bg:'var(--danger-light)', color:'var(--danger)' }
               : { label:'Pendiente', bg:'var(--accent-light)', color:'var(--accent)' };
      const link = `https://zdraj-j.github.io/JuriTask/?invite=${inv.code}`;
      const row = document.createElement('div');
      row.style.cssText = 'padding:10px 0;border-bottom:1px solid var(--border-light)';
      const usedByText = inv.used && inv.usedBy ? ` · Usado por: ${inv.usedBy}` : '';
      row.innerHTML = `
        <div style="display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap">
          <div style="flex:1;min-width:180px">
            <div style="font-size:13px;font-weight:600;margin-bottom:3px">${inv.email}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">
              ${inv.note ? `"${inv.note}" · ` : ''}Código: <strong>${inv.code}</strong> · ${new Date(inv.createdAt).toLocaleDateString('es-CO')}${usedByText}
            </div>
            <div style="font-size:11px;color:var(--text-secondary);word-break:break-all;user-select:all">${link}</div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;flex-wrap:wrap">
            <span style="font-size:11px;padding:2px 8px;border-radius:20px;font-weight:600;background:${st.bg};color:${st.color}">${st.label}</span>
            <button class="btn-small" onclick="navigator.clipboard.writeText('${link}').then(()=>showToast('✓ Copiado'))" title="Copiar link" ${inv.used ? 'style="opacity:.5"' : ''}>📋 Copiar</button>
            ${!inv.used ? `<button class="btn-small btn-danger" data-delinv="${doc.id}" title="Eliminar">✕</button>` : ''}
          </div>
        </div>`;
      row.querySelector('[data-delinv]')?.addEventListener('click', async () => {
        await db.collection('invitations').doc(inv.id).delete();
        showToast('Invitación eliminada.'); loadInvitations();
      });
      list.appendChild(row);
    });
  } catch(e) {
    list.innerHTML = `<p style="font-size:13px;color:var(--danger)">Error cargando invitaciones: ${e.code||e.message}</p>`;
  }
}

// ── Función de compatibilidad (llamada desde config.js) ───────
async function loadAdminUsers() {
  // La gestión completa está en el dashboard.
  // Esta función solo arranca el listener si no está activo.
  if (AUTH.userProfile?.role === 'admin') startPendingListener();
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
  document.getElementById('dashRefreshBtn')?.addEventListener('click', () => {
    renderDashboard(); loadInvitations();
  });
  document.getElementById('dashCreateTeamBtn')?.addEventListener('click', () => openTeamModal());
  document.getElementById('createTeamClose')?.addEventListener('click', closeTeamModal);
  document.getElementById('createTeamClose2')?.addEventListener('click', closeTeamModal);
  document.getElementById('confirmCreateTeamBtn')?.addEventListener('click', saveTeam);
  document.getElementById('createTeamOverlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('createTeamOverlay')) closeTeamModal();
  });
  document.getElementById('createInviteBtn')?.addEventListener('click', createInvitation);
}

// Alias para config.js — al navegar al dashboard, arrancar listener y cargar invitaciones
function loadDashboardData() {
  renderDashboard();
  if (AUTH.userProfile?.role === 'admin') {
    startPendingListener();
    loadInvitations();
  }
}
