/**
 * Pedidos de mostrador (receta 77) — Caja › Pedidos. Permiso "Armar pedidos de mostrador".
 *   GET  /api/pedidos-mostrador[?todos=1] → pedidos_mostrador_listar: los de hoy (y los "en caja" de
 *        días anteriores, vencidos). El nivel Vendedor ve los suyos; los demás pueden ver todos.
 *   POST /api/pedidos-mostrador { id?, version?, cliente_id?, nota?, items[] } → crea (envía a caja)
 *        o edita uno que sigue en caja. Precios y modificadores los pone la base.
 * Con la función "Pedidos de mostrador" apagada, withTenant corta con 403 (funcion_inactiva).
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { created, ok, ERR } from "@/lib/api/responses";
import { falloRpc } from "@/modules/inventario/server/rpc";

export const dynamic = "force-dynamic";

const mods = z
  .object({
    quitar: z.array(z.string().uuid()).max(30).default([]),
    extras: z.array(z.object({ extra_id: z.string().uuid(), cantidad: z.coerce.number().int().min(1).max(20) })).max(30).default([]),
    opciones: z.array(z.string().uuid()).max(40).default([]),
  })
  .optional();

const cuerpo = z.object({
  id: z.string().uuid().nullish(),
  version: z.string().trim().max(20).nullish(),
  cliente_id: z.string().uuid().nullish(),
  sucursal_id: z.string().uuid().nullish(),
  nota: z.string().trim().max(500).nullish(),
  items: z
    .array(z.object({
      producto_id: z.string().uuid(),
      cantidad: z.coerce.number().positive("La cantidad debe ser mayor a 0").max(99999),
      mods,
    }))
    .min(1, "El pedido no tiene productos")
    .max(200, "Demasiados productos en un pedido"),
});

export const GET = withTenant(
  async (ctx, req) => {
    const todos = new URL(req.url).searchParams.get("todos") === "1";
    const { data, error } = await ctx.db.rpc("pedidos_mostrador_listar", { p_todos: todos });
    if (error) return falloRpc(error);
    if (!data) return ERR.server();
    return ok(data, { headers: { "Cache-Control": "no-store" } });
  },
  { permiso: "pedidos_mostrador" },
);

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.rpc("pedido_mostrador_guardar", { p: input });
    if (error) return falloRpc(error);
    if (!data) return ERR.server();
    return input.id ? ok(data) : created(data);
  },
  { permiso: "pedidos_mostrador", body: cuerpo },
);
