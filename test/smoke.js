/**
 * JuriTask — prueba de humo en navegador real.
 *
 *   node test/smoke.js         # sale 0 si todo pasa, 1 si algo falla
 *   JT_SHOTS=/ruta node test/smoke.js   # dónde dejar las capturas
 *
 * Requiere Playwright con Chromium. Sirve `index.html` en "modo local":
 * sin los SDK de Firebase ni los módulos que dependen de ellos.
 * Ver `docs/pruebas.md` para el porqué de cada retoque al HTML servido.
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHOT = process.env.JT_SHOTS || require('os').tmpdir();
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml' };

// Módulos que exigen Firebase cargado; en modo local no se incluyen.
const DROP = ['js/firebase.js', 'js/auth.js', 'js/dashboard.js', 'js/notifications.js'];

function localIndex() {
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  html = html.replace(/<script src="https:\/\/[^"]*"><\/script>\s*/g, '');
  for (const f of DROP) html = html.replace(new RegExp(`<script src="${f}"></script>\\s*`), '');
  // El service worker se registra y dispara location.reload() en
  // `controllerchange`, recargando a mitad de prueba. Fuera.
  html = html.replace(/<!-- 10\. PWA: registrar service worker -->[\s\S]*?<\/script>/, '');
  // `ui.js` usa `AUTH?.userProfile?.uid`: como propiedad de window sí resuelve.
  return html.replace('<script src="js/storage.js"></script>',
    '<script>window.AUTH={userProfile:null};window.lucide={createIcons(){}};</script>\n<script src="js/storage.js"></script>');
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(localIndex());
  }
  const file = path.join(ROOT, url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('nope');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const TRAMITES = [
  { id:'t1', numero:'11111', descripcion:'Trámite activo de prueba', modulo:'CNT',
    tipo:'propio', fechaVencimiento:'2026-08-20', gestion:{}, terminado:false,
    seguimiento:[{ descripcion:'1er req', fecha:'2026-08-14', estado:'pendiente', responsable:'yo', attachments:[] }] },
  { id:'t2', numero:'22222', descripcion:'Trámite terminado de prueba', modulo:'OTR',
    tipo:'propio', fechaVencimiento:'2026-07-01', gestion:{ analisis:true, cumplimiento:true },
    terminado:true, terminadoEn:new Date().toISOString(), seguimiento:[] },
];

const ok = (c) => c ? 'PASA' : 'FALLA';

(async () => {
  await new Promise(r => server.listen(8099, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.route('**', r =>
    r.request().url().startsWith('http://localhost:8099') ? r.continue() : r.abort());

  await page.addInitScript(([tramites]) => {
    localStorage.setItem('juritask_tramites', JSON.stringify(tramites));
    localStorage.setItem('juritask_order', JSON.stringify(['t1','t2']));
    localStorage.setItem('juritask_config', JSON.stringify({ detailMode:'expand', theme:'claro' }));
  }, [TRAMITES]);

  await page.goto('http://localhost:8099/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(800);
  // En modo local nadie destapa la app: sólo lo hace firebase.js tras el login.
  await page.evaluate(() => {
    document.getElementById('splashScreen')?.remove();
    document.getElementById('authScreen')?.remove();
    const app = document.getElementById('appContainer');
    if (app) app.style.display = '';
  });
  await page.waitForTimeout(400);

  const out = [];

  // ── Punto 1: menú y vistas ──────────────────────────────
  const nav = await page.$$eval('.nav-item', els =>
    els.filter(e => e.offsetParent !== null).map(e => e.textContent.trim().replace(/\s+/g,' ')));
  const views = await page.$$eval('.view', els => els.map(e => e.id));
  out.push(['P1 menú sin Hoy/Calendario', !nav.some(n => /Hoy|Calendario/i.test(n)), nav.join(' | ')]);
  out.push(['P1 vistas sin today/calendar', !views.some(v => /today|calendar/.test(v)), views.join(' ')]);

  await page.waitForSelector('#tramiteList .tramite-card', { state: 'visible', timeout: 10000 });
  const cards = await page.$$eval('#tramiteList .tramite-card', e => e.length);
  out.push(['P1 la app renderiza tarjetas', cards === 1, `activas=${cards}`]);

  // ── Punto 5: un solo botón "Nueva tarea" al expandir ────
  await page.click('#tramiteList .tramite-card .card-desc');
  await page.waitForTimeout(600);
  const nt = await page.$$eval('.card-wrapper button', els =>
    els.filter(e => e.offsetParent !== null && /Nueva tarea/i.test(e.textContent)).length);
  const acts = await page.$$eval('.expand-act-btns .btn-icon', e => e.length);
  out.push(['P5 un solo botón Nueva tarea', nt === 1, `visibles=${nt}`]);
  out.push(['P5 acciones de expandir intactas', acts === 4, `botones=${acts} (dup/edit/del/close)`]);

  const emptyVisible = await page.$$eval('.card-actions-row', els =>
    els.filter(e => e.children.length === 0 && e.offsetParent !== null).length);
  out.push(['P5 fila vacía oculta con :empty', emptyVisible === 0, `franjas visibles=${emptyVisible}`]);

  // ── Punto 3: reactivar un terminado ─────────────────────
  await page.click('.nav-item[data-view="finished"]');
  await page.waitForTimeout(400);
  const fin = await page.$$eval('#finishedList .tramite-card', e => e.length);
  const reBtn = await page.$$eval('.btn-card-reactivar', els =>
    els.filter(e => e.offsetParent !== null).length);
  out.push(['P3 botón Reactivar visible', fin === 1 && reBtn === 1, `terminados=${fin} botones=${reBtn}`]);

  await page.click('#finishedList .btn-card-reactivar');
  await page.waitForTimeout(400);
  await page.click('#confirmOk');
  await page.waitForTimeout(500);
  const toast = await page.evaluate(() => {
    const el = document.getElementById('toast');
    return el && el.classList.contains('show')
      ? { text: el.querySelector('span')?.textContent || '', action: el.querySelector('.toast-action')?.textContent || '' }
      : null;
  });
  const finAfter = await page.$$eval('#finishedList .tramite-card', e => e.length);
  const st = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('juritask_tramites')).find(x => x.id === 't2'));
  out.push(['P3 sale de Terminados', finAfter === 0, `quedan=${finAfter}`]);
  out.push(['P3 persiste terminado=false', st.terminado === false && st.terminadoEn === null,
            `terminado=${st.terminado} terminadoEn=${st.terminadoEn}`]);

  out.push(['P3 toast con Deshacer', !!toast && /Deshacer/.test(toast.action),
            toast ? `"${toast.text}" [${toast.action}]` : '(sin toast)']);

  await page.click('.nav-item[data-view="all"]');
  await page.waitForTimeout(400);
  const activeAfter = await page.$$eval('#tramiteList .tramite-card', e => e.length);
  out.push(['P3 vuelve a la lista activa', activeAfter === 2, `activas=${activeAfter}`]);

  // ── Punto 6: botones del reporte del día ────────────────
  await page.click('#reportBtn');
  await page.waitForTimeout(700);
  const rb = await page.$$eval('#reportOverlay .modal-header-actions button', els =>
    els.map(e => e.textContent.trim() || e.id).filter(Boolean));
  out.push(['P6 sin Imprimir ni Copiar', !rb.some(b => /Imprimir|Copiar/i.test(b)), rb.join(' | ')]);
  out.push(['P6 conserva Captura y Panel lateral',
            rb.some(b => /Captura/i.test(b)) && rb.some(b => /Panel lateral/i.test(b)), rb.join(' | ')]);

  await page.screenshot({ path: path.join(SHOT, 'reporte-dia.png') });
  await page.click('#reportClose');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOT, 'lista.png') });

  console.log('\n=== RESULTADOS ===');
  for (const [name, pass, detail] of out) {
    console.log(`[${ok(pass)}] ${name.padEnd(38)} ${detail}`);
  }
  const failed = out.filter(o => !o[1]).length;
  console.log(`\n${out.length - failed}/${out.length} comprobaciones pasan`);

  const real = errors.filter(e => !/Failed to load resource|net::ERR|ERR_FAILED/i.test(e));
  console.log('\n=== ERRORES DE PÁGINA ===');
  console.log(real.length ? real.join('\n') : '(ninguno)');

  await browser.close();
  server.close();
  process.exit(failed || real.length ? 1 : 0);
})();
