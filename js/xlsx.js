/**
 * JuriTask — xlsx.js
 * Escritor mínimo de libros de Excel (.xlsx) 100% en el navegador.
 *
 * La app no tiene backend ni bundler, así que en vez de depender de una
 * librería externa (y de un CDN que rompería el modo offline del service
 * worker) generamos el .xlsx a mano: un .xlsx es un ZIP con XML dentro, y
 * escribimos el ZIP con entradas *stored* (sin compresión) para no necesitar
 * un compresor deflate.
 *
 * API pública:
 *   xlsxBuildBlob(sheets)            → Blob del libro
 *   xlsxDownload(nombre, sheets)     → descarga el archivo
 *   csvDownload(nombre, filas)       → descarga un CSV (UTF-8 con BOM)
 *
 * `sheets` = [{ name, columns: [{ header, width, wrap }], rows: [[celda…]] }]
 * Cada celda puede ser: string | number | boolean | null
 *   o un objeto { v, t } con t ∈ 'date' | 'text' | 'number'.
 */

// ============================================================
// CRC32 (necesario para las cabeceras del ZIP)
// ============================================================
const _CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function _crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = _CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ============================================================
// ZIP (método "stored": sin compresión)
// ============================================================
function _zipDosTime(d) {
  // Hora/fecha en formato MS-DOS que exige la especificación ZIP.
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}

function _zipBuild(files) {
  const enc     = new TextEncoder();
  const now     = _zipDosTime(new Date());
  const locals  = [];
  const centrals = [];
  let offset = 0;

  files.forEach(f => {
    const nameBytes = enc.encode(f.name);
    const data      = f.data instanceof Uint8Array ? f.data : enc.encode(f.data);
    const crc       = _crc32(data);

    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv    = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);   // firma local file header
    lv.setUint16(4, 20, true);           // versión mínima
    lv.setUint16(6, 0x0800, true);       // flag: nombres en UTF-8
    lv.setUint16(8, 0, true);            // método 0 = stored
    lv.setUint16(10, now.time, true);
    lv.setUint16(12, now.date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); // tamaño comprimido
    lv.setUint32(22, data.length, true); // tamaño original
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);           // extra field
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv      = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);   // firma central directory
    cv.setUint16(4, 20, true);           // versión que creó el archivo
    cv.setUint16(6, 20, true);           // versión mínima
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, now.time, true);
    cv.setUint16(14, now.date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);      // desplazamiento del local header
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length;
  });

  const centralSize = centrals.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev   = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);     // firma end of central directory
  ev.setUint16(8,  files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const total = offset + centralSize + eocd.length;
  const out   = new Uint8Array(total);
  let p = 0;
  locals.forEach(b   => { out.set(b, p); p += b.length; });
  centrals.forEach(b => { out.set(b, p); p += b.length; });
  out.set(eocd, p);
  return out;
}

// ============================================================
// Utilidades XML
// ============================================================
// Excel rechaza los caracteres de control; se eliminan antes de escapar.
function _xmlEscape(s) {
  return String(s)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// A, B, … Z, AA, AB…
function _colLetter(n) {
  let s = '';
  n += 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// 'YYYY-MM-DD' → serial de Excel (días desde 1899-12-30).
function _excelSerial(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return Math.round(ms / 86400000) + 25569;
}

// Excel limita los nombres de hoja a 31 caracteres y prohíbe : \ / ? * [ ]
function _sheetName(name, index) {
  const clean = String(name || `Hoja${index + 1}`).replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31);
  return clean || `Hoja${index + 1}`;
}

// ============================================================
// Construcción del libro
// ============================================================
const _STYLE_DEFAULT = 0;
const _STYLE_HEADER  = 1;
const _STYLE_DATE    = 2;
const _STYLE_WRAP    = 3;

function _cellXml(ref, value, styleWrap) {
  if (value === null || value === undefined || value === '') return '';

  // Objeto tipado { v, t }
  if (typeof value === 'object' && !(value instanceof Date)) {
    if (value.t === 'date') {
      const serial = _excelSerial(value.v);
      if (serial === null) return value.v ? `<c r="${ref}" t="inlineStr"><is><t>${_xmlEscape(value.v)}</t></is></c>` : '';
      return `<c r="${ref}" s="${_STYLE_DATE}"><v>${serial}</v></c>`;
    }
    if (value.t === 'number') {
      const n = Number(value.v);
      return Number.isFinite(n) ? `<c r="${ref}"><v>${n}</v></c>` : '';
    }
    value = value.v;
  }

  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
  if (typeof value === 'boolean') return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;

  const s = styleWrap ? ` s="${_STYLE_WRAP}"` : '';
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${_xmlEscape(value)}</t></is></c>`;
}

function _sheetXml(sheet) {
  const cols  = sheet.columns || [];
  const rows  = sheet.rows || [];
  const nCols = Math.max(cols.length, ...rows.map(r => r.length), 1);
  const last  = `${_colLetter(nCols - 1)}${rows.length + 1}`;

  let colsXml = '';
  if (cols.length) {
    colsXml = '<cols>' + cols.map((c, i) =>
      `<col min="${i + 1}" max="${i + 1}" width="${c.width || 16}" customWidth="1"/>`).join('') + '</cols>';
  }

  let body = '';
  if (cols.length) {
    body += `<row r="1" ht="26" customHeight="1">` + cols.map((c, i) =>
      `<c r="${_colLetter(i)}1" s="${_STYLE_HEADER}" t="inlineStr"><is><t>${_xmlEscape(c.header)}</t></is></c>`).join('') + '</row>';
  }
  rows.forEach((row, ri) => {
    const r = ri + (cols.length ? 2 : 1);
    const cells = row.map((v, ci) => _cellXml(`${_colLetter(ci)}${r}`, v, cols[ci]?.wrap)).join('');
    body += `<row r="${r}">${cells}</row>`;
  });

  // Con cabecera: fila fija + autofiltro, para que el usuario pueda seguir
  // filtrando dentro de Excel.
  const freeze = cols.length
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : '';
  const filter = (cols.length && rows.length) ? `<autoFilter ref="A1:${last}"/>` : '';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${last}"/>${freeze}<sheetFormatPr defaultRowHeight="15"/>${colsXml}<sheetData>${body}</sheetData>${filter}</worksheet>`;
}

function _stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>
<fonts count="2">
<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF3D5AF1"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function xlsxBuildBlob(sheets) {
  const list = (sheets || []).filter(Boolean);
  if (!list.length) throw new Error('El libro no tiene hojas.');

  const names = [];
  list.forEach((s, i) => {
    let n = _sheetName(s.name, i), base = n, k = 2;
    while (names.includes(n)) { n = `${base.slice(0, 28)} ${k++}`; }
    names.push(n);
  });

  const files = [];

  files.push({
    name: '[Content_Types].xml',
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
</Types>`,
  });

  files.push({
    name: '_rels/.rels',
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
  });

  files.push({
    name: 'xl/workbook.xml',
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${names.map((n, i) => `<sheet name="${_xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
</workbook>`,
  });

  files.push({
    name: 'xl/_rels/workbook.xml.rels',
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
  });

  files.push({ name: 'xl/styles.xml', data: _stylesXml() });
  list.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: _sheetXml(s) }));

  return new Blob([_zipBuild(files)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

// ============================================================
// Descargas
// ============================================================
function _downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Safari necesita un respiro antes de liberar la URL.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function xlsxDownload(filename, sheets) {
  _downloadBlob(xlsxBuildBlob(sheets), filename);
}

// Convierte una matriz de celdas (mismo formato que las hojas) a CSV.
function csvSerialize(rows, sep = ';') {
  const cell = v => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') v = v.v ?? '';
    const s = String(v);
    return /["\n\r;,\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map(r => r.map(cell).join(sep)).join('\r\n');
}

function csvDownload(filename, rows) {
  // BOM para que Excel en Windows detecte UTF-8.
  const blob = new Blob(['﻿' + csvSerialize(rows)], { type: 'text/csv;charset=utf-8' });
  _downloadBlob(blob, filename);
}
