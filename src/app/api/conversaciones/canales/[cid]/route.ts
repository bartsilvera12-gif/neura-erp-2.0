/**
 * Un canal de WhatsApp (solo ADMIN, receta 126).
 *   POST /api/conversaciones/canales/<id> { accion: "probar" }   → prueba las credenciales (no manda mensajes)
 *   POST /api/conversaciones/canales/<id> { accion: "prender" }  → solo si tiene todas sus claves
 *   POST /api/conversaciones/canales/<id> { accion: "apagar" }   → deja de recibir y de mandar
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok } from "@/lib/api/responses";
import { secretosDelCanal } from "@/lib/conversaciones/servidor";
import { systemClient } from "@/lib/supabase/clients";
import { urlBase } from "@/lib/usuarios/cuentas";
import { probarCredenciales } from "@/modules/conversaciones/conectores";
import { idDeRuta } from "@/modules/tipificacion/server";
import { clavesQueFaltan, listarCanales } from "@/modules/conversaciones/canales-server";

export const dynamic = "force-dynamic";

const cuerpo = z.object({ accion: z.enum(["probar", "prender", "apagar"]) });

export const POST = withTenant(async (ctx, req, b) => {
  const id = idDeRuta(req, "canales");
  if (!id) return fail("Canal inválido", 400);
  const db = systemClient();
  const { data } = await db.from("chat_canales").select("id, proveedor, identificador").eq("id", id).eq("empresa_id", ctx.empresaId).maybeSingle();
  const canal = data as { id: string; proveedor: string; identificador: string | null } | null;
  if (!canal) return fail("No existe ese canal", 404);
  if (canal.proveedor === "simulador") return fail("El canal de prueba no se configura", 400);
  const config = await secretosDelCanal(id);

  if (b.accion === "probar") {
    try {
      const quien = await probarCredenciales(canal.proveedor, canal.identificador ?? "", config);
      return ok({ ok: true, detalle: quien });
    } catch (e) {
      return ok({ ok: false, detalle: (e as Error).message });
    }
  }

  if (b.accion === "prender") {
    const faltan = clavesQueFaltan(canal.proveedor, config);
    if (faltan.length) return fail(`Faltan claves: ${faltan.join(", ")}`, 422, "invalid_input");
  }
  const { error } = await db.from("chat_canales").update({ activo: b.accion === "prender", ultimo_error: null, ultimo_error_at: null }).eq("id", id);
  if (error) return fail("No se pudo cambiar el canal", 500);
  const lista = await listarCanales(ctx.empresaId, urlBase(req));
  return ok(lista.find((c) => c.id === id) ?? null);
}, { roles: ["ADMIN"], body: cuerpo });
