"use client";

/**
 * /proyectos — tablero de Proyectos (portado del sistema actual, núcleo genérico, re-pensado
 * para que vuele):
 *   · encabezado (sin tarjetas de KPIs)
 *   · filtros: búsqueda en el servidor (250 ms), responsable, cliente, prioridad, archivados
 *     y rango de entrega (acota solo las columnas de Entregado, como el actual)
 *   · Kanban por estado: cada columna trae su cantidad y las primeras 30 tarjetas; "Cargar
 *     más" por columna con cursor. Drag & drop nativo y OPTIMISTA: la tarjeta se mueve al
 *     instante (si el estado pide motivo — pausa o cancelación — primero se pide), se
 *     ajustan cantidades y KPIs localmente y si la base falla se revierte. Nunca se recarga
 *     el tablero entero por un movimiento.
 *   · SLA del estado actual en cada tarjeta, corriendo cada 60 s en el navegador (sin refetch)
 *   · vista Lista (tabla paginada en el servidor), la vista elegida se recuerda
 *   · "Nuevo proyecto", detalle en modal (pestañas cargadas a demanda) y, para ADMIN,
 *     "Configurar estados" (incluye los parámetros de seguimiento: WIP, vence pronto, sin movimiento).
 *   · Pestañas en el encabezado (sin ítems nuevos de menú), por URL ?vista=:
 *     Tablero (Kanban / Lista) · equipo = Tareas del equipo · ejecutivo = Dashboard Ejecutivo
 *     (ADMIN) · pm = Dashboard PM (ADMIN o PM de algún proyecto). Desde cualquiera, un
 *     proyecto se abre en el mismo detalle.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Archive, BarChart3, ClipboardCheck, LayoutGrid, List, Plus, Search, Settings2, Users, X } from "lucide-react";
import { Select } from "@/components/Select";
import { AccionesPagina, BarraFiltros, EncabezadoPagina } from "@/components/EncabezadoPagina";
import { ScrollHorizontal } from "@/components/ScrollHorizontal";
import { useEsTactil } from "@/lib/ui/responsive";
import { apiFetch } from "@/lib/api/client-fetch";
import { invalidar } from "@/lib/api/cache-cliente";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import { KanbanScroller } from "@/modules/crm/ui/Kanban";
import { ClienteSelect, type ClienteOpcion } from "@/modules/agenda/ui/components/ClienteSelect";
import {
  CONFIG_DEFECTO, HORARIO_DEFECTO, PRIORIDADES, PRIORIDAD_LABEL, filtrosQuery, inicioMesPY, pideMotivo,
  type Columna, type Estado, type Filtros, type Kpis, type Proyecto, type ProyectoConfig, type Tablero, type Tarjeta,
} from "@/modules/proyectos/tipos";
import { TareasEquipo } from "./TareasEquipo";
import { DashboardEjecutivo } from "./DashboardEjecutivo";
import { DashboardPm } from "./DashboardPm";
import { ColumnaKanban, type AccionesTarjeta } from "./Kanban";
import { ProyectosLista } from "./Lista";
import { ProyectoDetalle, type MovidoResp } from "./ProyectoDetalle";
import { ProyectoForm } from "./ProyectoForm";
import { EstadosModal } from "./EstadosModal";
import { ModalProyecto, MotivoModal, useAvisos, useUsuarios } from "./comun";
import { SelectorFecha } from "@/components/SelectorFecha";

const VISTA_KEY = "proyectos:vista";
const POR_COLUMNA = 30;
const DIA_MS = 86_400_000;

// ── Operaciones puras sobre el tablero ───────────────────────────────────────
const KPI_CERO: Kpis = { activos: 0, vencidos: 0, vencen_3_dias: 0, sin_fecha: 0, bloqueados: 0, sin_movimiento: 0, urgentes: 0, entregados_mes: 0 };

/** Lo que una tarjeta en una columna suma a cada KPI (misma regla que proyectos_tablero). */
function aporte(t: Tarjeta, col: Pick<Columna, "es_final" | "rol"> | undefined): Kpis {
  const k = { ...KPI_CERO };
  if (!col) return k;
  const ahora = Date.now();
  if (!col.es_final) {
    k.activos = 1;
    const fp = t.fecha_prometida ? Date.parse(t.fecha_prometida) : null;
    if (fp == null) k.sin_fecha = 1;
    else if (fp < ahora) k.vencidos = 1;
    else if (fp < ahora + 3 * DIA_MS) k.vencen_3_dias = 1;
    if (t.bloqueado) k.bloqueados = 1;
    if (Date.parse(t.ultimo_movimiento_at) < ahora - 3 * DIA_MS) k.sin_movimiento = 1;
    if (t.prioridad === "urgente") k.urgentes = 1;
  }
  if (col.rol === "entregado" && t.fecha_entrega && Date.parse(t.fecha_entrega) >= inicioMesPY()) k.entregados_mes = 1;
  return k;
}

function sumarKpis(k: Kpis, mas: Kpis, menos: Kpis): Kpis {
  const r = { ...k };
  for (const key of Object.keys(KPI_CERO) as (keyof Kpis)[]) r[key] = Math.max(0, k[key] + mas[key] - menos[key]);
  return r;
}

/** Cómo queda la tarjeta al pasar de `de` a `a` (lo mismo que hace proyecto_cambiar_estado). */
function tarjetaMovida(t: Tarjeta, de: Columna | undefined, a: Columna | undefined, ahora: string, motivo: string | null): Partial<Tarjeta> {
  return {
    estado_id: a?.id ?? t.estado_id,
    estado_desde: ahora,
    ultimo_movimiento_at: ahora,
    fecha_entrega: a?.rol === "entregado" ? (t.fecha_entrega ?? ahora) : de?.rol === "entregado" ? null : t.fecha_entrega,
    bloqueado: de?.tipo_sla === "pausado" ? false : t.bloqueado,
    pausa_motivo: a?.tipo_sla === "pausado" ? motivo : t.pausa_motivo,
    ...(a?.rol === "cancelado" ? { cancelacion_motivo: motivo } : {}),
  };
}

/**
 * Mueve `t` de la columna `de` a `a` (arriba de todo, o en `indice`), ajustando cantidades
 * y KPIs. Las columnas que no cambian conservan su referencia (no se re-renderizan).
 */
function aplicarMovimiento(tab: Tablero, t: Tarjeta, de: string, a: string, extra: Partial<Tarjeta>, indice = 0): Tablero {
  const cDe = tab.columnas.find((c) => c.id === de);
  const cA = tab.columnas.find((c) => c.id === a);
  const nueva: Tarjeta = { ...t, ...extra, estado_id: a };
  const columnas = tab.columnas.map((c) => {
    if (c.id === de && c.id !== a) {
      const tenia = c.tarjetas.some((x) => x.id === t.id);
      return { ...c, cantidad: Math.max(0, c.cantidad - 1), tarjetas: tenia ? c.tarjetas.filter((x) => x.id !== t.id) : c.tarjetas };
    }
    if (c.id === a && c.id !== de) {
      const resto = c.tarjetas.filter((x) => x.id !== t.id);
      const i = Math.min(Math.max(indice, 0), resto.length);
      return { ...c, cantidad: c.cantidad + 1, tarjetas: [...resto.slice(0, i), nueva, ...resto.slice(i)] };
    }
    return c;
  });
  return { ...tab, columnas, kpis: sumarKpis(tab.kpis, aporte(nueva, cA), aporte(t, cDe)) };
}

/** Reemplaza los datos de una tarjeta (edición desde el detalle) ajustando los KPIs. */
function actualizarTarjeta(tab: Tablero, nueva: Tarjeta): Tablero {
  let antes: Tarjeta | null = null;
  let col: Columna | undefined;
  const columnas = tab.columnas.map((c) => {
    const i = c.tarjetas.findIndex((x) => x.id === nueva.id);
    if (i < 0) return c;
    antes = c.tarjetas[i];
    col = c;
    return { ...c, tarjetas: [nueva, ...c.tarjetas.filter((x) => x.id !== nueva.id)] }; // último movimiento nuevo → arriba
  });
  if (!antes) return tab;
  return { ...tab, columnas, kpis: sumarKpis(tab.kpis, aporte(nueva, col), aporte(antes, col)) };
}

/** Saca una tarjeta (archivada / eliminada) de su columna. */
function quitarTarjeta(tab: Tablero, t: Tarjeta): Tablero {
  const col = tab.columnas.find((c) => c.id === t.estado_id);
  if (!col) return tab;
  const real = col.tarjetas.find((x) => x.id === t.id) ?? t;
  const columnas = tab.columnas.map((c) => (c.id === col.id ? { ...c, cantidad: Math.max(0, c.cantidad - 1), tarjetas: c.tarjetas.filter((x) => x.id !== t.id) } : c));
  return { ...tab, columnas, kpis: sumarKpis(tab.kpis, KPI_CERO, aporte(real, col)) };
}

/** Agrega una tarjeta nueva arriba de su columna. */
function agregarTarjeta(tab: Tablero, t: Tarjeta): Tablero {
  const col = tab.columnas.find((c) => c.id === t.estado_id);
  if (!col) return tab;
  const columnas = tab.columnas.map((c) => (c.id === col.id ? { ...c, cantidad: c.cantidad + 1, tarjetas: [t, ...c.tarjetas.filter((x) => x.id !== t.id)] } : c));
  return { ...tab, columnas, kpis: sumarKpis(tab.kpis, aporte(t, col), KPI_CERO) };
}

/** Params de una columna: los filtros + (si es de Entregado y hay rango) el rango de entrega. */
function paramsColumna(f: Filtros, col: Columna) {
  const sp = filtrosQuery(f);
  sp.set("estado", col.id);
  if (col.rol === "entregado") {
    if (f.desde) sp.set("desde", f.desde);
    if (f.hasta) sp.set("hasta", f.hasta);
  }
  return sp;
}

const aTarjeta = (p: Proyecto): Tarjeta => ({
  id: p.id, numero: p.numero, titulo: p.titulo, prioridad: p.prioridad, estado_id: p.estado_id, estado_desde: p.estado_desde,
  ultimo_movimiento_at: p.ultimo_movimiento_at, fecha_ingreso: p.fecha_ingreso, fecha_prometida: p.fecha_prometida, fecha_entrega: p.fecha_entrega,
  monto_vendido: Number(p.monto_vendido) || 0, moneda: p.moneda, bloqueado: p.bloqueado, bloqueo_tipo: p.bloqueo_tipo, bloqueo_motivo: p.bloqueo_motivo,
  bloqueo_responsable: p.bloqueo_responsable, bloqueo_proxima_accion: p.bloqueo_proxima_accion, pausa_motivo: p.pausa_motivo,
  cancelacion_motivo: p.cancelacion_motivo, cliente_id: p.cliente_id, cliente_nombre: p.cliente_nombre,
  responsable_comercial_id: p.responsable_comercial_id, comercial_nombre: p.comercial_nombre,
  responsable_tecnico_id: p.responsable_tecnico_id, tecnico_nombre: p.tecnico_nombre,
  project_manager_id: p.project_manager_id, pm_nombre: p.pm_nombre, tareas_total: p.tareas_total, tareas_hechas: p.tareas_hechas,
});

type PideMotivo = { t: Tarjeta; a: Columna; resolver: (m: string | null) => void };

export default function ProyectosClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const me = useUsuario();
  const esAdmin = me?.rol === "ADMIN";
  const yo = me?.usuarioId;
  const tactil = useEsTactil();
  const usuarios = useUsuarios();
  const { nodo: avisoNodo, avisar } = useAvisos();

  // ── Parámetros de seguimiento + ¿soy PM de algo? (habilita el Dashboard PM) ──
  const [config, setConfig] = useState<ProyectoConfig>(CONFIG_DEFECTO);
  const [soyPm, setSoyPm] = useState(false);
  const cargarConfig = useCallback(() => {
    apiFetch<ProyectoConfig & { soy_pm: boolean }>("/api/proyectos/config")
      .then(({ soy_pm, ...c }) => { setConfig(c); setSoyPm(soy_pm); })
      .catch(() => {});
  }, []);
  useEffect(() => { cargarConfig(); }, [cargarConfig]);

  // ── Pantalla (pestañas del encabezado, por URL ?vista=) ──
  const pedida = searchParams.get("vista");
  const pantallas = useMemo(() => [
    { id: "tablero", label: "Tablero", icon: LayoutGrid, ver: true },
    { id: "equipo", label: "Tareas del equipo", icon: Users, ver: true },
    { id: "ejecutivo", label: "Dashboard Ejecutivo", icon: BarChart3, ver: esAdmin },
    { id: "pm", label: "Dashboard PM", icon: ClipboardCheck, ver: esAdmin || soyPm },
  ] as const, [esAdmin, soyPm]);
  type Pantalla = (typeof pantallas)[number]["id"];
  const pantalla: Pantalla = (pantallas.find((p) => p.id === pedida && p.ver)?.id ?? "tablero") as Pantalla;
  /** URL de /proyectos conservando la pestaña (y opcionalmente otra). */
  const urlProyectos = useCallback((vista: string | null) => (vista && vista !== "tablero" ? `/proyectos?vista=${vista}` : "/proyectos"), []);
  const irPantalla = (id: Pantalla) => router.push(urlProyectos(id), { scroll: false });
  /** Sube al cerrar un detalle abierto desde un tablero: que se refresque con lo que cambió. */
  const [dashVersion, setDashVersion] = useState(0);

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
  // null hasta saber quién soy: ADMIN arranca en "todos", el resto en "los míos".
  const [responsable, setResponsable] = useState<string | null>(null);
  useEffect(() => {
    if (me && responsable === null) setResponsable(me.rol === "ADMIN" || !me.usuarioId ? "" : me.usuarioId);
  }, [me, responsable]);
  const [cliente, setCliente] = useState<ClienteOpcion | null>(null);
  const [prioridad, setPrioridad] = useState("");
  const [archivados, setArchivados] = useState(false);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const filtros = useMemo<Filtros>(() => ({
    q, responsable: responsable ?? "", cliente: cliente?.id ?? "", prioridad, archivados, desde, hasta,
  }), [q, responsable, cliente, prioridad, archivados, desde, hasta]);
  const listo = responsable !== null;
  const hayFiltros = !!(busqueda || (responsable && responsable !== (esAdmin ? "" : yo)) || cliente || prioridad || archivados || desde || hasta);

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
    const f = filtrosRef.current;
    setCargando(true);
    setError(null);
    try {
      const sp = filtrosQuery(f);
      sp.set("n", String(POR_COLUMNA));
      let t = await apiFetch<Tablero>(`/api/proyectos/tablero?${sp}`);
      if (f.desde || f.hasta) {
        // El rango de entrega acota solo las columnas de Entregado.
        const entregadas = t.columnas.filter((c) => c.rol === "entregado");
        const rs = await Promise.all(entregadas.map((c) => {
          const p = paramsColumna(f, c);
          p.set("conteo", "1");
          p.set("limite", String(POR_COLUMNA));
          return apiFetch<{ tarjetas: Tarjeta[]; total: number | null }>(`/api/proyectos/columna?${p}`);
        }));
        const porId = new Map(entregadas.map((c, i) => [c.id, rs[i]]));
        t = { ...t, columnas: t.columnas.map((c) => (porId.has(c.id) ? { ...c, tarjetas: porId.get(c.id)!.tarjetas, cantidad: porId.get(c.id)!.total ?? porId.get(c.id)!.tarjetas.length } : c)) };
      }
      if (mio === seq.current) setTablero(t);
    } catch (e) {
      if (mio === seq.current) setError((e as Error).message);
    } finally {
      if (mio === seq.current) setCargando(false);
    }
  }, []);

  // El tablero se pide solo en su pestaña (al volver se refresca; mientras, se ve el anterior).
  const enTableroPantalla = pantalla === "tablero";
  useEffect(() => {
    if (listo && enTableroPantalla) void cargarTablero();
  }, [listo, filtros, cargarTablero, enTableroPantalla]);

  const cargarMas = useCallback(async (colId: string) => {
    const col = tabRef.current?.columnas.find((c) => c.id === colId);
    const ultimo = col?.tarjetas[col.tarjetas.length - 1];
    if (!col || !ultimo) return;
    const mio = seq.current;
    setCargandoMas((p) => ({ ...p, [colId]: true }));
    try {
      const sp = paramsColumna(filtrosRef.current, col);
      sp.set("cursor_at", ultimo.ultimo_movimiento_at);
      sp.set("cursor_id", ultimo.id);
      sp.set("limite", String(POR_COLUMNA));
      const r = await apiFetch<{ tarjetas: Tarjeta[] }>(`/api/proyectos/columna?${sp}`);
      if (mio !== seq.current) return;
      setTablero((tab) => tab && {
        ...tab,
        columnas: tab.columnas.map((c) => {
          if (c.id !== colId) return c;
          const ya = new Set(c.tarjetas.map((x) => x.id));
          return { ...c, tarjetas: [...c.tarjetas, ...r.tarjetas.filter((x) => !ya.has(x.id))] };
        }),
      });
    } catch (e) {
      avisar({ texto: (e as Error).message, tipo: "error" });
    } finally {
      setCargandoMas((p) => ({ ...p, [colId]: false }));
    }
  }, [avisar]);

  // Metadatos de estados: estables mientras no cambien (las tarjetas memo los usan).
  const estadosKey = tablero?.columnas.map((c) => `${c.id}|${c.nombre}|${c.color}|${c.tipo_sla}|${c.sla_horas_objetivo}|${c.rol}|${c.es_final}`).join(";") ?? "";
  const estados = useMemo<Estado[]>(
    () => (tablero?.columnas ?? []).map(({ id, codigo, nombre, color, orden, tipo_sla, sla_horas_objetivo, rol, es_final }) => ({ id, codigo, nombre, color, orden, tipo_sla, sla_horas_objetivo, rol, es_final })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [estadosKey],
  );
  const estadosMap = useMemo(() => new Map(estados.map((e) => [e.id, e])), [estados]);
  const opcionesEstado = useMemo<[string, string][]>(() => estados.map((e) => [e.id, e.nombre]), [estados]);
  const horarioKey = JSON.stringify(tablero?.horario ?? HORARIO_DEFECTO);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const horario = useMemo(() => tablero?.horario ?? HORARIO_DEFECTO, [horarioKey]);

  // ── Parches para la Lista (lo que cambió desde el tablero / detalle) ──
  const [parches, setParches] = useState<Record<string, Partial<Tarjeta>>>({});
  const [quitados, setQuitados] = useState<Set<string>>(() => new Set());
  const parchar = useCallback((id: string, p: Partial<Tarjeta>) => setParches((prev) => ({ ...prev, [id]: { ...prev[id], ...p } })), []);
  useEffect(() => { setParches({}); setQuitados(new Set()); }, [filtros, version]);

  // ── Mover (optimista) ──
  const [pide, setPide] = useState<PideMotivo | null>(null);

  const moverConApi = useCallback(async (t: Tarjeta, a: string) => {
    const de = t.estado_id;
    if (!a || de === a) return;
    const cDe = tabRef.current?.columnas.find((c) => c.id === de);
    const cA = tabRef.current?.columnas.find((c) => c.id === a);
    let motivo: string | null = null;
    if (pideMotivo(cA)) {
      motivo = await new Promise<string | null>((resolver) => setPide({ t, a: cA!, resolver }));
      if (!motivo) return;
    }
    const indice = Math.max(0, cDe?.tarjetas.findIndex((x) => x.id === t.id) ?? 0);
    const ahora = new Date().toISOString();
    const extra = tarjetaMovida(t, cDe, cA, ahora, motivo);
    setTablero((tab) => tab && aplicarMovimiento(tab, t, de, a, extra));
    parchar(t.id, { ...extra, estado_id: a });
    try {
      const r = await apiFetch<MovidoResp>(`/api/proyectos/${t.id}/estado`, { method: "POST", body: JSON.stringify({ estado_id: a, motivo }) });
      if (r?.estado_desde) {
        // La hora exacta de la base (SLA y cursor de "Cargar más").
        const exacta = r.estado_desde;
        setTablero((tab) => tab && {
          ...tab,
          columnas: tab.columnas.map((c) => (c.id === a && c.tarjetas.some((x) => x.id === t.id)
            ? { ...c, tarjetas: c.tarjetas.map((x) => (x.id === t.id ? { ...x, estado_desde: exacta, ultimo_movimiento_at: exacta } : x)) }
            : c)),
        });
        parchar(t.id, { estado_desde: exacta, ultimo_movimiento_at: exacta });
      }
    } catch (e) {
      // Revertir: vuelve a su columna, en su lugar, con sus datos originales.
      setTablero((tab) => {
        if (!tab) return tab;
        const movida = tab.columnas.find((c) => c.id === a)?.tarjetas.find((x) => x.id === t.id) ?? { ...t, ...extra, estado_id: a };
        const vuelta = aplicarMovimiento(tab, movida, a, de, t, indice);
        return { ...vuelta, columnas: vuelta.columnas.map((c) => (c.id === de ? { ...c, tarjetas: c.tarjetas.map((x) => (x.id === t.id ? t : x)) } : c)) };
      });
      parchar(t.id, t);
      avisar({ texto: `No se pudo mover: ${(e as Error).message}`, tipo: "error" });
    }
  }, [avisar, parchar]);

  // ── Drag & drop ──
  const arrastrando = useRef<Tarjeta | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const onDragSobre = useCallback((id: string | null) => setSobre(id), []);
  const onSoltar = useCallback((id: string) => {
    setSobre(null);
    const t = arrastrando.current;
    arrastrando.current = null;
    if (t) void moverConApi(t, id);
  }, [moverConApi]);

  // ── Modales ──
  const [detalleId, setDetalleId] = useState<string | null>(() => searchParams.get("p"));
  const [nuevoOpen, setNuevoOpen] = useState(false);
  const [estadosOpen, setEstadosOpen] = useState(false);

  const acciones = useMemo<AccionesTarjeta>(() => ({
    onAbrir: (id) => setDetalleId(id),
    onMover: (t, a) => void moverConApi(t, a),
    onDragStart: (t) => { arrastrando.current = t; },
    onDragEnd: () => { arrastrando.current = null; setSobre(null); },
  }), [moverConApi]);

  const enTablero = (id: string) => tabRef.current?.columnas.flatMap((c) => c.tarjetas).find((x) => x.id === id) ?? null;

  // Cambios hechos desde el detalle → se aplican localmente.
  const alMoverDesdeDetalle = useCallback((antes: Tarjeta, a: string, r: MovidoResp & { motivo?: string | null }) => {
    if (r.sin_cambios) return;
    const base = enTablero(antes.id) ?? antes;
    const cDe = tabRef.current?.columnas.find((c) => c.id === base.estado_id);
    const cA = tabRef.current?.columnas.find((c) => c.id === a);
    const extra = tarjetaMovida(base, cDe, cA, r.estado_desde ?? new Date().toISOString(), r.motivo ?? null);
    setTablero((tab) => tab && aplicarMovimiento(tab, base, base.estado_id, a, extra));
    parchar(antes.id, { ...extra, estado_id: a });
  }, [parchar]);

  const alGuardar = useCallback((p: Proyecto) => {
    const t = aTarjeta(p);
    if (p.archivado !== filtrosRef.current.archivados) {
      // Se archivó (o desarchivó): sale de esta vista.
      setTablero((tab) => tab && quitarTarjeta(tab, enTablero(p.id) ?? t));
      setQuitados((prev) => new Set(prev).add(p.id));
      return;
    }
    setTablero((tab) => tab && actualizarTarjeta(tab, t));
    parchar(p.id, t);
  }, [parchar]);

  const alEliminar = useCallback((id: string) => {
    const t = enTablero(id);
    setDetalleId(null);
    if (t) setTablero((tab) => tab && quitarTarjeta(tab, t));
    setQuitados((prev) => new Set(prev).add(id));
    avisar({ texto: "Proyecto eliminado." });
    setDashVersion((v) => v + 1);
    if (searchParams.get("p")) router.replace(urlProyectos(searchParams.get("vista")));
  }, [avisar, router, searchParams, urlProyectos]);

  const alCrear = useCallback((t: Tarjeta, avisos: string[]) => {
    setNuevoOpen(false);
    if (!filtrosRef.current.archivados) setTablero((tab) => tab && agregarTarjeta(tab, t));
    setVersion((v) => v + 1);
    avisar(avisos.length ? { texto: avisos.join(" "), tipo: "error" } : { texto: `Proyecto ${t.numero} creado.` });
    setDetalleId(t.id);
  }, [avisar]);

  const cerrarDetalle = useCallback(() => {
    setDetalleId(null);
    if (!enTableroPantalla) setDashVersion((v) => v + 1);
    if (searchParams.get("p")) router.replace(urlProyectos(searchParams.get("vista")));
  }, [router, searchParams, urlProyectos, enTableroPantalla]);

  const limpiar = () => {
    setBusqueda("");
    setResponsable(esAdmin || !yo ? "" : yo);
    setCliente(null);
    setPrioridad("");
    setArchivados(false);
    setDesde("");
    setHasta("");
  };

  // ── Derivados ──
  const columnas: Columna[] = tablero?.columnas ?? [];
  const total = columnas.reduce((s, c) => s + c.cantidad, 0);
  const opcionesResp: [string, string][] = [
    ["", "Todos los responsables"],
    ...(yo ? [[yo, "Solo míos"] as [string, string]] : []),
    ...usuarios.filter((u) => u.id !== yo).map((u) => [u.id, u.nombre] as [string, string]),
  ];
  const preview = detalleId ? enTablero(detalleId) : null;

  const cabecera: Record<Pantalla, { ojo: string; titulo: string; sub: React.ReactNode }> = {
    tablero: { ojo: "Tablero", titulo: "Proyectos", sub: <>{archivados ? "Archivados" : "Seguimiento por estado"} · {total.toLocaleString("es-PY")} proyecto{total === 1 ? "" : "s"}</> },
    equipo: { ojo: "Equipo", titulo: "Tareas del equipo", sub: "Proyectos abiertos por técnico, divididos por estado, con las horas laborales en el estado actual y el SLA." },
    ejecutivo: { ojo: "Directorio", titulo: "Dashboard Ejecutivo", sub: "Cómo está funcionando la cartera: riesgos de hoy, entregas del período, estados, técnicos y PM." },
    pm: { ojo: "Cartera", titulo: "Dashboard PM", sub: "Tus proyectos por situación: qué está vencido, qué vence pronto y qué está trabado." },
  };
  const cab = cabecera[pantalla];

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Encabezado + pestañas (en celular: acción principal a la vista, el resto en ⋯; pestañas con scroll) */}
      <div className="flex flex-col gap-3">
        <EncabezadoPagina
          kicker={cab.ojo}
          titulo={cab.titulo}
          subtitulo={cab.sub}
          acciones={
            <div className="flex min-w-0 items-center gap-2">
              {pantalla === "tablero" ? (
                <div className="flex shrink-0 items-center gap-0.5 rounded-xl border border-slate-200 bg-slate-100/80 p-0.5" role="group" aria-label="Vista">
                  {([["kanban", "Kanban", LayoutGrid], ["lista", "Lista", List]] as const).map(([v, t, I]) => (
                    <button key={v} type="button" onClick={() => cambiarVista(v)} aria-pressed={vista === v} aria-label={t}
                      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors max-sm:h-10 max-sm:w-10 max-sm:px-0 ${vista === v ? "bg-white text-[var(--brand-600)] shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                      <I className="h-3.5 w-3.5 max-sm:h-4 max-sm:w-4" /> <span className="max-sm:sr-only">{t}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="min-w-0 flex-1 sm:flex-none">
                <AccionesPagina
                  acciones={[
                    ...(esAdmin ? [{ etiqueta: "Configurar estados", icono: <Settings2 />, onClick: () => setEstadosOpen(true) }] : []),
                    { etiqueta: "Nuevo proyecto", icono: <Plus />, onClick: () => setNuevoOpen(true), primaria: true },
                  ]}
                />
              </div>
            </div>
          }
        />
        <nav aria-label="Pantallas de Proyectos" className="-mb-1 border-b border-slate-200">
          <ScrollHorizontal claseFila="gap-1" dependencias={[pantalla]}>
            {pantallas.filter((p) => p.ver).map((p) => {
              const activa = pantalla === p.id;
              const I = p.icon;
              return (
                <button key={p.id} type="button" onClick={() => irPantalla(p.id)} aria-current={activa ? "page" : undefined}
                  className={`-mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-semibold transition-colors max-md:min-h-11 ${activa ? "border-[var(--brand)] text-[var(--brand-700)]" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"}`}>
                  <I className="h-3.5 w-3.5" /> {p.label}
                </button>
              );
            })}
          </ScrollHorizontal>
        </nav>
      </div>

      {pantalla === "equipo" ? (
        <TareasEquipo yo={yo} esAdmin={esAdmin} version={dashVersion} onAbrir={acciones.onAbrir} avisar={avisar} />
      ) : pantalla === "ejecutivo" ? (
        <DashboardEjecutivo config={config} version={dashVersion} onAbrir={acciones.onAbrir} avisar={avisar} />
      ) : pantalla === "pm" ? (
        <DashboardPm esAdmin={esAdmin} config={config} version={dashVersion} onAbrir={acciones.onAbrir} />
      ) : (
      <>
      {/* Buscador + filtros (en celular / tablet chica, los filtros van en la hoja "Filtros") */}
      <BarraFiltros
        plano
        activos={[responsable && responsable !== (esAdmin || !yo ? "" : yo), cliente, prioridad, archivados, desde || hasta].filter(Boolean).length}
        onLimpiar={hayFiltros ? limpiar : undefined}
        busqueda={
          <div className="relative min-w-0 md:min-w-[220px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--brand)]" />
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setBusqueda("")}
              placeholder="Buscar por título, número, cliente o descripción…"
              aria-label="Buscar proyectos"
              enterKeyHint="search"
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 hover:border-[var(--brand)]/60 focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20 max-md:h-11"
            />
          </div>
        }
      >
        <Select value={responsable ?? ""} onChange={setResponsable} minWidth={200} options={opcionesResp} etiqueta="Responsable" />
        <div className="min-w-[220px]"><ClienteSelect valor={cliente} onChange={setCliente} /></div>
        <Select value={prioridad} onChange={setPrioridad} minWidth={170} etiqueta="Prioridad"
          options={[["", "Todas las prioridades"], ...PRIORIDADES.map((p) => [p, PRIORIDAD_LABEL[p]] as [string, string])]} />
        <button type="button" onClick={() => setArchivados((v) => !v)} aria-pressed={archivados}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-semibold transition-colors max-md:min-h-11 max-md:justify-center max-md:text-sm ${archivados ? "border-[var(--brand)] bg-[var(--brand-50)] text-[var(--brand-700)]" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}>
          <Archive className="h-3.5 w-3.5" /> Archivados
        </button>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5" title="Acota solo las columnas de Entregado">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 max-md:w-full">Entregado</span>
          <SelectorFecha compacto etiqueta="Entregados desde" value={desde} max={hasta || undefined} onChange={setDesde}
            claseBoton="rounded-xl px-3 py-2.5 text-slate-900 shadow-sm" className="w-[140px] max-md:w-auto max-md:min-w-0 max-md:flex-1" />
          <SelectorFecha compacto etiqueta="Entregados hasta" value={hasta} min={desde || undefined} onChange={setHasta}
            claseBoton="rounded-xl px-3 py-2.5 text-slate-900 shadow-sm" className="w-[140px] max-md:w-auto max-md:min-w-0 max-md:flex-1" />
        </div>
      </BarraFiltros>

      {error ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <span>{error}</span>
          <button type="button" onClick={() => void cargarTablero()} className="font-semibold underline">Reintentar</button>
        </div>
      ) : null}

      {vista === "kanban" ? (
        !tablero && cargando ? (
          <div className="flex gap-4 overflow-hidden">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-96 w-[300px] min-w-[300px] animate-pulse rounded-xl border border-slate-200 bg-white/60" />)}
          </div>
        ) : (
          <>
            <div className={`transition-opacity ${cargando ? "opacity-60" : ""}`}>
              <KanbanScroller>
                <div className="flex h-full min-w-max items-start gap-4">
                  {columnas.map((c) => (
                    <ColumnaKanban
                      key={c.id}
                      col={c}
                      estados={estadosMap}
                      opcionesEstado={opcionesEstado}
                      horario={horario}
                      yo={yo}
                      esAdmin={esAdmin}
                      resaltada={sobre === c.id}
                      cargandoMas={!!cargandoMas[c.id]}
                      acciones={acciones}
                      onDragSobre={onDragSobre}
                      onSoltar={onSoltar}
                      onCargarMas={cargarMas}
                    />
                  ))}
                </div>
              </KanbanScroller>
            </div>
            <p className="text-center text-xs text-slate-400">
              {tactil
                ? "Deslizá para ver las otras columnas y usá “Mover a” en cada tarjeta. Mueven el técnico, el PM o un administrador."
                : "Arrastrá tarjetas entre columnas o usá el selector “Mover a”. Mueven el técnico, el PM o un administrador."}
            </p>
          </>
        )
      ) : listo ? (
        <ProyectosLista
          filtros={filtros}
          estados={estadosMap}
          opcionesEstado={opcionesEstado}
          horario={horario}
          yo={yo}
          esAdmin={esAdmin}
          parches={parches}
          quitados={quitados}
          version={version}
          onAbrir={acciones.onAbrir}
          onMover={acciones.onMover}
        />
      ) : null}
      </>
      )}

      {/* Modales */}
      {nuevoOpen ? (
        <ModalProyecto onClose={() => setNuevoOpen(false)} ancho="max-w-3xl" etiqueta="Nuevo proyecto">
          <div className="flex shrink-0 flex-wrap items-start justify-between gap-4 border-b border-slate-100 bg-gradient-to-br from-white via-white to-[var(--brand)]/5 py-3 pl-4 pr-1.5 sm:px-6 sm:pb-5 sm:pt-6">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full bg-[var(--brand)] shadow-[0_0_0_3px_var(--brand-100)]" />
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--brand)]">Nuevo</p>
              </div>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-900 sm:text-2xl">Crear proyecto</h2>
              <p className="mt-1 text-[13px] text-slate-500 sm:text-sm">Entra en el estado inicial del tablero.</p>
            </div>
            <button type="button" onClick={() => setNuevoOpen(false)} aria-label="Cerrar" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 sm:hidden">
              <X className="h-5 w-5" />
            </button>
          </div>
          <ProyectoForm variant="modal" onCancel={() => setNuevoOpen(false)} onCreado={alCrear} />
        </ModalProyecto>
      ) : null}

      {detalleId ? (
        <ModalProyecto onClose={cerrarDetalle} etiqueta="Detalle del proyecto">
          <ProyectoDetalle
            id={detalleId}
            variant="modal"
            estados={estados.length ? estados : undefined}
            preview={preview}
            onClose={cerrarDetalle}
            onMovido={alMoverDesdeDetalle}
            onGuardado={alGuardar}
            onEliminado={alEliminar}
          />
        </ModalProyecto>
      ) : null}

      {pide ? (
        <MotivoModal
          estado={pide.a}
          proyecto={pide.t.titulo}
          onCancel={() => { pide.resolver(null); setPide(null); }}
          onConfirm={(m) => { pide.resolver(m); setPide(null); }}
        />
      ) : null}

      {estadosOpen ? (
        <EstadosModal
          onClose={() => setEstadosOpen(false)}
          onGuardado={() => {
            setEstadosOpen(false);
            invalidar("/api/proyectos/estados");
            avisar({ texto: "Configuración guardada." });
            cargarConfig();
            if (enTableroPantalla) void cargarTablero();
            setVersion((v) => v + 1);
            setDashVersion((v) => v + 1);
          }}
        />
      ) : null}

      {avisoNodo}
    </div>
  );
}
