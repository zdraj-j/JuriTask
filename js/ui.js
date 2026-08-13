/**
 * JuriTask — ui.js
 * Todo el renderizado: tarjetas, paneles de detalle,
 * modal de trámite, reporte, configuración.
 * Incluye FLIP animation para reordenamiento de tarjetas.
 */

// ============================================================
// TOAST
// ============================================================
let _toastEl    = null;
let _toastTimer = null;

// action (opcional): { label, onClick } — muestra un botón dentro del toast
// (p. ej. "Deshacer") útil sobre todo en móvil, donde no hay Ctrl+Z.
function showToast(msg, icon, action) {
  if (!_toastEl) _toastEl = document.getElementById('toast');
  if (!_toastEl) return;                       // guard: #toast podría no existir
  msg = String(msg);
  if (!icon) {
    // Heurística: mensajes de error/validación llevan icono de alerta.
    icon = /(error|no se pudo|no disponible|inv[áa]lid|incorrect|vac[íi]|m[áa]ximo|m[íi]nimo|completa|selecciona|escribe|no hay|no puedes|no coinciden|a[úu]n no|ya existe)/i.test(msg)
      ? 'circle-alert' : 'check';
  }
  _toastEl.innerHTML = `<i data-lucide="${icon}"></i><span></span>` +
    (action ? `<button type="button" class="toast-action"></button>` : '');
  _toastEl.querySelector('span').textContent = msg;   // texto vía textContent: sin riesgo XSS
  if (action) {
    const b = _toastEl.querySelector('.toast-action');
    b.textContent = action.label || 'Deshacer';
    b.onclick = () => {
      _toastEl.classList.remove('show');
      clearTimeout(_toastTimer);
      try { action.onClick(); } catch (e) { console.error(e); }
    };
  }
  if (window.refreshIcons) window.refreshIcons();
  _toastEl.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => _toastEl.classList.remove('show'), action ? 5500 : 2800);
}

// ============================================================
// CIERRE DE DROPDOWNS DE ASIGNACIÓN (handler global único)
// ============================================================
// Antes cada dropdown registraba su propio listener en document; se acumulaban
// indefinidamente. Ahora un único listener delegado cierra los que estén abiertos.
let _dropdownCloserInstalled = false;
function _installDropdownCloser() {
  if (_dropdownCloserInstalled) return;
  _dropdownCloserInstalled = true;
  document.addEventListener('click', (e) => {
    document.querySelectorAll('.ti-resp-dropdown.open').forEach(dd => {
      if (!dd.contains(e.target)) dd.classList.remove('open');
    });
  });
}

// ============================================================
// CONFIRM DIALOG (promesa)
// ============================================================
let _confirmResolve = null;

function showConfirm(msg, opts = {}) {
  return new Promise(resolve => {
    _confirmResolve = resolve;
    document.getElementById('confirmMsg').textContent = msg;
    const okBtn = document.getElementById('confirmOk');
    if (okBtn) {
      okBtn.textContent = opts.confirmLabel || 'Confirmar';
      okBtn.classList.toggle('btn-danger', !!opts.danger);
      okBtn.classList.toggle('btn-primary', !opts.danger);
    }
    const cancelBtn = document.getElementById('confirmCancel');
    if (cancelBtn) cancelBtn.textContent = opts.cancelLabel || 'Cancelar';
    document.getElementById('confirmOverlay').classList.add('open');
    setTimeout(() => okBtn?.focus(), 50);   // Enter confirma con teclado
  });
}

function _confirmClose(result) {
  document.getElementById('confirmOverlay').classList.remove('open');
  if (_confirmResolve) { _confirmResolve(result); _confirmResolve = null; }
}

// ============================================================
// FLIP ANIMATION — reordenamiento suave de tarjetas
// ============================================================
/**
 * Implementación de la técnica FLIP (First, Last, Invert, Play).
 * Llama a capturePositions() ANTES de reordenar el DOM,
 * luego a animateFlip() DESPUÉS.
 */
const _flipMap = new Map(); // id → DOMRect antes del cambio

function capturePositions(container) {
  _flipMap.clear();
  container.querySelectorAll('.card-wrapper[data-id]').forEach(el => {
    _flipMap.set(el.dataset.id, el.getBoundingClientRect());
  });
}

function animateFlip(container) {
  container.querySelectorAll('.card-wrapper[data-id]').forEach(el => {
    const id   = el.dataset.id;
    const prev = _flipMap.get(id);
    if (!prev) return;

    const next = el.getBoundingClientRect();
    const dx   = prev.left - next.left;
    const dy   = prev.top  - next.top;

    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return; // no se movió

    // Invert: teleportar al lugar anterior
    el.style.transition = 'none';
    el.style.transform  = `translate(${dx}px, ${dy}px)`;

    // Play: animar al lugar nuevo (forzar reflow antes)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.transition = 'transform 320ms cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        el.style.transform  = '';
        // Limpiar después de la animación
        el.addEventListener('transitionend', () => {
          el.style.transition = '';
          el.style.transform  = '';
        }, { once: true });
      });
    });
  });
}

// ============================================================
// DRAG & DROP (con FLIP)
// ============================================================
let dragSrcId = null;

function attachDragEvents(card, wrapper) {
  card.addEventListener('dragstart', e => {
    // No iniciar el arrastre nativo si el gesto empieza sobre un control
    // interactivo (botones de acción, checkboxes, fechas…). En escritorio, el
    // arrastre nativo de la tarjeta se "comía" el clic de esos botones cuando
    // había un micro-movimiento del ratón (síntoma: eliminar no respondía en PC
    // pero sí en móvil, donde el toque no dispara arrastre nativo).
    if (e.target.closest('button, input, textarea, select, a, label')) { e.preventDefault(); return; }
    dragSrcId = wrapper.dataset.id;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  });
  card.addEventListener('dragover', e => {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    if (wrapper.dataset.id !== dragSrcId) card.classList.add('drag-over');
  });
  card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
  card.addEventListener('drop', e => {
    e.preventDefault(); e.stopPropagation();
    card.classList.remove('drag-over');
    if (dragSrcId && dragSrcId !== wrapper.dataset.id) {
      const container = wrapper.closest('.tramite-col') || wrapper.parentNode;
      capturePositions(container.closest('.tramite-grid') || container);
      reorder(dragSrcId, wrapper.dataset.id); // renderAll() dentro
      // animateFlip se llama desde renderAll después del DOM update
    }
  });
}

// ============================================================
// RENDER LISTA CON FLIP
// ============================================================
function renderList(container, emptyEl, list) {
  // Capturar posiciones antes de limpiar el DOM
  capturePositions(container);

  container.innerHTML = '';
  if (!list.length) { emptyEl.classList.add('visible'); return; }
  emptyEl.classList.remove('visible');

  const cols    = STATE.config.columns || 1;
  const colDivs = Array.from({ length: cols }, () => {
    const col = document.createElement('div'); col.className = 'tramite-col'; container.appendChild(col); return col;
  });
  list.forEach((t, i) => colDivs[i % cols].appendChild(buildCard(t)));

  // Animar después de insertar en el DOM
  requestAnimationFrame(() => animateFlip(container));
}

function renderAll() {
  const f       = getFilters();
  const actives = STATE.tramites.filter(t => !t.terminado);
  const sorted  = sortActives(actives);

  renderList(document.getElementById('tramiteList'),  document.getElementById('emptyAll'),      applyFilters(sorted, f));

  if (typeof _updateAgendaBadge === 'function') _updateAgendaBadge();

  renderList(document.getElementById('finishedList'), document.getElementById('emptyFinished'), applyFilters(STATE.tramites.filter(t => t.terminado), f));

  if (currentView === 'agenda')   renderAgenda();

  if (typeof selApplyToRendered === 'function') selApplyToRendered();   // re-marcar selección

  // Mantener el panel lateral del reporte al día cuando cambian los datos.
  if (document.body.classList.contains('report-docked') && typeof renderReportDock === 'function') {
    renderReportDock();
  }
}

// ============================================================
// CONSTRUIR TARJETA
// ============================================================
function buildCard(t) {
  const wrapper = document.createElement('div');
  wrapper.className  = 'card-wrapper';
  wrapper.dataset.id = t.id;

  const card = document.createElement('div');
  const esP  = esPropio(t);
  card.className  = 'tramite-card' + (t.terminado ? ' finished-card':'') + (esP ? ' propio-card':'');
  card.dataset.id = t.id;
  card.draggable  = !t.terminado;

  const seg1 = (!esP && t.gestion?.analisis)      ? 'active-1' : '';
  const seg2 = (!esP && t.gestion?.cumplimiento)  ? 'active-2' : '';
  const seg3 = t.terminado                         ? 'active-3' : '';

  // Fecha de vencimiento
  const showVenc = t.fechaVencimiento && !t.gestion?.cumplimiento;
  let vencHtml = '';
  if (showVenc) {
    const vcls  = vencClass(t.fechaVencimiento, t);
    const lbl   = { overdue:'<i data-lucide="triangle-alert"></i> Vencido', today:'<i data-lucide="triangle-alert"></i> Hoy', soon:'<i data-lucide="alarm-clock"></i> Mañana', upcoming:'<i data-lucide="calendar"></i> Vence' }[vcls] || '<i data-lucide="calendar"></i> Vence';
    const dias  = STATE.config.diasRestantes ? diasRestantesNum(t.fechaVencimiento) : null;
    const dtag  = dias !== null ? ` <span class="dias-restantes ${vcls}">${diasRestantesLabel(dias)}</span>` : '';
    vencHtml    = `<span class="venc-fecha ${vcls}">${lbl}: ${formatDate(t.fechaVencimiento)}</span>${dtag}`;
  }

  // Alerta falta análisis (trámites compartidos sin análisis completado)
  const faltaAnalisis = !esP && !t.terminado && !t.gestion?.analisis;
  const faltaAnalisisHtml = faltaAnalisis
    ? `<span class="tag-falta-analisis"><i data-lucide="triangle-alert"></i> Falta análisis</span>`
    : '';

  // Responsable — para trámites compartidos recibidos, mostrar quién los creó
  let respTag;
  if (esP) {
    respTag = `<span class="tag tag-propio"><i data-lucide="user"></i> Propio</span>`;
  } else {
    // Si el trámite viene de otra persona (_sharedFrom), mostrar su nombre
    const displayKey = (t._sharedFrom && t._sharedFrom !== AUTH?.userProfile?.uid)
      ? t._sharedFrom
      : t.abogado;
    const col = abogadoColor(displayKey), bg = hexToRgba(col, 0.12);
    respTag = `<span class="tag tag-abogado" style="background:${bg};color:${col}">${escapeHtml(abogadoName(displayKey, t))}</span>`;
  }

  const etapaTag   = t.terminado ? `<span class="tag tag-terminado">Terminado</span>` : '';
  const pends      = (t.seguimiento||[]).filter(s => s.estado === 'pendiente');
  const tieneUrg   = pends.some(s => s.urgente);
  const urgenteTag = tieneUrg ? `<span class="tag tag-urgente"><i data-lucide="circle-alert"></i> Urgente</span>` : '';
  const segHtml    = buildSeguimientoHtml(pends, t);

  // Checkboxes
  let checksHtml = '';
  if (!t.terminado) {
    if (esP) {
      checksHtml = `<div class="card-checks" id="checks_${t.id}">
        <label class="round-check-wrap check-terminar" title="Terminar"><input type="checkbox" class="card-check-terminar"/><div class="round-check-box"></div><span class="check-label-text">Fin</span></label>
      </div>`;
    } else {
      checksHtml = `<div class="card-checks" id="checks_${t.id}">
        <label class="round-check-wrap" title="Análisis"><input type="checkbox" class="card-check-analisis" ${t.gestion?.analisis?'checked':''}/><div class="round-check-box"></div><span class="check-label-text">An.</span></label>
        <label class="round-check-wrap" title="Cumplimiento"><input type="checkbox" class="card-check-cumplimiento" ${t.gestion?.cumplimiento?'checked':''}/><div class="round-check-box"></div><span class="check-label-text">Cu.</span></label>
        <label class="round-check-wrap check-terminar" title="Terminar"><input type="checkbox" class="card-check-terminar"/><div class="round-check-box"></div><span class="check-label-text">Fin</span></label>
      </div>`;
    }
  }

  card.innerHTML = `
    <div class="card-progress-bar">
      <div class="progress-segment ${seg1}"></div>
      <div class="progress-segment ${seg2}"></div>
      <div class="progress-segment ${seg3}"></div>
    </div>
    <div class="card-body">
      ${checksHtml}
      <div class="card-info">
        <div class="card-top-row">
          <span class="card-numero">#${escapeHtml(t.numero)}</span>${copyNumBtn(t.numero)}
          <span class="tag tag-modulo">${escapeHtml(t.modulo)}</span>
          ${respTag}${etapaTag}${urgenteTag}
        </div>
        <div class="card-desc">${escapeHtml(t.descripcion || '(sin descripción)')}</div>
        <div class="card-dates">${faltaAnalisisHtml}${vencHtml}</div>
        ${segHtml}
      </div>
    </div>`;

  // Fila anfitriona de los botones de acción del panel expandido
  // (duplicar / editar / eliminar / cerrar, insertados en openDetailExpand).
  // En los activos nace vacía y CSS la oculta con `:empty` mientras la tarjeta
  // está colapsada; en los terminados aloja además "Reactivar".
  const actionsRow = document.createElement('div');
  actionsRow.className = 'card-actions-row';
  card.appendChild(actionsRow);

  if (t.terminado) {
    const btnR = document.createElement('button');
    btnR.className = 'btn-card-reactivar';
    btnR.title = 'Devolver el trámite a ejecución';
    btnR.innerHTML = '<i data-lucide="rotate-ccw"></i> Reactivar';
    actionsRow.appendChild(btnR);
    btnR.addEventListener('click', async e => {
      e.stopPropagation();
      if (!(await showConfirm('¿Devolver este trámite a ejecución?', { confirmLabel: 'Reactivar' }))) return;
      pushHistory(`Reactivar trámite #${t.numero}`);
      t.terminado = false; t.terminadoEn = null;
      if (typeof saveTramiteFS === 'function') saveTramiteFS(t);
      saveAll(); renderAll();
      showToast('Trámite reactivado.', null, { label: 'Deshacer', onClick: undo });
    });
  }

  // Click en tarjeta → detalle (o selección si el modo selección está activo)
  card.addEventListener('click', e => {
    if (e.target.closest('.card-checks') || e.target.closest('.card-actions-row')) return;
    if (typeof selIsActive === 'function' && (selIsActive() || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (selIsActive()) selToggle(t.id); else selEnter(t.id);
      return;
    }
    openDetail(t.id);
  });
  if (typeof attachLongPress === 'function') attachLongPress(card, t.id);

  // Checkboxes
  if (!t.terminado) {
    const cc = card.querySelector(`#checks_${t.id}`);
    cc.addEventListener('click', e => e.stopPropagation());
    if (!esP) {
      card.querySelector('.card-check-analisis').addEventListener('change', e => {
        pushHistory(e.target.checked ? 'Marcar análisis' : 'Desmarcar análisis');
        t.gestion.analisis = e.target.checked; saveAll(); renderAll();
      });
      card.querySelector('.card-check-cumplimiento').addEventListener('change', e => {
        pushHistory(e.target.checked ? 'Marcar cumplimiento' : 'Desmarcar cumplimiento');
        t.gestion.cumplimiento = e.target.checked;
        if (e.target.checked) { crearTareaRequerimiento(t); showToast('Cumplimiento marcado. Tarea automática creada.'); }
        saveAll(); renderAll();
      });
    }
    card.querySelector('.card-check-terminar').addEventListener('change', async e => {
      if (!e.target.checked) return; e.target.checked = false;
      if (!(await showConfirm('¿Marcar este trámite como terminado?', { confirmLabel: 'Terminar' }))) return;
      pushHistory('Terminar trámite'); t.terminado = true; t.terminadoEn = new Date().toISOString();
      if (typeof saveTramiteFS === 'function') saveTramiteFS(t);
      saveAll(); renderAll(); showToast('Trámite terminado.', null, { label: 'Deshacer', onClick: undo });
    });
    attachDragEvents(card, wrapper);
  }

  wrapper.appendChild(card);
  return wrapper;
}

function buildSeguimientoHtml(tareas, tramite) {
  if (!tareas.length) return '';
  const shown = tareas.slice(0, 2);
  const extra = tareas.length - shown.length;
  return `<div class="card-seguimiento">
    ${shown.map(s => {
      const dc   = dateClass(s.fecha);
      const urg  = s.urgente ? '<span class="seg-urg"><i data-lucide="circle-alert"></i></span>' : '';
      const fech = s.fecha  ? `<span class="seg-fecha ${dc}">${formatDate(s.fecha)}</span>` : '';
      return `<div class="card-seg-item"><div class="seg-dot ${dc}"></div>${urg}<span class="seg-desc">${escapeHtml(s.descripcion)}</span>${fech}</div>`;
    }).join('')}
    ${extra > 0 ? `<div class="card-seg-more">+${extra} tarea${extra>1?'s':''} más</div>` : ''}
  </div>`;
}

// ============================================================
// REFRESH RÁPIDO DE CARD (sin re-render completo)
// ============================================================
function refreshCardOnly(t) {
  document.querySelectorAll(`.tramite-card[data-id="${t.id}"]`).forEach(card => {
    const segs = card.querySelectorAll('.progress-segment');
    const esP  = esPropio(t);
    if (segs[0]) segs[0].className = 'progress-segment' + ((!esP && t.gestion?.analisis)     ? ' active-1' : '');
    if (segs[1]) segs[1].className = 'progress-segment' + ((!esP && t.gestion?.cumplimiento) ? ' active-2' : '');
    if (segs[2]) segs[2].className = 'progress-segment' + (t.terminado                       ? ' active-3' : '');

    const showVenc = t.fechaVencimiento && !t.gestion?.cumplimiento;
    const datesEl  = card.querySelector('.card-dates');
    if (datesEl) {
      if (showVenc) {
        const vcls = vencClass(t.fechaVencimiento, t);
        const lbl  = { overdue:'<i data-lucide="triangle-alert"></i> Vencido', today:'<i data-lucide="triangle-alert"></i> Hoy', soon:'<i data-lucide="alarm-clock"></i> Mañana', upcoming:'<i data-lucide="calendar"></i> Vence' }[vcls] || '<i data-lucide="calendar"></i> Vence';
        const dias = STATE.config.diasRestantes ? diasRestantesNum(t.fechaVencimiento) : null;
        const dtag = dias !== null ? ` <span class="dias-restantes ${vcls}">${diasRestantesLabel(dias)}</span>` : '';
        datesEl.innerHTML = `<span class="venc-fecha ${vcls}">${lbl}: ${formatDate(t.fechaVencimiento)}</span>${dtag}`;
      } else datesEl.innerHTML = '';
    }

    const pends   = (t.seguimiento || []).filter(s => s.estado === 'pendiente');
    const newHtml = buildSeguimientoHtml(pends, t);
    const segEl   = card.querySelector('.card-seguimiento');
    if (segEl) {
      const parent = segEl.parentNode; segEl.remove();
      if (newHtml && parent) { const tmp=document.createElement('div'); tmp.innerHTML=newHtml; parent.appendChild(tmp.firstElementChild); }
    } else if (newHtml) {
      const info = card.querySelector('.card-info');
      if (info) { const tmp=document.createElement('div'); tmp.innerHTML=newHtml; info.appendChild(tmp.firstElementChild); }
    }
  });
}

// ============================================================
// DETALLE — EXPAND / MODAL
// ============================================================
let currentDetailId = null;

function openDetail(id) {
  const t = getById(id); if (!t) return;
  currentDetailId = id;
  // Force modal in the dashboard view, where there are no card wrappers
  const activeView = document.querySelector('.view.active');
  const viewId = activeView ? activeView.id : '';
  const forceModal = viewId === 'view-dashboard';
  (forceModal || STATE.config.detailMode === 'modal') ? openDetailModal(t) : openDetailExpand(t);
}

function openDetailModal(t) {
  closeAllExpands();
  document.getElementById('detailTitle').innerHTML      = `Trámite #${escapeHtml(t.numero)}${copyNumBtn(t.numero)}`;
  const ownerLabel = t.sharedWith?.length ? 'Equipo' : (esPropio(t) ? 'Propio' : abogadoName(t.abogado));
  document.getElementById('detailSubtitle').textContent = `${t.descripcion} · ${ownerLabel} · ${t.modulo}${t.fechaVencimiento ? ` · Vence: ${formatDate(t.fechaVencimiento)}` : ''}`;
  document.getElementById('detailModal').dataset.id     = t.id;
  const body = document.getElementById('detailModalBody');
  body.innerHTML = buildDetailContent(t);
  bindDetailContent(t, body, null);
  document.getElementById('detailOverlay').classList.add('open');
}

function openDetailExpand(t) {
  const active  = document.querySelector('.view.active');
  let wrapper   = active ? active.querySelector(`.card-wrapper[data-id="${t.id}"]`) : null;
  if (!wrapper) wrapper = document.querySelector(`.card-wrapper[data-id="${t.id}"]`);
  if (!wrapper) return;

  const alreadyOpen = wrapper.querySelector('.expand-panel.open');
  closeAllExpands();
  if (alreadyOpen) return;

  const card = wrapper.querySelector('.tramite-card');
  card.classList.add('card-open');

  // Insert action buttons into the card action row
  const actionsRow = card.querySelector('.card-actions-row');
  if (actionsRow && !actionsRow.querySelector('.expand-act-btns')) {
    const actBtns = document.createElement('div');
    actBtns.className = 'expand-act-btns';
    actBtns.innerHTML = `
      <button class="btn-icon" data-action="dup" title="Duplicar"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></button>
      <button class="btn-icon" data-action="edit" title="Editar"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/></svg></button>
      <button class="btn-icon btn-icon-danger" data-action="delete" title="Eliminar"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button>
      <button class="btn-icon" data-action="close" title="Cerrar"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>`;
    actBtns.querySelector('[data-action="dup"]').addEventListener('click', e => {
      e.stopPropagation();
      const newT = JSON.parse(JSON.stringify(t));
      newT.id = genId(); newT.numero = t.numero + '-copia';
      newT.terminado = false; newT.terminadoEn = null; newT.creadoEn = new Date().toISOString();
      newT.gestion = { analisis: false, cumplimiento: false };
      pushHistory(`Duplicar trámite #${t.numero}`);
      STATE.tramites.push(newT); STATE.order.push(newT.id);
      if (typeof saveTramiteFS === 'function') saveTramiteFS(newT);
      saveAll(); renderAll(); showToast(`Trámite duplicado como #${newT.numero}.`);
    });
    actBtns.querySelector('[data-action="edit"]').addEventListener('click', e => { e.stopPropagation(); closeAllExpands(); openModal(t); });
    actBtns.querySelector('[data-action="delete"]').addEventListener('click', async e => {
      e.stopPropagation();
      if (await showConfirm('¿Eliminar este trámite?', { danger: true, confirmLabel: 'Eliminar' })) {
        pushHistory(`Eliminar trámite #${t.numero}`);
        STATE.tramites = STATE.tramites.filter(x => x.id !== t.id);
        STATE.order    = STATE.order.filter(id => id !== t.id);
        if (typeof deleteTramiteFS === 'function') deleteTramiteFS(t.id, t);
        saveAll(); closeAllExpands(); renderAll(); showToast('Trámite eliminado.', null, { label: 'Deshacer', onClick: undo });
      }
    });
    actBtns.querySelector('[data-action="close"]').addEventListener('click', e => { e.stopPropagation(); closeAllExpands(); });
    actBtns.addEventListener('click', e => e.stopPropagation());
    actionsRow.appendChild(actBtns);
  }

  let panel = wrapper.querySelector('.expand-panel');
  if (!panel) {
    panel             = document.createElement('div'); panel.className = 'expand-panel';
    const inner       = document.createElement('div'); inner.className = 'expand-panel-inner';
    const content = document.createElement('div');
    content.innerHTML = buildDetailContent(t);
    inner.appendChild(content);
    bindDetailContent(t, content, wrapper);
    panel.appendChild(inner);
    wrapper.appendChild(panel);
  }
  requestAnimationFrame(() => requestAnimationFrame(() => panel.classList.add('open')));
}

function closeAllExpands() {
  document.querySelectorAll('.expand-panel.open').forEach(p => p.classList.remove('open'));
  document.querySelectorAll('.tramite-card.card-open').forEach(c => {
    c.classList.remove('card-open');
    c.querySelector('.expand-act-btns')?.remove();
  });
  currentDetailId = null;
}

function closeDetail() {
  document.getElementById('detailOverlay').classList.remove('open');
  const m = document.getElementById('detailModal');
  if (m) m.dataset.id = '';
  currentDetailId = null;
}

// ============================================================
// CONTENIDO DE DETALLE
// ============================================================
function buildDetailContent(t) {
  const etapa = computeEtapa(t);
  const p     = `det_${t.id}`;
  const hVenc = !!(t.gestion?.cumplimiento);

  // Build multi-select options scoped to this tramite's participants
  const isPropio = !t.sharedWith?.length && !t.abogado;
  const respOptsHtml = isPropio ? '' : _buildTramiteRespOptions(t, []);
  const respSelectHtml = isPropio ? '' : `
          <div class="ti-resp-wrap">
            <div class="ti-resp-display" id="${p}_newActRespDisplay">Asignar…</div>
            <div class="ti-resp-dropdown" id="${p}_newActRespDropdown">${respOptsHtml}</div>
          </div>`;

  return `
    <div class="detail-section">
      <h3>Seguimiento <span class="etapa-badge${etapa==='seguimiento'?' seguimiento':''}" id="${p}_etapabadge">${etapa==='seguimiento'?'Seguimiento':'Gestión'}</span></h3>
      <div id="${p}_actividades"></div>
      <div class="nueva-tarea-toggle">
        <button class="btn-nueva-tarea" id="${p}_btnNuevaTarea" type="button"><i data-lucide="plus"></i> Nueva tarea</button>
      </div>
      <div class="add-actividad-form" id="${p}_formNuevaTarea" style="display:none">
        <input type="text"  id="${p}_newActDesc"  placeholder="¿Qué se debe hacer?" />
        <div class="add-actividad-form-row">
          <input type="date" id="${p}_newActFecha" />${respSelectHtml}
        </div>
        <div class="add-actividad-btns">
          <button class="btn-small" id="${p}_addAct">+ Agregar</button>
          <button class="btn-small" id="${p}_cancelAct" style="background:var(--surface);color:var(--text-secondary);border:1px solid var(--border)">Cancelar</button>
        </div>
      </div>
    </div>
    <div class="detail-section detail-vencimiento-section${hVenc?' hidden-venc':''}" id="${p}_vencSection">
      <h3>Fecha de vencimiento</h3>
      <div class="venc-inline-row">
        <input type="date" id="${p}_vencimiento" value="${t.fechaVencimiento||''}" />
        <button class="btn-small" id="${p}_saveVenc">Guardar</button>
      </div>
    </div>
    <div class="detail-section">
      <h3>Notas</h3>
      <div id="${p}_notas"></div>
      <div class="add-nota-row">
        <textarea id="${p}_newNota" placeholder="Escribe una nota…" rows="2"></textarea>
        <button class="btn-small" id="${p}_addNota">+ Nota</button>
      </div>
    </div>`;
}

// ============================================================
// BIND DETALLE — con debounce en edición inline
// ============================================================
function bindDetailContent(t, container, expandWrapper) {
  const p = `det_${t.id}`;

  // Debounce helper para guardado inline (300ms)
  function makeSaveDebounced(fn) {
    let timer = null;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), 300); };
  }

  renderActividadesIn(t, container.querySelector(`#${p}_actividades`), container, expandWrapper);

  const btnNueva  = container.querySelector(`#${p}_btnNuevaTarea`);
  const formNueva = container.querySelector(`#${p}_formNuevaTarea`);
  btnNueva?.addEventListener('click', () => {
    const open = formNueva.style.display !== 'none';
    formNueva.style.display = open ? 'none' : 'block';
    if (!open) setTimeout(() => container.querySelector(`#${p}_newActDesc`)?.focus(), 60);
  });

  // Multi-select for new task assignment
  const respDisplay  = container.querySelector(`#${p}_newActRespDisplay`);
  const respDropdown = container.querySelector(`#${p}_newActRespDropdown`);
  let _newTaskAssigned = [];
  if (respDisplay && respDropdown) {
    respDisplay.addEventListener('click', e => { e.stopPropagation(); respDropdown.classList.toggle('open'); });
    respDropdown.addEventListener('click', e => e.stopPropagation());
    respDropdown.addEventListener('change', () => {
      _newTaskAssigned = [...respDropdown.querySelectorAll('input:checked')].map(c => c.value);
      _updateTiRespDisplay(respDisplay, _newTaskAssigned);
    });
    _installDropdownCloser();
  }

  container.querySelector(`#${p}_cancelAct`)?.addEventListener('click', () => { formNueva.style.display = 'none'; });
  container.querySelector(`#${p}_addAct`)?.addEventListener('click', () => {
    const desc  = container.querySelector(`#${p}_newActDesc`).value.trim();
    const fecha = container.querySelector(`#${p}_newActFecha`).value;
    if (!desc) { showToast('Escribe una descripción.'); return; }
    pushHistory('Agregar tarea');
    const myUid = AUTH?.userProfile?.uid;
    const normalizedAssigned = _newTaskAssigned.map(u => u === myUid ? 'yo' : u);
    const responsable = normalizedAssigned[0] || 'yo';
    t.seguimiento.push({ descripcion: sentenceCase(desc), fecha, responsable, estado: 'pendiente', urgente: false, attachments: [], completedBy: {}, assignedTo: [...normalizedAssigned] });
    container.querySelector(`#${p}_newActDesc`).value = '';
    container.querySelector(`#${p}_newActFecha`).value = '';
    formNueva.style.display = 'none';
    // Notificar a cada asignado
    _newTaskAssigned.forEach(uid => {
      if (typeof createNotification === 'function' && uid !== 'yo' && uid !== AUTH?.userProfile?.uid && !uid.startsWith('abogado_')) {
        createNotification(uid, 'task_assigned',
          `${AUTH?.userProfile?.displayName || 'Alguien'} te asignó una tarea en el trámite #${t.numero}: "${sentenceCase(desc)}"`,
          { tramiteId: t.id });
      }
    });
    if (typeof saveTramiteFS === 'function') saveTramiteFS(t);
    saveAll(); refreshCardOnly(t);
    renderActividadesIn(t, container.querySelector(`#${p}_actividades`), container, expandWrapper);
    showToast('Tarea agregada.');
  });

  // Fecha de vencimiento — guardado con debounce en input, inmediato en botón
  const vencInput  = container.querySelector(`#${p}_vencimiento`);
  const saveVencDb = makeSaveDebounced(() => {
    if (!vencInput?.value) return;
    t.fechaVencimiento = vencInput.value;
    if (typeof saveTramiteFS === 'function') saveTramiteFS(t);
    saveAll(); refreshCardOnly(t);
  });
  vencInput?.addEventListener('input', saveVencDb);
  container.querySelector(`#${p}_saveVenc`)?.addEventListener('click', () => {
    if (!vencInput?.value) { showToast('Selecciona una fecha.'); return; }
    pushHistory('Cambiar fecha de vencimiento');
    t.fechaVencimiento = vencInput.value;
    if (typeof saveTramiteFS === 'function') saveTramiteFS(t);
    saveAll(); refreshCardOnly(t); showToast('Fecha actualizada.');
  });

  renderNotasIn(t, container.querySelector(`#${p}_notas`));
  container.querySelector(`#${p}_addNota`)?.addEventListener('click', () => {
    const texto = container.querySelector(`#${p}_newNota`).value.trim();
    if (!texto) { showToast('Escribe el texto de la nota.'); return; }
    pushHistory('Agregar nota');
    t.notas.push({ texto: sentenceCase(texto), fecha: new Date().toISOString() });
    container.querySelector(`#${p}_newNota`).value = '';
    if (typeof saveTramiteFS === 'function') saveTramiteFS(t);
    saveAll(); renderNotasIn(t, container.querySelector(`#${p}_notas`)); showToast('Nota agregada.');
  });
}

// ============================================================
// ACTIVIDADES CON DEBOUNCE EN EDICIÓN INLINE
// ============================================================
function renderActividadesIn(t, listEl, container, expandWrapper) {
  if (!listEl) return;
  listEl.innerHTML = '';

  const sorted = [...t.seguimiento]
    .map((act, origIdx) => ({ act, origIdx }))
    .sort((a, b) => {
      if (a.act.urgente !== b.act.urgente) return a.act.urgente ? -1 : 1;
      return (a.act.fecha || '9999').localeCompare(b.act.fecha || '9999');
    });

  sorted.forEach(({ act, origIdx: i }) => {
    if (!act.attachments) act.attachments = [];
    if (!act.completedBy) act.completedBy = {};
    if (!act.assignedTo) act.assignedTo = [];
    const div    = document.createElement('div');
    const isDone = act.estado === 'realizado';
    div.className = 'actividad-item' + (act.urgente ? ' act-urgente' : '');

    // Per-member completion for team tasks — only for assigned members
    const isTeam = t.sharedWith && t.sharedWith.length > 0;
    const myUid  = AUTH?.userProfile?.uid;
    let memberChecksHtml = '';
    if (isTeam && act.assignedTo && act.assignedTo.length > 1) {
      const uniqueMembers = [...new Set(act.assignedTo)];
      memberChecksHtml = '<div class="act-member-checks">' + uniqueMembers.map(uid => {
        const checked = act.completedBy[uid] ? 'checked' : '';
        const isMe = uid === myUid;
        const name = isMe ? 'Yo' : (typeof abogadoName === 'function' ? abogadoName(uid, t) : uid);
        return `<label class="act-member-check ${checked ? 'done' : ''}" title="${escapeAttr(name)}"><input type="checkbox" data-uid="${escapeAttr(uid)}" ${checked} ${!isMe ? 'disabled' : ''}/><span class="act-member-name">${escapeHtml(name.split(' ')[0])}</span></label>`;
      }).join('') + '</div>';
    }

    const attCount = act.attachments.length;
    // Build assignedTo display badges (skip for propio tramites — always "Yo")
    const isPropio = !t.sharedWith?.length && !t.abogado;
    let assignedHtml = '';
    if (!isPropio) {
      if (act.assignedTo && act.assignedTo.length > 0) {
        assignedHtml = act.assignedTo.map(uid => {
          const n = uid === myUid ? 'Yo' : (typeof abogadoName === 'function' ? abogadoName(uid, t) : uid);
          return `<span class="actividad-resp">${escapeHtml(n.split(' ')[0])}</span>`;
        }).join('');
      } else if (act.responsable && act.responsable !== 'yo') {
        assignedHtml = `<span class="actividad-resp">${escapeHtml(abogadoName(act.responsable, t))}</span>`;
      }
    }
    div.innerHTML = `
      <div class="actividad-check-wrap"><label class="round-check-wrap"><input type="checkbox" class="act-main-check" ${isDone?'checked':''}/><div class="round-check-box"></div></label></div>
      <div class="actividad-info">
        <div class="actividad-desc ${isDone?'done':''}" title="Doble clic para editar">${escapeHtml(act.descripcion)}</div>
        <div class="actividad-meta">
          <input type="date" value="${act.fecha||''}" />
          ${assignedHtml}
          <div class="act-actions-right">
            ${(typeof tipoGestionDesdeTarea === 'function' && tipoGestionDesdeTarea(act.descripcion))
              ? `<button class="act-attach-btn act-borrador-btn" title="Generar borrador de correo"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg></button>`
              : ''}
            <button class="act-attach-btn act-urg-btn ${act.urgente?'active':''}" title="${act.urgente?'Quitar urgente':'Marcar urgente'}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg></button>
            <button class="act-attach-btn act-drive-btn" title="Adjuntar" ${attCount>=5?'disabled':''}><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551"/></svg></button>
            <button class="act-attach-btn act-link-btn" title="Adjuntar enlace" ${attCount>=5?'disabled':''}><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/></svg></button>
            <button class="actividad-delete" title="Eliminar"><i data-lucide="x"></i></button>
          </div>
        </div>
        ${memberChecksHtml}
        <div class="act-attachments-row" data-idx="${i}"></div>
      </div>`;

    // Render per-task attachments
    const attRow = div.querySelector('.act-attachments-row');
    if (typeof renderTaskAttachments === 'function') {
      renderTaskAttachments(act.attachments, attRow, true, idx2 => {
        act.attachments.splice(idx2, 1);
        if (typeof saveTramiteFS === 'function') saveTramiteFS(t);
        saveAll(); renderActividadesIn(t, listEl, container, expandWrapper);
      });
    }

    // Borrador de correo para la tarea (requerimientos, reiteraciones…)
    div.querySelector('.act-borrador-btn')?.addEventListener('click', e => {
      if (typeof generarBorradorTarea === 'function') generarBorradorTarea(t, act, e.currentTarget);
    });

    // Drive attach button per task
    div.querySelector('.act-drive-btn')?.addEventListener('click', async () => {
      if (act.attachments.length >= 5) { showToast('Máximo 5 adjuntos por tarea.'); return; }
      if (typeof openDrivePicker !== 'function') { showToast('Google Drive no disponible.'); return; }
      try {
        const files = await openDrivePicker();
        const space = 5 - act.attachments.length;
        const toAdd = files.slice(0, space);
        if (toAdd.length) {
          act.attachments.push(...toAdd);
          if (typeof saveTramiteFS === 'function') saveTramiteFS(t);
          saveAll(); renderActividadesIn(t, listEl, container, expandWrapper);
          showToast(`${toAdd.length} archivo(s) adjuntado(s).`);
        }
      } catch(e) {}
    });

    // Link attach button per task
    div.querySelector('.act-link-btn')?.addEventListener('click', () => {
      if (act.attachments.length >= 5) { showToast('Máximo 5 adjuntos por tarea.'); return; }
      const url = prompt('Pega la URL del enlace:');
      if (!url || !url.trim()) return;
      const trimmed = url.trim();
      if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
        showToast('Ingresa una URL válida (http:// o https://).'); return;
      }
      const name = prompt('Nombre del enlace (opcional):') || trimmed;
      act.attachments.push({ type: 'link', url: trimmed, name: name.trim(), mimeType: 'link' });
      if (typeof saveTramiteFS === 'function') saveTramiteFS(t);
      saveAll(); renderActividadesIn(t, listEl, container, expandWrapper);
      showToast('Enlace adjuntado.');
    });

    // Per-member completion checks
    if (isTeam && act.assignedTo && act.assignedTo.length > 1) {
      div.querySelectorAll('.act-member-check input').forEach(cb => {
        cb.addEventListener('change', e => {
          const uid = e.target.dataset.uid;
          act.completedBy[uid] = e.target.checked;
          // Auto-mark as done if all assigned members checked
          const uniqueMembers = [...new Set(act.assignedTo)];
          const allDone = uniqueMembers.every(u => act.completedBy[u]);
          act.estado = allDone ? 'realizado' : 'pendiente';
          if (typeof saveTramiteFS === 'function') saveTramiteFS(t);
          saveAll(); refreshCardOnly(t); renderActividadesIn(t, listEl, container, expandWrapper);
        });
      });
    }

    // Debounce en edición inline de descripción
    const descEl = div.querySelector('.actividad-desc');
    descEl.addEventListener('dblclick', () => {
      const input = document.createElement('input'); input.type='text'; input.value=act.descripcion; input.className='actividad-desc-edit';
      descEl.replaceWith(input); input.focus(); input.select();

      let saveTimer = null;
      const doSave = () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          const val = sentenceCase(input.value.trim());
          if (val && val !== act.descripcion) {
            pushHistory('Editar descripción de tarea');
            t.seguimiento[i].descripcion = val;
            if (typeof saveTramiteFS === 'function') saveTramiteFS(t);
            saveAll(); refreshCardOnly(t);
          }
          renderActividadesIn(t, listEl, container, expandWrapper);
        }, 300);
      };
      input.addEventListener('blur', doSave);
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { clearTimeout(saveTimer); renderActividadesIn(t, listEl, container, expandWrapper); }
      });
    });

    // Debounce en cambio de fecha
    let fechaTimer = null;
    div.querySelector('input[type="date"]').addEventListener('change', e => {
      clearTimeout(fechaTimer);
      fechaTimer = setTimeout(() => {
        pushHistory('Cambiar fecha de tarea');
        t.seguimiento[i].fecha = e.target.value;
        if (typeof saveTramiteFS === 'function') saveTramiteFS(t);
        saveAll(); refreshCardOnly(t);
      }, 400);
    });

    div.querySelector('.act-main-check').addEventListener('change', e => {
      pushHistory(e.target.checked ? 'Marcar tarea realizada' : 'Desmarcar tarea');
      t.seguimiento[i].estado = e.target.checked ? 'realizado' : 'pendiente';
      if (typeof saveTramiteFS === 'function') saveTramiteFS(t);
      saveAll(); refreshCardOnly(t); renderActividadesIn(t, listEl, container, expandWrapper);
    });
    div.querySelector('.act-urg-btn').addEventListener('click', () => {
      t.seguimiento[i].urgente = !t.seguimiento[i].urgente;
      if (typeof saveTramiteFS === 'function') saveTramiteFS(t);
      saveAll(); refreshCardOnly(t); renderActividadesIn(t, listEl, container, expandWrapper);
    });
    div.querySelector('.actividad-delete').addEventListener('click', async () => {
      if (await showConfirm('¿Eliminar esta tarea?', { danger: true, confirmLabel: 'Eliminar' })) {
        pushHistory('Eliminar tarea'); t.seguimiento.splice(i, 1);
        if (typeof saveTramiteFS === 'function') saveTramiteFS(t);
        saveAll(); refreshCardOnly(t); renderActividadesIn(t, listEl, container, expandWrapper);
      }
    });

    // Doble clic en responsable → selector inline
    const respEl = div.querySelector('.actividad-resp');
    if (respEl) {
      respEl.title = 'Doble clic para cambiar responsable';
      respEl.style.cursor = 'pointer';
      respEl.addEventListener('dblclick', () => {
        const sel = document.createElement('select');
        sel.className = 'actividad-resp-edit';
        sel.innerHTML = buildRespOptions(t.tipo || 'abogado', t.abogado || 'yo', act.responsable);
        respEl.replaceWith(sel);
        sel.focus();
        const doSave = () => {
          const newResp = sel.value;
          if (newResp !== act.responsable) {
            pushHistory('Cambiar responsable de tarea');
            t.seguimiento[i].responsable = newResp;
            if (typeof createNotification === 'function' && newResp !== 'yo' && newResp !== AUTH?.userProfile?.uid && !newResp.startsWith('abogado_')) {
              createNotification(newResp, 'task_assigned',
                `${AUTH?.userProfile?.displayName || 'Alguien'} te asignó una tarea en el trámite #${t.numero}: "${act.descripcion}"`,
                { tramiteId: t.id });
            }
            if (typeof saveTramiteFS === 'function') saveTramiteFS(t);
            saveAll(); refreshCardOnly(t);
          }
          renderActividadesIn(t, listEl, container, expandWrapper);
        };
        sel.addEventListener('change', doSave);
        sel.addEventListener('blur', doSave);
      });
    }

    listEl.appendChild(div);
  });
}

// ============================================================
// NOTAS CON DEBOUNCE EN EDICIÓN INLINE
// ============================================================
function renderNotasIn(t, listEl) {
  if (!listEl) return;
  listEl.innerHTML = '';
  [...(t.notas || [])].sort((a, b) => a.fecha.localeCompare(b.fecha)).forEach(nota => {
    const idx = t.notas.indexOf(nota);
    const div = document.createElement('div'); div.className = 'nota-item';
    div.innerHTML = `<div class="nota-text" title="Doble clic para editar">${escapeHtml(nota.texto)}</div><div class="nota-fecha">${formatDatetime(nota.fecha)}</div><button class="nota-delete"><i data-lucide="x"></i></button>`;
    const textoEl = div.querySelector('.nota-text');
    textoEl.addEventListener('dblclick', () => {
      const ta = document.createElement('textarea'); ta.value=nota.texto; ta.className='nota-text-edit'; ta.rows=3;
      textoEl.replaceWith(ta); ta.focus(); ta.select();
      let saveTimer = null;
      const doSave = () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          const val = sentenceCase(ta.value.trim());
          if (val && val !== nota.texto) {
            pushHistory('Editar texto de nota'); t.notas[idx].texto = val;
            if (typeof saveTramiteFS === 'function') saveTramiteFS(t);
            saveAll();
          }
          renderNotasIn(t, listEl);
        }, 300);
      };
      ta.addEventListener('blur', doSave);
      ta.addEventListener('keydown', e => {
        if (e.key === 'Escape') { clearTimeout(saveTimer); renderNotasIn(t, listEl); }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ta.blur(); }
      });
    });
    div.querySelector('.nota-delete').addEventListener('click', async () => {
      if (await showConfirm('¿Eliminar esta nota?', { danger: true, confirmLabel: 'Eliminar' })) {
        pushHistory('Eliminar nota'); t.notas.splice(idx, 1);
        if (typeof saveTramiteFS === 'function') saveTramiteFS(t);
        saveAll(); renderNotasIn(t, listEl);
      }
    });
    listEl.appendChild(div);
  });
}

// ============================================================
// MODAL TRÁMITE — múltiples tareas iniciales + scope
// ============================================================
let modalTipoActual  = 'abogado';
let modalScopeActual = 'private';
let _tareasIniciales = [];

let _modalAssignedUids = []; // Selected UIDs in the "Asignar a" multi-select

function populateModalAssign(selectedUids) {
  const dropdown = document.getElementById('fAsignarDropdown');
  const display  = document.getElementById('fAsignarDisplay');
  if (!dropdown || !display) return;

  const myUid = AUTH?.userProfile?.uid;
  const opts = [];
  // "Solo yo" option
  opts.push({ value: 'yo', label: 'Solo yo' });
  // Team members
  if (typeof _teamMembers !== 'undefined') {
    _teamMembers.forEach(m => {
      opts.push({ value: m.uid, label: m.displayName || m.email || m.uid });
    });
  }
  // Manual colaboradores
  (STATE.config.abogados || []).forEach(a => {
    if (!opts.find(o => o.value === a.key)) opts.push({ value: a.key, label: a.nombre });
  });

  dropdown.innerHTML = opts.map(o => {
    const checked = selectedUids.includes(o.value) ? 'checked' : '';
    return `<label class="ms-opt"><input type="checkbox" value="${o.value}" ${checked}/><span>${o.label}</span></label>`;
  }).join('');

  _modalAssignedUids = [...selectedUids];
  _updateModalAssignDisplay();

  // Handle mutual exclusion: "Solo yo" unchecks others and vice versa
  dropdown.querySelectorAll('input').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.value === 'yo' && cb.checked) {
        dropdown.querySelectorAll('input').forEach(o => { if (o !== cb) o.checked = false; });
      } else if (cb.checked) {
        const yoCb = dropdown.querySelector('input[value="yo"]');
        if (yoCb) yoCb.checked = false;
      }
      _modalAssignedUids = [...dropdown.querySelectorAll('input:checked')].map(c => c.value);
      _updateModalAssignDisplay();
    });
  });
}

function _updateModalAssignDisplay() {
  const display = document.getElementById('fAsignarDisplay');
  if (!display) return;
  if (!_modalAssignedUids.length) { display.textContent = 'Seleccionar…'; return; }
  if (_modalAssignedUids.includes('yo')) { display.textContent = 'Solo yo'; return; }
  const names = _modalAssignedUids.map(uid => {
    if (typeof _teamMembers !== 'undefined') { const m = _teamMembers.find(x => x.uid === uid); if (m) return (m.displayName || m.email).split(' ')[0]; }
    const a = (STATE.config.abogados || []).find(x => x.key === uid); if (a) return a.nombre.split(' ')[0];
    return uid.substring(0, 8);
  });
  display.textContent = names.join(', ');
}

function _getModalTipoFromAssign() {
  if (_modalAssignedUids.includes('yo') || !_modalAssignedUids.length) return 'propio';
  const teamUids = (typeof _teamMembers !== 'undefined') ? _teamMembers.map(m => m.uid) : [];
  const hasTeamMember = _modalAssignedUids.some(uid => teamUids.includes(uid));
  return hasTeamMember ? 'equipo' : 'abogado';
}

function addTareaRow(desc = '', fecha = '', resp = '', assignedTo = []) {
  const list = document.getElementById('tareasInicialesList');
  list.querySelector('.tareas-empty-hint')?.remove();

  const idx = _tareasIniciales.length;
  _tareasIniciales.push({ descripcion: desc, fecha, responsable: resp || 'yo', estado: 'pendiente', urgente: false, attachments: [], completedBy: {}, assignedTo: assignedTo.length ? assignedTo : [] });

  const row = document.createElement('div'); row.className = 'tarea-inicial-row'; row.dataset.idx = idx;

  // Build multi-select scoped to who was selected in the modal "Asignar a"
  // Only show assignment selector if there are multiple participants
  const modalAssigned = _modalAssignedUids.filter(u => u !== 'yo');
  const isModalPropio = !modalAssigned.length || _modalAssignedUids.includes('yo');
  const respOpts = isModalPropio ? '' : _buildModalTareaRespOptions(assignedTo);
  const respHtml = isModalPropio ? '' : `
    <div class="ti-resp-wrap">
      <div class="ti-resp-display" title="Asignar a">Asignar…</div>
      <div class="ti-resp-dropdown">${respOpts}</div>
    </div>`;
  row.innerHTML = `
    <input type="text"  class="ti-desc"  placeholder="¿Qué hacer?"  value="${escapeAttr(desc)}" />
    <input type="date"  class="ti-fecha" value="${fecha}" />${respHtml}
    <div class="ti-actions-right">
      <button class="ti-urg ${_tareasIniciales[idx].urgente ? 'active' : ''}" title="Marcar urgente"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg></button>
      <button class="ti-drive" title="Adjuntar"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551"/></svg></button>
      <button class="ti-link" title="Adjuntar enlace"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/></svg></button>
      <button class="ti-del" title="Eliminar"><i data-lucide="x"></i></button>
    </div>
    <div class="ti-atts"></div>`;

  // Multi-select toggle for task assignment (only if dropdown exists)
  const display = row.querySelector('.ti-resp-display');
  const dropdown = row.querySelector('.ti-resp-dropdown');
  if (display && dropdown) {
    display.addEventListener('click', e => { e.stopPropagation(); dropdown.classList.toggle('open'); });
    dropdown.addEventListener('click', e => e.stopPropagation());
    dropdown.addEventListener('change', () => {
      const myUid = AUTH?.userProfile?.uid;
      const checked = [...dropdown.querySelectorAll('input:checked')].map(c => c.value === myUid ? 'yo' : c.value);
      _tareasIniciales[idx].assignedTo = checked;
      _tareasIniciales[idx].responsable = checked[0] || 'yo';
      _updateTiRespDisplay(display, checked);
    });
    _updateTiRespDisplay(display, assignedTo);
    _installDropdownCloser();
  }

  const _renderTiAtts = () => {
    const c = row.querySelector('.ti-atts');
    if (typeof renderTaskAttachments === 'function') {
      renderTaskAttachments(_tareasIniciales[idx]?.attachments || [], c, true, i2 => {
        if (_tareasIniciales[idx]) { _tareasIniciales[idx].attachments.splice(i2, 1); _renderTiAtts(); }
      });
    }
  };
  row.querySelector('.ti-drive').addEventListener('click', async () => {
    if (!_tareasIniciales[idx] || _tareasIniciales[idx].attachments.length >= 5) { showToast('Máximo 5 adjuntos.'); return; }
    if (typeof openDrivePicker !== 'function') { showToast('Google Drive no disponible.'); return; }
    try {
      const files = await openDrivePicker();
      const space = 5 - _tareasIniciales[idx].attachments.length;
      _tareasIniciales[idx].attachments.push(...files.slice(0, space));
      _renderTiAtts();
    } catch(e) {}
  });
  row.querySelector('.ti-link').addEventListener('click', () => {
    if (!_tareasIniciales[idx] || _tareasIniciales[idx].attachments.length >= 5) { showToast('Máximo 5 adjuntos.'); return; }
    const url = prompt('Pega la URL:');
    if (!url || !url.trim()) return;
    const trimmed = url.trim();
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) { showToast('URL inválida.'); return; }
    const name = prompt('Nombre (opcional):') || trimmed;
    _tareasIniciales[idx].attachments.push({ type: 'link', url: trimmed, name: name.trim(), mimeType: 'link' });
    _renderTiAtts();
  });
  row.querySelector('.ti-urg').addEventListener('click', () => {
    _tareasIniciales[idx].urgente = !_tareasIniciales[idx].urgente;
    row.querySelector('.ti-urg').classList.toggle('active', _tareasIniciales[idx].urgente);
  });
  row.querySelector('.ti-del').addEventListener('click', () => {
    _tareasIniciales.splice(idx, 1); row.remove();
  });
  list.appendChild(row);
  setTimeout(() => row.querySelector('.ti-desc')?.focus(), 60);
}

function syncTareasFromDOM() {
  document.querySelectorAll('.tarea-inicial-row').forEach((row, i) => {
    if (_tareasIniciales[i]) {
      _tareasIniciales[i].descripcion = sentenceCase(row.querySelector('.ti-desc')?.value?.trim() || '');
      _tareasIniciales[i].fecha       = row.querySelector('.ti-fecha')?.value || '';
      // assignedTo is already updated via event listeners
      if (!_tareasIniciales[i].assignedTo?.length) {
        _tareasIniciales[i].responsable = 'yo';
      }
    }
  });
}

function _buildMultiRespOptions(selectedValues) {
  const opts = [];
  const myUid = AUTH?.userProfile?.uid;
  if (myUid) opts.push({ value: myUid, label: 'Yo' });
  if (typeof _teamMembers !== 'undefined') {
    _teamMembers.forEach(m => {
      if (m.uid !== myUid) opts.push({ value: m.uid, label: m.displayName || m.email || m.uid });
    });
  }
  (STATE.config.abogados || []).forEach(a => {
    if (!opts.find(o => o.value === a.key)) opts.push({ value: a.key, label: a.nombre });
  });
  return opts.map(o => {
    const checked = selectedValues.includes(o.value) ? 'checked' : '';
    return `<label class="ms-opt"><input type="checkbox" value="${o.value}" ${checked}/><span>${o.label}</span></label>`;
  }).join('');
}

/**
 * Build assignment options for initial tasks in the modal,
 * scoped to the people selected in the modal's "Asignar a".
 */
function _buildModalTareaRespOptions(selectedValues) {
  const opts = [];
  const myUid = AUTH?.userProfile?.uid;
  if (myUid) opts.push({ value: myUid, label: 'Yo' });

  const assignedPeople = _modalAssignedUids.filter(u => u !== 'yo');
  assignedPeople.forEach(uid => {
    if (uid === myUid) return;
    let label = uid;
    if (typeof _teamMembers !== 'undefined') {
      const m = _teamMembers.find(x => x.uid === uid);
      if (m) { label = m.displayName || m.email || uid; }
    }
    const a = (STATE.config.abogados || []).find(x => x.key === uid);
    if (a) label = a.nombre;
    opts.push({ value: uid, label });
  });

  return opts.map(o => {
    const checked = selectedValues.includes(o.value) ? 'checked' : '';
    return `<label class="ms-opt"><input type="checkbox" value="${o.value}" ${checked}/><span>${o.label}</span></label>`;
  }).join('');
}

/**
 * Build assignment options scoped to a specific tramite:
 * - propio: only "Yo" (single, no multi-select needed)
 * - abogado (manual collaborator): "Yo" + the specific collaborator
 * - equipo (sharedWith): "Yo" + only the team members in sharedWith
 */
function _buildTramiteRespOptions(t, selectedValues) {
  const opts = [];
  const myUid = AUTH?.userProfile?.uid;
  if (myUid) opts.push({ value: myUid, label: 'Yo' });

  if (t.sharedWith && t.sharedWith.length > 0) {
    // Team tramite: show only team members assigned to this tramite
    t.sharedWith.forEach(uid => {
      if (uid === myUid) return;
      let label = uid;
      if (typeof _teamMembers !== 'undefined') {
        const m = _teamMembers.find(x => x.uid === uid);
        if (m) label = m.displayName || m.email || uid;
      }
      opts.push({ value: uid, label });
    });
  } else if (t.abogado) {
    // Manual collaborator tramite: show only "Yo" + that collaborator
    const a = (STATE.config.abogados || []).find(x => x.key === t.abogado);
    opts.push({ value: t.abogado, label: a ? a.nombre : t.abogado });
  }
  // For propio: only "Yo" is shown (already added above)

  return opts.map(o => {
    const checked = selectedValues.includes(o.value) ? 'checked' : '';
    return `<label class="ms-opt"><input type="checkbox" value="${o.value}" ${checked}/><span>${o.label}</span></label>`;
  }).join('');
}

function _updateTiRespDisplay(display, values) {
  if (!values.length) { display.textContent = 'Asignar…'; return; }
  const myUid = AUTH?.userProfile?.uid;
  const names = values.map(v => {
    if (v === myUid || v === 'yo') return 'Yo';
    if (typeof _teamMembers !== 'undefined') { const m = _teamMembers.find(x => x.uid === v); if (m) return (m.displayName || m.email).split(' ')[0]; }
    const a = (STATE.config.abogados || []).find(x => x.key === v); if (a) return a.nombre.split(' ')[0];
    return v.substring(0, 6);
  });
  display.textContent = names.join(', ');
  display.title = names.join(', ');
}

let _modalAttachments = [];
function _renderModalAttachments() {
  const c = document.getElementById('modalAttachmentsList');
  if (!c) return;
  if (typeof renderTaskAttachments === 'function') {
    renderTaskAttachments(_modalAttachments, c, true, idx => {
      _modalAttachments.splice(idx, 1); _renderModalAttachments();
    });
  }
}

function openModal(tramite = null) {
  isEditing = !!tramite; editingId = tramite ? tramite.id : null;
  _tareasIniciales = [];

  document.getElementById('modalTitle').textContent  = isEditing ? 'Editar trámite' : 'Nuevo trámite';
  document.getElementById('fNumero').value           = tramite?.numero || '';
  document.getElementById('fDescripcion').value      = tramite?.descripcion || '';
  document.getElementById('fModulo').value           = tramite?.modulo || STATE.config.modulos[0]?.sigla || '';
  document.getElementById('fFechaVencimiento').value = tramite?.fechaVencimiento || '';
  document.getElementById('fNota').value             = '';
  document.getElementById('nuevaNotaFieldsModal').style.display = 'none';
  document.getElementById('tareasInicialesList').innerHTML = '';
  document.getElementById('modalAttachmentsList').innerHTML = '';
  _modalAttachments = tramite?.attachments ? [...tramite.attachments] : [];
  _renderModalAttachments();

  // Populate the multi-select assign dropdown
  let selectedUids = ['yo']; // default: solo yo
  if (tramite?.sharedWith?.length) {
    selectedUids = [...tramite.sharedWith];
  } else if (tramite?.abogado) {
    selectedUids = [tramite.abogado];
  } else if (tramite?.tipo === 'propio' || (!tramite?.abogado && !tramite?.sharedWith?.length)) {
    selectedUids = ['yo'];
  }
  populateModalAssign(selectedUids);
  populatePlantillaSelect();

  document.getElementById('modalOverlay').classList.add('open');
  setTimeout(() => document.getElementById('fNumero')?.focus(), 120);
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
  const m = document.getElementById('tramiteModal');
  m.classList.remove('draggable-active', 'is-dragging');
  m.style.left = ''; m.style.top = '';
  _clearAdminEdit();   // si se cancela una edición admin, no dejar el trámite ajeno en STATE
  // Si el modal se abrió desde el panel de trámites detectados en el correo,
  // ese panel vuelve con el resto de detecciones pendientes.
  if (typeof _gmailOnModalClosed === 'function') _gmailOnModalClosed();
}

// Edición admin de trámites ajenos: limpia el trámite cargado temporalmente
// en STATE.tramites y el uid destino. No-op en flujos normales.
function _clearAdminEdit() {
  if (!window._adminSaveTarget) return;
  const id = window._adminTempId;
  if (id) {
    const i = STATE.tramites.findIndex(x => x.id === id);
    if (i !== -1) STATE.tramites.splice(i, 1);
    const oi = STATE.order.indexOf(id);
    if (oi !== -1) STATE.order.splice(oi, 1);
  }
  window._adminSaveTarget = null;
  window._adminTempId = null;
}

let isEditing = false;
let editingId = null;

// ============================================================
// PROMPT (promesa) — para nombrar plantillas, etc.
// ============================================================
let _promptResolve = null, _promptEl = null;
function showPrompt(msg, def = '') {
  return new Promise(resolve => {
    _promptResolve = resolve;
    if (!_promptEl) {
      _promptEl = document.createElement('div');
      _promptEl.className = 'confirm-overlay';
      _promptEl.innerHTML = `<div class="confirm-box" role="dialog" aria-modal="true">
        <p class="confirm-msg" id="_promptMsg"></p>
        <input type="text" id="_promptInput" class="prompt-input" />
        <div class="confirm-btns">
          <button class="btn btn-primary" id="_promptOk">Guardar</button>
          <button class="btn-small" id="_promptCancel">Cancelar</button>
        </div></div>`;
      document.body.appendChild(_promptEl);
      const close = val => { _promptEl.classList.remove('open'); const r = _promptResolve; _promptResolve = null; if (r) r(val); };
      _promptEl.querySelector('#_promptOk').addEventListener('click', () => close(_promptEl.querySelector('#_promptInput').value.trim() || null));
      _promptEl.querySelector('#_promptCancel').addEventListener('click', () => close(null));
      _promptEl.addEventListener('click', e => { if (e.target === _promptEl) close(null); });
      _promptEl.querySelector('#_promptInput').addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); _promptEl.querySelector('#_promptOk').click(); }
        if (e.key === 'Escape') { e.preventDefault(); _promptEl.querySelector('#_promptCancel').click(); }
      });
    }
    _promptEl.querySelector('#_promptMsg').textContent = msg;
    const input = _promptEl.querySelector('#_promptInput');
    input.value = def;
    _promptEl.classList.add('open');
    setTimeout(() => { input.focus(); input.select(); }, 50);
  });
}

// ============================================================
// PLANTILLAS DE TRÁMITE
// ============================================================
function _daysFromToday(fecha) {
  if (!fecha) return null;
  return Math.round((new Date(fecha) - new Date(today())) / 86400000);
}

function populatePlantillaSelect() {
  const wrap = document.getElementById('fPlantillaWrap');
  const sel  = document.getElementById('fPlantilla');
  if (!sel || !wrap) return;
  const ps = STATE.config.plantillas || [];
  if (isEditing || !ps.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  sel.innerHTML = '<option value="">— Sin plantilla —</option>' +
    ps.map(p => `<option value="${escapeAttr(p.id)}">${escapeHtml(p.nombre)}</option>`).join('');
  sel.value = '';
}

function applyPlantilla(id) {
  const p = (STATE.config.plantillas || []).find(x => x.id === id);
  if (!p) return;
  if (p.modulo)      document.getElementById('fModulo').value = p.modulo;
  if (p.descripcion) document.getElementById('fDescripcion').value = p.descripcion;
  _tareasIniciales = [];
  document.getElementById('tareasInicialesList').innerHTML = '';
  (p.tareas || []).forEach(t => {
    const fecha = (t.dias != null) ? nDaysFromToday(t.dias) : '';
    addTareaRow(t.descripcion || '', fecha, 'yo');
  });
  showToast(`Plantilla "${p.nombre}" aplicada.`);
}

async function saveCurrentAsPlantilla() {
  syncTareasFromDOM();
  const modulo = document.getElementById('fModulo').value;
  const descripcion = sentenceCase(document.getElementById('fDescripcion').value.trim());
  const tareas = _tareasIniciales.filter(t => t.descripcion)
    .map(t => ({ descripcion: t.descripcion, dias: _daysFromToday(t.fecha) }));
  if (!modulo && !tareas.length) { showToast('Define al menos un módulo o una tarea para la plantilla.'); return; }
  const nombre = await showPrompt('Nombre de la plantilla', descripcion || modulo || 'Plantilla');
  if (!nombre) return;
  STATE.config.plantillas = STATE.config.plantillas || [];
  STATE.config.plantillas.push({ id: genId(), nombre, modulo, descripcion, tareas });
  saveAll();
  populatePlantillaSelect();
  showToast(`Plantilla "${nombre}" guardada.`);
}

function renderPlantillasList() {
  const list = document.getElementById('plantillasList');
  if (!list) return;
  const ps = STATE.config.plantillas || [];
  if (!ps.length) { list.innerHTML = '<p style="font-size:13px;color:var(--text-muted)">No hay plantillas guardadas.</p>'; return; }
  list.innerHTML = '';
  ps.forEach((p, i) => {
    const row = document.createElement('div'); row.className = 'plantilla-row';
    const nTareas = (p.tareas || []).length;
    row.innerHTML = `<div class="plantilla-info">
        <span class="plantilla-nombre">${escapeHtml(p.nombre)}</span>
        <span class="plantilla-meta">${escapeHtml(p.modulo || '—')} · ${nTareas} tarea(s)</span>
      </div>
      <button class="btn-icon btn-icon-danger" title="Eliminar plantilla"><i data-lucide="trash-2"></i></button>`;
    row.querySelector('button').addEventListener('click', async () => {
      if (await showConfirm(`¿Eliminar la plantilla "${p.nombre}"?`, { danger: true, confirmLabel: 'Eliminar' })) {
        STATE.config.plantillas.splice(i, 1); saveAll(); renderPlantillasList();
      }
    });
    list.appendChild(row);
  });
  if (window.refreshIcons) window.refreshIcons();
}

async function saveTramite() {
  const numero = document.getElementById('fNumero').value.trim();
  const desc   = sentenceCase(document.getElementById('fDescripcion').value.trim());
  const modulo = document.getElementById('fModulo').value;
  const venc   = document.getElementById('fFechaVencimiento').value;

  // Derive tipo from assign multi-select
  const tipo        = _getModalTipoFromAssign();
  const assignUids  = _modalAssignedUids.filter(u => u !== 'yo');
  const teamMemUids = (typeof _teamMembers !== 'undefined') ? _teamMembers.map(m => m.uid) : [];
  const teamUids    = assignUids.filter(u => teamMemUids.includes(u));
  const colaborador = tipo === 'abogado' ? assignUids[0] : null;

  if (!numero || !modulo) { showToast('Completa: número y módulo.'); return; }
  if (tipo === 'equipo' && !teamUids.length) { showToast('Selecciona al menos un miembro del equipo.'); return; }

  syncTareasFromDOM();
  const tareasValidas = _tareasIniciales.filter(t => t.descripcion);
  const notaTexto     = document.getElementById('fNota').value.trim();
  const notaInicial   = notaTexto ? [{ texto: sentenceCase(notaTexto), fecha: new Date().toISOString() }] : [];

  const btn = document.getElementById('saveTramite');
  btn.disabled = true; btn.textContent = 'Guardando…';

  // Edición admin de un trámite ajeno: se guarda en la cuenta del dueño.
  const adminTarget = window._adminSaveTarget || null;

  try {
    if (isEditing) {
      const t = getById(editingId);
      if (!t) { showToast('Error: no se encontró el trámite.'); return; }
      pushHistory(`Editar trámite #${numero}`);
      Object.assign(t, { numero, descripcion: desc, modulo, fechaVencimiento: venc });
      // En edición admin se preserva la asignación/compartido del dueño
      // (el selector de asignación usa el equipo del admin, no el del dueño).
      if (!adminTarget) {
        t.tipo = tipo === 'equipo' ? 'abogado' : tipo;
        if (tipo === 'abogado') { t.abogado = colaborador; delete t.sharedWith; t._scope = 'team'; }
        else if (tipo === 'equipo') { delete t.abogado; t.sharedWith = teamUids; t._scope = 'team'; }
        else { delete t.abogado; delete t.sharedWith; t._scope = 'private'; }
      }
      if (tareasValidas.length) (t.seguimiento ||= []).unshift(...tareasValidas);
      if (notaInicial.length)   (t.notas ||= []).push(...notaInicial);
      if (_modalAttachments.length) t.attachments = [...(t.attachments || []), ..._modalAttachments];
      if (typeof saveTramiteFS === 'function') await saveTramiteFS(t, adminTarget);
      showToast('Trámite actualizado.');
    } else {
      pushHistory(`Crear trámite #${numero}`);
      const scope = (tipo === 'equipo' || tipo === 'abogado') ? 'team' : 'private';
      const newT = {
        id: genId(), numero, descripcion: desc, modulo,
        tipo: tipo === 'equipo' ? 'abogado' : tipo,
        fechaVencimiento: venc,
        gestion:    { analisis: false, cumplimiento: false },
        seguimiento: tareasValidas, notas: notaInicial, attachments: _modalAttachments.slice(),
        terminado: false, terminadoEn: null,
        creadoEn:  new Date().toISOString(),
        _scope:    scope,
        createdBy: AUTH?.userProfile?.uid || null,
      };
      if (tipo === 'abogado' && colaborador) newT.abogado = colaborador;
      if (tipo === 'equipo') newT.sharedWith = teamUids;

      STATE.tramites.push(newT);
      STATE.order.push(newT.id);

      if (typeof saveTramiteFS === 'function') {
        await saveTramiteFS(newT);
      } else {
        saveAll(true);
      }
      showToast(`Trámite creado${tareasValidas.length ? ' con ' + tareasValidas.length + ' tarea(s)' : ''}.`);
    }
    _clearAdminEdit();   // quita el trámite ajeno del STATE antes de re-renderizar
    renderAll(); closeModal();
  } catch(e) {
    console.error(e); showToast('Error al guardar. Intenta de nuevo.');
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar';
  }
}

// ============================================================
// REPORTE
// ============================================================
let reportFiltroAbogado = '';
let reportDockFiltro    = '';

function openReport() {
  document.getElementById('reportSubtitle').textContent = `Generado el ${formatDate(today())}`;
  updateAbogadoNames(); renderReport();
  document.getElementById('reportOverlay').classList.add('open');
}
function closeReport() { document.getElementById('reportOverlay').classList.remove('open'); }

function renderReport() {
  buildReportInto(document.getElementById('reportContent'), reportFiltroAbogado);
}

// Construye el reporte del día dentro de `contenido` para el filtro dado.
// Reutilizable por el modal, el panel lateral (dock) y la captura a imagen.
function buildReportInto(contenido, filtro) {
  const hoy      = today();
  contenido.innerHTML = '';
  const items    = [];

  STATE.tramites.filter(t => !t.terminado).forEach(t => {
    const abT = t.abogado || null, esP = esPropio(t);
    if (t.fechaVencimiento && !t.gestion?.cumplimiento && t.fechaVencimiento <= hoy) {
      const d = esP ? 'yo' : abT;
      if (!filtro || filtro === d) items.push({ t, tipo:'vencimiento', fecha:t.fechaVencimiento, cls:t.fechaVencimiento<hoy?'overdue':'today', tarea:`Fecha de vencimiento: ${formatDate(t.fechaVencimiento)}`, resp:d, urgente:false });
    }
    if (!esP && !t.gestion?.analisis) {
      if (!filtro || filtro === abT) items.push({ t, tipo:'analisis', fecha:t.fechaVencimiento||'', cls:'today', tarea:'Falta realizar análisis', resp:abT, urgente:false });
    }
    const myUid = AUTH?.userProfile?.uid;
    const isMe  = u => u === 'yo' || u === myUid;
    (t.seguimiento||[]).filter(s => s.estado==='pendiente' && s.fecha && s.fecha<=hoy).forEach(s => {
      const assignees = (s.assignedTo && s.assignedTo.length) ? s.assignedTo : [s.responsable || 'yo'];
      const matchesFilter = !filtro
        || (filtro === 'yo' && (isMe(s.responsable) || assignees.some(isMe)))
        || assignees.some(a => a === filtro);
      if (matchesFilter) {
        const r = isMe(s.responsable) ? 'yo' : (s.responsable || 'yo');
        items.push({ t, tipo:'tarea', fecha:s.fecha, cls:s.fecha<hoy?'overdue':'today', tarea:s.descripcion, resp:r, urgente:!!(s.urgente) });
      }
    });
  });

  if (!items.length) { contenido.innerHTML = '<div class="report-empty"><i data-lucide="party-popper"></i> ¡Sin novedades para hoy!</div>'; return; }
  items.sort((a, b) => {
    if (a.urgente !== b.urgente) return a.urgente ? -1 : 1;
    if (a.cls !== b.cls) return a.cls==='overdue' ? -1 : 1;
    return (a.fecha||'').localeCompare(b.fecha||'');
  });

  const tipoLabel = { vencimiento:'<i data-lucide="calendar"></i> Vencimiento', tarea:'<i data-lucide="pin"></i> Tarea', analisis:'<i data-lucide="search"></i> Análisis pendiente' };
  const renderGroup = (titulo, gItems, cls) => {
    if (!gItems.length) return;
    const sec = document.createElement('div'); sec.className = 'report-section';
    sec.innerHTML = `<div class="report-section-title ${cls}">${titulo} (${gItems.length})</div>`;
    gItems.forEach(item => {
      const el = document.createElement('div'); el.className = `report-item ${item.cls}${item.urgente?' report-urgente':''}`;
      // Para vencimiento, no repetir "Fecha de vencimiento" sino solo la fecha
      const tareaText = item.tipo === 'vencimiento'
        ? `Vence: ${formatDate(item.fecha)}`
        : escapeHtml(item.tarea);
      el.innerHTML = `<div class="report-item-num">${item.urgente?'<i data-lucide="circle-alert"></i> ':''}#${escapeHtml(item.t.numero)}${copyNumBtn(item.t.numero)}</div>
        <div class="report-item-body">
          <div class="report-item-desc">${escapeHtml(item.t.descripcion)}</div>
          <div class="report-item-tarea"><span class="tarea-label">${tipoLabel[item.tipo]||'<i data-lucide="pin"></i>'} — ${tareaText}</span></div>
          <div class="report-item-meta"><span class="report-item-resp">${escapeHtml(item.t.modulo||'')}</span>${item.resp?`<span class="report-item-resp">${escapeHtml(abogadoName(item.resp))}</span>`:''}</div>
        </div>`;
      sec.appendChild(el);
    });
    contenido.appendChild(sec);
  };
  const urg = items.filter(i => i.urgente), venc = items.filter(i => !i.urgente && i.cls==='overdue'), hoyI = items.filter(i => !i.urgente && i.cls!=='overdue');
  if (urg.length) renderGroup('<i data-lucide="circle-alert"></i> Urgentes', urg, 'danger');
  renderGroup('<i data-lucide="triangle-alert"></i> Vencidos / Atrasados', venc, 'danger');
  renderGroup('<i data-lucide="calendar"></i> Para hoy', hoyI, 'warning');
}

// ============================================================
// PANEL LATERAL DEL REPORTE (DOCK)
// ============================================================
// Estado del panel persistido localmente (por dispositivo), no en la config
// sincronizada: abrirlo en un equipo no debe forzarlo en los demás.
const REPORT_DOCK_KEY = 'juritask_report_dock';

function _saveDockState() {
  try {
    localStorage.setItem(REPORT_DOCK_KEY, JSON.stringify({
      open: document.body.classList.contains('report-docked'),
      filtro: reportDockFiltro,
    }));
  } catch (_) {}
}

function renderReportDock() {
  const sub = document.getElementById('reportDockSubtitle');
  if (sub) sub.textContent = `Generado el ${formatDate(today())}`;
  const cont = document.getElementById('reportDockContent');
  if (!cont) return;
  // Conservar la posición de scroll: el panel se re-renderiza al cambiar datos,
  // y saltar arriba haría perder "dónde iba" el usuario (el problema a resolver).
  const prevScroll = cont.scrollTop;
  buildReportInto(cont, reportDockFiltro);
  cont.scrollTop = prevScroll;
}

// Sincroniza el <select> del panel con las opciones actuales y el filtro activo.
function syncReportDockFilter() {
  const sel = document.getElementById('reportDockFilter');
  if (sel && [...sel.options].some(o => o.value === reportDockFiltro)) sel.value = reportDockFiltro;
}

function openReportDock() {
  // Hereda el filtro que estuviera seleccionado en el modal, si lo hay.
  if (reportFiltroAbogado) reportDockFiltro = reportFiltroAbogado;
  if (typeof updateAbogadoNames === 'function') updateAbogadoNames();
  syncReportDockFilter();
  document.body.classList.add('report-docked');
  renderReportDock();
  closeReport(); // el panel reemplaza al modal
  _saveDockState();
  if (window.refreshIcons) window.refreshIcons();
}

function closeReportDock() {
  document.body.classList.remove('report-docked');
  _saveDockState();
}

function toggleReportDock() {
  if (document.body.classList.contains('report-docked')) closeReportDock();
  else openReportDock();
}

// Restaura el panel si quedó abierto en la sesión previa (solo en anchos amplios).
function restoreReportDock() {
  let st = null;
  try { st = JSON.parse(localStorage.getItem(REPORT_DOCK_KEY) || 'null'); } catch (_) {}
  if (!st) return;
  reportDockFiltro = st.filtro || '';
  if (st.open && window.matchMedia('(min-width: 769px)').matches) {
    if (typeof updateAbogadoNames === 'function') updateAbogadoNames();
    syncReportDockFilter();
    document.body.classList.add('report-docked');
    renderReportDock();
  }
}

// ============================================================
// AGENDA ACCIONABLE
// ============================================================
// Reúne lo pendiente para hoy/atrasado conservando referencia al objeto de
// seguimiento, para poder marcar tareas como hechas directamente.
function _buildAgendaItems() {
  const hoy   = today();
  const myUid = AUTH?.userProfile?.uid;
  const isMe  = u => u === 'yo' || u === myUid || !u; // sin responsable explícito ⇒ propio
  const items = [];
  STATE.tramites.filter(t => !t.terminado).forEach(t => {
    const esP = esPropio(t);
    if (t.fechaVencimiento && !t.gestion?.cumplimiento && t.fechaVencimiento <= hoy) {
      // El vencimiento de un trámite propio lo gestiono yo; el de otro abogado, él.
      const resp = esP ? 'yo' : (t.abogado || 'yo');
      items.push({ t, tipo: 'vencimiento', fecha: t.fechaVencimiento, cls: t.fechaVencimiento < hoy ? 'overdue' : 'today', urgente: false, resp, mine: isMe(resp) });
    }
    if (!esP && !t.gestion?.analisis) {
      // Análisis pendiente de un trámite que pertenece a otro abogado.
      const resp = t.abogado || 'yo';
      items.push({ t, tipo: 'analisis', fecha: t.fechaVencimiento || '', cls: 'today', urgente: false, resp, mine: isMe(resp) });
    }
    (t.seguimiento || []).filter(s => s.estado === 'pendiente' && s.fecha && s.fecha <= hoy).forEach(s => {
      const assignees = (s.assignedTo && s.assignedTo.length) ? s.assignedTo : [s.responsable || 'yo'];
      const mine = isMe(s.responsable) || assignees.some(isMe);
      const resp = mine ? 'yo' : (s.responsable || assignees[0] || 'yo');
      items.push({ t, s, tipo: 'tarea', fecha: s.fecha, cls: s.fecha < hoy ? 'overdue' : 'today', urgente: !!s.urgente, resp, mine });
    });
  });
  items.sort((a, b) => {
    if (a.urgente !== b.urgente) return a.urgente ? -1 : 1;
    if (a.cls !== b.cls) return a.cls === 'overdue' ? -1 : 1;
    return (a.fecha || '').localeCompare(b.fecha || '');
  });
  return items;
}

function countAgendaPendientes() {
  return _buildAgendaItems().length;
}

function _persistTramite(t) {
  saveAll();
  if (typeof saveTramiteFS === 'function') saveTramiteFS(t);
}

// Aplaza una tarea de seguimiento moviendo su fecha (sale de la agenda de hoy
// y reaparece en la nueva fecha). Localiza el trámite dueño para persistir.
let _agendaSnoozeCloserInstalled = false;
function _aplazarTarea(seg, nuevaFecha) {
  if (!seg || !nuevaFecha) return;
  const t = STATE.tramites.find(x => (x.seguimiento || []).includes(seg));
  pushHistory('Aplazar tarea');
  seg.fecha = nuevaFecha;
  if (t) _persistTramite(t); else saveAll();
  showToast(`Tarea aplazada al ${formatDate(nuevaFecha)}.`, null, { label: 'Deshacer', onClick: undo });
  renderAgenda(); _updateAgendaBadge();
}

// Cierra cualquier menú de aplazar abierto al hacer clic fuera (una sola vez).
function _installAgendaSnoozeCloser() {
  if (_agendaSnoozeCloserInstalled) return;
  _agendaSnoozeCloserInstalled = true;
  document.addEventListener('click', e => {
    document.querySelectorAll('.agenda-snooze-menu.open').forEach(m => {
      if (!m.closest('.agenda-snooze-wrap')?.contains(e.target)) m.classList.remove('open');
    });
  });
}

// Actualiza el estado activo y los contadores de los botones Mías/De otros/Todas.
function _syncAgendaScopeButtons(scope, allItems) {
  const group = document.getElementById('agendaScopeGroup');
  if (!group) return;
  const mias  = allItems.filter(i => i.mine).length;
  const otros = allItems.length - mias;
  const counts = { mias, otros, all: allItems.length };
  const labels = { mias: 'Mías', otros: 'De otros', all: 'Todas' };
  group.querySelectorAll('.toggle-btn').forEach(btn => {
    const s = btn.dataset.scope;
    btn.classList.toggle('active', s === scope);
    btn.textContent = `${labels[s]} (${counts[s] ?? 0})`;
  });
}

// Tras completar una tarea, transforma su fila en un mini-formulario para
// registrar de inmediato la siguiente tarea del mismo trámite (hereda
// responsable/asignados de la tarea recién cerrada).
function _showAgendaNextTaskForm(row, t, prevTask) {
  const defFecha = nDaysFromToday(7);
  row.className = 'agenda-item agenda-next-form';
  row.innerHTML = `
    <div class="agenda-next">
      <div class="agenda-next-head">
        <i data-lucide="corner-down-right"></i> Siguiente tarea para
        <span class="agenda-num">#${escapeHtml(t.numero)}</span>${copyNumBtn(t.numero)}
      </div>
      <div class="agenda-next-fields">
        <input type="text" class="agenda-next-desc" placeholder="¿Qué sigue? (deja vacío si no hay)" />
        <input type="date" class="agenda-next-fecha" value="${defFecha}" />
      </div>
      <div class="agenda-next-actions">
        <button type="button" class="btn-small agenda-next-save"><i data-lucide="plus"></i> Guardar</button>
        <button type="button" class="btn-small agenda-next-skip">Listo, sin tarea</button>
      </div>
    </div>`;

  const descEl  = row.querySelector('.agenda-next-desc');
  const fechaEl = row.querySelector('.agenda-next-fecha');
  setTimeout(() => descEl?.focus(), 60);

  const close = () => { renderAgenda(); _updateAgendaBadge(); };

  const save = () => {
    const desc = descEl.value.trim();
    if (!desc) { close(); return; } // sin descripción: equivale a "Listo"
    pushHistory('Agregar tarea');
    const assignedTo  = Array.isArray(prevTask?.assignedTo) ? [...prevTask.assignedTo] : [];
    const responsable = prevTask?.responsable || assignedTo[0] || 'yo';
    if (!Array.isArray(t.seguimiento)) t.seguimiento = [];
    t.seguimiento.push({ descripcion: sentenceCase(desc), fecha: fechaEl.value || '', responsable, estado: 'pendiente', urgente: false, attachments: [], completedBy: {}, assignedTo });
    // Notificar a los asignados que no sean yo
    const myUid = AUTH?.userProfile?.uid;
    assignedTo.forEach(uid => {
      if (typeof createNotification === 'function' && uid !== 'yo' && uid !== myUid && !String(uid).startsWith('abogado_')) {
        createNotification(uid, 'task_assigned',
          `${AUTH?.userProfile?.displayName || 'Alguien'} te asignó una tarea en el trámite #${t.numero}: "${sentenceCase(desc)}"`,
          { tramiteId: t.id });
      }
    });
    _persistTramite(t);
    showToast('Tarea agregada.', null, { label: 'Deshacer', onClick: undo });
    close();
  };

  row.querySelector('.agenda-next-save').addEventListener('click', save);
  row.querySelector('.agenda-next-skip').addEventListener('click', close);
  descEl.addEventListener('keydown',  e => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  fechaEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  if (window.refreshIcons) window.refreshIcons();
}

function renderAgenda() {
  const cont  = document.getElementById('agendaContent');
  const empty = document.getElementById('emptyAgenda');
  if (!cont) return;
  const allItems = _buildAgendaItems();

  // ── Filtro por responsabilidad (Mías / De otros / Todas) ──
  const scope = STATE.config.agendaScope || 'mias';
  _syncAgendaScopeButtons(scope, allItems);
  const items = scope === 'mias'  ? allItems.filter(i => i.mine)
              : scope === 'otros' ? allItems.filter(i => !i.mine)
              : allItems;

  if (!items.length) {
    cont.innerHTML = '';
    if (empty) {
      empty.style.display = '';
      const msg = empty.querySelector('p');
      if (msg) msg.textContent = allItems.length
        ? (scope === 'mias'  ? '¡Nada pendiente a tu cargo! Las tareas de otros están en «De otros».'
         : scope === 'otros' ? 'No hay tareas pendientes a cargo de otros.'
         : '¡Agenda al día! Sin tareas pendientes para hoy.')
        : '¡Agenda al día! Sin tareas pendientes para hoy.';
    }
    return;
  }
  if (empty) empty.style.display = 'none';
  cont.innerHTML = '';

  const tipoLabel = {
    vencimiento: '<i data-lucide="calendar"></i> Vencimiento',
    tarea:       '<i data-lucide="pin"></i> Tarea',
    analisis:    '<i data-lucide="search"></i> Análisis pendiente',
  };

  const renderGroup = (titulo, gItems, cls) => {
    if (!gItems.length) return;
    const sec = document.createElement('div'); sec.className = 'agenda-section';
    const head = document.createElement('div');
    head.className = `agenda-section-title ${cls}`;
    head.innerHTML = `${titulo} (${gItems.length})`;
    sec.appendChild(head);

    gItems.forEach(item => {
      const row = document.createElement('div');
      row.className = `agenda-item ${item.cls}${item.urgente ? ' agenda-urgente' : ''}`;

      const tareaText = item.tipo === 'vencimiento'
        ? `Vence: ${formatDate(item.fecha)}`
        : (item.tipo === 'analisis' ? 'Falta realizar el análisis' : escapeHtml(item.s.descripcion));

      // Control de acción según tipo
      let actionHtml;
      if (item.tipo === 'tarea' || item.tipo === 'analisis') {
        actionHtml = `<label class="agenda-check round-check-wrap" title="Marcar como hecho"><input type="checkbox" class="agenda-check-input"/><div class="round-check-box"></div></label>`;
      } else {
        actionHtml = `<button type="button" class="btn-small agenda-done-btn" title="Marcar vencimiento cumplido"><i data-lucide="check"></i> Cumplido</button>`;
      }

      // Control de aplazar (solo tareas: mueven su fecha hacia adelante)
      const snoozeHtml = item.tipo === 'tarea' ? `
        <div class="agenda-snooze-wrap">
          <button type="button" class="agenda-snooze-btn" title="Aplazar tarea" aria-label="Aplazar tarea"><i data-lucide="alarm-clock"></i></button>
          <div class="agenda-snooze-menu">
            <button type="button" data-days="1">Mañana</button>
            <button type="button" data-days="3">En 3 días</button>
            <button type="button" data-days="7">Próxima semana</button>
            <label class="agenda-snooze-custom">Otra fecha<input type="date" class="agenda-snooze-date" /></label>
          </div>
        </div>` : '';

      row.innerHTML = `
        ${actionHtml}
        <div class="agenda-body">
          <div class="agenda-line">
            ${item.urgente ? '<i data-lucide="circle-alert"></i> ' : ''}<span class="agenda-num">#${escapeHtml(item.t.numero)}</span>${copyNumBtn(item.t.numero)}
            <span class="tag tag-modulo">${escapeHtml(item.t.modulo || '')}</span>
            <span class="agenda-type">${tipoLabel[item.tipo] || ''}</span>
            ${item.mine ? '' : `<span class="agenda-resp"><i data-lucide="user"></i> ${escapeHtml(abogadoName(item.resp, item.t))}</span>`}
          </div>
          <div class="agenda-desc">${escapeHtml(item.t.descripcion || '(sin descripción)')}</div>
          <div class="agenda-task">${tareaText}</div>
        </div>
        ${snoozeHtml}`;

      // Abrir detalle al hacer clic en el cuerpo
      row.querySelector('.agenda-body').addEventListener('click', () => openDetail(item.t.id));

      // Acción de completar
      const chk = row.querySelector('.agenda-check-input');
      if (chk) {
        chk.addEventListener('change', () => {
          if (item.tipo === 'tarea') {
            pushHistory('Completar tarea'); item.s.estado = 'realizado';
            _persistTramite(item.t);
            showToast('Tarea completada.', null, { label: 'Deshacer', onClick: undo });
            // Encadenar: ofrecer registrar de inmediato la siguiente tarea
            _showAgendaNextTaskForm(row, item.t, item.s);
            _updateAgendaBadge();
            return;
          }
          // analisis
          pushHistory('Marcar análisis'); item.t.gestion = item.t.gestion || {}; item.t.gestion.analisis = true;
          _persistTramite(item.t);
          showToast('Análisis marcado.', null, { label: 'Deshacer', onClick: undo });
          renderAgenda(); _updateAgendaBadge();
        });
      }
      const doneBtn = row.querySelector('.agenda-done-btn');
      if (doneBtn) {
        doneBtn.addEventListener('click', () => {
          pushHistory('Marcar vencimiento cumplido');
          item.t.gestion = item.t.gestion || {}; item.t.gestion.cumplimiento = true;
          crearTareaRequerimiento(item.t);
          _persistTramite(item.t);
          showToast('Vencimiento marcado como cumplido.', null, { label: 'Deshacer', onClick: undo });
          renderAgenda(); _updateAgendaBadge();
        });
      }

      // Aplazar tarea
      const snoozeBtn  = row.querySelector('.agenda-snooze-btn');
      const snoozeMenu = row.querySelector('.agenda-snooze-menu');
      if (snoozeBtn && snoozeMenu) {
        snoozeBtn.addEventListener('click', e => {
          e.stopPropagation();
          const willOpen = !snoozeMenu.classList.contains('open');
          document.querySelectorAll('.agenda-snooze-menu.open').forEach(m => m.classList.remove('open'));
          snoozeMenu.classList.toggle('open', willOpen);
        });
        snoozeMenu.addEventListener('click', e => e.stopPropagation());
        snoozeMenu.querySelectorAll('button[data-days]').forEach(btn => {
          btn.addEventListener('click', () => _aplazarTarea(item.s, nDaysFromToday(parseInt(btn.dataset.days, 10))));
        });
        snoozeMenu.querySelector('.agenda-snooze-date')?.addEventListener('change', e => {
          if (e.target.value) _aplazarTarea(item.s, e.target.value);
        });
        _installAgendaSnoozeCloser();
      }

      sec.appendChild(row);
    });
    cont.appendChild(sec);
  };

  const urg  = items.filter(i => i.urgente);
  const venc = items.filter(i => !i.urgente && i.cls === 'overdue');
  const hoyI = items.filter(i => !i.urgente && i.cls !== 'overdue');
  renderGroup('<i data-lucide="circle-alert"></i> Urgentes', urg, 'danger');
  renderGroup('<i data-lucide="triangle-alert"></i> Vencidos / Atrasados', venc, 'danger');
  renderGroup('<i data-lucide="calendar"></i> Para hoy', hoyI, 'warning');

  if (window.refreshIcons) window.refreshIcons();
}

function _updateAgendaBadge() {
  const badge = document.getElementById('agendaBadge');
  if (!badge) return;
  const n = countAgendaPendientes();
  badge.textContent = n;
  badge.classList.toggle('hidden', n === 0);
}

// ============================================================
// CONFIGURACIÓN — render
// ============================================================
function renderConfig() {
  renderAbogadosList();
  const cb1=document.getElementById('colorBar1'); if(cb1) cb1.value=STATE.config.colorBar1||'#f59e0b';
  const cb2=document.getElementById('colorBar2'); if(cb2) cb2.value=STATE.config.colorBar2||'#3b5bdb';
  const cb3=document.getElementById('colorBar3'); if(cb3) cb3.value=STATE.config.colorBar3||'#10b981';
  updateBarPreviews(); setDetailMode(STATE.config.detailMode||'expand'); renderModulosList(); renderPlantillasList(); renderThemeGrid();
  const arT=document.getElementById('autoReqToggle');       if(arT) arT.checked=STATE.config.autoReq!==false;
  const arX=document.getElementById('autoReqTexto');        if(arX) arX.value=STATE.config.autoReqTexto||'1er req';
  const arD=document.getElementById('autoReqDias');         if(arD) arD.value=STATE.config.autoReqDias??7;
  const arR=document.getElementById('autoReqResponsable');  if(arR) arR.value=STATE.config.autoReqResponsable||'yo';
  syncAutoReqFields();
  const gemK=document.getElementById('geminiApiKey');       if(gemK) gemK.value=STATE.config.geminiApiKey||'';
  const bAut=document.getElementById('bitacoraAutoToggle'); if(bAut) bAut.checked=STATE.config.bitacoraAuto!==false;
  const bInt=document.getElementById('bitacoraIntervalo');  if(bInt) bInt.value=STATE.config.bitacoraIntervalo??10;
  const bDia=document.getElementById('bitacoraDias');       if(bDia) bDia.value=STATE.config.bitacoraDias??7;
  const drT=document.getElementById('diasRestantesToggle'); if(drT) drT.checked=!!(STATE.config.diasRestantes);

  // Mostrar sección admin solo si el usuario es admin
  const isAdmin = (typeof AUTH !== 'undefined') && AUTH.userProfile?.role === 'admin';
  const adminSec = document.getElementById('adminSection');
  if (adminSec) adminSec.style.display = isAdmin ? '' : 'none';
  if (isAdmin && typeof loadAdminUsers === 'function') loadAdminUsers();

  // Cargar lista de backups
  if (typeof renderBackupList === 'function') renderBackupList();
}

function renderAbogadosList() {
  const list = document.getElementById('abogadosList'); if (!list) return; list.innerHTML = '';
  const members = (typeof _teamMembers !== 'undefined') ? _teamMembers : [];

  if (members.length) {
    const hdr = document.createElement('p');
    hdr.style.cssText = 'font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px;margin-top:4px';
    hdr.textContent = 'Miembros del equipo';
    list.appendChild(hdr);
    members.forEach(m => {
      const saved = (STATE.config.abogados||[]).find(x => x.key === m.uid);
      const color = saved ? saved.color : '#6b7280';
      const row = document.createElement('div'); row.className = 'abogado-config-row';
      row.innerHTML = `<span class="abogado-num"><i data-lucide="user"></i></span>
        <span style="flex:1;font-size:13px;color:var(--text-primary)">${escapeAttr(m.displayName||m.email||m.uid)}</span>
        <input type="color" class="color-picker ab-color-team" value="${color}" title="Color" data-uid="${m.uid}"/>
        <span class="color-preview ab-preview" style="background:${color}"></span>`;
      const picker = row.querySelector('.ab-color-team');
      const preview = row.querySelector('.ab-preview');
      picker.addEventListener('input', e => {
        preview.style.background = e.target.value;
        let entry = (STATE.config.abogados||[]).find(x => x.key === m.uid);
        if (entry) { entry.color = e.target.value; }
        else { STATE.config.abogados.push({ key: m.uid, nombre: m.displayName||m.email, color: e.target.value }); }
        saveAll(); applyCssColors();
      });
      list.appendChild(row);
    });
  }

  const manual = (STATE.config.abogados||[]).filter(a => !members.find(m => m.uid === a.key));
  if (manual.length) {
    const hdr2 = document.createElement('p');
    hdr2.style.cssText = 'font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px;margin-top:12px';
    hdr2.textContent = 'Colaboradores manuales';
    list.appendChild(hdr2);
    manual.forEach(a => {
      const i = STATE.config.abogados.indexOf(a);
      const row = document.createElement('div'); row.className = 'abogado-config-row';
      row.innerHTML = `<input type="text" class="ab-nombre" value="${escapeAttr(a.nombre)}" placeholder="Nombre"/>
        <input type="color" class="color-picker ab-color" value="${a.color}" title="Color"/>
        <span class="color-preview ab-preview" style="background:${a.color}"></span>
        <button class="btn-icon btn-icon-danger ab-delete" title="Eliminar"><i data-lucide="x"></i></button>`;
      row.querySelector('.ab-color').addEventListener('input', e => row.querySelector('.ab-preview').style.background = e.target.value);
      row.querySelector('.ab-delete').addEventListener('click', async () => {
        const ok = await showConfirm(`¿Eliminar al colaborador "${a.nombre}"?`);
        if (ok) { STATE.config.abogados.splice(i,1); saveAll(); applyCssColors(); updateAbogadoSelects(); renderAbogadosList(); renderAll(); showToast('Colaborador eliminado.'); }
      });
      list.appendChild(row);
    });
  }

  if (!members.length && !manual.length) {
    list.innerHTML = '<p style="font-size:13px;color:var(--text-muted);font-style:italic">No hay colaboradores configurados.</p>';
  }
}

function syncAutoReqFields() {
  const on = document.getElementById('autoReqToggle')?.checked;
  const f  = document.getElementById('autoReqFields');
  if (f) { f.style.opacity = on ? '1' : '0.4'; f.style.pointerEvents = on ? '' : 'none'; }
}

function renderThemeGrid() {
  const grid = document.getElementById('themeGrid'); if (!grid) return; grid.innerHTML = '';
  THEMES.forEach(theme => {
    const card = document.createElement('div'); card.className='theme-card'+(STATE.config.theme===theme.id?' active':''); card.dataset.theme=theme.id;
    card.innerHTML = `<div class="theme-swatch">${theme.swatches.map(c=>`<div class="theme-swatch-part" style="background:${c}"></div>`).join('')}</div><div class="theme-name">${theme.nombre}</div>`;
    card.addEventListener('click', () => { applyTheme(theme.id); saveAll(); renderThemeGrid(); });
    grid.appendChild(card);
  });
}

function updateBarPreviews() {
  [1,2,3].forEach(n => {
    const p=document.getElementById(`colorBar${n}`), prev=document.getElementById(`barPreview${n}`);
    if (p && prev) prev.style.background = p.value;
  });
}

function renderModulosList() {
  const list = document.getElementById('modulosList'); if (!list) return; list.innerHTML = '';
  STATE.config.modulos.forEach((m, i) => {
    const row = document.createElement('div'); row.className = 'modulo-row';
    row.innerHTML = `<span class="modulo-sigla">${m.sigla}</span><span class="modulo-nombre">${m.nombre}</span><button class="modulo-delete"><i data-lucide="x"></i></button>`;
    row.querySelector('.modulo-delete').addEventListener('click', async () => {
      if (await showConfirm(`¿Eliminar módulo ${m.sigla}?`, { danger: true, confirmLabel: 'Eliminar' })) { STATE.config.modulos.splice(i,1); saveAll(); populateModuloSelects(); renderModulosList(); }
    });
    list.appendChild(row);
  });
}

// ============================================================
// SIDEBAR
// ============================================================
function isMobile() { return window.innerWidth <= 768; }

const backdropEl = document.createElement('div');
backdropEl.className = 'sidebar-backdrop';
document.body.appendChild(backdropEl);

function openSidebar() {
  if (isMobile()) { document.getElementById('sidebar').classList.add('open'); backdropEl.classList.add('show'); }
  else { document.getElementById('sidebar').classList.remove('collapsed'); document.querySelector('.app-layout').classList.remove('expanded'); }
}
function closeSidebar() {
  if (isMobile()) { document.getElementById('sidebar').classList.remove('open'); backdropEl.classList.remove('show'); }
  else { document.getElementById('sidebar').classList.add('collapsed'); document.querySelector('.app-layout').classList.add('expanded'); }
}
function toggleSidebar() {
  if (isMobile()) document.getElementById('sidebar').classList.contains('open') ? closeSidebar() : openSidebar();
  else document.getElementById('sidebar').classList.contains('collapsed') ? openSidebar() : closeSidebar();
}

function setupContainerDrop(container) {
  container.addEventListener('dragover', e => e.preventDefault());
  container.addEventListener('drop', e => {
    e.preventDefault();
    if (e.target === container && dragSrcId) {
      const order = getActiveOrder(), si = order.indexOf(dragSrcId);
      if (si !== -1) { order.splice(si,1); order.push(dragSrcId); STATE.order=order; saveAll(); renderAll(); }
    }
  });
}

function openMobSheet()  { document.getElementById('mobSheet').classList.add('open');    document.getElementById('mobSheetOverlay').classList.add('show'); }
function closeMobSheet() { document.getElementById('mobSheet').classList.remove('open'); document.getElementById('mobSheetOverlay').classList.remove('show'); }

// ============================================================
// MODAL DRAGGABLE
// ============================================================
function initDraggableModal(modalEl) {
  const header = modalEl.querySelector('.modal-header'); if (!header) return;
  let dragging=false, startX, startY, origLeft, origTop;
  header.addEventListener('mousedown', e => {
    if (e.target.closest('button') || isMobile()) return;
    dragging = true;
    if (!modalEl.classList.contains('draggable-active')) {
      const rect = modalEl.getBoundingClientRect();
      modalEl.style.left = rect.left + 'px'; modalEl.style.top = rect.top + 'px';
      modalEl.classList.add('draggable-active');
    }
    origLeft=parseFloat(modalEl.style.left)||0; origTop=parseFloat(modalEl.style.top)||0;
    startX=e.clientX; startY=e.clientY;
    header.classList.add('is-dragging'); modalEl.classList.add('is-dragging'); e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const m=8, l=Math.max(m,Math.min(origLeft+(e.clientX-startX), window.innerWidth-modalEl.offsetWidth-m));
    const t2=Math.max(m,Math.min(origTop+(e.clientY-startY), window.innerHeight-modalEl.offsetHeight-m));
    modalEl.style.left=l+'px'; modalEl.style.top=t2+'px';
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return; dragging=false;
    header.classList.remove('is-dragging'); modalEl.classList.remove('is-dragging');
  });
}
