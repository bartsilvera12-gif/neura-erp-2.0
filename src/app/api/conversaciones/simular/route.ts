/**
 * Simular un mensaje ENTRANTE (solo ADMIN) — así se prueba la bandeja sin proveedor.
 *   POST /api/conversaciones/simular { telefono, nombre?, texto }
 * Usa el canal "simulador" de la empresa y chat_registrar_entrante (service-role): crea el
 * contacto y la conversación si no existen, y los triggers avisan por Realtime como un
 * mensaje real.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { created, fail } from "@/lib/api/responses";
import { canalSimulador, registrarEntrante } from "@/lib/conversaciones/servidor";

export const dynamic = "force-dynamic";

const cuerpo = z.object({
  telefono: z
    .string()
    .transform((v) => v.replace(/\D/g, ""))
    // Número local de Paraguay ("0981 123 456") → internacional, como llega de WhatsApp: si no,
    // la prueba abría un contacto nuevo en vez de seguir el chat del mismo cliente.
    .transform((v) => (/^09\d{8}$/.test(v) ? `595${v.slice(1)}` : v))
    .refine((v) => v.length >= 8 && v.length <= 15, "Teléfono inválido (con código de país, ej. 595981123456)"),
  nombre: z.string().trim().max(120).nullish(),
  texto: z.string().trim().min(1, "Escribí el mensaje").max(4096),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const canal = await canalSimulador(ctx.empresaId);
    if (!canal) return fail("No hay un canal simulador activo para la empresa.", 409);
    try {
      const r = await registrarEntrante({
        canal_id: canal.id,
        telefono: input.telefono,
        nombre: input.nombre || null,
        externo_id: `sim-in-${crypto.randomUUID()}`,
        tipo: "texto",
        contenido: input.texto,
      });
      return created(r);
    } catch (e) {
      console.error("[conversaciones] simular", (e as Error).message);
      return fail("No se pudo simular el mensaje.");
    }
  },
  { roles: ["ADMIN"], body: cuerpo },
);
