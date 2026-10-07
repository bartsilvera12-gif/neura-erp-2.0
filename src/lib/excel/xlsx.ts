/**
 * Generador mínimo de .xlsx (Office Open XML) sin dependencias: varias hojas,
 * encabezado en negrita, números como número, fechas como fecha y ancho de columna.
 * El .xlsx es un zip; acá se arma "stored" (sin compresión), que Excel abre igual.
 */

export type Celda = string | number | Date | null | undefined;
export type Columna<T> = { header: string; value: (row: T) => Celda; width?: number };
export type Hoja = { name: string; cols: { header: string; width?: number }[]; rows: Celda[][] };

export function hoja<T>(name: string, rows: T[], cols: Columna<T>[]): Hoja {
  return {
    name,
    cols: cols.map((c) => ({ header: c.header, width: c.width })),
    rows: rows.map((r) => cols.map((c) => c.value(r))),
  };
}

const xmlEsc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!)).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

const colLetra = (i: number) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

// Serial de Excel en hora de Asunción (UTC-3): el reporte muestra horas locales.
const serialFecha = (d: Date) => (d.getTime() - 3 * 3600_000) / 86400_000 + 25569;

function celdaXml(ref: string, v: Celda, header: boolean) {
  if (v == null || v === "") return "";
  if (header) return `<c r="${ref}" t="inlineStr" s="1"><is><t>${xmlEsc(String(v))}</t></is></c>`;
  if (v instanceof Date) return isNaN(v.getTime()) ? "" : `<c r="${ref}" s="2"><v>${serialFecha(v)}</v></c>`;
  if (typeof v === "number") return Number.isFinite(v) ? `<c r="${ref}" s="3"><v>${v}</v></c>` : "";
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
}

function hojaXml(h: Hoja) {
  const cols = h.cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 14}" customWidth="1"/>`).join("");
  const filas = [h.cols.map((c) => c.header), ...h.rows]
    .map((fila, r) => `<row r="${r + 1}">${fila.map((v, c) => celdaXml(`${colLetra(c)}${r + 1}`, v, r === 0)).join("")}</row>`)
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${cols}</cols><sheetData>${filas}</sheetData></worksheet>`
  );
}

const ESTILOS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy hh:mm"/></numFmts>` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border/></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="4">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

export function buildXlsx(hojas: Hoja[]): Uint8Array {
  const nombre = (h: Hoja, i: number) => xmlEsc(h.name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || `Hoja${i + 1}`);
  const files: [string, string][] = [
    [
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
        `</Types>`,
    ],
    [
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
        hojas.map((h, i) => `<sheet name="${nombre(h, i)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
        `</sheets></workbook>`,
    ],
    [
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
        `<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ],
    ["xl/styles.xml", ESTILOS],
    ...hojas.map((h, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, hojaXml(h)]),
  ];
  return zipStored(files.map(([n, s]) => [n, new TextEncoder().encode(s)]));
}

export function xlsxHeaders(base: string): HeadersInit {
  return {
    "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "content-disposition": `attachment; filename="${base.replace(/[^\w.-]/g, "_")}.xlsx"`,
    "cache-control": "no-store",
  };
}

// ── Zip "stored" ──────────────────────────────────────────────────────────────
const CRC_TABLA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLA[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipStored(files: [string, Uint8Array][]): Uint8Array {
  const locales: Uint8Array[] = [];
  const centrales: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nb = new TextEncoder().encode(name);
    const crc = crc32(data);
    const loc = new Uint8Array(30 + nb.length);
    const lv = new DataView(loc.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // nombres en UTF-8
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nb.length, true);
    loc.set(nb, 30);
    const cen = new Uint8Array(46 + nb.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nb.length, true);
    cv.setUint32(42, offset, true);
    cen.set(nb, 46);
    locales.push(loc, data);
    centrales.push(cen);
    offset += loc.length + data.length;
  }
  const tamCentral = centrales.reduce((a, c) => a + c.length, 0);
  const fin = new Uint8Array(22);
  const fv = new DataView(fin.buffer);
  fv.setUint32(0, 0x06054b50, true);
  fv.setUint16(8, files.length, true);
  fv.setUint16(10, files.length, true);
  fv.setUint32(12, tamCentral, true);
  fv.setUint32(16, offset, true);
  const partes = [...locales, ...centrales, fin];
  const out = new Uint8Array(partes.reduce((a, p) => a + p.length, 0));
  let p = 0;
  for (const x of partes) {
    out.set(x, p);
    p += x.length;
  }
  return out;
}
