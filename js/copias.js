/**
 * JuriTask — copias.js
 * Copias de seguridad automáticas de los trámites.
 *
 * ── Por qué existe este archivo ─────────────────────────────
 *
 * La app **tuvo** copias automáticas: se guardaban a diario en
 * `users/{uid}/backups`, se conservaban siete días y el panel de administración
 * las listaba con botones de restaurar y borrar. Se retiraron al dejar de ser
 * multiusuario, con la idea de rehacerlas sobre Drive en una "fase 3" que
 * después se revirtió. El resultado, hasta ahora, era que **no había ninguna
 * copia**: ni automática ni antigua alcanzable, porque `firebase.rules` cierra
 * la colección `backups`. Lo único que quedaba era pulsar "Exportar JSON" a
 * mano y acordarse de hacerlo.
 *
 * ── Dónde se guardan ────────────────────────────────────────
 *
 * En `users/{uid}/meta/copia-AAAA-MM-DD`, un documento por día. Esa ruta se
 * elige a propósito: es una de las tres que las reglas ya permiten, así que
 * las copias funcionan **sin tocar `firebase.rules`** y sin reabrir nada de la
 * etapa multiusuario.
 *
 * El precio de meterlo todo en un documento es el tope de 1 MiB de Firestore.
 * Se comprueba antes de escribir y, si no cabe, se avisa en vez de fallar en
 * silencio (ver `TOPE_DOC`).
 *
 * ── Qué NO es ───────────────────────────────────────────────
 *
 * Una copia diaria no protege de un fallo de sincronización del mismo día: para
 * eso está la marca de cambios sin subir (`js/storage.js`). Son dos defensas
 * distintas y hacen falta las dos.
 */

const COPIAS_PREFIJO   = 'copia-';
const COPIAS_A_GUARDAR = 7;

// Tope real del documento: 1 MiB. Se deja margen para los metadatos del propio
// documento y para el sobrecoste de la codificación de Firestore.
const TOPE_DOC = 900 * 1024;

function _metaRef() { return _userRef().collection('meta'); }

/** El contenido de una copia: los trámites y su orden, nada más. */
function _cuerpoCopia() {
  return {
    creadoEn: new Date().toISOString(),
    tramites: JSON.stringify(STATE.tramites),   // en texto: Firestore no anida arrays de objetos sin límite
    order:    JSON.stringify(STATE.order || []),
    total:    STATE.tramites.length,
  };
}

/**
 * Guarda la copia de hoy si no existe ya, y retira las que sobran.
 *
 * Idempotente por diseño: el id es la fecha, así que abrir la app cinco veces
 * en un día deja una sola copia. Se llama al terminar la carga inicial.
 */
async function crearCopiaDiaria({ forzar = false } = {}) {
  if (!AUTH.activa) return null;
  // Una copia de un estado vacío no protege de nada y sí puede desplazar a una
  // copia buena cuando se retiran las viejas.
  if (!STATE.tramites.length) return null;
  // Con cambios sin subir, lo local va por delante de la nube: la copia es
  // válida igualmente (sale de STATE, no de Firestore).

  const id = COPIAS_PREFIJO + today();
  try {
    if (!forzar) {
      const ya = await _metaRef().doc(id).get();
      if (ya.exists) return id;
    }

    const cuerpo = _cuerpoCopia();
    const peso   = new Blob([JSON.stringify(cuerpo)]).size;
    if (peso > TOPE_DOC) {
      console.warn(`Copia diaria omitida: ${Math.round(peso / 1024)} KB supera el tope del documento.`);
      showToast('Los datos ya no caben en una copia automática. Exporta el JSON desde Ajustes.');
      return null;
    }

    await _metaRef().doc(id).set(cuerpo);
    await _retirarCopiasViejas();
    return id;
  } catch (e) {
    console.warn('No se pudo crear la copia diaria:', e);
    return null;
  }
}

/** Las copias que hay, de la más reciente a la más vieja. */
async function listarCopias() {
  if (!AUTH.activa) return [];
  // Se lee la colección entera —tiene `config`, `order` y como mucho siete
  // copias— y se filtra por prefijo. Una consulta con `where` sobre el id del
  // documento no aportaría nada a este tamaño.
  const snap = await _metaRef().get();
  const copias = [];
  snap.forEach(d => {
    if (!d.id.startsWith(COPIAS_PREFIJO)) return;
    const data = d.data() || {};
    copias.push({ id: d.id, fecha: d.id.slice(COPIAS_PREFIJO.length), creadoEn: data.creadoEn || '', total: data.total ?? null });
  });
  return copias.sort((a, b) => (a.id < b.id ? 1 : -1));
}

async function _retirarCopiasViejas() {
  const copias = await listarCopias();
  const sobran = copias.slice(COPIAS_A_GUARDAR);
  if (!sobran.length) return;
  const lote = db.batch();
  sobran.forEach(c => lote.delete(_metaRef().doc(c.id)));
  await lote.commit();
}

/**
 * Devuelve los trámites y el orden guardados en una copia, sin tocar STATE.
 * Separado de la restauración para que la confirmación pueda decir cuántos
 * trámites entran antes de reemplazar nada.
 */
async function leerCopia(id) {
  const doc = await _metaRef().doc(id).get();
  if (!doc.exists) throw new Error('La copia ya no existe.');
  const data = doc.data() || {};
  return {
    tramites: dedupeTramites(JSON.parse(data.tramites || '[]')),
    order:    dedupeOrder(JSON.parse(data.order || '[]')),
    creadoEn: data.creadoEn || '',
  };
}

/**
 * Reemplaza los trámites actuales por los de la copia.
 *
 * Antes de reemplazar deja una copia de lo que hay ahora, con el id de hoy
 * forzado. Restaurar por error es tan fácil como restaurar a propósito, y sin
 * esa red la equivocación no tendría vuelta.
 */
async function restaurarCopia(id) {
  const copia = await leerCopia(id);
  const cuando = copia.creadoEn ? new Date(copia.creadoEn).toLocaleString('es-CO') : id.slice(COPIAS_PREFIJO.length);

  // El mensaje va en una sola línea: `showConfirm` lo pinta con `textContent`,
  // así que un salto de línea no se vería.
  const ok = await showConfirm(
    `¿Restaurar la copia del ${cuando}? Entran ${copia.tramites.length} trámite(s) `
    + `y se reemplazan los ${STATE.tramites.length} de ahora. `
    + 'Antes de reemplazar se guarda una copia del estado actual.',
    { confirmLabel: 'Restaurar' }
  );
  if (!ok) return false;

  await crearCopiaDiaria({ forzar: true });

  STATE.tramites = copia.tramites;
  STATE.order    = copia.order;
  STATE.tramites.forEach(migrateTramite);
  // `saveAll(true)` escribe la caché al momento y encola la subida; el sello se
  // vacía para que el comparador vea todos los trámites como cambiados y los
  // suba, incluidos los que la nube ya no tenía.
  _sello.clear();
  saveAll(true);
  renderAll();
  showToast(`Copia del ${cuando} restaurada.`);
  return true;
}

async function borrarCopia(id) {
  const ok = await showConfirm('¿Eliminar esta copia?', { danger: true, confirmLabel: 'Eliminar' });
  if (!ok) return false;
  await _metaRef().doc(id).delete();
  showToast('Copia eliminada.');
  return true;
}

// ============================================================
// UI — Ajustes › Copias de seguridad
// ============================================================
// El id del contenedor es `copiasList`, no `backupList`: ese otro es el de la
// etapa multiusuario y `test/smoke.js` comprueba que no haya vuelto.

async function renderCopias() {
  const el = document.getElementById('copiasList');
  if (!el) return;
  el.innerHTML = '<p class="copias-vacio">Cargando…</p>';
  try {
    const copias = await listarCopias();
    if (!copias.length) {
      el.innerHTML = '<p class="copias-vacio">Todavía no hay copias. Se crea una sola al abrir la app cada día.</p>';
      return;
    }
    el.innerHTML = '';
    copias.forEach(c => {
      const cuando = c.creadoEn ? new Date(c.creadoEn).toLocaleString('es-CO') : c.fecha;
      const fila = document.createElement('div');
      fila.className = 'copia-fila';
      fila.innerHTML =
        `<span class="copia-fecha">${escapeHtml(cuando)}</span>`
        + `<span class="copia-total">${c.total ?? '—'} trámite(s)</span>`
        + `<button class="btn-small" type="button" data-restaurar>Restaurar</button>`
        + `<button class="btn-small btn-danger" type="button" data-borrar aria-label="Eliminar copia">Eliminar</button>`;
      fila.querySelector('[data-restaurar]').addEventListener('click', async () => {
        try { if (await restaurarCopia(c.id)) renderCopias(); }
        catch (e) { console.error(e); showToast('No se pudo restaurar la copia.'); }
      });
      fila.querySelector('[data-borrar]').addEventListener('click', async () => {
        try { if (await borrarCopia(c.id)) renderCopias(); }
        catch (e) { console.error(e); showToast('No se pudo eliminar la copia.'); }
      });
      el.appendChild(fila);
    });
  } catch (e) {
    console.error('Error cargando las copias:', e);
    el.innerHTML = '<p class="copias-vacio">No se pudieron cargar las copias. Revisa la conexión.</p>';
  }
}

function initCopias() {
  document.getElementById('copiaAhoraBtn')?.addEventListener('click', async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const id = await crearCopiaDiaria({ forzar: true });
      if (id) { showToast('Copia creada.'); renderCopias(); }
    } finally { btn.disabled = false; }
  });
}
