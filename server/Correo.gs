/**
 * JuriTask — Correo.gs
 * Acceso a Gmail desde el servidor.
 *
 * Aquí el servidor hace de **transporte**, no de intérprete: devuelve las
 * respuestas de la Gmail API tal cual y el cliente sigue parseándolas con los
 * regex de `js/gmail.js`, que es donde están probados y donde vive el
 * conocimiento del formato de los correos de notificación.
 *
 * La ventaja de pasar por aquí no es el parseo: es que el token ya no viaja al
 * navegador, no hay popup de OAuth, no caduca a los 7 días, y la Fase 5 podrá
 * llamar a estas mismas funciones desde un trigger con la app cerrada.
 */

function _jtGmailAuth() {
  return { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
}

/**
 * Proxy de la Gmail API. `path` es lo que va tras `/users/me/`, por ejemplo:
 *
 *   messages?maxResults=25&q=…
 *   messages/<id>?format=full
 *   threads/<id>?format=full
 *
 * Devuelve el JSON **como cadena**: las respuestas de Gmail van muy anidadas y
 * dejar que `google.script.run` las convierta invita a sorpresas. El cliente
 * hace `JSON.parse`, igual que hacía con `fetch`.
 */
function gmailApi(path) {
  const res = UrlFetchApp.fetch('https://gmail.googleapis.com/gmail/v1/users/me/' + path, {
    headers: _jtGmailAuth(),
    muteHttpExceptions: true,
  });
  const codigo = res.getResponseCode();
  if (codigo === 401) throw new Error('gmail-401');
  if (codigo === 403) throw new Error('Gmail rechazó el permiso. ¿Está habilitada la Gmail API en el proyecto?');
  if (codigo === 429) throw new Error('Límite de uso de Gmail alcanzado. Intenta más tarde.');
  if (codigo !== 200) throw new Error('Error de Gmail (' + codigo + ')');
  return res.getContentText();
}

// ============================================================
// BORRADORES
// ============================================================

/**
 * Crea un borrador de respuesta **dentro del hilo** del mensaje indicado.
 *
 * `createDraftReply` de GmailApp pone por su cuenta las cabeceras `In-Reply-To`
 * y `References`, que es lo que hace que Gmail lo enganche a la conversación en
 * vez de dejarlo suelto. Construirlo a mano con `Gmail.Users.Drafts.create`
 * obligaría a montar el MIME entero.
 */
function crearBorradorRespuesta(messageId, cuerpoHtml, soloRemitente) {
  const msg = GmailApp.getMessageById(messageId);
  if (!msg) throw new Error('No se encontró el mensaje ' + messageId);
  const opciones = { htmlBody: cuerpoHtml };
  const draft = soloRemitente ? msg.createDraftReply('', opciones)
                              : msg.createDraftReplyAll('', opciones);
  return { id: draft.getId(), messageId: draft.getMessageId() };
}

/** Etiqueta un hilo, creando la etiqueta si hace falta. */
function etiquetarHilo(threadId, nombreEtiqueta) {
  const etiqueta = GmailApp.getUserLabelByName(nombreEtiqueta) ||
                   GmailApp.createLabel(nombreEtiqueta);
  GmailApp.getThreadById(threadId).addLabel(etiqueta);
  return { ok: true };
}

/**
 * Último mensaje de cada hilo cuyo asunto contenga el texto dado.
 * Lo usará el generador de borradores diarios (Fase 5).
 */
function ultimoMensajeConAsunto(texto, maxHilos) {
  const hilos = GmailApp.search('subject:' + texto, 0, maxHilos || 10);
  if (!hilos.length) return null;
  hilos.sort(function (a, b) { return b.getLastMessageDate() - a.getLastMessageDate(); });
  const hilo = hilos[0];
  const msgs = hilo.getMessages();
  const ultimo = msgs[msgs.length - 1];
  return {
    threadId:  hilo.getId(),
    messageId: ultimo.getId(),
    asunto:    ultimo.getSubject(),
    de:        ultimo.getFrom(),
    para:      ultimo.getTo(),
    fecha:     ultimo.getDate().toISOString(),
    cuerpo:    ultimo.getPlainBody().slice(0, 2000),
  };
}
