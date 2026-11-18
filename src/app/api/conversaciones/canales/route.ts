/**
 * Canales de WhatsApp (solo ADMIN, receta 126): conectar YCloud o la API de Meta sin tocar código.
 *   GET  /api/conversaciones/canales → canales, qué claves tiene cada uno (nunca el valor), y los datos
 *        del webhook para pegar en el proveedor (URL; en Meta, el verify token del canal)
 *   POST /api/conversaciones/canales { id?, nombre, proveedor: ycloud | meta, identificador, numero?, claves? }
 *        Un canal real nace APAGADO; se prende desde /canales/<id> después de probarlo.
 *        `claves`: solo se guardan las que vienen con valor (vacío = no cambiar).
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok } from "@/lib/api/responses";
import { systemClient } from "@/lib/supabase/clients";
import { urlBase } from "@/lib/usuarios/cuentas";
import { CLAVES, enEntorno, listarCanales } from "@/modules/conversaciones/canales-server";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx, req) => {
  try {
    return ok(await listarCanales(ctx.empresaId, urlBase(req)));
  } catch (e) {
    console.error("[canales]", (e as Error).message);
    return fail("No se pudieron leer los canales", 500);
  }
}, { roles: ["ADMIN"] });

const cuerpo = z.object({
  id: z.string().uuid().nullish(),
  nombre: z.string().trim().min(2, "Poné un nombre").max(80),
  proveedor: z.enum(["ycloud", "meta"]),
  identificador: z.string().trim().transform((v) => v.replace(/\D/g, "")),
  numero: z.string().trim().max(30).nullish(),
  claves: z.record(z.string(), z.string().trim().max(2000)).nullish(),
});

export const POST = withTenant(async (ctx, req, b) => {
  if (b.proveedor === "ycloud" && !/^\d{8,15}$/.test(b.identificador)) return fail("El número de WhatsApp Business va con código de país, ej. 595981123456", 422, "invalid_input");
  if (b.proveedor === "meta" && !/^\d{8,25}$/.test(b.identificador)) return fail("El Phone number ID son solo números (está en Meta › WhatsApp › Configuración de la API)", 422, "invalid_input");
  const db = systemClient();

  // Otro canal (de esta empresa o de otra en el mismo sistema) ya usa ese número.
  const { data: otro } = await db.from("chat_canales").select("id").eq("proveedor", b.proveedor).eq("identificador", b.identificador).limit(1);
  const o = (otro?.[0] ?? null) as { id: string } | null;
  if (o && o.id !== b.id) return fail("Ese número ya está cargado en otro canal", 409, "duplicado");

  const fila = { nombre: b.nombre, tipo: "whatsapp", proveedor: b.proveedor, identificador: b.identificador, numero: b.numero?.trim() || null };
  let id = b.id ?? null;
  if (id) {
    const { data, error } = await db.from("chat_canales").update(fila).eq("id", id).eq("empresa_id", ctx.empresaId).neq("proveedor", "simulador").select("id");
    if (error) return fail("No se pudo guardar el canal", 500);
    if (!data?.length) return fail("No existe ese canal", 404);
  } else {
    const { data, error } = await db.from("chat_canales").insert({ ...fila, empresa_id: ctx.empresaId, activo: false }).select("id").single();
    if (error || !data) return fail(/uq_chat_canal_ident/.test(error?.message ?? "") ? "Ese número ya está cargado en otro canal" : "No se pudo crear el canal", 500);
    id = (data as { id: string }).id;
  }

  // Claves: se mezclan con las que ya estaban; vacío = no cambiar. Meta: verify token propio si no hay.
  const { data: prev } = await db.from("chat_canal_secretos").select("config").eq("canal_id", id).maybeSingle();
  const config: Record<string, unknown> = { ...((prev as { config?: Record<string, unknown> } | null)?.config ?? {}) };
  for (const k of CLAVES[b.proveedor]) if (b.claves?.[k]) config[k] = b.claves[k];
  if (b.proveedor === "meta" && !config.verify_token && !enEntorno("verify_token")) config.verify_token = randomBytes(18).toString("base64url");
  const { error: errSec } = await db.from("chat_canal_secretos").upsert({ canal_id: id, empresa_id: ctx.empresaId, config, updated_at: new Date().toISOString() });
  if (errSec) return fail("El canal se guardó pero no sus claves", 500);

  const lista = await listarCanales(ctx.empresaId, urlBase(req));
  return ok(lista.find((c) => c.id === id) ?? null);
}, { roles: ["ADMIN"], body: cuerpo });
