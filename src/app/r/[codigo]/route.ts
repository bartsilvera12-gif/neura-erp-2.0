/**
 * /r/<código>[?s=<slug>] — link de referido de un vendedor (receta 124). Cuenta el clic y lleva a la
 * página del sorteo con el vendedor marcado (las compras web quedan a su nombre). Sin sorteo a la
 * venta o con un código que no existe, va al inicio sin decir nada más.
 */
import { NextResponse } from "next/server";
import { clientePublico } from "@/lib/supabase/publico";
import { CODIGO_RE, SLUG_RE } from "@/modules/sorteos/publico";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  const url = new URL(req.url);
  const slug = url.searchParams.get("s");
  const base = (process.env.APP_URL ?? url.origin).replace(/\/+$/, "");
  if (!CODIGO_RE.test(codigo)) return NextResponse.redirect(`${base}/login`);
  const { data } = await clientePublico().rpc("sorteo_referido", { p_codigo: codigo, p_slug: slug && SLUG_RE.test(slug) ? slug : null });
  const r = data as { codigo: string; slug: string | null } | null;
  if (!r?.slug) return NextResponse.redirect(`${base}/login`);
  return NextResponse.redirect(`${base}/s/${r.slug}?v=${encodeURIComponent(r.codigo)}`);
}
