/**
 * Conciliación bancaria — transferencias que esperan aprobación (maker-checker).
 *   GET  /api/cobranzas/conciliacion?estado=pendiente|aprobado|rechazado|anulado&desde&hasta&q
 *        → { conteos, total_monto, cobros }  (fechas = de la transferencia)
 *   POST /api/cobranzas/conciliacion  form-data:
 *        items (JSON [{ cxc_id, monto, idempotency_key }] — 1 = simple, N = una transferencia
 *        a varias facturas del mismo cliente, todo o nada), fecha, banco_id?, banco_origen,
 *        titular, numero_operacion, file? (JPG/PNG/WebP/PDF ≤ 8 MB), requiere_comprobante?=1
 *        → { cobros, numero_operacion, referencia_generada }. NO baja la deuda: queda
 *        pendiente y se avisa a los admins. Banco + N° de operación repetido en la misma
 *        factura → 409.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, fail, ERR } from "@/lib/api/responses";
import {
  borrarComprobanteCobro, pathComprobanteCobro, subirComprobanteCobro, validarComprobanteCobro,
} from "@/lib/cobranzas/storage";
import { falloRpc } from "@/modules/cobranzas/server";
import { type ListaConciliacion } from "@/modules/cobranzas/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ESTADOS = new Set(["pendiente", "aprobado", "rechazado", "anulado"]);
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  const estado = sp.get("estado") ?? "";
  const desde = sp.get("desde") ?? "";
  const hasta = sp.get("hasta") ?? "";
  const { data, error } = await ctx.db.rpc<ListaConciliacion>("listar_cobros_pendientes", {
    p_estado: ESTADOS.has(estado) ? estado : null,
    p_desde: FECHA.test(desde) ? desde : null,
    p_hasta: FECHA.test(hasta) ? hasta : null,
    p_q: sp.get("q")?.trim().slice(0, 120) || null,
    p_limit: 1000,
  });
  if (error || !data) {
    console.error("[conciliacion]", error?.message);
    return ERR.server();
  }
  return ok(data);
});

const itemsSchema = z
  .array(z.object({
    cxc_id: z.string().uuid("Factura inválida"),
    monto: z.coerce.number().positive("El monto tiene que ser mayor a cero"),
    idempotency_key: z.string().uuid().nullish(),
  }))
  .min(1, "Elegí la factura")
  .max(50, "Máximo 50 facturas por transferencia");

const camposSchema = z.object({
  fecha: z.string().regex(FECHA, "Fecha inválida"),
  banco_id: z.string().uuid().nullish(),
  banco_origen: z.string().trim().min(1, "Falta el banco de origen").max(80),
  titular: z.string().trim().min(1, "Falta el titular").max(120),
  numero_operacion: z.string().trim().max(80).default(""),
});

type Resultado = { cobros: { id: string; repetido: boolean }[]; numero_operacion: string; referencia_generada: boolean };

export const POST = withTenant(
  async (ctx, req) => {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return fail("Form-data inválido (¿el archivo supera los 8 MB?).", 400);
    }
    const texto = (k: string) => {
      const v = form.get(k);
      return typeof v === "string" ? v : undefined;
    };
    let itemsCrudos: unknown;
    try {
      itemsCrudos = JSON.parse(texto("items") ?? "[]");
    } catch {
      return ERR.invalid("Facturas inválidas");
    }
    const items = itemsSchema.safeParse(itemsCrudos);
    if (!items.success) return ERR.invalid(items.error.issues.map((i) => i.message).join("; "));
    const campos = camposSchema.safeParse({
      fecha: texto("fecha"),
      banco_id: texto("banco_id") || null,
      banco_origen: texto("banco_origen"),
      titular: texto("titular"),
      numero_operacion: texto("numero_operacion") ?? "",
    });
    if (!campos.success) return ERR.invalid(campos.error.issues.map((i) => i.message).join("; "));

    const f = form.get("file");
    const hayArchivo = f instanceof File && f.size > 0;
    if (!hayArchivo && texto("requiere_comprobante") === "1") return fail("Adjuntá el comprobante de la transferencia.", 400);

    // Ids armados acá: el comprobante va a {empresa}/{cobro}/ (o {empresa}/{grupo}/ si es múltiple).
    const conIds = items.data.map((it) => ({ ...it, id: crypto.randomUUID() }));
    const grupoId = conIds.length > 1 ? crypto.randomUUID() : null;
    let path: string | null = null;
    let mime: string | null = null;
    if (hayArchivo) {
      const v = await validarComprobanteCobro(f as File);
      if ("error" in v) return fail(v.error, 400);
      path = pathComprobanteCobro(ctx.empresaId, grupoId ?? conIds[0].id, v.mime);
      mime = v.mime;
      const up = await subirComprobanteCobro(path, v.datos, v.mime);
      if (up.error) {
        console.error("[conciliacion upload]", up.error);
        return fail("No se pudo subir el comprobante. Probá de nuevo.", 502);
      }
    }

    const { data, error } = await ctx.db.rpc<Resultado>("registrar_transferencia", {
      p: { ...campos.data, items: conIds, grupo_id: grupoId, comprobante_path: path, comprobante_mime: mime },
    });
    if (error || !data) {
      if (path) await borrarComprobanteCobro(path); // que no quede un archivo huérfano
      return error ? falloRpc(error) : ERR.server();
    }
    // Reintento del mismo pedido (idempotency_key): la transferencia ya existía con su archivo.
    if (path && data.cobros.every((c) => c.repetido)) await borrarComprobanteCobro(path);
    return created(data);
  },
  { permiso: "registrar_transferencias" },
);
