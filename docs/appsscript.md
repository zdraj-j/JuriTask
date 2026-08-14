# Proceso: Build y despliegue en Apps Script

Traduce el repo a la forma que exige un proyecto de Apps Script, sin tocar el
código fuente.

```bash
node tools/build.js         # genera build/
node tools/enlazar.js ID    # escribe el .clasp.json (una sola vez)
node test/sandbox.js        # prueba el sandbox y el ciclo con servidor simulado
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
| `server/*.gs` | `Codigo.gs`, `Datos.gs`, `Correo.gs`, `Gemini.gs`, `Triggers.gs` | copiados tal cual: son fuente, no generados |
| `js/plantillas-correo.js` | `Plantillas.gs` | **compartido**: JS puro, lo usan cliente y servidor. El build verifica que no toque el DOM |
| — | `appsscript.json` | scopes, zona horaria, servicio avanzado de Gmail |

Salida actual: del orden de **24 ficheros y ~450 KB**; el build lo
imprime al terminar.

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

Y en cualquier caso, **ya no bloquea**: desde la Fase 3 los datos viven en un
JSON de Drive y `localStorage` es solo caché ([datos-drive.md](datos-drive.md)).
Si no está disponible se pierde la caché, no los datos — la app arranca más
lenta, pero arranca. Por eso todos los accesos van dentro de `try/catch`.

## Despliegue

### 1. Preparativos

- Activar la Apps Script API en
  <https://script.google.com/home/usersettings>. Sin eso `clasp push` falla con
  un error poco claro sobre credenciales.
- `npm i -g @google/clasp` y `clasp login`.

En **Windows**, si PowerShell responde *"la ejecución de scripts está
deshabilitada"* al llamar a `npm`, usar **CMD**: ahí npm resuelve a `npm.cmd` y
no topa con la política de ejecución. No hace falta cambiar nada del sistema.

### 2. Crear el proyecto y enlazarlo

**No uses `clasp create`.** Solo funciona en clasp 2.x; en las versiones nuevas
devuelve `Invalid container file type` **y deja un `.clasp.json` vacío**, que a
partir de ahí hace fallar *todos* los comandos —incluido `clasp login`— con
`JSON5: invalid end of input at 1:1`, un mensaje que no insinúa cuál es el
problema.

En su lugar:

1. Crear un proyecto en <https://script.google.com/home/projects/create>.
2. Copiar el **ID de la secuencia de comandos** desde ⚙️ *Configuración del
   proyecto*.
3. Enlazarlo:

```bash
node tools/enlazar.js EL_ID_COPIADO
```

`tools/enlazar.js` escribe el `.clasp.json`, detecta y reemplaza uno vacío o
corrupto, y acepta también la URL del proyecto en vez del ID. Existe porque
este fichero es donde más se tropieza: hacerlo a mano con el Bloc de notas en
Windows puede guardarlo vacío, con extensión `.txt` o con un BOM que rompe el
parseo.

El fichero es solo esto, por si hace falta escribirlo a mano:

```json
{"scriptId": "EL_ID_COPIADO", "rootDir": "build"}
```

`rootDir` es lo que hace que `clasp push` suba el contenido de `build/`
ejecutándose **desde la raíz**, no desde `build/`.

### 3. Subir

```bash
node tools/build.js
clasp push
```

### 4. Autorizar y desplegar

Este paso **se hace en el navegador**, no en la terminal. `clasp open` y
`clasp deploy` son otros dos subcomandos renombrados en clasp 3.x (ahora
`open-script`, `create-deployment`, `list-deployments`), y además la primera
autorización exige pasar por el diálogo de permisos de Google de todas formas.

1. Abrir `https://script.google.com/home/projects/EL_ID/edit`.
2. Elegir cualquier función —por ejemplo `estadoDelAlmacen`— y **Ejecutar**.
   Google pedirá los permisos; en un proyecto sin verificar hay que entrar por
   *Configuración avanzada → Ir a JuriTask (no seguro)*. **Sin ese paso el web
   app responde con un error de permisos.**
3. *Implementar → Nueva implementación → Aplicación web*, con
   **Ejecutar como: Yo** y **Acceso: Solo yo**. Eso da la URL `/exec`.

En cada cambio posterior: `node tools/build.js && clasp push`, y en el editor
*Implementar → Gestionar implementaciones → ✏️ → Versión: Nueva*. Así la URL
`/exec` no cambia.

`appsscript.json` ya deja el web app como **"Ejecutar como: yo"** y
**"Quién tiene acceso: solo yo"**, y declara los scopes:

| Scope | Para qué |
|---|---|
| `gmail.modify` | leer, crear borradores y etiquetar hilos |
| `drive.file` | el JSON de datos y los backups ([datos-drive.md](datos-drive.md)) |
| `script.external_request` | llamar a Gemini y a la Gmail API con `UrlFetchApp` |
| `script.scriptapp` | crear los triggers |
| `script.send_mail` | el correo-resumen diario |

`gmail.modify` es un scope **restringido**: en Workspace puede requerir que el
administrador apruebe el client ID del proyecto.

`drive.file` es deliberadamente estrecho: solo alcanza lo que el script crea.
Eso obliga a `Datos.gs` a hablar con la **API REST de Drive** en vez de con
`DriveApp`, que exige el scope `drive` completo — ver
[datos-drive.md](datos-drive.md#por-qué-no-se-usa-driveapp).

### Por qué se declaran los servicios avanzados de Gmail y Drive

`enabledAdvancedServices` incluye Gmail y Drive aunque el código **no** use
`Gmail.Users.*` ni `Drive.Files.*`: `Correo.gs` y `Datos.gs` llaman por REST con
`UrlFetchApp`. La declaración está para que Apps Script **habilite esas APIs en
el proyecto de Cloud** asociado al script, que es lo que exige la llamada REST.

Si aun así devuelven un 403 diciendo que la API no está habilitada para el
proyecto, hay que abrirlo desde *Configuración del proyecto → Proyecto de Google
Cloud* y activarla a mano.

## Al modificar

- `build/` es **generado**: no lo edites. Está fuera de git (`.gitignore`).
- Si añades un módulo a `index.html`, el build lo recoge solo: el orden de los
  `<script src>` es el que manda.
- Si un módulo nuevo necesita `<?` en su código, asegúrate de que se incluye con
  `include()` y no como plantilla.
