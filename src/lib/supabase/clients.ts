/**
 * Clientes de Supabase del lado servidor.
 *
 * - `userClient(bearer)`: habla como el USUARIO. La RLS de la base lo limita a lo suyo.
 *   Es el camino por defecto. Siempre sin auto-refresh (evita la fuga de memoria: en el
 *   servidor createClient() por defecto deja un setInterval vivo por request).
 *
 * - `scopedServiceClient(empresaId)`: usa service-role (saltea RLS) PERO queda atado a
 *   una empresa. Úsese sólo en los pocos casos revisados que lo necesitan (cron, tareas
 *   de sistema). Nunca se importa suelto en una ruta: va detrás de withTenant.
 *
 * El schema del tenant se fija por `db: { schema }` para que PostgREST apunte al schema
 * correcto sin que nadie lo escriba a mano.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { tenantSchema } from "@/lib/tenant/schema";

const NO_REFRESH = { auth: { autoRefreshToken: false, persistSession: false } } as const;

function env(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

/** Cliente con la sesión del usuario (Bearer). La RLS hace el aislamiento. */
export function userClient(bearer: string, schema: string = tenantSchema()): SupabaseClient {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    ...NO_REFRESH,
    db: { schema },
    global: { headers: { Authorization: `Bearer ${bearer}` } },
  });
}

/** Cliente anónimo sólo para validar el token (getUser). No toca datos. */
export function authOnlyClient(): SupabaseClient {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), NO_REFRESH);
}

/**
 * Cliente service-role atado a una empresa. Saltea RLS, por eso el aislamiento lo
 * garantiza withTenant inyectando empresa_id en cada operación (ver tenant-db.ts).
 * No usar directo: siempre a través del contexto de withTenant.
 */
export function scopedServiceClient(empresaId: string, schema: string = tenantSchema()): SupabaseClient {
  if (!empresaId) throw new Error("scopedServiceClient requiere empresaId");
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    ...NO_REFRESH,
    db: { schema },
  });
}

/**
 * Cliente de sistema (service-role) NO atado a empresa. Sólo para lecturas internas de
 * catálogo/infra dentro de lib/ (ej. resolver a qué empresa pertenece un usuario).
 * PROHIBIDO importarlo desde una ruta: el lint lo bloquea fuera de lib/.
 */
export function systemClient(schema: string = tenantSchema()): SupabaseClient {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    ...NO_REFRESH,
    db: { schema },
  });
}
