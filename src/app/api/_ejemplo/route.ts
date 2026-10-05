/**
 * Ruta de EJEMPLO — muestra el patrón obligatorio. Toda ruta real se escribe así.
 * No hace falta verificar auth, ni empresa, ni schema: el portón ya lo hizo.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, ERR } from "@/lib/api/responses";

export const GET = withTenant(async (ctx) => {
  const { data, error } = await ctx.db.select("clientes", "id, nombre, documento");
  if (error) return ERR.server();
  return ok(data);
});

const crearCliente = z.object({
  nombre: z.string().min(1, "El nombre es obligatorio"),
  documento: z.string().trim().optional(),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.insert("clientes", input);
    if (error) return ERR.server();
    return created(data?.[0] ?? null);
  },
  { roles: ["ADMIN", "VENDEDOR"], body: crearCliente },
);
