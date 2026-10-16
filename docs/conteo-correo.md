# Proceso: Conteo de correos por día

Cuenta cuántos correos llegaron (o se enviaron) cada día en la cuenta de Google
con la que se inició sesión, y lo exporta a Excel. Nació para medir el buzón de
**notificaciones judiciales**, al que no se le pueden instalar programas ni
correr Apps Script: basta con entrar a JuriTask con esa cuenta.

## Archivos

- `js/conteo-correo.js` → panel, conteo contra la Gmail API y exportación.
- `index.html` → botón de la barra superior (`#conteoCorreoBtn`).
- `js/commandpalette.js` → comando "Conteo de correos por día".

Reutiliza `_gmailFetch` y `_withGmailToken` de `js/gmail.js` (token y reintento
ante 401) y `xlsxDownload` de `js/xlsx.js`. No necesita scopes nuevos: el
`gmail.modify` que ya pide `js/firebase.js` alcanza para listar mensajes.

## Uso

1. Botón de la barra superior (sobre con barras) o la paleta de comandos.
2. El panel muestra **con qué cuenta** se va a contar. "Cambiar de cuenta"
   cierra la sesión de Google y abre el selector de cuentas
   (`prompt: select_account`).
3. Rango de fechas (por defecto, los últimos 30 días; máximo 366), qué contar
   (Recibidos / Enviados / Todos) y un filtro opcional con la misma sintaxis
   del buscador de Gmail.
4. "Contar" → tabla por día con total, promedio y día con más correos.
   "Descargar Excel" o "Copiar tabla" (con tabulaciones, para pegar en Excel).

Al terminar, conviene volver a la cuenta propia: la detección de trámites y la
bitácora de enviados leen el buzón de la cuenta conectada.

## Cómo cuenta

- **Días en hora local.** La búsqueda usa `after:`/`before:` con segundos Unix
  de la medianoche local. Con fechas `AAAA/MM/DD` Gmail usa la hora del
  Pacífico y los conteos se correrían unas horas.
- **Exacto, no estimado.** Una llamada a `messages.list` por día (500 por
  página) y se cuentan los ids.
  `resultSizeEstimate` no sirve: es una estimación.
- **Mensajes, no conversaciones.** Cada correo de un hilo suma.
- Recibidos = `-in:sent -in:draft -in:chats`. Spam y papelera quedan fuera
  salvo que se marque la casilla (`includeSpamTrash`).
- 4 llamadas en paralelo. Usa su propio `fetch` (`_conteoFetchConReintento`),
  no `_gmailFetch`: lee el cuerpo como texto porque Gmail a veces responde 200
  con el cuerpo vacío o cortado, y `res.json()` fallaba con *Unexpected end of
  JSON input*. Vacío = día sin correos; ilegible, 429, 5xx o fallo de red = se
  reintenta con espera creciente (hasta 5 intentos).
- Si un día falla del todo, los demás trabajadores paran, para que el mensaje
  de error no quede tapado por "Contando… día N de M".
- Se quitó `fields=` por precaución: es el sospechoso más probable de los
  cuerpos vacíos, y sin él la respuesta siempre trae `resultSizeEstimate`.

## Requisitos de Google

Los mismos de [gmail-integracion.md](gmail-integracion.md). Si la pantalla de
consentimiento está en **Testing**, la cuenta que se va a contar tiene que estar
agregada como **Test user**; si no, Google rechaza el inicio de sesión. Si la
cuenta es de Google Workspace, el administrador debe permitir el acceso de la
app.

## Al modificar

- `_conteoFetchConReintento` debe seguir lanzando `code: 401` cuando caduca el
  token: es lo que hace que `_withGmailToken` lo renueve.
- Nada aquí escribe en Gmail: solo lee.
