/**
 * API PÚBLICA (sin sesión) del menú de una mesa: la usa /m/<token> desde el celular del cliente.
 *   GET  /api/publico/mesas/<token>  → el menú (solo productos "En el menú QR")
 *   POST /api/publico/mesas/<token>  { items: [{ producto_id, cantidad, nota? }], nota?, nombre? }
 *        → { seguimiento, numero, estado, total }
 * Solo reenvía a funciones de la base habilitadas a `anon` (validan el token, la mesa activa, las
 * cantidades, el límite por minuto y ponen los precios). Además, un tope chico por IP en memoria.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { crearPedido, menuPorToken } from "@/modules/mesas/publico";
import { TOKEN_MESA_RE } from "@/modules/mesas/tipos";
import { permitirIp } from "../limite";

export const dynamic = "force-dynamic";

const SIN_CACHE = { "Cache-Control": "no-store" };
const tokenDe = (url: string) => {
  const segs = new URL(url).pathname.split("/").filter(Boolean);
  const t = segs[segs.indexOf("mesas") + 1] ?? "";
  return TOKEN_MESA_RE.test(t) ? t : null;
};
const error = (message: string, status: number) => NextResponse.json({ ok: false, error: { message } }, { status, headers: SIN_CACHE });

export async function GET(req: NextRequest) {
  const token = tokenDe(req.url);
  if (!token) return error("Mesa no encontrada", 404);
  try {
    const menu = await menuPorToken(token);
    if (!menu) return error("Mesa no encontrada", 404);
    return NextResponse.json({ ok: true, data: menu }, { headers: SIN_CACHE });
  } catch {
    return error("No se pudo cargar el menú", 500);
  }
}

const cuerpo = z.object({
  items: z
    .array(
      z.object({
        producto_id: z.string().uuid(),
        cantidad: z.coerce.number().int("La cantidad va en unidades enteras").min(1).max(50, "Hasta 50 unidades por producto"),
        nota: z.string().trim().max(200).nullish(),
      }),
    )
    .min(1, "Agregá al menos un producto")
    .max(30, "Son demasiados productos en un solo pedido (hasta 30)"),
  nota: z.string().trim().max(500, "La nota es muy larga").nullish(),
  nombre: z.string().trim().max(60, "El nombre es muy largo").nullish(),
});

export async function POST(req: NextRequest) {
  const token = tokenDe(req.url);
  if (!token) return error("Mesa no encontrada", 404);
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
  if (!permitirIp(`pedido|${ip}`, 8, 60_000)) return error("Mandaste varios pedidos seguidos: esperá un minuto y probá de nuevo", 429);

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return error("Pedido inválido", 400);
  }
  const p = cuerpo.safeParse(json);
  if (!p.success) return error(p.error.issues[0]?.message ?? "Pedido inválido", 422);

  const r = await crearPedido(
    token,
    p.data.items.map((i) => ({ producto_id: i.producto_id, cantidad: i.cantidad, nota: i.nota || null })),
    p.data.nota || null,
    p.data.nombre || null,
  );
  if (!r.ok) return error(r.error, 409);
  return NextResponse.json({ ok: true, data: r.pedido }, { status: 201, headers: SIN_CACHE });
}
