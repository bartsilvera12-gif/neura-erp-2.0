/**
 * Público (sin sesión) — un sorteo por su slug (recetas 123 y 124).
 *   GET  /api/publico/sorteos/<slug>          → datos públicos, combos, premios y verificación
 *   POST /api/publico/sorteos/<slug>          → compra web: reserva los números `reserva_minutos`
 *        { cantidad | numeros[], comprador: { nombre, documento, telefono, ciudad? }, vendedor?, idempotency_key }
 *        → { token } (el link privado de la compra es /t/<token>)
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { clientePublico } from "@/lib/supabase/publico";
import { permitirIp } from "@/app/api/publico/mesas/limite";
import { ipDe, mensajeDb, SLUG_RE, sorteoPublico } from "@/modules/sorteos/publico";

export const dynamic = "force-dynamic";
const SIN_CACHE = { "cache-control": "no-store" };

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const s = await sorteoPublico(slug);
    if (!s) return NextResponse.json({ ok: false, error: "No existe ese sorteo" }, { status: 404, headers: SIN_CACHE });
    return NextResponse.json({ ok: true, data: s }, { headers: SIN_CACHE });
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudo cargar el sorteo" }, { status: 502, headers: SIN_CACHE });
  }
}

const cuerpo = z.object({
  cantidad: z.number().int().min(1).max(100000).optional(),
  numeros: z.array(z.number().int().min(0)).min(1).max(200).optional(),
  comprador: z.object({
    nombre: z.string().trim().min(2).max(120),
    documento: z.string().trim().min(5).max(20),
    telefono: z.string().trim().min(8).max(30),
    ciudad: z.string().trim().max(80).nullish(),
  }),
  vendedor: z.string().regex(/^[A-Za-z0-9]{3,20}$/).nullish(),
  idempotency_key: z.string().min(8).max(80),
});

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SLUG_RE.test(slug)) return NextResponse.json({ ok: false, error: "No existe ese sorteo" }, { status: 404 });
  const ip = ipDe(req);
  if (!permitirIp(`sorteo-compra|${ip}`, 8, 60_000)) {
    return NextResponse.json({ ok: false, error: "Demasiados intentos. Probá de nuevo en un minuto." }, { status: 429 });
  }
  const json = await req.json().catch(() => null);
  const r = cuerpo.safeParse(json);
  if (!r.success) return NextResponse.json({ ok: false, error: "Revisá tus datos: nombre, cédula y celular." }, { status: 422 });
  if (!r.data.cantidad && !r.data.numeros?.length) return NextResponse.json({ ok: false, error: "Elegí cuántas boletas." }, { status: 422 });
  const { data, error } = await clientePublico().rpc("sorteo_publico_comprar", { p_slug: slug, p: r.data, p_ip: ip });
  if (error) return NextResponse.json({ ok: false, error: mensajeDb(error.message, "No se pudo hacer la compra") }, { status: 400 });
  const token = (data as { token?: string } | null)?.token;
  if (!token) return NextResponse.json({ ok: false, error: "No se pudo hacer la compra" }, { status: 400 });
  return NextResponse.json({ ok: true, data: { token } }, { headers: SIN_CACHE });
}
