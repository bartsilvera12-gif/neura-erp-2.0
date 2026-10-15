/**
 * Lado servidor del link público de un presupuesto (/p/<token>). Todo pasa por funciones
 * de la base habilitadas a `anon` que validan el token (ver db/canonical/53_presupuestos.sql).
 */
import { clientePublico } from "@/lib/supabase/publico";
import type { PresupuestoPublico } from "@/modules/presupuestos/tipos";

export const TOKEN_RE = /^[0-9a-f]{64}$/;

/** El presupuesto para mostrar, o null si el token no existe / es un borrador. */
export async function presupuestoPorToken(token: string): Promise<PresupuestoPublico | null> {
  if (!TOKEN_RE.test(token)) return null;
  const { data, error } = await clientePublico().rpc("presupuesto_publico", { p_token: token });
  if (error) {
    console.error("[presupuesto_publico]", error.message);
    return null;
  }
  return (data as PresupuestoPublico | null) ?? null;
}

export async function registrarVista(token: string): Promise<void> {
  if (!TOKEN_RE.test(token)) return;
  const { error } = await clientePublico().rpc("presupuesto_publico_visto", { p_token: token });
  if (error) console.error("[presupuesto_publico_visto]", error.message);
}

export async function responderPresupuesto(token: string, accion: "aceptar" | "rechazar", nombre: string, motivo: string) {
  if (!TOKEN_RE.test(token)) return { ok: false as const, error: "Presupuesto no encontrado" };
  const { data, error } = await clientePublico().rpc("presupuesto_publico_responder", {
    p_token: token,
    p_accion: accion,
    p_nombre: nombre.slice(0, 120) || null,
    p_motivo: motivo.slice(0, 500) || null,
  });
  if (error) return { ok: false as const, error: error.message.replace(/^.*?ERROR:\s*/, "") };
  return { ok: true as const, estado: (data as { estado: string }).estado };
}
