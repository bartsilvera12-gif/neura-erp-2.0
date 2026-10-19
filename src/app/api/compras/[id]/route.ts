/**
 * Una compra con sus líneas. GET /api/compras/[id] → compra + items (mercadería) + gastos
 * (líneas de gasto, receta 59: subcategoría con su rubro, sucursal, empleado) + cuenta_pagar
 * (solo a crédito): saldo, pagado, vencimiento y los pagos aplicados.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { COLS_COMPRA, COLS_GASTO_COMPRA, COLS_ITEM } from "@/modules/compras/tipos";

type Aplicacion = { monto: number; pagos_proveedores: { id: string; numero: string; fecha: string; anulado_at: string | null } | null };
type FilaGasto = Record<string, unknown> & {
  sucursal?: { nombre: string } | null;
  empleado?: { nombre: string } | null;
  cat?: { padre_id: string | null; tipo_costo: string | null } | null;
};

export const GET = withTenant(async (ctx, req) => {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const id = segs[segs.indexOf("compras") + 1];
  if (!/^[0-9a-f-]{36}$/i.test(id ?? "")) return ERR.invalid("Falta el id de la compra");
  const [c, i, g, x] = await Promise.all([
    ctx.db.select("compras", COLS_COMPRA).eq("id", id).limit(1),
    ctx.db.select("compras_items", COLS_ITEM).eq("compra_id", id).order("orden", { ascending: true }),
    ctx.db.select("compras_gastos", COLS_GASTO_COMPRA).eq("compra_id", id).order("orden", { ascending: true }),
    ctx.db
      .select(
        "cuentas_por_pagar",
        "id, numero, fecha_emision, vencimiento, moneda, monto, pagado, saldo, estado, " +
          "apl:pagos_proveedores_aplicaciones(monto, pagos_proveedores(id, numero, fecha, anulado_at))",
      )
      .eq("compra_id", id)
      .limit(1),
  ]);
  if (c.error || i.error) return ERR.server();
  if (!c.data?.length) return ERR.notFound("compra");

  // Líneas de gasto con "Rubro › Subcategoría" (si la tabla no está, la compra igual se ve).
  const filas = (g.error ? [] : (g.data ?? [])) as unknown as FilaGasto[];
  const padres = [...new Set(filas.map((f) => f.cat?.padre_id).filter((v): v is string => !!v))];
  const rubros = new Map<string, string>();
  if (padres.length) {
    const r = await ctx.db.select("gasto_categorias", "id, nombre").in("id", padres);
    for (const x of (r.data ?? []) as unknown as { id: string; nombre: string }[]) rubros.set(x.id, x.nombre);
  }
  const gastos = filas.map(({ sucursal, empleado, cat, ...f }) => ({
    ...f,
    sucursal_nombre: sucursal?.nombre ?? null,
    empleado_nombre: empleado?.nombre ?? null,
    tipo_costo: cat?.tipo_costo ?? null,
    rubro_nombre: cat?.padre_id ? rubros.get(cat.padre_id) ?? null : null,
  }));

  // La cuenta a pagar es complementaria: si falla (p. ej. migración sin aplicar) la compra igual se ve.
  const cx = (x.error ? null : x.data?.[0] ?? null) as unknown as (Record<string, unknown> & { apl?: Aplicacion[] | null }) | null;
  const cuenta_pagar = cx
    ? {
        ...Object.fromEntries(Object.entries(cx).filter(([k]) => k !== "apl")),
        pagos: (cx.apl ?? [])
          .filter((a) => a.pagos_proveedores)
          .map((a) => ({ monto: a.monto, id: a.pagos_proveedores!.id, numero: a.pagos_proveedores!.numero, fecha: a.pagos_proveedores!.fecha, anulado_at: a.pagos_proveedores!.anulado_at }))
          .sort((a, b) => (a.fecha < b.fecha ? 1 : -1)),
      }
    : null;
  return ok({ ...(c.data[0] as unknown as Record<string, unknown>), items: i.data ?? [], gastos, cuenta_pagar });
}, { roles: ["ADMIN"] });
