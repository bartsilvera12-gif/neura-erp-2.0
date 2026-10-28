/**
 * API PÚBLICA (sin sesión): la cuenta abierta de una mesa desde el celular (receta 88).
 *   GET  /api/publico/mesas/<token>/cuenta → { abierta, total, items[], division, facturacion, … }
 *   POST /api/publico/mesas/<token>/cuenta
 *        { accion: "pedir_cuenta", pedir: boolean }               → pedir / cancelar la solicitud
 *        { accion: "dividir", division: {...} | null }             → separar (null = dejar de separar)
 *        { accion: "facturacion", parte, ruc, razon_social, email } → datos propuestos (ruc vacío = borrar)
 *        { accion: "buscar_ruc", documento }                       → { encontrado, razon_social?, ruc? }
 * Todo pasa por funciones de la base habilitadas a `anon` que validan el token, que la mesa esté
 * activa y que haya una cuenta ABIERTA de esa mesa (no se ve ni se toca nada más). Además de los
 * topes por mesa de la base, un tope chico por IP en memoria.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { buscarRuc, cuentaPublica, dividirCuenta, guardarFacturacion, pedirCuenta } from "@/modules/mesas/publico";
import { TOKEN_MESA_RE } from "@/modules/mesas/tipos";
import { permitirIp } from "../../limite";

export const dynamic = "force-dynamic";
const SIN_CACHE = { "Cache-Control": "no-store" };

const tokenDe = (url: string) => {
  const segs = new URL(url).pathname.split("/").filter(Boolean);
  const t = segs[segs.indexOf("mesas") + 1] ?? "";
  return TOKEN_MESA_RE.test(t) ? t : null;
};
const ipDe = (req: NextRequest) => (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
const error = (message: string, status: number) => NextResponse.json({ ok: false, error: { message } }, { status, headers: SIN_CACHE });
const okJson = (data: unknown) => NextResponse.json({ ok: true, data }, { headers: SIN_CACHE });

export async function GET(req: NextRequest) {
  const token = tokenDe(req.url);
  if (!token) return error("Mesa no encontrada", 404);
  // Polling cada ~5 s desde cada celular de la mesa (y varias mesas detrás de la misma red).
  if (!permitirIp(`cuenta|${ipDe(req)}`, 300, 60_000)) return error("Demasiadas consultas", 429);
  try {
    const c = await cuentaPublica(token);
    if (!c) return error("Mesa no encontrada", 404);
    return okJson(c);
  } catch {
    return error("No se pudo cargar la cuenta", 500);
  }
}

const nombre = z.string().trim().max(40, "El nombre es muy largo (hasta 40 letras)");
const division = z.union([
  z.object({
    modo: z.literal("iguales"),
    personas: z.coerce.number().int().min(2, "Separá entre 2 personas o más").max(20, "Hasta 20 personas"),
    partes: z.array(z.object({ nombre })).max(20).optional(),
  }),
  z.object({
    modo: z.literal("productos"),
    partes: z.array(z.object({ nombre })).min(2, "Separá entre 2 personas o más").max(20, "Hasta 20 personas"),
    asignaciones: z.array(z.object({
      item_id: z.string().uuid(),
      reparto: z.array(z.object({
        parte: z.coerce.number().int().min(1).max(20),
        cantidad: z.coerce.number().positive().max(50),
      })).min(1).max(20),
    })).max(400),
  }),
]);

const cuerpo = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("pedir_cuenta"), pedir: z.boolean() }),
  z.object({ accion: z.literal("dividir"), division: division.nullable() }),
  z.object({
    accion: z.literal("facturacion"),
    parte: z.coerce.number().int().min(1).max(40).nullable(),
    ruc: z.string().trim().max(20).nullable(),
    razon_social: z.string().trim().max(150, "La razón social es muy larga").nullable(),
    email: z.string().trim().max(120, "El email es muy largo").nullable(),
  }),
  z.object({ accion: z.literal("buscar_ruc"), documento: z.string().trim().min(3, "Escribí el RUC o la cédula").max(20) }),
]);

export async function POST(req: NextRequest) {
  const token = tokenDe(req.url);
  if (!token) return error("Mesa no encontrada", 404);
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return error("Datos inválidos", 400);
  }
  const p = cuerpo.safeParse(json);
  if (!p.success) return error(p.error.issues[0]?.message ?? "Datos inválidos", 422);
  const b = p.data;
  const ip = ipDe(req);
  if (b.accion === "buscar_ruc") {
    if (!permitirIp(`buscar_ruc|${ip}`, 10, 60_000)) return error("Hiciste muchas búsquedas seguidas: esperá un minuto", 429);
  } else if (!permitirIp(`cuenta_escribir|${ip}`, 40, 60_000)) {
    return error("Hiciste muchos cambios seguidos: esperá un minuto y probá de nuevo", 429);
  }

  try {
    const r =
      b.accion === "pedir_cuenta" ? await pedirCuenta(token, b.pedir)
        : b.accion === "dividir" ? await dividirCuenta(token, b.division)
          : b.accion === "facturacion" ? await guardarFacturacion(token, b.parte, b.ruc || null, b.razon_social || null, b.email || null)
            : await buscarRuc(token, b.documento);
    if (!r.ok) return error(r.error, 409);
    return okJson(r.data);
  } catch {
    return error("No se pudo guardar. Probá de nuevo.", 500);
  }
}
