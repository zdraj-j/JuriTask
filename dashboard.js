/**
 * JuriTask — dashboard.js
 * Backups automáticos en Firestore + gestión de usuarios (solo admin).
 */

// ============================================================
// BACKUPS
// ============================================================
async function createBackup() {
  if (!AUTH.userProfile?.uid) return;
  const snap = {
    creadoEn: new Date().toISOString(),
    tramites: STATE.tramites,
    order:    STATE.order,
    config:   STATE.config,
  };
  await db.collection('users').doc(AUTH.userProfile.uid)
    .collection('backups').add(snap);
}

async function renderBackupList() {
  const el = document.getElementById('backupList');
  if (!el || !AUTH.userProfile?.uid) return;
  el.innerHTML = '<p style="font-size:13px;color:var(--text-muted)">Cargando…</p>';
  try {
    const snap = await db.collection('users').doc(AUTH.userProfile.uid)
      .collection('backups').orderBy('creadoEn', 'desc').limit(10).get();

    if (snap.empty) { el.innerHTML = '<p style="font-size:13px;color:var(--text-muted)">No hay backups aún.</p>'; return; }

    el.innerHTML = '';
    snap.forEach(doc => {
      const b   = doc.data();
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border-light);gap:8px';
      const fecha = new Date(b.creadoEn).toLocaleString('es-CO', { dateStyle:'short', timeStyle:'short' });
      const count = (b.tramites||[]).length;
      row.innerHTML = `
        <span style="font-size:13px">📦 ${fecha} <span style="color:var(--text-muted)">(${count} trámites)</span></span>
        <div style="display:flex;gap:6px">
          <button class="btn-small" data-id="${doc.id}">↩ Restaurar</button>
          <button class="btn-small btn-danger" data-del="${doc.id}">✕</button>
        </div>`;
      row.querySelector('[data-id]').addEventListener('click', () => restoreBackup(doc.id, b));
      row.querySelector('[data-del]').addEventListener('click', () => deleteBackup(doc.id));
      el.appendChild(row);
    });
  } catch(e) {
    el.innerHTML = '<p style="font-size:13px;color:var(--danger)">Error cargando backups.</p>';
  }
}

async function restoreBackup(id, b) {
  if (!confirm(`¿Restaurar el backup del ${new Date(b.creadoEn).toLocaleString('es-CO')}?\nSe reemplazarán todos los trámites actuales.`)) return;
  if (b.tramites) STATE.tramites = b.tramites;
  if (b.order)    STATE.order    = b.order;
  if (b.config)   STATE.config   = Object.assign({ ...DEFAULT_CONFIG }, b.config);
  saveAll(true);
  applyCssColors();
  applyTheme(STATE.config.theme || 'claro');
  populateModuloSelects();
  updateAbogadoSelects();
  renderAll();
  showToast('✓ Backup restaurado.');
}

async function deleteBackup(id) {
  if (!confirm('¿Eliminar este backup?')) return;
  await db.collection('users').doc(AUTH.userProfile.uid).collection('backups').doc(id).delete();
  renderBackupList();
  showToast('Backup eliminado.');
}

// Backup automático cada 2 horas
function startAutoBackup() {
  if (!AUTH.userProfile?.uid) return;
  setInterval(async () => {
    try {
      await createBackup();
      // Limpiar backups de más de 24 horas
      const cutoff = new Date(Date.now() - 24*60*60*1000).toISOString();
      const old = await db.collection('users').doc(AUTH.userProfile.uid)
        .collection('backups').where('creadoEn', '<', cutoff).get();
      old.forEach(doc => doc.ref.delete());
    } catch(e) { console.warn('Error en backup automático:', e); }
  }, 2 * 60 * 60 * 1000);
}

// ============================================================
// GESTIÓN DE USUARIOS (solo admin)
// ============================================================
async function loadAdminUsers() {
  const el = document.getElementById('adminUserList');
  if (!el) return;
  if (AUTH.userProfile?.role !== 'admin') return;

  el.innerHTML = '<p style="font-size:13px;color:var(--text-muted)">Cargando usuarios…</p>';
  try {
    const snap = await db.collection('users').get();
    if (snap.empty) { el.innerHTML = '<p style="font-size:13px;color:var(--text-muted)">No hay usuarios registrados.</p>'; return; }

    el.innerHTML = '';
    snap.forEach(doc => {
      const u   = doc.data();
      const uid = doc.id;
      if (!u.email) return; // saltar documentos sin email (como subcollecciones mal guardadas)

      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border-light);flex-wrap:wrap';

      const isMe = uid === AUTH.userProfile.uid;
      row.innerHTML = `
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:13px">${u.displayName || '(sin nombre)'} ${isMe ? '<span style="color:var(--text-muted)">(tú)</span>' : ''}</div>
          <div style="font-size:12px;color:var(--text-secondary)">${u.email}</div>
        </div>
        <select class="role-select" data-uid="${uid}" style="font-size:12px;padding:4px 8px;border-radius:6px;border:1px solid var(--border)" ${isMe ? 'disabled' : ''}>
          <option value="user"  ${u.role !== 'admin' ? 'selected' : ''}>👤 Usuario</option>
          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>👑 Admin</option>
        </select>
        ${!isMe ? `<button class="btn-small btn-danger del-user-btn" data-uid="${uid}" title="Eliminar usuario">✕</button>` : ''}
      `;

      // Cambiar rol
      row.querySelector('.role-select')?.addEventListener('change', async e => {
        const newRole = e.target.value;
        await db.collection('users').doc(uid).update({ role: newRole });
        showToast(`Rol de ${u.displayName || u.email} actualizado a ${newRole}.`);
      });

      // Eliminar usuario (solo borra de Firestore, no de Auth)
      row.querySelector('.del-user-btn')?.addEventListener('click', async () => {
        if (!confirm(`¿Eliminar a ${u.displayName || u.email} de la lista?\nNota: esto no elimina su cuenta de acceso.`)) return;
        await db.collection('users').doc(uid).delete();
        loadAdminUsers();
        showToast('Usuario eliminado.');
      });

      el.appendChild(row);
    });
  } catch(e) {
    el.innerHTML = '<p style="font-size:13px;color:var(--danger)">Error cargando usuarios. Verifica los permisos de Firestore.</p>';
    console.error(e);
  }
}
