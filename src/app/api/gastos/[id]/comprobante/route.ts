/**
 * Comprobante adjunto de un gasto (foto o PDF de la factura del proveedor). Uno por gasto.
 *   GET    /api/gastos/[id]/comprobante → { url, url_descarga, nombre } firmadas (5 min)
 *   POST   /api/gastos/[id]/comprobante → form-data { file } (reemplaza el anterior). Máx. 20 MB,
 *          jpg/png/webp/heic o PDF. Lo sube el servidor al bucket privado "compras" en
 *          {empresa}/{gasto}/{uuid}-{nombre}. No en un gasto anulado.
 *   DELETE /api/gastos/[id]/comprobante → lo quita (fila + archivo)
 */
import { withTenant, type TenantContext } from "@/lib/api/with-tenant";
import { ok, created, fail, ERR } from "@/lib/api/responses";
import {
  borrarComprobante, COMPROBANTE_MAX_BYTES, contenidoCoincide, mimeComprobante, pathComprobante, prefijoComprobantes,
  subirComprobante, urlComprobante,
} from "@/lib/compras/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Fila = { id: string; estado: string; comprobante_path: string | null; comprobante_nombre: string | null };

function gastoId(req: Request): string | null {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const id = segs[segs.indexOf("gastos") + 1];
  return RE_UUID.test(id ?? "") ? id : null;
}

async function cargar(ctx: TenantContext, id: string) {
  const { data, error } = await ctx.db.select("gastos", "id, estado, comprobante_path, comprobante_nombre").eq("id", id).limit(1);
  return { fila: (data?.[0] as unknown as Fila | undefined) ?? null, error };
}

export const GET = withTenant(
  async (ctx, req) => {
    const id = gastoId(req);
    if (!id) return ERR.invalid("Falta el id del gasto");
    const { fila, error } = await cargar(ctx, id);
    if (error) return ERR.server();
    if (!fila?.comprobante_path) return ERR.notFound("comprobante");
    if (!fila.comprobante_path.startsWith(prefijoComprobantes(ctx.empresaId, id))) return ERR.forbidden();
    const nombre = fila.comprobante_nombre ?? "comprobante";
    const [url, url_descarga] = await Promise.all([urlComprobante(fila.comprobante_path), urlComprobante(fila.comprobante_path, nombre)]);
    if (!url) return ERR.server();
    return ok({ url, url_descarga, nombre });
  },
  { roles: ["ADMIN"] },
);

export const POST = withTenant(
  async (ctx, req) => {
    const id = gastoId(req);
    if (!id) return ERR.invalid("Falta el id del gasto");
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

    const { fila, error } = await cargar(ctx, id);
    if (error) return ERR.server();
    if (!fila) return ERR.notFound("gasto");
    if (fila.estado === "anulado") return fail("El gasto está anulado.", 409);

    const datos = new Uint8Array(await f.arrayBuffer());
    if (!contenidoCoincide(datos, mime)) return fail(`«${nombre}» no parece ser un ${mime === "application/pdf" ? "PDF" : "archivo de imagen"} válido.`, 400);
    const path = pathComprobante(ctx.empresaId, id, nombre);
    const up = await subirComprobante(path, datos, mime);
    if (up.error) {
      console.error("[gasto comprobante upload]", up.error);
      return fail("No se pudo subir el archivo. Probá de nuevo.", 502);
    }
    const upd = await ctx.db
      .update("gastos", { comprobante_path: path, comprobante_nombre: nombre, comprobante_mime: mime, comprobante_size: f.size, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (upd.error) {
      await borrarComprobante(path); // que no quede un archivo huérfano
      return fail("No se pudo guardar el comprobante.", 500);
    }
    const viejo = fila.comprobante_path;
    if (viejo && viejo !== path && viejo.startsWith(prefijoComprobantes(ctx.empresaId, id))) await borrarComprobante(viejo);
    return created({ id, nombre, mime, size: f.size });
  },
  { roles: ["ADMIN"] },
);

export const DELETE = withTenant(
  async (ctx, req) => {
    const id = gastoId(req);
    if (!id) return ERR.invalid("Falta el id del gasto");
    const { fila, error } = await cargar(ctx, id);
    if (error) return ERR.server();
    if (!fila?.comprobante_path) return ERR.notFound("comprobante");
    if (fila.estado === "anulado") return fail("El gasto está anulado.", 409);
    const upd = await ctx.db
      .update("gastos", { comprobante_path: null, comprobante_nombre: null, comprobante_mime: null, comprobante_size: null, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (upd.error) return ERR.server();
    if (fila.comprobante_path.startsWith(prefijoComprobantes(ctx.empresaId, id))) await borrarComprobante(fila.comprobante_path);
    return ok({ id });
  },
  { roles: ["ADMIN"] },
);
