/** Clientes — lado servidor. Solo servidor. */
import type { TenantDb } from "@/lib/api/tenant-db";

/**
 * Nombre del cliente vivo que ya tiene este documento (sin importar puntos ni guion), o
 * null. `excepto` = el propio cliente al editar.
 */
export async function documentoRepetido(db: TenantDb, documento: string, excepto?: string): Promise<string | null> {
  const { data } = await db.rpc<string | null>("cliente_por_documento", { p_documento: documento, p_excepto: excepto ?? null });
  return data ?? null;
}
