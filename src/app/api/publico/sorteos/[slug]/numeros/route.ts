/**
 * Público — números de un sorteo (recetas 123 y 124).
 *   GET /api/publico/sorteos/<slug>/numeros?ver=<n>          → estado de UN número ("verificá tu número")
 *   GET /api/publico/sorteos/<slug>/numeros?libres=<desde>   → hasta 120 números libres desde ahí (para elegir)
 *   GET /api/publico/sorteos/<slug>/numeros?lista=1          → lista de vendidos para recalcular el sorteo
 *                                                               (solo con la venta cerrada)
 */
import { NextResponse } from "next/server";
import { clientePublico } from "@/lib/supabase/publico";
import { permitirIp } from "@/app/api/publico/mesas/limite";
import { ipDe, SLUG_RE } from "@/modules/sorteos/publico";

export const dynamic = "force-dynamic";
const SIN_CACHE = { "cache-control": "no-store" };
const entero = (v: string | null) => (v && /^\d{1,7}$/.test(v) ? Number(v) : null);

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SLUG_RE.test(slug)) return NextResponse.json({ ok: false, error: "No existe ese sorteo" }, { status: 404 });
  const ip = ipDe(req);
  if (!permitirIp(`sorteo-numeros|${ip}`, 90, 60_000)) return NextResponse.json({ ok: false, error: "Demasiadas consultas. Esperá un minuto." }, { status: 429 });
  const q = new URL(req.url).searchParams;
  const db = clientePublico();
  const ver = entero(q.get("ver"));
  const libres = entero(q.get("libres"));
  const { data, error } = ver != null
    ? await db.rpc("sorteo_publico_numero", { p_slug: slug, p_numero: ver, p_ip: ip })
    : libres != null
      ? await db.rpc("sorteo_publico_libres", { p_slug: slug, p_desde: libres, p_cantidad: 120 })
      : q.get("lista") === "1"
        ? await db.rpc("sorteo_publico_lista", { p_slug: slug })
        : { data: null, error: { message: "Pedido inválido" } };
  if (error) return NextResponse.json({ ok: false, error: "No se pudo consultar" }, { status: 400, headers: SIN_CACHE });
  return NextResponse.json({ ok: true, data }, { headers: SIN_CACHE });
}
