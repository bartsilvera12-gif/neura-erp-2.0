/**
 * fetch del lado del cliente que adjunta el token de la sesión como Bearer.
 * Toda llamada del front a /api pasa por acá → el portón withTenant recibe el token.
 */
import { browserClient } from "@/lib/supabase/browser";

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await browserClient().auth.getSession();
  const token = data.session?.access_token;
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(path, { ...init, headers });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.ok === false) {
    throw new Error(body?.error?.message || `Error ${res.status}`);
  }
  return (body?.data ?? body) as T;
}
