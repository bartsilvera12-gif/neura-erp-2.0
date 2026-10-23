/**
 * Dirección base que llevan los QR de las mesas (servidor). El QR tiene que abrir en el celular
 * del cliente, así que no puede apuntar a "localhost":
 *   1. MENU_PUBLIC_URL (si está configurada) — p. ej. https://erp.miempresa.com.py
 *   2. Si se entró por localhost / 127.0.0.1 en desarrollo → la IP de esta compu en la red local
 *      (mismo puerto), para probar con el celular conectado al mismo Wi-Fi.
 *   3. Si no, el mismo origen con el que se abrió la pantalla.
 */
import { networkInterfaces } from "node:os";

function ipLocal(): string | null {
  for (const lista of Object.values(networkInterfaces())) {
    for (const i of lista ?? []) {
      if (i.family === "IPv4" && !i.internal && /^(192\.168|10|172\.(1[6-9]|2\d|3[01]))\./.test(i.address)) return i.address;
    }
  }
  return null;
}

export function baseMenu(req: Request): string {
  const env = process.env.MENU_PUBLIC_URL?.trim().replace(/\/+$/, "");
  if (env) return env;
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const [nombre, puerto] = host.split(":");
  if (process.env.NODE_ENV !== "production" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(nombre)) {
    const ip = ipLocal();
    if (ip) return `${proto}://${ip}${puerto ? `:${puerto}` : ""}`;
  }
  return `${proto}://${host}`;
}
