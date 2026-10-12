/**
 * Una compra con sus productos. GET /api/compras/[id] → compra + items
 * + cuenta_pagar (solo a crédito): saldo, pagado, vencimiento y los pagos aplicados.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { COLS_COMPRA, COLS_ITEM } from "@/modules/compras/tipos";

type Aplicacion = { monto: number; pagos_proveedores: { id: string; numero: string; fecha: string; anulado_at: string | null } | null };

export const GET = withTenant(async (ctx, req) => {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const id = segs[segs.indexOf("compras") + 1];
  if (!/^[0-9a-f-]{36}$/i.test(id ?? "")) return ERR.invalid("Falta el id de la compra");
  const [c, i, x] = await Promise.all([
    ctx.db.select("compras", COLS_COMPRA).eq("id", id).limit(1),
    ctx.db.select("compras_items", COLS_ITEM).eq("compra_id", id).order("orden", { ascending: true }),
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
  return ok({ ...(c.data[0] as unknown as Record<string, unknown>), items: i.data ?? [], cuenta_pagar });
});
