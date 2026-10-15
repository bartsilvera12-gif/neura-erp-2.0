/**
 * PDF del presupuesto desde el link público. GET /p/<token>/pdf
 * Mismo documento que el interno (solo campos públicos), vía la función anónima por token.
 */
import { respuestaPdf } from "@/lib/pdf/documento";
import { nombreArchivoPresupuesto, pdfPresupuesto } from "@/modules/presupuestos/pdf";
import { presupuestoPorToken } from "@/modules/presupuestos/publico";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const token = segs[segs.indexOf("p") + 1] ?? "";
  const p = await presupuestoPorToken(token);
  if (!p || p.expirado) return new Response("Presupuesto no disponible", { status: 404, headers: { "cache-control": "no-store" } });
  const doc = await pdfPresupuesto(p);
  return respuestaPdf(doc, nombreArchivoPresupuesto(p.numero, p.revision));
}
