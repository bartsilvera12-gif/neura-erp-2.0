/**
 * Bot vendedor por WhatsApp (solo ADMIN, receta 172) — Omnicanal › Bot vendedor.
 *   GET  → configuración, categorías (con lo que el bot dice de cada una), canales de WhatsApp y si
 *          el servidor tiene la clave de Claude (ANTHROPIC_API_KEY).
 *   POST { config, categorias: [{ id, bot_visible, bot_instrucciones }] } → guarda todo.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok } from "@/lib/api/responses";
import { systemClient } from "@/lib/supabase/clients";
import { botVendedorConfigurado } from "@/lib/bot-vendedor/bot";

export const dynamic = "force-dynamic";

const POR_DEFECTO = {
  activo: false, canal_id: null, tienda: null, instrucciones: null, envio_activo: true, envio_texto: null,
  retiro_activo: true, retiro_texto: null, pago_al_recibir: true, pago_transferencia: true, cuentas: [],
};

async function leer(empresaId: string) {
  const db = systemClient();
  const [cfg, cats, prods, canales] = await Promise.all([
    db.from("bot_vendedor_config").select("*").eq("empresa_id", empresaId).maybeSingle(),
    db.from("categorias_productos").select("id, nombre, activo, bot_visible, bot_instrucciones").eq("empresa_id", empresaId).eq("activo", true).order("nombre"),
    db.from("productos").select("categoria_principal_id").eq("empresa_id", empresaId).eq("activo", true).eq("es_vendible", true),
    db.from("chat_canales").select("id, nombre, proveedor, activo").eq("empresa_id", empresaId).eq("tipo", "whatsapp").neq("proveedor", "simulador").order("created_at"),
  ]);
  if (cfg.error || cats.error) throw new Error(cfg.error?.message ?? cats.error?.message);
  const cuenta = new Map<string, number>();
  for (const p of (prods.data ?? []) as { categoria_principal_id: string | null }[]) {
    if (p.categoria_principal_id) cuenta.set(p.categoria_principal_id, (cuenta.get(p.categoria_principal_id) ?? 0) + 1);
  }
  const { empresa_id: _e, updated_at: _u, updated_by: _b, ...config } = (cfg.data ?? { ...POR_DEFECTO }) as Record<string, unknown>;
  return {
    config,
    categorias: ((cats.data ?? []) as { id: string; nombre: string; bot_visible: boolean; bot_instrucciones: string | null }[]).map((c) => ({
      id: c.id, nombre: c.nombre, bot_visible: c.bot_visible, bot_instrucciones: c.bot_instrucciones, productos: cuenta.get(c.id) ?? 0,
    })),
    canales: canales.data ?? [],
    ia_configurada: botVendedorConfigurado(),
  };
}

export const GET = withTenant(async (ctx) => {
  try {
    return ok(await leer(ctx.empresaId));
  } catch (e) {
    console.error("[bot-vendedor] leer", (e as Error).message);
    return fail("No se pudo leer la configuración del bot", 500);
  }
}, { roles: ["ADMIN"] });

const texto = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);
const cuerpo = z.object({
  config: z.object({
    activo: z.boolean(),
    canal_id: z.string().uuid().nullish().transform((v) => v || null),
    tienda: texto(120),
    instrucciones: texto(4000),
    envio_activo: z.boolean(),
    envio_texto: texto(1000),
    retiro_activo: z.boolean(),
    retiro_texto: texto(1000),
    pago_al_recibir: z.boolean(),
    pago_transferencia: z.boolean(),
    cuentas: z.array(z.object({ banco: texto(80), titular: texto(120), cuenta: texto(60), documento: texto(30), alias: texto(80) })).max(6),
  }),
  categorias: z.array(z.object({ id: z.string().uuid(), bot_visible: z.boolean(), bot_instrucciones: texto(3000) })).max(300),
});

export const POST = withTenant(async (ctx, _req, b) => {
  const c = b.config;
  if (!c.envio_activo && !c.retiro_activo) return fail("Dejá prendido el envío, el retiro o los dos", 422, "invalid_input");
  if (!c.pago_al_recibir && !c.pago_transferencia) return fail("Dejá prendida al menos una forma de pago", 422, "invalid_input");
  if (c.pago_transferencia && !c.cuentas.some((x) => x.cuenta || x.alias)) return fail("Para cobrar por transferencia cargá al menos una cuenta o alias", 422, "invalid_input");
  const db = systemClient();
  if (c.canal_id) {
    const { data } = await db.from("chat_canales").select("id").eq("id", c.canal_id).eq("empresa_id", ctx.empresaId).maybeSingle();
    if (!data) return fail("Ese canal no es de esta empresa", 422, "invalid_input");
  }
  const { error } = await db.from("bot_vendedor_config").upsert({
    ...c, cuentas: c.cuentas.filter((x) => Object.values(x).some(Boolean)), empresa_id: ctx.empresaId, updated_at: new Date().toISOString(), updated_by: ctx.usuarioId,
  });
  if (error) return fail("No se pudo guardar la configuración", 500);
  for (const cat of b.categorias) {
    const { error: e } = await db.from("categorias_productos").update({ bot_visible: cat.bot_visible, bot_instrucciones: cat.bot_instrucciones }).eq("id", cat.id).eq("empresa_id", ctx.empresaId);
    if (e) return fail("La configuración se guardó, pero no las categorías", 500);
  }
  return ok(await leer(ctx.empresaId));
}, { roles: ["ADMIN"], body: cuerpo });
