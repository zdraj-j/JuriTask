/**
 * JuriTask — enlaza el repo con un proyecto de Apps Script.
 *
 *   node tools/enlazar.js 1a2B3c...      # con el ID como argumento
 *   node tools/enlazar.js                # lo pregunta
 *
 * Escribe el `.clasp.json` que necesita `clasp push`. Existe porque ese
 * fichero es el punto donde más se tropieza:
 *
 *  - `clasp create --type webapp` solo funciona en clasp 2.x; en las versiones
 *    nuevas devuelve `Invalid container file type` y **deja un .clasp.json
 *    vacío**.
 *  - Con ese fichero vacío, clasp falla en *todos* los comandos —incluido
 *    `clasp login`— con `JSON5: invalid end of input at 1:1`, que no insinúa
 *    por ningún lado cuál es el problema.
 *  - Escribirlo con el Bloc de notas en Windows puede guardarlo vacío, con
 *    extensión `.txt` o con un BOM que rompe el parseo.
 *
 * Ver docs/appsscript.md.
 */
const fs   = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT    = path.resolve(__dirname, '..');
const DESTINO = path.join(ROOT, '.clasp.json');

// Los IDs de Apps Script son largos y solo llevan letras, números, - y _.
const ID_VALIDO = /^[A-Za-z0-9_-]{20,90}$/;

function preguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(texto, r => { rl.close(); res(r); }));
}

/** Avisa si el .clasp.json existente está vacío o no es JSON: es el fallo típico. */
function revisarExistente() {
  if (!fs.existsSync(DESTINO)) return;
  const crudo = fs.readFileSync(DESTINO, 'utf8').trim();
  if (!crudo) {
    console.log('  Había un .clasp.json vacío (lo deja un `clasp create` fallido). Se reemplaza.');
    return;
  }
  try {
    const previo = JSON.parse(crudo.replace(/^﻿/, ''));
    if (previo.scriptId) console.log(`  Ya estaba enlazado a: ${previo.scriptId}`);
  } catch (_) {
    console.log('  Había un .clasp.json ilegible. Se reemplaza.');
  }
}

(async () => {
  console.log('\nEnlazar JuriTask con un proyecto de Apps Script\n');

  if (!fs.existsSync(path.join(ROOT, 'tools', 'build.js'))) {
    console.error('Ejecuta esto desde la carpeta del proyecto (donde está la carpeta tools).');
    process.exit(1);
  }

  revisarExistente();

  let id = (process.argv[2] || '').trim();
  if (!id) {
    console.log('\nEl ID está en el editor de Apps Script:');
    console.log('  ⚙️ Configuración del proyecto → "ID de la secuencia de comandos"\n');
    id = (await preguntar('Pega aquí el ID y pulsa Enter: ')).trim();
  }

  // Por si pegan la URL entera del proyecto en vez del ID.
  const enUrl = id.match(/projects\/([A-Za-z0-9_-]+)/);
  if (enUrl) { id = enUrl[1]; console.log(`  (extraído de la URL: ${id})`); }

  if (!ID_VALIDO.test(id)) {
    console.error(`\nEse no parece un ID válido: "${id}"`);
    console.error('Debe ser un texto largo de letras, números, guiones y guiones bajos.');
    process.exit(1);
  }

  fs.writeFileSync(DESTINO, JSON.stringify({ scriptId: id, rootDir: 'build' }) + '\n', 'utf8');

  console.log(`\n✓ .clasp.json escrito:\n  ${fs.readFileSync(DESTINO, 'utf8').trim()}`);
  console.log('\nAhora:');
  console.log('  node tools/build.js');
  console.log('  clasp push\n');
})();
