/**
 * fetch del lado del cliente que adjunta el token de la sesión como Bearer.
 * Toda llamada del front a /api pasa por acá → el portón withTenant recibe el token.
 *
 * Si la API contesta "No autenticado" (401) con un token que en el navegador parece vigente
 * (la sesión se cerró en el servidor: logout en otro lado, sesión revocada), se intenta
 * renovar UNA vez; si tampoco sirve, se cierra la sesión local y se vuelve al login en vez
 * de dejar la pantalla vacía con errores.
 */
import { browserClient } from "@/lib/supabase/browser";

async function token(): Promise<string | undefined> {
  const { data } = await browserClient().auth.getSession();
  return data.session?.access_token;
}

let renovando: Promise<string | undefined> | null = null;
let saliendo = false;

/** Renueva la sesión una sola vez aunque fallen varias llamadas a la vez. */
function renovar(): Promise<string | undefined> {
  renovando ??= browserClient()
    .auth.refreshSession()
    .then(({ data, error }) => (error ? undefined : data.session?.access_token))
    .catch(() => undefined)
    .finally(() => { setTimeout(() => { renovando = null; }, 1000); });
  return renovando;
}

function irAlLogin() {
  if (saliendo || typeof window === "undefined" || window.location.pathname.startsWith("/login")) return;
  saliendo = true;
  void browserClient().auth.signOut({ scope: "local" }).finally(() => {
    window.location.assign("/login?sesion=expirada");
  });
}

/** Hace el pedido con el token; ante un 401 renueva y reintenta una vez, y si no, al login. */
async function conSesion(hacer: (t: string | undefined) => Promise<Response>): Promise<Response> {
  const res = await hacer(await token());
  if (res.status !== 401) return res;
  const nuevo = await renovar();
  if (nuevo) {
    const otra = await hacer(nuevo);
    if (otra.status !== 401) return otra;
  }
  irAlLogin();
  return res;
}

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await conSesion((t) => {
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json");
    if (t) headers.set("Authorization", `Bearer ${t}`);
    return fetch(path, { ...init, headers });
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.ok === false) {
    throw new Error(body?.error?.message || `Error ${res.status}`);
  }
  return (body?.data ?? body) as T;
}

/** Igual que apiFetch pero manda un form-data (subida de archivos): sin Content-Type JSON. */
export async function apiForm<T = unknown>(path: string, form: FormData): Promise<T> {
  const res = await conSesion((t) => fetch(path, { method: "POST", body: form, headers: t ? { Authorization: `Bearer ${t}` } : {} }));
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.ok === false) throw new Error(body?.error?.message || `Error ${res.status}`);
  return (body?.data ?? body) as T;
}
