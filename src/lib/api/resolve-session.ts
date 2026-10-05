/**
 * Resuelve, a partir del usuario de auth, a QUÉ empresa/rol pertenece — SIEMPRE desde la
 * base (nunca del request). Es lo que hace que empresa_id y rol sean confiables en el
 * portón. Cache corta en memoria para no pegarle al catálogo en cada request.
 */
import { systemClient } from "@/lib/supabase/clients";
import { tenantSchema } from "@/lib/tenant/schema";

export type TenantSession = { usuarioId: string; empresaId: string; rol: string };

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { at: number; value: TenantSession | null }>();

export async function resolveTenantSession(authUserId: string): Promise<TenantSession | null> {
  const hit = cache.get(authUserId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  // Cliente de sistema sólo para leer el catálogo; no se expone a la ruta.
  const sb = systemClient(tenantSchema());
  const { data, error } = await sb
    .from("usuarios")
    .select("id, empresa_id, rol, activo")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  const value: TenantSession | null =
    error || !data || data.activo === false
      ? null
      : { usuarioId: data.id, empresaId: data.empresa_id, rol: data.rol };

  cache.set(authUserId, { at: Date.now(), value });
  return value;
}
