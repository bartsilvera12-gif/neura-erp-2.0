/**
 * Dar de baja a un cliente: deja de ser cliente (queda inactivo y fuera de la lista de
 * activos) pero se conserva con todo su historial. Para volver: PATCH { activo: true }.
 *   POST /api/clientes/[id]/baja  { motivo } → { id }
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail, ERR } from "@/lib/api/responses";

function clienteId(req: { url: string }): string | null {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const i = segs.indexOf("clientes");
  return i >= 0 ? (segs[i + 1] ?? null) : null;
}

const baja = z.object({ motivo: z.string().trim().min(3, "Escribí el motivo de la baja").max(500) });

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = clienteId(req);
    if (!id) return ERR.invalid("Falta el id del cliente");
    const ahora = new Date().toISOString();
    const { data, error } = await ctx.db
      .update("clientes", { baja_at: ahora, baja_por: ctx.usuarioId, baja_motivo: input.motivo, activo: false, updated_at: ahora })
      .eq("id", id)
      .is("deleted_at", null)
      .is("baja_at", null)
      .select("id");
    if (error) return ERR.server();
    if (!data?.length) return fail("El cliente no existe o ya está dado de baja.", 409);
    return ok({ id });
  },
  { roles: ["ADMIN"], body: baja },
);
