/** GET /api/rrhh/liquidaciones/export?mes=YYYY-MM → Excel para el asesor (receta 118). */
import { withTenant } from "@/lib/api/with-tenant";
import { buildXlsx, hoja, xlsxHeaders } from "@/lib/excel/xlsx";
import { hoyPY } from "@/lib/fecha/paraguay";
import { mesValido } from "@/modules/rrhh/esquemas";
import { extractoDelMes } from "@/modules/rrhh/server";

export const GET = withTenant(async (ctx, req) => {
  try {
    const pedido = mesValido.safeParse(new URL(req.url).searchParams.get("mes"));
    const mes = pedido.success ? pedido.data : hoyPY().slice(0, 7);
    const { filas } = await extractoDelMes(ctx, mes);
    const ajustes = filas.flatMap((f) => f.resultado.ajustes.map((a) => ({ nombre: f.nombre, ...a })));
    const xlsx = buildXlsx([
      hoja("Liquidación", filas, [
        { header: "Nombre", value: (f) => f.nombre, width: 30 },
        { header: "CI", value: (f) => f.ci ?? "", width: 12 },
        { header: "Sucursal", value: (f) => f.sucursal ?? "", width: 18 },
        { header: "Área", value: (f) => f.area ?? "", width: 16 },
        { header: "Perfil", value: (f) => f.perfil ?? "", width: 16 },
        { header: "Tipo", value: (f) => (f.resultado.tipo_salario === "jornalero" ? "Jornalero" : "Mensualero"), width: 12 },
        { header: "Salario o jornal", value: (f) => Number(f.resultado.salario), width: 14 },
        { header: "Ingreso", value: (f) => f.fecha_ingreso, width: 12 },
        { header: "Antigüedad", value: (f) => f.antiguedad, width: 18 },
        { header: "Aporta IPS", value: (f) => (f.aporta_ips ? "Sí" : "No"), width: 10 },
        { header: "Días pagados", value: (f) => f.resultado.dias_pagados, width: 10 },
        { header: "Días de ausencia", value: (f) => f.resultado.dias_ausencia, width: 10 },
        { header: "Salario del mes", value: (f) => f.resultado.salario_base, width: 14 },
        { header: "Descuento por ausencias", value: (f) => f.resultado.descuento_ausencias, width: 14 },
        { header: "Comisión", value: (f) => f.resultado.comision, width: 12 },
        { header: "Extras imponibles", value: (f) => f.resultado.extras_imponibles, width: 12 },
        { header: "Imponible", value: (f) => f.resultado.imponible, width: 14 },
        { header: "IPS trabajador 9 %", value: (f) => f.resultado.ips_trabajador, width: 12 },
        { header: "IPS empresa 16,5 %", value: (f) => f.resultado.ips_empresa, width: 12 },
        { header: "Extras no imponibles", value: (f) => f.resultado.extras_no_imponibles, width: 12 },
        { header: "Otros descuentos", value: (f) => f.resultado.otros_descuentos, width: 12 },
        { header: "Neto a cobrar", value: (f) => f.resultado.neto, width: 14 },
        { header: "Aguinaldo acumulado", value: (f) => f.aguinaldo.total, width: 14 },
        { header: "Vacaciones disponibles", value: (f) => f.vacaciones_saldo, width: 12 },
        { header: "Estado", value: (f) => (f.estado === "cerrada" ? "Cerrada" : "Abierta"), width: 10 },
      ]),
      hoja("Extras y descuentos", ajustes, [
        { header: "Nombre", value: (a) => a.nombre, width: 30 },
        { header: "Concepto", value: (a) => a.concepto, width: 30 },
        { header: "Tipo", value: (a) => (a.tipo === "extra" ? "Extra" : "Descuento"), width: 12 },
        { header: "Aporta IPS", value: (a) => (a.tipo === "extra" ? (a.imponible ? "Sí" : "No") : ""), width: 10 },
        { header: "Monto", value: (a) => a.monto, width: 14 },
      ]),
    ]);
    return new Response(xlsx as unknown as BodyInit, { status: 200, headers: xlsxHeaders(`liquidacion-${mes}`) });
  } catch {
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
}, { permiso: ["administrar_rrhh", "exportar"] });
