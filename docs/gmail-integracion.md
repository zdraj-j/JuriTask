# Proceso: Integración con el correo (Gmail / Google Workspace)

Permite que JuriTask lea el correo del usuario (con su permiso) para **detectar
trámites nuevos** y **resumir lo que pasa en cada trámite**, más **contactos
externos**. Todo ocurre en el navegador; no hay backend.

## Archivos

- `js/gmail.js` → acceso a la Gmail API (token, búsqueda, parseo), panel de
  detección de trámites nuevos, y bitácora por trámite.
- `js/gemini.js` → cliente mínimo de la API de Gemini (resumen y contactos).
- `js/ui.js` → sección "Bitácora del correo" en el detalle (`buildDetailContent`
  / `bindDetailContent`).
- `js/config.js` + `index.html` → campo en Ajustes para la API key de Gemini y
  botón "Revisar correo" en la barra superior.

## Fase 1 — Detección de trámites nuevos (sin IA)

1. Botón ✉️ en la barra → `runGmailScan`.
2. `_ensureGmailToken` pide un token con scope `gmail.readonly` (popup de Google,
   reutiliza `reauthenticateWithPopup`, conserva también `drive.file`).
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

## Fase 2 y 3 — Bitácora + contactos externos (con Gemini)

- En el detalle de cada trámite, "Actualizar desde el correo" →
  `refreshTramiteBitacora`:
  1. `fetchEmailsForTramite` busca en Gmail por número y radicado (`newer_than:1y`).
  2. `geminiGenerateJSON` con `_buildBitacoraPrompt` → `{ resumen, eventos,
     contactos }`.
  3. `_filtrarContactosExternos` descarta internos (dominio
     `comfenalcovalle.com.co`) y `Garcés Lloreda`.
  4. Se guarda en el trámite (`emailResumen`, `emailEventos`, `emailContactos`,
     `emailBitacoraAt`) y se renderiza con `renderBitacoraIn`.

## Configuración en Google (requisito del usuario)

1. **Google Cloud Console** (proyecto de la app): habilitar **Gmail API** y añadir
   el scope `gmail.readonly` a la pantalla de consentimiento OAuth.
2. **Verificación**: no es obligatoria para uso personal. Opciones:
   - Consentimiento en **"Testing"** + agregarse como **Test user** (aparece un
     aviso de "app no verificada" que se puede omitir; la sesión caduca a los 7
     días y se vuelve a autorizar con el popup).
   - Consentimiento **"Internal"** (sin aviso ni caducidad) — sólo si el proyecto
     vive en un **Google Workspace que el usuario administra**.
3. **API key de Gemini** (Google AI Studio): se pega en Ajustes; se guarda en el
   Firestore privado del usuario, **nunca en el repositorio**.

## Seguridad de la API key (importante)

Una app sin backend no puede ocultar un secreto: la key viaja al navegador. Por eso:

- La key **no** está en el repo; vive en `STATE.config.geminiApiKey` (Firestore).
- **Restringir la key en Google Cloud**: aplicación → *HTTP referrers*
  (`https://zdraj-j.github.io/*`) y API → sólo *Generative Language API*.
- Mejora futura opcional: proxy en Firebase Functions que guarde la key en el
  servidor (requiere plan Blaze).

## Al modificar

- Los correos de notificación tienen formato fijo (tabla HTML con etiquetas);
  el parseo depende de esas etiquetas. Si cambia el formato, ajustar los regex
  en `parseTramiteEmail`.
- El token de Gmail se cachea en memoria (`AUTH._gmailAccessToken`) y se renueva
  ante un 401 (`_withGmailToken`).
- Gemini se llama con `responseMimeType: application/json`; si la respuesta no es
  JSON, `geminiGenerateJSON` intenta rescatar el primer objeto `{...}`.
