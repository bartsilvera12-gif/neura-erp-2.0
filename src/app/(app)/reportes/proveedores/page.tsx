"use client";

/**
 * /reportes/proveedores — Con qué proveedor más se compra: ranking de compras de mercadería
 * del rango, cantidad de compras, última compra, gastos operativos, deuda y productos
 * asociados. Tocá un proveedor para ver su ficha (productos, historial, evolución, pagos).
 */
import { Suspense, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Search } from "lucide-react";
import { BarrasH, Leyenda, C_MERCADERIA, C_OPERATIVOS } from "@/components/graficos/Graficos";
import { fechaCorta, gs, num, pct } from "@/components/graficos/formato";
import { Descargas, EncabezadoReporte, EstadoCarga, FiltrosReporte, Kpi, Tabla, Tarjeta, useFiltrosReporte, useReporte, type Atajo } from "@/modules/reportes/ui";
import type { Proveedores } from "@/modules/reportes/tipos";

const ATAJOS: Atajo[] = ["mes", "mes_anterior", "3m", "6m", "anio"];

export default function Page() {
  return <Suspense fallback={null}><ReporteProveedores /></Suspense>;
}

function ReporteProveedores() {
  const router = useRouter();
  const filtros = useFiltrosReporte("3m");
  const { data: d, error, cargando } = useReporte<Proveedores>(`/api/reportes/proveedores?${filtros.query}`);
  const [q, setQ] = useState("");
  const [soloConCompras, setSoloConCompras] = useState(true);

  const total = Number(d?.totales.compras ?? 0);
  const filas = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (d?.rows ?? []).filter((p) =>
      (!soloConCompras || Number(p.compras_cant) > 0 || Number(p.gastos) > 0 || Number(p.deuda_gs) > 0) &&
      (!t || `${p.nombre} ${p.nombre_comercial ?? ""} ${p.ruc ?? ""}`.toLowerCase().includes(t)));
  }, [d, q, soloConCompras]);
  const top = (d?.rows ?? []).filter((p) => Number(p.compras) > 0);
  const ir = (id: string) => router.push(`/reportes/proveedores/${id}?${filtros.query}`);

  return (
    <div className="space-y-6 pb-10">
      <EncabezadoReporte kicker="Reportes · Finanzas" titulo="Proveedores"
        subtitulo="Con quién más comprás, cuánto, cada cuánto y cuánto le debés. Tocá un proveedor para ver sus productos e historial.">
        <Descargas excel={`/api/reportes/proveedores/export?${filtros.query}`} deshabilitado={!d} />
      </EncabezadoReporte>

      <FiltrosReporte filtros={filtros} atajos={ATAJOS} sucursales={d?.sucursales} cargando={cargando && !!d} />

      {!d ? <EstadoCarga error={error} /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi acento label="Compras de mercadería" valor={gs(total)} hint={`${num(d.totales.compras_cant)} compras a ${num(d.totales.proveedores_con_compras)} proveedores`} />
            <Kpi label="Proveedor principal" valor={top[0]?.nombre ?? "—"} hint={top[0] ? `${pct(Number(top[0].compras), total, 0)} de lo comprado · ${gs(top[0].compras)}` : "Sin compras en el período"}
              onClick={top[0] ? () => ir(top[0].id) : undefined} />
            <Kpi label="Gastos operativos" valor={gs(d.totales.gastos)} hint="servicios y otros con proveedor" />
            <Kpi label="Deuda con proveedores" valor={gs(d.totales.deuda_gs)} tono={Number(d.totales.vencido_gs) > 0 ? "alerta" : undefined}
              hint={`Vencido ${gs(d.totales.vencido_gs)}${Number(d.totales.deuda_usd) ? ` · USD ${num(d.totales.deuda_usd, 2)}` : ""}`} href="/reportes/cuentas-pagar" />
          </div>

          <Tarjeta titulo="Con quién más se compra" sub="compras de mercadería del período (y gastos operativos con ese proveedor) · tocá uno para ver su ficha"
            extra={<Leyenda items={[{ color: C_MERCADERIA, label: "Mercadería" }, { color: C_OPERATIVOS, label: "Gastos operativos" }]} />}>
            <BarrasH max={10} vacio="No hubo compras en el período"
              filas={(d.rows ?? []).filter((p) => Number(p.compras) + Number(p.gastos) > 0)
                .sort((a, b) => Number(b.compras) + Number(b.gastos) - Number(a.compras) - Number(a.gastos))
                .map((p) => ({
                  key: p.id, label: p.nombre, extra: Number(p.compras) ? pct(Number(p.compras), total, 0) : undefined,
                  partes: [{ valor: Number(p.compras), color: C_MERCADERIA, label: "Mercadería" }, { valor: Number(p.gastos), color: C_OPERATIVOS, label: "Gastos" }],
                  detalle: `${num(p.compras_cant)} compra${Number(p.compras_cant) === 1 ? "" : "s"}${p.ultima_compra ? ` · última ${fechaCorta(p.ultima_compra)}` : ""}`,
                  onClick: () => ir(p.id),
                }))} />
          </Tarjeta>

          <Tarjeta titulo="Listado de proveedores"
            extra={
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                  <input type="checkbox" checked={soloConCompras} onChange={(e) => setSoloConCompras(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300" />
                  Solo con movimiento
                </label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar proveedor o RUC"
                    className="h-9 w-56 rounded-xl border border-slate-200 pl-8 pr-3 text-sm outline-none focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]" />
                </div>
              </div>
            }>
            <Tabla minW={900} onFila={ir} vacio="No hay proveedores con estos filtros."
              cols={["Proveedor", "Compras", "Cant.", "% del total", "Última compra", "Gastos oper.", "Deuda", "Vencido", "Productos", ""]}
              der={[1, 2, 3, 5, 6, 7, 8]}
              filas={filas.map((p) => ({
                key: p.id,
                titulo: "Ver la ficha del proveedor",
                celdas: [
                  <span key="n" className="block max-w-[260px] truncate font-medium">{p.nombre}{p.ruc ? <span className="block text-[11px] font-normal text-slate-400">RUC {p.ruc}</span> : null}</span>,
                  Number(p.compras) ? <b key="c" className="text-slate-900">{gs(p.compras)}</b> : <span key="c" className="text-slate-300">—</span>,
                  num(p.compras_cant),
                  Number(p.compras) ? pct(Number(p.compras), total) : "—",
                  p.ultima_compra ? fechaCorta(p.ultima_compra) : <span key="u" className="text-slate-300">nunca</span>,
                  Number(p.gastos) ? gs(p.gastos) : "—",
                  Number(p.deuda_gs) ? gs(p.deuda_gs) : "—",
                  Number(p.vencido_gs) ? <span key="v" className="font-semibold text-rose-600">{gs(p.vencido_gs)}</span> : "—",
                  num(p.productos),
                  <ChevronRight key="ir" className="ml-auto h-4 w-4 text-slate-300" />,
                ],
              }))} />
          </Tarjeta>
        </>
      )}
    </div>
  );
}
