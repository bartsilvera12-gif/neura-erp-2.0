/**
 * Resuelve, a partir del usuario de auth, a QUÉ empresa/rol/perfil pertenece — SIEMPRE desde
 * la base (nunca del request). Es lo que hace que empresa_id, rol y permisos sean confiables
 * en el portón. Cache en memoria para no pegarle al catálogo en cada request.
 *
 * Perfil (receta 55): pantallas y permisos del perfil del usuario (Administrador: todo) y su
 * alcance de sucursal / tope de descuento. Vienen de `sesion_perfil` (solo service role).
 */
import { systemClient } from "@/lib/supabase/clients";
import { tenantSchema } from "@/lib/tenant/schema";
import type { PerfilSesion } from "@/modules/usuarios/permisos";

export type TenantSession = {
  usuarioId: string;
  empresaId: string;
  rol: string;
  nombre: string;
  sucursalId: string | null;
  perfil: PerfilSesion;
};

// Cache en memoria por usuario de auth (con dedupe: los 3-4 pedidos en paralelo de una
// pantalla recién abierta comparten UNA consulta).
//   - Encontrado: 60 s. Un cambio de perfil / permisos tarda a lo sumo eso en aplicarse en
//     las rutas de OTRA instancia del servidor; en esta se invalida al instante
//     (invalidarSesiones, lo llaman las rutas de Configuración › Usuarios). Desactivar un
//     usuario corta los DATOS al instante igual: la RLS (empresa_actual() exige
//     usuarios.activo) y las funciones de la base se evalúan en vivo en cada query.
//   - No encontrado / error: 30 s, para que un usuario recién dado de alta no espere.
const CACHE_TTL_MS = 60_000;
const CACHE_TTL_NEGATIVO_MS = 30_000;
const CACHE_MAX = 5000;
// En globalThis: cada ruta se empaqueta por separado y tendría su propia copia del módulo;
// así todas comparten UN cache y invalidarSesiones() desde una ruta vale para las demás.
type Entrada = { hasta: number; promesa: Promise<TenantSession | null> };
const g = globalThis as typeof globalThis & { __erpSesiones?: Map<string, Entrada> };
const cache: Map<string, Entrada> = (g.__erpSesiones ??= new Map<string, Entrada>());

type FilaSesion = {
  usuario_id: string;
  empresa_id: string;
  rol: string;
  activo: boolean;
  nombre: string | null;
  sucursal_id: string | null;
  perfil_id: string | null;
  perfil_nombre: string | null;
  perfil_codigo: string | null;
  alcance_sucursal: "propia" | "todas";
  tope_descuento_pct: number | null;
  todo: boolean;
  pantallas: string[] | null;
  permisos: string[] | null;
};

async function consultar(authUserId: string, schema: string): Promise<TenantSession | null> {
  // Cliente de sistema sólo para leer el catálogo; no se expone a la ruta.
  const sb = systemClient(schema);
  const { data, error } = await sb.rpc("sesion_perfil", { p_auth: authUserId });
  const f = data as FilaSesion | null;
  if (error || !f || !f.usuario_id || f.activo === false) return null;
  return {
    usuarioId: f.usuario_id,
    empresaId: f.empresa_id,
    rol: (f.rol ?? "").toUpperCase(),
    nombre: f.nombre ?? "",
    sucursalId: f.sucursal_id,
    perfil: {
      id: f.perfil_id,
      nombre: f.perfil_nombre,
      codigo: f.perfil_codigo,
      todo: !!f.todo,
      alcance: f.alcance_sucursal === "todas" ? "todas" : "propia",
      tope_descuento_pct: f.tope_descuento_pct == null ? null : Number(f.tope_descuento_pct),
      pantallas: f.pantallas ?? [],
      permisos: f.permisos ?? [],
    },
  };
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

/**
 * Olvida las sesiones cacheadas de este schema (todas: un cambio de PERFIL afecta a todos
 * sus usuarios). Lo llaman las rutas que cambian usuarios o perfiles.
 */
export function invalidarSesiones(): void {
  const prefijo = `${tenantSchema()}|`;
  for (const k of [...cache.keys()]) if (k.startsWith(prefijo)) cache.delete(k);
}
