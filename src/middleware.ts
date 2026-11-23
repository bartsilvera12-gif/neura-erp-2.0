import { NextResponse, type NextRequest } from "next/server";

/**
 * Portón: "Acceso suspendido por falta de pago".
 *
 * Lee `empresas.acceso_suspendido` (schema del tenant, APP_DB_SCHEMA) con un cache
 * corto en memoria. Si está en `true`, manda TODA la navegación a /bloqueado y
 * responde 402 en /api/*. El panel de Neura (sistemas-propio) prende/apaga el flag;
 * acá sólo se lee. Webhooks y estáticos quedan fuera (ver matcher).
 *
 * FAIL-OPEN a propósito: ante cualquier error de lectura NO bloquea (nunca dejar a un
 * cliente afuera por un glitch). El cambio tarda hasta `TTL_MS` en propagarse.
 */
const BLOQUEADO_PATH = "/bloqueado";
const TTL_MS = 5_000;
let cache: { suspendido: boolean; at: number } = { suspendido: false, at: 0 };

async function leerSuspendido(): Promise<boolean> {
  const now = Date.now();
  if (now - cache.at < TTL_MS) return cache.suspendido;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const schema = process.env.APP_DB_SCHEMA;
  if (!url || !key || !schema) return cache.suspendido;

  try {
    const r = await fetch(`${url}/rest/v1/empresas?select=acceso_suspendido&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Accept-Profile": schema },
      cache: "no-store",
    });
    if (!r.ok) return cache.suspendido;
    const rows = (await r.json()) as Array<{ acceso_suspendido?: boolean }>;
    const suspendido = Array.isArray(rows) && rows[0]?.acceso_suspendido === true;
    cache = { suspendido, at: now };
    return suspendido;
  } catch {
    return cache.suspendido;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const suspendido = await leerSuspendido();

  if (suspendido) {
    // Bloqueado: todo va a /bloqueado; las APIs responden 402.
    if (pathname === BLOQUEADO_PATH) return NextResponse.next();
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Acceso suspendido por falta de pago. Comunicate con Neura." },
        { status: 402 }
      );
    }
    const destino = request.nextUrl.clone();
    destino.pathname = BLOQUEADO_PATH;
    destino.search = "";
    return NextResponse.redirect(destino, 307);
  }

  // Habilitado: si quedó parado en /bloqueado, al recargar lo mandamos al inicio.
  if (pathname === BLOQUEADO_PATH) {
    const destino = request.nextUrl.clone();
    destino.pathname = "/";
    destino.search = "";
    return NextResponse.redirect(destino, 307);
  }

  return NextResponse.next();
}

export const config = {
  // Todo menos: webhooks (deben seguir recibiendo), estáticos de Next y archivos de imagen
  // (para que /bloqueado cargue el logo).
  matcher: [
    "/((?!api/webhooks|_next/static|_next/image|favicon.ico|icon.png|brand/|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)",
  ],
};
