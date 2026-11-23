import { NextResponse, type NextRequest } from "next/server";
import { BLOQUEO_PAGO_MENSAJE, BLOQUEO_PAGO_PATH, erpBloqueadoPorFaltaDePago } from "@/lib/bloqueo-pago";

/**
 * Portón de "acceso suspendido por falta de pago". Consulta el estado al sistema
 * de Neura por el dominio (ver bloqueo-pago.ts); si está bloqueado manda todo a
 * /bloqueado y responde 402 en /api. Si no, deja pasar; y si el usuario quedó
 * parado en /bloqueado tras rehabilitar, lo manda al inicio. Fail-open.
 *
 * (El 2.0 refresca la sesión en el layout de la app, no en el middleware.)
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (await erpBloqueadoPorFaltaDePago(request.headers)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: BLOQUEO_PAGO_MENSAJE }, { status: 402 });
    }
    if (pathname !== BLOQUEO_PAGO_PATH) {
      const bloqueoUrl = request.nextUrl.clone();
      bloqueoUrl.pathname = BLOQUEO_PAGO_PATH;
      bloqueoUrl.search = "";
      return NextResponse.redirect(bloqueoUrl, 307);
    }
    return NextResponse.next();
  }

  if (pathname === BLOQUEO_PAGO_PATH) {
    const inicio = request.nextUrl.clone();
    inicio.pathname = "/";
    inicio.search = "";
    return NextResponse.redirect(inicio, 307);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api/webhooks|_next/static|_next/image|favicon.ico|icon.png|brand/|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)",
  ],
};
