/**
 * JuriTask — prueba del archivo de datos.
 *
 * Sustituye a `test/firestore.js`: la base de datos dejó de ser Firestore y
 * pasó a ser un JSON del disco (`js/archivo.js`). Lo que se ejercita aquí es
 * exactamente lo que antes se ejercitaba allí —quién gana al cargar, qué se
 * escribe, qué NO se escribe— contra una File System Access API de mentira,
 * sin tocar el disco de verdad.
 *
 *   node test/archivo.js
 *   JT_CHROME=/ruta/al/chrome node test/archivo.js
 */
const { chromium } = require('playwright');
const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8124;
const TIPOS = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
                '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml' };

// ============================================================
// LA API DE MENTIRA
// ============================================================
// Un sistema de archivos en memoria con la forma de la File System Access API:
// `showDirectoryPicker`, handles de directorio y de archivo, `createWritable`.
// `window.__fsa` deja el contenido a la vista de la prueba.
//
// `_idbGuardar` y `_idbLeer` se sustituyen por una variable: IndexedDB no puede
// guardar un objeto con funciones (falla el clonado estructurado), así que sin
// esto no se podría probar la reconexión entre arranques.
const FAKE_FSA = `<script>
(function () {
  // El "disco" se guarda en localStorage y se rehidrata en cada carga. Sin eso
  // el archivo desaparecería en cada \`reload()\` y no se podría probar lo más
  // importante: qué pasa **entre** dos arranques de la app.
  const CLAVE_DISCO = '__fsa_disk';
  let FS;
  try { FS = JSON.parse(localStorage.getItem(CLAVE_DISCO)); } catch (_) { FS = null; }
  if (!FS) FS = { archivos: {}, dirs: { '': true }, reloj: 1000, pickerLlamado: 0, permiso: 'granted' };
  window.__fsa = FS;

  function persistir() {
    try { localStorage.setItem(CLAVE_DISCO, JSON.stringify({ archivos: FS.archivos, dirs: FS.dirs, reloj: FS.reloj, permiso: FS.permiso })); }
    catch (_) {}
  }
  window.__fsaPersistir = persistir;

  function noExiste() { const e = new Error('NotFound'); e.name = 'NotFoundError'; return e; }

  function fileHandle(ruta, nombre) {
    return {
      kind: 'file', name: nombre,
      async getFile() {
        const f = FS.archivos[ruta];
        return { text: async () => f.texto, lastModified: f.lastModified, size: f.texto.length };
      },
      async createWritable() {
        let buf = '';
        return {
          write: async d => { buf += d; },
          close: async () => { FS.archivos[ruta] = { texto: buf, lastModified: ++FS.reloj }; persistir(); },
        };
      },
    };
  }

  function dirHandle(prefijo, nombre) {
    return {
      kind: 'directory', name: nombre,
      queryPermission:   async () => FS.permiso,
      requestPermission: async () => (FS.permiso = 'granted'),
      async getFileHandle(n, opts) {
        const ruta = prefijo + n;
        if (!FS.archivos[ruta]) {
          if (!opts || !opts.create) throw noExiste();
          FS.archivos[ruta] = { texto: '', lastModified: ++FS.reloj };
          persistir();
        }
        return fileHandle(ruta, n);
      },
      async getDirectoryHandle(n, opts) {
        const sub = prefijo + n + '/';
        if (!FS.dirs[sub]) {
          if (!opts || !opts.create) throw noExiste();
          FS.dirs[sub] = true;
          persistir();
        }
        return dirHandle(sub, n);
      },
      async removeEntry(n) { delete FS.archivos[prefijo + n]; persistir(); },
      entries() {
        const propias = Object.keys(FS.archivos)
          .filter(k => k.startsWith(prefijo) && k.slice(prefijo.length).indexOf('/') === -1);
        let i = 0;
        return { [Symbol.asyncIterator]() { return this; },
                 async next() {
                   if (i >= propias.length) return { done: true };
                   const k = propias[i++];
                   return { done: false, value: [k.slice(prefijo.length), fileHandle(k, k.slice(prefijo.length))] };
                 } };
      },
    };
  }

  window.__raizFSA = () => dirHandle('', 'Datos');
  window.showDirectoryPicker = async () => {
    FS.pickerLlamado++;
    if (FS.abortarPicker) { const e = new Error('abort'); e.name = 'AbortError'; throw e; }
    return window.__raizFSA();
  };
})();
</script>`;

// Firebase, reducido a lo que hoy usa js/firebase.js: solo Auth.
const FAKE_FIREBASE = `<script>
(function () {
  let usuario = null;
  const oyentes = [];
  window.firebase = {
    initializeApp() {},
    auth: Object.assign(() => ({
      get currentUser() { return usuario; },
      onAuthStateChanged(cb) { oyentes.push(cb); setTimeout(() => cb(usuario), 0); },
      signInWithPopup: async () => {
        usuario = { uid: 'u1', email: 'yo@ejemplo.com', displayName: 'Yo', photoURL: '' };
        oyentes.forEach(cb => setTimeout(() => cb(usuario), 0));
        return { credential: { accessToken: 'token-de-mentira' } };
      },
      signOut: async () => { usuario = null; oyentes.forEach(cb => setTimeout(() => cb(null), 0)); },
    }), {
      GoogleAuthProvider: function () { this.addScope = () => {}; this.setCustomParameters = () => {}; },
    }),
  };
})();
</script>`;

// El handle vive en una variable del navegador en vez de en IndexedDB.
const FAKE_IDB = `<script>
(function () {
  // IndexedDB no puede guardar un objeto con funciones (falla el clonado
  // estructurado), así que el handle no se guarda: se guarda **la marca** de que
  // hubo carpeta, y al leer se reconstruye desde el sistema de archivos falso.
  // Es justo lo que hace el navegador de verdad al recordar una carpeta.
  const CLAVE = '__fsa_carpeta';
  window.__idbTiene  = () => !!localStorage.getItem(CLAVE);
  window._idbGuardar = async () => { localStorage.setItem(CLAVE, '1'); };
  window._idbLeer    = async () => (localStorage.getItem(CLAVE) ? window.__raizFSA() : null);
  window._idbOlvidar = async () => { localStorage.removeItem(CLAVE); };
})();
</script>`;

function localIndex() {
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  html = html.replace(/<script src="https:\/\/[^"]*"><\/script>\s*/g, '');
  html = html.replace(/<!--[^>]*PWA: registrar service worker[^>]*-->[\s\S]*?<\/script>/, '');
  html = html.replace('<script src="js/storage.js"></script>',
    `<script>window.lucide={createIcons(){}};</script>\n${FAKE_FSA}\n<script src="js/storage.js"></script>`);
  html = html.replace('<script src="js/firebase.js"></script>',
    `${FAKE_FIREBASE}\n<script src="js/firebase.js"></script>`);
  // Después de archivo.js: sustituye las funciones que ese módulo declara.
  return html.replace('<script src="js/copias.js"></script>',
    `<script src="js/copias.js"></script>\n${FAKE_IDB}`);
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(localIndex());
  }
  const file = path.join(ROOT, decodeURIComponent(url));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('no');
  }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

/**
 * `page.evaluate` corre en un mundo aislado: ve el DOM, pero no los globals de
 * la página. `addScriptTag` sí ejecuta en el mundo principal, así que el
 * resultado se devuelve por un nodo del DOM, que es lo único que comparten.
 */
async function enPagina(page, codigo) {
  await page.addScriptTag({ content: `
    (function () {
      var r;
      try { r = (function () { ${codigo} })(); }
      catch (e) { r = { __error: String(e && e.message || e) }; }
      var el = document.getElementById('__salida');
      if (!el) { el = document.createElement('div'); el.id = '__salida'; el.style.display = 'none'; document.body.appendChild(el); }
      if (r && typeof r.then === 'function') {
        el.textContent = '"__pendiente"';
        r.then(function (v) { el.textContent = JSON.stringify(v === undefined ? null : v); },
               function (e) { el.textContent = JSON.stringify({ __error: String(e && e.message || e) }); });
      } else {
        el.textContent = JSON.stringify(r === undefined ? null : r);
      }
    })();
  ` });
  for (let i = 0; i < 100; i++) {
    const crudo = await page.$eval('#__salida', e => e.textContent);
    const r = JSON.parse(crudo);
    if (r === '__pendiente') { await page.waitForTimeout(50); continue; }
    if (r && r.__error) throw new Error('en la página: ' + r.__error);
    return r;
  }
  throw new Error('la promesa en la página no resolvió');
}

/**
 * Deja unos trámites en la caché local **y** en STATE.
 *
 * Las dos cosas, y no solo `localStorage`: la app tiene un `beforeunload` que
 * vuelca STATE sobre la caché, así que escribir solo en `localStorage` y
 * recargar no siembra nada — lo pisa el volcado de salida con el STATE vacío
 * de la página que se está yendo.
 */
async function sembrarCache(page, tramites, desdePendiente) {
  const marca = desdePendiente
    ? `localStorage.setItem('juritask_pendiente', JSON.stringify({ desde: '${desdePendiente}' }));`
    : `localStorage.removeItem('juritask_pendiente');`;
  await enPagina(page, `
    STATE.tramites = ${JSON.stringify(tramites)};
    STATE.tramites.forEach(migrateTramite);
    localStorage.setItem('juritask_tramites', JSON.stringify(STATE.tramites));
    ${marca}
    return null;
  `);
}

const TRAMITE = (id, numero) => ({
  id, numero, descripcion: 'Prueba ' + numero, tipo: 'propio', modulo: 'ACT',
  fechaVencimiento: '2030-01-01', terminado: false, terminadoEn: null,
  gestion: { analisis: false, cumplimiento: false },
  seguimiento: [], notas: [], attachments: [],
});

/** Lo que hay ahora en juritask.json, ya parseado. */
const LEER_JSON = `
  var f = window.__fsa.archivos['juritask.json'];
  return f && f.texto ? JSON.parse(f.texto) : null;
`;

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch(
    process.env.JT_CHROME ? { executablePath: process.env.JT_CHROME } : {}
  );
  const page = await browser.newPage();

  const errores = [];
  page.on('pageerror', e => errores.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errores.push('CONSOLE: ' + m.text()); });

  const out = [];
  const comprobar = (nombre, ok, detalle) => out.push([nombre, ok, detalle]);

  // ── 1-3. Primer arranque: la puerta pide carpeta ─────────
  await page.goto(`http://localhost:${PORT}/`);
  await enPagina(page, `localStorage.clear(); return null;`);
  await page.reload();
  await page.waitForTimeout(600);

  const puerta = await enPagina(page, `
    return {
      gate:   getComputedStyle(document.getElementById('gateScreen')).display !== 'none',
      app:    document.getElementById('appContainer').style.display !== 'none',
      elegir: document.getElementById('gateElegir').style.display !== 'none',
      recon:  document.getElementById('gateReconectar').style.display !== 'none',
    };
  `);
  comprobar('1. sin carpeta, la app no entra: muestra la puerta',
            puerta.gate && !puerta.app, `puerta=${puerta.gate} app=${puerta.app}`);
  comprobar('2. ofrece elegir carpeta, no reconectar',
            puerta.elegir && !puerta.recon, `elegir=${puerta.elegir} reconectar=${puerta.recon}`);

  // Datos en la caché local y carpeta nueva y vacía: se vuelca lo que hay.
  await sembrarCache(page, [TRAMITE('a', '11111')]);
  await page.reload();
  await page.waitForTimeout(500);
  await page.click('#gateElegir');
  await page.waitForTimeout(900);

  const trasElegir = await enPagina(page, `
    var f = window.__fsa.archivos['juritask.json'];
    return {
      app:      document.getElementById('appContainer').style.display !== 'none',
      escrito:  !!(f && f.texto),
      numeros:  f && f.texto ? JSON.parse(f.texto).tramites.map(function (t) { return t.numero; }) : [],
    };
  `);
  comprobar('3. elegir carpeta entra a la app y vuelca la caché al archivo',
            trasElegir.app && trasElegir.escrito && trasElegir.numeros.includes('11111'),
            `app=${trasElegir.app} en el archivo=${trasElegir.numeros.join(',') || '(vacío)'}`);

  // ── 4-5. Un cambio se escribe; lo que no cambia, no ──────
  await enPagina(page, `
    STATE.tramites[0].descripcion = 'CAMBIADO';
    saveAll();
    return null;
  `);
  await page.waitForTimeout(1200);
  const trasCambio = await enPagina(page, LEER_JSON);
  comprobar('4. un cambio llega al archivo',
            trasCambio?.tramites?.[0]?.descripcion === 'CAMBIADO',
            `descripción en el archivo="${trasCambio?.tramites?.[0]?.descripcion}"`);
  comprobar('5. la marca de pendientes se levanta al guardar',
            !(await enPagina(page, `return localStorage.getItem('juritask_pendiente');`)),
            'marca levantada');

  // ── 6. Al arrancar, el archivo manda sobre la caché ──────
  await sembrarCache(page, [TRAMITE('viejo', '00000')]);
  await page.reload();
  await page.waitForTimeout(900);
  const trasRecarga = await enPagina(page, `
    return { numeros: STATE.tramites.map(function (t) { return t.numero; }).sort(),
             app: document.getElementById('appContainer').style.display !== 'none' };
  `);
  comprobar('6. con la carpeta recordada entra sola y el archivo manda',
            trasRecarga.app && trasRecarga.numeros.includes('11111') && !trasRecarga.numeros.includes('00000'),
            `en pantalla=${trasRecarga.numeros.join(',')}`);

  // ── 7-8. Trabajo sin guardar: manda la caché ─────────────
  // La regresión del fallo que costó días: si lo del día anterior no llegó al
  // archivo, la carga NO puede pisarlo.
  await sembrarCache(page, [TRAMITE('ayer', '44444'), TRAMITE('a', '11111')], '2026-09-02T10:00:00.000Z');
  await page.reload();
  await page.waitForTimeout(1200);
  const rescate = await enPagina(page, `
    var f = window.__fsa.archivos['juritask.json'];
    return {
      enEstado: STATE.tramites.map(function (t) { return t.numero; }).sort(),
      enArchivo: JSON.parse(f.texto).tramites.map(function (t) { return t.numero; }).sort(),
      marca: localStorage.getItem('juritask_pendiente'),
    };
  `);
  comprobar('7. el trabajo sin guardar sobrevive a la carga',
            rescate.enEstado.includes('44444'), `en STATE=${rescate.enEstado.join(',')}`);
  comprobar('8. y se escribe en el archivo, con la marca levantada',
            rescate.enArchivo.includes('44444') && !rescate.marca,
            `en el archivo=${rescate.enArchivo.join(',')} marca=${rescate.marca ? 'sigue' : 'levantada'}`);

  // ── 9. Nunca vaciar un archivo que tiene datos ───────────
  // Un fallo que deje STATE en blanco no puede convertirse en un archivo en
  // blanco: sería la base de datos entera, perdida en una escritura.
  const vaciado = await enPagina(page, `
    STATE.tramites = [];
    return guardarArchivoAhora().then(function (ok) {
      var f = window.__fsa.archivos['juritask.json'];
      return { ok: ok, quedan: JSON.parse(f.texto).tramites.length };
    });
  `);
  comprobar('9. un STATE vacío no vacía el archivo',
            vaciado.ok === false && vaciado.quedan > 0,
            `escribió=${vaciado.ok} trámites en el archivo=${vaciado.quedan}`);

  // ── 10. …salvo con permiso explícito ────────────────────
  const vaciadoOk = await enPagina(page, `
    autorizarVaciado();
    return guardarArchivoAhora().then(function (ok) {
      var f = window.__fsa.archivos['juritask.json'];
      return { ok: ok, quedan: JSON.parse(f.texto).tramites.length };
    });
  `);
  comprobar('10. "Borrar todos mis datos" sí puede vaciarlo',
            vaciadoOk.ok === true && vaciadoOk.quedan === 0,
            `escribió=${vaciadoOk.ok} trámites=${vaciadoOk.quedan}`);

  // ── 11. La autorización es de un solo uso ───────────────
  const reArmado = await enPagina(page, `
    STATE.tramites = [${JSON.stringify(TRAMITE('b', '22222'))}];
    return guardarArchivoAhora().then(function () {
      STATE.tramites = [];
      return guardarArchivoAhora().then(function (ok) {
        return { ok: ok, quedan: JSON.parse(window.__fsa.archivos['juritask.json'].texto).tramites.length };
      });
    });
  `);
  comprobar('11. la autorización de vaciado no queda armada',
            reArmado.ok === false && reArmado.quedan === 1,
            `escribió=${reArmado.ok} trámites=${reArmado.quedan}`);

  // ── 12-13. Copias diarias ───────────────────────────────
  // El arranque ya dejó la copia de hoy, así que la primera va forzada para que
  // el contenido sea el de esta prueba. La segunda va normal: es la que
  // demuestra que abrir la app otra vez el mismo día no crea ni pisa nada.
  const copias = await enPagina(page, `
    STATE.tramites = [${JSON.stringify(TRAMITE('c', '33333'))}];
    return crearCopiaDiaria({ forzar: true }).then(function (n1) {
      STATE.tramites = [];                       // como si la app arrancara mal
      return crearCopiaDiaria().then(function (n2) {
        return listarCopias().then(function (lista) {
          var ruta = 'copias/' + n1;
          return { n1: n1, n2: n2, cuantas: lista.length,
                   dentro: JSON.parse(window.__fsa.archivos[ruta].texto).tramites.map(function (t) { return t.numero; }),
                   rutas: Object.keys(window.__fsa.archivos).filter(function (k) { return k.indexOf('copias/juritask-') === 0; }) };
        });
      });
    });
  `);
  comprobar('12. se crea la copia del día en copias/',
            copias.cuantas === 1 && /^copias\/juritask-\d{4}-\d{2}-\d{2}\.json$/.test(copias.rutas[0] || ''),
            `copias=${copias.rutas.join(',') || 'ninguna'}`);
  comprobar('13. la segunda copia del día no pisa a la primera',
            copias.n2 === null && copias.cuantas === 1 && copias.dentro.includes('33333'),
            `segunda=${copias.n2} total=${copias.cuantas} contenido=${copias.dentro.join(',')}`);

  // ── 14. Restaurar una copia ─────────────────────────────
  const restaurada = await enPagina(page, `
    window.showConfirm = function () { return Promise.resolve(true); };
    return listarCopias().then(function (lista) {
      STATE.tramites = [];          // como si se hubiera perdido todo
      return restaurarCopia(lista[0].nombre).then(function (ok) {
        return { ok: ok, numeros: STATE.tramites.map(function (t) { return t.numero; }) };
      });
    });
  `);
  comprobar('14. restaurar una copia devuelve los trámites',
            restaurada.ok === true && restaurada.numeros.includes('33333'),
            `restaurados=${restaurada.numeros.join(',') || 'ninguno'}`);

  // ── 15. El archivo cambiado por fuera deja copia ────────
  // Pasa si la carpeta está en Drive/Dropbox y otro equipo escribió. Pisarlo
  // sin más borraría ese trabajo.
  const conflicto = await enPagina(page, `
    window.__fsa.archivos['juritask.json'] = { texto: '{"tramites":[{"id":"x","numero":"99999"}]}', lastModified: 999999 };
    ARCHIVO.visto = 1;              // como si no hubiéramos visto ese cambio
    STATE.tramites = [${JSON.stringify(TRAMITE('d', '55555'))}];
    return guardarArchivoAhora().then(function () {
      return Object.keys(window.__fsa.archivos).filter(function (k) { return k.indexOf('copias/conflicto-') === 0; });
    });
  `);
  comprobar('15. un cambio externo se guarda antes de pisarlo',
            conflicto.length === 1, `copias de conflicto=${conflicto.length}`);

  // ── 16. Navegador sin soporte: no rompe, avisa ──────────
  await page.goto(`http://localhost:${PORT}/`);
  await enPagina(page, `
    localStorage.clear();
    delete window.showDirectoryPicker;
    return null;
  `);
  await page.reload();
  await page.waitForTimeout(500);
  await enPagina(page, `delete window.showDirectoryPicker; return null;`);
  const sinSoporte = await enPagina(page, `
    return { soporta: soportaArchivo(), conectado: ARCHIVO.conectado };
  `);
  comprobar('16. sin File System Access API la app lo detecta',
            sinSoporte.soporta === false && sinSoporte.conectado === false,
            `soporta=${sinSoporte.soporta} conectado=${sinSoporte.conectado}`);

  console.log('\n=== ARCHIVO DE DATOS ===');
  let fallos = 0;
  for (const [nombre, ok, detalle] of out) {
    if (!ok) fallos++;
    console.log(`[${ok ? 'PASA' : 'FALLA'}] ${nombre.padEnd(52)} ${detalle}`);
  }
  console.log(`\n${out.length - fallos}/${out.length} comprobaciones pasan`);

  if (errores.length) {
    console.log('\n=== ERRORES DE PÁGINA ===');
    errores.forEach(e => console.log('  ' + e));
  }

  await browser.close();
  server.close();
  process.exit(fallos || errores.length ? 1 : 0);
})();
