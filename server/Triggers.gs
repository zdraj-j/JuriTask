/**
 * JuriTask — Triggers.gs
 * Automatizaciones que corren **con la app cerrada**.
 *
 * Esto es lo que no se podía hacer sin backend: `docs/gmail-integracion.md`
 * decía "sin backend Gmail no puede avisar con la app cerrada". Ahora un
 * trigger de tiempo revisa cada mañana lo que vence y deja los borradores
 * puestos en su hilo.
 *
 * Depende de:
 *   Datos.gs      → getEstado / guardarEstado
 *   Correo.gs     → ultimoMensajeConAsunto / crearBorradorRespuesta / etiquetarHilo
 *   Plantillas.gs → plantillaPara / tipoGestionDesdeTarea  (generado desde
 *                   js/plantillas-correo.js: una sola fuente de verdad)
 *   Gemini.gs     → solo si `config.borradoresConIA` está activo
 */

const JT_ETIQUETA_BORRADOR = 'JuriTask/Borrador generado';
const JT_TRIGGER_FN        = 'generarBorradoresDelDia';

// ============================================================
// GENERADOR DIARIO DE BORRADORES
// ============================================================

/**
 * Por cada tarea pendiente que vence hoy o antes, busca el último correo cuyo
 * asunto contenga el número del trámite y deja ahí un borrador de respuesta.
 *
 * Nunca envía nada: deja el borrador para que lo revises.
 */
function generarBorradoresDelDia() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) throw new Error('Otra ejecución tiene el lock');

  try {
    const crudo = getEstado();
    if (!crudo) return { ok: true, generados: 0, nota: 'Sin datos en Drive' };

    const estado = JSON.parse(crudo);
    const config = estado.config || {};
    const hoy    = _jtHoy();
    const conIA  = config.borradoresConIA === true;

    // Registro de lo ya generado. Sin esto, cada corrida duplicaría borradores.
    const registrados = config.borradoresGenerados || {};

    const resumen = [];
    let generados = 0;

    (estado.tramites || []).filter(function (t) { return !t.terminado; }).forEach(function (t) {
      (t.seguimiento || []).forEach(function (s, i) {
        if (s.estado !== 'pendiente' || !s.fecha || s.fecha > hoy) return;

        const clave = t.id + '|' + i + '|' + s.fecha;
        if (registrados[clave]) return;

        const gestion = tipoGestionDesdeTarea(s.descripcion);
        if (!gestion) return;                       // la tarea no es un requerimiento

        const plantilla = plantillaPara(t.modulo, gestion);
        if (!plantilla) { resumen.push('#' + t.numero + ': sin plantilla para ' + gestion); return; }

        const correo = ultimoMensajeConAsunto(String(t.numero), 10);
        if (!correo) { resumen.push('#' + t.numero + ': sin correo con ese número en el asunto'); return; }

        let cuerpo = plantilla.cuerpo;
        if (conIA) {
          const adaptado = _jtAdaptarConIA(cuerpo, t, correo);
          if (adaptado) cuerpo = adaptado;
        }

        try {
          crearBorradorRespuesta(correo.messageId, _jtTextoAHtml(cuerpo), false);
          etiquetarHilo(correo.threadId, JT_ETIQUETA_BORRADOR);
          registrados[clave] = hoy;
          generados++;
          resumen.push('#' + t.numero + ': ' + plantilla.etiqueta);
        } catch (e) {
          resumen.push('#' + t.numero + ': error — ' + e.message);
        }
      });
    });

    // Guardar el registro aunque no se haya generado nada: los "ya intentados"
    // no se marcan, así que un fallo transitorio se reintenta mañana.
    if (generados) {
      config.borradoresGenerados = registrados;
      estado.config = config;
      guardarEstado(JSON.stringify(estado));
    }

    _jtAvisar(generados, resumen);
    return { ok: true, generados: generados, detalle: resumen };
  } finally {
    lock.releaseLock();
  }
}

/** Adapta la plantilla al último estado del hilo. Devuelve null si falla. */
function _jtAdaptarConIA(plantilla, tramite, correo) {
  try {
    const prompt =
      'Eres un asistente jurídico. Adapta el siguiente correo institucional al estado real del hilo.\n' +
      'No pidas lo que ya fue entregado. Conserva el tono formal y la estructura.\n' +
      'Responde SOLO con el cuerpo del correo, sin asunto ni encabezados.\n\n' +
      '--- PLANTILLA ---\n' + plantilla + '\n\n' +
      '--- TRÁMITE ---\n' + tramite.numero + ' — ' + (tramite.descripcion || '') + '\n\n' +
      '--- ÚLTIMO CORREO DEL HILO ---\n' +
      'De: ' + correo.de + '\nAsunto: ' + correo.asunto + '\n\n' + correo.cuerpo;
    const txt = geminiGenerar(prompt, false);
    return txt && txt.trim() ? txt.trim() : null;
  } catch (e) {
    console.warn('IA no disponible, se usa la plantilla tal cual: ' + e.message);
    return null;
  }
}

/** Correo-resumen. Es la única "notificación" posible con la app cerrada. */
function _jtAvisar(generados, resumen) {
  if (!generados && !resumen.length) return;
  const correo = Session.getActiveUser().getEmail();
  if (!correo) return;
  MailApp.sendEmail({
    to: correo,
    subject: 'JuriTask — ' + generados + ' borrador(es) generados',
    body: (generados
      ? 'Se dejaron ' + generados + ' borradores en sus hilos de Gmail.\n\n'
      : 'No se generó ningún borrador.\n\n') +
      resumen.join('\n') +
      '\n\nRevísalos antes de enviar: JuriTask nunca envía por su cuenta.',
  });
}

// ============================================================
// UTILIDADES
// ============================================================

/** Fecha de hoy como 'YYYY-MM-DD', misma convención que el cliente. */
function _jtHoy() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/** Texto plano → HTML mínimo, respetando los saltos de línea del original. */
function _jtTextoAHtml(texto) {
  return String(texto)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

// ============================================================
// GESTIÓN DEL TRIGGER
// ============================================================
// Se instala y se quita desde Ajustes, no a mano en el editor de Apps Script.

function estadoTrigger() {
  const t = ScriptApp.getProjectTriggers().filter(function (x) {
    return x.getHandlerFunction() === JT_TRIGGER_FN;
  })[0];
  return {
    activo: !!t,
    hora:   Number(PropertiesService.getScriptProperties().getProperty('TRIGGER_HORA') || 6),
  };
}

function instalarTrigger(hora) {
  quitarTrigger();
  const h = Math.min(23, Math.max(0, parseInt(hora, 10) || 6));
  ScriptApp.newTrigger(JT_TRIGGER_FN).timeBased().atHour(h).everyDays(1).create();
  PropertiesService.getScriptProperties().setProperty('TRIGGER_HORA', String(h));
  return estadoTrigger();
}

function quitarTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === JT_TRIGGER_FN) ScriptApp.deleteTrigger(t);
  });
  return { activo: false };
}
