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

// Simulación de `google.script.run`: un Datos.gs de mentira, en memoria, con
// la misma forma de API (handlers encadenados, sin promesas). Sirve para
// ejercitar el camino "con servidor" —que es el que no se puede probar de otra
// manera sin desplegar— y comprobar el ciclo completo guardar/leer.
const FAKE_SERVER = `<script>
(function () {
  // Respaldado en sessionStorage: el Drive de verdad no se borra al recargar,
  // y sin esto la comprobación 8 mediría el reinicio del falso, no la app.
  var CLAVE = '__jt_fake_drive';
  var almacen;
  try { almacen = JSON.parse(sessionStorage.getItem(CLAVE)) || null; } catch (e) { almacen = null; }
  if (!almacen) almacen = { datos: '', backups: [] };
  function persistir() {
    try { sessionStorage.setItem(CLAVE, JSON.stringify(almacen)); } catch (e) {}
  }
  var metodos = {
    getEstado:        function () { return almacen.datos; },
    guardarEstado:    function (json) {
      JSON.parse(json);                        // igual que el servidor real
      almacen.datos = json; persistir();
      return { ok: true, guardadoEn: new Date().toISOString(), bytes: json.length };
    },
    estadoDelAlmacen: function () {
      return { existe: !!almacen.datos, bytes: almacen.datos.length,
               modificado: new Date().toISOString(), ultimoGuardado: '',
               carpetaUrl: 'https://drive.google.com/drive/folders/falsa' };
    },
    crearBackup:      function () {
      var b = { id: 'b' + almacen.backups.length, nombre: 'juritask-backup.json',
                bytes: almacen.datos.length, creadoEn: new Date().toISOString(),
                contenido: almacen.datos };
      almacen.backups.unshift(b); persistir(); return b;
    },
    listarBackups:    function () { return almacen.backups.map(function (b) {
                        return { id: b.id, nombre: b.nombre, bytes: b.bytes, creadoEn: b.creadoEn }; }); },
    leerBackup:       function (id) {
      var b = almacen.backups.filter(function (x) { return x.id === id; })[0];
      if (!b) throw new Error('no existe'); return b.contenido;
    },
    borrarBackup:     function (id) {
      almacen.backups = almacen.backups.filter(function (x) { return x.id !== id; });
      persistir(); return { ok: true };
    },
    getOAuthToken:    function () { return 'token-de-mentira'; },
    // Fase 4: Gemini y Gmail desde el servidor.
    hayGeminiKey:     function () { return !!almacen.geminiKey; },
    guardarGeminiKey: function (k) {
      almacen.geminiKey = String(k || '').trim(); persistir();
      return { ok: true, configurada: !!almacen.geminiKey };
    },
    geminiGenerar:    function (prompt, json) {
      if (!almacen.geminiKey) throw new Error('Falta la API key de Gemini. Configúrala en Ajustes.');
      return json ? '{"ok":true}' : 'texto generado';
    },
    gmailApi:         function (path) {
      // Devuelve la misma forma que la Gmail API, como cadena.
      if (path.indexOf('messages?') === 0) return JSON.stringify({ messages: [{ id: 'm1' }] });
      if (path.indexOf('messages/') === 0) return JSON.stringify({
        id: 'm1', threadId: 't1',
        payload: { headers: [{ name: 'Subject', value: 'Notificación de trámite 55555' }],
                   mimeType: 'text/plain', body: { data: '' } },
      });
      return JSON.stringify({ messages: [] });
    },
  };
  function runner(onOk, onErr) {
    var api = {
      withSuccessHandler: function (f) { return runner(f, onErr); },
      withFailureHandler: function (f) { return runner(onOk, f); },
    };
    Object.keys(metodos).forEach(function (nombre) {
      api[nombre] = function () {
        var args = Array.prototype.slice.call(arguments);
        // Asíncrono, como el de verdad.
        setTimeout(function () {
          try { var r = metodos[nombre].apply(null, args); if (onOk) onOk(r); }
          catch (e) { if (onErr) onErr(e); }
        }, 5);
      };
    });
    return api;
  }
  window.google = { script: { run: runner(null, null) } };
  window.__almacen = almacen;
})();
</script>`;

// ── Servidor "interior": el html generado por el build ──────────────────────
function servedIndex(conServidor) {
  // `include()` del servidor de Apps Script, resuelto aquí en Node.
  let html = fs.readFileSync(path.join(BUILD, 'index.html'), 'utf8')
    .replace(/<\?!= include\('([\w]+)'\) \?>/g,
             (_, n) => fs.readFileSync(path.join(BUILD, `${n}.html`), 'utf8'))
    // Sin red, `icons.js` necesita un lucide de mentira.
    .replace('<script>', '<script>window.lucide={createIcons(){}};</script>\n<script>');
  if (conServidor) html = html.replace('</head>', FAKE_SERVER + '\n</head>');
  return html;
}

let CON_SERVIDOR = false;

const sandbox = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(servedIndex(CON_SERVIDOR));
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

/**
 * Escenario "con servidor": mismo sandbox, pero con `google.script.run`
 * simulado. Comprueba el ciclo que la Fase 3 introduce y que no se puede
 * probar de otra forma sin desplegar.
 */
async function correrConServidor(browser) {
  CON_SERVIDOR = true;
  SANDBOX = VARIANTES[0].attr;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.route('**', r =>
    r.request().url().startsWith('http://localhost:81') ? r.continue() : r.abort());

  await page.addInitScript(() => {
    try {
      localStorage.setItem('juritask_tramites', JSON.stringify([
        { id:'s1', numero:'90001', descripcion:'Sembrado en local', modulo:'CNT',
          tipo:'propio', terminado:false, gestion:{}, seguimiento:[] },
      ]));
      localStorage.setItem('juritask_order', JSON.stringify(['s1']));
    } catch (_) {}
  });

  await page.goto(`http://localhost:${PORT_TOP}/`, { waitUntil: 'load' });
  const fr = () => page.frames().find(f => f.url().includes(`:${PORT_SANDBOX}`));
  const frame = page.frameLocator('#userCodeAppPanel');
  await page.waitForTimeout(1800);   // margen para el sync inicial

  const out = [];

  // 6. El backend se detecta y siembra Drive con lo local (primer arranque).
  // `const BACKEND` vive en el ámbito léxico global, no en `window`: lo que se
  // comprueba es el efecto observable —que el estado llegó al servidor—.
  const sembrado = await fr().evaluate(() => {
    const d = window.__almacen.datos;
    return { enviado: !!d, tramites: d ? JSON.parse(d).tramites.length : 0 };
  });
  out.push(['6. detecta el servidor y siembra Drive',
            sembrado.enviado && sembrado.tramites === 1,
            `trámites en Drive=${sembrado.tramites}`]);

  // 7. Un cambio en la UI llega a Drive tras el debounce.
  await frame.locator('#newTramiteBtn').click();
  await page.waitForTimeout(400);
  await frame.locator('#fNumero').fill('77777');
  await frame.locator('#fDescripcion').fill('Creado con servidor');
  await frame.locator('#saveTramite').click();
  await page.waitForTimeout(3200);   // debounce de 2,5 s + margen
  const trasCrear = await fr().evaluate(() =>
    JSON.parse(window.__almacen.datos || '{}').tramites.map(t => t.numero));
  out.push(['7. el cambio sube a Drive tras el debounce',
            trasCrear.includes('77777'), `en Drive: ${trasCrear.join(', ')}`]);

  // 8. Al recargar, Drive manda sobre la caché local. `addInitScript` vuelve a
  //    sembrar 1 trámite en local, así que si acaban saliendo 2 es porque los
  //    trajo el servidor.
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2000);
  const trasRecarga = await frame.locator('#tramiteList .tramite-card').count();
  out.push(['8. al recargar, Drive gana a la caché local', trasRecarga === 2,
            `tarjetas tras recargar=${trasRecarga}`]);

  // 9. Backups: la sección aparece y el ciclo crear/listar funciona.
  await frame.locator('.nav-item[data-view="config"]').click();
  await page.waitForTimeout(900);
  const seccionVisible = await fr().evaluate(() => {
    const s = document.getElementById('backupSection');
    return !!(s && s.offsetParent !== null);
  });
  await frame.locator('#backupNowBtn').click();
  await page.waitForTimeout(1200);
  const backups = await fr().evaluate(() => ({
    enServidor: window.__almacen.backups.length,
    enLista: document.querySelectorAll('#backupList .backup-row').length,
  }));
  out.push(['9. backups en Drive: sección, crear y listar',
            seccionVisible && backups.enServidor === 1 && backups.enLista === 1,
            `sección=${seccionVisible ? 'visible' : 'oculta'} servidor=${backups.enServidor} lista=${backups.enLista}`]);

  // 10. El token OAuth ya sale del servidor, sin popup.
  const token = await fr().evaluate(async () => {
    resetGoogleToken();
    return await ensureGoogleToken();
  });
  out.push(['10. el token OAuth viene del servidor', token === 'token-de-mentira',
            token ? `token="${token}"` : 'null']);

  // 11. Gemini: la clave se guarda en el servidor y nunca vuelve al cliente.
  await frame.locator('#geminiApiKey').fill('AIzaClaveDePrueba');
  await frame.locator('#saveGeminiKeyBtn').click();
  await page.waitForTimeout(900);
  const gem = await fr().evaluate(() => ({
    enServidor: window.__almacen.geminiKey || '',
    enInput:    document.getElementById('geminiApiKey').value,
    enEstado:   (document.getElementById('geminiEstado') || {}).textContent || '',
    enDatos:    (window.__almacen.datos || '').includes('AIzaClaveDePrueba'),
  }));
  out.push(['11. la clave de Gemini vive solo en el servidor',
            gem.enServidor === 'AIzaClaveDePrueba' && gem.enInput === '' && !gem.enDatos,
            `servidor=sí input="${gem.enInput}" en el JSON de datos=${gem.enDatos ? 'SÍ (mal)' : 'no'}`]);

  // 12. Gmail: el transporte va por el servidor, sin token en el cliente.
  const gmail = await fr().evaluate(async () => {
    try {
      const data = await _gmailFetch('messages?maxResults=1&q=x');
      const msg  = await _getMessage('m1');
      return { ok: true, ids: (data.messages || []).length, asunto: _headerValue(msg.payload, 'Subject') };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });
  out.push(['12. Gmail responde a través del servidor',
            gmail.ok && gmail.ids === 1 && /55555/.test(gmail.asunto),
            gmail.ok ? `mensajes=${gmail.ids} asunto="${gmail.asunto}"` : gmail.error]);

  console.log('\n══ Variante: con servidor simulado (google.script.run) ══\n');
  for (const [name, pass, detail] of out) {
    console.log(`[${ok(pass)}] ${name.padEnd(42)} ${detail}`);
  }
  const real = errors.filter(e => !/Failed to load resource|net::ERR|ERR_FAILED/i.test(e));
  if (real.length) console.log('\n   errores de página:\n   ' + real.join('\n   '));

  await ctx.close();
  CON_SERVIDOR = false;
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
  resultados.push([{ nombre: 'con servidor simulado' }, await correrConServidor(browser)]);

  console.log('\n══ RESUMEN ══');
  for (const [v, out] of resultados) {
    const f = out.filter(o => !o[1]).length;
    console.log(`  ${v.nombre.padEnd(24)} ${out.length - f}/${out.length} comprobaciones`);
  }
  await browser.close();
  top.close(); sandbox.close();
  // Bloquean la variante buena del sandbox y el escenario con servidor; la
  // variante sin allow-same-origin es informativa.
  const criticos = resultados[0][1].concat(resultados[2][1]).filter(o => !o[1]).length;
  process.exit(criticos ? 1 : 0);
})();
