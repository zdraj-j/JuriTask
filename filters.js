/**
 * JuriTask — filters.js
 * Filtros, búsqueda, selects de módulos/abogados.
 */

// ============================================================
// POPULATE SELECTS
// ============================================================
function populateModuloSelects() {
  ['filterModulo', 'fModulo'].forEach(id => {
    const sel = document.getElementById(id); if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = id === 'filterModulo' ? '<option value="">Todos</option>' : '';
    STATE.config.modulos.forEach(m => {
      const o = document.createElement('option');
      o.value = m.sigla; o.textContent = `${m.sigla} — ${m.nombre}`;
      sel.appendChild(o);
    });
    sel.value = cur;
  });
}

function updateAbogadoSelects() {
  const abogados = STATE.config.abogados || [];

  ['filterAbogado', 'filterResponsable'].forEach((id, idx) => {
    const sel = document.getElementById(id); if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">Todos</option>';
    abogados.forEach(a => { const o=document.createElement('option'); o.value=a.key; o.textContent=a.nombre; sel.appendChild(o); });
    if (idx === 1) { const o=document.createElement('option'); o.value='yo'; o.textContent='Yo mismo'; sel.appendChild(o); }
    if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
  });

  const fAbM = document.getElementById('fAbogado');
  if (fAbM) {
    const cur = fAbM.value;
    fAbM.innerHTML = '';
    abogados.forEach(a => { const o=document.createElement('option'); o.value=a.key; o.textContent=a.nombre; fAbM.appendChild(o); });
    fAbM.value = ([...fAbM.options].some(o => o.value === cur)) ? cur : (abogados[0]?.key || '');
  }

  const rg = document.getElementById('reportFilterGroup');
  if (rg) {
    rg.innerHTML = '<button class="toggle-btn active" data-abogado="">Todos</button>';
    abogados.forEach(a => {
      const btn = document.createElement('button'); btn.className='toggle-btn'; btn.dataset.abogado=a.key; btn.textContent=a.nombre; rg.appendChild(btn);
    });
    const yo = document.createElement('button'); yo.className='toggle-btn'; yo.dataset.abogado='yo'; yo.textContent='Yo mismo'; rg.appendChild(yo);
    reportFiltroAbogado = '';
  }
}
const updateAbogadoNames = updateAbogadoSelects;

function buildRespOptions(tipoTramite, abogadoKey, selectedValue) {
  const opts = [];
  if (tipoTramite === 'abogado' && abogadoKey) {
    const a = (STATE.config.abogados || []).find(x => x.key === abogadoKey);
    if (a) opts.push({ value: a.key, label: a.nombre });
  }
  opts.push({ value:'yo', label:'Yo mismo' });
  return opts.map(o => `<option value="${o.value}" ${o.value === selectedValue ? 'selected':''}>${o.label}</option>`).join('');
}

// ============================================================
// RECOGER FILTROS ACTIVOS
// ============================================================
function getFilters() {
  return {
    tipo:        document.getElementById('filterTipo')?.value        || '',
    abogado:     document.getElementById('filterAbogado')?.value     || '',
    modulo:      document.getElementById('filterModulo')?.value      || '',
    responsable: document.getElementById('filterResponsable')?.value || '',
    etapa:       document.getElementById('filterEtapa')?.value       || '',
    scope:       document.getElementById('filterScope')?.value       || '',
    search:      (document.getElementById('searchInput')?.value || '').trim().toLowerCase(),
  };
}

// ============================================================
// APLICAR FILTROS — búsqueda en número, descripción, tareas y notas
// ============================================================
function applyFilters(list, f) {
  return list.filter(t => {
    if (f.tipo        && t.tipo !== f.tipo)                                                    return false;
    if (f.abogado     && t.abogado !== f.abogado)                                              return false;
    if (f.modulo      && t.modulo !== f.modulo)                                                return false;
    if (f.etapa       && computeEtapa(t) !== f.etapa)                                          return false;
    if (f.scope       && t._scope !== f.scope)                                                 return false;
    if (f.responsable && !(t.seguimiento||[]).some(s => s.responsable === f.responsable))      return false;
    if (f.search) {
      const q = f.search;
      const ok =
        (t.numero||'').toString().toLowerCase().includes(q)     ||
        (t.descripcion||'').toLowerCase().includes(q)           ||
        (t.seguimiento||[]).some(s => (s.descripcion||'').toLowerCase().includes(q)) ||
        (t.notas||[]).some(n => (n.texto||'').toLowerCase().includes(q));
      if (!ok) return false;
    }
    return true;
  });
}

// ============================================================
// SORT / COLUMNAS / MODO DETALLE
// ============================================================
function setColumns(n) {
  STATE.config.columns = n;
  document.querySelectorAll('.col-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.cols) === n));
  document.querySelectorAll('.mob-col-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.cols) === n));
  saveAll(); renderAll();
}

function setDetailMode(mode) {
  STATE.config.detailMode = mode;
  document.getElementById('modeExpand')?.classList.toggle('active', mode === 'expand');
  document.getElementById('modeModal')?.classList.toggle('active',  mode === 'modal');
  saveAll();
}

function setSortBy(val) {
  STATE.config.sortBy = val;
  const ds = document.getElementById('sortSelect');    if (ds) ds.value = val;
  const ms = document.getElementById('sortSelectMob'); if (ms) ms.value = val;
  saveAll(); renderAll();
}

// ============================================================
// CUENTA EN CONFIGURACIÓN
// ============================================================
function syncConfigAccountUI() {
  const p = (typeof AUTH !== 'undefined') ? AUTH.userProfile : null;
  if (!p) return;

  const el = id => document.getElementById(id);
  const nameEl  = el('configUserName');
  const emailEl = el('configUserEmail');
  const roleEl  = el('configUserRole');
  const avEl    = el('configAvatar');
  if (nameEl)  nameEl.textContent  = p.displayName || '';
  if (emailEl) emailEl.textContent = p.email || '';
  if (roleEl)  roleEl.textContent  = p.role === 'admin' ? '👑 Administrador' : '👤 Usuario';
  if (avEl) {
    if (p.photoURL) avEl.innerHTML = `<img src="${p.photoURL}" style="width:100%;height:100%;border-radius:50%;object-fit:cover" />`;
    else avEl.textContent = (p.displayName || p.email || '?').slice(0, 2).toUpperCase();
  }
  // Mostrar filtro de scope solo si tiene equipo
  const sw = document.getElementById('filterScopeWrap');
  if (sw) sw.style.display = p.teamId ? '' : 'none';
}
