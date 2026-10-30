/**
 * Archivo para importar en Marangatu (RG 90, recetas 100 y 102).
 *   GET /api/reportes/rg90/archivo?mes=AAAA-MM&iva=1&ire=1&irp=0&parte=1 → .zip
 * Adentro: <RUC>_REG_<MMAAAA>_<id>.txt, delimitado por tabulaciones, UTF-8 sin BOM, sin títulos,
 * con las ventas y compras del mes que no tienen problemas (máx. 5.000 por parte).
 */
import { zipSync, strToU8 } from "fflate";
import { withTenant } from "@/lib/api/with-tenant";
import { fail } from "@/lib/api/responses";
import { falloRpc } from "@/modules/inventario/server/rpc";
import { filasParaArchivo, lineaArchivo, MAX_FILAS, nombreArchivo, rangoMes, rucSinDv, type Rg90 } from "@/modules/reportes/rg90";

export const runtime = "nodejs";

export const GET = withTenant(
  async (ctx, req) => {
    const sp = new URL(req.url).searchParams;
    const mes = sp.get("mes");
    const r = rangoMes(mes);
    if (!r || !mes) return fail("Elegí el mes (AAAA-MM)", 400);
    const imp = { iva: sp.get("iva") !== "0", ire: sp.get("ire") !== "0", irp: sp.get("irp") === "1" };
    if (!imp.iva && !imp.ire && !imp.irp) return fail("Elegí al menos un impuesto al que se imputan los comprobantes", 400);
    const parte = Math.max(1, Number(sp.get("parte")) || 1);

    const { data, error } = await ctx.db.rpc<Rg90>("rg90_registro", { p_desde: r.desde, p_hasta: r.hasta });
    if (error) return falloRpc(error);
    if (!data) return fail("No se pudo armar el registro", 500);
    if (!rucSinDv(data.ruc)) return fail("Cargá el RUC de la empresa en Configuración › Datos de la empresa", 400);

    const filas = filasParaArchivo(data, imp);
    const lote = filas.slice((parte - 1) * MAX_FILAS, parte * MAX_FILAS);
    if (!lote.length) return fail("No hay comprobantes listos para el archivo en ese mes", 400);

    const nombre = nombreArchivo(data.ruc!, mes, parte);
    const txt = lote.map((f) => lineaArchivo(f, imp)).join("\r\n") + "\r\n";
    const zip = zipSync({ [`${nombre}.txt`]: strToU8(txt) }, { level: 6 });
    return new Response(Buffer.from(zip), {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${nombre}.zip"`,
        "cache-control": "no-store",
      },
    });
  },
  { permiso: "ver_reportes_financieros" },
);
