/**
 * Acciones sobre un ajuste / pérdida (perfil: aprobar / rechazar → "aprobar ajustes y
 * pérdidas"; anular → "ajustes de inventario"):
 *   POST /api/inventario/ajustes/[id]/aprobar             → aplica una pérdida pendiente
 *   POST /api/inventario/ajustes/[id]/rechazar { motivo } → la rechaza (no mueve stock)
 *   POST /api/inventario/ajustes/[id]/anular   { motivo } → revierte uno aplicado
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { UUID_RE, idDeRuta, idInvalido } from "@/modules/inventario/server/ids";
import { falloRpc } from "@/modules/inventario/server/rpc";

const cuerpo = z.object({ motivo: z.string().trim().max(500).nullish() }).nullish();

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = idDeRuta(req.url, "ajustes");
    if (!UUID_RE.test(id ?? "")) return idInvalido("documento");
    const accion = idDeRuta(req.url, id!);
    const motivo = input?.motivo ?? "";
    const llamada =
      accion === "aprobar" ? ctx.db.rpc("aprobar_ajuste", { p_id: id })
      : accion === "rechazar" ? ctx.db.rpc("rechazar_ajuste", { p_id: id, p_motivo: motivo })
      : accion === "anular" ? ctx.db.rpc("anular_ajuste", { p_id: id, p_motivo: motivo })
      : null;
    if (!llamada) return ERR.notFound("acción");
    const permiso = accion === "anular" ? "ajustes_inventario" : "aprobar_perdidas";
    if (!ctx.puede(permiso)) return ERR.sinPermiso(permiso);
    const { data, error } = await llamada;
    if (error) return falloRpc(error);
    return ok(data);
  },
  { body: cuerpo },
);
