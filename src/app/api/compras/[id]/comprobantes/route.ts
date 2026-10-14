/**
 * Comprobantes de una compra (foto o PDF de la factura del proveedor).
 *   GET  /api/compras/[id]/comprobantes → { comprobantes } más reciente al final
 *   POST /api/compras/[id]/comprobantes → form-data { file } (ADMIN). Un archivo por
 *        pedido, máx. 20 MB, solo jpg/png/webp/heic y PDF. Lo sube el servidor al bucket
 *        privado "compras" en {empresa}/{compra}/{uuid}-{nombre}.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, fail, ERR } from "@/lib/api/responses";
import {
  borrarComprobante, COMPROBANTE_MAX_BYTES, contenidoCoincide, mimeComprobante, pathComprobante, subirComprobante,
} from "@/lib/compras/storage";
import { COLS_COMPROBANTE } from "@/modules/compras/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function compraId(req: Request): string | null {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const id = segs[segs.indexOf("compras") + 1];
  return RE_UUID.test(id ?? "") ? id : null;
}

export const GET = withTenant(async (ctx, req) => {
  const id = compraId(req);
  if (!id) return ERR.invalid("Falta el id de la compra");
  const { data, error } = await ctx.db
    .select("compras_comprobantes", COLS_COMPROBANTE)
    .eq("compra_id", id)
    .order("created_at", { ascending: true });
  if (error) return ERR.server();
  return ok({ comprobantes: data ?? [] });
}, { roles: ["ADMIN"] });

export const POST = withTenant(
  async (ctx, req) => {
    const id = compraId(req);
    if (!id) return ERR.invalid("Falta el id de la compra");
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return fail("Form-data inválido (¿el archivo supera los 20 MB?).", 400);
    }
    const f = form.get("file");
    if (!(f instanceof File) || f.size === 0) return fail("Falta el archivo.", 400);
    const nombre = (f.name || "comprobante").slice(0, 200);
    if (f.size > COMPROBANTE_MAX_BYTES) return fail(`«${nombre}» supera los 20 MB.`, 400);
    const mime = mimeComprobante(nombre, f.type);
    if (!mime) return fail(`«${nombre}» no es una foto (JPG, PNG, WEBP, HEIC) ni un PDF.`, 400);

    const compra = await ctx.db.select("compras", "id").eq("id", id).limit(1);
    if (compra.error) return ERR.server();
    if (!compra.data?.length) return ERR.notFound("compra");

    const datos = new Uint8Array(await f.arrayBuffer());
    if (!contenidoCoincide(datos, mime)) return fail(`«${nombre}» no parece ser un ${mime === "application/pdf" ? "PDF" : "archivo de imagen"} válido.`, 400);

    const path = pathComprobante(ctx.empresaId, id, nombre);
    const up = await subirComprobante(path, datos, mime);
    if (up.error) {
      console.error("[comprobante upload]", up.error);
      return fail("No se pudo subir el archivo. Probá de nuevo.", 502);
    }
    const ins = await ctx.db.insert("compras_comprobantes", {
      compra_id: id,
      nombre,
      storage_path: path,
      mime,
      size: f.size,
      subido_por: ctx.usuarioId,
    });
    const fila = ins.data?.[0] as Record<string, unknown> | undefined;
    if (ins.error || !fila) {
      await borrarComprobante(path); // que no quede un archivo huérfano
      console.error("[comprobante insert]", ins.error?.message);
      return fail("No se pudo guardar el comprobante.", 500);
    }
    return created({
      id: fila.id, compra_id: id, nombre, mime, size: f.size, subido_por: ctx.usuarioId, created_at: fila.created_at,
    });
  },
  { roles: ["ADMIN"] },
);
