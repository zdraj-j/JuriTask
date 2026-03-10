/**
 * JuriTask — config.js
 * Inicialización, navegación entre vistas, y binding de todos
 * los event listeners. Es el orquestador que conecta los módulos.
 *
 * Orden de carga requerido en index.html:
 *   storage.js → tramites.js → filters.js → ui.js → calendar.js
 *   → auth.js → firestore.js → dashboard.js → config.js
 */

// ============================================================
// VISTAS
// ============================================================
let currentView = 'all';

function switchView(view) {
  currentView = view;
  closeAllExpands();
  document.getElementById('searchInput').value = '';

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`view-${view}`)?.classList.add('active');
  document.querySelector(`.nav-item[data-view="${view}"]`)?.classList.add('active');

  const titles = {
    all:       'Todos los trámites',
    today:     'Hoy / Vencidos',
    calendar:  'Calendario',
    finished:  'Terminados',
    config:    'Configuración',
    dashboard: '🛡 Dashboard Admin',
  };
  document.getElementById('topbarTitle').textContent = titles[view] || '';

  const isConfig = view === 'config';
  const isCal    = view === 'calendar';
  const isDash   = view === 'dashboard';
  const hide     = isConfig || isCal || isDash;

  document.getElementById('sidebarFilters').style.display = hide ? 'none' : '';
  document.getElementById('colSwitcher').style.display    = hide ? 'none' : '';
  document.getElementById('sortWrap').style.display       = hide ? 'none' : '';
  document.getElementById('mobOptsBtn').style.display     = hide ? 'none' : '';
  document.getElementById('reportBtn').style.display      = hide ? 'none' : '';
  document.getElementById('newTramiteBtn').style.display  = hide ? 'none' : '';

  if      (isConfig) { renderConfig(); syncConfigAccountUI(); }
  else if (isCal)    { renderCalendar(); }
  else if (isDash && typeof loadDashboardData === 'function') { loadDashboardData(); }
  else               { renderAll(); }
}

// ============================================================
// INIT
// ============================================================
function init() {
  const hasFirebase = typeof firebase !== 'undefined';

  // Sin Firebase: arranque local inmediato
  if (!hasFirebase) {
    loadAll();
    purgeExpiredFinished();
  }

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
  if (!hasFirebase) renderAll();

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
  document.getElementById('tipoBtnAbogado').addEventListener('click', () => setModalTipo('abogado'));
  document.getElementById('tipoBtnPropio').addEventListener('click',  () => setModalTipo('propio'));
  document.getElementById('scopeBtnPrivate')?.addEventListener('click', () => setModalScope('private'));
  document.getElementById('scopeBtnTeam')?.addEventListener('click',   () => setModalScope('team'));

  document.getElementById('btnAgregarTareaModal')?.addEventListener('click', () => addTareaRow());
  document.getElementById('btnMostrarNotaModal')?.addEventListener('click', () => {
    const f = document.getElementById('nuevaNotaFieldsModal');
    const open = f.style.display !== 'none';
    f.style.display = open ? 'none' : 'block';
    if (!open) setTimeout(() => document.getElementById('fNota')?.focus(), 60);
  });

  // ── Modal trámite ────────────────────────────────────────
  document.getElementById('modalClose').addEventListener('click',   closeModal);
  document.getElementById('cancelModal').addEventListener('click',  closeModal);
  document.getElementById('saveTramite').addEventListener('click',  saveTramite);
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
  ['filterTipo','filterAbogado','filterModulo','filterResponsable','filterEtapa','filterScope']
    .forEach(id => document.getElementById(id)?.addEventListener('change', renderAll));
  document.getElementById('searchInput').addEventListener('input', () => {
    const q = document.getElementById('searchInput').value.trim();
    if (q && currentView !== 'all' && currentView !== 'finished') {
      switchView('all');
      document.getElementById('searchInput').value = q; // restore after switchView clears it
    }
    renderAll();
  });
  document.getElementById('clearFilters').addEventListener('click', () => {
    ['filterTipo','filterAbogado','filterModulo','filterResponsable','filterEtapa','filterScope']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    document.getElementById('searchInput').value = '';
    renderAll();
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
  document.getElementById('reportPrintBtn').addEventListener('click', () => {
    const area = document.getElementById('reportContent');
    const div  = document.createElement('div'); div.id = 'reportPrintArea';
    div.innerHTML = `<h2 style="font-size:18px;margin-bottom:4px">Reporte JuriTask — ${formatDate(today())}</h2>` + area.innerHTML;
    document.body.appendChild(div); window.print(); document.body.removeChild(div);
  });
  document.getElementById('reportCopyBtn').addEventListener('click', () =>
    navigator.clipboard.writeText(buildReportTextPlain())
      .then(() => showToast('Reporte copiado.'))
      .catch(() => showToast('No se pudo copiar.'))
  );

  // ── Calendario ───────────────────────────────────────────
  document.getElementById('calPrev').addEventListener('click', () => {
    calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
    renderCalendar();
  });
  document.getElementById('calNext').addEventListener('click', () => {
    calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
    renderCalendar();
  });
  document.getElementById('calTodayBtn').addEventListener('click', () => {
    calYear = new Date().getFullYear(); calMonth = new Date().getMonth();
    renderCalendar();
  });

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
    // Guardar colores de miembros del equipo
    document.querySelectorAll('#abogadosList .ab-color-team').forEach(picker => {
      const uid = picker.dataset.uid;
      if (!uid) return;
      let entry = (STATE.config.abogados || []).find(x => x.key === uid);
      if (entry) {
        entry.color = picker.value;
      } else {
        const members = (typeof _teamMembers !== 'undefined') ? _teamMembers : [];
        const m = members.find(x => x.uid === uid);
        STATE.config.abogados.push({ key: uid, nombre: m?.displayName || m?.email || uid, color: picker.value });
      }
    });

    // Guardar nombres y colores de colaboradores manuales
    const manualRows = document.querySelectorAll('#abogadosList .abogado-config-row');
    let valid = true;
    manualRows.forEach(row => {
      const nombreInput = row.querySelector('.ab-nombre');
      const colorInput = row.querySelector('.ab-color');
      if (!nombreInput || !colorInput) return; // Es fila de equipo, no manual
      const nombre = nombreInput.value.trim();
      const color = colorInput.value;
      if (!nombre) { valid = false; return; }
      // Buscar por el key del abogado (basado en la posición en la lista de manuales)
      const members = (typeof _teamMembers !== 'undefined') ? _teamMembers : [];
      const manualAbogados = (STATE.config.abogados || []).filter(a => !members.find(m => m.uid === a.key));
      const idx = [...document.querySelectorAll('#abogadosList .abogado-config-row')].filter(r => r.querySelector('.ab-nombre')).indexOf(row);
      if (idx >= 0 && manualAbogados[idx]) {
        manualAbogados[idx].nombre = titleCase(nombre);
        manualAbogados[idx].color = color;
      }
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

  // ── Config: calendario ──────────────────────────────────
  document.getElementById('calendarShowSelect')?.addEventListener('change', e => {
    STATE.config.calendarShow = e.target.value; saveAll();
    if (currentView === 'calendar') renderCalendar();
  });
  document.getElementById('calendarShowNumToggle')?.addEventListener('change', e => {
    STATE.config.calendarShowNum = e.target.checked; saveAll();
    if (currentView === 'calendar') renderCalendar();
  });
  document.getElementById('calendarShowDescToggle')?.addEventListener('change', e => {
    STATE.config.calendarShowDesc = e.target.checked; saveAll();
    if (currentView === 'calendar') renderCalendar();
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

  // ── Backup ───────────────────────────────────────────────
  document.getElementById('backupNowBtn')?.addEventListener('click', () => {
    if (typeof createBackup === 'function') {
      createBackup().then(() => { showToast('✓ Backup creado.'); renderBackupList(); });
    } else {
      // Fallback: exportar JSON como backup
      exportData();
    }
  });

  // ── Notificaciones ───────────────────────────────────────
  document.getElementById('notifBtn')?.addEventListener('click', e => {
    e.stopPropagation();
    if (typeof toggleNotifPanel === 'function') toggleNotifPanel();
  });
  document.getElementById('adminMsgBroadcastBtn')?.addEventListener('click', () => {
    const msg = document.getElementById('adminMsgText')?.value.trim();
    const target = document.getElementById('adminMsgTarget')?.value || 'all';
    if (typeof adminSendBroadcast === 'function') adminSendBroadcast(msg, target).then(() => {
      if (document.getElementById('adminMsgText')) document.getElementById('adminMsgText').value = '';
    });
  });

  // ── Auth UI ──────────────────────────────────────────────
  if (typeof initAuthUI    === 'function') initAuthUI();
  if (typeof initAuth      === 'function') initAuth();
  if (typeof initDashboard === 'function') initDashboard();

  // ── Logout ───────────────────────────────────────────────
  document.getElementById('logoutBtn')?.addEventListener('click', () => {
    if (typeof AUTH !== 'undefined' && AUTH.logout) {
      if (confirm('¿Cerrar sesión?')) AUTH.logout();
    }
  });

  // ── Admin: gestión de usuarios ───────────────────────────
  document.getElementById('adminRefreshBtn')?.addEventListener('click', () => {
    if (typeof loadAdminUsers === 'function') loadAdminUsers();
  });

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
    if (close('#createTeamOverlay')) { if (typeof closeTeamModal === 'function') closeTeamModal(); return; }
    if (close('#reportOverlay'))  { closeReport();   return; }
    if (close('#detailOverlay'))  { closeDetail();   return; }
    if (close('#modalOverlay'))   { closeModal();    return; }
    if (close('#mobSheet'))       { closeMobSheet(); return; }
    closeAllExpands();
  });
}

document.addEventListener('DOMContentLoaded', init);
