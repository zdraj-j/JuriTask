/**
 * JuriTask — prueba de la sincronización con Firestore.
 *
 * `smoke.js` retira js/firebase.js porque necesita red y una sesión de Google
 * de verdad. Eso deja sin ejecutar justo la pieza más delicada: el motor que
 * decide qué sube, qué borra y qué deja en paz.
 *
 * Aquí se inyecta un `window.firebase` de mentira —respaldado por un objeto
 * plano que la prueba puede leer— y se ejercita el ciclo entero contra el
 * módulo real, sin tocar la nube.
 *
 *   node test/firestore.js
 *   JT_CHROME=/ruta/al/chrome node test/firestore.js
 */
const { chromium } = require('playwright');
const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8123;
const TIPOS = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
                '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml' };

// El SDK de Google, sustituido por lo mínimo que usa js/firebase.js.
const FAKE_SDK = `<script>
(function () {
  const store = { docs: {}, commits: 0, escrituras: [], borrados: [] };
  window.__fs = store;

  const clona = v => JSON.parse(JSON.stringify(v));

  function docRef(ruta) {
    return {
      _ruta: ruta,
      get: async () => ({
        exists: Object.prototype.hasOwnProperty.call(store.docs, ruta),
        data:   () => clona(store.docs[ruta]),
      }),
      set: async d => { store.docs[ruta] = clona(d); },
      delete: async () => { delete store.docs[ruta]; },
      collection: sub => colRef(ruta + '/' + sub),
    };
  }

  function colRef(ruta) {
    return {
      _ruta: ruta,
      doc: id => docRef(ruta + '/' + id),
      get: async () => {
        const hijos = Object.keys(store.docs)
          .filter(k => k.startsWith(ruta + '/') && k.slice(ruta.length + 1).indexOf('/') === -1);
        return { forEach: cb => hijos.forEach(k => cb({ id: k.split('/').pop(), data: () => clona(store.docs[k]) })) };
      },
    };
  }

  let usuario = null;
  const oyentes = [];

  window.firebase = {
    initializeApp() {},
    auth: Object.assign(() => ({
      get currentUser() { return usuario; },
      // Asíncrono como el SDK de verdad. Llamarlo en el acto haría que
      // firebase.js buscara \`mostrarPantallaAcceso\` antes de que auth.js
      // se haya cargado, un fallo que solo existiría en la prueba.
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
    firestore: () => ({
      settings() {},
      enablePersistence: () => Promise.resolve(),
      collection: n => colRef(n),
      batch() {
        const ops = [];
        return {
          set(ref, d)  { ops.push(['set', ref._ruta, clona(d)]); },
          delete(ref)  { ops.push(['del', ref._ruta]); },
          async commit() {
            store.commits++;
            for (const [tipo, ruta, d] of ops) {
              if (tipo === 'set') { store.docs[ruta] = d; store.escrituras.push(ruta); }
              else { delete store.docs[ruta]; store.borrados.push(ruta); }
            }
          },
        };
      },
    }),
  };
})();
</script>`;

function localIndex() {
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  html = html.replace(/<script src="https:\/\/[^"]*"><\/script>\s*/g, '');
  // Sin depender del número del comentario: cuando se renumeran las secciones
  // el regex deja de coincidir en silencio, el SW se registra y dispara
  // `location.reload()` en `controllerchange` a mitad de prueba.
  html = html.replace(/<!--[^>]*PWA: registrar service worker[^>]*-->[\s\S]*?<\/script>/, '');
  html = html.replace('<script src="js/storage.js"></script>',
    '<script>window.lucide={createIcons(){}};</script>\n<script src="js/storage.js"></script>');
  // El SDK falso tiene que existir antes de que js/firebase.js lo use.
  return html.replace('<script src="js/firebase.js"></script>',
    `${FAKE_SDK}\n<script src="js/firebase.js"></script>`);
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
 * la página (STATE, saveAll, el `window.__fs` del SDK falso). `addScriptTag` sí
 * ejecuta en el mundo principal, así que el resultado se devuelve escribiéndolo
 * en un nodo del DOM, que es lo único que comparten los dos mundos.
 */
async function enPagina(page, codigo) {
  await page.addScriptTag({ content: `
    (function () {
      var r;
      try { r = (function () { ${codigo} })(); }
      catch (e) { r = { __error: String(e && e.message || e) }; }
      var el = document.getElementById('__salida');
      if (!el) { el = document.createElement('div'); el.id = '__salida'; el.style.display = 'none'; document.body.appendChild(el); }
      el.textContent = JSON.stringify(r === undefined ? null : r);
    })();
  ` });
  const crudo = await page.$eval('#__salida', e => e.textContent);
  const r = JSON.parse(crudo);
  if (r && r.__error) throw new Error('en la página: ' + r.__error);
  return r;
}

const TRAMITE = (id, numero) => ({
  id, numero, descripcion: 'Prueba ' + numero, tipo: 'propio', modulo: 'ACT',
  fechaVencimiento: '2030-01-01', terminado: false, terminadoEn: null,
  gestion: { analisis: false, cumplimiento: false },
  seguimiento: [], notas: [], attachments: [],
});

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

  // ── 1. Nube con datos: gana la nube ──────────────────────
  await page.goto(`http://localhost:${PORT}/`);

  // Algo distinto en local, para ver quién gana al cargar.
  await enPagina(page, `
    localStorage.setItem('juritask_tramites', JSON.stringify([${JSON.stringify(TRAMITE('viejo', '00000'))}]));
    window.__fs.docs['users/u1/tramites/a'] = ${JSON.stringify(TRAMITE('a', '11111'))};
    window.__fs.docs['users/u1/meta/order'] = { order: ['a'] };
  `);

  await page.click('#btnGoogleLogin');
  await page.waitForTimeout(700);

  const trasLogin = await enPagina(page, `
    return {
      visible: document.getElementById('appContainer').style.display !== 'none',
      numeros: [].slice.call(document.querySelectorAll('#tramiteList .tramite-card'))
                 .map(function (c) { var m = c.textContent.match(/\\d{5}/); return m ? m[0] : ''; }),
      nombre: document.getElementById('sesionNombre').textContent,
      token: (typeof AUTH !== 'undefined') ? AUTH.googleAccessToken : null,
    };
  `);
  comprobar('1. el login arranca la app y pinta la sesión',
            trasLogin.visible && trasLogin.nombre === 'Yo',
            `visible=${trasLogin.visible} sesión="${trasLogin.nombre}"`);
  comprobar('2. la nube gana a la caché local',
            trasLogin.numeros.includes('11111') && !trasLogin.numeros.includes('00000'),
            `en pantalla=${trasLogin.numeros.join(',') || '(vacío)'}`);
  comprobar('3. el token de Google queda disponible para Gmail',
            trasLogin.token === 'token-de-mentira', `token=${trasLogin.token}`);

  // ── 4. Un cambio sube, y solo ese ────────────────────────
  await enPagina(page, `
    window.__fs.escrituras = [];
    var b = { id: 'b', numero: '22222', descripcion: 'otro', tipo: 'propio', terminado: false,
              seguimiento: [], notas: [], attachments: [], gestion: { analisis: false, cumplimiento: false } };
    window.__fs.docs['users/u1/tramites/b'] = JSON.parse(JSON.stringify(b));
    STATE.tramites.push(JSON.parse(JSON.stringify(b)));
    _sello.set('b', JSON.stringify(b));          // como si hubiera venido de la nube
    STATE.tramites[0].descripcion = 'CAMBIADO';
    saveAll();
  `);
  await page.waitForTimeout(1800);
  const subida = await enPagina(page, `
    return { escrituras: window.__fs.escrituras.slice(),
             desc: (window.__fs.docs['users/u1/tramites/a'] || {}).descripcion };
  `);
  comprobar('4. sube el trámite modificado',
            subida.desc === 'CAMBIADO', `descripción en la nube="${subida.desc}"`);
  comprobar('5. no reescribe lo que no cambió',
            !subida.escrituras.includes('users/u1/tramites/b'),
            `escrituras=${subida.escrituras.map(r => r.split('/').pop()).join(',') || 'ninguna'}`);

  // ── 6. Borrar un trámite lo borra en la nube ─────────────
  await enPagina(page, `
    window.__fs.borrados = [];
    STATE.tramites = STATE.tramites.filter(function (t) { return t.id !== 'a'; });
    saveAll();
  `);
  await page.waitForTimeout(1800);
  const borrado = await enPagina(page, `
    return { borrados: window.__fs.borrados.slice(),
             sigue: !!window.__fs.docs['users/u1/tramites/a'] };
  `);
  comprobar('6. borrar un trámite lo borra en la nube',
            !borrado.sigue && borrado.borrados.indexOf('users/u1/tramites/a') !== -1,
            `borrados=${borrado.borrados.map(r => r.split('/').pop()).join(',') || 'ninguno'}`);

  // ── 7. La config viaja aparte ────────────────────────────
  await enPagina(page, `STATE.config.theme = 'oscuro'; saveAll();`);
  await page.waitForTimeout(1800);
  const cfg = await enPagina(page, `return (window.__fs.docs['users/u1/meta/config'] || {}).theme || null;`);
  comprobar('7. la config sube a meta/config', cfg === 'oscuro', `theme en la nube=${cfg}`);

  // ── 8. Sin cambios no se escribe nada ────────────────────
  await enPagina(page, `window.__fs.commits = 0; saveAll(); return null;`);
  await page.waitForTimeout(1800);
  const commits = await enPagina(page, `return window.__fs.commits;`);
  comprobar('8. sin cambios no hay escritura', commits === 0, `commits=${commits}`);

  // ── 9. Importar un JSON reemplaza la nube entera ─────────
  // El motor por diferencias cubre la importación sin código propio: lo nuevo
  // se sube y lo que desapareció se borra.
  await enPagina(page, `
    STATE.tramites = [{ id: 'z', numero: '99999', descripcion: 'importado', tipo: 'propio',
      terminado: false, seguimiento: [], notas: [], attachments: [],
      gestion: { analisis: false, cumplimiento: false } }];
    saveAll(true);
  `);
  await page.waitForTimeout(1800);
  const importado = await enPagina(page, `
    return { hayZ: !!window.__fs.docs['users/u1/tramites/z'],
             hayB: !!window.__fs.docs['users/u1/tramites/b'] };
  `);
  comprobar('9. importar sube lo nuevo y borra lo que ya no está',
            importado.hayZ && !importado.hayB,
            `z=${importado.hayZ} b=${importado.hayB}`);

  // ── 10. Cerrar sesión limpia la caché local ──────────────
  page.on('dialog', d => d.accept());
  await page.click('#btnLogout');
  await page.waitForTimeout(700);
  const cache = await enPagina(page, `return localStorage.getItem('juritask_tramites');`);
  comprobar('10. cerrar sesión vacía la caché local', !cache, `caché=${cache ? 'sigue' : 'vacía'}`);

  console.log('\n=== SINCRONIZACIÓN CON FIRESTORE ===');
  let fallos = 0;
  for (const [nombre, ok, detalle] of out) {
    if (!ok) fallos++;
    console.log(`[${ok ? 'PASA' : 'FALLA'}] ${nombre.padEnd(48)} ${detalle}`);
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
