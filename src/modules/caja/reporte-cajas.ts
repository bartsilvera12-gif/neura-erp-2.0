/**
 * Reporte de cierres de caja (portado de Ferretería República, re-plomado al 2.0).
 *
 * Fuente de verdad del cajón = caja_movimientos (no anulados):
 *   - ingresos con venta_id → ventas de contado, un movimiento por medio (pago mixto → varios)
 *   - venta_id NULL          → movimientos manuales (ingreso/egreso/retiro/ajuste)
 * Las ventas a CRÉDITO no tocan el cajón: salen de `ventas` (tipo_venta=CREDITO, no anuladas).
 *
 * Uso solo del lado del servidor (recibe el ctx.db de withTenant).
 */
import type { TenantDb } from "@/lib/api/tenant-db";

// PostgREST corta en 1000 filas por respuesta → se pide en tandas.
const TANDA = 1000;

type Fila = Record<string, unknown>;

export type CajaReporteFila = {
  id: string;
  numero_caja: number;
  estado: string;
  fecha_apertura: string;
  fecha_cierre: string | null;
  abierta_por_nombre: string | null;
  cerrada_por_nombre: string | null;
  monto_apertura: number;
  cantidad_ventas: number;
  total_vendido: number;
  total_efectivo: number;
  total_tarjeta: number;
  total_pos: number;
  total_transferencia: number;
  total_otros: number;
  total_credito: number;
  ingresos_efectivo: number;
  egresos_efectivo: number;
  retiros_efectivo: number;
  ajustes_efectivo: number;
  efectivo_esperado: number;
  monto_cierre_contado: number | null;
  diferencia: number | null;
  observacion_apertura: string | null;
  observacion_cierre: string | null;
};

export type CajasReporte = {
  desde: string;
  hasta: string;
  cajas: CajaReporteFila[];
  totales: {
    cantidad_cajas: number;
    cajas_abiertas: number;
    cajas_cerradas: number;
    total_vendido: number;
    total_efectivo: number;
    total_tarjeta: number;
    total_pos: number;
    total_transferencia: number;
    total_otros: number;
    total_credito: number;
    total_diferencia: number;
    faltantes: number;
    sobrantes: number;
    cajas_con_diferencia: number;
  };
};

export type MovimientoTurno = {
  id: string;
  tipo: string;
  concepto: string;
  monto: number;
  medio_pago: string;
  observacion: string | null;
  usuario_nombre: string | null;
  usuario_email: string | null;
  created_at: string;
};

export type VentaTurno = {
  id: string;
  numero_control: string | null;
  fecha: string;
  total: number;
  tipo_venta: string | null;
  estado: string;
  metodo_pago: string | null;
  /** Desglose real del cobro (de caja_movimientos), p. ej. "Efectivo + POS". */
  medios: string[];
};

export type CajaDetalle = { caja: CajaReporteFila; ventas: VentaTurno[]; movimientos: MovimientoTurno[] };

// ── Rango de fechas (Asunción, UTC-3 todo el año) ─────────────────────────────
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
import { hoyPY as hoyAsuncion } from "@/lib/fecha/paraguay";

/** Default: del 1° del mes en curso hasta hoy. */
export function resolverRango(desde: string | null, hasta: string | null) {
  const hoy = hoyAsuncion();
  const d = desde && RE_FECHA.test(desde) ? desde : `${hoy.slice(0, 7)}-01`;
  const h = hasta && RE_FECHA.test(hasta) ? hasta : hoy;
  const [a, b] = d <= h ? [d, h] : [h, d];
  return { desde: a, hasta: b, start: `${a}T00:00:00-03:00`, end: `${b}T23:59:59.999-03:00` };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const num = (v: unknown) => Number(v) || 0;
const numONull = (v: unknown) => (v == null ? null : Number(v));
const esEfvo = (m: string) => m.trim().toLowerCase() === "efectivo";

async function todas(build: (desde: number, hasta: number) => PromiseLike<{ data: unknown; error: unknown }>) {
  const out: Fila[] = [];
  for (let desde = 0; ; desde += TANDA) {
    const { data, error } = await build(desde, desde + TANDA - 1);
    if (error) throw new Error("db");
    const tanda = (data ?? []) as Fila[];
    out.push(...tanda);
    if (tanda.length < TANDA) break;
  }
  return out;
}

const COLS_CAJA =
  "id, numero_caja, estado, abierta_por, cerrada_por, fecha_apertura, fecha_cierre, monto_apertura, monto_cierre_contado, diferencia, observacion_apertura, observacion_cierre";

async function nombresUsuarios(db: TenantDb, ids: string[]) {
  const map = new Map<string, string>();
  const unicos = [...new Set(ids.filter(Boolean))];
  if (!unicos.length) return map;
  const { data } = await db.select("usuarios", "id, auth_user_id, nombre").in("id", unicos);
  for (const u of (data ?? []) as unknown as Fila[]) map.set(String(u.id), String(u.nombre ?? ""));
  // Por si la caja guardó el auth_user_id en vez del id de usuarios.
  const faltan = unicos.filter((id) => !map.has(id));
  if (faltan.length) {
    const r = await db.select("usuarios", "id, auth_user_id, nombre").in("auth_user_id", faltan);
    for (const u of (r.data ?? []) as unknown as Fila[]) map.set(String(u.auth_user_id), String(u.nombre ?? ""));
  }
  return map;
}

type Mov = { caja_id: string; tipo: string; monto: number; medio: string; venta_id: string | null };
type VentaCred = { caja_id: string; total: number; tipo_venta: string; estado: string };

function armarFila(c: Fila, movs: Mov[], ventas: VentaCred[], nombres: Map<string, string>): CajaReporteFila {
  const ventaMovs = movs.filter((m) => m.venta_id && m.tipo === "ingreso");
  const sumMedio = (pred: (m: string) => boolean) => ventaMovs.filter((x) => pred(x.medio)).reduce((a, x) => a + x.monto, 0);
  const total_efectivo = sumMedio((m) => m === "efectivo");
  const total_tarjeta = sumMedio((m) => m === "tarjeta");
  const total_pos = sumMedio((m) => m === "pos");
  const total_transferencia = sumMedio((m) => m === "transferencia");
  const total_otros = sumMedio((m) => !["efectivo", "tarjeta", "pos", "transferencia"].includes(m));
  const contado = ventaMovs.reduce((a, x) => a + x.monto, 0);

  const creditos = ventas.filter((v) => v.tipo_venta === "CREDITO" && v.estado !== "anulada");
  const total_credito = creditos.reduce((a, v) => a + v.total, 0);

  const manuales = movs.filter((m) => !m.venta_id);
  const sumMan = (tipo: string) => manuales.filter((m) => m.tipo === tipo && esEfvo(m.medio)).reduce((a, m) => a + m.monto, 0);
  const ingresos_efectivo = sumMan("ingreso");
  const egresos_efectivo = sumMan("egreso");
  const retiros_efectivo = sumMan("retiro");
  const ajustes_efectivo = sumMan("ajuste");

  const monto_apertura = num(c.monto_apertura);
  const efectivo_esperado =
    monto_apertura + total_efectivo + ingresos_efectivo - egresos_efectivo - retiros_efectivo + ajustes_efectivo;
  const contadoCierre = numONull(c.monto_cierre_contado);
  const cerrada = c.estado === "cerrada";

  return {
    id: String(c.id),
    numero_caja: num(c.numero_caja),
    estado: String(c.estado),
    fecha_apertura: String(c.fecha_apertura),
    fecha_cierre: (c.fecha_cierre as string | null) ?? null,
    abierta_por_nombre: nombres.get(String(c.abierta_por ?? "")) || null,
    cerrada_por_nombre: nombres.get(String(c.cerrada_por ?? "")) || null,
    monto_apertura,
    cantidad_ventas: new Set(ventaMovs.map((x) => x.venta_id)).size + creditos.length,
    total_vendido: contado + total_credito,
    total_efectivo,
    total_tarjeta,
    total_pos,
    total_transferencia,
    total_otros,
    total_credito,
    ingresos_efectivo,
    egresos_efectivo,
    retiros_efectivo,
    ajustes_efectivo,
    efectivo_esperado,
    monto_cierre_contado: contadoCierre,
    // Diferencia guardada al cerrar; si no quedó, se recalcula contra lo esperado.
    diferencia: !cerrada ? null : c.diferencia != null ? num(c.diferencia) : contadoCierre == null ? null : contadoCierre - efectivo_esperado,
    observacion_apertura: (c.observacion_apertura as string | null) ?? null,
    observacion_cierre: (c.observacion_cierre as string | null) ?? null,
  };
}

const aMov = (m: Fila): Mov => ({
  caja_id: String(m.caja_id),
  tipo: String(m.tipo),
  monto: num(m.monto),
  medio: String(m.medio_pago ?? "efectivo").trim().toLowerCase(),
  venta_id: m.venta_id ? String(m.venta_id) : null,
});

// ── Listado ───────────────────────────────────────────────────────────────────
export async function getReporteCajas(db: TenantDb, rango: ReturnType<typeof resolverRango>): Promise<CajasReporte> {
  const cajasRaw = await todas((a, b) =>
    db
      .select("cajas", COLS_CAJA)
      .gte("fecha_apertura", rango.start)
      .lte("fecha_apertura", rango.end)
      .order("fecha_apertura", { ascending: false })
      .order("id", { ascending: false })
      .range(a, b),
  );
  const ids = cajasRaw.map((c) => String(c.id));

  const movs: Mov[] = [];
  const ventas: VentaCred[] = [];
  // Nombres de quién abrió/cerró: no depende de los movimientos → va en paralelo.
  const nombresP = nombresUsuarios(db, cajasRaw.flatMap((c) => [String(c.abierta_por ?? ""), String(c.cerrada_por ?? "")]));
  // .in() en tandas de 150 ids (con miles de uuids la URL pasa de 8 KB y Kong/Cloudflare
  // la cortan). Las tandas, y movimientos + créditos de cada una, se piden en paralelo.
  const lotes: string[][] = [];
  for (let i = 0; i < ids.length; i += 150) lotes.push(ids.slice(i, i + 150));
  const resultados = await Promise.all(
    lotes.map((lote) =>
      Promise.all([
        todas((a, b) =>
          db
            .select("caja_movimientos", "id, caja_id, tipo, monto, medio_pago, venta_id")
            .in("caja_id", lote)
            .is("anulado_at", null)
            .order("id", { ascending: true })
            .range(a, b),
        ),
        todas((a, b) =>
          db
            .select("ventas", "id, caja_id, total, tipo_venta, estado")
            .in("caja_id", lote)
            .eq("tipo_venta", "CREDITO")
            .order("id", { ascending: true })
            .range(a, b),
        ),
      ]),
    ),
  );
  for (const [movRaw, vRaw] of resultados) {
    movs.push(...movRaw.map(aMov));
    ventas.push(...vRaw.map((v) => ({ caja_id: String(v.caja_id), total: num(v.total), tipo_venta: String(v.tipo_venta), estado: String(v.estado) })));
  }

  const nombres = await nombresP;
  const cajas = cajasRaw.map((c) =>
    armarFila(
      c,
      movs.filter((m) => m.caja_id === String(c.id)),
      ventas.filter((v) => v.caja_id === String(c.id)),
      nombres,
    ),
  );

  const suma = (k: keyof CajaReporteFila) => cajas.reduce((a, c) => a + (Number(c[k]) || 0), 0);
  const conDif = cajas.filter((c) => c.diferencia != null && c.diferencia !== 0);
  return {
    desde: rango.desde,
    hasta: rango.hasta,
    cajas,
    totales: {
      cantidad_cajas: cajas.length,
      cajas_abiertas: cajas.filter((c) => c.estado !== "cerrada").length,
      cajas_cerradas: cajas.filter((c) => c.estado === "cerrada").length,
      total_vendido: suma("total_vendido"),
      total_efectivo: suma("total_efectivo"),
      total_tarjeta: suma("total_tarjeta"),
      total_pos: suma("total_pos"),
      total_transferencia: suma("total_transferencia"),
      total_otros: suma("total_otros"),
      total_credito: suma("total_credito"),
      total_diferencia: conDif.reduce((a, c) => a + (c.diferencia ?? 0), 0),
      faltantes: conDif.filter((c) => (c.diferencia ?? 0) < 0).reduce((a, c) => a + Math.abs(c.diferencia ?? 0), 0),
      sobrantes: conDif.filter((c) => (c.diferencia ?? 0) > 0).reduce((a, c) => a + (c.diferencia ?? 0), 0),
      cajas_con_diferencia: conDif.length,
    },
  };
}

// ── Detalle de un turno ───────────────────────────────────────────────────────
export async function getDetalleCaja(db: TenantDb, id: string): Promise<CajaDetalle | null> {
  // Caja, movimientos y ventas del turno son independientes → en paralelo.
  const [cq, movRaw, vRaw] = await Promise.all([
    db.select("cajas", COLS_CAJA).eq("id", id).limit(1),
    todas((a, b) =>
      db
        .select("caja_movimientos", "id, caja_id, tipo, concepto, monto, medio_pago, venta_id, observacion, usuario_id, usuario_email, created_at")
        .eq("caja_id", id)
        .is("anulado_at", null)
        .order("created_at", { ascending: true })
        .range(a, b),
    ),
    todas((a, b) =>
      db
        .select("ventas", "id, caja_id, numero_control, fecha, total, tipo_venta, estado, metodo_pago")
        .eq("caja_id", id)
        .order("fecha", { ascending: true })
        .order("id", { ascending: true })
        .range(a, b),
    ),
  ]);
  if (cq.error) throw new Error("db");
  const c = (cq.data?.[0] ?? null) as unknown as Fila | null;
  if (!c) return null;

  const nombres = await nombresUsuarios(db, [
    String(c.abierta_por ?? ""),
    String(c.cerrada_por ?? ""),
    ...movRaw.map((m) => String(m.usuario_id ?? "")),
  ]);
  const movs = movRaw.map(aMov);
  const ventasCred = vRaw.map((v) => ({ caja_id: id, total: num(v.total), tipo_venta: String(v.tipo_venta), estado: String(v.estado) }));
  const caja = armarFila(c, movs, ventasCred, nombres);

  // Medios con que se cobró cada venta (los movimientos anulados ya están fuera).
  const mediosPorVenta = new Map<string, string[]>();
  for (const m of movs) {
    if (!m.venta_id || m.tipo !== "ingreso") continue;
    const l = mediosPorVenta.get(m.venta_id) ?? [];
    if (!l.includes(m.medio)) l.push(m.medio);
    mediosPorVenta.set(m.venta_id, l);
  }

  return {
    caja,
    ventas: vRaw.map((v) => ({
      id: String(v.id),
      numero_control: (v.numero_control as string | null) ?? null,
      fecha: String(v.fecha),
      total: num(v.total),
      tipo_venta: (v.tipo_venta as string | null) ?? null,
      estado: String(v.estado),
      metodo_pago: (v.metodo_pago as string | null) ?? null,
      medios: mediosPorVenta.get(String(v.id)) ?? [],
    })),
    movimientos: movRaw
      .filter((m) => !m.venta_id)
      .map((m) => ({
        id: String(m.id),
        tipo: String(m.tipo),
        concepto: String(m.concepto ?? ""),
        monto: num(m.monto),
        medio_pago: String(m.medio_pago ?? "efectivo"),
        observacion: (m.observacion as string | null) ?? null,
        usuario_nombre: nombres.get(String(m.usuario_id ?? "")) || null,
        usuario_email: (m.usuario_email as string | null) ?? null,
        created_at: String(m.created_at),
      })),
  };
}

/** Id del turno en /api/reportes/cajas/<id>[/pdf]. */
export function cajaIdDeUrl(url: string): string | null {
  const segs = new URL(url).pathname.split("/").filter(Boolean);
  const i = segs.indexOf("cajas");
  return i >= 0 ? (segs[i + 1] ?? null) : null;
}

// ── Etiquetas compartidas (pantalla, PDF, Excel) ──────────────────────────────
export const MEDIO_LABEL: Record<string, string> = {
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  pos: "POS",
  transferencia: "Transferencia",
  cheque: "Cheque",
  qr: "QR",
  billetera: "Billetera",
  mixto: "Mixto",
  otro: "Otro",
};
export const medioLabel = (m: string | null | undefined) => {
  const t = (m ?? "").trim().toLowerCase();
  return MEDIO_LABEL[t] ?? (t ? t[0].toUpperCase() + t.slice(1) : "—");
};
export const estadoCajaLabel = (e: string) => (e === "cerrada" ? "Cerrada" : e === "en_cierre" ? "En cierre" : "Abierta");
