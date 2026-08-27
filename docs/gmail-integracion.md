# Proceso: Integración con el correo (Gmail / Google Workspace)

Permite que JuriTask lea el correo del usuario (con su permiso) para **detectar
trámites nuevos** y **redactar los borradores de requerimiento**. Todo ocurre en
el navegador; no hay backend.

## Archivos

- `js/gmail.js` → acceso a la Gmail API (token, búsqueda, parseo) y panel de
  detección de trámites nuevos. `fetchEmailsForTramite()` y `_extractRadicado()`
  son la puerta de entrada al hilo de un trámite, y las consume `borradores.js`.
- `js/gemini.js` → cliente mínimo de la API de Gemini.
- `js/config.js` + `index.html` → campo en Ajustes para la API key de Gemini y
  botón "Revisar correo" en la barra superior.

## Detección de trámites nuevos (sin IA)

1. Botón ✉️ en la barra → `runGmailScan`.
2. `_ensureGmailToken` delega en `ensureGoogleToken()`, que saca el token de
   la sesión de Google (ver [google-auth.md](google-auth.md)). Si caducó, abre
   el popup para renovarlo sin cerrar la sesión.
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
    pestaña, y marca el botón con un badge + aviso. Solo usa Gmail API (gratis);
    Gemini se llama al pulsar "Generar". Requiere que el permiso de Gmail ya se
    haya concedido en la sesión (el popup necesita un gesto del usuario, por lo
    que la primera revisión ocurre tras usar el correo una vez).
    No hay push real: sin backend Gmail no puede avisar con la app cerrada.
- `crearTareaRequerimiento` (tramites.js) crea además "Solicitar fecha de
  inicio" a 2 días en CNT, OS y CNV.

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
   `STATE.config`, **nunca en el repositorio**.

## Seguridad de la API key (importante)

Una app sin backend no puede ocultar un secreto: la key viaja al navegador. Por eso:

- La key **no** está en el repo; vive en `STATE.config.geminiApiKey`.
- **Restringir la key en Google Cloud**: aplicación → *HTTP referrers*
  (`https://zdraj-j.github.io/*`) y API → sólo *Generative Language API*.
- **No tiene arreglo limpio sin backend.** Llegó a resolverse moviéndola a
  Script Properties de Apps Script, pero ese camino se cerró
  ([README.md](README.md)). Mientras la app sea solo cliente, la restricción de
  la key en Google Cloud es la única defensa real: consérvala puesta.

## Al modificar

- Los correos de notificación tienen formato fijo (tabla HTML con etiquetas);
  el parseo depende de esas etiquetas. Si cambia el formato, ajustar los regex
  en `parseTramiteEmail`.
- El token se cachea en `GOOGLE.accessToken` y se invalida ante un 401
  (`_withGmailToken` → `resetGoogleToken()`).
- Gemini se llama con `responseMimeType: application/json`; si la respuesta no es
  JSON, `geminiGenerateJSON` intenta rescatar el primer objeto `{...}`.
