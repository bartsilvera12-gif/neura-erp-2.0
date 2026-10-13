/**
 * Conciliación contra el extracto del banco — SOLO Excel/CSV, sin IA.
 *
 * 1) `leerExtracto`: busca la fila de encabezados en las primeras 15 filas por alias
 *    (Haber/Crédito, Debe/Débito, Monto/Importe, Fecha, Comprobante/Operación/Referencia,
 *    Descripción/Concepto), entiende seriales de fecha de Excel y números es-PY / en-US.
 * 2) `conciliar`: cruza los créditos del extracto contra las transferencias APROBADAS. Es
 *    una verificación de SOLO LECTURA: no modifica nada.
 *      · aprobadas con el mismo N° de operación (≥5 caracteres, no placeholder) se suman
 *        como UNA transferencia (cobro múltiple)
 *      · match por referencia normalizada (≥3 caracteres, igual o contenida); si no, por
 *        monto (±1) y fecha (±3 días). Cada crédito se usa una sola vez.
 */
import * as XLSX from "xlsx";

export type ExtractoTx = { fecha: string | null; monto: number; tipo: "credito" | "debito"; referencia: string | null; descripcion: string | null };

export type AprobadoLite = {
  id: string;
  monto: number;
  fecha: string;
  numero_operacion: string | null;
  banco_origen: string | null;
  titular: string | null;
  cliente_nombre: string | null;
  numero_factura: string | null;
  /** >1: varias aprobadas del sistema agrupadas por el mismo N° de operación. */
  agrupadas?: number;
};

export type ReporteConciliacion = {
  archivo: string;
  mes: string | null;
  conciliados: { aprobado: AprobadoLite; credito: ExtractoTx }[];
  montos_difieren: { aprobado: AprobadoLite; credito: ExtractoTx; diff: number }[];
  aprobados_sin_extracto: AprobadoLite[];
  extracto_sin_registrar: ExtractoTx[];
  resumen: {
    aprobados: number; creditos_extracto: number; conciliados: number; difieren: number; sin_extracto: number; sin_registrar: number;
    monto_conciliado: number; monto_sin_extracto: number; monto_sin_registrar: number;
  };
};

/** Número de una celda: acepta 1.500.000 · 1,500,000 · 1.500.000,50 · 1500000.5 · "Gs. 150.000". */
export function aNumero(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  let s = String(v ?? "").trim();
  if (!s) return NaN;
  const negativo = /^\(.*\)$/.test(s) || /^-/.test(s.replace(/[^\d,.-]/g, ""));
  s = s.replace(/[^\d.,]/g, "");
  if (!s) return NaN;
  const punto = s.lastIndexOf(".");
  const coma = s.lastIndexOf(",");
  if (punto >= 0 && coma >= 0) {
    // El separador más a la derecha es el decimal; el otro, de miles.
    const dec = punto > coma ? "." : ",";
    s = s.split(dec === "." ? "," : ".").join("").replace(dec, ".");
  } else if (coma >= 0) {
    if (/,\d{3}(?:\D|$)/.test(s) && !/,\d{1,2}$/.test(s)) s = s.split(",").join("");
    else s = s.replace(",", ".");
  } else if (punto >= 0) {
    if (/\.\d{3}(?:\D|$)/.test(s) && !/\.\d{1,2}$/.test(s)) s = s.split(".").join("");
  }
  const n = Number(s);
  return Number.isFinite(n) ? (negativo ? -n : n) : NaN;
}

const normCab = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/gi, "").toLowerCase();

const ALIAS = {
  credito: ["haber", "credito", "credit", "abono", "ingreso", "creditos", "montocredito"],
  debito: ["debe", "debito", "debit", "cargo", "egreso", "debitos", "montodebito"],
  monto: ["monto", "importe", "valor", "amount", "montogs"],
  fecha: ["fechamovi", "fechacont", "fechamovimiento", "fechacontable", "fechaoperacion", "fecha", "date", "dia"],
  ref: ["comprobante", "operacion", "nrooperacion", "numerooperacion", "referencia", "orden", "documento", "comprob", "nrodoc"],
  desc: ["descripcion", "descrip", "concepto", "movimiento", "detalle", "description"],
};

function columna(cabeceras: string[], alias: string[]): number {
  for (const a of alias) {
    const i = cabeceras.indexOf(a);
    if (i >= 0) return i;
  }
  for (const a of alias) {
    const i = cabeceras.findIndex((h) => h.includes(a));
    if (i >= 0) return i;
  }
  return -1;
}

/** Serial de fecha de Excel (días desde 1899-12-30) → YYYY-MM-DD. */
function serialAFecha(n: number): string | null {
  if (!Number.isFinite(n) || n <= 20000 || n >= 90000) return null;
  const d = new Date(Math.round((n - 25569) * 86400000));
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function fechaDeCelda(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  if (typeof v === "number") return serialAFecha(v);
  const s = String(v ?? "").trim();
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})$/);
  if (m) return `20${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  if (/^\d{5}$/.test(s)) return serialAFecha(Number(s));
  return null;
}

/** Lee el Excel/CSV (primera hoja) y devuelve los movimientos, o un error entendible. */
export function leerExtracto(bytes: Uint8Array): { transacciones: ExtractoTx[] } | { error: string } {
  let filas: unknown[][];
  try {
    // raw: en un CSV no adivinar tipos (SheetJS lee "36.000" como 36 y 12/10 como 10 de diciembre);
    // los números y fechas de texto los interpreta este módulo (es-PY). En .xlsx las celdas ya vienen tipadas.
    const wb = XLSX.read(bytes, { type: "array", cellDates: true, raw: true });
    const hoja = wb.Sheets[wb.SheetNames[0]];
    if (!hoja) return { error: "El archivo no tiene hojas." };
    filas = XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, raw: true, defval: null }) as unknown[][];
  } catch {
    return { error: "No se pudo leer el archivo: subí el extracto en Excel (.xlsx, .xls) o CSV." };
  }
  if (filas.length < 2) return { error: "El extracto está vacío." };

  let fila0 = -1;
  let cols = { credito: -1, debito: -1, monto: -1, fecha: -1, ref: -1, desc: -1 };
  for (let r = 0; r < Math.min(15, filas.length); r++) {
    const cab = (filas[r] ?? []).map(normCab);
    const c = {
      credito: columna(cab, ALIAS.credito), debito: columna(cab, ALIAS.debito), monto: columna(cab, ALIAS.monto),
      fecha: columna(cab, ALIAS.fecha), ref: columna(cab, ALIAS.ref), desc: columna(cab, ALIAS.desc),
    };
    if ((c.credito >= 0 || c.debito >= 0 || c.monto >= 0) && (c.fecha >= 0 || c.desc >= 0)) {
      fila0 = r;
      cols = c;
      break;
    }
  }
  if (fila0 < 0) {
    return { error: "No se reconocieron las columnas del extracto. Tiene que tener una columna de fecha y una de importe (Haber/Crédito, Debe/Débito o Monto)." };
  }

  const transacciones: ExtractoTx[] = [];
  for (let r = fila0 + 1; r < filas.length; r++) {
    const row = filas[r] ?? [];
    const celda = (i: number) => (i >= 0 ? row[i] : undefined);
    const haber = cols.credito >= 0 ? aNumero(celda(cols.credito)) : NaN;
    const debe = cols.debito >= 0 ? aNumero(celda(cols.debito)) : NaN;
    let monto = NaN;
    let tipo: "credito" | "debito" = "credito";
    if (Number.isFinite(haber) && haber > 0) monto = haber;
    else if (Number.isFinite(debe) && debe > 0) { monto = debe; tipo = "debito"; }
    else if (cols.monto >= 0) {
      // Sin Debe/Haber: el signo dice si entró o salió.
      const m = aNumero(celda(cols.monto));
      if (Number.isFinite(m) && m !== 0) { monto = Math.abs(m); tipo = m < 0 ? "debito" : "credito"; }
    }
    if (!Number.isFinite(monto) || monto <= 0) continue;
    const ref = celda(cols.ref);
    const desc = celda(cols.desc);
    transacciones.push({
      fecha: cols.fecha >= 0 ? fechaDeCelda(celda(cols.fecha)) : null,
      monto: Math.round(monto * 100) / 100,
      tipo,
      referencia: ref != null && String(ref).trim() ? String(ref).trim().slice(0, 80) : null,
      descripcion: desc != null && String(desc).trim() ? String(desc).trim().slice(0, 200) : null,
    });
  }
  if (transacciones.length === 0) return { error: "El extracto no tiene movimientos con importe." };
  return { transacciones };
}

const normRef = (s: string | null | undefined) => String(s ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
const dias = (a: string | null, b: string | null) => {
  if (!a || !b) return 0;
  const x = Date.parse(a);
  const y = Date.parse(b);
  return Number.isNaN(x) || Number.isNaN(y) ? 0 : Math.abs(x - y) / 86400000;
};
const TOL_MONTO = 1;
const TOL_DIAS = 3;

function agruparPorOperacion(aprobados: AprobadoLite[]): AprobadoLite[] {
  const porOp = new Map<string, AprobadoLite[]>();
  const solos: AprobadoLite[] = [];
  for (const a of aprobados) {
    const op = normRef(a.numero_operacion);
    // Sólo operaciones reales: ≥5 caracteres y no un placeholder (000000, todo igual).
    if (op.length >= 5 && !/^(.)\1*$/.test(op)) porOp.set(op, [...(porOp.get(op) ?? []), a]);
    else solos.push(a);
  }
  const out = [...solos];
  for (const grupo of porOp.values()) {
    if (grupo.length === 1) { out.push(grupo[0]); continue; }
    const nombres = [...new Set(grupo.map((x) => (x.cliente_nombre ?? x.titular ?? "").trim()).filter(Boolean))].join(" + ");
    out.push({
      ...grupo[0],
      monto: grupo.reduce((s, x) => s + x.monto, 0),
      cliente_nombre: nombres || grupo[0].cliente_nombre,
      numero_factura: [...new Set(grupo.map((x) => x.numero_factura).filter(Boolean))].join(", ") || null,
      agrupadas: grupo.length,
    });
  }
  return out;
}

export function conciliar(aprobadosRaw: AprobadoLite[], transacciones: ExtractoTx[], meta: { archivo: string; mes: string | null }): ReporteConciliacion {
  const aprobados = agruparPorOperacion(aprobadosRaw);
  const creditos = transacciones.filter((t) => t.tipo === "credito");
  const usados = new Set<number>();
  const conciliados: ReporteConciliacion["conciliados"] = [];
  const difieren: ReporteConciliacion["montos_difieren"] = [];
  const sinExtracto: AprobadoLite[] = [];

  for (const a of aprobados) {
    const ref = normRef(a.numero_operacion);
    let idx = -1;
    if (ref.length >= 3) {
      idx = creditos.findIndex((c, i) => {
        if (usados.has(i)) return false;
        const cr = normRef(c.referencia);
        return cr.length >= 3 && (cr === ref || cr.includes(ref) || ref.includes(cr));
      });
    }
    if (idx < 0) {
      idx = creditos.findIndex((c, i) => !usados.has(i) && Math.abs(c.monto - a.monto) <= TOL_MONTO && dias(c.fecha, a.fecha) <= TOL_DIAS);
    }
    if (idx < 0) { sinExtracto.push(a); continue; }
    usados.add(idx);
    const c = creditos[idx];
    const diff = Math.round(c.monto - a.monto);
    if (Math.abs(diff) > TOL_MONTO) difieren.push({ aprobado: a, credito: c, diff });
    else conciliados.push({ aprobado: a, credito: c });
  }

  const sinRegistrar = creditos.filter((_, i) => !usados.has(i));
  const suma = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0));
  return {
    archivo: meta.archivo,
    mes: meta.mes,
    conciliados,
    montos_difieren: difieren,
    aprobados_sin_extracto: sinExtracto,
    extracto_sin_registrar: sinRegistrar,
    resumen: {
      aprobados: aprobados.length,
      creditos_extracto: creditos.length,
      conciliados: conciliados.length,
      difieren: difieren.length,
      sin_extracto: sinExtracto.length,
      sin_registrar: sinRegistrar.length,
      monto_conciliado: suma(conciliados.map((p) => p.aprobado.monto)),
      monto_sin_extracto: suma(sinExtracto.map((a) => a.monto)),
      monto_sin_registrar: suma(sinRegistrar.map((c) => c.monto)),
    },
  };
}
