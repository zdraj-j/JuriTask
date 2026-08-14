/**
 * JuriTask — prueba de humo en navegador real.
 *
 *   node test/smoke.js         # sale 0 si todo pasa, 1 si algo falla
 *   JT_SHOTS=/ruta node test/smoke.js   # dónde dejar las capturas
 *
 * Requiere Playwright con Chromium. Ver `docs/pruebas.md` para el porqué de
 * cada retoque al HTML servido.
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHOT = process.env.JT_SHOTS || require('os').tmpdir();
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml' };

// Ya no hay módulos que exijan un backend: la app entera arranca en local.
const DROP = [];

function localIndex() {
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  html = html.replace(/<script src="https:\/\/[^"]*"><\/script>\s*/g, '');
  for (const f of DROP) html = html.replace(new RegExp(`<script src="${f}"></script>\\s*`), '');
  // El service worker se registra y dispara location.reload() en
  // `controllerchange`, recargando a mitad de prueba. Fuera.
  html = html.replace(/<!-- 10\. PWA: registrar service worker -->[\s\S]*?<\/script>/, '');
  // Sin CDN, `icons.js` necesita un lucide de mentira.
  return html.replace('<script src="js/storage.js"></script>',
    '<script>window.lucide={createIcons(){}};</script>\n<script src="js/storage.js"></script>');
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
    // Fecha pasada a propósito: así el trámite sale en la agenda y en el
    // reporte del día, que es donde vive el botón de buscar en Gmail.
    seguimiento:[{ descripcion:'1er req', fecha:'2020-01-01', estado:'pendiente', responsable:'yo', attachments:[] }] },
  { id:'t2', numero:'22222', descripcion:'Trámite terminado de prueba', modulo:'OTR',
    tipo:'propio', fechaVencimiento:'2026-07-01', gestion:{ analisis:true, cumplimiento:true },
    terminado:true, terminadoEn:new Date().toISOString(), seguimiento:[] },
];

const ok = (c) => c ? 'PASA' : 'FALLA';

(async () => {
  await new Promise(r => server.listen(8099, r));
  const browser = await chromium.launch(
    process.env.JT_CHROME ? { executablePath: process.env.JT_CHROME } : {}
  );
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
  await page.waitForTimeout(900);

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

  // ── Amputación: no queda rastro de sesión ni de equipos ─
  const authLeftovers = await page.evaluate(() => [
    'authScreen','waitScreen','splashScreen','notifPanel','notifBtn','userAvatarBtn',
    'profileOverlay','editProfileOverlay','logoutBtn','filterScope','repScope',
  ].filter(id => document.getElementById(id)));
  out.push(['AMP sin UI de sesión', authLeftovers.length === 0,
            authLeftovers.length ? authLeftovers.join(', ') : 'ninguno']);

  // Sin servidor no hay dónde guardar backups: la sección debe quedar oculta.
  await page.click('.nav-item[data-view="config"]');
  await page.waitForTimeout(500);
  const backupVisible = await page.evaluate(() => {
    const s = document.getElementById('backupSection');
    return !!(s && s.offsetParent !== null);
  });
  out.push(['AMP backups ocultos sin servidor', backupVisible === false,
            backupVisible ? 'visible (no debería)' : 'oculta']);
  await page.click('.nav-item[data-view="all"]');
  await page.waitForTimeout(400);
  const globals = await page.evaluate(() =>
    ['firebase','AUTH','db','auth'].filter(g => g in window));
  out.push(['AMP sin globals de Firebase', globals.length === 0,
            globals.length ? globals.join(', ') : 'ninguno']);

  // ── Crear un trámite (saveTramite cambió bastante) ──────
  await page.click('#newTramiteBtn');
  await page.waitForTimeout(500);
  await page.fill('#fNumero', '33333');
  await page.fill('#fDescripcion', 'Trámite creado por la prueba');
  await page.selectOption('#fModulo', 'CNT');
  await page.click('#saveTramite');
  await page.waitForTimeout(800);
  const creado = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('juritask_tramites')).find(x => x.numero === '33333'));
  out.push(['CRUD crea trámite propio, sin campos de equipo',
            !!creado && creado.tipo === 'propio' && !('sharedWith' in creado) &&
            !('_scope' in creado) && !('createdBy' in creado),
            creado ? `tipo=${creado.tipo} claves=${Object.keys(creado).length}` : '(no se creó)']);

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
  // 3 = los dos sembrados (t2 reactivado) + el creado por la prueba.
  out.push(['P3 vuelve a la lista activa', activeAfter === 3, `activas=${activeAfter}`]);

  // ── Panel: KPIs sobre STATE, sin usuarios ni equipos ────
  await page.click('.nav-item[data-view="dashboard"]');
  await page.waitForTimeout(700);
  const kpis = await page.$$eval('#dashKpiGrid .dash-kpi', els => els.map(e => ({
    label: e.querySelector('.dash-kpi-label')?.textContent.trim(),
    value: e.querySelector('.dash-kpi-value')?.textContent.trim(),
  })));
  out.push(['PANEL 5 KPIs y ninguno de usuarios', kpis.length === 5 &&
            !kpis.some(k => /Usuario|Equipo|Compartido|Pendiente/i.test(k.label)),
            kpis.map(k => `${k.label}=${k.value}`).join(', ')]);
  // Tras reactivar t2 y crear el de la prueba: 3 activos, 0 terminados.
  const kpiMap = Object.fromEntries(kpis.map(k => [k.label, k.value]));
  out.push(['PANEL KPIs cuadran con el estado',
            kpiMap['Trámites activos'] === '3' && kpiMap['Terminados'] === '0',
            `activos=${kpiMap['Trámites activos']} terminados=${kpiMap['Terminados']}`]);
  const metricCards = await page.$$eval('#dashMetricsRow .dash-metric-card', e => e.length);
  const vencRows = await page.$$eval('#dashVencidosBody tr', els => els.length);
  out.push(['PANEL métricas y tabla de vencidos', metricCards === 3 && vencRows >= 1,
            `tarjetas=${metricCards} filas=${vencRows}`]);
  await page.screenshot({ path: path.join(SHOT, 'panel.png') });

  // ── Punto 6: botones del reporte del día ────────────────
  await page.click('.nav-item[data-view="all"]');
  await page.waitForTimeout(400);
  await page.click('#reportBtn');
  await page.waitForTimeout(700);
  const rb = await page.$$eval('#reportOverlay .modal-header-actions button', els =>
    els.map(e => e.textContent.trim() || e.id).filter(Boolean));
  out.push(['P6 sin Imprimir ni Copiar', !rb.some(b => /Imprimir|Copiar/i.test(b)), rb.join(' | ')]);
  out.push(['P6 conserva Captura y Panel lateral',
            rb.some(b => /Captura/i.test(b)) && rb.some(b => /Panel lateral/i.test(b)), rb.join(' | ')]);

  // ── Punto 7: buscar el trámite en Gmail ─────────────────
  // Es puro cliente: funciona sin servidor. Se comprueba que el botón está y
  // que `window.open` recibe el nombre de ventana, que es lo que hace que la
  // pestaña se reutilice en vez de acumularse.
  const gm = await page.evaluate(() => {
    const btn = document.querySelector('#reportContent .gmail-open-btn');
    if (!btn) return { hay: false };
    const llamadas = [];
    const orig = window.open;
    window.open = (url, name) => { llamadas.push({ url, name }); return {}; };
    btn.click();
    window.open = orig;
    return { hay: true, llamadas };
  });
  out.push(['P7 botón de Gmail con ventana nombrada',
            gm.hay && gm.llamadas.length === 1 &&
            gm.llamadas[0].name === 'juritaskGmail' &&
            /mail\.google\.com.*#search/.test(gm.llamadas[0].url),
            gm.hay ? `name="${gm.llamadas[0]?.name}" url=${(gm.llamadas[0]?.url || '').slice(0, 60)}…`
                   : 'no se pintó el botón']);

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
