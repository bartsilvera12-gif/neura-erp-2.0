/**
 * Importar proveedores desde Excel. Solo servidor.
 *   - Mismas columnas que el "Exportar Excel" (export → editar → importar funciona).
 *   - Cruce con lo existente: primero el RUC (sin puntos/guion/espacios), si no la razón
 *     social sin distinguir mayúsculas ni tildes.
 *   - Fila nueva → alta. Fila que cruza → se actualizan SOLO las columnas con valor
 *     (una celda vacía no borra nada). Rubros por nombre: los que falten se crean.
 *   - La vista previa y la confirmación arman el mismo plan desde el archivo (el servidor
 *     nunca confía en lo que mandó el navegador).
 */
import { z } from "zod";
import type { TenantDb } from "@/lib/api/tenant-db";
import { leerPlanilla, MAX_FILAS_EXCEL, tomar, type Celda, type FilaPlanilla } from "@/modules/inventario/server/excel-io";
import { errorProveedor } from "@/modules/proveedores/server";

/** Encabezados del Excel (iguales a los de /api/proveedores/export). "Compras" se ignora al importar. */
export const COLUMNAS_EXCEL_PROVEEDORES = [
  { header: "Razón social", width: 36 },
  { header: "Nombre comercial", width: 28 },
  { header: "RUC", width: 16 },
  { header: "Teléfono", width: 16 },
  { header: "Email", width: 28 },
  { header: "Dirección", width: 32 },
  { header: "Ciudad", width: 16 },
  { header: "Contacto", width: 22 },
  { header: "Tel. contacto", width: 16 },
  { header: "Condición", width: 16 },
  { header: "Moneda", width: 9 },
  { header: "Rubros", width: 28 },
  { header: "Compras", width: 10 },
  { header: "Estado", width: 10 },
  { header: "Observaciones", width: 36 },
] as const;

export const EJEMPLO_PLANTILLA: (string | number)[] = [
  "DISTRIBUIDORA EJEMPLO S.A.", "Distribuidora Ejemplo", "80012345-6", "021 555 123", "ventas@ejemplo.com.py",
  "Av. Mcal. López 1234", "Asunción", "Juan Pérez", "0981 123 456", "Crédito 30 días", "GS", "Bebidas, Limpieza",
  "", "Activo", "Entrega martes y jueves",
];

export type AccionFila = "INSERT" | "UPDATE" | "SKIP" | "ERROR";
export type FilaPreview = { row_number: number; action: AccionFila; warnings: string[]; errors: string[]; data: Record<string, string> };
export type PreviewProveedores = {
  summary: { total: number; insertar: number; actualizar: number; omitir: number; errores: number; warnings: number; notas: string[] };
  rows: FilaPreview[];
};

type Campos = {
  nombre: string;
  nombre_comercial: string | null;
  ruc: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  ciudad: string | null;
  contacto: string | null;
  contacto_telefono: string | null;
  condicion_pago: "contado" | "credito" | null;
  plazo_pago_dias: number | null;
  moneda: "GS" | "USD" | null;
  activo: boolean | null;
  observaciones: string | null;
};
type Existente = Omit<Campos, "condicion_pago" | "moneda" | "activo"> & {
  id: string;
  condicion_pago: "contado" | "credito";
  moneda: "GS" | "USD";
  activo: boolean;
};

/** Lo que se aplica al confirmar (no viaja al navegador). */
type Operacion =
  | { tipo: "INSERT"; fila: number; datos: Campos; rubros: string[] | null }
  | { tipo: "UPDATE"; fila: number; id: string; patch: Partial<Campos>; rubros: string[] | null };

export type Plan = PreviewProveedores & { _ops: Operacion[]; _rubrosNuevos: string[]; _rubros: Map<string, string> };

// ── Normalización ─────────────────────────────────────────────────────────────
export const claveRuc = (s: string | null | undefined) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
export const claveNombre = (s: string | null | undefined) =>
  String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
const celda = (v: Celda) => (v == null ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).replace(/\s+/g, " ").trim());
const vacioANull = (s: string) => (s ? s : null);
const emailOk = z.string().email();

const MAX: Partial<Record<keyof Campos, number>> = {
  nombre: 200, nombre_comercial: 200, ruc: 30, telefono: 40, email: 120, direccion: 200, ciudad: 80,
  contacto: 120, contacto_telefono: 40, observaciones: 1000,
};
const ETIQUETA: Record<keyof Campos, string> = {
  nombre: "razón social", nombre_comercial: "nombre comercial", ruc: "RUC", telefono: "teléfono", email: "email",
  direccion: "dirección", ciudad: "ciudad", contacto: "contacto", contacto_telefono: "tel. contacto",
  condicion_pago: "condición", plazo_pago_dias: "plazo", moneda: "moneda", activo: "estado", observaciones: "observaciones",
};

function parsearCondicion(s: string, plazoCol: string): { condicion: Campos["condicion_pago"]; plazo: number | null; error?: string } {
  const t = claveNombre(s);
  const plazoTxt = plazoCol.replace(/\D/g, "");
  if (!t) {
    if (plazoTxt) return { condicion: "credito", plazo: Math.min(3650, Number(plazoTxt)) };
    return { condicion: null, plazo: null };
  }
  if (t.startsWith("contado")) return { condicion: "contado", plazo: null };
  if (t.startsWith("credito")) {
    const n = (plazoTxt || /(\d+)/.exec(t)?.[1]) ?? "";
    const plazo = n ? Number(n) : null;
    if (plazo != null && plazo > 3650) return { condicion: null, plazo: null, error: "El plazo no puede pasar de 3650 días" };
    return { condicion: "credito", plazo };
  }
  return { condicion: null, plazo: null, error: `Condición «${s}» no se entiende (usá "Contado" o "Crédito 30 días")` };
}

function parsearMoneda(s: string): { moneda: Campos["moneda"]; error?: string } {
  const t = claveNombre(s).replace(/[.\s₲]/g, "");
  if (!t) return { moneda: null };
  if (["gs", "pyg", "guarani", "guaranies"].includes(t)) return { moneda: "GS" };
  if (["usd", "us$", "u$s", "dolar", "dolares", "us"].includes(t)) return { moneda: "USD" };
  return { moneda: null, error: `Moneda «${s}» no se entiende (usá GS o USD)` };
}

function parsearEstado(s: string): { activo: boolean | null; error?: string } {
  const t = claveNombre(s);
  if (!t) return { activo: null };
  if (["activo", "activa", "si", "1", "true", "yes"].includes(t)) return { activo: true };
  if (["inactivo", "inactiva", "no", "0", "false"].includes(t)) return { activo: false };
  return { activo: null, error: `Estado «${s}» no se entiende (usá Activo o Inactivo)` };
}

/** "Bebidas, Limpieza; Ferretería" → nombres sin repetir (null si la celda está vacía). */
function parsearRubros(s: string): { rubros: string[] | null; error?: string } {
  if (!s) return { rubros: null };
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const r of s.split(/[,;|/]/).map((x) => x.trim()).filter(Boolean)) {
    if (r.length > 60) return { rubros: null, error: `El rubro «${r.slice(0, 30)}…» es muy largo (máx. 60)` };
    const k = claveNombre(r);
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(r);
  }
  if (out.length > 20) return { rubros: null, error: "Máximo 20 rubros por proveedor" };
  return { rubros: out.length ? out : null };
}

function parsearFila(f: FilaPlanilla) {
  const errors: string[] = [];
  const t = (...alias: string[]) => celda(tomar(f, ...alias));
  const datos: Campos = {
    nombre: t("RAZON_SOCIAL", "NOMBRE", "PROVEEDOR"),
    nombre_comercial: vacioANull(t("NOMBRE_COMERCIAL", "FANTASIA", "NOMBRE_FANTASIA")),
    ruc: vacioANull(t("RUC", "RUC_CI", "CI")),
    telefono: vacioANull(t("TELEFONO", "TEL", "CELULAR")),
    email: vacioANull(t("EMAIL", "CORREO", "E_MAIL", "MAIL").toLowerCase()),
    direccion: vacioANull(t("DIRECCION", "DOMICILIO")),
    ciudad: vacioANull(t("CIUDAD", "LOCALIDAD")),
    contacto: vacioANull(t("CONTACTO", "VENDEDOR")),
    contacto_telefono: vacioANull(t("TEL_CONTACTO", "TELEFONO_CONTACTO", "CONTACTO_TELEFONO")),
    condicion_pago: null,
    plazo_pago_dias: null,
    moneda: null,
    activo: null,
    observaciones: vacioANull(t("OBSERVACIONES", "OBSERVACION", "NOTAS")),
  };
  const cond = parsearCondicion(t("CONDICION", "CONDICION_PAGO"), t("PLAZO", "PLAZO_DIAS", "PLAZO_PAGO_DIAS"));
  if (cond.error) errors.push(cond.error);
  datos.condicion_pago = cond.condicion;
  datos.plazo_pago_dias = cond.plazo;
  const mon = parsearMoneda(t("MONEDA"));
  if (mon.error) errors.push(mon.error);
  datos.moneda = mon.moneda;
  const est = parsearEstado(t("ESTADO", "ACTIVO"));
  if (est.error) errors.push(est.error);
  datos.activo = est.activo;
  const rub = parsearRubros(t("RUBROS", "RUBRO", "CATEGORIAS", "CATEGORIA"));
  if (rub.error) errors.push(rub.error);

  if (!datos.nombre) errors.push("Falta la razón social");
  if (datos.email && !emailOk.safeParse(datos.email).success) errors.push(`Email inválido: ${datos.email}`);
  for (const [k, max] of Object.entries(MAX) as [keyof Campos, number][]) {
    const v = datos[k];
    if (typeof v === "string" && v.length > max) errors.push(`${ETIQUETA[k]}: máximo ${max} caracteres`);
  }
  if (datos.ruc && !claveRuc(datos.ruc)) errors.push("RUC inválido");
  return { datos, rubros: rub.rubros, errors };
}

/** Fila vacía (todas las columnas en blanco): se saltea sin contarla. */
const filaVacia = (f: FilaPlanilla) => Object.values(f).every((v) => v == null || String(v).trim() === "");

// ── Datos existentes ──────────────────────────────────────────────────────────
async function traerTodo<T>(db: TenantDb, tabla: string, cols: string, orden: string[]): Promise<T[]> {
  const out: T[] = [];
  for (let desde = 0; ; desde += 1000) {
    let q = db.select(tabla, cols);
    for (const o of orden) q = q.order(o, { ascending: true });
    const { data, error } = await q.range(desde, desde + 999);
    if (error) throw new Error("db");
    const tanda = (data ?? []) as unknown as T[];
    out.push(...tanda);
    if (tanda.length < 1000) break;
  }
  return out;
}

const COLS_EXISTENTE =
  "id, nombre, nombre_comercial, ruc, telefono, email, direccion, ciudad, contacto, contacto_telefono, condicion_pago, plazo_pago_dias, moneda, activo, observaciones";

// ── Plan (vista previa = confirmación) ────────────────────────────────────────
export async function armarPlan(db: TenantDb, buf: ArrayBuffer): Promise<Plan> {
  const filas = leerPlanilla(buf);
  if (filas.length > MAX_FILAS_EXCEL) throw new Error(`El archivo tiene ${filas.length} filas (máx. ${MAX_FILAS_EXCEL.toLocaleString("es-PY")}).`);

  const [existentes, categorias, rels] = await Promise.all([
    traerTodo<Existente>(db, "proveedores", COLS_EXISTENTE, ["id"]),
    traerTodo<{ id: string; nombre: string }>(db, "proveedor_categorias", "id, nombre", ["id"]),
    traerTodo<{ proveedor_id: string; categoria_id: string }>(db, "proveedor_categoria_rel", "proveedor_id, categoria_id", ["proveedor_id", "categoria_id"]),
  ]);
  const porRuc = new Map<string, Existente>();
  const porNombre = new Map<string, Existente>();
  for (const p of existentes) {
    const kr = claveRuc(p.ruc);
    if (kr) porRuc.set(kr, p);
    const kn = claveNombre(p.nombre);
    if (kn && !porNombre.has(kn)) porNombre.set(kn, p);
  }
  const rubros = new Map<string, string>(); // clave → id
  const nombreRubro = new Map<string, string>(); // id → nombre
  for (const c of categorias) {
    rubros.set(claveNombre(c.nombre), c.id);
    nombreRubro.set(c.id, c.nombre);
  }
  const rubrosDe = new Map<string, Set<string>>();
  for (const r of rels) {
    const n = nombreRubro.get(r.categoria_id);
    if (!n) continue;
    if (!rubrosDe.has(r.proveedor_id)) rubrosDe.set(r.proveedor_id, new Set());
    rubrosDe.get(r.proveedor_id)!.add(claveNombre(n));
  }

  const rubrosNuevos = new Map<string, string>(); // clave → nombre tal cual se escribió
  const vistosRuc = new Map<string, number>();
  const vistosNombre = new Map<string, number>();
  const vistosId = new Map<string, number>();
  const rows: FilaPreview[] = [];
  const ops: Operacion[] = [];

  filas.forEach((f, i) => {
    if (filaVacia(f)) return;
    const row_number = i + 2;
    const { datos, rubros: rubrosFila, errors } = parsearFila(f);
    const warnings: string[] = [];
    const data: Record<string, string> = { "Razón social": datos.nombre || "—" };
    if (datos.ruc) data.RUC = datos.ruc;

    const kr = claveRuc(datos.ruc);
    const kn = claveNombre(datos.nombre);
    if (kr && vistosRuc.has(kr)) errors.push(`RUC repetido en el archivo (fila ${vistosRuc.get(kr)})`);
    else if (kn && vistosNombre.has(kn)) errors.push(`Razón social repetida en el archivo (fila ${vistosNombre.get(kn)})`);

    // Cruce: RUC; si no, nombre (solo si no choca con otro RUC ya cargado).
    let match: Existente | undefined = kr ? porRuc.get(kr) : undefined;
    if (!match && kn) {
      const porN = porNombre.get(kn);
      if (porN) {
        if (kr && claveRuc(porN.ruc) && claveRuc(porN.ruc) !== kr) {
          errors.push(`Ya hay un proveedor «${porN.nombre}» con otro RUC (${porN.ruc}). Corregí el RUC o la razón social.`);
        } else match = porN;
      }
    }
    if (match && vistosId.has(match.id)) errors.push(`Este proveedor ya se actualiza en la fila ${vistosId.get(match.id)}`);

    if (errors.length) {
      rows.push({ row_number, action: "ERROR", warnings, errors, data });
      return;
    }
    // Solo las filas válidas "ocupan" su RUC / nombre / proveedor para las siguientes.
    if (kr) vistosRuc.set(kr, row_number);
    if (kn) vistosNombre.set(kn, row_number);
    if (match) vistosId.set(match.id, row_number);

    // Rubros que todavía no existen (se crean al confirmar).
    for (const r of rubrosFila ?? []) {
      const k = claveNombre(r);
      if (!rubros.has(k) && !rubrosNuevos.has(k)) rubrosNuevos.set(k, r);
    }

    if (!match) {
      if (datos.condicion_pago === "credito" && datos.plazo_pago_dias == null) warnings.push("Crédito sin plazo: se guarda sin días");
      data.Rubros = (rubrosFila ?? []).join(", ") || "—";
      rows.push({ row_number, action: "INSERT", warnings, errors, data });
      ops.push({ tipo: "INSERT", fila: row_number, datos, rubros: rubrosFila });
      return;
    }

    // Actualización: solo columnas con valor y que cambian.
    const patch: Partial<Campos> = {};
    const cambios: string[] = [];
    const set = <K extends keyof Campos>(k: K, v: Campos[K]) => {
      if (v == null || v === "") return;
      const actual = match[k as keyof Existente] as unknown;
      const igual = typeof v === "string" ? String(actual ?? "") === v : actual === v;
      if (igual) return;
      (patch as Record<string, unknown>)[k] = v;
      cambios.push(ETIQUETA[k]);
    };
    // La razón social cruzada por nombre que solo difiere en mayúsculas/tildes no se pisa.
    if (claveNombre(datos.nombre) !== claveNombre(match.nombre)) set("nombre", datos.nombre);
    for (const k of ["nombre_comercial", "ruc", "telefono", "email", "direccion", "ciudad", "contacto", "contacto_telefono", "moneda", "activo", "observaciones"] as const) {
      set(k, datos[k]);
    }
    if (datos.condicion_pago) {
      const plazo = datos.condicion_pago === "credito" ? datos.plazo_pago_dias : null;
      if (datos.condicion_pago !== match.condicion_pago || (plazo ?? null) !== (match.plazo_pago_dias ?? null)) {
        patch.condicion_pago = datos.condicion_pago;
        patch.plazo_pago_dias = plazo;
        cambios.push("condición");
      }
    }
    let rubrosCambian: string[] | null = null;
    if (rubrosFila) {
      const actuales = rubrosDe.get(match.id) ?? new Set<string>();
      const nuevos = new Set(rubrosFila.map(claveNombre));
      if (actuales.size !== nuevos.size || [...nuevos].some((k) => !actuales.has(k))) {
        rubrosCambian = rubrosFila;
        cambios.push("rubros");
      }
    }
    if (datos.ruc && claveRuc(datos.ruc) === claveRuc(match.ruc) && patch.ruc) {
      delete patch.ruc; // mismo RUC escrito distinto (con/sin guion): no se toca
      cambios.splice(cambios.indexOf("RUC"), 1);
    }
    data["Coincide con"] = `${match.nombre}${match.ruc ? ` (${match.ruc})` : ""}`;
    if (!cambios.length) {
      data.Cambios = "ninguno";
      rows.push({ row_number, action: "SKIP", warnings: ["Sin cambios"], errors, data });
      return;
    }
    data.Cambios = cambios.join(", ");
    rows.push({ row_number, action: "UPDATE", warnings, errors, data });
    ops.push({ tipo: "UPDATE", fila: row_number, id: match.id, patch, rubros: rubrosCambian });
  });

  const cuenta = (a: AccionFila) => rows.filter((r) => r.action === a).length;
  const notas: string[] = [];
  if (rubrosNuevos.size) {
    const lista = [...rubrosNuevos.values()];
    notas.push(`Se van a crear ${lista.length} rubro(s) nuevo(s): ${lista.slice(0, 10).join(", ")}${lista.length > 10 ? "…" : ""}`);
  }
  return {
    summary: {
      total: rows.length,
      insertar: cuenta("INSERT"),
      actualizar: cuenta("UPDATE"),
      omitir: cuenta("SKIP"),
      errores: cuenta("ERROR"),
      warnings: rows.reduce((a, r) => a + (r.action === "SKIP" ? 0 : r.warnings.length), 0),
      notas,
    },
    rows,
    _ops: ops,
    _rubrosNuevos: [...rubrosNuevos.values()],
    _rubros: rubros,
  };
}

/** Vista previa pública (sin lo que se manda a la base). */
export function vistaPrevia(plan: Plan): PreviewProveedores {
  return { summary: plan.summary, rows: plan.rows };
}

// ── Confirmación ──────────────────────────────────────────────────────────────
export type ResultadoImport = {
  summary: { total: number; inserted: number; updated: number; skipped: number; errors: number; warnings: number; categorias_creadas: number };
  errors: string[];
};

async function enParalelo<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

export async function aplicarPlan(db: TenantDb, plan: Plan): Promise<ResultadoImport> {
  const errores: string[] = plan.rows.filter((r) => r.action === "ERROR").map((r) => `Fila ${r.row_number}: ${r.errors.join("; ")}`);
  let categoriasCreadas = 0;

  // 1) Rubros que faltan.
  const rubros = plan._rubros;
  if (plan._rubrosNuevos.length) {
    const ins = await db.insert("proveedor_categorias", plan._rubrosNuevos.map((nombre) => ({ nombre })));
    if (!ins.error) categoriasCreadas = ins.data?.length ?? 0;
    // Si chocó (alguien lo creó recién) se vuelve a leer: alcanza con que exista.
    const { data } = await db.select("proveedor_categorias", "id, nombre");
    for (const c of (data ?? []) as unknown as { id: string; nombre: string }[]) rubros.set(claveNombre(c.nombre), c.id);
  }

  const rubrosPorProveedor: { id: string; rubros: string[] }[] = [];
  let insertados = 0;
  let actualizados = 0;

  // 2) Altas en tandas; si una tanda falla, una por una para saber cuál.
  const altas = plan._ops.filter((o): o is Extract<Operacion, { tipo: "INSERT" }> => o.tipo === "INSERT");
  const fila = (o: Extract<Operacion, { tipo: "INSERT" }>) => ({
    ...o.datos,
    condicion_pago: o.datos.condicion_pago ?? "contado",
    plazo_pago_dias: o.datos.condicion_pago === "credito" ? o.datos.plazo_pago_dias : null,
    moneda: o.datos.moneda ?? "GS",
    activo: o.datos.activo ?? true,
  });
  for (let i = 0; i < altas.length; i += 500) {
    const tanda = altas.slice(i, i + 500);
    const ins = await db.insert("proveedores", tanda.map(fila));
    if (!ins.error) {
      const porNombre = new Map(((ins.data ?? []) as { id: string; nombre: string }[]).map((p) => [claveNombre(p.nombre), p.id]));
      insertados += tanda.length;
      for (const o of tanda) {
        const id = porNombre.get(claveNombre(o.datos.nombre));
        if (id && o.rubros) rubrosPorProveedor.push({ id, rubros: o.rubros });
      }
      continue;
    }
    for (const o of tanda) {
      const uno = await db.insert("proveedores", fila(o));
      const id = (uno.data?.[0] as { id?: string } | undefined)?.id;
      if (uno.error || !id) {
        errores.push(`Fila ${o.fila}: ${errorProveedor(uno.error?.message ?? "")}`);
        continue;
      }
      insertados++;
      if (o.rubros) rubrosPorProveedor.push({ id, rubros: o.rubros });
    }
  }

  // 3) Actualizaciones (solo lo que cambió).
  const cambios = plan._ops.filter((o): o is Extract<Operacion, { tipo: "UPDATE" }> => o.tipo === "UPDATE");
  await enParalelo(cambios, 8, async (o) => {
    const campos = Object.keys(o.patch).length;
    if (campos) {
      const { error } = await db.update("proveedores", { ...o.patch, updated_at: new Date().toISOString() }).eq("id", o.id);
      if (error) {
        errores.push(`Fila ${o.fila}: ${errorProveedor(error.message)}`);
        return;
      }
    }
    actualizados++;
    if (o.rubros) rubrosPorProveedor.push({ id: o.id, rubros: o.rubros });
  });

  // 4) Rubros de cada proveedor tocado: quedan exactamente los del archivo.
  for (let i = 0; i < rubrosPorProveedor.length; i += 200) {
    const tanda = rubrosPorProveedor.slice(i, i + 200);
    const del = await db.delete("proveedor_categoria_rel").in("proveedor_id", tanda.map((t) => t.id));
    if (del.error) {
      errores.push("No se pudieron actualizar los rubros de algunos proveedores.");
      continue;
    }
    const rels = tanda.flatMap((t) => {
      const ids = new Set(t.rubros.map((r) => rubros.get(claveNombre(r))).filter((x): x is string => !!x));
      return [...ids].map((categoria_id) => ({ proveedor_id: t.id, categoria_id }));
    });
    if (rels.length) {
      const ins = await db.insert("proveedor_categoria_rel", rels);
      if (ins.error) errores.push("No se pudieron guardar los rubros de algunos proveedores.");
    }
  }

  return {
    summary: {
      total: plan.summary.total,
      inserted: insertados,
      updated: actualizados,
      skipped: plan.summary.omitir,
      errors: errores.length,
      warnings: plan.summary.warnings,
      categorias_creadas: categoriasCreadas,
    },
    errors: errores.slice(0, 100),
  };
}
