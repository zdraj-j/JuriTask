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
  // Propagar _isOriginalAdmin y canCreateUsers al AUTH.userProfile
  const meInDash = _dashUsers.find(u => u.uid === AUTH.userProfile.uid);
  if (meInDash) {
    AUTH.userProfile._isOriginalAdmin = meInDash._isOriginalAdmin || false;
    AUTH.userProfile.canCreateUsers   = meInDash.canCreateUsers || false;
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
            <option value="user"  ${u.role!=='admin'?'selected':''}>Usuario</option>
            <option value="admin" ${u.role==='admin'?'selected':''}>Admin</option>
          </select>
        </td>
        <td>${equipo
          ? `<span style="font-size:12px;background:var(--accent-light);color:var(--accent);padding:2px 8px;border-radius:8px">${equipo.nombre}</span>`
          : '<span style="color:var(--text-muted);font-size:12px">Sin equipo</span>'}</td>
        <td class="dash-num" style="${nVenc>0?'color:var(--danger)':''}">
          ${nAct} ${nVenc>0?`<span style="font-size:11px;color:var(--danger)">(${nVenc} venc.)</span>`:''}
        </td>
        <td>
          <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center">
            ${!isMe ? `<button class="btn-small btn-icon-sm" data-viewtramites="${u.uid}" title="Ver trámites"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9.536V7a4 4 0 0 1 4-4h1.5a.5.5 0 0 1 .5.5V5a4 4 0 0 1-4 4 4 4 0 0 0-4 4c0 2 1 3 1 5a5 5 0 0 1-1 3"/><path d="M4 9a5 5 0 0 1 8 4 5 5 0 0 1-8-4"/><path d="M5 21h14"/></svg></button>` : ''}
            ${!isMe ? `<button class="btn-small btn-icon-sm" data-resetpwd="${u.uid}" title="Enviar reset de contraseña"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></svg></button>` : ''}
            ${(!isMe && u.role === 'admin' && !isOriginalAdmin && AUTH.userProfile._isOriginalAdmin) ? `<button class="btn-small btn-icon-sm ${u.canCreateUsers?'btn-warning':''}" data-togglecreate="${u.uid}" title="${u.canCreateUsers?'Quitar':'Dar'} permiso de crear usuarios"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/></svg></button>` : ''}
            ${canBlock ? `<button class="btn-small btn-icon-sm ${blocked?'':'btn-warning'}" data-toggleblock="${u.uid}" data-blocked="${blocked?'1':'0'}" title="${blocked?'Desbloquear':'Bloquear'} usuario"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 16v-2a2 2 0 0 0-4 0v2"/><path d="M9.5 15H7a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><rect x="13" y="16" width="8" height="5" rx=".899"/></svg></button>` : ''}
            ${canDelete ? `<button class="btn-small btn-icon-sm btn-danger" data-deluser="${u.uid}" title="Eliminar usuario"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg></button>` : ''}
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
      tr.querySelector('[data-togglecreate]')?.addEventListener('click', async () => {
        const newVal = !u.canCreateUsers;
        await db.collection('users').doc(u.uid).update({ canCreateUsers: newVal });
        u.canCreateUsers = newVal;
        showToast(newVal ? 'Permiso de crear usuarios concedido.' : 'Permiso de crear usuarios revocado.');
        renderDashboard();
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

  // Poblar selector de usuario para notificaciones
  const msgTarget = document.getElementById('adminMsgTarget');
  if (msgTarget) {
    msgTarget.innerHTML = '<option value="all">Todos los usuarios</option>';
    _dashUsers.filter(u => u.uid !== AUTH.userProfile.uid).forEach(u => {
      const o = document.createElement('option');
      o.value = u.uid;
      o.textContent = u.displayName || u.email || u.uid;
      msgTarget.appendChild(o);
    });
  }

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
      vbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px">¡No hay trámites vencidos! <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01"/><path d="M22 8h.01"/><path d="M15 2h.01"/><path d="M22 20h.01"/><path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/><path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17"/><path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7"/><path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z"/></svg></td></tr>';
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
      <div class="dash-team-name"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m10.586 5.414-5.172 5.172"/><path d="m18.586 13.414-5.172 5.172"/><path d="M6 12h12"/><circle cx="12" cy="20" r="2"/><circle cx="12" cy="4" r="2"/><circle cx="20" cy="12" r="2"/><circle cx="4" cy="12" r="2"/></svg> ${eq.nombre}</div>
      <div class="dash-team-meta">${memberCount} miembro${memberCount!==1?'s':''}</div>
      <div class="dash-team-actions">
        <button class="btn-small" data-editteam="${eq.id}"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/></svg> Editar</button>
        <button class="btn-small btn-danger" data-delteam="${eq.id}"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> Eliminar</button>
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
      <span>${u.displayName||u.email}${u.role==='admin'?' <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;color:var(--warning)"><path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path d="M5 21h14"/></svg>':''}</span>`;
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

// ── Crear usuario desde el admin ──────────────────────────────
async function adminCreateUser() {
  const displayName = document.getElementById('newUserDisplayName')?.value.trim();
  const username    = document.getElementById('newUserUsername')?.value.trim();
  const password    = document.getElementById('newUserPassword')?.value;

  if (!displayName) { showToast('El nombre completo es obligatorio.'); return; }
  if (!username)    { showToast('El nombre de usuario es obligatorio.'); return; }
  if (!password || password.length < 6) { showToast('La contraseña debe tener al menos 6 caracteres.'); return; }

  // Validar que el username solo tenga caracteres válidos
  const cleanUser = username.toLowerCase().replace(/\s/g, '');
  if (!/^[a-z0-9._-]+$/.test(cleanUser)) {
    showToast('El usuario solo puede tener letras, números, puntos, guiones.');
    return;
  }

  const fakeEmail = cleanUser + '@juritask.local';
  const btn = document.getElementById('adminCreateUserBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Creando…'; }

  try {
    // Usar app secundaria para no desloguear al admin
    const tempName = 'tempCreate_' + Date.now();
    const secondaryApp  = firebase.initializeApp(firebaseConfig, tempName);
    const secondaryAuth = secondaryApp.auth();
    const secondaryDb   = secondaryApp.firestore();

    try {
      const cred = await secondaryAuth.createUserWithEmailAndPassword(fakeEmail, password);
      const newUid = cred.user.uid;
      await cred.user.updateProfile({ displayName });

      // Crear perfil en Firestore (usando el contexto auth del nuevo usuario)
      await secondaryDb.collection('users').doc(newUid).set({
        displayName,
        email:        fakeEmail,
        username:     cleanUser,
        role:         'user',
        approved:     true,
        blocked:      false,
        adminCreated: true,
        creadoEn:     new Date().toISOString(),
      });

      await secondaryAuth.signOut();

      // Registrar en userIndex (usando la db principal como admin)
      await registerInUserIndex(newUid);

      // Limpiar campos
      if (document.getElementById('newUserDisplayName')) document.getElementById('newUserDisplayName').value = '';
      if (document.getElementById('newUserUsername'))    document.getElementById('newUserUsername').value = '';
      if (document.getElementById('newUserPassword'))    document.getElementById('newUserPassword').value = '';

      const resultEl = document.getElementById('createUserResult');
      if (resultEl) {
        resultEl.innerHTML = `
          <div style="background:var(--success-light,#f0fdf4);border:1px solid var(--success,#16a34a);border-radius:10px;padding:14px 16px;margin-top:10px">
            <div style="font-size:13px;font-weight:600;color:var(--success,#16a34a);margin-bottom:4px">✓ Usuario creado</div>
            <div style="font-size:12px;color:var(--text-secondary)">
              <strong>${displayName}</strong> puede iniciar sesión con usuario <strong>${cleanUser}</strong> y la contraseña asignada.
            </div>
          </div>`;
        setTimeout(() => { resultEl.innerHTML = ''; }, 8000);
      }

      showToast(`✓ Usuario "${displayName}" creado.`);
      renderDashboard();
    } finally {
      try { await secondaryApp.delete(); } catch(_) {}
    }
  } catch(e) {
    if (e.code === 'auth/email-already-in-use') {
      showToast('Ya existe un usuario con ese nombre de usuario.');
    } else {
      showToast('Error: ' + (e.message || e.code));
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '＋ Crear usuario'; }
  }
}

// ── Función de compatibilidad (llamada desde config.js) ───────
async function loadAdminUsers() {
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
    renderDashboard();
  });
  document.getElementById('dashCreateTeamBtn')?.addEventListener('click', () => openTeamModal());
  document.getElementById('createTeamClose')?.addEventListener('click', closeTeamModal);
  document.getElementById('createTeamClose2')?.addEventListener('click', closeTeamModal);
  document.getElementById('confirmCreateTeamBtn')?.addEventListener('click', saveTeam);
  document.getElementById('createTeamOverlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('createTeamOverlay')) closeTeamModal();
  });
  document.getElementById('adminCreateUserBtn')?.addEventListener('click', adminCreateUser);
}

function loadDashboardData() {
  renderDashboard();
  if (AUTH.userProfile?.role === 'admin') {
    startPendingListener();
    // Mostrar sección de crear usuario si tiene permiso
    _updateCreateUserVisibility();
  }
}

function _updateCreateUserVisibility() {
  const section = document.getElementById('createUserSection');
  if (!section) return;
  const p = AUTH.userProfile;
  if (!p || p.role !== 'admin') { section.style.display = 'none'; return; }
  // Admin principal siempre puede crear usuarios
  // Otros admins necesitan canCreateUsers=true
  const isOriginal = _dashUsers.find(u => u.uid === p.uid && u._isOriginalAdmin);
  section.style.display = (isOriginal || p.canCreateUsers) ? '' : 'none';
}
