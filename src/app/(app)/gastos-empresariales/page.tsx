"use client";

/**
 * /gastos-empresariales — Resumen: todo lo que salió de plata en el período (mes actual por
 * defecto), compras de mercadería + gastos operativos, con gráficos: evolución por mes, fijo vs
 * variable, por categoría (con presupuesto), por sucursal y proveedores principales. Filtros de
 * período (atajos o rango) y sucursal en una sola fila. Click en una categoría → la lista de
 * gastos operativos ya filtrada. Datos: gastos_resumen (una sola consulta SQL de agregados).
 */
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CalendarClock, Plus, Target } from "lucide-react";
import { apiFetchSWR, invalidar } from "@/lib/api/cache-cliente";
import { hoyPY } from "@/lib/fecha/paraguay";
import { Select } from "@/components/Select";
import { AccionesPagina, EncabezadoPagina, GrillaKpis } from "@/components/EncabezadoPagina";
import { ScrollHorizontal } from "@/components/ScrollHorizontal";
import { BarrasH, C_FIJO, C_MERCADERIA, C_OPERATIVOS, C_VARIABLE, ColumnasMes, Dona, Leyenda } from "@/components/graficos/Graficos";
import { PresupuestoModal } from "@/modules/gastos/Presupuesto";
import { corto, fechaCorta, gs, nombreMes, type Resumen } from "@/modules/gastos/tipos";

const INPUT = "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition hover:border-slate-300 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";

type Rango = { desde: string; hasta: string };
const ymd = (d: Date) => d.toISOString().slice(0, 10);
function atajo(k: string): Rango {
  const hoy = hoyPY();
  const [y, m] = hoy.split("-").map(Number);
  const ini = (yy: number, mm: number) => ymd(new Date(Date.UTC(yy, mm - 1, 1)));
  const fin = (yy: number, mm: number) => ymd(new Date(Date.UTC(yy, mm, 0)));
  switch (k) {
    case "mes_anterior": return { desde: ini(y, m - 1), hasta: fin(y, m - 1) };
    case "3m": return { desde: ini(y, m - 2), hasta: hoy };
    case "6m": return { desde: ini(y, m - 5), hasta: hoy };
    case "anio": return { desde: `${y}-01-01`, hasta: hoy };
    default: return { desde: ini(y, m), hasta: hoy };
  }
}
const ATAJOS: [string, string][] = [["mes", "Este mes"], ["mes_anterior", "Mes anterior"], ["3m", "Últimos 3 meses"], ["6m", "Últimos 6 meses"], ["anio", "Este año"]];

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ResumenGastos />
    </Suspense>
  );
}

function ResumenGastos() {
  const router = useRouter();
  const [preset, setPreset] = useState("mes");
  const [rango, setRango] = useState<Rango>(() => atajo("mes"));
  const [sucursal, setSucursal] = useState("");
  const [datos, setDatos] = useState<Resumen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [recarga, setRecarga] = useState(0);
  const [presupuesto, setPresupuesto] = useState(false);
  const [rubroAbierto, setRubroAbierto] = useState<string | null>(null);

  const url = useMemo(() => {
    const p = new URLSearchParams({ desde: rango.desde, hasta: rango.hasta });
    if (sucursal) p.set("sucursal", sucursal);
    return `/api/gastos/resumen?${p}`;
  }, [rango, sucursal]);

  useEffect(() => {
    const ctrl = new AbortController();
    setCargando(true);
    apiFetchSWR<Resumen>(url, (d) => { setDatos(d); setError(null); }, { signal: ctrl.signal, fresco: recarga > 0 })
      .catch((e) => setError((e as Error).message))
      .finally(() => { if (!ctrl.signal.aborted) setCargando(false); });
    return () => ctrl.abort();
  }, [url, recarga]);

  const elegirAtajo = (k: string) => { setPreset(k); setRango(atajo(k)); };
  const irAGastos = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ desde: rango.desde, hasta: rango.hasta, ...extra });
    if (sucursal) p.set("sucursal", sucursal);
    router.push(`/gastos-empresariales/operativos?${p}`);
  };

  const t = datos?.totales;
  const ant = datos?.anterior;
  const variacion = t && ant && ant.total > 0 ? ((t.total - ant.total) / ant.total) * 100 : null;
  const pres = datos?.presupuesto;
  const unMes = rango.desde.slice(0, 7) === rango.hasta.slice(0, 7);
  const titulo = unMes ? nombreMes(rango.desde) : `${fechaCorta(rango.desde)} al ${fechaCorta(rango.hasta)}`;

  return (
    <div className="space-y-5 pb-10 sm:space-y-6">
      <EncabezadoPagina
        titulo="Resumen de gastos"
        subtitulo={<>Todo lo que salió de plata: compras de mercadería y gastos operativos de <span className="capitalize">{titulo}</span>.</>}
        acciones={<AccionesPagina acciones={[
          { etiqueta: "Presupuesto", icono: <Target />, onClick: () => setPresupuesto(true) },
          { etiqueta: "Nuevo gasto", icono: <Plus />, href: "/gastos-empresariales/operativos?nuevo=1", primaria: true },
        ]} />} />

      {/* Filtros: atajos (scroll horizontal en celular) + rango + sucursal */}
      <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
        <ScrollHorizontal className="rounded-xl bg-slate-100 p-1 md:overflow-visible" ariaLabel="Período" dependencias={[preset]}>
          {ATAJOS.map(([k, l]) => (
            <button key={k} onClick={() => elegirAtajo(k)} aria-pressed={preset === k} data-activo={preset === k ? "true" : undefined}
              className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition max-md:min-h-11 max-md:text-[13px] ${preset === k ? "bg-white text-[#3F8E91] shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>{l}</button>
          ))}
        </ScrollHorizontal>
        <div className="grid grid-cols-2 gap-2 md:contents">
          <label className="flex min-w-0 flex-col gap-1 text-xs text-slate-500 md:flex-row md:items-center md:gap-1.5">Desde
            <input type="date" value={rango.desde} max={rango.hasta} onChange={(e) => { if (e.target.value) { setPreset(""); setRango((r) => ({ ...r, desde: e.target.value })); } }} className={`${INPUT} min-w-0 max-md:w-full max-sm:min-h-11`} />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs text-slate-500 md:flex-row md:items-center md:gap-1.5">Hasta
            <input type="date" value={rango.hasta} min={rango.desde} onChange={(e) => { if (e.target.value) { setPreset(""); setRango((r) => ({ ...r, hasta: e.target.value })); } }} className={`${INPUT} min-w-0 max-md:w-full max-sm:min-h-11`} />
          </label>
        </div>
        <div className="flex items-center gap-2">
          <Select value={sucursal} onChange={setSucursal} minWidth={190} etiqueta="Sucursal" className="max-md:!min-w-0 max-md:flex-1"
            options={[["", "Todas las sucursales"], ...(datos?.sucursales ?? []).map((s): [string, string] => [s.id, s.nombre])]} />
          {cargando && datos ? <span className="shrink-0 text-xs text-slate-400">Actualizando…</span> : null}
        </div>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}

      {/* KPIs (en celular el total ocupa toda la fila y los otros cuatro van de a dos) */}
      <GrillaKpis columnas={5}>
        <Kpi titulo="Gasto total" valor={t?.total} destacado
          pie={variacion != null ? (
            <span className={`inline-flex items-center gap-0.5 ${variacion > 0 ? "text-rose-600" : "text-emerald-600"}`}>
              {variacion > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
              {Math.abs(Math.round(variacion))} % vs. {fechaCorta(ant!.desde).slice(0, 5)}–{fechaCorta(ant!.hasta).slice(0, 5)}
            </span>
          ) : ant ? <span className="text-slate-400">Sin gastos en el período anterior</span> : null} />
        <Kpi titulo="Compras de mercadería" valor={t?.compras} color={C_MERCADERIA} pie={t ? `${t.docs_compras} ${t.docs_compras === 1 ? "compra" : "compras"}` : null}
          href="/compras" />
        <Kpi titulo="Gastos operativos" valor={t?.operativos} color={C_OPERATIVOS} pie={t ? `${t.docs_gastos} ${t.docs_gastos === 1 ? "gasto" : "gastos"}` : null}
          onClick={() => irAGastos({ estado: "confirmado" })} />
        <Kpi titulo="IVA crédito fiscal" valor={t?.iva_credito} pie={t ? `No deducible: ${corto(t.no_deducible)}` : null}
          onClick={() => irAGastos({ deducible: "0" })} />
        <Kpi titulo="Deuda con proveedores" valor={datos?.deuda.saldo_gs} href="/compras/pagos"
          pie={datos ? (datos.deuda.vencido_gs > 0
            ? <span className="inline-flex items-center gap-1 text-rose-600"><AlertTriangle className="h-3.5 w-3.5" /> Vencido {corto(datos.deuda.vencido_gs)}</span>
            : `${datos.deuda.cuentas} ${datos.deuda.cuentas === 1 ? "cuenta" : "cuentas"} al día`) : null} />
      </GrillaKpis>

      {datos && datos.borradores.cantidad > 0 ? (
        <button onClick={() => irAGastos({ estado: "borrador", desde: "", hasta: "" })}
          className="flex w-full items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-left text-sm text-amber-900 hover:bg-amber-100/70">
          <CalendarClock className="h-4 w-4 shrink-0" />
          <span>Hay <b>{datos.borradores.cantidad}</b> {datos.borradores.cantidad === 1 ? "gasto en borrador" : "gastos en borrador"} por {gs(datos.borradores.total_gs)} esperando confirmación (no cuentan en el resumen).</span>
          <span className="ml-auto shrink-0 text-xs font-semibold text-amber-800 underline-offset-2 hover:underline">Revisar</span>
        </button>
      ) : null}

      {/* Evolución + fijo/variable */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Tarjeta titulo="Evolución por mes" sub="Gasto total de cada mes" className="lg:col-span-2"
          extra={<Leyenda items={[{ color: C_MERCADERIA, label: "Mercadería" }, { color: C_OPERATIVOS, label: "Operativos" }, ...(datos?.por_mes.some((m) => m.presupuesto) ? [{ color: "#334155", label: "Presupuesto", dashed: true }] : [])]} />}>
          {datos ? <ColumnasMes meses={datos.por_mes} onMes={(mes) => {
            const fin = ymd(new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)));
            setPreset(""); setRango({ desde: mes, hasta: fin > hoyPY() ? hoyPY() : fin });
          }} /> : <Esqueleto alto="h-56" />}
        </Tarjeta>
        <Tarjeta titulo="Fijo vs. variable" sub="Fijos: alquiler, sueldos, servicios. La mercadería cuenta como variable.">
          {t ? <Dona centro={corto(t.total)} sub="total" partes={[
            { label: "Fijo", valor: t.fijo, color: C_FIJO },
            { label: "Variable", valor: t.variable, color: C_VARIABLE },
          ]} /> : <Esqueleto alto="h-40" />}
        </Tarjeta>
      </div>

      {/* Categorías + presupuesto */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Tarjeta titulo="Por categoría" sub="Tocá un rubro para ver sus subcategorías; la raya oscura es el presupuesto." className="lg:col-span-2"
          extra={pres && pres.previsto > 0 ? null : (
            <button onClick={() => setPresupuesto(true)} className="-my-2 inline-flex min-h-11 items-center text-xs font-semibold text-[#3F8E91] hover:underline sm:my-0 sm:min-h-0">Cargar presupuesto</button>
          )}>
          {datos ? (
            <div className="space-y-1">
              <BarrasH max={12} filas={datos.por_rubro.map((r) => ({
                key: r.id ?? "merc", label: r.nombre, presupuesto: r.presupuesto,
                partes: [{ valor: Number(r.total), color: r.mercaderia ? C_MERCADERIA : C_OPERATIVOS, label: r.nombre }],
                detalle: r.mercaderia ? "Compras registradas" : `Fijo ${corto(r.fijo)} · variable ${corto(r.variable)}`,
                onClick: r.mercaderia ? () => router.push("/compras") : () => setRubroAbierto((x) => (x === r.id ? null : r.id)),
              }))} />
              {rubroAbierto ? (() => {
                const r = datos.por_rubro.find((x) => x.id === rubroAbierto);
                if (!r) return null;
                return (
                  <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="min-w-0 text-xs font-semibold uppercase tracking-wide text-slate-500">{r.nombre} por subcategoría</p>
                      <button onClick={() => irAGastos({ categoria: r.id!, estado: "confirmado" })} className="-my-2 inline-flex min-h-11 shrink-0 items-center text-xs font-semibold text-[#3F8E91] hover:underline sm:my-0 sm:min-h-0">Ver los gastos</button>
                    </div>
                    <BarrasH filas={r.subcategorias.map((s) => ({
                      key: s.id, label: s.nombre, partes: [{ valor: Number(s.total), color: C_OPERATIVOS, label: s.nombre }],
                      onClick: () => irAGastos({ categoria: s.id, estado: "confirmado" }),
                    }))} />
                  </div>
                );
              })() : null}
            </div>
          ) : <Esqueleto alto="h-64" />}
        </Tarjeta>
        <Tarjeta titulo="Presupuesto" sub="Lo gastado en las categorías con presupuesto">
          {pres ? (pres.previsto > 0 ? (
            <BloquePresupuesto previsto={pres.previsto} gastado={pres.gastado_presupuestado} onEditar={() => setPresupuesto(true)} />
          ) : (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <p className="text-sm text-slate-500">No hay presupuesto para este período.</p>
              <button onClick={() => setPresupuesto(true)} className="rounded-xl bg-[#4FAEB2] px-3.5 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91] max-sm:min-h-11">Cargar presupuesto</button>
            </div>
          )) : <Esqueleto alto="h-32" />}
        </Tarjeta>
      </div>

      {/* Sucursal + proveedores */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Tarjeta titulo="Por sucursal" sub="Cada línea de gasto se imputa a su sucursal; las compras, a la del depósito"
          extra={<Leyenda items={[{ color: C_MERCADERIA, label: "Mercadería" }, { color: C_OPERATIVOS, label: "Operativos" }]} />}>
          {datos ? <BarrasH filas={datos.por_sucursal.map((s) => ({
            key: s.id ?? "sin", label: s.nombre,
            partes: [{ valor: Number(s.compras), color: C_MERCADERIA, label: "Mercadería" }, { valor: Number(s.operativos), color: C_OPERATIVOS, label: "Operativos" }],
            onClick: s.id ? () => setSucursal(s.id!) : undefined,
          }))} /> : <Esqueleto alto="h-32" />}
        </Tarjeta>
        <Tarjeta titulo="Proveedores principales" sub="A quién se le pagó más en el período"
          extra={<Leyenda items={[{ color: C_MERCADERIA, label: "Mercadería" }, { color: C_OPERATIVOS, label: "Operativos" }]} />}>
          {datos ? <BarrasH filas={datos.top_proveedores.map((p) => ({
            key: p.id ?? "sin", label: p.nombre,
            partes: [{ valor: Number(p.compras), color: C_MERCADERIA, label: "Mercadería" }, { valor: Number(p.operativos), color: C_OPERATIVOS, label: "Operativos" }],
            onClick: p.id && Number(p.operativos) > 0 ? () => irAGastos({ proveedor: p.id!, estado: "confirmado" }) : undefined,
          }))} vacio="Sin proveedores en el período" /> : <Esqueleto alto="h-48" />}
        </Tarjeta>
      </div>

      {presupuesto ? (
        <PresupuestoModal periodoInicial={rango.hasta} onClose={() => setPresupuesto(false)}
          onGuardado={() => { invalidar("/api/gastos/resumen"); setRecarga((k) => k + 1); }} />
      ) : null}
    </div>
  );
}

function Kpi({ titulo, valor, pie, color, destacado, href, onClick }: {
  titulo: string; valor: number | null | undefined; pie?: React.ReactNode; color?: string; destacado?: boolean; href?: string; onClick?: () => void;
}) {
  const cuerpo = (
    <>
      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        {color ? <span aria-hidden className="inline-block h-2 w-2 rounded-[2px]" style={{ backgroundColor: color }} /> : null}{titulo}
      </p>
      <p className={`mt-1 font-bold tabular-nums tracking-tight text-slate-900 [overflow-wrap:anywhere] ${destacado ? "text-2xl" : "text-[17px] sm:text-xl"}`}>{valor == null ? "—" : gs(valor)}</p>
      {pie ? <p className="mt-1 text-[11px] text-slate-500">{pie}</p> : null}
    </>
  );
  const cls = `block min-w-0 rounded-2xl border px-3 py-3 text-left transition sm:px-4 ${destacado ? "border-[#4FAEB2]/40 bg-[#4FAEB2]/5 max-sm:col-span-2" : "border-slate-200 bg-white"} ${href || onClick ? "hover:border-[#4FAEB2]/60 hover:shadow-sm active:bg-slate-50" : ""}`;
  if (href) return <Link href={href} className={cls}>{cuerpo}</Link>;
  if (onClick) return <button onClick={onClick} className={cls}>{cuerpo}</button>;
  return <div className={cls}>{cuerpo}</div>;
}

function Tarjeta({ titulo, sub, extra, className = "", children }: { titulo: string; sub?: string; extra?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 ${className}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-800">{titulo}</h2>
          {sub ? <p className="text-[11px] text-slate-400">{sub}</p> : null}
        </div>
        {extra}
      </div>
      {children}
    </section>
  );
}

function BloquePresupuesto({ previsto, gastado, onEditar }: { previsto: number; gastado: number; onEditar: () => void }) {
  const pct = previsto > 0 ? (gastado / previsto) * 100 : 0;
  const excedido = gastado > previsto;
  return (
    <div className="space-y-3">
      <p className="text-3xl font-bold tabular-nums text-slate-900">{Math.round(pct)} %</p>
      <div className="h-3 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${excedido ? "bg-rose-500" : pct > 85 ? "bg-amber-500" : "bg-[#16969b]"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <dl className="space-y-1 text-sm">
        <div className="flex justify-between"><dt className="text-slate-500">Gastado</dt><dd className="font-semibold tabular-nums text-slate-800">{gs(gastado)}</dd></div>
        <div className="flex justify-between"><dt className="text-slate-500">Previsto</dt><dd className="tabular-nums text-slate-700">{gs(previsto)}</dd></div>
        <div className="flex justify-between border-t border-slate-100 pt-1">
          <dt className="text-slate-500">{excedido ? "Excedido" : "Disponible"}</dt>
          <dd className={`font-semibold tabular-nums ${excedido ? "text-rose-600" : "text-emerald-700"}`}>{gs(Math.abs(previsto - gastado))}</dd>
        </div>
      </dl>
      <button onClick={onEditar} className="inline-flex items-center text-xs font-semibold text-[#3F8E91] hover:underline max-sm:min-h-11">Editar presupuesto</button>
    </div>
  );
}

const Esqueleto = ({ alto }: { alto: string }) => <div className={`${alto} animate-pulse rounded-xl bg-slate-100`} />;
