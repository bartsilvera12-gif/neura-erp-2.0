/**
 * Reporte "Existencias por depósito" — lado servidor (reporte_existencias y
 * reporte_existencias_celda, receta 80). Filtros de la URL compartidos por la pantalla, el
 * Excel y el PDF: sucursal, deposito, categoria, tipo, todos=1 (incluye sin stock), bajo=1, q.
 */
import type { TenantDb } from "@/lib/api/tenant-db";
import type { ReporteExistencias } from "@/modules/reportes/existencias";
import { uuidONull } from "@/modules/inventario/server/rpc";

export * from "@/modules/reportes/existencias";

export type FiltrosExistencias = {
  sucursal: string | null; deposito: string | null; categoria: string | null; tipo: string | null;
  soloStock: boolean; bajoMinimo: boolean; q: string;
};

const RE_UUID = /^[0-9a-f-]{36}$/i;

export function filtrosExistencias(sp: URLSearchParams): FiltrosExistencias {
  const cat = sp.get("categoria") ?? "";
  const tipo = sp.get("tipo") ?? "";
  return {
    sucursal: uuidONull(sp.get("sucursal")),
    deposito: uuidONull(sp.get("deposito")),
    categoria: cat === "__sin__" || RE_UUID.test(cat) ? cat : null,
    tipo: tipo === "reventa" || tipo === "materia_prima" || tipo === "fabricado" ? tipo : null,
    soloStock: sp.get("todos") !== "1",
    bajoMinimo: sp.get("bajo") === "1",
    q: (sp.get("q") ?? "").slice(0, 120),
  };
}

/** "Casa central · Depósito principal · Categoría: Bebidas · Solo con stock · Búsqueda: «leche»" (PDF / Excel). */
export async function describirFiltrosExistencias(db: TenantDb, r: ReporteExistencias, f: FiltrosExistencias) {
  let cat: string | null = null;
  if (f.categoria && f.categoria !== "__sin__") {
    const c = await db.rpc<string>("categoria_ruta", { p_id: f.categoria });
    cat = c.data ?? null;
  }
  const dep = f.deposito ? r.opciones_depositos.find((d) => d.id === f.deposito) : null;
  return [
    r.sucursal_id ? (r.sucursales.find((s) => s.id === r.sucursal_id)?.nombre ?? "Sucursal") : "Todas las sucursales",
    dep ? dep.nombre : null,
    f.categoria ? `Categoría: ${f.categoria === "__sin__" ? "Sin categoría" : (cat ?? "—")}` : null,
    r.recetas && f.tipo ? (f.tipo === "materia_prima" ? "Materias primas" : f.tipo === "fabricado" ? "Fabricados" : "Reventa") : null,
    f.soloStock ? "Solo con stock" : "Incluye sin stock",
    f.bajoMinimo ? "Bajo el mínimo" : null,
    f.q ? `Búsqueda: «${f.q}»` : null,
  ].filter(Boolean).join(" · ");
}

export async function reporteExistencias(db: TenantDb, f: FiltrosExistencias): Promise<ReporteExistencias> {
  const { data, error } = await db.rpc<ReporteExistencias>("reporte_existencias", {
    p_sucursal: f.sucursal, p_deposito: f.deposito, p_categoria: f.categoria, p_tipo: f.tipo,
    p_solo_stock: f.soloStock, p_bajo_minimo: f.bajoMinimo,
  });
  if (error || !data) throw new Error(error?.message ?? "sin datos");
  return data;
}
