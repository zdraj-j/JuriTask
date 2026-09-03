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
// PERSISTENCIA — localStorage (caché) + juritask.json (fuente de verdad)
// ============================================================
const KEYS = {
  tramites:  'juritask_tramites',
  order:     'juritask_order',
  config:    'juritask_config',
  pendiente: 'juritask_pendiente',
};

// ============================================================
// CAMBIOS SIN SUBIR
// ============================================================
// El orden de escritura de la app es siempre el mismo: primero `localStorage`,
// después el archivo del disco. La caché local, por tanto, **nunca va por
// detrás** del archivo: o van iguales, o la local va por delante.
//
// Eso importa porque `cargarDeArchivo()` reemplaza STATE con lo que traiga el
// disco. Si el guardado del día anterior no llegó a completarse —la carpeta
// perdió el permiso, el archivo estaba en un disco desconectado—, esa carga
// borra trabajo real y además lo pisa en la caché local, que era la última
// copia que quedaba. Es el camino por el que una jornada entera puede
// desaparecer sin dejar rastro ni error a la vista.
//
// La marca cierra ese agujero: se pone en cuanto algo cambia y **solo** se
// quita cuando la escritura del archivo termina bien. Mientras esté puesta, la
// carga sabe que la copia local manda (ver `_fusionarConLocal` en
// js/archivo.js).

function marcarCambiosPendientes() {
  try {
    if (localStorage.getItem(KEYS.pendiente)) return;   // ya marcado: no repisar la fecha
    localStorage.setItem(KEYS.pendiente, JSON.stringify({ desde: new Date().toISOString() }));
  } catch (_) { /* sin localStorage no hay nada que marcar */ }
}

function limpiarCambiosPendientes() {
  try { localStorage.removeItem(KEYS.pendiente); } catch (_) {}
}

/** Fecha del cambio más viejo sin subir, o `null` si todo está sincronizado. */
function cambiosPendientesDesde() {
  try {
    const raw = localStorage.getItem(KEYS.pendiente);
    if (!raw) return null;
    const d = new Date(JSON.parse(raw).desde);
    return isNaN(d.getTime()) ? new Date(0) : d;
  } catch (_) { return null; }
}

/**
 * saveAll con debounce de 400 ms para evitar re-escrituras excesivas.
 * Las escrituras inline (blur, checkboxes) pasan por aquí.
 *
 * Las dos capas van a ritmos distintos a propósito: localStorage es inmediato y
 * barato, así que absorbe las ráfagas de tecleo; el archivo espera un poco más
 * (`guardarArchivo`, 600 ms) porque cada escritura reemplaza el JSON entero.
 * Este es **el único punto** desde el que se guarda: mientras cualquier cambio
 * en STATE acabe llamando a saveAll, acaba en el disco.
 */
let _saveTimer = null;
function saveAll(immediate = false) {
  // Antes de tocar nada: queda constancia de que hay trabajo que el archivo aún
  // no tiene. Se marca aquí y no en `_flushSave` porque la carga inicial también
  // usa `_flushSave` para refrescar la caché, y eso no es un cambio del usuario.
  marcarCambiosPendientes();
  if (immediate) {
    _flushSave();
    if (typeof guardarArchivoAhora === 'function') guardarArchivoAhora();
  } else {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(_flushSave, 400);
    if (typeof guardarArchivo === 'function') guardarArchivo();
  }
}

// Asegurar guardado en localStorage antes de que la página se descargue
window.addEventListener('beforeunload', () => _flushSave());

// `pausarGuardadoLocal()` vivía aquí para el cierre de sesión, que vaciaba
// `localStorage` y necesitaba cortar el `beforeunload` para que no lo volviera
// a llenar. Desconectar Google ya no toca los datos —viven en el archivo del
// disco, no en la nube—, así que la función se quedó sin llamadas y se fue.

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
// IDENTIDAD DE LOS TRÁMITES
// ============================================================
// El `id` es la clave con la que `getById`, el borrado y el orden manual
// encuentran el trámite, y la que decide si dos entradas son el mismo.
//
// Con Firestore era además el nombre del documento, y un trámite sin `id`
// hacía que `doc(undefined)` generara uno nuevo en cada guardado: la lista
// amanecía con el mismo trámite repetido cientos de veces. Esa causa concreta
// se fue con Firestore, pero la defensa se queda, porque las entradas sin `id`
// siguen llegando por dos puertas que siguen abiertas:
//
//  - **JSON importados o antiguos**: el formato de exportación es el mismo de
//    siempre y hay archivos guardados de antes de que el `id` fuera
//    obligatorio.
//  - **`juritask.json` editado a mano**: es un archivo del usuario, y eso es
//    justamente la gracia de esta arquitectura.
//
// Aquí se garantiza que todo trámite acabe con un `id`, y `dedupeTramites()`
// resuelve las copias que ya venían sin él.

function tieneIdTramite(t) {
  return !!t && typeof t.id === 'string' && t.id !== '' && !t.id.includes('/');
}

/** Cuánto contenido acumula un trámite. Sirve para elegir entre dos copias. */
function pesoTramite(t) {
  if (!t) return -1;
  return (t.seguimiento?.length || 0) + (t.notas?.length || 0) + (t.attachments?.length || 0);
}

/**
 * Quita trámites repetidos de una lista, conservando el orden.
 *
 * - Dos entradas con el **mismo `id`** son el mismo trámite: se queda la
 *   primera.
 * - Las entradas **sin `id`** perdieron su identidad, así que se agrupan por
 *   `numero` —la clave de negocio: es lo que el usuario considera "el trámite",
 *   y lo que ya usa la detección de correo para no crear duplicados—. De cada
 *   grupo se conserva la copia más completa, que es la guardada más tarde.
 * - A lo que sobrevive sin id se le asigna uno, para que no vuelva a pasar.
 */
function dedupeTramites(lista) {
  const entradas = (Array.isArray(lista) ? lista : []).filter(t => t && typeof t === 'object');

  // Primera pasada: de cada grupo de copias sin id, cuál se queda.
  const elegidoSinId = new Map();   // numero → índice de la copia que se conserva
  entradas.forEach((t, i) => {
    if (tieneIdTramite(t)) return;
    const num = String(t.numero ?? '');
    if (!num) return;               // sin número no hay con qué agrupar: se conservan todas
    const prev = elegidoSinId.get(num);
    if (prev === undefined || pesoTramite(t) > pesoTramite(entradas[prev])) elegidoSinId.set(num, i);
  });

  const vistos = new Set();
  const out    = [];
  entradas.forEach((t, i) => {
    if (tieneIdTramite(t)) {
      if (vistos.has(t.id)) return;
      vistos.add(t.id);
      out.push(t);
      return;
    }
    const num = String(t.numero ?? '');
    if (num && elegidoSinId.get(num) !== i) return;   // copia descartada
    t.id = genId();
    vistos.add(t.id);
    out.push(t);
  });
  return out;
}

/** El orden manual es un conjunto de ids: repetirlos no significa nada. */
function dedupeOrder(order) {
  return [...new Set((Array.isArray(order) ? order : []).filter(id => typeof id === 'string' && id))];
}

// ============================================================
// MIGRACIÓN
// ============================================================
function migrateTramite(t) {
  // Última línea de defensa: un trámite sin id se guardaría en un documento
  // nuevo en cada subida. Ver el bloque de arriba.
  if (!tieneIdTramite(t)) t.id = genId();
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
    // La caché puede traer copias del mismo trámite si se guardó mientras la
    // lista estaba duplicada; se limpian antes de que lleguen a la pantalla.
    if (t) STATE.tramites = dedupeTramites(JSON.parse(t));

    const o = localStorage.getItem(KEYS.order) || localStorage.getItem(OLD.order);
    if (o) STATE.order = dedupeOrder(JSON.parse(o));

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
