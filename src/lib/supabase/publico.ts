/**
 * Cliente ANÓNIMO del servidor para las páginas públicas por token (ej. /p/<token> de un
 * presupuesto). Usa la clave pública (anon): NO saltea la RLS ni ve tablas. Solo puede
 * ejecutar las funciones que la base habilita a `anon` (SECURITY DEFINER que validan el
 * token y devuelven únicamente los campos públicos). Sin service-role a propósito: aunque
 * la página tuviera un bug, no podría leer nada más.
 */
import { createClient } from "@supabase/supabase-js";
import { tenantSchema } from "@/lib/tenant/schema";

export function clientePublico() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anon) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: tenantSchema() },
  });
}
