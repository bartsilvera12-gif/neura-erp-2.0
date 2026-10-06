/**
 * Cliente de Supabase para el NAVEGADOR. Guarda la sesión (localStorage) y refresca el
 * token solo. Se usa para login/logout y para leer el access_token con el que la app
 * llama a sus propias rutas /api (Authorization: Bearer <token>).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let singleton: SupabaseClient | null = null;

export function browserClient(): SupabaseClient {
  if (singleton) return singleton;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL / ANON_KEY");
  singleton = createClient(url, anon, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return singleton;
}
