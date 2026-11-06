/**
 * Importar el padrón de funcionarios desde Excel (solo servidor). Patrón "preview = commit":
 * la vista previa y la confirmación arman el mismo plan desde el archivo; el servidor nunca
 * confía en lo que mandó el navegador. Un funcionario es un cliente (es_funcionario = true);
 * el cruce es por CI (documento, solo dígitos). Celda vacía no borra nada.
 *
 * Columnas (flexibles por alias): Nombre y apellido · CI/Cédula. La empresa contratante se
 * elige aparte (empresa_id) y se asigna a todas las filas del archivo.
 */
import type { TenantDb } from "@/lib/api/tenant-db";
import { leerPlanilla, MAX_FILAS_EXCEL, tomar, type Celda, type FilaPlanilla } from "@/modules/inventario/server/excel-io";

export const COLUMNAS_EXCEL_FUNCIONARIOS = [
  { header: "Nombre y apellido", width: 34 },
  { header: "CI", width: 16 },
] as const;

export const EJEMPLO_PLANTILLA_FUNCIONARIOS: (string | number)[] = ["Juan Pérez González", "4123456"];

export type AccionFila = "INSERT" | "UPDATE" | "SKIP" | "ERROR";
export type FilaPreview = { row_number: number; action: AccionFila; warnings: string[]; errors: string[]; data: Record<string, string> };
export type PreviewPadron = {
  summary: { total: number; insertar: number; actualizar: number; omitir: number; errores: number; warnings: number; notas: string[] };
  rows: FilaPreview[];
};

type Operacion =
  | { tipo: "INSERT"; fila: number; nombre: string; documento: string | null }
  | { tipo: "UPDATE"; fila: number; id: string; patch: { nombre?: string } };

export type Plan = PreviewPadron & { _ops: Operacion[]; _empresaId: string };

const celda = (v: Celda) => (v == null ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).replace(/\s+/g, " ").trim());
export const soloDigitos = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "");
export const claveNombre = (s: string | null | undefined) =>
  String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
const filaVacia = (f: FilaPlanilla) => Object.values(f).every((v) => v == null || String(v).trim() === "");

type Existente = { id: string; nombre: string; documento: string | null; es_funcionario: boolean };

async function traerTodo(db: TenantDb): Promise<Existente[]> {
  const out: Existente[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await db.select("clientes", "id, nombre, documento, es_funcionario").order("id", { ascending: true }).range(desde, desde + 999);
    if (error) throw new Error("db");
    const tanda = (data ?? []) as unknown as Existente[];
    out.push(...tanda);
    if (tanda.length < 1000) break;
  }
  return out;
}

export async function armarPlan(db: TenantDb, buf: ArrayBuffer, empresaId: string): Promise<Plan> {
  const filas = leerPlanilla(buf);
  if (filas.length > MAX_FILAS_EXCEL) throw new Error(`El archivo tiene ${filas.length} filas (máx. ${MAX_FILAS_EXCEL.toLocaleString("es-PY")}).`);

  const existentes = await traerTodo(db);
  const porCi = new Map<string, Existente>();
  for (const e of existentes) {
    const k = soloDigitos(e.documento);
    if (k && !porCi.has(k)) porCi.set(k, e);
  }

  const vistosCi = new Map<string, number>();
  const vistosId = new Map<string, number>();
  const rows: FilaPreview[] = [];
  const ops: Operacion[] = [];

  filas.forEach((f, i) => {
    if (filaVacia(f)) return;
    const row_number = i + 2;
    const errors: string[] = [];
    const warnings: string[] = [];
    const t = (...alias: string[]) => celda(tomar(f, ...alias));
    const nombre = t("NOMBRE_Y_APELLIDO", "NOMBRE_Y_APELLIDO_", "NOMBRE", "APELLIDO_Y_NOMBRE", "FUNCIONARIO", "NOMBRES");
    const ciRaw = t("CI", "CEDULA", "CEDULA_DE_IDENTIDAD", "CI_N", "CIN", "DOCUMENTO", "NRO_CI", "N_CI");
    const ci = soloDigitos(ciRaw);
    const data: Record<string, string> = { Nombre: nombre || "—", CI: ci || ciRaw || "—" };

    if (!nombre) errors.push("Falta el nombre y apellido");
    if (nombre.length > 200) errors.push("Nombre: máximo 200 caracteres");
    if (!ci) errors.push("Falta la cédula (CI)");
    else if (ci.length < 3 || ci.length > 15) errors.push(`CI inválida: ${ciRaw}`);

    if (ci && vistosCi.has(ci)) errors.push(`CI repetida en el archivo (fila ${vistosCi.get(ci)})`);

    const match = ci ? porCi.get(ci) : undefined;
    if (match && vistosId.has(match.id)) errors.push(`Este funcionario ya se actualiza en la fila ${vistosId.get(match.id)}`);

    if (errors.length) {
      rows.push({ row_number, action: "ERROR", warnings, errors, data });
      return;
    }
    if (ci) vistosCi.set(ci, row_number);
    if (match) vistosId.set(match.id, row_number);

    if (!match) {
      rows.push({ row_number, action: "INSERT", warnings, errors, data });
      ops.push({ tipo: "INSERT", fila: row_number, nombre, documento: ci });
      return;
    }

    // Ya existe (funcionario o cliente común): se asegura es_funcionario + empresa, y se corrige el nombre si cambió.
    const patch: { nombre?: string } = {};
    if (claveNombre(nombre) !== claveNombre(match.nombre)) patch.nombre = nombre;
    data["Coincide con"] = `${match.nombre}${match.documento ? ` (${match.documento})` : ""}`;
    if (!match.es_funcionario) warnings.push("Era cliente: pasa a funcionario");
    if (!Object.keys(patch).length && match.es_funcionario) {
      data.Cambios = "ninguno (solo empresa/estado)";
    } else if (patch.nombre) {
      data.Cambios = "nombre";
    }
    rows.push({ row_number, action: "UPDATE", warnings, errors, data });
    ops.push({ tipo: "UPDATE", fila: row_number, id: match.id, patch });
  });

  const cuenta = (a: AccionFila) => rows.filter((r) => r.action === a).length;
  return {
    summary: {
      total: rows.length,
      insertar: cuenta("INSERT"),
      actualizar: cuenta("UPDATE"),
      omitir: cuenta("SKIP"),
      errores: cuenta("ERROR"),
      warnings: rows.reduce((a, r) => a + r.warnings.length, 0),
      notas: [],
    },
    rows,
    _ops: ops,
    _empresaId: empresaId,
  };
}

export function vistaPrevia(plan: Plan): PreviewPadron {
  return { summary: plan.summary, rows: plan.rows };
}

export type ResultadoImport = {
  summary: { total: number; inserted: number; updated: number; skipped: number; errors: number; warnings: number };
  errors: string[];
};

async function enParalelo<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

export async function aplicarPlan(db: TenantDb, plan: Plan, usuarioId: string): Promise<ResultadoImport> {
  const errores: string[] = plan.rows.filter((r) => r.action === "ERROR").map((r) => `Fila ${r.row_number}: ${r.errors.join("; ")}`);
  const emp = plan._empresaId;
  let insertados = 0;
  let actualizados = 0;

  // Altas en tandas.
  const altas = plan._ops.filter((o): o is Extract<Operacion, { tipo: "INSERT" }> => o.tipo === "INSERT");
  const fila = (o: Extract<Operacion, { tipo: "INSERT" }>) => ({
    nombre: o.nombre,
    documento: o.documento,
    tipo_cliente: "persona",
    es_funcionario: true,
    comedor_empresa_id: emp,
    activo: true,
    created_by: usuarioId,
  });
  for (let i = 0; i < altas.length; i += 500) {
    const tanda = altas.slice(i, i + 500);
    const ins = await db.insert("clientes", tanda.map(fila));
    if (!ins.error) {
      insertados += tanda.length;
      continue;
    }
    // Si la tanda choca (p.ej. documento duplicado por carrera), una por una.
    for (const o of tanda) {
      const uno = await db.insert("clientes", fila(o));
      if (uno.error) {
        errores.push(`Fila ${o.fila}: ${/duplicate|unique/i.test(uno.error.message) ? "ya existe un cliente con esa CI" : "no se pudo crear"}`);
        continue;
      }
      insertados++;
    }
  }

  // Actualizaciones: nombre (si cambió) + asegurar es_funcionario y empresa.
  const cambios = plan._ops.filter((o): o is Extract<Operacion, { tipo: "UPDATE" }> => o.tipo === "UPDATE");
  await enParalelo(cambios, 8, async (o) => {
    const { error } = await db
      .update("clientes", { ...o.patch, es_funcionario: true, comedor_empresa_id: emp, updated_at: new Date().toISOString() })
      .eq("id", o.id);
    if (error) {
      errores.push(`Fila ${o.fila}: no se pudo actualizar`);
      return;
    }
    actualizados++;
  });

  return {
    summary: {
      total: plan.summary.total,
      inserted: insertados,
      updated: actualizados,
      skipped: plan.summary.omitir,
      errors: errores.length,
      warnings: plan.summary.warnings,
    },
    errors: errores.slice(0, 100),
  };
}
