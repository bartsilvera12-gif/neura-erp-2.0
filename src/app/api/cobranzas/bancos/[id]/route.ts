/**
 * Editar un banco del catálogo (ADMIN).
 *   PATCH /api/cobranzas/bancos/[id] { nombre?, sin_referencia?, prefijo?, activo? } → el banco
 *   No se borran (hay transferencias que lo nombran): se desactivan.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail, ERR } from "@/lib/api/responses";
import { idTras } from "@/modules/cobranzas/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cuerpo = z.object({
  nombre: z.string().trim().min(2).max(60).optional(),
  sin_referencia: z.boolean().optional(),
  prefijo: z.string().trim().max(6).regex(/^[A-Za-z0-9]*$/, "El prefijo solo lleva letras y números").nullish(),
  activo: z.boolean().optional(),
});

export const PATCH = withTenant(
  async (ctx, req, input) => {
    const id = idTras(req, "bancos");
    if (!id) return ERR.invalid("Falta el id del banco");
    const patch: Record<string, unknown> = {};
    if (input.nombre !== undefined) patch.nombre = input.nombre.replace(/\s+/g, " ");
    if (input.sin_referencia !== undefined) patch.sin_referencia = input.sin_referencia;
    if (input.prefijo !== undefined) patch.prefijo = input.prefijo ? input.prefijo.toUpperCase() : null;
    if (input.activo !== undefined) patch.activo = input.activo;
    if (!Object.keys(patch).length) return ERR.invalid("Nada para cambiar");
    const { data, error } = await ctx.db.update("bancos", patch).eq("id", id).select("id, nombre, sin_referencia, prefijo, activo, orden");
    if (error) {
      if ((error as { code?: string }).code === "23505") return fail("Ya existe un banco con ese nombre", 409);
      return ERR.server();
    }
    if (!data?.length) return ERR.notFound("Banco");
    return ok(data[0]);
  },
  { permiso: "configuracion", body: cuerpo },
);
