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
import { TablaTarjetas } from "@/components/TablaResponsive";
import { Descargas, EncabezadoReporte, EstadoCarga, FilaKpis, FiltrosReporte, Kpi, SANGRIA_TARJETAS, Tarjeta, TD_REPORTE, TH_REPORTE, useFiltrosReporte, useReporte, type Atajo } from "@/modules/reportes/ui";
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
          <FilaKpis n={4}>
            <Kpi acento label="Compras de mercadería" valor={gs(total)} hint={`${num(d.totales.compras_cant)} compras a ${num(d.totales.proveedores_con_compras)} proveedores`} />
            <Kpi label="Proveedor principal" valor={top[0]?.nombre ?? "—"} hint={top[0] ? `${pct(Number(top[0].compras), total, 0)} de lo comprado · ${gs(top[0].compras)}` : "Sin compras en el período"}
              onClick={top[0] ? () => ir(top[0].id) : undefined} />
            <Kpi label="Gastos operativos" valor={gs(d.totales.gastos)} hint="servicios y otros con proveedor" />
            <Kpi label="Deuda con proveedores" valor={gs(d.totales.deuda_gs)} tono={Number(d.totales.vencido_gs) > 0 ? "alerta" : undefined}
              hint={`Vencido ${gs(d.totales.vencido_gs)}${Number(d.totales.deuda_usd) ? ` · USD ${num(d.totales.deuda_usd, 2)}` : ""}`} href="/reportes/cuentas-pagar" />
          </FilaKpis>

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
              <div className="flex flex-wrap items-center gap-2 max-sm:flex-col-reverse max-sm:items-stretch">
                <label className="inline-flex items-center gap-1.5 text-xs text-slate-500 max-sm:min-h-11 max-sm:gap-2.5 max-sm:text-sm">
                  <input type="checkbox" checked={soloConCompras} onChange={(e) => setSoloConCompras(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 max-sm:h-5 max-sm:w-5" />
                  Solo con movimiento
                </label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar proveedor o RUC" type="search" enterKeyHint="search"
                    className="h-9 w-56 rounded-xl border border-slate-200 pl-8 pr-3 text-sm outline-none focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)] max-sm:h-11 max-sm:w-full" />
                </div>
              </div>
            }>
            {/* Celular: una tarjeta por proveedor (se busca y se abre la ficha); tablet y escritorio: la tabla. */}
            <div className={SANGRIA_TARJETAS}>
              <TablaTarjetas filas={filas} claveFila={(p) => p.id} onFila={(p) => ir(p.id)} minAncho={900}
                claseThead="bg-slate-50" thBase={TH_REPORTE} tdBase={TD_REPORTE}
                vacio={<p className="py-8 text-center text-sm text-slate-400">No hay proveedores con estos filtros.</p>}
                columnas={[
                  { key: "n", titulo: "Proveedor", movil: "titulo", celda: (p) => <span className="block max-w-[260px] truncate font-medium text-slate-800">{p.nombre}{p.ruc ? <span className="block text-[11px] font-normal text-slate-400">RUC {p.ruc}</span> : null}</span>,
                    celdaMovil: (p) => p.nombre },
                  { key: "ruc", titulo: "RUC", movil: "subtitulo", claseTh: "hidden", claseTd: "hidden", celda: (p) => (p.ruc ? `RUC ${p.ruc}` : null) },
                  { key: "c", titulo: "Compras", movil: "valor", claseTh: "text-right", claseTd: "text-right tabular-nums",
                    celda: (p) => (Number(p.compras) ? <b className="text-slate-900">{gs(p.compras)}</b> : <span className="text-slate-300">—</span>) },
                  { key: "cant", titulo: "Cant.", movil: "dato", etiquetaMovil: "Compras", claseTh: "text-right", claseTd: "text-right tabular-nums text-slate-600", celda: (p) => num(p.compras_cant) },
                  { key: "pct", titulo: "% del total", movil: "dato", claseTh: "text-right", claseTd: "text-right tabular-nums text-slate-600", celda: (p) => (Number(p.compras) ? pct(Number(p.compras), total) : "—") },
                  { key: "u", titulo: "Última compra", movil: "dato", claseTd: "text-slate-600", celda: (p) => (p.ultima_compra ? fechaCorta(p.ultima_compra) : <span className="text-slate-300">nunca</span>) },
                  { key: "g", titulo: "Gastos oper.", claseTh: "text-right", claseTd: "text-right tabular-nums text-slate-600", celda: (p) => (Number(p.gastos) ? gs(p.gastos) : "—") },
                  { key: "d", titulo: "Deuda", movil: "dato", claseTh: "text-right", claseTd: "text-right tabular-nums text-slate-600", celda: (p) => (Number(p.deuda_gs) ? gs(p.deuda_gs) : "—") },
                  { key: "v", titulo: "Vencido", movil: "chip", claseTh: "text-right", claseTd: "text-right tabular-nums text-slate-600",
                    celda: (p) => (Number(p.vencido_gs) ? <span className="font-semibold text-rose-600">{gs(p.vencido_gs)}</span> : "—"),
                    celdaMovil: (p) => (Number(p.vencido_gs) ? <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-600">Vencido {gs(p.vencido_gs)}</span> : null) },
                  { key: "p", titulo: "Productos", claseTh: "text-right", claseTd: "text-right tabular-nums text-slate-600", celda: (p) => num(p.productos) },
                  { key: "ir", titulo: "", movil: "oculto", claseTd: "w-8", celda: () => <ChevronRight className="ml-auto h-4 w-4 text-slate-300" /> },
                ]} />
            </div>
          </Tarjeta>
        </>
      )}
    </div>
  );
}
