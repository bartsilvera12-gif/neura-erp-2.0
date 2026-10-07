/**
 * Clientes — lista y alta. "Mejor versión" combinada:
 *   GET  /api/clientes?q=   → lista (busca en nombre/documento/ruc/teléfono), sin borrados
 *   POST /api/clientes      → alta con anti-duplicados (candado en DB + chequeo amable)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, fail, ERR } from "@/lib/api/responses";

export const COLS =
  "id, nombre, razon_social, tipo_cliente, documento, ruc, telefono, email, ciudad, direccion, condicion_pago, limite_credito, origen, activo, vendedor_usuario_id, creado_at";

export const GET = withTenant(async (ctx, req) => {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  let query = ctx.db.select("clientes", COLS).is("deleted_at", null);
  if (q) {
    const safe = q.replace(/[%,()]/g, " ");
    query = query.or(`nombre.ilike.%${safe}%,documento.ilike.%${safe}%,ruc.ilike.%${safe}%,telefono.ilike.%${safe}%`);
  }
  const { data, error } = await query.order("nombre", { ascending: true }).limit(500);
  if (error) return ERR.server();
  return ok(data ?? []);
});

const crearCliente = z.object({
  nombre: z.string().trim().min(1, "El nombre es obligatorio"),
  tipo_cliente: z.enum(["empresa", "persona"]).default("persona"),
  razon_social: z.string().trim().max(200).nullish(),
  documento: z.string().trim().max(40).nullish(),
  ruc: z.string().trim().max(40).nullish(),
  telefono: z.string().trim().max(40).nullish(),
  email: z.string().trim().email("Email inválido").max(120).nullish().or(z.literal("")),
  direccion: z.string().trim().max(200).nullish(),
  ciudad: z.string().trim().max(80).nullish(),
  condicion_pago: z.string().trim().max(40).default("CONTADO"),
  limite_credito: z.coerce.number().min(0).default(0),
  origen: z.enum(["MANUAL", "VENTA", "CRM"]).default("MANUAL"),
  notas: z.string().trim().max(1000).nullish(),
  vendedor_usuario_id: z.string().uuid().nullish(),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    // Anti-duplicados amable: si viene documento y ya existe uno vivo, avisar claro
    // (además del candado único en la DB, que es la red dura).
    const doc = input.documento?.trim();
    if (doc) {
      const dup = await ctx.db.select("clientes", "id, nombre").is("deleted_at", null).ilike("documento", doc);
      if (dup.data?.length) {
        return fail(`Ya existe un cliente con el documento ${doc} (${dup.data[0].nombre}).`, 409);
      }
    }

    const { data, error } = await ctx.db.insert("clientes", {
      ...input,
      email: input.email || null,
      created_by: ctx.usuarioId,
    });
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) return fail("Ya existe un cliente con ese documento.", 409);
      return ERR.server();
    }
    return created(data?.[0] ?? null);
  },
  { roles: ["ADMIN", "VENDEDOR"], body: crearCliente },
);
