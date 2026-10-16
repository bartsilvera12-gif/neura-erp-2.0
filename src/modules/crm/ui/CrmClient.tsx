"use client";

/**
 * /crm — CRM Funnel (portado del sistema actual, re-pensado para que vuele):
 *   · encabezado + KPIs (leads hoy, del mes, valor en negociación, ganados del mes,
 *     acciones vencidas) que calcula la base en la MISMA consulta del tablero
 *   · buscador (teléfono normalizado o texto, en el servidor, con espera de 250 ms),
 *     filtro "solo hoy" y responsable (ADMIN ve todo; el resto arranca en "solo míos")
 *   · Kanban por etapa: cada columna trae su cantidad, su total y las primeras 25 tarjetas;
 *     "Cargar más" por columna con cursor. Drag & drop nativo y OPTIMISTA: la tarjeta se
 *     mueve al instante, se ajustan cantidades/totales/KPIs localmente y si la base falla
 *     se revierte con un aviso. Nunca se recarga el tablero entero por un movimiento.
 *   · vista Lista (tabla paginada en el servidor), la vista elegida se recuerda
 *   · "Nuevo prospecto", detalle en modal (notas solo al abrirlo), "Transformar a cliente"
 *     y, para ADMIN, "Configurar etapas".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlarmClock, CalendarDays, Coins, LayoutGrid, List, Plus, Search, Settings2, Trophy, Users } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { invalidar } from "@/lib/api/cache-cliente";
import { Select } from "@/components/Select";
import { AccionesPagina, BarraFiltros, EncabezadoPagina } from "@/components/EncabezadoPagina";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import {
  etapaAbierta, filtrosQuery, gsCorto,
  type Columna, type Etapa, type Filtros, type Kpis, type Prospecto, type Tablero, type Tarjeta,
} from "@/modules/crm/tipos";
import { ColumnaKanban, KanbanScroller, type AccionesTarjeta } from "./Kanban";
import { ProspectoLista } from "./Lista";
import { ProspectoDetalle, type MovidoResp } from "./ProspectoDetalle";
import { ProspectoForm } from "./ProspectoForm";
import { ConvertirClienteModal, EtapasModal, MotivoPerdidaModal, type Convertido } from "./Modales";
import { ModalGrande, useAvisos, useUsuarios } from "./comun";

const VISTA_KEY = "crm:vista";
const POR_COLUMNA = 25;

// ── Operaciones puras sobre el tablero ───────────────────────────────────────
const inicioMesPY = () => {
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Asuncion" });
  return new Date(`${hoy.slice(0, 7)}-01T00:00:00-03:00`).getTime();
};

/**
 * Mueve `t` de la columna `de` a `a` (arriba de todo, o en `indice`), ajustando cantidades,
 * totales y KPIs. Las columnas que no cambian conservan su referencia (no se re-renderizan).
 */
function aplicarMovimiento(tab: Tablero, t: Tarjeta, de: string, a: string, extra: Partial<Tarjeta> = {}, indice = 0): Tablero {
  const eDe = tab.columnas.find((c) => c.codigo === de);
  const eA = tab.columnas.find((c) => c.codigo === a);
  const nueva: Tarjeta = { ...t, ...extra, etapa: a };
  const v = Number(t.valor_estimado) || 0;
  const columnas = tab.columnas.map((c) => {
    if (c.codigo === de && c.codigo !== a) {
      const tenia = c.tarjetas.some((x) => x.id === t.id);
      return { ...c, cantidad: Math.max(0, c.cantidad - 1), total: Math.max(0, c.total - v), tarjetas: tenia ? c.tarjetas.filter((x) => x.id !== t.id) : c.tarjetas };
    }
    if (c.codigo === a && c.codigo !== de) {
      const resto = c.tarjetas.filter((x) => x.id !== t.id);
      const i = Math.min(Math.max(indice, 0), resto.length);
      return { ...c, cantidad: c.cantidad + 1, total: c.total + v, tarjetas: [...resto.slice(0, i), nueva, ...resto.slice(i)] };
    }
    return c;
  });
  const k: Kpis = { ...tab.kpis };
  const abiertaDe = etapaAbierta(eDe);
  const abiertaA = etapaAbierta(eA);
  if (abiertaDe && !abiertaA) {
    k.en_negociacion = Math.max(0, k.en_negociacion - v);
    if (t.accion_vencida) k.acciones_vencidas = Math.max(0, k.acciones_vencidas - 1);
  } else if (!abiertaDe && abiertaA) {
    k.en_negociacion += v;
    if (nueva.accion_vencida) k.acciones_vencidas += 1;
  }
  const mes = inicioMesPY();
  if (eDe?.es_ganado && Date.parse(t.etapa_desde) >= mes) k.ganados_mes = Math.max(0, k.ganados_mes - 1);
  if (eA?.es_ganado && Date.parse(nueva.etapa_desde) >= mes) k.ganados_mes += 1;
  return { columnas, kpis: k };
}

/** Reemplaza los datos de una tarjeta (edición desde el detalle) ajustando el total. */
function actualizarTarjeta(tab: Tablero, nuevo: Tarjeta): Tablero {
  let delta = 0;
  let abierta = false;
  const columnas = tab.columnas.map((c) => {
    const i = c.tarjetas.findIndex((x) => x.id === nuevo.id);
    if (i < 0) return c;
    delta = (Number(nuevo.valor_estimado) || 0) - (Number(c.tarjetas[i].valor_estimado) || 0);
    abierta = etapaAbierta(c);
    const tarjetas = [nuevo, ...c.tarjetas.filter((x) => x.id !== nuevo.id)]; // updated_at nuevo → arriba
    return { ...c, total: Math.max(0, c.total + delta), tarjetas };
  });
  return { columnas, kpis: abierta && delta ? { ...tab.kpis, en_negociacion: Math.max(0, tab.kpis.en_negociacion + delta) } : tab.kpis };
}

const aTarjeta = (p: Prospecto): Tarjeta => ({
  id: p.id, numero_control: p.numero_control, empresa: p.empresa, contacto: p.contacto, telefono: p.telefono, email: p.email,
  servicio: p.servicio, valor_estimado: Number(p.valor_estimado) || 0, etapa: p.etapa, proxima_accion: p.proxima_accion,
  fecha_proxima_accion: p.fecha_proxima_accion, origen_creacion: p.origen_creacion, responsable_usuario_id: p.responsable_usuario_id,
  responsable_nombre: p.responsable_nombre, cliente_id: p.cliente_id, updated_at: p.updated_at, created_at: p.created_at,
  etapa_desde: p.etapa_desde, accion_vencida: p.accion_vencida,
});

// ── KPI (MetricCard del sistema actual) ──────────────────────────────────────
function MetricCard({ label, value, sub, icon, accent = "neutral", onClick, active = false }: {
  label: string; value: string | number; sub?: string; icon: React.ReactNode;
  accent?: "neutral" | "featured" | "warning" | "success"; onClick?: () => void; active?: boolean;
}) {
  const chip =
    accent === "featured" ? "border-[var(--brand)]/30 bg-[var(--brand)]/[0.12] text-[var(--brand)]"
    : accent === "warning" ? "border-amber-200 bg-amber-50 text-amber-600"
    : accent === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-600"
    : "border-slate-200 bg-slate-50 text-slate-500";
  const card =
    accent === "featured"
      ? "relative overflow-hidden rounded-2xl border border-[var(--brand)]/55 bg-gradient-to-br from-white via-white to-[var(--brand)]/[0.08] p-4 shadow-[0_4px_18px_rgba(63,142,145,0.08)] transition-all duration-200 hover:-translate-y-0.5"
      : "relative overflow-hidden rounded-2xl border border-[var(--brand)]/45 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md";
  const inner = (
    <>
      {accent === "featured" ? <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[var(--brand)] via-[var(--brand)]/70 to-[var(--brand)]/30" /> : null}
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${chip}`}>{icon}</span>
      <p className="mt-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold leading-tight tracking-tight tabular-nums text-slate-900">{value}</p>
      {sub ? <p className="mt-1 text-[11px] text-slate-500">{sub}</p> : null}
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-pressed={active}
        className={`${card} cursor-pointer text-left ${active ? "border-[var(--brand)] ring-2 ring-[var(--brand)]" : "hover:border-[var(--brand)]/70"}`}>
        {inner}
      </button>
    );
  }
  return <div className={card}>{inner}</div>;
}

type PideMotivo = { t: Tarjeta; a: string; resolver: (m: string | null) => void };

export default function CrmClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const me = useUsuario();
  const esAdmin = me?.rol === "ADMIN";
  const usuarios = useUsuarios();
  const { nodo: avisoNodo, avisar } = useAvisos();

  // ── Vista (se recuerda en este navegador) ──
  const [vista, setVista] = useState<"kanban" | "lista">("kanban");
  useEffect(() => {
    try { if (localStorage.getItem(VISTA_KEY) === "lista") setVista("lista"); } catch { /* ignore */ }
  }, []);
  const cambiarVista = (v: "kanban" | "lista") => {
    setVista(v);
    try { localStorage.setItem(VISTA_KEY, v); } catch { /* ignore */ }
  };

  // ── Filtros ──
  const [busqueda, setBusqueda] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setQ(busqueda.trim()), 250);
    return () => clearTimeout(id);
  }, [busqueda]);
  const [hoy, setHoy] = useState(false);
  // "" = todos · "__mios" = solo míos · uuid = ese responsable
  const [responsable, setResponsable] = useState<string | null>(null);
  useEffect(() => {
    if (me && responsable === null) setResponsable(me.rol === "ADMIN" ? "" : "__mios");
  }, [me, responsable]);
  const filtros = useMemo<Filtros>(() => ({
    q,
    hoy,
    mios: responsable === "__mios",
    responsable: responsable && responsable !== "__mios" ? responsable : "",
  }), [q, hoy, responsable]);
  const listo = responsable !== null;

  // ── Tablero ──
  const [tablero, setTablero] = useState<Tablero | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cargandoMas, setCargandoMas] = useState<Record<string, boolean>>({});
  const tabRef = useRef<Tablero | null>(null);
  tabRef.current = tablero;
  const filtrosRef = useRef(filtros);
  filtrosRef.current = filtros;
  const seq = useRef(0);
  const [version, setVersion] = useState(0); // para la Lista

  const cargarTablero = useCallback(async () => {
    const mio = ++seq.current;
    setCargando(true);
    setError(null);
    try {
      const sp = filtrosQuery(filtrosRef.current);
      sp.set("n", String(POR_COLUMNA));
      const t = await apiFetch<Tablero>(`/api/crm/tablero?${sp}`);
      if (mio === seq.current) setTablero(t);
    } catch (e) {
      if (mio === seq.current) setError((e as Error).message);
    } finally {
      if (mio === seq.current) setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (listo) void cargarTablero();
  }, [listo, filtros, cargarTablero]);

  const cargarMas = useCallback(async (codigo: string) => {
    const col = tabRef.current?.columnas.find((c) => c.codigo === codigo);
    const ultimo = col?.tarjetas[col.tarjetas.length - 1];
    if (!col || !ultimo) return;
    const mio = seq.current;
    setCargandoMas((p) => ({ ...p, [codigo]: true }));
    try {
      const sp = filtrosQuery(filtrosRef.current);
      sp.set("etapa", codigo);
      sp.set("cursor_at", ultimo.updated_at);
      sp.set("cursor_id", ultimo.id);
      sp.set("limite", String(POR_COLUMNA));
      const mas = await apiFetch<Tarjeta[]>(`/api/crm/columna?${sp}`);
      if (mio !== seq.current) return;
      setTablero((tab) => tab && {
        ...tab,
        columnas: tab.columnas.map((c) => {
          if (c.codigo !== codigo) return c;
          const ya = new Set(c.tarjetas.map((x) => x.id));
          return { ...c, tarjetas: [...c.tarjetas, ...mas.filter((x) => !ya.has(x.id))] };
        }),
      });
    } catch (e) {
      avisar({ texto: (e as Error).message, tipo: "error" });
    } finally {
      setCargandoMas((p) => ({ ...p, [codigo]: false }));
    }
  }, [avisar]);

  // Metadatos de etapas: estables mientras no cambien nombre/color/orden (las tarjetas memo los usan).
  const etapasKey = tablero?.columnas.map((c) => `${c.codigo}|${c.nombre}|${c.color}|${c.es_ganado}|${c.es_perdido}`).join(";") ?? "";
  const etapas = useMemo<Etapa[]>(
    () => (tablero?.columnas ?? []).map(({ codigo, nombre, color, orden, es_ganado, es_perdido }) => ({ codigo, nombre, color, orden, es_ganado, es_perdido })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [etapasKey],
  );
  const ganado = etapas.find((e) => e.es_ganado)?.codigo ?? null;
  const perdido = etapas.find((e) => e.es_perdido)?.codigo ?? null;

  // ── Parches para la Lista (lo que cambió desde el tablero/detalle) ──
  const [parches, setParches] = useState<Record<string, Partial<Tarjeta>>>({});
  const [eliminados, setEliminados] = useState<Set<string>>(() => new Set());
  const parchar = useCallback((id: string, p: Partial<Tarjeta>) => setParches((prev) => ({ ...prev, [id]: { ...prev[id], ...p } })), []);
  useEffect(() => { setParches({}); setEliminados(new Set()); }, [filtros, version]);

  // ── Mover (optimista) ──
  const [pideMotivo, setPideMotivo] = useState<PideMotivo | null>(null);

  const moverConApi = useCallback(async (t: Tarjeta, a: string) => {
    const de = t.etapa;
    if (!a || de === a) return;
    const eA = tabRef.current?.columnas.find((c) => c.codigo === a);
    let motivo: string | null = null;
    if (eA?.es_perdido) {
      motivo = await new Promise<string | null>((resolver) => setPideMotivo({ t, a, resolver }));
      if (!motivo) return;
    }
    const indice = Math.max(0, tabRef.current?.columnas.find((c) => c.codigo === de)?.tarjetas.findIndex((x) => x.id === t.id) ?? 0);
    const ahora = new Date().toISOString();
    setTablero((tab) => tab && aplicarMovimiento(tab, t, de, a, { updated_at: ahora, etapa_desde: ahora }));
    parchar(t.id, { etapa: a });
    try {
      const r = await apiFetch<MovidoResp>(`/api/crm/${t.id}/mover`, { method: "POST", body: JSON.stringify({ etapa: a, motivo }) });
      if (r?.updated_at) {
        // La hora exacta de la base (sirve de cursor para "Cargar más").
        const exacta = r.updated_at;
        setTablero((tab) => tab && {
          ...tab,
          columnas: tab.columnas.map((c) => (c.codigo === a && c.tarjetas.some((x) => x.id === t.id)
            ? { ...c, tarjetas: c.tarjetas.map((x) => (x.id === t.id ? { ...x, updated_at: exacta, etapa_desde: exacta } : x)) }
            : c)),
        });
        parchar(t.id, { updated_at: exacta, etapa_desde: exacta });
      }
    } catch (e) {
      // Revertir: vuelve a su columna, en su lugar, con sus datos originales.
      setTablero((tab) => {
        if (!tab) return tab;
        const movida = tab.columnas.find((c) => c.codigo === a)?.tarjetas.find((x) => x.id === t.id) ?? { ...t, etapa: a, etapa_desde: ahora };
        const vuelta = aplicarMovimiento(tab, movida, a, de, { updated_at: t.updated_at, etapa_desde: t.etapa_desde }, indice);
        return { ...vuelta, columnas: vuelta.columnas.map((c) => (c.codigo === de ? { ...c, tarjetas: c.tarjetas.map((x) => (x.id === t.id ? t : x)) } : c)) };
      });
      parchar(t.id, { etapa: de, updated_at: t.updated_at, etapa_desde: t.etapa_desde });
      avisar({ texto: `No se pudo mover: ${(e as Error).message}`, tipo: "error" });
    }
  }, [avisar, parchar]);

  // ── Drag & drop ──
  const arrastrando = useRef<Tarjeta | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const onDragSobre = useCallback((codigo: string | null) => setSobre(codigo), []);
  const onSoltar = useCallback((codigo: string) => {
    setSobre(null);
    const t = arrastrando.current;
    arrastrando.current = null;
    if (t) void moverConApi(t, codigo);
  }, [moverConApi]);

  // ── Modales ──
  const [detalleId, setDetalleId] = useState<string | null>(() => searchParams.get("p"));
  const [nuevoOpen, setNuevoOpen] = useState(false);
  const [transformar, setTransformar] = useState<Tarjeta | null>(null);
  const [etapasOpen, setEtapasOpen] = useState(false);

  const acciones = useMemo<AccionesTarjeta>(() => ({
    onAbrir: (id) => setDetalleId(id),
    onMover: (t, a) => void moverConApi(t, a),
    onTransformar: (t) => setTransformar(t),
    onDragStart: (t) => { arrastrando.current = t; },
    onDragEnd: () => { arrastrando.current = null; setSobre(null); },
  }), [moverConApi]);

  // Cambios hechos fuera del tablero (detalle / transformar) → se aplican localmente.
  const alMoverDesdeDetalle = useCallback((antes: Tarjeta, a: string, r: MovidoResp) => {
    if (r.sin_cambios) return;
    const ahora = r.updated_at ?? new Date().toISOString();
    const base = tabRef.current?.columnas.flatMap((c) => c.tarjetas).find((x) => x.id === antes.id) ?? aTarjetaParcial(antes);
    setTablero((tab) => tab && aplicarMovimiento(tab, base, base.etapa, a, { updated_at: ahora, etapa_desde: ahora }));
    parchar(antes.id, { etapa: a, updated_at: ahora, etapa_desde: ahora });
  }, [parchar]);

  const alConvertir = useCallback((antes: Tarjeta, r: Convertido) => {
    const base = tabRef.current?.columnas.flatMap((c) => c.tarjetas).find((x) => x.id === antes.id) ?? aTarjetaParcial(antes);
    const extra: Partial<Tarjeta> = { cliente_id: r.cliente_id, ...(r.updated_at ? { updated_at: r.updated_at } : {}), ...(r.etapa_desde ? { etapa_desde: r.etapa_desde } : {}) };
    const a = r.etapa ?? base.etapa;
    setTablero((tab) => {
      if (!tab) return tab;
      if (a !== base.etapa) return aplicarMovimiento(tab, base, base.etapa, a, extra);
      return { ...tab, columnas: tab.columnas.map((c) => ({ ...c, tarjetas: c.tarjetas.map((x) => (x.id === base.id ? { ...x, ...extra } : x)) })) };
    });
    parchar(antes.id, { ...extra, etapa: a });
    invalidar("/api/clientes");
    avisar({ texto: "Cliente creado y lead marcado como ganado.", link: { href: `/clientes/${r.cliente_id}`, texto: "Ver cliente →" } });
  }, [avisar, parchar]);

  const alGuardar = useCallback((p: Prospecto) => {
    const t = aTarjeta(p);
    setTablero((tab) => tab && actualizarTarjeta(tab, t));
    parchar(p.id, t);
  }, [parchar]);

  const alEliminar = useCallback((id: string) => {
    setDetalleId(null);
    setEliminados((prev) => new Set(prev).add(id));
    avisar({ texto: "Prospecto eliminado." });
    void cargarTablero();
  }, [avisar, cargarTablero]);

  const cerrarDetalle = useCallback(() => {
    setDetalleId(null);
    if (searchParams.get("p")) router.replace("/crm");
  }, [router, searchParams]);

  // ── Derivados ──
  const columnas: Columna[] = tablero?.columnas ?? [];
  const totalOportunidades = columnas.reduce((s, c) => s + c.cantidad, 0);
  const conteos = useMemo(() => Object.fromEntries(columnas.map((c) => [c.codigo, c.cantidad])), [columnas]);
  const k = tablero?.kpis;
  const opcionesResp: [string, string][] = [
    ["", "Todos los responsables"],
    ["__mios", "Solo míos"],
    ...usuarios.filter((u) => u.id !== me?.usuarioId).map((u) => [u.id, u.nombre] as [string, string]),
  ];

  return (
    <div className="flex h-full min-w-0 flex-col gap-4 sm:gap-5">
      {/* Encabezado (en celular: Kanban/Lista + "Nuevo prospecto" a la vista; "Configurar etapas" en ⋯) */}
      <EncabezadoPagina
        kicker="Pipeline"
        titulo="CRM Funnel"
        subtitulo={`Pipeline comercial · ${totalOportunidades.toLocaleString("es-PY")} oportunidades`}
        acciones={
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex shrink-0 items-center gap-0.5 rounded-xl border border-slate-200 bg-slate-100/80 p-0.5" role="group" aria-label="Vista">
              {([["kanban", "Kanban", LayoutGrid], ["lista", "Lista", List]] as const).map(([v, t, I]) => (
                <button key={v} type="button" onClick={() => cambiarVista(v)} aria-pressed={vista === v} aria-label={t}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors max-sm:h-10 max-sm:w-10 max-sm:px-0 ${vista === v ? "bg-white text-[var(--brand-600)] shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                  <I className="h-3.5 w-3.5 max-sm:h-4 max-sm:w-4" /> <span className="max-sm:sr-only">{t}</span>
                </button>
              ))}
            </div>
            <div className="min-w-0 flex-1 sm:flex-none">
              <AccionesPagina
                acciones={[
                  ...(esAdmin ? [{ etiqueta: "Configurar etapas", icono: <Settings2 />, onClick: () => setEtapasOpen(true) }] : []),
                  { etiqueta: "Nuevo prospecto", icono: <Plus />, onClick: () => setNuevoOpen(true), primaria: true },
                ]}
              />
            </div>
          </div>
        }
      />

      {/* Buscador + filtros (en celular "Solo hoy" y responsable van en "Filtros") */}
      <BarraFiltros
        plano
        activos={(hoy ? 1 : 0) + (responsable ? 1 : 0)}
        onLimpiar={() => {
          setHoy(false);
          setResponsable("");
        }}
        busqueda={
          <div className="relative min-w-0 md:min-w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por número, empresa, contacto o nro. de control…"
              enterKeyHint="search"
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-9 text-sm shadow-sm outline-none transition-colors focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20 max-md:h-11"
            />
            {busqueda ? (
              <button type="button" onClick={() => setBusqueda("")} aria-label="Limpiar búsqueda"
                className="absolute right-1.5 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-sm text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600">✕</button>
            ) : null}
          </div>
        }
        extra={
          q ? (
            <span className="shrink-0 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium tabular-nums text-slate-600 max-md:hidden">
              {totalOportunidades.toLocaleString("es-PY")} resultado{totalOportunidades === 1 ? "" : "s"}
            </span>
          ) : null
        }
      >
        <button type="button" onClick={() => setHoy((v) => !v)} aria-pressed={hoy}
          className={`shrink-0 rounded-xl border px-3 py-2.5 text-xs font-semibold transition-colors max-md:min-h-11 max-md:text-sm ${hoy ? "border-[var(--brand)] bg-[var(--brand-50)] text-[var(--brand-700)]" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}>
          Solo hoy
        </button>
        {esAdmin ? (
          <Select value={responsable ?? ""} onChange={setResponsable} minWidth={210} options={opcionesResp} etiqueta="Responsable" />
        ) : (
          <div className="flex items-center gap-0.5 rounded-xl border border-slate-200 bg-slate-100/80 p-0.5">
            {([["__mios", "Solo míos"], ["", "Todos"]] as const).map(([v, t]) => (
              <button key={v} type="button" onClick={() => setResponsable(v)} aria-pressed={responsable === v}
                className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors max-md:min-h-10 max-md:flex-1 max-md:text-sm ${responsable === v ? "bg-white text-[var(--brand-600)] shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                {t}
              </button>
            ))}
          </div>
        )}
      </BarraFiltros>
      {q ? (
        <p className="-mt-3 text-xs tabular-nums text-slate-500 md:hidden">
          {totalOportunidades.toLocaleString("es-PY")} resultado{totalOportunidades === 1 ? "" : "s"}
        </p>
      ) : null}

      {error ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <span>{error}</span>
          <button type="button" onClick={() => void cargarTablero()} className="font-semibold underline">Reintentar</button>
        </div>
      ) : null}

      {/* Pipeline */}
      {vista === "kanban" ? (
        !tablero && cargando ? (
          <div className="flex gap-3 overflow-hidden">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-80 w-64 min-w-64 animate-pulse rounded-2xl border border-slate-200 bg-white/60" />)}
          </div>
        ) : (
          <div className={`transition-opacity ${cargando ? "opacity-60" : ""}`}>
            <KanbanScroller>
              <div className="flex h-full min-w-max items-start gap-3">
                {columnas.map((c) => (
                  <ColumnaKanban
                    key={c.codigo}
                    col={c}
                    etapas={etapas}
                    ganado={ganado}
                    perdido={perdido}
                    resaltada={sobre === c.codigo}
                    cargandoMas={!!cargandoMas[c.codigo]}
                    acciones={acciones}
                    onDragSobre={onDragSobre}
                    onSoltar={onSoltar}
                    onCargarMas={cargarMas}
                  />
                ))}
              </div>
            </KanbanScroller>
          </div>
        )
      ) : listo ? (
        <ProspectoLista
          filtros={filtros}
          etapas={etapas}
          conteos={conteos}
          parches={parches}
          eliminados={eliminados}
          version={version}
          onAbrir={acciones.onAbrir}
          onMover={acciones.onMover}
          onTransformar={acciones.onTransformar}
        />
      ) : null}

      {/* Modales */}
      {nuevoOpen ? (
        <ModalGrande eyebrow="Nuevo" titulo="Crear prospecto" subtitulo="Registrá una nueva oportunidad en el funnel comercial." onClose={() => setNuevoOpen(false)}>
          <ProspectoForm
            modo="nuevo"
            variant="modal"
            etapas={etapas}
            onCancel={() => setNuevoOpen(false)}
            onGuardado={({ tarjeta }) => {
              setNuevoOpen(false);
              avisar({ texto: `Prospecto ${tarjeta?.numero_control ?? ""} creado.` });
              void cargarTablero();
              setVersion((v) => v + 1);
            }}
          />
        </ModalGrande>
      ) : null}

      {detalleId ? (
        <ProspectoDetalle
          id={detalleId}
          variant="modal"
          etapas={etapas.length ? etapas : undefined}
          onClose={cerrarDetalle}
          onMovido={alMoverDesdeDetalle}
          onGuardado={alGuardar}
          onEliminado={alEliminar}
          onConvertido={alConvertir}
        />
      ) : null}

      {transformar ? (
        <ConvertirClienteModal
          prospecto={transformar}
          onClose={() => setTransformar(null)}
          onConvertido={(r) => { const t = transformar; setTransformar(null); alConvertir(t, r); }}
        />
      ) : null}

      {pideMotivo ? (
        <MotivoPerdidaModal
          etapaNombre={etapas.find((e) => e.codigo === pideMotivo.a)?.nombre ?? "Perdido"}
          prospecto={pideMotivo.t.empresa || pideMotivo.t.contacto}
          onCancel={() => { pideMotivo.resolver(null); setPideMotivo(null); }}
          onConfirm={(m) => { pideMotivo.resolver(m); setPideMotivo(null); }}
        />
      ) : null}

      {etapasOpen ? (
        <EtapasModal
          onClose={() => setEtapasOpen(false)}
          onGuardado={() => {
            setEtapasOpen(false);
            invalidar("/api/crm/etapas");
            avisar({ texto: "Etapas guardadas." });
            void cargarTablero();
            setVersion((v) => v + 1);
          }}
        />
      ) : null}

      {avisoNodo}
    </div>
  );
}

/** Una tarjeta que no está cargada en el tablero (p. ej. abierta desde la Lista). */
function aTarjetaParcial(t: Tarjeta): Tarjeta {
  return { ...t, valor_estimado: Number(t.valor_estimado) || 0 };
}
