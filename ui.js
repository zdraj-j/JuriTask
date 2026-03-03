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

function showToast(msg) {
  if (!_toastEl) _toastEl = document.getElementById('toast');
  _toastEl.textContent = msg;
  _toastEl.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => _toastEl.classList.remove('show'), 2800);
}

// ============================================================
// CONFIRM DIALOG (promesa)
// ============================================================
let _confirmResolve = null;

function showConfirm(msg) {
  return new Promise(resolve => {
    _confirmResolve = resolve;
    document.getElementById('confirmMsg').textContent = msg;
    document.getElementById('confirmOverlay').classList.add('open');
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
  const urgentes = applyFilters(sorted.filter(t => esHoyOVencido(t)), f);
  renderList(document.getElementById('todayList'),    document.getElementById('emptyToday'),     urgentes);

  const badge = document.getElementById('todayBadge');
  badge.textContent = urgentes.length;
  badge.classList.toggle('hidden', urgentes.length === 0);

  renderList(document.getElementById('finishedList'), document.getElementById('emptyFinished'), STATE.tramites.filter(t => t.terminado));

  if (currentView === 'calendar') renderCalendar();
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
    const lbl   = { overdue:'⚠ Vencido', today:'⚠ Hoy', soon:'⏰ Mañana', upcoming:'📅 Vence' }[vcls] || '📅 Vence';
    const dias  = STATE.config.diasRestantes ? diasRestantesNum(t.fechaVencimiento) : null;
    const dtag  = dias !== null ? ` <span class="dias-restantes ${vcls}">${diasRestantesLabel(dias)}</span>` : '';
    vencHtml    = `<span class="venc-fecha ${vcls}">${lbl}: ${formatDate(t.fechaVencimiento)}</span>${dtag}`;
  }

  // Responsable — para trámites compartidos recibidos, mostrar quién los creó
  let respTag;
  if (esP) {
    respTag = `<span class="tag tag-propio">👤 Propio</span>`;
  } else {
    // Si el trámite viene de otra persona (_sharedFrom), mostrar su nombre
    const displayKey = (t._sharedFrom && t._sharedFrom !== AUTH?.userProfile?.uid)
      ? t._sharedFrom
      : t.abogado;
    const col = abogadoColor(displayKey), bg = hexToRgba(col, 0.12);
    respTag = `<span class="tag tag-abogado" style="background:${bg};color:${col}">${abogadoName(displayKey, t)}</span>`;
  }

  const etapaTag   = t.terminado ? `<span class="tag tag-terminado">Terminado</span>` : '';
  const pends      = (t.seguimiento||[]).filter(s => s.estado === 'pendiente');
  const tieneUrg   = pends.some(s => s.urgente);
  const urgenteTag = tieneUrg ? `<span class="tag tag-urgente">🔴 Urgente</span>` : '';
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
          <span class="card-numero">#${t.numero}</span>
          <span class="tag tag-modulo">${t.modulo}</span>
          ${respTag}${etapaTag}${urgenteTag}
        </div>
        <div class="card-desc">${escapeHtml(t.descripcion || '(sin descripción)')}</div>
        <div class="card-dates">${vencHtml}</div>
        ${segHtml}
      </div>
    </div>`;

  // Botón nueva tarea rápida
  if (!t.terminado) {
    const tareaRow = document.createElement('div'); tareaRow.className = 'card-nueva-tarea-row';
    const btnT     = document.createElement('button'); btnT.className = 'btn-card-tarea'; btnT.textContent = '＋ Nueva tarea';
    tareaRow.appendChild(btnT); card.appendChild(tareaRow);
    btnT.addEventListener('click', e => {
      e.stopPropagation(); openDetail(t.id);
      setTimeout(() => {
        const pid  = `det_${t.id}`;
        const form = document.getElementById(`${pid}_formNuevaTarea`);
        if (form) { form.style.display = 'block'; setTimeout(() => document.getElementById(`${pid}_newActDesc`)?.focus(), 80); }
      }, 380);
    });
  }

  // Click en tarjeta → detalle
  card.addEventListener('click', e => {
    if (e.target.closest('.card-checks') || e.target.closest('.card-nueva-tarea-row')) return;
    openDetail(t.id);
  });

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
        if (e.target.checked) { crearTareaRequerimiento(t); showToast('✓ Cumplimiento marcado. Tarea automática creada.'); }
        saveAll(); renderAll();
      });
    }
    card.querySelector('.card-check-terminar').addEventListener('change', e => {
      if (!e.target.checked) return; e.target.checked = false;
      if (!confirm('¿Marcar este trámite como terminado?')) return;
      pushHistory('Terminar trámite'); t.terminado = true; t.terminadoEn = new Date().toISOString();
      if (typeof saveTramiteFS === 'function') saveTramiteFS(t);
      saveAll(); renderAll(); showToast('Trámite terminado. ✓');
    });
    attachDragEvents(card, wrapper);
  }

  wrapper.appendChild(card);
  return wrapper;
}

function buildSeguimientoHtml(tareas, tramite) {
  if (!tareas.length) return '';
  return `<div class="card-seguimiento">
    ${tareas.slice(0, 2).map(s => {
      const dc   = dateClass(s.fecha);
      const urg  = s.urgente ? '<span class="seg-urg">🔴</span>' : '';
      const fech = s.fecha  ? `<span class="seg-fecha ${dc}">${formatDate(s.fecha)}</span>` : '';
      const resp = s.responsable ? `<span style="color:var(--text-muted);font-size:10px">· ${abogadoName(s.responsable, tramite)}</span>` : '';
      return `<div class="card-seg-item"><div class="seg-dot ${dc}"></div>${urg}<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.descripcion}</span>${fech}${resp}</div>`;
    }).join('')}
    ${tareas.length > 2 ? `<div class="card-seg-item" style="color:var(--text-muted);font-size:11px">+${tareas.length - 2} más…</div>` : ''}
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
        const lbl  = { overdue:'⚠ Vencido', today:'⚠ Hoy', soon:'⏰ Mañana', upcoming:'📅 Vence' }[vcls] || '📅 Vence';
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
  STATE.config.detailMode === 'modal' ? openDetailModal(t) : openDetailExpand(t);
}

function openDetailModal(t) {
  closeAllExpands();
  document.getElementById('detailTitle').textContent    = `Trámite #${t.numero}`;
  document.getElementById('detailSubtitle').textContent = `${t.descripcion} · ${esPropio(t) ? 'Propio' : abogadoName(t.abogado)} · ${t.modulo}${t.fechaVencimiento ? ` · Vence: ${formatDate(t.fechaVencimiento)}` : ''}`;
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

  wrapper.querySelector('.tramite-card').classList.add('card-open');

  let panel = wrapper.querySelector('.expand-panel');
  if (!panel) {
    panel             = document.createElement('div'); panel.className = 'expand-panel';
    const inner       = document.createElement('div'); inner.className = 'expand-panel-inner';
    const actBar      = document.createElement('div'); actBar.className = 'expand-actions';
    actBar.innerHTML  = `
      <button class="btn-icon" data-action="dup"    title="Duplicar">⧉</button>
      <button class="btn-icon" data-action="edit"   title="Editar">✎</button>
      <button class="btn-icon btn-icon-danger" data-action="delete" title="Eliminar">🗑</button>
      <button class="btn-icon modal-close"    data-action="close"  title="Cerrar">✕</button>`;

    actBar.querySelector('[data-action="dup"]').addEventListener('click', () => {
      const newT = JSON.parse(JSON.stringify(t));
      newT.id = genId(); newT.numero = t.numero + '-copia';
      newT.terminado = false; newT.terminadoEn = null; newT.creadoEn = new Date().toISOString();
      newT.gestion = { analisis: false, cumplimiento: false };
      pushHistory(`Duplicar trámite #${t.numero}`);
      STATE.tramites.push(newT); STATE.order.push(newT.id);
      if (typeof saveTramiteFS === 'function') saveTramiteFS(newT);
      saveAll(); renderAll(); showToast(`Trámite duplicado como #${newT.numero}.`);
    });
    actBar.querySelector('[data-action="edit"]').addEventListener('click', () => { closeAllExpands(); openModal(t); });
    actBar.querySelector('[data-action="delete"]').addEventListener('click', () => {
      if (confirm('¿Eliminar este trámite?')) {
        pushHistory(`Eliminar trámite #${t.numero}`);
        STATE.tramites = STATE.tramites.filter(x => x.id !== t.id);
        STATE.order    = STATE.order.filter(id => id !== t.id);
        if (typeof deleteTramiteFS === 'function') deleteTramiteFS(t.id, t._scope || 'private');
        saveAll(); closeAllExpands(); renderAll(); showToast('Trámite eliminado.');
      }
    });
    actBar.querySelector('[data-action="close"]').addEventListener('click', closeAllExpands);

    inner.appendChild(actBar);
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
  document.querySelectorAll('.tramite-card.card-open').forEach(c => c.classList.remove('card-open'));
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
  const esP   = esPropio(t);
  const etapa = computeEtapa(t);
  const p     = `det_${t.id}`;
  const hVenc = !!(t.gestion?.cumplimiento);

  const gestionHtml = esP ? '' : `
    <div class="detail-section">
      <h3>Gestión</h3>
      <div class="checks-row">
        <label class="check-label"><input type="checkbox" id="${p}_analisis" ${t.gestion.analisis?'checked':''}/><span class="check-custom"></span> Análisis</label>
        <label class="check-label"><input type="checkbox" id="${p}_cumplimiento" ${t.gestion.cumplimiento?'checked':''}/><span class="check-custom"></span> Cumplimiento</label>
      </div>
    </div>`;

  return `${gestionHtml}
    <div class="detail-section">
      <h3>Seguimiento <span class="etapa-badge${etapa==='seguimiento'?' seguimiento':''}" id="${p}_etapabadge">${etapa==='seguimiento'?'Seguimiento':'Gestión'}</span></h3>
      <div id="${p}_actividades"></div>
      <div class="nueva-tarea-toggle">
        <button class="btn-nueva-tarea" id="${p}_btnNuevaTarea" type="button">＋ Nueva tarea</button>
      </div>
      <div class="add-actividad-form" id="${p}_formNuevaTarea" style="display:none">
        <input type="text"  id="${p}_newActDesc"  placeholder="¿Qué se debe hacer?" />
        <div class="add-actividad-form-row">
          <input type="date" id="${p}_newActFecha" />
          <select id="${p}_newActResp">${buildRespOptions(t.tipo||'abogado', t.abogado||'abogado1', t.abogado||'yo')}</select>
        </div>
        <div class="add-actividad-btns">
          <button class="btn-small" id="${p}_addAct">+ Agregar</button>
          <button class="btn-small" id="${p}_cancelAct" style="background:var(--surface);color:var(--text-secondary);border:1px solid var(--border)">Cancelar</button>
        </div>
      </div>
    </div>
    <div class="detail-section detail-vencimiento-section${hVenc?' hidden-venc':''}" id="${p}_vencSection">
      <h3>Fecha de vencimiento</h3>
      <div class="form-grid"><div class="form-group"><label>Fecha</label><input type="date" id="${p}_vencimiento" value="${t.fechaVencimiento||''}" /></div></div>
      <button class="btn-small" id="${p}_saveVenc" style="margin-top:10px">Guardar fecha</button>
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
  const p   = `det_${t.id}`;
  const esP = esPropio(t);

  // Debounce helper para guardado inline (300ms)
  function makeSaveDebounced(fn) {
    let timer = null;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), 300); };
  }

  if (!esP) {
    container.querySelector(`#${p}_analisis`)?.addEventListener('change', e => {
      pushHistory(e.target.checked ? 'Marcar análisis' : 'Desmarcar análisis');
      t.gestion.analisis = e.target.checked; saveAll(); refreshCardOnly(t);
    });
    container.querySelector(`#${p}_cumplimiento`)?.addEventListener('change', e => {
      pushHistory(e.target.checked ? 'Marcar cumplimiento' : 'Desmarcar cumplimiento');
      t.gestion.cumplimiento = e.target.checked;
      const badge = container.querySelector(`#${p}_etapabadge`);
      const etapa = computeEtapa(t);
      if (badge) { badge.textContent = etapa==='seguimiento'?'Seguimiento':'Gestión'; badge.className='etapa-badge'+(etapa==='seguimiento'?' seguimiento':''); }
      container.querySelector(`#${p}_vencSection`)?.classList.toggle('hidden-venc', e.target.checked);
      if (e.target.checked) { crearTareaRequerimiento(t); renderActividadesIn(t, container.querySelector(`#${p}_actividades`), container, expandWrapper); showToast('✓ Cumplimiento marcado. Tarea automática creada.'); }
      saveAll(); refreshCardOnly(t);
    });
  }

  renderActividadesIn(t, container.querySelector(`#${p}_actividades`), container, expandWrapper);

  const btnNueva  = container.querySelector(`#${p}_btnNuevaTarea`);
  const formNueva = container.querySelector(`#${p}_formNuevaTarea`);
  btnNueva?.addEventListener('click', () => {
    const open = formNueva.style.display !== 'none';
    formNueva.style.display = open ? 'none' : 'block';
    if (!open) setTimeout(() => container.querySelector(`#${p}_newActDesc`)?.focus(), 60);
  });
  container.querySelector(`#${p}_cancelAct`)?.addEventListener('click', () => { formNueva.style.display = 'none'; });
  container.querySelector(`#${p}_addAct`)?.addEventListener('click', () => {
    const desc  = container.querySelector(`#${p}_newActDesc`).value.trim();
    const fecha = container.querySelector(`#${p}_newActFecha`).value;
    const resp  = container.querySelector(`#${p}_newActResp`).value;
    if (!desc) { showToast('Escribe una descripción.'); return; }
    pushHistory('Agregar tarea');
    t.seguimiento.push({ descripcion: sentenceCase(desc), fecha, responsable: resp, estado: 'pendiente', urgente: false });
    container.querySelector(`#${p}_newActDesc`).value = '';
    container.querySelector(`#${p}_newActFecha`).value = '';
    formNueva.style.display = 'none';
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
    const div    = document.createElement('div');
    const isDone = act.estado === 'realizado';
    div.className = 'actividad-item' + (act.urgente ? ' act-urgente' : '');
    div.innerHTML = `
      <div class="actividad-check-wrap"><label class="round-check-wrap"><input type="checkbox" ${isDone?'checked':''}/><div class="round-check-box"></div></label></div>
      <div class="actividad-info">
        <div class="actividad-desc ${isDone?'done':''}" title="Doble clic para editar">${escapeHtml(act.descripcion)}</div>
        <div class="actividad-meta">
          <input type="date" value="${act.fecha||''}" />
          ${act.responsable ? `<span class="actividad-resp">${abogadoName(act.responsable, t)}</span>` : ''}
          <span class="actividad-estado ${act.estado}">${isDone?'Realizado':'Pendiente'}</span>
        </div>
      </div>
      <button class="act-urg-btn ${act.urgente?'active':''}" title="${act.urgente?'Quitar urgente':'Marcar urgente'}">🔴</button>
      <button class="actividad-delete" title="Eliminar">✕</button>`;

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

    div.querySelector('input[type="checkbox"]').addEventListener('change', e => {
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
    div.querySelector('.actividad-delete').addEventListener('click', () => {
      if (confirm('¿Eliminar esta tarea?')) {
        pushHistory('Eliminar tarea'); t.seguimiento.splice(i, 1);
        if (typeof saveTramiteFS === 'function') saveTramiteFS(t);
        saveAll(); refreshCardOnly(t); renderActividadesIn(t, listEl, container, expandWrapper);
      }
    });
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
    div.innerHTML = `<div class="nota-text" title="Doble clic para editar">${escapeHtml(nota.texto)}</div><div class="nota-fecha">${formatDatetime(nota.fecha)}</div><button class="nota-delete">✕</button>`;
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
    div.querySelector('.nota-delete').addEventListener('click', () => {
      if (confirm('¿Eliminar esta nota?')) {
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

function setModalTipo(tipo) {
  modalTipoActual = tipo;
  document.getElementById('tipoBtnAbogado')?.classList.toggle('active', tipo === 'abogado');
  document.getElementById('tipoBtnPropio')?.classList.toggle('active',  tipo === 'propio');
  const abWrap = document.getElementById('fAbogadoWrap');
  if (abWrap) abWrap.style.display = tipo === 'abogado' ? '' : 'none';
}

function setModalScope(scope) {
  modalScopeActual = scope;
  document.getElementById('scopeBtnPrivate')?.classList.toggle('active', scope === 'private');
  document.getElementById('scopeBtnTeam')?.classList.toggle('active',    scope === 'team');
}

function addTareaRow(desc = '', fecha = '', resp = '') {
  const list = document.getElementById('tareasInicialesList');
  list.querySelector('.tareas-empty-hint')?.remove();

  const idx = _tareasIniciales.length;
  _tareasIniciales.push({ descripcion: desc, fecha, responsable: resp || (STATE.config.abogados[0]?.key || 'yo'), estado: 'pendiente', urgente: false });

  const row = document.createElement('div'); row.className = 'tarea-inicial-row'; row.dataset.idx = idx;
  row.innerHTML = `
    <input type="text"  class="ti-desc"  placeholder="¿Qué hacer?"  value="${escapeAttr(desc)}" />
    <input type="date"  class="ti-fecha" value="${fecha}" />
    <select class="ti-resp">${buildRespOptions(modalTipoActual, document.getElementById('fAbogado')?.value || 'yo', resp)}</select>
    <button class="ti-urg ${_tareasIniciales[idx].urgente ? 'active' : ''}" title="Marcar urgente">🔴</button>
    <button class="ti-del" title="Eliminar">✕</button>`;

  row.querySelector('.ti-urg').addEventListener('click', () => {
    _tareasIniciales[idx].urgente = !_tareasIniciales[idx].urgente;
    row.querySelector('.ti-urg').classList.toggle('active', _tareasIniciales[idx].urgente);
  });
  row.querySelector('.ti-del').addEventListener('click', () => {
    _tareasIniciales.splice(idx, 1); row.remove();
    if (!document.querySelectorAll('.tarea-inicial-row').length)
      list.innerHTML = '<p class="tareas-empty-hint">Ninguna tarea aún — puedes agregar después.</p>';
  });
  list.appendChild(row);
}

function syncTareasFromDOM() {
  document.querySelectorAll('.tarea-inicial-row').forEach((row, i) => {
    if (_tareasIniciales[i]) {
      _tareasIniciales[i].descripcion = sentenceCase(row.querySelector('.ti-desc').value.trim());
      _tareasIniciales[i].fecha       = row.querySelector('.ti-fecha').value;
      _tareasIniciales[i].responsable = row.querySelector('.ti-resp').value;
    }
  });
}

function openModal(tramite = null) {
  isEditing = !!tramite; editingId = tramite ? tramite.id : null;
  _tareasIniciales = [];

  document.getElementById('modalTitle').textContent  = isEditing ? 'Editar trámite' : 'Nuevo trámite';
  document.getElementById('fNumero').value           = tramite?.numero || '';
  document.getElementById('fDescripcion').value      = tramite?.descripcion || '';
  document.getElementById('fModulo').value           = tramite?.modulo || STATE.config.modulos[0]?.sigla || '';
  const abSel = document.getElementById('fAbogado');
  const abKey = tramite?.abogado || (STATE.config.abogados[0]?.key || 'abogado1');
  abSel.value = ([...abSel.options].some(o => o.value === abKey)) ? abKey : (abSel.options[0]?.value || '');
  document.getElementById('fFechaVencimiento').value = tramite?.fechaVencimiento || '';
  document.getElementById('fNota').value             = '';
  document.getElementById('nuevaNotaFieldsModal').style.display = 'none';
  document.getElementById('tareasInicialesList').innerHTML = '<p class="tareas-empty-hint">Ninguna tarea aún — puedes agregar después.</p>';

  setModalTipo(tramite?.tipo || 'abogado');
  setModalScope(tramite?._scope || 'private');

  // Mostrar colaborador si hay miembros del equipo
  const sw = document.getElementById('fScopeWrap');
  if (sw) sw.style.display = 'none'; // ya no se usa - scope derivado del colaborador
  const abWrap = document.getElementById('fAbogadoWrap');
  if (abWrap) abWrap.style.display = (modalTipoActual === 'abogado') ? '' : 'none';

  document.getElementById('modalOverlay').classList.add('open');
  setTimeout(() => document.getElementById('fNumero')?.focus(), 120);
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
  const m = document.getElementById('tramiteModal');
  m.classList.remove('draggable-active', 'is-dragging');
  m.style.left = ''; m.style.top = '';
}

let isEditing = false;
let editingId = null;

async function saveTramite() {
  const numero      = document.getElementById('fNumero').value.trim();
  const desc        = sentenceCase(document.getElementById('fDescripcion').value.trim());
  const modulo      = document.getElementById('fModulo').value;
  const tipo        = modalTipoActual;
  const colaborador = tipo === 'abogado' ? document.getElementById('fAbogado').value : null;
  const venc        = document.getElementById('fFechaVencimiento').value;

  if (!numero || !modulo) { showToast('Completa: número y módulo.'); return; }

  syncTareasFromDOM();
  const tareasValidas = _tareasIniciales.filter(t => t.descripcion);
  const notaTexto     = document.getElementById('fNota').value.trim();
  const notaInicial   = notaTexto ? [{ texto: sentenceCase(notaTexto), fecha: new Date().toISOString() }] : [];

  const btn = document.getElementById('saveTramite');
  btn.disabled = true; btn.textContent = 'Guardando…';

  try {
    if (isEditing) {
      const t = getById(editingId);
      if (!t) { showToast('Error: no se encontró el trámite.'); return; }
      pushHistory(`Editar trámite #${numero}`);
      Object.assign(t, { numero, descripcion: desc, modulo, tipo, fechaVencimiento: venc });
      if (tipo === 'abogado') t.abogado = colaborador; else delete t.abogado;
      if (tareasValidas.length) t.seguimiento.unshift(...tareasValidas);
      if (notaInicial.length)   t.notas.push(...notaInicial);
      if (typeof saveTramiteFS === 'function') await saveTramiteFS(t);
      showToast('Trámite actualizado.');
    } else {
      pushHistory(`Crear trámite #${numero}`);
      const scope = (tipo === 'abogado' && colaborador) ? 'team' : 'private';
      const newT = {
        id: genId(), numero, descripcion: desc, modulo, tipo,
        fechaVencimiento: venc,
        gestion:    { analisis: false, cumplimiento: false },
        seguimiento: tareasValidas, notas: notaInicial,
        terminado: false, terminadoEn: null,
        creadoEn:  new Date().toISOString(),
        _scope:    scope,
        createdBy: AUTH?.userProfile?.uid || null,
      };
      if (tipo === 'abogado' && colaborador) newT.abogado = colaborador;

      STATE.tramites.push(newT);
      STATE.order.push(newT.id);

      if (typeof saveTramiteFS === 'function') {
        await saveTramiteFS(newT);
        // Compartir con colaborador si es miembro del equipo en Firestore
        if (scope === 'team' && colaborador && typeof _teamMembers !== 'undefined') {
          const isTeamMember = _teamMembers.find(m => m.uid === colaborador);
          if (isTeamMember) {
            try {
              const sharedData = { ...newT, _sharedFrom: AUTH.userProfile.uid, _sharedFromName: AUTH.userProfile.displayName || AUTH.userProfile.email };
              delete sharedData.id;
              await db.collection('users').doc(colaborador).collection('tramites').doc(newT.id).set(sharedData);
            } catch(e) { console.warn('No se pudo compartir con colaborador:', e.code); }
          }
        }
      } else {
        saveAll(true);
      }
      showToast(`Trámite creado${tareasValidas.length ? ' con ' + tareasValidas.length + ' tarea(s)' : ''}.`);
    }
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

function openReport() {
  document.getElementById('reportSubtitle').textContent = `Generado el ${formatDate(today())}`;
  updateAbogadoNames(); renderReport();
  document.getElementById('reportOverlay').classList.add('open');
}
function closeReport() { document.getElementById('reportOverlay').classList.remove('open'); }

function renderReport() {
  const hoy      = today();
  const contenido = document.getElementById('reportContent'); contenido.innerHTML = '';
  const filtro   = reportFiltroAbogado;
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
    (t.seguimiento||[]).filter(s => s.estado==='pendiente' && s.fecha && s.fecha<=hoy).forEach(s => {
      const r = s.responsable||'yo';
      const m = !filtro || (r==='yo'&&filtro==='yo') || (r!=='yo'&&filtro===r);
      if (m) items.push({ t, tipo:'tarea', fecha:s.fecha, cls:s.fecha<hoy?'overdue':'today', tarea:s.descripcion, resp:r, urgente:!!(s.urgente) });
    });
  });

  if (!items.length) { contenido.innerHTML = '<div class="report-empty">🎉 ¡Sin novedades para hoy!</div>'; return; }
  items.sort((a, b) => {
    if (a.urgente !== b.urgente) return a.urgente ? -1 : 1;
    if (a.cls !== b.cls) return a.cls==='overdue' ? -1 : 1;
    return (a.fecha||'').localeCompare(b.fecha||'');
  });

  const tipoLabel = { vencimiento:'📅 Vencimiento', tarea:'📌 Tarea', analisis:'🔍 Análisis pendiente' };
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
      el.innerHTML = `<div class="report-item-num">${item.urgente?'🔴 ':''}#${item.t.numero}</div>
        <div class="report-item-body">
          <div class="report-item-desc">${escapeHtml(item.t.descripcion)}</div>
          <div class="report-item-tarea"><span class="tarea-label">${tipoLabel[item.tipo]||'📌'} — ${tareaText}</span></div>
          <div class="report-item-meta"><span class="report-item-resp">${item.t.modulo||''}</span>${item.resp?`<span class="report-item-resp">${abogadoName(item.resp)}</span>`:''}</div>
        </div>`;
      sec.appendChild(el);
    });
    contenido.appendChild(sec);
  };
  const urg = items.filter(i => i.urgente), venc = items.filter(i => !i.urgente && i.cls==='overdue'), hoyI = items.filter(i => !i.urgente && i.cls!=='overdue');
  if (urg.length) renderGroup('🔴 Urgentes', urg, 'danger');
  renderGroup('⚠ Vencidos / Atrasados', venc, 'danger');
  renderGroup('📅 Para hoy', hoyI, 'warning');
}

function buildReportTextPlain() {
  let text = `TAREAS PARA HOY — ${formatDate(today())}\n${'='.repeat(25)}\n\n`;
  document.querySelectorAll('#reportContent .report-item').forEach(el => {
    const num=el.querySelector('.report-item-num')?.textContent||'', desc=el.querySelector('.report-item-desc')?.textContent||'', tarea=el.querySelector('.tarea-label')?.textContent||'';
    text += `${num} — ${desc}\n  ${tarea}\n\n`;
  });
  if (!text.includes('#')) text += 'Sin novedades para hoy.\n';
  return text;
}

// ============================================================
// CONFIGURACIÓN — render
// ============================================================
function renderConfig() {
  renderAbogadosList();
  const cb1=document.getElementById('colorBar1'); if(cb1) cb1.value=STATE.config.colorBar1||'#f59e0b';
  const cb2=document.getElementById('colorBar2'); if(cb2) cb2.value=STATE.config.colorBar2||'#3b5bdb';
  const cb3=document.getElementById('colorBar3'); if(cb3) cb3.value=STATE.config.colorBar3||'#10b981';
  updateBarPreviews(); setDetailMode(STATE.config.detailMode||'expand'); renderModulosList(); renderThemeGrid();
  const arT=document.getElementById('autoReqToggle'); if(arT) arT.checked=STATE.config.autoReq!==false;
  const arX=document.getElementById('autoReqTexto');  if(arX) arX.value=STATE.config.autoReqTexto||'1er req';
  const arD=document.getElementById('autoReqDias');   if(arD) arD.value=STATE.config.autoReqDias??7;
  syncAutoReqFields();
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
      row.innerHTML = `<span class="abogado-num">👤</span>
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
        <button class="btn-icon btn-icon-danger ab-delete" title="Eliminar">✕</button>`;
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
    row.innerHTML = `<span class="modulo-sigla">${m.sigla}</span><span class="modulo-nombre">${m.nombre}</span><button class="modulo-delete">✕</button>`;
    row.querySelector('.modulo-delete').addEventListener('click', () => {
      if (confirm(`¿Eliminar módulo ${m.sigla}?`)) { STATE.config.modulos.splice(i,1); saveAll(); populateModuloSelects(); renderModulosList(); }
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
