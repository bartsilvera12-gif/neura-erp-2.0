/**
 * Una orden de pago con sus medios y a qué facturas se aplicó.
 *   GET /api/pagos-proveedores/[id] → pago + medios + aplicaciones [{ monto, cxp_id, numero, compra_id, gasto_id, compra_numero }]
 *   (compra_numero: el de la compra o, si la deuda es de un gasto, su número GS-…)
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";

export const GET = withTenant(
  async (ctx, req) => {
    const segs = new URL(req.url).pathname.split("/").filter(Boolean);
    const id = segs[segs.indexOf("pagos-proveedores") + 1];
    if (!/^[0-9a-f-]{36}$/i.test(id ?? "")) return ERR.invalid("Falta el id del pago");
    const [p, m, a] = await Promise.all([
      ctx.db
        .select("pagos_proveedores", "id, numero, proveedor_id, proveedor_nombre, fecha, moneda, total, caja_id, observacion, usuario_nombre, anulado_at, anulado_por, anulado_motivo")
        .eq("id", id)
        .limit(1),
      ctx.db.select("pagos_proveedores_medios", "metodo, monto, referencia").eq("pago_id", id),
      ctx.db.select("pagos_proveedores_aplicaciones", "monto, cxp_id, cuentas_por_pagar(numero, compra_id, gasto_id, compras(numero_control), gastos(numero))").eq("pago_id", id),
    ]);
    if (p.error || m.error || a.error) return ERR.server();
    const pago = p.data?.[0] as unknown as Record<string, unknown> | undefined;
    if (!pago) return ERR.notFound("pago");
    const apl = (a.data ?? []) as unknown as {
      monto: number; cxp_id: string;
      cuentas_por_pagar: { numero: string; compra_id: string | null; gasto_id: string | null; compras: { numero_control: string } | null; gastos: { numero: string | null } | null } | null;
    }[];
    return ok({
      ...pago,
      medios: m.data ?? [],
      aplicaciones: apl.map((x) => ({
        monto: x.monto,
        cxp_id: x.cxp_id,
        numero: x.cuentas_por_pagar?.numero ?? "",
        compra_id: x.cuentas_por_pagar?.compra_id ?? null,
        gasto_id: x.cuentas_por_pagar?.gasto_id ?? null,
        compra_numero: x.cuentas_por_pagar?.compras?.numero_control ?? x.cuentas_por_pagar?.gastos?.numero ?? null,
      })),
    });
  },
  { roles: ["ADMIN"] },
);
