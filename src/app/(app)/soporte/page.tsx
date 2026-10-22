"use client";

/**
 * /soporte — Dashboard de Soporte: la vista ejecutiva y la puerta del módulo.
 * Cada KPI es un atajo al listado ya filtrado. Técnicos y QA (no admin) no lo ven:
 * van directo a "Mis tickets".
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  AlarmClock,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Code2,
  FlaskConical,
  Headphones,
  Inbox,
  ListChecks,
  Lock,
  MessageSquareWarning,
  PieChart,
  Plus,
  Ticket,
  Trophy,
  UserRound,
  UserRoundCheck,
  type LucideIcon,
} from "lucide-react";
import { hoyPy, numeroTicket } from "@/modules/soporte/dominio";
import { apiSoporte } from "@/modules/soporte/api";
import { Dona, GraficoBarras } from "@/modules/soporte/Graficos";
import { Aviso, Desplegable, Encabezado, Esqueleto, IconoTile, PALETA_TIPOS, Pagina, TONOS, Tarjeta, TarjetaViva, Vacio, claseBoton, type Tono } from "@/modules/soporte/ui";
import { TablaScroll } from "@/components/TablaResponsive";
import { SelectorFecha } from "@/components/SelectorFecha";

type Item = { id: string; numero: number | null; cliente: string; tipo: string };
type Dashboard = {
  dias: number;
  kpis: Record<string, number>;
  variacion: Record<string, number | null>;
  por_estado: { codigo: string; nombre: string; color: string; cantidad: number }[];
  por_tipo: { nombre: string; cantidad: number }[];
  top_clientes: { cliente: string; tickets: number; items: Item[] }[];
  por_responsable: { responsable: string; tickets: number; items: Item[] }[];
};
type PorHora = { total: number; horas: { hora: number; total: number }[] };

const KPIS: { clave: string; etiqueta: string; icono: LucideIcon; tono: Tono; malo?: boolean; href: string; qa?: boolean }[] = [
  { clave: "total", etiqueta: "Total de tickets", icono: Ticket, tono: "turquesa", href: "/soporte/tickets" },
  { clave: "pendientes", etiqueta: "Pendientes", icono: Inbox, tono: "azul", href: "/soporte/tickets?pestana=pendientes" },
  { clave: "en_proceso", etiqueta: "En proceso", icono: Code2, tono: "celeste", href: "/soporte/tickets?pestana=en_proceso" },
  { clave: "falta_informacion", etiqueta: "Falta información", icono: MessageSquareWarning, tono: "ambar", malo: true, href: "/soporte/tickets?pestana=falta_informacion" },
  { clave: "en_revision", etiqueta: "En revisión", icono: FlaskConical, tono: "violeta", href: "/soporte/tickets?pestana=revision", qa: true },
  { clave: "resueltos", etiqueta: "Resueltos", icono: CheckCircle2, tono: "verde", href: "/soporte/tickets?pestana=resueltos" },
  { clave: "cerrados", etiqueta: "Cerrados / cancelados", icono: Lock, tono: "pizarra", href: "/soporte/tickets?pestana=cerrados" },
  { clave: "sla_vencidos", etiqueta: "SLA vencidos", icono: AlarmClock, tono: "rosa", malo: true, href: "/soporte/tickets" },
];

const ACCESOS: { titulo: string; detalle: string; href: string; icono: LucideIcon; tono: Tono }[] = [
  { titulo: "Cargar ticket", detalle: "Desde la tipificación del cliente", href: "/clientes/gestion", icono: Plus, tono: "turquesa" },
  { titulo: "Mis tickets", detalle: "Donde tenés la próxima acción", href: "/soporte/mis-tickets", icono: UserRoundCheck, tono: "violeta" },
  { titulo: "Todos los tickets", detalle: "Listado con filtros", href: "/soporte/tickets", icono: ListChecks, tono: "celeste" },
  { titulo: "Reportes", detalle: "SLA, tiempos y devoluciones", href: "/soporte/reportes", icono: BarChart3, tono: "ambar" },
];

const PERIODOS = [
  { value: "mes", label: "Mes actual" },
  { value: "7", label: "Últimos 7 días" },
  { value: "30", label: "Últimos 30 días" },
  { value: "90", label: "Últimos 90 días" },
  { value: "0", label: "Todo el historial" },
];

const recordado = new Map<string, Dashboard>();

function ItemsTickets({ items, conCliente = false }: { items: Item[]; conCliente?: boolean }) {
  const [orden, setOrden] = useState<"numero" | "cliente" | "tipo">("numero");
  const ordenados = useMemo(() => {
    const arr = [...items];
    const porNum = (a: Item, b: Item) => (b.numero ?? 0) - (a.numero ?? 0);
    if (orden === "cliente") arr.sort((a, b) => a.cliente.localeCompare(b.cliente, "es") || porNum(a, b));
    else if (orden === "tipo") arr.sort((a, b) => a.tipo.localeCompare(b.tipo, "es") || porNum(a, b));
    else arr.sort(porNum);
    return arr;
  }, [items, orden]);
  if (!items.length) return <p className="px-4 py-2.5 text-[12px] text-slate-400">Sin tickets.</p>;
  const th = (campo: typeof orden, label: string, extra: string) => (
    <button
      type="button"
      onClick={() => setOrden(campo)}
      className={`${extra} text-[10px] font-semibold uppercase tracking-wide transition ${orden === campo ? "text-[#2F6E71]" : "text-slate-400 hover:text-slate-600"}`}
    >
      {label}
      {orden === campo ? " ↓" : ""}
    </button>
  );
  return (
    <div>
      {conCliente ? (
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-1.5">
          {th("numero", "N°", "w-[52px] shrink-0 text-left")}
          {th("cliente", "Cliente", "min-w-0 flex-1 truncate text-left")}
          {th("tipo", "Tipo", "shrink-0 text-right")}
        </div>
      ) : null}
      <div className="divide-y divide-slate-100">
        {ordenados.map((it) => (
          <Link key={it.id} href={`/soporte/tickets/${it.id}`} className="flex items-center gap-3 px-4 py-2 text-[12px] no-underline transition hover:bg-[#4FAEB2]/5">
            <span className="w-[52px] shrink-0 font-mono font-semibold text-slate-700">{numeroTicket(it.numero)}</span>
            {conCliente ? (
              <span className="min-w-0 flex-1 truncate font-medium text-slate-700" title={it.cliente}>
                {it.cliente}
              </span>
            ) : (
              <span className="min-w-0 flex-1" />
            )}
            <span className="shrink-0 text-right text-slate-500">{it.tipo}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Variacion({ valor, malo }: { valor: number | null | undefined; malo?: boolean }) {
  if (valor == null) return <span className="text-[11px] text-slate-400">sin comparación</span>;
  if (valor === 0) return <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-slate-500">= 0%</span>;
  const bueno = malo ? valor < 0 : valor > 0;
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[10.5px] font-bold tabular-nums ${bueno ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}>
      {valor > 0 ? "▲" : "▼"} {Math.abs(valor)}%
    </span>
  );
}

const toggle = (set: Dispatch<SetStateAction<Set<number>>>, i: number) =>
  set((prev) => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    return next;
  });

export default function SoporteDashboardPage() {
  const router = useRouter();
  const [dias, setDias] = useState("mes");
  const [datos, setDatos] = useState<Dashboard | null>(() => recordado.get("mes") ?? null);
  const [error, setError] = useState<string | null>(null);
  const [qaActivo, setQaActivo] = useState(true);
  const [cliAbierto, setCliAbierto] = useState<Set<number>>(new Set());
  const [respAbierto, setRespAbierto] = useState<Set<number>>(new Set());

  // Técnicos y QA no ven el Dashboard: van directo a sus tickets.
  useEffect(() => {
    let vivo = true;
    apiSoporte<{ dashboard: boolean; qa_activo: boolean }>("/api/soporte/acceso")
      .then((a) => {
        if (!vivo) return;
        setQaActivo(a.qa_activo);
        if (!a.dashboard) router.replace("/soporte/mis-tickets");
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [router]);

  useEffect(() => {
    let vivo = true;
    const guardado = recordado.get(dias);
    if (guardado) setDatos(guardado);
    apiSoporte<Dashboard>(`/api/soporte/dashboard?dias=${dias}`)
      .then((d) => {
        recordado.set(dias, d);
        if (vivo) {
          setDatos(d);
          setError(null);
        }
      })
      .catch((e: Error) => vivo && setError(e.message));
    return () => {
      vivo = false;
    };
  }, [dias]);

  // Card "Tickets por hora del día": rango de fechas propio.
  const [desdeHora, setDesdeHora] = useState(() => `${hoyPy().slice(0, 7)}-01`);
  const [hastaHora, setHastaHora] = useState(() => hoyPy());
  const [porHora, setPorHora] = useState<PorHora | null>(null);
  const [cargandoHoras, setCargandoHoras] = useState(false);
  useEffect(() => {
    let vivo = true;
    setCargandoHoras(true);
    apiSoporte<PorHora>(`/api/soporte/dashboard/por-hora?desde=${desdeHora}&hasta=${hastaHora}`)
      .then((d) => vivo && setPorHora(d))
      .catch(() => vivo && setPorHora(null))
      .finally(() => vivo && setCargandoHoras(false));
    return () => {
      vivo = false;
    };
  }, [desdeHora, hastaHora]);
  const horaPico = porHora?.horas.reduce<{ hora: number; total: number } | null>((best, h) => (h.total > (best?.total ?? 0) ? h : best), null);

  const totalTipos = datos?.por_tipo.reduce((s, t) => s + t.cantidad, 0) ?? 0;
  const totalResp = datos?.por_responsable.reduce((s, t) => s + t.tickets, 0) ?? 0;
  const kpis = KPIS.filter((k) => qaActivo || !k.qa);

  return (
    <Pagina>
      <Encabezado
        volver={{ href: "/soporte/panel", label: "Soporte" }}
        titulo="Soporte"
        subtitulo="Vista general del estado de los tickets"
        icono={Headphones}
        acciones={
          <>
            <div className="w-48">
              <Desplegable value={dias} onChange={setDias} options={PERIODOS} />
            </div>
            <Link href="/clientes/gestion" className={claseBoton("primario")} title="Los tickets se cargan desde la tipificación del cliente">
              <Plus className="h-4 w-4" aria-hidden /> Cargar ticket
            </Link>
          </>
        }
      />

      {error ? (
        <div className="mb-4">
          <Aviso>{error}</Aviso>
        </div>
      ) : null}

      <div className="space-y-5">
        {/* KPIs */}
        <div className={`grid grid-cols-2 gap-3 sm:grid-cols-4 ${kpis.length === 8 ? "xl:grid-cols-8" : "xl:grid-cols-7"}`}>
          {kpis.map((k) => {
            const valor = datos?.kpis[k.clave] ?? 0;
            const alerta = k.clave === "sla_vencidos" && valor > 0;
            return (
              <Link key={k.clave} href={k.href} className="group no-underline">
                <TarjetaViva className={`h-full px-4 py-3.5 ${alerta ? "!border-rose-200 !bg-rose-50/40" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <IconoTile icono={k.icono} tono={k.tono} tam="sm" />
                    {datos ? <Variacion valor={datos.variacion[k.clave]} malo={k.malo} /> : null}
                  </div>
                  <div className={`mt-3 text-[26px] font-bold leading-none tabular-nums ${alerta ? "text-rose-600" : "text-slate-900"}`}>{datos ? valor : <Esqueleto className="h-6 w-10" />}</div>
                  <p className="mt-1.5 text-[12px] font-medium leading-tight text-slate-500 group-hover:text-slate-700">{k.etiqueta}</p>
                  <span className={`absolute inset-x-0 bottom-0 h-0.5 origin-left scale-x-0 transition-transform duration-300 group-hover:scale-x-100 ${TONOS[k.tono].solido}`} aria-hidden />
                </TarjetaViva>
              </Link>
            );
          })}
        </div>

        {/* Accesos rápidos */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {ACCESOS.map((a) => (
            <Link key={a.href} href={a.href} className="no-underline">
              <TarjetaViva className="flex items-center gap-3.5 px-4 py-4">
                <IconoTile icono={a.icono} tono={a.tono} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-800">{a.titulo}</span>
                  <span className="block truncate text-[12.5px] text-slate-500">{a.detalle}</span>
                </span>
              </TarjetaViva>
            </Link>
          ))}
        </div>

        {/* Gráficos */}
        <div className="grid gap-5 lg:grid-cols-5">
          <Tarjeta titulo="Tickets por estado" icono={BarChart3} tono="celeste" className="lg:col-span-3">
            <div className="h-72">
              {!datos ? (
                <Esqueleto className="h-full w-full rounded-xl" />
              ) : datos.kpis.total === 0 ? (
                <Vacio titulo="Sin tickets en el período" icono={Ticket} />
              ) : (
                <GraficoBarras datos={datos.por_estado.map((e) => ({ clave: e.codigo, etiqueta: e.nombre, valor: e.cantidad, color: e.color }))} />
              )}
            </div>
          </Tarjeta>

          <Tarjeta titulo="Por tipo de solicitud" icono={PieChart} tono="violeta" className="lg:col-span-2">
            {!datos ? (
              <Esqueleto className="h-56 w-full rounded-xl" />
            ) : totalTipos === 0 ? (
              <Vacio titulo="Sin tickets en el período" icono={PieChart} tono="violeta" />
            ) : (
              <div className="flex flex-col items-center gap-5 sm:flex-row">
                <Dona datos={datos.por_tipo} total={totalTipos} />
                <ul className="w-full space-y-2.5">
                  {datos.por_tipo.map((t, i) => {
                    const pct = Math.round((t.cantidad / totalTipos) * 100);
                    const color = PALETA_TIPOS[i % PALETA_TIPOS.length];
                    return (
                      <li key={t.nombre}>
                        <div className="flex items-center justify-between gap-3 text-[13px]">
                          <span className="flex min-w-0 items-center gap-2 font-medium text-slate-700">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
                            <span className="truncate">{t.nombre}</span>
                          </span>
                          <span className="font-bold tabular-nums text-slate-800">{t.cantidad}</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </Tarjeta>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* Top clientes */}
          <Tarjeta titulo="Top clientes por tickets" icono={Trophy} tono="ambar" padding="p-0">
            {!datos ? (
              <div className="p-5">
                <Esqueleto className="h-48 w-full rounded-xl" />
              </div>
            ) : datos.top_clientes.length === 0 ? (
              <div className="p-5">
                <Vacio titulo="Sin tickets en el período" icono={Trophy} tono="ambar" />
              </div>
            ) : (
              <TablaScroll primeraFija>
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-100 bg-slate-50/70 text-[10px] uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-5 py-2.5 text-left font-semibold">#</th>
                      <th className="px-3 py-2.5 text-left font-semibold">Cliente</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Tickets</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {datos.top_clientes.map((c, i) => {
                      const abierto = cliAbierto.has(i);
                      return (
                        <Fragment key={`${c.cliente}-${i}`}>
                          <tr onClick={() => toggle(setCliAbierto, i)} className="cursor-pointer hover:bg-amber-50/40">
                            <td className="px-5 py-2.5 text-[12px] font-bold tabular-nums text-slate-400">{i + 1}</td>
                            <td className="max-w-[260px] px-3 py-2.5 font-medium text-slate-800">
                              <span className="flex items-center gap-1.5">
                                <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${abierto ? "rotate-180" : ""}`} aria-hidden />
                                <span className="truncate" title={c.cliente}>
                                  {c.cliente}
                                </span>
                              </span>
                            </td>
                            <td className="px-5 py-2.5 text-right">
                              <span className="font-bold tabular-nums text-slate-800">{c.tickets}</span>
                            </td>
                          </tr>
                          {abierto ? (
                            <tr className="bg-slate-50/50">
                              <td colSpan={3} className="p-0">
                                <ItemsTickets items={c.items} />
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </TablaScroll>
            )}
          </Tarjeta>

          {/* Por responsable */}
          <Tarjeta titulo="Tickets por responsable" icono={UserRound} tono="celeste">
            {!datos ? (
              <Esqueleto className="h-48 w-full rounded-xl" />
            ) : totalResp === 0 ? (
              <Vacio titulo="Sin tickets en el período" icono={UserRound} tono="celeste" />
            ) : (
              <ul className="space-y-3">
                {datos.por_responsable.map((p, i) => {
                  const pct = Math.round((p.tickets / totalResp) * 100);
                  const sin = p.responsable === "Sin responsable";
                  const color = sin ? "#cbd5e1" : PALETA_TIPOS[i % PALETA_TIPOS.length];
                  const abierto = respAbierto.has(i);
                  return (
                    <li key={`${p.responsable}-${i}`}>
                      <button type="button" onClick={() => toggle(setRespAbierto, i)} className="w-full text-left">
                        <div className="flex items-center justify-between gap-3 text-[13px]">
                          <span className="flex min-w-0 items-center gap-1.5 font-medium text-slate-700">
                            <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${abierto ? "rotate-180" : ""}`} aria-hidden />
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
                            <span className={`truncate ${sin ? "text-slate-400" : ""}`} title={p.responsable}>
                              {p.responsable}
                            </span>
                          </span>
                          <span className="shrink-0 tabular-nums text-slate-500">
                            <span className="font-bold text-slate-800">{p.tickets}</span> · {pct}%
                          </span>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                        </div>
                      </button>
                      {abierto ? (
                        <div className="mt-1.5 rounded-xl bg-slate-50/60">
                          <ItemsTickets items={p.items} conCliente />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Tarjeta>
        </div>

        {/* Por hora del día */}
        <Tarjeta
          titulo="Tickets por hora del día"
          icono={BarChart3}
          tono="turquesa"
          accion={
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
                Desde
                <SelectorFecha compacto etiqueta="Desde" value={desdeHora} max={hastaHora} onChange={(v) => v && setDesdeHora(v)} claseBoton="rounded-lg px-2 py-1 text-xs text-slate-700" />
              </div>
              <div className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
                Hasta
                <SelectorFecha compacto etiqueta="Hasta" value={hastaHora} min={desdeHora} max={hoyPy()} onChange={(v) => v && setHastaHora(v)} claseBoton="rounded-lg px-2 py-1 text-xs text-slate-700" />
              </div>
            </div>
          }
        >
          <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-slate-500">
            <span>{porHora ? `${porHora.total} ticket${porHora.total === 1 ? "" : "s"} cargado${porHora.total === 1 ? "" : "s"} en el período` : ""}</span>
            {horaPico && horaPico.total > 0 ? (
              <span>
                Pico:{" "}
                <span className="font-semibold text-slate-700">
                  {String(horaPico.hora).padStart(2, "0")}:00–{String(horaPico.hora).padStart(2, "0")}:59
                </span>{" "}
                ({horaPico.total})
              </span>
            ) : null}
          </div>
          <div className="h-72">
            {cargandoHoras && !porHora ? (
              <Esqueleto className="h-full w-full rounded-xl" />
            ) : !porHora || porHora.total === 0 ? (
              <Vacio titulo="Sin tickets en el período" icono={Ticket} />
            ) : (
              <GraficoBarras
                etiquetaCada={2}
                datos={porHora.horas.map((h) => ({ clave: String(h.hora), etiqueta: String(h.hora).padStart(2, "0"), valor: h.total }))}
                titulo={(d) => `${d.etiqueta}:00 – ${d.etiqueta}:59 · ${d.valor} tickets`}
              />
            )}
          </div>
          <p className="mt-2 text-right text-[11px] text-slate-400">Hora de Paraguay</p>
        </Tarjeta>
      </div>
    </Pagina>
  );
}
