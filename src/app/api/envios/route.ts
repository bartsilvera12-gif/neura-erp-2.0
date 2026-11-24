/**
 * Operaciones del tablero de Envíos (receta 170), permiso envios_operar.
 *   POST /api/envios { accion: "crear" | "mover" | "asignar" | "editar", ... }
 *     crear:   { venta_id, direccion?, referencia?, telefono?, chofer_id? }  (lo llama la caja)
 *     mover:   { id, estado_id }
 *     asignar: { id, chofer_id|null }
 *     editar:  { id, direccion?, referencia?, telefono?, notas? }
 *     cobrar:  { id, metodo, referencia?, caja_id? }  (pago contra entrega, receta 173)
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail } from "@/lib/api/responses";
import { falloRpc } from "@/modules/inventario/server/rpc";

export const dynamic = "force-dynamic";

export const POST = withTenant(async (ctx, req) => {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b.accion !== "string") return fail("Falta la acción");
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : null);

  let res;
  switch (b.accion) {
    case "crear":
      res = await ctx.db.rpc("envio_crear", { p: { venta_id: str("venta_id"), direccion: str("direccion"), referencia: str("referencia"), telefono: str("telefono"), chofer_id: str("chofer_id") } });
      break;
    case "mover":
      res = await ctx.db.rpc("envio_mover", { p_id: str("id"), p_estado_id: str("estado_id") });
      break;
    case "asignar":
      res = await ctx.db.rpc("envio_asignar_chofer", { p_id: str("id"), p_chofer_id: str("chofer_id") });
      break;
    case "editar":
      res = await ctx.db.rpc("envio_editar", { p: { id: str("id"), direccion: str("direccion"), referencia: str("referencia"), telefono: str("telefono"), notas: str("notas") } });
      break;
    case "cobrar":
      res = await ctx.db.rpc("envio_cobrar", { p: { id: str("id"), metodo: str("metodo"), referencia: str("referencia"), caja_id: str("caja_id") } });
      break;
    default:
      return fail("Acción inválida");
  }
  if (res.error) return falloRpc(res.error);
  return ok(res.data);
}, { permiso: "envios_operar" });
