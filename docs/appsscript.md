# Proceso: Build y despliegue en Apps Script

Traduce el repo a la forma que exige un proyecto de Apps Script, sin tocar el
código fuente.

```bash
node tools/build.js      # genera build/
node test/sandbox.js     # prueba los riesgos del sandbox sobre lo generado
```

## Por qué hace falta un build

Un proyecto de Apps Script solo admite ficheros **`.gs` y `.html`**. No hay
`.js`, ni `.css`, ni binarios, ni carpetas. `tools/build.js` genera `build/`:

| Fuente | Destino | Cómo |
|---|---|---|
| `index.html` | `index.html` | los `<script src>` y el `<link rel=stylesheet>` pasan a `<?!= include('…') ?>` |
| `css/style.css` | `estilos.html` | envuelto en `<style>` |
| `js/ui.js` | `js_ui.html` | envuelto en `<script>`; los guiones del nombre pasan a `_` |
| `assets/logo/*.png` | — | incrustados como `data:` URI |
| — | `Codigo.gs` | `doGet()` + `include()` |
| — | `appsscript.json` | scopes, zona horaria, servicio avanzado de Gmail |

Salida actual: **22 ficheros, ~430 KB**.

### El detalle que muerde: `<?` dentro del código

`js/xlsx.js` genera XML y contiene seis `<?xml version="1.0" …?>`. Esa
secuencia es **el delimitador de scriptlet de Apps Script**.

No estalla porque `include()` usa `createHtmlOutputFromFile()`, que devuelve el
fichero tal cual sin evaluar scriptlets; solo `index.html` se procesa como
plantilla con `createTemplateFromFile()`. El build avisa cuando encuentra `<?`
en un módulo, precisamente para que nadie cambie ese `include()` a
`createTemplateFromFile` sin darse cuenta.

Por lo mismo, **`index.html` no puede contener `<?`** en ningún sitio.

### Lo que el build descarta

La PWA: `<link rel="manifest">`, `apple-touch-icon`, los `<meta>` de
`mobile-web-app-capable` y el registro del service worker. Apps Script no puede
servir el manifest en el ámbito correcto y un iframe cross-origin no registra
service workers. El **favicon** también se pierde en la práctica: la pestaña la
pinta el marco exterior de `script.google.com`, no tu documento.

## Los riesgos del sandbox, medidos

`/exec` no sirve tu HTML en su propio origen: devuelve una página de
`script.google.com` que mete tu documento en un **iframe anidado** de
`*.googleusercontent.com/userCodeAppPanel`, con atributo `sandbox`. Eso es lo
que puede romper descargas, impresión y popups.

`test/sandbox.js` reproduce esa topología con dos orígenes locales (dos puertos
⇒ dos orígenes para el navegador) y mide, en Chromium de verdad:

| Riesgo | Resultado | Consecuencia |
|---|---|---|
| **Descarga de Blob** con `<a download>` | ✅ funciona | `xlsx.js`, el CSV y `exportData()` se salvan. No hace falta el plan B de escribir en Drive |
| **`window.print()`** desde el iframe | ✅ no lanza, `beforeprint` llega | La paginación del reporte y todo el bloque `@media print` sobreviven |
| **`window.open(url, 'nombre')`** | ✅ reutiliza la pestaña | El punto 7 (buscar en Gmail) funciona como se diseñó: una sola pestaña que se re-busca |
| **Clipboard API** | ❌ `NotAllowedError` | Hay que pasar por `copyTextToClipboard()` (tramites.js), cuyo fallback con `execCommand` **sí** funciona |
| **`localStorage`** | ⚠️ depende | Ver abajo |

### El único cabo suelto: `allow-same-origin`

Sin ese flag el documento tiene **origen opaco** y `localStorage` lanza
`SecurityError` — la app ni siquiera arranca, porque `loadAll()` no puede leer.
Con el flag, todo pasa.

Desde aquí no se puede saber cuál de los dos usa Google, así que la prueba
**corre las dos variantes** y reporta ambas:

```
con allow-same-origin    7/7 riesgos despejados
sin allow-same-origin    5/7 riesgos despejados
```

**Cómo salir de dudas**: tras el primer despliegue, abrir el `/exec`, inspeccionar
el iframe `#userCodeAppPanel` en DevTools y leer su atributo `sandbox`.

Y en cualquier caso, esto **no bloquea la migración**: la Fase 3 mueve los datos
a un JSON de Drive, donde `localStorage` pasa a ser una caché opcional. Si
resulta que no está disponible, se pierde la caché local, no los datos. Por eso
todos los accesos a `localStorage` van dentro de `try/catch`.

## Despliegue

```bash
npm i -g @google/clasp
clasp login
clasp create --type webapp --title JuriTask --rootDir build
node tools/build.js
cd build && clasp push && clasp deploy
```

`appsscript.json` ya deja el web app como **"Ejecutar como: yo"** y
**"Quién tiene acceso: solo yo"**, y declara los scopes:

| Scope | Para qué |
|---|---|
| `gmail.modify` | leer, crear borradores y etiquetar hilos |
| `drive.file` | el JSON de datos (Fase 3) y los adjuntos |
| `script.external_request` | llamar a Gemini con `UrlFetchApp` |
| `script.scriptapp` | crear los triggers |
| `script.send_mail` | el correo-resumen diario |

`gmail.modify` es un scope **restringido**: en Workspace puede requerir que el
administrador apruebe el client ID del proyecto.

## Al modificar

- `build/` es **generado**: no lo edites. Está fuera de git (`.gitignore`).
- Si añades un módulo a `index.html`, el build lo recoge solo: el orden de los
  `<script src>` es el que manda.
- Si un módulo nuevo necesita `<?` en su código, asegúrate de que se incluye con
  `include()` y no como plantilla.
