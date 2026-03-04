/**
 * JuriTask — storage.js
 * Todo lo relacionado con estado, localStorage, migración e historial.
 */

// ============================================================
// TEMAS
// ============================================================
const THEMES = [
  { id:'claro',   nombre:'Claro',   swatches:['#f4f5f7','#ffffff','#3b5bdb','#1a1d23'] },
  { id:'oscuro',  nombre:'Oscuro',  swatches:['#0f1117','#1a1d27','#6e8efb','#e8eaf0'] },
  { id:'sepia',   nombre:'Sepia',   swatches:['#f5f0e8','#fdf8f0','#8b6c2e','#2c2416'] },
  { id:'pizarra', nombre:'Pizarra', swatches:['#1e2533','#26304a','#58a6f0','#d4daf0'] },
];

// ============================================================
// DEFAULTS
// ============================================================
const DEFAULT_CONFIG = {
  abogados: [
    { key:'abogado1', nombre:'Abogado 1', color:'#15803d' },
    { key:'abogado2', nombre:'Abogado 2', color:'#1d4ed8' },
  ],
  colorBar1: '#f59e0b',
  colorBar2: '#3b5bdb',
  colorBar3: '#10b981',
  modulos: [
    { sigla:'ACT',  nombre:'Actuaciones administrativas' },
    { sigla:'CBPR', nombre:'Cobro prejurídico' },
    { sigla:'COT',  nombre:'Conceptos y otros trámites' },
    { sigla:'CPJ',  nombre:'Conciliación prejudicial' },
    { sigla:'CNT',  nombre:'Contratos' },
    { sigla:'OTR',  nombre:'Otros documentos contractuales' },
    { sigla:'ROD',  nombre:'Respuesta oficios y derechos de petición' },
    { sigla:'PRE',  nombre:'Precontractual' },
    { sigla:'PRJ',  nombre:'Procesos judiciales' },
    { sigla:'TTL',  nombre:'Tutelas' },
  ],
  columns:    1,
  detailMode: 'expand',
  sortBy:     'vencimiento',
  theme:      'claro',
  autoReq:    true,
  autoReqTexto: '1er req',
  autoReqDias:  7,
  autoReqResponsable: 'yo',
  diasRestantes: false,
};

// ============================================================
// ESTADO GLOBAL
// ============================================================
const STATE = {
  tramites: [],
  order:    [],
  config: {
    ...DEFAULT_CONFIG,
    abogados: DEFAULT_CONFIG.abogados.map(a => ({ ...a })),
    modulos:  [...DEFAULT_CONFIG.modulos],
  },
};

// ============================================================
// HISTORIAL — Ctrl+Z (hasta 30 acciones)
// ============================================================
const HISTORY_MAX = 30;
const _history    = [];
let   _undoing    = false;

function pushHistory(label) {
  if (_undoing) return;
  _history.push({
    label,
    tramites: JSON.parse(JSON.stringify(STATE.tramites)),
    order:    JSON.parse(JSON.stringify(STATE.order)),
  });
  if (_history.length > HISTORY_MAX) _history.shift();
}

function undo() {
  if (!_history.length) { showToast('No hay acciones para deshacer.'); return; }
  const openId  = currentDetailId;
  const isModal = document.getElementById('detailOverlay')?.classList.contains('open');
  _undoing = true;
  const snap = _history.pop();
  STATE.tramites = snap.tramites;
  STATE.order    = snap.order;
  saveAll();
  renderAll();
  if (openId) {
    const t = getById(openId);
    if (t) { isModal ? openDetailModal(t) : openDetailExpand(t); }
  }
  showToast(`↩ Deshecho: ${snap.label}`);
  _undoing = false;
}

// ============================================================
// PERSISTENCIA — localStorage (fallback cuando no hay Firebase)
// ============================================================
const KEYS = {
  tramites: 'juritask_tramites',
  order:    'juritask_order',
  config:   'juritask_config',
};

/**
 * saveAll con debounce de 400ms para evitar re-escrituras excesivas.
 * Las escrituras inline (blur, checkboxes) pasan por aquí.
 * Siempre guarda en localStorage como respaldo inmediato, incluso cuando
 * Firebase está activo, para sobrevivir recargas rápidas (Ctrl+Shift+R).
 */
let _saveTimer = null;
function saveAll(immediate = false) {
  // Marcar timestamp de guardado para comparación al cargar
  STATE.config._savedAt = Date.now();

  if (typeof saveConfigDebounced === 'function') {
    // Respaldo inmediato en localStorage + guardado en Firestore (debounced)
    _flushSave();
    saveConfigDebounced();
    return;
  }
  if (immediate) {
    _flushSave();
  } else {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(_flushSave, 400);
  }
}

// Asegurar guardado en localStorage antes de que la página se descargue
window.addEventListener('beforeunload', () => _flushSave());

function _flushSave() {
  try {
    localStorage.setItem(KEYS.tramites, JSON.stringify(STATE.tramites));
    localStorage.setItem(KEYS.order,    JSON.stringify(STATE.order));
    localStorage.setItem(KEYS.config,   JSON.stringify(STATE.config));
  } catch (e) {
    console.warn('Error guardando en localStorage:', e);
  }
}

// ============================================================
// MIGRACIÓN
// ============================================================
function migrateTramite(t) {
  if (!t.tipo)        t.tipo        = 'abogado';
  if (!t.seguimiento) t.seguimiento = [];
  if (!t.notas)       t.notas       = [];
  if (!t.gestion)     t.gestion     = { analisis: false, cumplimiento: false };
  t.seguimiento.forEach(s => {
    if (s.responsable === 'auxiliar' || s.responsable === 'propio') s.responsable = 'yo';
    if (s.urgente === undefined) s.urgente = false;
  });
  // Migrar proximaAccion antigua
  if (t.proximaAccion?.descripcion) {
    const resp = t.proximaAccion.responsable;
    t.seguimiento.unshift({
      descripcion:  t.proximaAccion.descripcion,
      fecha:        t.proximaAccion.fecha || '',
      responsable:  (resp === 'auxiliar' || resp === 'propio') ? 'yo' : (resp || 'yo'),
      estado:       'pendiente',
      urgente:      false,
    });
    delete t.proximaAccion;
  }
}

// ============================================================
// CARGAR DATOS
// ============================================================
function loadAll() {
  const OLD = { tramites:'lexgestion_tramites', order:'lexgestion_order', config:'lexgestion_config' };
  try {
    const t = localStorage.getItem(KEYS.tramites) || localStorage.getItem(OLD.tramites);
    if (t) STATE.tramites = JSON.parse(t);

    const o = localStorage.getItem(KEYS.order) || localStorage.getItem(OLD.order);
    if (o) STATE.order = JSON.parse(o);

    const c = localStorage.getItem(KEYS.config) || localStorage.getItem(OLD.config);
    if (c) {
      const saved = JSON.parse(c);
      STATE.config = Object.assign(
        { ...DEFAULT_CONFIG, abogados: DEFAULT_CONFIG.abogados.map(a => ({...a})), modulos: [...DEFAULT_CONFIG.modulos] },
        saved
      );
      if (!STATE.config.abogados?.length) {
        STATE.config.abogados = [
          { key:'abogado1', nombre: saved.abogado1 || 'Abogado 1', color: saved.colorAbogado1 || '#15803d' },
          { key:'abogado2', nombre: saved.abogado2 || 'Abogado 2', color: saved.colorAbogado2 || '#1d4ed8' },
        ];
      }
    }
    STATE.tramites.forEach(migrateTramite);
  } catch (e) {
    console.error('Error cargando datos:', e);
  }
}

// ============================================================
// LIMPIEZA DE TERMINADOS (> 30 días)
// ============================================================
function purgeExpiredFinished() {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
  const before = STATE.tramites.length;
  STATE.tramites = STATE.tramites.filter(
    t => !t.terminado || new Date(t.terminadoEn) > cutoff
  );
  if (STATE.tramites.length !== before) saveAll(true);
}
