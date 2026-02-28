/**
 * JuriTask — tramites.js
 * CRUD de trámites, lógica de negocio, helpers de dominio.
 */

// ============================================================
// HELPERS DE FECHA
// ============================================================
let _todayCache = '', _tomorrowCache = '', _cacheTs = 0;

function today() {
  const now = Date.now();
  if (now - _cacheTs < 1000) return _todayCache;
  const d = new Date();
  _todayCache    = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const t2 = new Date(d); t2.setDate(t2.getDate() + 1);
  _tomorrowCache = `${t2.getFullYear()}-${String(t2.getMonth()+1).padStart(2,'0')}-${String(t2.getDate()).padStart(2,'0')}`;
  _cacheTs = now;
  return _todayCache;
}
function tomorrow() { today(); return _tomorrowCache; }

function nDaysFromToday(n) {
  const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatDate(s) {
  if (!s) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

function formatDatetime(iso) {
  try { return new Date(iso).toLocaleString('es-CO', { dateStyle:'short', timeStyle:'short' }); }
  catch { return iso; }
}

function dateClass(s) {
  if (!s) return '';
  const hoy = today(), man = tomorrow();
  if (s < hoy)    return 'overdue';
  if (s === hoy)  return 'today';
  if (s === man)  return 'soon';
  return 'upcoming';
}

function vencClass(s, tramite) {
  if (!s) return '';
  if (tramite?.gestion?.cumplimiento) return 'upcoming';
  return dateClass(s);
}

function diasRestantesNum(fechaISO) {
  if (!fechaISO) return null;
  return Math.round((new Date(fechaISO) - new Date(today())) / 86400000);
}

function diasRestantesLabel(dias) {
  if (dias === null) return '';
  if (dias < 0)  return `${Math.abs(dias)}d vencido`;
  if (dias === 0) return 'Hoy';
  if (dias === 1) return 'Mañana';
  return `${dias}d`;
}

// ============================================================
// HELPERS DE DOMINIO
// ============================================================
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function sentenceCase(str) {
  if (!str) return str;
  const s = str.trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\n/g,'<br>');
}

function escapeAttr(str) {
  return String(str).replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function abogadoName(key) {
  if (!key || key === 'yo') return 'Yo mismo';
  if (typeof _teamMembers !== 'undefined') {
    const m = _teamMembers.find(x => x.uid === key);
    if (m) return m.displayName || m.email || key;
  }
  const a = (STATE.config.abogados || []).find(x => x.key === key);
  return a ? a.nombre : key;
}

function abogadoColor(key) {
  if (!key || key === 'yo') return '#6b7280';
  // Para UIDs de Firestore (miembros de equipo), usar color guardado en config o generar uno consistente
  if (typeof _teamMembers !== 'undefined' && _teamMembers.find(x => x.uid === key)) {
    const saved = (STATE.config.abogados || []).find(x => x.key === key);
    if (saved) return saved.color;
    // Color determinista basado en el uid
    let hash = 0;
    for (let i = 0; i < key.length; i++) hash = key.charCodeAt(i) + ((hash << 5) - hash);
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue},60%,40%)`;
  }
  const a = (STATE.config.abogados || []).find(x => x.key === key);
  return a ? a.color : '#9333ea';
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function computeEtapa(t)  { return t.gestion?.cumplimiento ? 'seguimiento' : 'gestion'; }
function esPropio(t)      { return t.tipo === 'propio'; }

function proximaFechaSeguimiento(t) {
  const pendientes = (t.seguimiento || []).filter(s => s.estado === 'pendiente' && s.fecha);
  if (!pendientes.length) return null;
  return pendientes.map(s => s.fecha).sort()[0];
}

function esHoyOVencido(t) {
  const hoy = today();
  if (t.fechaVencimiento && !t.gestion?.cumplimiento && t.fechaVencimiento <= hoy) return true;
  const pf = proximaFechaSeguimiento(t);
  return !!(pf && pf <= hoy);
}

function getById(id) {
  return STATE.tramites.find(t => t.id === id);
}

// ============================================================
// CSS DINÁMICO
// ============================================================
function applyCssColors() {
  const s = document.documentElement.style;
  (STATE.config.abogados || []).forEach((a, i) => s.setProperty(`--color-abogado${i+1}`, a.color));
  s.setProperty('--bar-color-1', STATE.config.colorBar1 || '#f59e0b');
  s.setProperty('--bar-color-2', STATE.config.colorBar2 || '#3b5bdb');
  s.setProperty('--bar-color-3', STATE.config.colorBar3 || '#10b981');
}

function applyTheme(id) {
  document.documentElement.setAttribute('data-theme', id);
  STATE.config.theme = id;
  document.querySelectorAll('.theme-card').forEach(c => c.classList.toggle('active', c.dataset.theme === id));
}

// ============================================================
// TAREA AUTOMÁTICA AL MARCAR CUMPLIMIENTO
// ============================================================
function crearTareaRequerimiento(t) {
  if (!STATE.config.autoReq) return;
  const dias  = parseInt(STATE.config.autoReqDias) || 7;
  const texto = (STATE.config.autoReqTexto || '1er req').trim();
  const fecha = nDaysFromToday(dias);
  if (!t.seguimiento.some(s => s.descripcion === texto && s.fecha === fecha && s.estado === 'pendiente')) {
    t.seguimiento.unshift({
      descripcion: texto, fecha,
      responsable: esPropio(t) ? 'yo' : t.abogado,
      estado: 'pendiente', urgente: false,
    });
  }
}

// ============================================================
// ORDEN MANUAL (drag & drop)
// ============================================================
function getActiveOrder() {
  const activeIds = STATE.tramites.filter(t => !t.terminado).map(t => t.id);
  return [
    ...STATE.order.filter(id => activeIds.includes(id)),
    ...activeIds.filter(id => !STATE.order.includes(id)),
  ];
}

function reorder(srcId, targetId) {
  const order = getActiveOrder();
  const si = order.indexOf(srcId), ti = order.indexOf(targetId);
  if (si === -1 || ti === -1) return;
  pushHistory('Reordenar tarjetas');
  order.splice(si, 1);
  order.splice(ti, 0, srcId);
  STATE.order = order;
  saveAll();
  renderAll();
}

// ============================================================
// ORDENACIÓN
// ============================================================
function sortActives(list) {
  const manualOrder = getActiveOrder();
  const sortBy = STATE.config.sortBy || 'vencimiento';
  const FAR    = '9999-99-99';
  return [...list].sort((a, b) => {
    const pfa = proximaFechaSeguimiento(a) || FAR;
    const pfb = proximaFechaSeguimiento(b) || FAR;
    let cmp = 0;
    if      (sortBy === 'vencimiento')  { cmp = (a.fechaVencimiento||FAR).localeCompare(b.fechaVencimiento||FAR); }
    else if (sortBy === 'seguimiento')  { cmp = pfa.localeCompare(pfb); }
    else if (sortBy === 'mixto')        { const ma=[a.fechaVencimiento,pfa].filter(x=>x!==FAR).sort()[0]||FAR, mb=[b.fechaVencimiento,pfb].filter(x=>x!==FAR).sort()[0]||FAR; cmp=ma.localeCompare(mb); }
    else if (sortBy === 'abogado')      { cmp = abogadoName(a.abogado||'yo').localeCompare(abogadoName(b.abogado||'yo')); }
    else if (sortBy === 'numero')       { cmp = (parseInt(a.numero)||0) - (parseInt(b.numero)||0); }
    return cmp !== 0 ? cmp : manualOrder.indexOf(a.id) - manualOrder.indexOf(b.id);
  });
}

// ============================================================
// CRUD — acciones de detalle (_detailAction)
// Los botones en el HTML usan onclick="_detailAction(cmd)" para
// evitar problemas de timing con currentDetailId.
// ============================================================
function _detailAction(cmd) {
  const modal = document.getElementById('detailModal');
  const id    = modal?.dataset.id;
  if (!id) return;
  const t = getById(id);
  if (!t) return;

  if (cmd === 'edit') {
    closeDetail();
    setTimeout(() => openModal(t), 30);

  } else if (cmd === 'delete') {
    const num = t.numero || id;
    if (!confirm(`¿Eliminar el trámite #${num} "${t.descripcion}"?\nEsta acción no se puede deshacer.`)) return;
    pushHistory(`Eliminar trámite #${num}`);
    closeDetail();
    STATE.tramites = STATE.tramites.filter(x => x.id !== id);
    STATE.order    = STATE.order.filter(x => x !== id);
    if (typeof deleteTramiteFS === 'function') deleteTramiteFS(id, t._scope || 'private');
    saveAll(); renderAll(); showToast('Trámite eliminado.');

  } else if (cmd === 'duplicate') {
    const newT = JSON.parse(JSON.stringify(t));
    newT.id         = genId();
    newT.numero     = t.numero + '-copia';
    newT.terminado  = false; newT.terminadoEn = null;
    newT.creadoEn   = new Date().toISOString();
    newT.gestion    = { analisis: false, cumplimiento: false };
    pushHistory(`Duplicar trámite #${t.numero}`);
    STATE.tramites.push(newT); STATE.order.push(newT.id);
    if (typeof saveTramiteFS === 'function') saveTramiteFS(newT);
    saveAll(); renderAll(); showToast(`Trámite duplicado como #${newT.numero}.`);
  }
}

// ============================================================
// EXPORT / IMPORT
// ============================================================
function exportData() {
  const blob = new Blob(
    [JSON.stringify({ tramites: STATE.tramites, order: STATE.order, config: STATE.config }, null, 2)],
    { type: 'application/json' }
  );
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url; a.download = `juritask_${today()}.json`; a.click();
  URL.revokeObjectURL(url);
  showToast('Datos exportados.');
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.tramites) STATE.tramites = data.tramites;
      if (data.order)    STATE.order    = data.order;
      if (data.config) {
        STATE.config = Object.assign(
          { ...DEFAULT_CONFIG, abogados: DEFAULT_CONFIG.abogados.map(a=>({...a})), modulos: [...DEFAULT_CONFIG.modulos] },
          data.config
        );
        if (!STATE.config.abogados?.length) {
          STATE.config.abogados = [
            { key:'abogado1', nombre: data.config.abogado1||'Abogado 1', color: data.config.colorAbogado1||'#15803d' },
            { key:'abogado2', nombre: data.config.abogado2||'Abogado 2', color: data.config.colorAbogado2||'#1d4ed8' },
          ];
        }
      }
      STATE.tramites.forEach(migrateTramite);
      saveAll(true); applyCssColors(); applyTheme(STATE.config.theme || 'claro');
      populateModuloSelects(); updateAbogadoSelects();
      const ds = document.getElementById('sortSelect'); if (ds) ds.value = STATE.config.sortBy || 'vencimiento';
      renderAll(); showToast('Datos importados.');
    } catch { showToast('Error al importar. Verifica el archivo JSON.'); }
  };
  reader.readAsText(file);
}
