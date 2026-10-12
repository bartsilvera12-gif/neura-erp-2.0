/**
 * Campanita — lado servidor. Solo servidor (detrás de withTenant).
 */
import type { TenantDb } from "@/lib/api/tenant-db";

/**
 * Inserta un aviso en la campanita de OTRO usuario. Sin `.select()`: la RLS de
 * usuario_notificaciones sólo deja LEER las propias, y pedir la fila insertada
 * haría fallar el insert. Nunca hace fallar la operación que avisa.
 */
export async function notificar(
  db: TenantDb,
  empresaId: string,
  n: { usuarioId: string; tipo: string; bandeja: "general" | "soporte"; titulo: string; cuerpo?: string | null; url?: string | null },
): Promise<void> {
  try {
    const { error } = await db.unsafeRaw().from("usuario_notificaciones").insert({
      empresa_id: empresaId,
      usuario_id: n.usuarioId,
      tipo: n.tipo,
      bandeja: n.bandeja,
      titulo: n.titulo.slice(0, 200),
      cuerpo: n.cuerpo ? n.cuerpo.slice(0, 500) : null,
      url: n.url ?? null,
    });
    if (error) console.error("[notificar]", error.message);
  } catch (e) {
    console.error("[notificar]", (e as Error)?.message);
  }
}
