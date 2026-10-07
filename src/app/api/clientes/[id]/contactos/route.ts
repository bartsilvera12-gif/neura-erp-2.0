/**
 * Contactos de un cliente (personas de contacto: comprador, cobranzas, etc.).
 *   GET    /api/clientes/[id]/contactos               → lista
 *   POST   /api/clientes/[id]/contactos               → agrega { nombre, cargo?, telefono?, email?, notas? }
 *   DELETE /api/clientes/[id]/contactos?contacto_id=  → quita uno
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, noContent, ERR } from "@/lib/api/responses";

function clienteId(req: { url: string }): string | null {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const i = segs.indexOf("clientes");
  return i >= 0 ? (segs[i + 1] ?? null) : null;
}

export const GET = withTenant(async (ctx, req) => {
  const id = clienteId(req);
  if (!id) return ERR.invalid("Falta el id del cliente");
  const { data, error } = await ctx.db
    .select("cliente_contactos", "id, nombre, cargo, telefono, email, notas")
    .eq("cliente_id", id)
    .order("created_at", { ascending: true });
  if (error) return ERR.server();
  return ok(data ?? []);
});

const crearContacto = z.object({
  nombre: z.string().trim().min(1, "El nombre del contacto es obligatorio"),
  cargo: z.string().trim().max(80).nullish(),
  telefono: z.string().trim().max(40).nullish(),
  email: z.string().trim().email("Email inválido").max(120).nullish().or(z.literal("")),
  notas: z.string().trim().max(500).nullish(),
});

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = clienteId(req);
    if (!id) return ERR.invalid("Falta el id del cliente");
    const { data, error } = await ctx.db.insert("cliente_contactos", {
      ...input,
      email: input.email || null,
      cliente_id: id,
    });
    if (error || !data?.[0]) return ERR.server();
    return created(data[0]);
  },
  { roles: ["ADMIN", "VENDEDOR"], body: crearContacto },
);

export const DELETE = withTenant(async (ctx, req) => {
  const contactoId = new URL(req.url).searchParams.get("contacto_id");
  if (!contactoId) return ERR.invalid("Falta contacto_id");
  const { error } = await ctx.db.delete("cliente_contactos").eq("id", contactoId);
  if (error) return ERR.server();
  return noContent();
});
