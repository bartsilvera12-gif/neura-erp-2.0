/**
 * Descargas del front que necesitan el Bearer (una navegación común no lo lleva):
 * se pide con fetch y se baja como blob.
 */
import { browserClient } from "@/lib/supabase/browser";

async function pedir(path: string): Promise<Response> {
  const { data } = await browserClient().auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(`Error ${res.status}`);
  return res;
}

/** Descarga un archivo (Excel, etc.) con el nombre que manda el servidor. */
export async function descargarArchivo(path: string, nombrePorDefecto: string) {
  const res = await pedir(path);
  const cd = res.headers.get("content-disposition") ?? "";
  const nombre = /filename="?([^";]+)"?/.exec(cd)?.[1] ?? nombrePorDefecto;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}
