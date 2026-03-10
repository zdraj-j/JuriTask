/**
 * JuriTask — notifications.js
 * Sistema de notificaciones: tareas asignadas por compañeros y mensajes del admin.
 * Requiere firebase.js (auth + db) cargado antes.
 */

let _notifUnsubscribe = null;
let _notifList        = [];

// ============================================================
// INICIAR LISTENER
// ============================================================
function initNotifications() {
  const uid = (typeof AUTH !== 'undefined') && AUTH.userProfile?.uid;
  if (!uid || typeof db === 'undefined') return;

  if (_notifUnsubscribe) _notifUnsubscribe();

  _notifUnsubscribe = db.collection('users').doc(uid)
    .collection('notifications')
    .orderBy('createdAt', 'desc')
    .limit(30)
    .onSnapshot(snap => {
      _notifList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const unread = _notifList.filter(n => !n.read).length;
      _updateNotifBadge(unread);
    }, () => {/* silenciar errores de permisos */});
}

function stopNotifications() {
  if (_notifUnsubscribe) { _notifUnsubscribe(); _notifUnsubscribe = null; }
}

// ============================================================
// BADGE
// ============================================================
function _updateNotifBadge(count) {
  const badge = document.getElementById('notifBadge');
  if (!badge) return;
  badge.textContent    = count > 99 ? '99+' : String(count);
  badge.style.display  = count === 0 ? 'none' : '';
}

// ============================================================
// PANEL TOGGLE
// ============================================================
function toggleNotifPanel() {
  const panel = document.getElementById('notifPanel');
  const btn   = document.getElementById('notifBtn');
  if (!panel) return;

  const isOpen = panel.classList.toggle('open');
  if (isOpen) {
    _renderNotifPanel();
    _markAllRead();
    // Cerrar al hacer click fuera
    setTimeout(() => {
      function onOut(e) {
        if (!panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
          panel.classList.remove('open');
          document.removeEventListener('click', onOut);
        }
      }
      document.addEventListener('click', onOut);
    }, 50);
  }
}

// ============================================================
// RENDER PANEL
// ============================================================
function _renderNotifPanel() {
  const panel = document.getElementById('notifPanel');
  if (!panel) return;

  if (!_notifList.length) {
    panel.innerHTML = '<p class="notif-empty">Sin notificaciones.</p>';
    return;
  }

  panel.innerHTML = `
    <div class="notif-header">
      <span>Notificaciones</span>
      <button class="notif-clear-btn" onclick="_clearAllNotifications()">Borrar todo</button>
    </div>
    ${_notifList.map(n => `
      <div class="notif-item${n.read ? '' : ' unread'}">
        <div class="notif-msg">${escapeHtml(n.message || '')}</div>
        ${n.fromName ? `<div class="notif-from">De: ${escapeHtml(n.fromName)}</div>` : ''}
        <div class="notif-time">${_notifTimeAgo(n.createdAt)}</div>
      </div>
    `).join('')}`;
}

function _notifTimeAgo(isoStr) {
  if (!isoStr) return '';
  try {
    const diff = Date.now() - new Date(isoStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1)  return 'Ahora mismo';
    if (mins < 60) return `Hace ${mins} min`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `Hace ${hrs}h`;
    return new Date(isoStr).toLocaleDateString('es-CO', { day:'numeric', month:'short' });
  } catch(_) { return ''; }
}

// ============================================================
// MARCAR COMO LEÍDAS
// ============================================================
async function _markAllRead() {
  const uid = (typeof AUTH !== 'undefined') && AUTH.userProfile?.uid;
  if (!uid) return;
  const unread = _notifList.filter(n => !n.read);
  if (!unread.length) return;
  const batch = db.batch();
  unread.forEach(n => {
    batch.update(
      db.collection('users').doc(uid).collection('notifications').doc(n.id),
      { read: true }
    );
  });
  await batch.commit().catch(() => {});
}

async function _clearAllNotifications() {
  const uid = (typeof AUTH !== 'undefined') && AUTH.userProfile?.uid;
  if (!uid) return;
  const batch = db.batch();
  _notifList.forEach(n => {
    batch.delete(db.collection('users').doc(uid).collection('notifications').doc(n.id));
  });
  await batch.commit().catch(() => {});
  document.getElementById('notifPanel')?.classList.remove('open');
}

// ============================================================
// CREAR NOTIFICACIÓN PARA OTRO USUARIO
// ============================================================
async function createNotification(toUid, type, message, extra = {}) {
  if (!toUid) return;
  const myUid = (typeof AUTH !== 'undefined') && AUTH.userProfile?.uid;
  if (toUid === myUid) return; // no notificarse a sí mismo
  if (typeof db === 'undefined') return;
  try {
    await db.collection('users').doc(toUid).collection('notifications').add({
      type,
      message,
      fromUid:  myUid  || '',
      fromName: (typeof AUTH !== 'undefined') ? (AUTH.userProfile?.displayName || AUTH.userProfile?.email || '') : '',
      read:      false,
      createdAt: new Date().toISOString(),
      ...extra,
    });
  } catch(e) { console.warn('Could not create notification:', e); }
}

// ============================================================
// ADMIN: ENVIAR MENSAJE A TODOS O A UN USUARIO ESPECÍFICO
// ============================================================
async function adminSendBroadcast(message, targetUid) {
  if (!message || !message.trim()) { showToast('Escribe un mensaje.'); return; }
  if ((typeof AUTH === 'undefined') || AUTH.userProfile?.role !== 'admin') return;

  // Enviar a un usuario específico
  if (targetUid && targetUid !== 'all') {
    await createNotification(targetUid, 'admin_message', message.trim());
    showToast('✓ Mensaje enviado.');
    return;
  }

  // Enviar a todos
  let uids = [];
  try {
    const idxDoc = await db.collection('meta').doc('userIndex').get();
    if (idxDoc.exists) uids = (idxDoc.data().uids || []);
  } catch(e) { console.warn('userIndex unavailable:', e); }

  const myUid = AUTH.userProfile.uid;
  const targets = uids.filter(uid => uid !== myUid);
  if (!targets.length) { showToast('No hay otros usuarios registrados.'); return; }

  await Promise.all(targets.map(uid =>
    createNotification(uid, 'admin_message', message.trim())
  ));
  showToast(`✓ Mensaje enviado a ${targets.length} usuario(s).`);
}
