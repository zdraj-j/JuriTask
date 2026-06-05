/**
 * JuriTask — selection.js
 * Selección múltiple de trámites + acciones en lote (terminar / eliminar).
 *
 * Entrada al modo selección:
 *   · Mantener pulsada una tarjeta (long-press) — táctil y ratón.
 *   · Ctrl/Cmd + clic en una tarjeta (escritorio).
 * Una barra flotante muestra el conteo y las acciones. Las acciones usan
 * pushHistory una sola vez, de modo que "Deshacer" revierte todo el lote.
 */

let _selMode = false;
const _selIds = new Set();
let _selBar = null;
let _selHintShown = false;

function selIsActive() { return _selMode; }

function selEnter(id) {
  _selMode = true;
  if (id) _selIds.add(id);
  if (!_selHintShown) {
    _selHintShown = true;
    if (typeof showToast === 'function') showToast('Modo selección: toca para elegir trámites.');
  }
  _selRefresh();
}

function selExit() {
  _selMode = false;
  _selIds.clear();
  _selRefresh();
}

function selToggle(id) {
  if (_selIds.has(id)) _selIds.delete(id); else _selIds.add(id);
  if (_selIds.size === 0) { selExit(); return; }
  _selRefresh();
}

// Marca las tarjetas renderizadas y actualiza la barra. Se llama tras renderAll.
function selApplyToRendered() {
  // Quitar ids que ya no existen (p. ej. tras eliminar).
  if (typeof STATE !== 'undefined') {
    [..._selIds].forEach(id => { if (!STATE.tramites.some(t => t.id === id)) _selIds.delete(id); });
  }
  document.body.classList.toggle('selection-mode', _selMode);
  document.querySelectorAll('.card-wrapper[data-id]').forEach(w => {
    w.classList.toggle('selected', _selIds.has(w.dataset.id));
  });
  _renderBar();
}

function _selRefresh() {
  document.body.classList.toggle('selection-mode', _selMode);
  document.querySelectorAll('.card-wrapper[data-id]').forEach(w => {
    w.classList.toggle('selected', _selIds.has(w.dataset.id));
  });
  _renderBar();
}

function _renderBar() {
  if (!_selMode) { if (_selBar) _selBar.classList.remove('show'); return; }
  if (!_selBar) {
    _selBar = document.createElement('div');
    _selBar.className = 'selection-bar';
    _selBar.innerHTML = `
      <span class="sel-count"></span>
      <div class="sel-actions">
        <button type="button" class="sel-btn" data-sel="all" title="Seleccionar todo"><i data-lucide="check-check"></i><span>Todo</span></button>
        <button type="button" class="sel-btn" data-sel="finish"><i data-lucide="check"></i><span>Terminar</span></button>
        <button type="button" class="sel-btn sel-btn-danger" data-sel="delete"><i data-lucide="trash-2"></i><span>Eliminar</span></button>
        <button type="button" class="sel-btn" data-sel="cancel" title="Cancelar"><i data-lucide="x"></i></button>
      </div>`;
    document.body.appendChild(_selBar);
    _selBar.addEventListener('click', e => {
      const b = e.target.closest('[data-sel]'); if (!b) return;
      const a = b.dataset.sel;
      if (a === 'cancel')      selExit();
      else if (a === 'all')    _selSelectAllVisible();
      else if (a === 'finish') _selBulkFinish();
      else if (a === 'delete') _selBulkDelete();
    });
  }
  _selBar.querySelector('.sel-count').textContent =
    `${_selIds.size} seleccionado${_selIds.size === 1 ? '' : 's'}`;
  _selBar.classList.add('show');
  if (window.refreshIcons) window.refreshIcons();
}

// Selecciona todos los trámites visibles (no terminados) de la vista actual.
function _selSelectAllVisible() {
  document.querySelectorAll('.tramite-list:not([style*="display: none"]) .card-wrapper[data-id]')
    .forEach(w => _selIds.add(w.dataset.id));
  // Fallback: si el selector de visibilidad falla, usar todas las renderizadas.
  if (_selIds.size === 0) {
    document.querySelectorAll('.card-wrapper[data-id]').forEach(w => _selIds.add(w.dataset.id));
  }
  _selRefresh();
}

async function _selBulkFinish() {
  const ids = [...selectedExisting()].filter(id => {
    const t = STATE.tramites.find(x => x.id === id); return t && !t.terminado;
  });
  if (!ids.length) { showToast('No hay trámites activos seleccionados.'); return; }
  if (!(await showConfirm(`¿Marcar ${ids.length} trámite(s) como terminados?`, { confirmLabel: 'Terminar' }))) return;
  pushHistory(`Terminar ${ids.length} trámites`);
  const now = new Date().toISOString();
  ids.forEach(id => {
    const t = STATE.tramites.find(x => x.id === id);
    t.terminado = true; t.terminadoEn = now;
    if (typeof saveTramiteFS === 'function') saveTramiteFS(t);
  });
  saveAll(); selExit(); renderAll();
  showToast(`${ids.length} trámite(s) terminado(s).`, null, { label: 'Deshacer', onClick: undo });
}

async function _selBulkDelete() {
  const ids = [...selectedExisting()];
  if (!ids.length) return;
  if (!(await showConfirm(`¿Eliminar ${ids.length} trámite(s)? Esta acción se puede deshacer.`, { danger: true, confirmLabel: 'Eliminar' }))) return;
  pushHistory(`Eliminar ${ids.length} trámites`);
  ids.forEach(id => {
    const t = STATE.tramites.find(x => x.id === id);
    if (typeof deleteTramiteFS === 'function') deleteTramiteFS(id, t?._scope || 'private');
  });
  STATE.tramites = STATE.tramites.filter(t => !_selIds.has(t.id));
  STATE.order    = STATE.order.filter(id => !_selIds.has(id));
  saveAll(); selExit(); renderAll();
  showToast(`${ids.length} trámite(s) eliminado(s).`, null, { label: 'Deshacer', onClick: undo });
}

function selectedExisting() {
  return [..._selIds].filter(id => STATE.tramites.some(t => t.id === id));
}

// ── Long-press para entrar al modo selección desde una tarjeta ──────────
function attachLongPress(card, id) {
  let timer = null, sx = 0, sy = 0;
  const start = (x, y) => {
    sx = x; sy = y;
    timer = setTimeout(() => {
      timer = null;
      selEnter(id);
      // Suprimir el click sintético que sigue al long-press (deseleccionaría).
      const kill = ev => { ev.stopPropagation(); ev.preventDefault(); };
      card.addEventListener('click', kill, { capture: true, once: true });
      setTimeout(() => card.removeEventListener('click', kill, { capture: true }), 700);
    }, 500);
  };
  const move = (x, y) => {
    if (timer && (Math.abs(x - sx) > 10 || Math.abs(y - sy) > 10)) { clearTimeout(timer); timer = null; }
  };
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };

  card.addEventListener('touchstart', e => { if (e.touches[0]) start(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
  card.addEventListener('touchmove',  e => { if (e.touches[0]) move(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
  card.addEventListener('touchend', cancel);
  card.addEventListener('mousedown', e => { if (e.button === 0 && !_selMode) start(e.clientX, e.clientY); });
  card.addEventListener('mousemove', e => move(e.clientX, e.clientY));
  card.addEventListener('mouseup', cancel);
  card.addEventListener('mouseleave', cancel);
  card.addEventListener('dragstart', cancel);
}

// Salir del modo con Escape, salvo que haya un modal abierto (que lo maneja él).
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !_selMode) return;
  if (document.querySelector('.overlay.open, .confirm-overlay.open')) return;
  selExit();
});
