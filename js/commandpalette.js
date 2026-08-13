/**
 * JuriTask — commandpalette.js
 * Paleta de comandos (Ctrl/Cmd+K) + atajos de teclado.
 *
 * Atajos globales (cuando no se está escribiendo en un campo):
 *   Ctrl/Cmd+K  → abrir/cerrar la paleta
 *   ?           → abrir la paleta
 *   n           → nuevo trámite
 *   /           → enfocar la búsqueda
 */
(function () {
  let overlay = null, input = null, listEl = null;
  let filtered = [], sel = 0;

  // ── Definición de comandos ──────────────────────────────────
  function commands() {
    const go = v => () => { if (typeof switchView === 'function') switchView(v); };
    const theme = id => () => { if (typeof applyTheme === 'function') { applyTheme(id); if (typeof saveAll === 'function') saveAll(); } };
    const list = [
      { icon: 'plus',         label: 'Nuevo trámite',            hint: 'n', run: () => typeof openModal === 'function' && openModal() },
      { icon: 'search',       label: 'Buscar trámites',          hint: '/', run: focusSearch },
      { icon: 'list-checks',  label: 'Ir a: Agenda',             run: go('agenda') },
      { icon: 'layout-grid',  label: 'Ir a: Todos los trámites', run: go('all') },
      { icon: 'circle-check', label: 'Ir a: Terminados',         run: go('finished') },
      { icon: 'layout-dashboard', label: 'Ir a: Panel',          run: go('dashboard') },
      { icon: 'settings',     label: 'Ir a: Configuración',      run: go('config') },
      { icon: 'file-text',    label: 'Reporte del día',          run: () => typeof openReport === 'function' && openReport() },
      { icon: 'sheet',        label: 'Reporte de trámites (Excel)', run: () => typeof openReporte === 'function' && openReporte() },
      { icon: 'download',     label: 'Exportar reporte a Excel', run: () => typeof repExportXLSX === 'function' && repExportXLSX() },
      { icon: 'check-check',  label: 'Seleccionar trámites',     run: () => typeof selEnter === 'function' && selEnter() },
      { icon: 'undo-2',       label: 'Deshacer última acción',   run: () => typeof undo === 'function' && undo() },
      { icon: 'sun',          label: 'Tema: Claro',              run: theme('claro') },
      { icon: 'moon',         label: 'Tema: Oscuro',             run: theme('oscuro') },
      { icon: 'palette',      label: 'Tema: Pizarra',            run: theme('pizarra') },
    ];
    return list;
  }

  function focusSearch() {
    const s = document.getElementById('searchInput');
    if (s) { s.focus(); s.select(); }
  }

  // ── Construcción / render ───────────────────────────────────
  function build() {
    overlay = document.createElement('div');
    overlay.className = 'cmd-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Paleta de comandos');
    overlay.innerHTML = `
      <div class="cmd-box">
        <div class="cmd-input-wrap">
          <i data-lucide="search"></i>
          <input type="text" class="cmd-input" placeholder="Escribe un comando…" aria-label="Buscar comando" />
        </div>
        <div class="cmd-list" role="listbox"></div>
      </div>`;
    document.body.appendChild(overlay);
    input  = overlay.querySelector('.cmd-input');
    listEl = overlay.querySelector('.cmd-list');

    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    input.addEventListener('input', () => { render(); });
    input.addEventListener('keydown', onKey);
    listEl.addEventListener('click', e => {
      const row = e.target.closest('[data-i]'); if (!row) return;
      run(filtered[parseInt(row.dataset.i)]);
    });
  }

  function render() {
    const q = input.value.trim().toLowerCase();
    const all = commands();
    filtered = q ? all.filter(c => c.label.toLowerCase().includes(q)) : all;
    sel = 0;
    listEl.innerHTML = filtered.length
      ? filtered.map((c, i) => `
          <div class="cmd-item${i === 0 ? ' active' : ''}" data-i="${i}" role="option">
            <i data-lucide="${c.icon}"></i>
            <span class="cmd-label">${c.label}</span>
            ${c.hint ? `<kbd class="cmd-kbd">${c.hint}</kbd>` : ''}
          </div>`).join('')
      : '<div class="cmd-empty">Sin comandos</div>';
    if (window.refreshIcons) window.refreshIcons();
  }

  function highlight() {
    [...listEl.querySelectorAll('.cmd-item')].forEach((el, i) => {
      el.classList.toggle('active', i === sel);
      if (i === sel) el.scrollIntoView({ block: 'nearest' });
    });
  }

  function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, filtered.length - 1); highlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); highlight(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[sel]) run(filtered[sel]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  }

  function open() {
    if (!overlay) build();
    overlay.classList.add('open');
    input.value = '';
    render();
    setTimeout(() => input.focus(), 40);
  }
  function close() { if (overlay) overlay.classList.remove('open'); }
  function isOpen() { return overlay && overlay.classList.contains('open'); }
  function run(cmd) { close(); if (cmd && typeof cmd.run === 'function') setTimeout(cmd.run, 0); }

  // ── Atajos globales ─────────────────────────────────────────
  function isTyping() {
    const a = document.activeElement;
    return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
  }
  function anyModalOpen() {
    return !!document.querySelector('.overlay.open, .confirm-overlay.open, .cmd-overlay.open');
  }

  document.addEventListener('keydown', e => {
    // Ctrl/Cmd+K: abre/cierra la paleta siempre.
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault(); isOpen() ? close() : open(); return;
    }
    if (isOpen()) return;          // dentro de la paleta lo maneja onKey
    if (isTyping() || anyModalOpen()) return;

    if (e.key === '?') { e.preventDefault(); open(); }
    else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); if (typeof openModal === 'function') openModal(); }
    else if (e.key === '/') { e.preventDefault(); focusSearch(); }
  });
})();
