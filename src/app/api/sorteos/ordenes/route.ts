/**
 * GET /api/sorteos/ordenes?sorteo=&estado=&canal=&vendedor=&q=&desde=&limite= → { total, filas } (receta 123).
 * `q` busca por nº de compra, nombre, cédula, teléfono o número de boleta.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloSorteo, uuidValido } from "@/modules/sorteos/server";

export const dynamic = "force-dynamic";

const ESTADOS = ["pendiente_pago", "en_revision", "confirmada", "rechazada", "anulada", "vencida"];
const CANALES = ["manual", "vendedor", "web", "whatsapp"];

export const GET = withTenant(async (ctx, req) => {
  const q = new URL(req.url).searchParams;
  const uuid = (k: string) => (uuidValido(q.get(k)) ? q.get(k) : null);
  const enLista = (k: string, l: string[]) => (l.includes(q.get(k) ?? "") ? q.get(k) : null);
  const { data, error } = await ctx.db.rpc("sorteo_ordenes_lista", {
    p: {
      sorteo_id: uuid("sorteo"),
      vendedor_id: uuid("vendedor"),
      estado: enLista("estado", ESTADOS),
      canal: enLista("canal", CANALES),
      q: (q.get("q") ?? "").slice(0, 80) || null,
      desde: Number(q.get("desde")) || 0,
      limite: Number(q.get("limite")) || 50,
    },
  });
  if (error) return falloSorteo(error, "No se pudieron leer las compras");
  return ok(data);
}, { permiso: "sorteos_vender" });
