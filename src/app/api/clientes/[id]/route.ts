/**
 * Cliente — detalle, edición y baja lógica.
 *   GET    /api/clientes/[id]  → cliente + estado de cuenta (saldo/límite) + últimas ventas + contactos
 *   PATCH  /api/clientes/[id]  → edita campos
 *   DELETE /api/clientes/[id]  → baja lógica (soft delete), solo ADMIN
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, noContent, fail, ERR } from "@/lib/api/responses";

/** Saca el id de /api/clientes/<id>[/...]. withTenant no reenvía los params de Next. */
function clienteId(req: { url: string }): string | null {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const i = segs.indexOf("clientes");
  return i >= 0 ? (segs[i + 1] ?? null) : null;
}

const DETALLE =
  "id, nombre, razon_social, tipo_cliente, documento, ruc, telefono, email, direccion, ciudad, condicion_pago, limite_credito, origen, notas, activo, vendedor_usuario_id, creado_at, updated_at";

export const GET = withTenant(async (ctx, req) => {
  const id = clienteId(req);
  if (!id) return ERR.invalid("Falta el id del cliente");

  const cli = await ctx.db.select("clientes", DETALLE).eq("id", id).is("deleted_at", null).limit(1);
  if (cli.error) return ERR.server();
  if (!cli.data?.length) return ERR.notFound();

  const saldo = await ctx.db.rpc<number>("cliente_saldo", { p_cliente_id: id });
  const ventas = await ctx.db
    .select("ventas", "id, numero_control, fecha, total, tipo_venta, estado")
    .eq("cliente_id", id)
    .order("fecha", { ascending: false })
    .limit(50);
  const contactos = await ctx.db
    .select("cliente_contactos", "id, nombre, cargo, telefono, email, notas")
    .eq("cliente_id", id)
    .order("created_at", { ascending: true });

  const cliente = cli.data[0];
  const saldoNum = Number(saldo.data ?? 0);
  const limite = Number(cliente.limite_credito ?? 0);
  return ok({
    cliente,
    estado_cuenta: {
      saldo: saldoNum,
      limite_credito: limite,
      disponible: limite > 0 ? Math.max(0, limite - saldoNum) : null,
    },
    ventas: ventas.data ?? [],
    contactos: contactos.data ?? [],
  });
});

const editarCliente = z.object({
  nombre: z.string().trim().min(1).optional(),
  tipo_cliente: z.enum(["empresa", "persona"]).optional(),
  razon_social: z.string().trim().max(200).nullish(),
  documento: z.string().trim().max(40).nullish(),
  ruc: z.string().trim().max(40).nullish(),
  telefono: z.string().trim().max(40).nullish(),
  email: z.string().trim().email("Email inválido").max(120).nullish().or(z.literal("")),
  direccion: z.string().trim().max(200).nullish(),
  ciudad: z.string().trim().max(80).nullish(),
  condicion_pago: z.string().trim().max(40).optional(),
  limite_credito: z.coerce.number().min(0).optional(),
  origen: z.enum(["MANUAL", "VENTA", "CRM"]).optional(),
  notas: z.string().trim().max(1000).nullish(),
  activo: z.boolean().optional(),
  vendedor_usuario_id: z.string().uuid().nullish(),
});

export const PATCH = withTenant(
  async (ctx, req, input) => {
    const id = clienteId(req);
    if (!id) return ERR.invalid("Falta el id del cliente");
    const patch: Record<string, unknown> = { ...input, updated_at: new Date().toISOString() };
    if ("email" in patch) patch.email = (input.email as string) || null;
    const { error } = await ctx.db.update("clientes", patch).eq("id", id);
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) return fail("Ya existe un cliente con ese documento.", 409);
      return ERR.server();
    }
    return ok({ id });
  },
  { roles: ["ADMIN", "VENDEDOR"], body: editarCliente },
);

export const DELETE = withTenant(
  async (ctx, req) => {
    const id = clienteId(req);
    if (!id) return ERR.invalid("Falta el id del cliente");
    const { error } = await ctx.db
      .update("clientes", { deleted_at: new Date().toISOString(), activo: false })
      .eq("id", id);
    if (error) return ERR.server();
    return noContent();
  },
  { roles: ["ADMIN"] },
);
