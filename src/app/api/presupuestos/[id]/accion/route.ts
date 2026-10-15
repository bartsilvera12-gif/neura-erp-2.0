/**
 * Acciones sobre un presupuesto. POST /api/presupuestos/[id]/accion
 *   { accion: "enviar", canal: whatsapp|link|email|manual }  borrador → enviado (+ historial)
 *   { accion: "aceptar" } · { accion: "rechazar", motivo } · { accion: "reabrir" }
 *   { accion: "duplicar" } → { id, numero } del borrador nuevo
 *   { accion: "vincular_producto", item_id, producto_id }  línea libre → producto del catálogo
 * Cada función de la base valida empresa y rol adentro.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok, ERR } from "@/lib/api/responses";
import { cuerpoAccion, ROLES_PRESUPUESTOS } from "@/modules/presupuestos/tipos";

const idDe = (req: { url: string }) => {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const id = segs[segs.indexOf("presupuestos") + 1];
  return /^[0-9a-f-]{36}$/i.test(id ?? "") ? id : null;
};

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = idDe(req);
    if (!id) return ERR.invalid("Falta el id del presupuesto");
    const r =
      input.accion === "enviar"
        ? await ctx.db.rpc("presupuesto_registrar_envio", { p_id: id, p_canal: input.canal })
        : input.accion === "duplicar"
          ? await ctx.db.rpc("presupuesto_duplicar", { p_id: id })
          : input.accion === "vincular_producto"
            ? await ctx.db.rpc("presupuesto_vincular_producto", { p_item_id: input.item_id, p_producto_id: input.producto_id })
            : await ctx.db.rpc("presupuesto_cambiar_estado", {
                p_id: id,
                p_accion: input.accion,
                p_motivo: input.accion === "rechazar" ? input.motivo : null,
              });
    if (r.error) return fail(r.error.message.replace(/^.*?ERROR:\s*/, ""), 400);
    return ok(r.data);
  },
  { roles: ROLES_PRESUPUESTOS, body: cuerpoAccion },
);
