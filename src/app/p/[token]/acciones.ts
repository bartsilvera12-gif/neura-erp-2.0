"use server";

/**
 * Acciones del link público de un presupuesto. Solo reenvían a las funciones de la base
 * habilitadas a `anon` (validan el token, el estado y la vigencia); acá no hay datos.
 */
import { revalidatePath } from "next/cache";
import { registrarVista, responderPresupuesto, TOKEN_RE } from "@/modules/presupuestos/publico";

export async function accionVisto(token: string): Promise<void> {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return;
  await registrarVista(token);
}

export async function accionResponder(token: string, accion: "aceptar" | "rechazar", nombre: string, motivo: string) {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return { ok: false as const, error: "Presupuesto no encontrado" };
  if (accion !== "aceptar" && accion !== "rechazar") return { ok: false as const, error: "Acción inválida" };
  const r = await responderPresupuesto(token, accion, String(nombre ?? "").trim(), String(motivo ?? "").trim());
  if (r.ok) revalidatePath(`/p/${token}`);
  return r;
}
