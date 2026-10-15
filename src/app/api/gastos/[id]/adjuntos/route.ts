/**
 * Adjuntos de un gasto (fotos o PDF: factura, recibo, transferencia…). Varios por gasto (máx. 20).
 *   POST /api/gastos/[id]/adjuntos → form-data { file }. Máx. 20 MB, jpg/png/webp/heic o PDF. Lo sube
 *        el servidor al bucket privado "compras" en {empresa}/{gasto}/{uuid}-{nombre}; la fila la
 *        registra gasto_adjunto_agregar (valida empresa, rol y que el gasto no esté anulado).
 */
import { withTenant } from "@/lib/api/with-tenant";
import { created, fail, ERR } from "@/lib/api/responses";
import {
  borrarComprobante, COMPROBANTE_MAX_BYTES, contenidoCoincide, mimeComprobante, pathComprobante, subirComprobante,
} from "@/lib/compras/storage";
import { mensajeDb } from "@/lib/gastos/esquema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST = withTenant(
  async (ctx, req) => {
    const segs = new URL(req.url).pathname.split("/").filter(Boolean);
    const id = segs[segs.indexOf("gastos") + 1];
    if (!RE_UUID.test(id ?? "")) return ERR.invalid("Falta el id del gasto");
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return fail("Form-data inválido (¿el archivo supera los 20 MB?).", 400);
    }
    const f = form.get("file");
    if (!(f instanceof File) || f.size === 0) return fail("Falta el archivo.", 400);
    const nombre = (f.name || "adjunto").slice(0, 200);
    if (f.size > COMPROBANTE_MAX_BYTES) return fail(`«${nombre}» supera los 20 MB.`, 400);
    const mime = mimeComprobante(nombre, f.type);
    if (!mime) return fail(`«${nombre}» no es una foto (JPG, PNG, WEBP, HEIC) ni un PDF.`, 400);

    const g = await ctx.db.select("gastos", "id, estado").eq("id", id).limit(1);
    if (g.error) return ERR.server();
    const fila = g.data?.[0] as unknown as { estado: string } | undefined;
    if (!fila) return ERR.notFound("gasto");
    if (fila.estado === "anulado") return fail("El gasto está anulado.", 409);

    const datos = new Uint8Array(await f.arrayBuffer());
    if (!contenidoCoincide(datos, mime)) return fail(`«${nombre}» no parece ser un ${mime === "application/pdf" ? "PDF" : "archivo de imagen"} válido.`, 400);
    const path = pathComprobante(ctx.empresaId, id, nombre);
    const up = await subirComprobante(path, datos, mime);
    if (up.error) {
      console.error("[gasto adjunto upload]", up.error);
      return fail("No se pudo subir el archivo. Probá de nuevo.", 502);
    }
    const { data, error } = await ctx.db.rpc("gasto_adjunto_agregar", { p_gasto: id, p_nombre: nombre, p_path: path, p_mime: mime, p_size: f.size });
    if (error) {
      await borrarComprobante(path); // que no quede un archivo huérfano
      return fail(mensajeDb(error.message), 422);
    }
    return created(data);
  },
  { roles: ["ADMIN"] },
);
