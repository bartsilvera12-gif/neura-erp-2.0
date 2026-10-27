/**
 * Existencias por depósito en Excel (mismos filtros y búsqueda que la pantalla): una columna
 * por depósito ("Sucursal › Depósito"), Total y Valor (solo con "ver costos"), fila de totales.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { buildXlsx, xlsxHeaders, type Celda } from "@/lib/excel/xlsx";
import { hoyPY } from "@/lib/fecha/paraguay";
import {
  buscarExistencias, describirFiltrosExistencias, filtrosExistencias, reporteExistencias, textoGenerado, totalesExistencias,
} from "@/modules/reportes/server/existencias";

export const GET = withTenant(
  async (ctx, req) => {
    const f = filtrosExistencias(new URL(req.url).searchParams);
    try {
      const r = await reporteExistencias(ctx.db, f);
      const items = buscarExistencias(r.items, f.q);
      const t = totalesExistencias(r, items);
      const costos = r.ver_costos;
      const deps = r.depositos;
      const cols = [
        { header: "Producto", width: 34 }, { header: "SKU", width: 14 }, { header: "Código de barras", width: 18 },
        { header: "Categoría", width: 18 }, { header: "Unidad", width: 9 }, { header: "Mínimo", width: 9 },
        ...deps.flatMap((d) => [
          { header: `${d.sucursal} › ${d.nombre}`, width: 16 },
          ...(costos ? [{ header: `Valor ${d.nombre}`, width: 15 }] : []),
        ]),
        { header: "Total", width: 11 },
        ...(costos ? [{ header: "Valor", width: 16 }] : []),
      ];
      const rows: Celda[][] = items.map((i) => [
        i.nombre, i.sku ?? "", i.codigo_barras ?? "", i.categoria ?? "", i.unidad_medida, Number(i.stock_minimo) || null,
        ...deps.flatMap((d) => [Number(i.c[d.id] ?? 0), ...(costos ? [Number(i.v?.[d.id] ?? 0)] : [])]),
        Number(i.total),
        ...(costos ? [Number(i.valor ?? 0)] : []),
      ]);
      rows.push([
        `TOTAL (${t.productos} productos)`, "", "", "", "", null,
        ...deps.flatMap((d) => [t.porDep[d.id]?.unidades ?? 0, ...(costos ? [t.porDep[d.id]?.valor ?? 0] : [])]),
        t.unidades,
        ...(costos ? [t.valor ?? 0] : []),
      ]);
      rows.push([]);
      rows.push([`Existencias al ${textoGenerado(r.generado)} · ${await describirFiltrosExistencias(ctx.db, r, f)}`]);
      if (costos) rows.push(["Valor = costo de cada compra que queda en stock (capas PEPS y lotes); lo que no tiene compra registrada, al costo promedio."]);
      const xlsx = buildXlsx([{ name: "Existencias", cols, rows }]);
      return new Response(xlsx as unknown as BodyInit, { status: 200, headers: xlsxHeaders(`existencias-${hoyPY()}`) });
    } catch {
      return new Response("No se pudo generar el Excel", { status: 500 });
    }
  },
  { permiso: ["ver_reportes_financieros", "exportar"] },
);
