/** Proveedores — lado servidor: lista completa con rubros y compras. Solo servidor. */
import type { TenantDb } from "@/lib/api/tenant-db";
import { COLS_PROVEEDOR, COLS_PROVEEDOR_MIN, type CategoriaProveedor, type Proveedor, type ProveedorMin } from "@/modules/proveedores/tipos";

type Fila = Omit<Proveedor, "categorias" | "compras" | "ultima_compra">;

export async function listarProveedores(db: TenantDb): Promise<Proveedor[]> {
  const [p, c, r, k] = await Promise.all([
    db.select("proveedores", COLS_PROVEEDOR).order("nombre", { ascending: true }).limit(5000),
    db.select("proveedor_categorias", "id, nombre, activo").order("nombre", { ascending: true }),
    db.select("proveedor_categoria_rel", "proveedor_id, categoria_id"),
    db.rpc<{ proveedor_id: string; compras: number; ultima: string }[]>("compras_por_proveedor"),
  ]);
  if (p.error || c.error || r.error) throw new Error("db");
  const cats = new Map(((c.data ?? []) as unknown as CategoriaProveedor[]).map((x) => [x.id, x]));
  const porProv = new Map<string, CategoriaProveedor[]>();
  for (const rel of (r.data ?? []) as unknown as { proveedor_id: string; categoria_id: string }[]) {
    const cat = cats.get(rel.categoria_id);
    if (!cat) continue;
    porProv.set(rel.proveedor_id, [...(porProv.get(rel.proveedor_id) ?? []), cat]);
  }
  const compras = new Map((k.data ?? []).map((x) => [x.proveedor_id, x]));
  return ((p.data ?? []) as unknown as Fila[]).map((f) => ({
    ...f,
    categorias: (porProv.get(f.id) ?? []).sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
    compras: Number(compras.get(f.id)?.compras ?? 0),
    ultima_compra: compras.get(f.id)?.ultima ?? null,
  }));
}

/**
 * Lista liviana (selector y filtros): una sola consulta, sin rubros ni el agregado de
 * compras. Mismo orden y tope que la completa.
 */
export async function listarProveedoresMin(db: TenantDb): Promise<ProveedorMin[]> {
  const { data, error } = await db.select("proveedores", COLS_PROVEEDOR_MIN).order("nombre", { ascending: true }).limit(5000);
  if (error) throw new Error("db");
  return (data ?? []) as unknown as ProveedorMin[];
}

/**
 * Deja al proveedor con exactamente estos rubros. Los que vienen como nombre nuevo se
 * crean (o se reusan si ya existían con otro uso de mayúsculas).
 */
export async function guardarRubros(db: TenantDb, proveedorId: string, ids: string[], nuevos: string[]) {
  const finales = new Set(ids);
  for (const nombre of nuevos.map((n) => n.trim()).filter(Boolean)) {
    const ex = await db.select("proveedor_categorias", "id").ilike("nombre", nombre.replace(/[%_]/g, "\\$&")).limit(1);
    const id = (ex.data?.[0] as { id?: string } | undefined)?.id;
    if (id) { finales.add(id); continue; }
    const ins = await db.insert("proveedor_categorias", { nombre });
    const nuevoId = (ins.data?.[0] as { id?: string } | undefined)?.id;
    if (ins.error || !nuevoId) throw new Error("No se pudo crear el rubro «" + nombre + "».");
    finales.add(nuevoId);
  }
  const del = await db.delete("proveedor_categoria_rel").eq("proveedor_id", proveedorId);
  if (del.error) throw new Error("db");
  if (finales.size) {
    const ins = await db.insert("proveedor_categoria_rel", [...finales].map((categoria_id) => ({ proveedor_id: proveedorId, categoria_id })));
    if (ins.error) throw new Error("db");
  }
}

/** Mensaje claro para un RUC repetido (índice único uq_proveedores_empresa_ruc). */
export function errorProveedor(msg: string): string {
  if (/uq_proveedores_empresa_ruc|duplicate|unique/i.test(msg)) return "Ya hay un proveedor con ese RUC.";
  return "No se pudo guardar el proveedor.";
}
