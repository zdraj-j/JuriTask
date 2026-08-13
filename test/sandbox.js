/**
 * JuriTask — prueba de los riesgos del sandbox de Apps Script.
 *
 *   node tools/build.js && node test/sandbox.js
 *
 * Un web app de Apps Script no se sirve en su propio origen: `/exec` devuelve
 * una página en `script.google.com` que a su vez mete TU html en un iframe
 * anidado de `*.googleusercontent.com/userCodeAppPanel`, con atributo
 * `sandbox`. Eso es lo que rompe descargas, impresión y popups.
 *
 * Aquí se reproduce esa topología con dos orígenes locales (dos puertos ⇒ dos
 * orígenes distintos para el navegador) y el mismo `sandbox` que usa Google,
 * para responder con hechos —no con suposiciones— a las tres preguntas que
 * bloquean la migración. Ver `docs/appsscript.md`.
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT  = path.resolve(__dirname, '..');
const BUILD = path.join(ROOT, 'build');
const SHOT  = process.env.JT_SHOTS || require('os').tmpdir();

const PORT_TOP    = 8110;   // hace de script.google.com
const PORT_SANDBOX = 8111;  // hace de *.googleusercontent.com

// No se puede inspeccionar desde aquí el atributo exacto que pone Google, y la
// diferencia es decisiva: sin `allow-same-origin` el documento tiene un origen
// opaco y `localStorage` lanza SecurityError. Así que se prueban las dos
// variantes y se reportan ambas; en el despliegue real basta mirar el atributo
// del iframe #userCodeAppPanel con DevTools para saber cuál aplica.
const BASE_SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups ' +
                     'allow-popups-to-escape-sandbox allow-downloads';
const VARIANTES = [
  { nombre: 'con allow-same-origin', attr: BASE_SANDBOX + ' allow-same-origin' },
  { nombre: 'sin allow-same-origin', attr: BASE_SANDBOX },
];
let SANDBOX = VARIANTES[0].attr;

const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png' };

// ── Servidor "exterior": la página de script.google.com ─────────────────────
const top = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<!doctype html><meta charset="utf-8"><title>userCodeAppPanel</title>
<style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%}</style>
<iframe id="userCodeAppPanel" sandbox="${SANDBOX}"
        src="http://localhost:${PORT_SANDBOX}/index.html"></iframe>`);
});

// ── Servidor "interior": el html generado por el build ──────────────────────
function servedIndex() {
  // `include()` del servidor de Apps Script, resuelto aquí en Node.
  return fs.readFileSync(path.join(BUILD, 'index.html'), 'utf8')
    .replace(/<\?!= include\('([\w]+)'\) \?>/g,
             (_, n) => fs.readFileSync(path.join(BUILD, `${n}.html`), 'utf8'))
    // Sin red, `icons.js` necesita un lucide de mentira.
    .replace('<script>', '<script>window.lucide={createIcons(){}};</script>\n<script>');
}

const sandbox = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(servedIndex());
  }
  const file = path.join(ROOT, url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end('x'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const ok = c => c ? 'PASA' : 'FALLA';

async function correr(variante, browser) {
  SANDBOX = variante.attr;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();

  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.route('**', r => {
    const u = r.request().url();
    return u.startsWith('http://localhost:81') ? r.continue() : r.abort();
  });

  await page.addInitScript(() => {
    try {
      localStorage.setItem('juritask_tramites', JSON.stringify([
        { id:'s1', numero:'90001', descripcion:'Trámite en sandbox', modulo:'CNT',
          tipo:'propio', fechaVencimiento:'2026-08-20', gestion:{}, terminado:false,
          seguimiento:[{ descripcion:'1er req', fecha:'2026-08-14', estado:'pendiente',
                         responsable:'yo', attachments:[] }] },
      ]));
      localStorage.setItem('juritask_order', JSON.stringify(['s1']));
      localStorage.setItem('juritask_config', JSON.stringify({ detailMode:'expand', theme:'claro' }));
      window.__lsOK = true;
    } catch (e) { window.__lsError = String(e); }
  });

  await page.goto(`http://localhost:${PORT_TOP}/`, { waitUntil: 'load' });
  const frame = page.frameLocator('#userCodeAppPanel');
  const fr = () => page.frames().find(f => f.url().includes(`:${PORT_SANDBOX}`));
  await page.waitForTimeout(1500);

  const out = [];

  // ── 0. ¿Arranca siquiera dentro del sandbox? ──────────────────────────────
  const cards = await frame.locator('#tramiteList .tramite-card').count().catch(() => -1);
  out.push(['0. la app arranca dentro del iframe', cards === 1, `tarjetas=${cards}`]);

  // ── 1. localStorage en iframe de tercero ──────────────────────────────────
  const ls = await fr().evaluate(() => {
    try {
      localStorage.setItem('__probe', '1');
      const v = localStorage.getItem('__probe');
      localStorage.removeItem('__probe');
      return { ok: v === '1', tramites: JSON.parse(localStorage.getItem('juritask_tramites') || '[]').length };
    } catch (e) { return { ok: false, error: String(e) }; }
  });
  out.push(['1. localStorage escribe y lee', ls.ok === true,
            ls.ok ? `trámites sembrados=${ls.tramites}` : (ls.error || 'bloqueado')]);

  // ── 2. Descarga de un Blob (xlsx.js, exportData, captura PNG) ─────────────
  let dl = null, dlErr = '';
  try {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 8000 }),
      fr().evaluate(() => {
        const blob = new Blob(['prueba'], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'sandbox-prueba.bin';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }),
    ]);
    dl = await download.suggestedFilename();
  } catch (e) { dlErr = e.message.split('\n')[0]; }
  out.push(['2. descarga de Blob con <a download>', !!dl, dl || `bloqueada (${dlErr})`]);

  // ── 3. window.print() desde el iframe anidado ─────────────────────────────
  const printed = await fr().evaluate(() => new Promise(resolve => {
    let llamado = false;
    const orig = window.print;
    // Chromium headless no abre diálogo: lo que se comprueba es que la llamada
    // no lance por el sandbox y que el evento beforeprint llegue al documento.
    window.addEventListener('beforeprint', () => { llamado = true; });
    try { window.print(); } catch (e) { return resolve({ ok: false, error: String(e) }); }
    window.print = orig;
    setTimeout(() => resolve({ ok: true, beforeprint: llamado }), 400);
  }));
  out.push(['3. window.print() no lanza en el sandbox', printed.ok === true,
            printed.ok ? `beforeprint=${printed.beforeprint}` : printed.error]);

  // ── 4. window.open con nombre: ¿reutiliza la misma pestaña? ───────────────
  const popups = [];
  ctx.on('page', p => popups.push(p));
  const abierto = await fr().evaluate(() => {
    const w = window.open('about:blank#uno', 'juritaskGmail');
    return !!w;
  });
  await page.waitForTimeout(600);
  const tras1 = popups.length;
  await fr().evaluate(() => { window.open('about:blank#dos', 'juritaskGmail'); });
  await page.waitForTimeout(600);
  const tras2 = popups.length;
  out.push(['4a. window.open abre pestaña', abierto && tras1 === 1, `popups=${tras1}`]);
  out.push(['4b. el nombre reutiliza la pestaña', tras2 === tras1,
            `tras 1er clic=${tras1}, tras 2º=${tras2}`]);

  // ── 5. Portapapeles: API nativa y fallback de execCommand ─────────────────
  const clip = await fr().evaluate(async () => {
    const r = { api: false, fallback: false, apiError: '' };
    try { await navigator.clipboard.writeText('x'); r.api = true; }
    catch (e) { r.apiError = (e && e.name) || 'error'; }
    try {
      const ta = document.createElement('textarea');
      ta.value = 'x'; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      r.fallback = document.execCommand('copy');
      ta.remove();
    } catch (_) {}
    return r;
  });
  out.push(['5. portapapeles (API o fallback)', clip.api || clip.fallback,
            `API=${clip.api ? 'sí' : 'no (' + clip.apiError + ')'} · execCommand=${clip.fallback ? 'sí' : 'no'}`]);

  await page.screenshot({ path: path.join(SHOT, `sandbox-${variante.nombre.includes('sin') ? 'sin' : 'con'}-same-origin.png`) });

  console.log(`\n══ Variante: ${variante.nombre} ══`);
  console.log(`   sandbox="${SANDBOX}"\n`);
  for (const [name, pass, detail] of out) {
    console.log(`[${ok(pass)}] ${name.padEnd(42)} ${detail}`);
  }
  const real = errors.filter(e => !/Failed to load resource|net::ERR|ERR_FAILED/i.test(e));
  if (real.length) console.log('\n   errores de página:\n   ' + real.join('\n   '));

  await ctx.close();
  return out;
}

(async () => {
  if (!fs.existsSync(path.join(BUILD, 'index.html'))) {
    console.error('Falta build/. Ejecuta primero: node tools/build.js');
    process.exit(2);
  }
  await new Promise(r => top.listen(PORT_TOP, r));
  await new Promise(r => sandbox.listen(PORT_SANDBOX, r));

  const browser = await chromium.launch();
  console.log('=== RIESGOS DEL SANDBOX DE APPS SCRIPT ===');
  const resultados = [];
  for (const v of VARIANTES) resultados.push([v, await correr(v, browser)]);

  console.log('\n══ RESUMEN ══');
  for (const [v, out] of resultados) {
    const f = out.filter(o => !o[1]).length;
    console.log(`  ${v.nombre.padEnd(24)} ${out.length - f}/${out.length} riesgos despejados`);
  }
  await browser.close();
  top.close(); sandbox.close();
  // Solo bloquea la migración que falle la variante buena.
  process.exit(resultados[0][1].filter(o => !o[1]).length ? 1 : 0);
})();
