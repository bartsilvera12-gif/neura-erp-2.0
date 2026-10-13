/**
 * Catálogo de bancos (banco de origen de las transferencias).
 *   GET  /api/cobranzas/bancos[?todos=1] → { bancos } (activos; con todos=1 también los inactivos)
 *   POST /api/cobranzas/bancos { nombre, sin_referencia?, prefijo? } → el banco (ADMIN)
 *   `sin_referencia`: el banco no emite N° de operación (ej. Familiar) y se genera una
 *   referencia PREFIJO-YYMMDD-HHMMSS-RR.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, fail, ERR } from "@/lib/api/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLS = "id, nombre, sin_referencia, prefijo, activo, orden";

export const GET = withTenant(async (ctx, req) => {
  const todos = new URL(req.url).searchParams.get("todos") === "1";
  let q = ctx.db.select("bancos", COLS);
  if (!todos) q = q.eq("activo", true);
  const { data, error } = await q.order("orden").order("nombre");
  if (error) return ERR.server();
  return ok({ bancos: data ?? [] });
});

const cuerpo = z.object({
  nombre: z.string().trim().min(2, "Escribí el nombre del banco").max(60),
  sin_referencia: z.boolean().optional(),
  prefijo: z.string().trim().max(6).regex(/^[A-Za-z0-9]*$/, "El prefijo solo lleva letras y números").nullish(),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const ins = await ctx.db.insert("bancos", {
      nombre: input.nombre.replace(/\s+/g, " "),
      sin_referencia: input.sin_referencia ?? false,
      prefijo: input.prefijo ? input.prefijo.toUpperCase() : null,
      orden: 50,
    });
    if (ins.error) {
      if ((ins.error as { code?: string }).code === "23505") return fail("Ya existe un banco con ese nombre", 409);
      return ERR.server();
    }
    return created(ins.data?.[0] ?? null);
  },
  { roles: ["ADMIN"], body: cuerpo },
);
