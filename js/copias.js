/**
 * JuriTask — copias.js
 * Copias de seguridad automáticas, en la carpeta de datos.
 *
 * ── Dónde ───────────────────────────────────────────────────
 *
 *   <carpeta>/copias/juritask-AAAA-MM-DD.json
 *
 * Una por día, siete en retención. El id es la fecha, así que la operación es
 * idempotente: abrir la app cinco veces en un día deja una sola copia.
 *
 * Antes vivían en Firestore (`users/{uid}/meta/copia-…`). Al pasar la base de
 * datos a un archivo del disco, las copias se van con ella: no tendría sentido
 * dejar el respaldo en la nube que la app ya no usa, y así son archivos que el
 * usuario ve, copia a un USB y respalda con sus propias herramientas.
 *
 * ── Qué NO es ───────────────────────────────────────────────
 *
 * Una copia diaria no protege de un guardado fallido del mismo día: para eso
 * está la marca de cambios pendientes (`js/storage.js`). Tampoco protege de que
 * el disco muera: **están en el mismo disco que el original.** Esa es la
 * limitación real de esta arquitectura y conviene tenerla presente — la carpeta
 * debería estar en algo que se sincronice o se respalde fuera del equipo.
 */

const COPIAS_PREFIJO   = 'juritask-';
const COPIAS_A_GUARDAR = 7;

/** El directorio `copias/`, creándolo si hace falta. */
async function _dirCopias(crear = true) {
  if (!ARCHIVO.conectado) return null;
  return ARCHIVO.carpeta.getDirectoryHandle(CARPETA_COPIAS, { create: crear });
}

/**
 * Guarda la copia de hoy si no existe ya, y retira las que sobran.
 * Se llama al terminar la carga inicial.
 */
async function crearCopiaDiaria({ forzar = false } = {}) {
  if (!ARCHIVO.conectado) return null;
  // Una copia de un estado vacío no protege de nada y sí podría desplazar a una
  // copia buena al aplicar la retención.
  if (!STATE.tramites.length) return null;

  const nombre = `${COPIAS_PREFIJO}${today()}.json`;
  try {
    const dir = await _dirCopias();

    if (!forzar && await _existe(dir, nombre)) return nombre;

    const cuerpo = {
      version:   ARCHIVO_VERSION,
      creadoEn:  new Date().toISOString(),
      total:     STATE.tramites.length,
      tramites:  STATE.tramites,
      order:     STATE.order || [],
      config:    STATE.config,
    };

    const h = await dir.getFileHandle(nombre, { create: true });
    const w = await h.createWritable();
    await w.write(JSON.stringify(cuerpo, null, 2));
    await w.close();

    await _retirarCopiasViejas();
    return nombre;
  } catch (e) {
    console.warn('No se pudo crear la copia diaria:', e);
    return null;
  }
}

async function _existe(dir, nombre) {
  try { await dir.getFileHandle(nombre); return true; }
  catch (_) { return false; }
}

/** Las copias que hay, de la más reciente a la más vieja. */
async function listarCopias() {
  if (!ARCHIVO.conectado) return [];
  const copias = [];
  try {
    const dir = await _dirCopias(false);
    if (!dir) return [];
    // Solo las copias diarias: los `conflicto-*.json` que deja `js/archivo.js`
    // viven aquí también, pero no son copias que se puedan restaurar a ciegas.
    for await (const [nombre, handle] of dir.entries()) {
      if (handle.kind !== 'file') continue;
      if (!nombre.startsWith(COPIAS_PREFIJO) || !nombre.endsWith('.json')) continue;
      const file = await handle.getFile();
      copias.push({
        nombre,
        fecha: nombre.slice(COPIAS_PREFIJO.length, -'.json'.length),
        creadoEn: new Date(file.lastModified).toISOString(),
        bytes: file.size,
      });
    }
  } catch (e) {
    // `copias/` puede no existir todavía: no es un error.
    if (e?.name !== 'NotFoundError') console.warn('No se pudieron listar las copias:', e);
    return [];
  }
  return copias.sort((a, b) => (a.nombre < b.nombre ? 1 : -1));
}

async function _retirarCopiasViejas() {
  const copias = await listarCopias();
  const sobran = copias.slice(COPIAS_A_GUARDAR);
  if (!sobran.length) return;
  const dir = await _dirCopias(false);
  for (const c of sobran) {
    try { await dir.removeEntry(c.nombre); }
    catch (e) { console.warn(`No se pudo borrar ${c.nombre}:`, e); }
  }
}

/**
 * Devuelve lo guardado en una copia, sin tocar STATE. Separado de la
 * restauración para que la confirmación pueda decir cuántos trámites entran
 * antes de reemplazar nada.
 */
async function leerCopia(nombre) {
  const dir  = await _dirCopias(false);
  if (!dir) throw new Error('Sin carpeta de datos.');
  const h    = await dir.getFileHandle(nombre);
  const data = JSON.parse(await (await h.getFile()).text());
  return {
    tramites: dedupeTramites(Array.isArray(data.tramites) ? data.tramites : []),
    order:    dedupeOrder(Array.isArray(data.order) ? data.order : []),
    creadoEn: data.creadoEn || '',
  };
}

/**
 * Reemplaza los trámites actuales por los de la copia.
 *
 * Antes de reemplazar guarda una copia de lo que hay ahora, forzada. Restaurar
 * por error es tan fácil como restaurar a propósito, y sin esa red la
 * equivocación no tendría vuelta.
 */
async function restaurarCopia(nombre) {
  const copia  = await leerCopia(nombre);
  const cuando = copia.creadoEn ? new Date(copia.creadoEn).toLocaleString('es-CO') : nombre;

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
  saveAll(true);
  renderAll();
  showToast(`Copia del ${cuando} restaurada.`);
  return true;
}

async function borrarCopia(nombre) {
  const ok = await showConfirm('¿Eliminar esta copia?', { danger: true, confirmLabel: 'Eliminar' });
  if (!ok) return false;
  const dir = await _dirCopias(false);
  await dir.removeEntry(nombre);
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

  if (!ARCHIVO.conectado) {
    el.innerHTML = '<p class="copias-vacio">Conecta la carpeta de datos para tener copias automáticas.</p>';
    return;
  }

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
        + `<span class="copia-total">${Math.max(1, Math.round(c.bytes / 1024))} KB</span>`
        + `<button class="btn-small" type="button" data-restaurar>Restaurar</button>`
        + `<button class="btn-small btn-danger" type="button" data-borrar aria-label="Eliminar copia">Eliminar</button>`;
      fila.querySelector('[data-restaurar]').addEventListener('click', async () => {
        try { if (await restaurarCopia(c.nombre)) renderCopias(); }
        catch (e) { console.error(e); showToast('No se pudo restaurar la copia.'); }
      });
      fila.querySelector('[data-borrar]').addEventListener('click', async () => {
        try { if (await borrarCopia(c.nombre)) renderCopias(); }
        catch (e) { console.error(e); showToast('No se pudo eliminar la copia.'); }
      });
      el.appendChild(fila);
    });
  } catch (e) {
    console.error('Error cargando las copias:', e);
    el.innerHTML = '<p class="copias-vacio">No se pudieron leer las copias de la carpeta.</p>';
  }
}

function initCopias() {
  document.getElementById('copiaAhoraBtn')?.addEventListener('click', async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const nombre = await crearCopiaDiaria({ forzar: true });
      if (nombre) { showToast('Copia creada.'); renderCopias(); }
      else showToast('No se pudo crear la copia.');
    } finally { btn.disabled = false; }
  });
}
