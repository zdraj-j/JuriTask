/**
 * JuriTask — config.js
 * Inicialización, navegación entre vistas, y binding de todos
 * los event listeners. Es el orquestador que conecta los módulos.
 *
 * Orden de carga requerido en index.html:
 *   storage.js → tramites.js → filters.js → ui.js → dashboard.js
 *   → google-auth.js → drive.js → gmail.js → … → config.js
 */

// ============================================================
// VISTAS
// ============================================================
let currentView = 'all';

// ============================================================
// BÚSQUEDA
// ============================================================
let _searchTimer = null;

// Única fuente de verdad de la visibilidad del botón ✕: se llama siempre que
// el valor del buscador cambie (por teclado o por código), para que nunca
// quede visible sobre un input vacío ni oculto sobre uno con texto.
function syncSearchClear() {
  const input = document.getElementById('searchInput');
  const btn   = document.getElementById('searchClear');
  if (!input || !btn) return;
  btn.style.display = input.value.trim() ? 'flex' : 'none';
}

function clearSearch({ focus = true } = {}) {
  const input = document.getElementById('searchInput');
  if (!input) return;
  clearTimeout(_searchTimer);
  input.value = '';
  syncSearchClear();
  renderAll();
  if (focus) input.focus();
}

function switchView(view) {
  currentView = view;
  closeAllExpands();
  document.getElementById('searchInput').value = '';
  syncSearchClear();

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`view-${view}`)?.classList.add('active');
  document.querySelector(`.nav-item[data-view="${view}"]`)?.classList.add('active');

  const titles = {
    all:       'Todos los trámites',
    agenda:    'Agenda',
    finished:  'Terminados',
    config:    'Configuración',
    dashboard: 'Panel',
  };
  document.getElementById('topbarTitle').innerHTML = titles[view] || '';

  const isConfig = view === 'config';
  const isDash   = view === 'dashboard';
  const isAgenda = view === 'agenda';
  const hide     = isConfig || isDash;
  // La agenda es una lista enfocada: oculta filtros/orden/columnas/reporte.
  const hideTools = hide || isAgenda;

  document.getElementById('sidebarFilters').style.display = hideTools ? 'none' : '';
  document.getElementById('colSwitcher').style.display    = hideTools ? 'none' : '';
  document.getElementById('sortWrap').style.display       = hideTools ? 'none' : '';
  document.getElementById('mobOptsBtn').style.display     = hideTools ? 'none' : '';
  document.getElementById('reportBtn').style.display      = hideTools ? 'none' : '';
  document.getElementById('newTramiteBtn').style.display  = hide ? 'none' : '';
  // El reporte general consulta todo el histórico: sigue disponible en la
  // agenda, solo se oculta en configuración y dashboard.
  const _repBtn = document.getElementById('reportesBtn');
  if (_repBtn) _repBtn.style.display = (isConfig || isDash) ? 'none' : '';
  const _scanBtn = document.getElementById('scanMailBtn');
  if (_scanBtn) _scanBtn.style.display = hide ? 'none' : '';
  const _bitBtn = document.getElementById('bitacoraScanBtn');
  if (_bitBtn) _bitBtn.style.display = hide ? 'none' : '';

  if      (isConfig) { renderConfig(); }
  else if (isAgenda) { renderAgenda(); }
  else if (isDash && typeof loadDashboardData === 'function') { loadDashboardData(); }
  else               { renderAll(); }
}

// ============================================================
// INIT
// ============================================================
/**
 * Arranca la app. **No lo llama `DOMContentLoaded`**: lo llama `mostrarApp()`
 * cuando hay sesión (ver auth.js). Para entonces STATE ya viene cargado desde
 * Firestore, así que aquí no se vuelve a leer nada.
 */
function init() {
  purgeExpiredFinished();

  applyCssColors();
  applyTheme(STATE.config.theme || 'claro');
  populateModuloSelects();
  updateAbogadoSelects();

  const sortVal = STATE.config.sortBy || 'vencimiento';
  document.getElementById('sortSelect').value    = sortVal;
  document.getElementById('sortSelectMob').value = sortVal;

  const initCols = STATE.config.columns || 1;
  document.querySelectorAll('.col-btn').forEach(b     => b.classList.toggle('active', parseInt(b.dataset.cols) === initCols));
  document.querySelectorAll('.mob-col-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.cols) === initCols));

  setDetailMode(STATE.config.detailMode || 'expand');
  if (isMobile()) closeSidebar();
  renderAll();

  setupContainerDrop(document.getElementById('tramiteList'));

  // ── Confirm dialog ───────────────────────────────────────
  document.getElementById('confirmOk')?.addEventListener('click',     () => _confirmClose(true));
  document.getElementById('confirmCancel')?.addEventListener('click', () => _confirmClose(false));
  document.getElementById('confirmOverlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('confirmOverlay')) _confirmClose(false);
  });

  // ── Navegación sidebar ───────────────────────────────────
  document.querySelectorAll('.nav-item').forEach(btn =>
    btn.addEventListener('click', () => { switchView(btn.dataset.view); if (isMobile()) closeSidebar(); })
  );

  // ── Sidebar ──────────────────────────────────────────────
  document.getElementById('menuBtn').addEventListener('click',       toggleSidebar);
  document.getElementById('sidebarToggle').addEventListener('click', closeSidebar);
  backdropEl.addEventListener('click', closeSidebar);

  // ── Nuevo trámite ────────────────────────────────────────
  document.getElementById('newTramiteBtn')?.addEventListener('click',      () => openModal());
  document.getElementById('newTramiteBtnEmpty')?.addEventListener('click', () => openModal());
  // Modal assign multi-select toggle
  const asignDisplay = document.getElementById('fAsignarDisplay');
  const asignDrop    = document.getElementById('fAsignarDropdown');
  if (asignDisplay && asignDrop) {
    asignDisplay.addEventListener('click', e => { e.stopPropagation(); asignDrop.classList.toggle('open'); });
    asignDrop.addEventListener('click', e => e.stopPropagation());
    document.addEventListener('click', () => asignDrop.classList.remove('open'));
  }

  document.getElementById('btnAgregarTareaModal')?.addEventListener('click', () => addTareaRow());
  document.getElementById('btnMostrarNotaModal')?.addEventListener('click', () => {
    const f = document.getElementById('nuevaNotaFieldsModal');
    const open = f.style.display !== 'none';
    f.style.display = open ? 'none' : 'block';
    if (!open) setTimeout(() => document.getElementById('fNota')?.focus(), 60);
  });
  document.getElementById('btnDriveModal')?.addEventListener('click', async () => {
    if (typeof openDrivePicker !== 'function') { showToast('Google Drive no disponible.'); return; }
    try {
      const files = await openDrivePicker();
      if (files.length) { _modalAttachments.push(...files); _renderModalAttachments(); showToast(`${files.length} archivo(s) adjuntado(s).`); }
    } catch(e) {}
  });
  document.getElementById('btnEnlaceModal')?.addEventListener('click', () => {
    const url = prompt('Pega la URL del enlace:');
    if (!url || !url.trim()) return;
    const trimmed = url.trim();
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) { showToast('URL inválida.'); return; }
    const name = prompt('Nombre del enlace (opcional):') || trimmed;
    _modalAttachments.push({ type: 'link', url: trimmed, name: name.trim(), mimeType: 'link' });
    _renderModalAttachments();
    showToast('Enlace adjuntado.');
  });

  // ── Modal trámite ────────────────────────────────────────
  document.getElementById('modalClose').addEventListener('click',   closeModal);
  document.getElementById('cancelModal').addEventListener('click',  closeModal);
  document.getElementById('saveTramite').addEventListener('click',  saveTramite);
  // Plantillas
  document.getElementById('fPlantilla')?.addEventListener('change', e => { if (e.target.value) applyPlantilla(e.target.value); });
  document.getElementById('btnGuardarPlantilla')?.addEventListener('click', saveCurrentAsPlantilla);
  // Sin cierre al hacer click fuera — evita pérdida accidental de datos
  initDraggableModal(document.getElementById('tramiteModal'));

  // ── Modal detalle (overlay cierra al click en fondo) ─────
  document.getElementById('detailOverlay').addEventListener('click', e => {
    if (e.target === document.getElementById('detailOverlay')) closeDetail();
  });

  // ── Columnas / sort ──────────────────────────────────────
  document.querySelectorAll('.col-btn').forEach(btn =>
    btn.addEventListener('click', () => setColumns(parseInt(btn.dataset.cols)))
  );
  document.getElementById('sortSelect').addEventListener('change', e => setSortBy(e.target.value));

  // ── Bottom sheet (móvil) ─────────────────────────────────
  document.getElementById('mobOptsBtn').addEventListener('click', openMobSheet);
  document.getElementById('mobSheetOverlay').addEventListener('click', closeMobSheet);
  document.getElementById('sortSelectMob').addEventListener('change', e => { setSortBy(e.target.value); closeMobSheet(); });
  document.querySelectorAll('.mob-col-btn').forEach(btn =>
    btn.addEventListener('click', () => { setColumns(parseInt(btn.dataset.cols)); closeMobSheet(); })
  );

  // ── Toggle filtros ───────────────────────────────────────
  document.getElementById('filtersToggle')?.addEventListener('click', () => {
    const body  = document.getElementById('filterBody');
    const arrow = document.getElementById('filterArrow');
    body.classList.toggle('collapsed');
    arrow.classList.toggle('collapsed');
  });

  // ── Filtros ──────────────────────────────────────────────
  ['filterTipo','filterAbogado','filterModulo','filterResponsable','filterEtapa']
    .forEach(id => document.getElementById(id)?.addEventListener('change', renderAll));
  const searchInput = document.getElementById('searchInput');
  const runSearch = () => {
    const q = searchInput.value.trim();
    if (q && currentView !== 'all' && currentView !== 'finished') {
      switchView('all');
      searchInput.value = q; // restore after switchView clears it
    }
    syncSearchClear();       // tras restaurar el valor, no antes
    renderAll();
  };
  searchInput.addEventListener('input', () => {
    // Debounce: evita re-render por cada tecla con muchos trámites.
    syncSearchClear();
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(runSearch, 200);
  });
  // Esc dentro del buscador también limpia.
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape' && searchInput.value) { e.stopPropagation(); clearSearch(); }
  });

  // El botón ✕ fallaba de forma intermitente con ratón. El `click` del ratón
  // solo se emite si mousedown y mouseup resuelven al mismo elemento, así que
  // depende de que nada altere ese nodo (ni su posición) entre los dos eventos;
  // el click sintético del toque no tiene esa condición, y de ahí que en móvil
  // no fallara. Se resuelve el gesto en `pointerdown`, que no depende del par,
  // y se delega en el contenedor para que sobreviva a cambios del icono.
  const searchWrap = document.querySelector('.search-wrap');
  if (searchWrap) {
    const onClear = e => {
      if (!e.target.closest('#searchClear')) return;
      e.preventDefault();
      clearSearch();
    };
    // Ratón/táctil: el gesto se resuelve en pointerdown.
    searchWrap.addEventListener('pointerdown', e => { if (e.button === 0) onClear(e); });
    // Teclado (Enter/Espacio sobre el botón enfocado): esos clicks llegan con
    // detail === 0 y sin pointerdown previo, así que no se duplican.
    searchWrap.addEventListener('click', e => { if (e.detail === 0) onClear(e); });
  }

  document.getElementById('clearFilters').addEventListener('click', () => {
    ['filterTipo','filterAbogado','filterModulo','filterResponsable','filterEtapa']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    searchInput.value = '';
    syncSearchClear();
    renderAll();
  });

  // ── Reporte general de trámites (filtros + Excel) ────────
  // Arranca con los filtros de la barra lateral ya aplicados.
  document.getElementById('reportesBtn')?.addEventListener('click', () => {
    if (typeof openReporteDesdeFiltros === 'function') openReporteDesdeFiltros();
  });

  // ── Reporte ──────────────────────────────────────────────
  document.getElementById('reportBtn').addEventListener('click', openReport);
  document.getElementById('reportClose').addEventListener('click', closeReport);
  document.getElementById('reportOverlay').addEventListener('click', e => {
    if (e.target === document.getElementById('reportOverlay')) closeReport();
  });
  document.getElementById('reportFilterGroup').addEventListener('click', e => {
    const btn = e.target.closest('[data-abogado]'); if (!btn) return;
    reportFiltroAbogado = btn.dataset.abogado;
    document.querySelectorAll('#reportFilterGroup .toggle-btn').forEach(b => b.classList.toggle('active', b === btn));
    renderReport();
  });
  // Filtro de responsabilidad de la Agenda (Mías / De otros / Todas)
  document.getElementById('agendaScopeGroup')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-scope]'); if (!btn) return;
    STATE.config.agendaScope = btn.dataset.scope;
    saveAll();
    renderAgenda();
  });
  document.getElementById('reportScreenshotBtn')?.addEventListener('click', e =>
    _screenshotReport(e.currentTarget, reportFiltroAbogado)
  );

  // ── Reporte: panel lateral (dock) ────────────────────────
  document.getElementById('reportDockBtn')?.addEventListener('click', openReportDock);
  document.getElementById('reportDockClose')?.addEventListener('click', closeReportDock);
  document.getElementById('reportDockExpandBtn')?.addEventListener('click', () => {
    const filtro = reportDockFiltro;
    closeReportDock();
    openReport(); // reabre el modal (updateAbogadoNames resetea el filtro a "Todos")
    // Reaplicar el filtro que traía el panel y marcar el botón correspondiente.
    reportFiltroAbogado = filtro;
    document.querySelectorAll('#reportFilterGroup .toggle-btn').forEach(b =>
      b.classList.toggle('active', (b.dataset.abogado || '') === filtro));
    renderReport();
  });
  document.getElementById('reportDockFilter')?.addEventListener('change', e => {
    reportDockFiltro = e.target.value;
    renderReportDock();
    _saveDockState();
  });
  document.getElementById('reportDockScreenshotBtn')?.addEventListener('click', e =>
    _screenshotReport(e.currentTarget, reportDockFiltro)
  );
  // Restaurar el panel lateral si quedó abierto en la sesión previa.
  if (typeof restoreReportDock === 'function') restoreReportDock();

  // ── Export / Import ──────────────────────────────────────
  document.getElementById('exportBtn').addEventListener('click', exportData);
  document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', e => {
    if (e.target.files[0]) { importData(e.target.files[0]); e.target.value = ''; }
  });

  // ── Config: modo detalle ─────────────────────────────────
  document.getElementById('modeExpand').addEventListener('click', () => setDetailMode('expand'));
  document.getElementById('modeModal').addEventListener('click',  () => setDetailMode('modal'));

  // ── Config: días restantes ───────────────────────────────
  document.getElementById('diasRestantesToggle').addEventListener('change', e => {
    STATE.config.diasRestantes = e.target.checked; saveAll(); renderAll();
  });

  // ── Config: abogados ─────────────────────────────────────
  document.getElementById('saveAbogadosBtn').addEventListener('click', () => {
    // Las filas van en el mismo orden que `config.abogados`.
    let valid = true;
    document.querySelectorAll('#abogadosList .abogado-config-row').forEach((row, idx) => {
      const nombreInput = row.querySelector('.ab-nombre');
      const colorInput  = row.querySelector('.ab-color');
      const entry = (STATE.config.abogados || [])[idx];
      if (!nombreInput || !colorInput || !entry) return;
      const nombre = nombreInput.value.trim();
      if (!nombre) { valid = false; return; }
      entry.nombre = titleCase(nombre);
      entry.color  = colorInput.value;
    });
    if (!valid) { showToast('Los nombres no pueden estar vacíos.'); return; }
    saveAll(); applyCssColors(); updateAbogadoSelects(); renderAbogadosList(); renderAll();
    showToast('Colaboradores guardados.');
  });
  document.getElementById('addAbogadoBtn').addEventListener('click', () => {
    const inp    = document.getElementById('newAbNombre');
    const nombre = inp.value.trim();
    if (!nombre) { showToast('Escribe el nombre del nuevo abogado.'); return; }
    const palette = ['#15803d','#1d4ed8','#9333ea','#c2410c','#0891b2','#be123c','#854d0e'];
    const color   = palette[(STATE.config.abogados || []).length % palette.length];
    STATE.config.abogados = STATE.config.abogados || [];
    STATE.config.abogados.push({ key: 'abogado_' + Date.now(), nombre: titleCase(nombre), color });
    inp.value = '';
    saveAll(); applyCssColors(); updateAbogadoSelects(); renderAbogadosList();
    showToast(`"${nombre}" añadido.`);
  });

  // ── Config: clave de Gemini ─────────────────────────────
  document.getElementById('saveGeminiKeyBtn')?.addEventListener('click', () => {
    const key = document.getElementById('geminiApiKey')?.value.trim() || '';
    STATE.config.geminiApiKey = key;
    saveAll();
    showToast(key ? 'Clave de Gemini guardada.' : 'Clave de Gemini eliminada.');
  });
  // Vigilancia de correos enviados (bitácora)
  document.getElementById('bitacoraAutoToggle')?.addEventListener('change', e => {
    STATE.config.bitacoraAuto = e.target.checked;
    saveAll();
    if (e.target.checked) { startBitacoraWatcher(); checkBitacoraPendientes({ silencioso: false }); }
    else stopBitacoraWatcher();
    showToast(e.target.checked ? 'Vigilancia de correos activada.' : 'Vigilancia desactivada.');
  });
  const _saveBitacoraNums = () => {
    const min  = parseInt(document.getElementById('bitacoraIntervalo')?.value);
    const dias = parseInt(document.getElementById('bitacoraDias')?.value);
    const cta  = parseInt(document.getElementById('gmailCuentaIndice')?.value);
    if (!isNaN(min)  && min  >= 3 && min  <= 120) STATE.config.bitacoraIntervalo = min;
    if (!isNaN(dias) && dias >= 1 && dias <= 30)  STATE.config.bitacoraDias      = dias;
    // Índice de sesión de Google: /mail/u/N. Con varias cuentas abiertas, u/0 no
    // es necesariamente la del trabajo.
    if (!isNaN(cta)  && cta  >= 0 && cta  <= 9)   STATE.config.gmailCuentaIndice = cta;
    saveAll();
    if (STATE.config.bitacoraAuto !== false) startBitacoraWatcher();
  };
  document.getElementById('bitacoraIntervalo')?.addEventListener('change', _saveBitacoraNums);
  document.getElementById('bitacoraDias')?.addEventListener('change', _saveBitacoraNums);
  document.getElementById('gmailCuentaIndice')?.addEventListener('change', _saveBitacoraNums);

  // ── Config: borradores del día ───────────────────────────
  document.getElementById('borradoresIAToggle')?.addEventListener('change', e => {
    STATE.config.borradoresConIA = e.target.checked;
    saveAll();
  });
  document.getElementById('borradoresDiaBtn')?.addEventListener('click', e =>
    generarBorradoresDelDia(e.currentTarget));

  document.getElementById('resetDescartadosBtn')?.addEventListener('click', async () => {
    const n = (STATE.config.gmailDescartados || []).length;
    if (!n) { showToast('No hay trámites descartados.'); return; }
    if (!(await showConfirm(`¿Restablecer ${n} trámite(s) descartado(s)? Volverán a aparecer al revisar el correo.`, { confirmLabel: 'Restablecer' }))) return;
    STATE.config.gmailDescartados = [];
    saveAll();
    showToast('Descartados restablecidos.');
  });

  // ── Config: colores de barra ─────────────────────────────
  [1,2,3].forEach(n => document.getElementById(`colorBar${n}`).addEventListener('input', updateBarPreviews));
  document.getElementById('saveBarColorsBtn').addEventListener('click', () => {
    STATE.config.colorBar1 = document.getElementById('colorBar1').value;
    STATE.config.colorBar2 = document.getElementById('colorBar2').value;
    STATE.config.colorBar3 = document.getElementById('colorBar3').value;
    saveAll(); applyCssColors(); showToast('Colores guardados.');
  });
  document.getElementById('resetBarColorsBtn').addEventListener('click', () => {
    STATE.config.colorBar1 = DEFAULT_CONFIG.colorBar1;
    STATE.config.colorBar2 = DEFAULT_CONFIG.colorBar2;
    STATE.config.colorBar3 = DEFAULT_CONFIG.colorBar3;
    saveAll(); applyCssColors(); renderConfig(); showToast('Colores restablecidos.');
  });

  // ── Config: tarea automática ─────────────────────────────
  document.getElementById('autoReqToggle').addEventListener('change', e => {
    STATE.config.autoReq = e.target.checked; syncAutoReqFields(); saveAll();
  });
  document.getElementById('saveAutoReqBtn').addEventListener('click', () => {
    const texto = document.getElementById('autoReqTexto').value.trim();
    const dias  = parseInt(document.getElementById('autoReqDias').value);
    if (!texto)                          { showToast('El texto no puede estar vacío.'); return; }
    if (isNaN(dias) || dias < 1 || dias > 365) { showToast('Los días deben estar entre 1 y 365.'); return; }
    STATE.config.autoReqTexto        = texto;
    STATE.config.autoReqDias         = dias;
    STATE.config.autoReqResponsable  = document.getElementById('autoReqResponsable')?.value || 'yo';
    saveAll(); showToast('Configuración guardada.');
  });

  // ── Config: módulos ──────────────────────────────────────
  document.getElementById('addModuloBtn').addEventListener('click', () => {
    const sigla  = document.getElementById('newModuloSigla').value.trim().toUpperCase();
    const nombre = document.getElementById('newModuloNombre').value.trim();
    if (!sigla || !nombre) { showToast('Completa sigla y nombre.'); return; }
    if (STATE.config.modulos.find(m => m.sigla === sigla)) { showToast('Ya existe ese módulo.'); return; }
    STATE.config.modulos.push({ sigla, nombre });
    document.getElementById('newModuloSigla').value  = '';
    document.getElementById('newModuloNombre').value = '';
    saveAll(); populateModuloSelects(); renderModulosList(); showToast('Módulo agregado.');
  });

  // ── Config: perfil de usuario ────────────────────────────
  document.getElementById('configEditProfileBtn')?.addEventListener('click', () => {
    if (typeof openProfileModal === 'function') openProfileModal();
  });

  // ── Config: borrar todos los datos ───────────────────────
  document.getElementById('clearAllBtn').addEventListener('click', () => {
    if (!confirm('¿Borrar TODOS los datos? Esta acción no se puede deshacer.')) return;
    if (!confirm('¿Estás seguro? Se perderán todos los trámites.')) return;
    Object.values(KEYS).forEach(k => localStorage.removeItem(k));
    STATE.tramites = []; STATE.order = [];
    STATE.config = { ...DEFAULT_CONFIG, abogados: DEFAULT_CONFIG.abogados.map(a=>({...a})), modulos: [...DEFAULT_CONFIG.modulos] };
    applyCssColors(); applyTheme('claro'); populateModuloSelects(); updateAbogadoSelects();
    document.getElementById('sortSelect').value = 'vencimiento';
    renderConfig(); renderAll(); showToast('Datos borrados.');
  });

  // ── Panel ────────────────────────────────────────────────
  if (typeof initDashboard === 'function') initDashboard();

  // ── ESC + Ctrl+Z ─────────────────────────────────────────
  document.addEventListener('keydown', e => {
    // Ctrl/Cmd + Z — deshacer
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      const active = document.activeElement;
      const inField = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
      if (!inField) { e.preventDefault(); undo(); return; }
    }

    if (e.key !== 'Escape') return;
    const close = sel => document.querySelector(sel)?.classList.contains('open');
    if (close('#confirmOverlay'))    { _confirmClose(false); return; }
    if (close('#reportOverlay'))  { closeReport();   return; }
    if (close('#detailOverlay'))  { closeDetail();   return; }
    if (close('#modalOverlay'))   { closeModal();    return; }
    if (close('#mobSheet'))       { closeMobSheet(); return; }
    closeAllExpands();
  });
}

// El arranque lo dispara la sesión, no la carga del documento: hasta que
// Firebase no diga quién eres no hay datos que pintar. Ver js/auth.js.

// ────────────────────────────────────────────────────────────
// REPORTE — acciones compartidas por el modal y el panel lateral (dock)
// ────────────────────────────────────────────────────────────

// Imprime un bloque de HTML en un contenedor propio.
// `body.printing` oculta el resto de la app **por display**: la técnica
// anterior (visibility:hidden + position:fixed) hacía que el navegador
// emitiera una sola página recortada, porque un elemento fijo no fluye ni
// pagina. Con flujo normal el contenido se reparte en tantas hojas como haga
// falta.
function _printHtml(html) {
  const prev = document.getElementById('reportPrintArea');
  if (prev) prev.remove();

  const div = document.createElement('div');
  div.id = 'reportPrintArea';
  div.innerHTML = html;
  document.body.appendChild(div);
  document.body.classList.add('printing');

  const cleanup = () => {
    document.body.classList.remove('printing');
    div.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  // `print()` bloquea en la mayoría de navegadores, pero en algunos (Safari,
  // vistas previas asíncronas) vuelve antes de tiempo: afterprint es la red.
  window.addEventListener('afterprint', cleanup);
  try { window.print(); } finally { setTimeout(cleanup, 0); }
}

// Cabecera común de los documentos impresos.
function _printHeader(titulo, subtitulo) {
  return `<div class="print-head">
      <h1>${escapeHtml(titulo)}</h1>
      <p>${escapeHtml(subtitulo || `Generado el ${formatDate(today())}`)}</p>
    </div>`;
}

// Captura el reporte como imagen. Renderiza en un contenedor oculto cuyo ancho
// se toma del #reportContent del modal, de modo que la imagen conserve SIEMPRE
// las mismas dimensiones que la captura original, sin importar si se dispara
// desde el modal o desde el panel lateral (más angosto).
async function _screenshotReport(btn, filtro) {
  if (typeof html2canvas !== 'function') { showToast('Captura no disponible.'); return; }
  const ref = document.getElementById('reportContent');
  // offsetWidth existe aunque el modal esté cerrado (opacity no afecta al layout).
  const width = (ref && ref.offsetWidth) ? ref.offsetWidth : 518;
  const bg = getComputedStyle(document.body).backgroundColor || '#ffffff';

  const temp = document.createElement('div');
  temp.style.cssText = `position:fixed; left:-10000px; top:0; width:${width}px; padding:0; background:${bg}; z-index:-1; pointer-events:none;`;
  document.body.appendChild(temp);
  buildReportInto(temp, filtro);
  // Desactivar la animación de entrada de las tarjetas: al capturar un
  // contenedor recién creado, la imagen saldría a medio desvanecer.
  temp.querySelectorAll('*').forEach(el => { el.style.animation = 'none'; });
  if (window.refreshIcons) window.refreshIcons();
  // Dos frames: deja que el MutationObserver materialice los iconos Lucide.
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  const orig = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Capturando…'; }
  try {
    const canvas = await html2canvas(temp, { backgroundColor: bg, scale: 2, useCORS: true, logging: false });
    await new Promise(resolve => {
      canvas.toBlob(async blob => {
        if (!blob) { showToast('No se pudo generar la imagen.'); return resolve(); }
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          showToast('Captura copiada al portapapeles.');
        } catch (_) {
          const url = URL.createObjectURL(blob);
          const a   = document.createElement('a'); a.href = url; a.download = `reporte-${today()}.png`;
          a.click(); URL.revokeObjectURL(url);
          showToast('Captura descargada (portapapeles no disponible).');
        }
        resolve();
      }, 'image/png');
    });
  } catch (e) {
    console.error(e); showToast('Error al capturar.');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = orig; }
    temp.remove();
  }
}

// ────────────────────────────────────────────────────────────
// Cierre delegado (red de seguridad). Siempre activo e independiente de init:
// cualquier click/tap en un .modal-close cierra su overlay con la función de
// cierre adecuada, aunque el handler por-elemento no se haya enganchado.
// Idempotente con los handlers existentes (cerrar dos veces no daña).
// ────────────────────────────────────────────────────────────
document.addEventListener('click', e => {
  const btn = e.target.closest('.modal-close, [data-modal-close]');
  if (!btn) return;
  const overlay = btn.closest('.overlay, .confirm-overlay, .modal-overlay');
  if (!overlay) return;
  const byId = {
    modalOverlay:       'closeModal',
    detailOverlay:      'closeDetail',
    reportOverlay:      'closeReport',
    reporteOverlay:     'closeReporte',
    editProfileOverlay: 'closeEditProfileModal',
  };
  const fn = byId[overlay.id];
  if (fn && typeof window[fn] === 'function') window[fn]();
  else overlay.classList.remove('open');
});
