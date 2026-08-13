# Proceso: Integración con el correo (Gmail / Google Workspace)

Permite que JuriTask lea el correo para **detectar trámites nuevos** y
**redactar los borradores de requerimiento**.

Desde la Fase 4 el acceso a Gmail y a Gemini pasa por el **servidor de Apps
Script**. El servidor hace de *transporte*: devuelve las respuestas de la Gmail
API tal cual, y el parseo sigue en el cliente, que es donde está probado.

## Archivos

- `server/Correo.gs` → `gmailApi()` (proxy de la Gmail API),
  `crearBorradorRespuesta()`, `etiquetarHilo()`, `ultimoMensajeConAsunto()`.
- `server/Gemini.gs` → la llamada a Gemini y **la clave**, en Script Properties.
- `js/gmail.js` → búsqueda y parseo, y el panel de detección.
  `fetchEmailsForTramite()` y `_extractRadicado()` son la puerta de entrada al
  hilo de un trámite, y las consume `borradores.js`.
- `js/gemini.js` → fachada delgada sobre `server/Gemini.gs`.
- `js/config.js` + `index.html` → campo en Ajustes para la clave de Gemini y
  botón "Revisar correo" en la barra superior.

## Detección de trámites nuevos (sin IA)

1. Botón ✉️ en la barra → `runGmailScan`.
2. `_conGmail()` comprueba que hay servidor y `_gmailFetch(path)` llama a
   `gmailApi` en el servidor, que responde con el mismo JSON que devolvía
   `fetch`. El token no viaja al navegador.
3. `scanTramiteEmails` busca los correos de "Notificación de trámite"
   (`GMAIL_QUERY`) y `parseTramiteEmail` extrae por etiquetas de texto:
   - **número** = campo `Trámite:` (5–6 dígitos). Fallback: radicado.
   - **módulo** = prefijo del radicado; alias en `MODULO_PREFIX_ALIAS`
     (p. ej. `OTRD → OTR`). Si no existe en `STATE.config.modulos`, queda vacío.
   - **descripción** = resumen + `[radicado]`.
   - **vencimiento** = `DD/MM/YYYY → YYYY-MM-DD`.
   - **responsable** = emparejado con abogados/equipo (`_matchAbogado`).
4. Se descartan los que ya existen (por `numero`) y se abre el panel de revisión;
   "Revisar y crear" abre el modal de nuevo trámite **prellenado**.

### Detecciones conservadas durante la sesión

Leer el correo es lento (una llamada por mensaje), así que el resultado se
guarda en memoria (`_gmailDetections`, `_gmailScanAt`):

- Volver a pulsar ✉️ **no vuelve a buscar** si aún quedan detecciones sin crear:
  reabre el panel con las que faltan. Para releer el correo está "Buscar de
  nuevo" dentro del panel (`runGmailScan(btn, { force: true })`).
- "Revisar y crear" solo **oculta** el panel y marca `_gmailReopen`. Al cerrarse
  el modal —se haya guardado o cancelado— `closeModal()` (ui.js) llama a
  `_gmailOnModalClosed()`, que lo reabre con las detecciones restantes.
- `_gmailPendientes()` = `_filterNuevos(_gmailDetections)`, de modo que lo ya
  creado o descartado desaparece solo.
- El botón ✉️ muestra un badge (`#scanMailBadge`) con cuántas quedan por revisar.

La caché es **de sesión**: al recargar la app se pierde y la siguiente revisión
vuelve a consultar Gmail. Lo descartado sí es permanente
(`config.gmailDescartados`).

## Borradores de correo y bitácora de envíos

- `js/plantillas-correo.js` guarda el conocimiento del dominio:
  - `FAMILIA_MODULO`: contractual (CNT, OTR, OS, CNV), concepto (COT, ET, MIN),
    peticion (ROD), audiencia (CPJ). El resto no tiene flujo estandarizado.
    En la familia concepto el 1er requerimiento pide conformidad y los
    siguientes informan el cierre por falta de respuesta.
  - `_contraerArticulos`: al sustituir `{DOC}` corrige "a el"→"al" y
    "de el"→"del" (p. ej. "respecto al contrato").
  - `DOC_MODULO`: cómo se nombra el documento en cada módulo.
  - `SIN_POLIZAS` (CNV, ET, MIN) y `APLICA_FECHA_INICIO` (CNT, OS, CNV — no OTR).
  - `PLANTILLAS_CORREO`: los textos institucionales (1er/2do/3er/último
    requerimiento, conformidad y cierre de concepto, petición, acta de
    audiencia, reiteración de solicitud, fecha de inicio).
  - `tipoGestionDesdeTarea(texto)`: deduce la gestión del texto de la tarea
    ("1er req", "reiterar sol", "acta", "req"…).
- `js/borradores.js`:
  - **Borrador por tarea** (icono ✉️ en cada tarea que sea un requerimiento):
    lee el hilo del trámite, y Gemini adapta la plantilla al último estado del
    hilo (no vuelve a pedir lo ya recibido). Modal con Para/Asunto/Cuerpo,
    copiar y "Abrir en Gmail". Nunca envía por su cuenta.
    En "reiterar sol", si el área ya respondió, avisa y no genera el borrador.
  - **Bitácora de envíos** (botón 📄 en la barra): busca `in:sent`, empareja el
    número de trámite del asunto con trámites activos y genera la anotación en
    lenguaje neutro para pegar en el aplicativo de la empresa. Si el correo
    responde a un tercero, resume ambos ("El contratista solicita X, por tanto
    se le remite Y"). Los ya copiados/omitidos se recuerdan en
    `config.bitacoraRegistrados`.
  - **Vigilancia automática**: con JuriTask abierto, `startBitacoraWatcher`
    revisa los enviados cada N minutos (config, 10 por defecto) y al volver a la
    pestaña, y marca el botón con un badge + aviso.
    Para lo que sí funciona **con la app cerrada**, ver
    [borradores-automaticos.md](borradores-automaticos.md).
- `crearTareaRequerimiento` (tramites.js) crea además "Solicitar fecha de
  inicio" a 2 días en CNT, OS y CNV.

## Abrir el trámite en Gmail

El reporte del día lleva en cada ítem un botón que busca ese trámite en Gmail
(`gmailBuscarBtn` / `abrirEnGmail`). La consulta combina número y radicado.

Un sitio web **no puede** tomar el control de una pestaña que abrió el usuario;
los navegadores no lo permiten. Lo que sí se puede es **nombrar** la ventana al
abrirla: `window.open(url, 'juritaskGmail')`. El primer clic abre Gmail, y los
siguientes navegan esa misma pestaña en vez de acumular. Verificado dentro del
sandbox de Apps Script (ver [appsscript.md](appsscript.md#los-riesgos-del-sandbox-medidos)).

`config.gmailCuentaIndice` decide el `/mail/u/N`: con varias sesiones de Google
abiertas, `u/0` no es necesariamente la del trabajo.

## Configuración en Google (requisito del usuario)

1. **Google Cloud Console** (proyecto de la app): habilitar **Gmail API** y añadir
   el scope `gmail.readonly` a la pantalla de consentimiento OAuth.
2. **Verificación**: no es obligatoria para uso personal. Opciones:
   - Consentimiento en **"Testing"** + agregarse como **Test user** (aparece un
     aviso de "app no verificada" que se puede omitir; la sesión caduca a los 7
     días y se vuelve a autorizar con el popup).
   - Consentimiento **"Internal"** (sin aviso ni caducidad) — sólo si el proyecto
     vive en un **Google Workspace que el usuario administra**.
3. **API key de Gemini** (Google AI Studio): se pega en Ajustes y se guarda en
   **Script Properties del servidor**. Nunca en el repositorio, nunca en el
   navegador, nunca en el JSON de Drive.

## Seguridad de la API key

Resuelto. Antes la app no tenía backend y la key viajaba al navegador; ahora
vive en `PropertiesService.getScriptProperties()` y las llamadas salen de
`UrlFetchApp`.

- Ajustes **nunca muestra** la clave: solo dice si está configurada. Al
  guardarla, el campo se vacía.
- Si quedaba un `config.geminiApiKey` de la versión anterior,
  `_migrarClaveGemini()` (storage.js) lo borra del estado al cargar, para que
  el secreto deje de replicarse en cada guardado. Hay que volver a pegarla una
  vez en Ajustes.
- Sigue siendo buena idea restringir la key en Google Cloud a la
  *Generative Language API*.

## Al modificar

- Los correos de notificación tienen formato fijo (tabla HTML con etiquetas);
  el parseo depende de esas etiquetas. Si cambia el formato, ajustar los regex
  en `parseTramiteEmail`.
- Ya no hay token que renovar en el cliente: el servidor está autorizado de
  forma permanente. `_conGmail()` sustituyó a `_withGmailToken()` y solo
  traduce el error a un mensaje legible.
- Gemini se llama con `responseMimeType: application/json`; si la respuesta no es
  JSON, `geminiGenerateJSON` intenta rescatar el primer objeto `{...}`.
