/**
 * JuriTask — build para Apps Script.
 *
 *   node tools/build.js        # genera build/
 *   clasp push                 # desde build/
 *
 * Un proyecto de Apps Script solo admite ficheros `.gs` y `.html`: no hay
 * `.js`, ni `.css`, ni binarios, ni carpetas. Este script traduce el repo a esa
 * forma sin tocar el código fuente, que sigue siendo el de siempre.
 *
 * Ver `docs/appsscript.md` para el porqué de cada transformación.
 */
const fs   = require('fs');
const path = require('path');

const ROOT  = path.resolve(__dirname, '..');
const OUT   = path.join(ROOT, 'build');
const rd    = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const wr    = (f, c) => fs.writeFileSync(path.join(OUT, f), c, 'utf8');

// Assets que se incrustan como data: URI. Apps Script no sirve binarios.
const ASSETS = ['assets/logo/logo.png', 'assets/logo/favicon.png'];

const MIME = { '.png': 'image/png', '.svg': 'image/svg+xml' };

function dataUri(rel) {
  const buf = fs.readFileSync(path.join(ROOT, rel));
  return `data:${MIME[path.extname(rel)]};base64,${buf.toString('base64')}`;
}

// ── Preparar salida ─────────────────────────────────────────────────────────
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// ── 1. index.html → plantilla con scriptlets ────────────────────────────────
let html = rd('index.html');
const incluidos = [];

// El orden de los <script src="js/…"> es significativo: se conserva tal cual.
html = html.replace(/[ \t]*<script src="js\/([\w-]+)\.js"><\/script>\n?/g, (_, name) => {
  const file = `js_${name.replace(/-/g, '_')}`;
  incluidos.push({ file, src: `js/${name}.js` });
  return `<?!= include('${file}') ?>\n`;
});

html = html.replace(/[ \t]*<link rel="stylesheet" href="css\/style\.css" \/>\n?/,
                    `<?!= include('estilos') ?>\n`);

// PWA: no aplica. Apps Script no puede servir el manifest en el ámbito
// correcto y un iframe cross-origin no registra service workers.
html = html.replace(/[ \t]*<!-- PWA -->\n/, '');
html = html.replace(/[ \t]*<link rel="manifest"[^>]*>\n?/, '');
html = html.replace(/[ \t]*<link rel="apple-touch-icon"[^>]*>\n?/, '');
html = html.replace(/[ \t]*<meta name="(mobile-web-app-capable|apple-mobile-web-app-[\w-]+)"[^>]*>\n?/g, '');
html = html.replace(/<!-- \d+\. PWA: registrar service worker -->[\s\S]*?<\/script>\n?/, '');

// Assets incrustados.
for (const a of ASSETS) {
  html = html.split(a).join(dataUri(a));
}

// `HtmlService` envuelve el contenido: fuera <!DOCTYPE>, <html>, <head>, <body>
// no hacen falta, pero tampoco estorban. Se conservan para que el mismo
// fichero siga abriéndose en local durante el desarrollo.
wr('index.html', html);

// ── 2. CSS y JS envueltos ───────────────────────────────────────────────────
wr('estilos.html', `<style>\n${rd('css/style.css')}\n</style>\n`);

for (const { file, src } of incluidos) {
  const code = rd(src);
  // `include()` usa `createHtmlOutputFromFile`, que NO evalúa scriptlets, así
  // que un `<?xml … ?>` dentro del código (xlsx.js) viaja intacto. Aun así se
  // avisa, porque mover esto a `createTemplateFromFile` los rompería.
  if (code.includes('<?')) {
    console.warn(`  aviso: ${src} contiene "<?" — no incluir con createTemplateFromFile`);
  }
  if (code.includes('</script')) {
    throw new Error(`${src} contiene "</script": rompería el envoltorio`);
  }
  wr(`${file}.html`, `<script>\n${code}\n</script>\n`);
}

// ── 3. Código de servidor ───────────────────────────────────────────────────
wr('Codigo.gs', `/**
 * JuriTask — punto de entrada de la web app.
 *
 * Generado por tools/build.js. No editar aquí: los cambios se pierden en el
 * siguiente build.
 */

function doGet() {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('JuriTask')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/**
 * Inserta un fichero .html del proyecto sin evaluar sus scriptlets.
 * Es lo que permite que el código con "<?xml …?>" (xlsx.js) viaje intacto.
 */
function include(nombre) {
  return HtmlService.createHtmlOutputFromFile(nombre).getContent();
}
`);

// ── 4. Manifiesto ───────────────────────────────────────────────────────────
wr('appsscript.json', JSON.stringify({
  timeZone: 'America/Bogota',
  runtimeVersion: 'V8',
  exceptionLogging: 'STACKDRIVER',
  oauthScopes: [
    'https://www.googleapis.com/auth/gmail.modify',       // leer + crear borradores + etiquetar
    'https://www.googleapis.com/auth/drive.file',         // el JSON de datos y los adjuntos
    'https://www.googleapis.com/auth/script.external_request', // Gemini
    'https://www.googleapis.com/auth/script.scriptapp',    // triggers
    'https://www.googleapis.com/auth/script.send_mail',    // correo-resumen diario
  ],
  webapp: { executeAs: 'USER_DEPLOYING', access: 'MYSELF' },
  dependencies: {
    enabledAdvancedServices: [
      { userSymbol: 'Gmail', serviceId: 'gmail', version: 'v1' },
    ],
  },
}, null, 2) + '\n');

// ── Resumen ─────────────────────────────────────────────────────────────────
const files = fs.readdirSync(OUT);
const bytes = files.reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0);
console.log(`build/  ${files.length} ficheros, ${(bytes / 1024).toFixed(0)} KB`);
console.log(`  ${incluidos.length} módulos JS + estilos.html + Codigo.gs + appsscript.json`);
