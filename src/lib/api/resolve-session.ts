/**
 * Resuelve, a partir del usuario de auth, a QUÉ empresa/rol pertenece — SIEMPRE desde la
 * base (nunca del request). Es lo que hace que empresa_id y rol sean confiables en el
 * portón. Cache en memoria para no pegarle al catálogo en cada request.
 */
import { systemClient } from "@/lib/supabase/clients";
import { tenantSchema } from "@/lib/tenant/schema";

export type TenantSession = { usuarioId: string; empresaId: string; rol: string };

// Cache en memoria por usuario de auth (con dedupe: los 3-4 pedidos en paralelo de una
// pantalla recién abierta comparten UNA consulta).
//   - Encontrado: 5 min. Un cambio de ROL tarda hasta 5 min en aplicarse en los permisos
//     de las rutas. Desactivar un usuario corta los DATOS al instante igual: la RLS
//     (empresa_actual() exige usuarios.activo) se evalúa en vivo en cada query.
//   - No encontrado / error: 30 s, para que un usuario recién dado de alta no espere.
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_TTL_NEGATIVO_MS = 30_000;
const CACHE_MAX = 5000;
const cache = new Map<string, { hasta: number; promesa: Promise<TenantSession | null> }>();

async function consultar(authUserId: string, schema: string): Promise<TenantSession | null> {
  // Cliente de sistema sólo para leer el catálogo; no se expone a la ruta.
  const sb = systemClient(schema);
  const { data, error } = await sb
    .from("usuarios")
    .select("id, empresa_id, rol, activo")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  return error || !data || data.activo === false
    ? null
    : { usuarioId: data.id, empresaId: data.empresa_id, rol: data.rol };
}

export async function resolveTenantSession(authUserId: string): Promise<TenantSession | null> {
  const schema = tenantSchema();
  const clave = `${schema}|${authUserId}`;
  const ahora = Date.now();
  const hit = cache.get(clave);
  if (hit && hit.hasta > ahora) return hit.promesa;
  if (hit) cache.delete(clave);

  const promesa = consultar(authUserId, schema);
  const entrada = { hasta: ahora + CACHE_TTL_MS, promesa };
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(clave, entrada);
  try {
    const value = await promesa;
    if (!value && cache.get(clave) === entrada) entrada.hasta = Date.now() + CACHE_TTL_NEGATIVO_MS;
    return value;
  } catch (e) {
    if (cache.get(clave) === entrada) cache.delete(clave);
    throw e;
  }
}
