/**
 * Un presupuesto.
 *   GET   /api/presupuestos/[id] → cabecera + líneas + historial (+ número de la venta)
 *   PATCH /api/presupuestos/[id] → edita (borrador o enviado; un enviado sube de revisión)
 */
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok, ERR } from "@/lib/api/responses";
import { hoyPY } from "@/lib/fecha/paraguay";
import {
  COLS_ITEM, COLS_PRESUPUESTO, cuerpoPresupuesto, estadoEfectivo, ROLES_PRESUPUESTOS, type EstadoGuardado,
} from "@/modules/presupuestos/tipos";

const idDe = (req: { url: string }) => {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const id = segs[segs.indexOf("presupuestos") + 1];
  return /^[0-9a-f-]{36}$/i.test(id ?? "") ? id : null;
};

export const GET = withTenant(async (ctx, req) => {
  const id = idDe(req);
  if (!id) return ERR.invalid("Falta el id del presupuesto");
  const [p, i, e] = await Promise.all([
    ctx.db.select("presupuestos", COLS_PRESUPUESTO).eq("id", id).limit(1),
    ctx.db.select("presupuestos_items", COLS_ITEM).eq("presupuesto_id", id).order("orden", { ascending: true }),
    ctx.db.select("presupuestos_eventos", "id, tipo, canal, revision, detalle, usuario_nombre, created_at")
      .eq("presupuesto_id", id).order("created_at", { ascending: false }).limit(200),
  ]);
  if (p.error || i.error || e.error) return ERR.server();
  const fila = p.data?.[0] as unknown as (Record<string, unknown> & { estado: EstadoGuardado; valido_hasta: string; venta_id: string | null }) | undefined;
  if (!fila) return ERR.notFound("presupuesto");
  let ventaNumero: string | null = null;
  if (fila.venta_id) {
    const v = await ctx.db.select("ventas", "numero_control").eq("id", fila.venta_id).limit(1);
    ventaNumero = (v.data?.[0] as { numero_control?: string } | undefined)?.numero_control ?? null;
  }
  return ok({
    ...fila,
    estado: estadoEfectivo(fila.estado, fila.valido_hasta, hoyPY()),
    estado_guardado: fila.estado,
    venta_numero: ventaNumero,
    items: i.data ?? [],
    eventos: (e.data ?? []).map((ev) => {
      // La foto de la revisión anterior no viaja a la pantalla (puede ser grande): solo el resumen.
      const x = ev as unknown as { detalle: Record<string, unknown> | null };
      if (x.detalle && "anterior" in x.detalle) {
        const { anterior: _anterior, ...resto } = x.detalle;
        void _anterior;
        return { ...(ev as object), detalle: resto };
      }
      return ev;
    }),
  });
}, { roles: ROLES_PRESUPUESTOS });

export const PATCH = withTenant(
  async (ctx, req, input) => {
    const id = idDe(req);
    if (!id) return ERR.invalid("Falta el id del presupuesto");
    const { data, error } = await ctx.db.rpc("guardar_presupuesto", { p: { ...input, id, idempotency_key: null } });
    if (error) return fail(error.message.replace(/^.*?ERROR:\s*/, ""), 400);
    return ok(data);
  },
  { roles: ROLES_PRESUPUESTOS, body: cuerpoPresupuesto },
);
