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
  { id:'menta',   nombre:'Menta',   swatches:['#eaf6ef','#ffffff','#0f9b6e','#1c3a2e'] },
  { id:'rosa',    nombre:'Rosa',    swatches:['#fbeef1','#ffffff','#c2185b','#3a1c25'] },
  { id:'carbon',  nombre:'Carbón',  swatches:['#0a0a0c','#16161a','#a78bfa','#ececf1'] },
  { id:'marina',  nombre:'Marina',  swatches:['#0b1c30','#11253e','#38bdf8','#dbeafe'] },
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
    { sigla:'PRR',  nombre:'Prórroga' },
    { sigla:'OS',   nombre:'Orden de servicio' },
    { sigla:'ET',   nombre:'Estudio de títulos' },
    { sigla:'LIQ',  nombre:'Acta de liquidación' },
    { sigla:'NA',   nombre:'No aplica' },
    { sigla:'CNV',  nombre:'Convenio' },
    { sigla:'MIN',  nombre:'Minuta' },
  ],
  plantillas: [],
  columns:    1,
  detailMode: 'expand',
  sortBy:     'vencimiento',
  theme:      'claro',
  autoReq:    true,
  autoReqTexto: '1er req',
  autoReqDias:  7,
  autoReqResponsable: 'yo',
  diasRestantes: false,
  gmailCuentaIndice: 0,   // /mail/u/N — cuál sesión de Google usar al abrir Gmail
  // Los borradores automáticos usan las plantillas tal cual. Con esto activo,
  // Gemini las adapta al último estado del hilo — y el contenido del correo
  // sale hacia la API de Google.
  borradoresConIA: false,
  agendaScope: 'mias', // 'mias' | 'otros' | 'all' — filtro por responsabilidad en la Agenda
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
  showToast(`Deshecho: ${snap.label}`, 'undo-2');
  _undoing = false;
}

// ============================================================
// PERSISTENCIA — localStorage
// ============================================================
const KEYS = {
  tramites: 'juritask_tramites',
  order:    'juritask_order',
  config:   'juritask_config',
};

/**
 * Guarda el estado. Dos destinos con ritmos distintos:
 *
 *  - **localStorage**, con debounce de 400 ms: es la copia inmediata y la que
 *    permite repintar al instante en el siguiente arranque.
 *  - **Drive** (si hay servidor), con debounce de 2,5 s: cada `google.script.run`
 *    es un viaje de ida y vuelta, así que no se manda uno por tecla.
 *
 * Si `localStorage` no está disponible —dentro del iframe de Apps Script puede
 * lanzar `SecurityError`— el fallo se traga y Drive queda como único destino.
 */
let _saveTimer   = null;
let _syncTimer   = null;
const SYNC_DELAY = 2500;

function saveAll(immediate = false) {
  if (immediate) {
    _flushSave();
  } else {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(_flushSave, 400);
  }
  _programarSync(immediate);
}

function _programarSync(immediate = false) {
  if (typeof BACKEND === 'undefined' || !BACKEND.disponible) return;
  clearTimeout(_syncTimer);
  if (immediate) { _flushSync(); return; }
  _syncTimer = setTimeout(_flushSync, SYNC_DELAY);
}

function _flushSync() {
  clearTimeout(_syncTimer);
  if (typeof backendGuardar !== 'function') return;
  backendGuardar({ tramites: STATE.tramites, order: STATE.order, config: STATE.config });
}

// Antes de descargar la página: volcar lo pendiente. El envío a Drive es
// asíncrono y puede no llegar, pero la copia local sí queda.
window.addEventListener('beforeunload', () => { _flushSave(); _flushSync(); });

function _flushSave() {
  clearTimeout(_saveTimer);
  try {
    localStorage.setItem(KEYS.tramites, JSON.stringify(STATE.tramites));
    localStorage.setItem(KEYS.order,    JSON.stringify(STATE.order));
    localStorage.setItem(KEYS.config,   JSON.stringify(STATE.config));
  } catch (e) {
    console.warn('Error guardando en localStorage:', e);
  }
}

/**
 * Sincronización inicial: se llama **después** del primer render, para que la
 * app pinte ya con lo que hay en local y no se quede en blanco esperando a
 * Drive. Si el servidor tiene datos, sustituyen a los locales y se repinta.
 *
 * Drive manda: es el único sitio compartido entre dispositivos. Lo local es
 * caché. La excepción es el primer arranque, cuando el fichero aún no existe:
 * ahí se sube lo que haya en local para no perderlo.
 */
async function sincronizarConServidor() {
  if (typeof BACKEND === 'undefined' || !BACKEND.disponible) return;

  const remoto = await backendCargar();

  if (!remoto) {
    // Primer arranque: sembrar Drive con lo local (aunque esté vacío).
    await backendGuardar({ tramites: STATE.tramites, order: STATE.order, config: STATE.config });
    return;
  }

  STATE.tramites = Array.isArray(remoto.tramites) ? remoto.tramites : [];
  STATE.order    = Array.isArray(remoto.order)    ? remoto.order    : [];
  STATE.config   = Object.assign(
    { ...DEFAULT_CONFIG,
      abogados: DEFAULT_CONFIG.abogados.map(a => ({ ...a })),
      modulos:  [...DEFAULT_CONFIG.modulos] },
    remoto.config || {}
  );
  STATE.tramites.forEach(migrateTramite);
  _migrarClaveGemini();

  _flushSave();                       // refrescar la caché local
  purgeExpiredFinished();
  if (typeof renderAll === 'function') renderAll();
  if (typeof renderConfig === 'function' && currentView === 'config') renderConfig();
}

// ============================================================
// MIGRACIÓN
// ============================================================
function migrateTramite(t) {
  if (!t.tipo)        t.tipo        = 'abogado';
  if (!t.seguimiento) t.seguimiento = [];
  if (!t.notas)       t.notas       = [];
  if (!t.attachments) t.attachments = [];
  if (!t.gestion)     t.gestion     = { analisis: false, cumplimiento: false };
  t.seguimiento.forEach(s => {
    if (s.responsable === 'auxiliar' || s.responsable === 'propio') s.responsable = 'yo';
    if (s.urgente === undefined) s.urgente = false;
    if (!s.attachments) s.attachments = [];
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
    _migrarClaveGemini();
  } catch (e) {
    console.error('Error cargando datos:', e);
  }
}

/**
 * La API key de Gemini vivía en `config.geminiApiKey`, es decir: viajaba al
 * navegador y acababa dentro del JSON de datos. Ahora está en Script
 * Properties del servidor. Si queda un resto de la versión anterior se borra
 * del estado —hay que volver a pegarla una vez en Ajustes—, para que el
 * secreto no siga replicándose en cada guardado.
 */
function _migrarClaveGemini() {
  if (!STATE.config || !STATE.config.geminiApiKey) return;
  delete STATE.config.geminiApiKey;
  console.warn('La clave de Gemini se retiró del estado local: vuelve a guardarla en Ajustes.');
}

// ============================================================
// LIMPIEZA DE TERMINADOS (> 30 días)
// ============================================================
function purgeExpiredFinished() {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
  const before = STATE.tramites.length;
  STATE.tramites = STATE.tramites.filter(t => {
    if (!t.terminado) return true;
    const ts = t.terminadoEn ? new Date(t.terminadoEn) : null;
    // Sin fecha de terminado válida: conservar y sellar ahora (evita borrado accidental
    // de trámites terminados sin timestamp; el contador de 30 días arranca desde hoy).
    if (!ts || isNaN(ts.getTime())) { t.terminadoEn = new Date().toISOString(); return true; }
    return ts > cutoff;
  });
  if (STATE.tramites.length !== before) saveAll(true);
}
