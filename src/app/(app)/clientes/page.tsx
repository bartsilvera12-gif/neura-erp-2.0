"use client";

/**
 * /clientes — base de clientes (copia del sistema actual, con datos genéricos).
 * Arriba: título + "Nuevo cliente". Buscador inteligente en el servidor (nombre, código
 * CL-…, RUC/CI con o sin puntos, contacto, teléfono, email, ciudad) y filtros por estado
 * (activos por defecto / inactivos / de baja / todos), tipo, origen, categoría y deuda.
 * Contador "N de M clientes · activos · empresas" y columnas configurables (se recuerdan
 * en este navegador). Tocar una fila abre los datos del cliente (modal de solo lectura con Editar y
 * Dar de baja / Reactivar; la ficha completa sigue en /clientes/<id>). Con "Todos los estados" los
 * activos van primero (lo ordena listar_clientes) y los inactivos se ven atenuados. La columna "Suscripción activa"
 * muestra el/los plan(es) activo(s) de cada cliente.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Download, Plus, Search, Users } from "lucide-react";
import { apiFetchCache, apiFetchSWR, guardadoAlInstante, invalidar, precargar } from "@/lib/api/cache-cliente";
import { descargarArchivo } from "@/lib/api/client-blob";
import { Select } from "@/components/Select";
import { AccionesPagina, BarraFiltros, EncabezadoPagina } from "@/components/EncabezadoPagina";
import { TablaTarjetas, useVistaTarjetas, type ColumnaTabla, type RolMovil } from "@/components/TablaResponsive";
import { ClienteForm } from "@/modules/clientes/ClienteForm";
import { ClienteDatosModal } from "@/modules/clientes/ClienteDatosModal";
import { urlFicha } from "@/modules/clientes/ficha/url";
import type { Categoria } from "@/modules/clientes/esquema";
import {
  Avatar, BadgeEstado, BadgeOrigen, CategoriaChip, CodigoChip, TEAL, codigoCliente, estadoDe, fechaCorta, gs,
} from "@/modules/clientes/ui";

const POR_PAGINA = 25;
// v2: se sumó "Suscripción activa" (visible por defecto). Lo guardado en v1 se migra agregándola.
const COLUMNAS_KEY = "erp2.clientes.columnas.v2";
const COLUMNAS_KEY_V1 = "erp2.clientes.columnas.v1";

type Fila = {
  id: string; codigo: string | null; nombre: string; razon_social: string | null; tipo_cliente: "empresa" | "persona";
  documento: string | null; ruc: string | null; nombre_contacto: string | null; telefono: string | null; email: string | null;
  ciudad: string | null; condicion_pago: string; activo: boolean; origen: string; creado_at: string; baja_at: string | null;
  categoria_id: string | null; categoria_nombre: string | null; categoria_color: string | null; vendedor_nombre: string | null;
  creado_por_nombre: string | null; total_comprado: number; compras: number; ultima_compra: string | null; deuda: number; vencido: number;
  suscripcion_activa: string | null;
};
type Kpis = { clientes: number; activos: number; empresas: number; con_deuda: number; a_cobrar: number; vencido: number };
type Resp = { rows: Fila[]; total: number; kpis: Kpis };

// ── Columnas configurables ──────────────────────────────────────────────────
type ColKey =
  | "codigo" | "empresa_nombre" | "contacto" | "telefono" | "suscripcion" | "origen" | "categoria" | "estado" | "desde"
  | "creado_por" | "ruc_documento" | "email" | "vendedor" | "deuda" | "ultima_compra";
// `movil`: qué papel cumple la columna en la TARJETA del celular (TablaTarjetas, < 768 px).
type Col = { key: ColKey; label: string; required?: boolean; th?: string; td: string; render: (c: Fila) => ReactNode; movil?: RolMovil; renderMovil?: (c: Fila) => ReactNode };

const DEFAULT_COLS: ColKey[] = ["codigo", "empresa_nombre", "contacto", "telefono", "suscripcion", "origen", "categoria", "estado", "desde", "deuda"];

const TH = "whitespace-nowrap px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500";
const TD = "px-3 py-2.5";

const COLUMNAS: Col[] = [
  { key: "codigo", label: "Código", td: TD, render: (c) => <CodigoChip codigo={codigoCliente(c)} />, movil: "oculto" },
  {
    key: "empresa_nombre", label: "Empresa / Nombre", required: true, td: TD, movil: "titulo",
    renderMovil: (c) => c.nombre,
    render: (c) => (
      <div className="flex min-w-56 items-center gap-2.5">
        <Avatar nombre={c.nombre} />
        <div className="min-w-0">
          <Link href={`/clientes/${c.id}`} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) { e.stopPropagation(); return; } e.preventDefault(); }} className="block truncate text-sm font-semibold text-slate-900 group-hover:text-slate-950">
            {c.nombre}
          </Link>
          {c.tipo_cliente === "empresa" && (c.ruc || c.documento) ? (
            <p className="mt-0.5 text-[11px] text-slate-500"><span className="font-medium text-slate-400">RUC:</span> {c.ruc || c.documento}</p>
          ) : c.tipo_cliente === "persona" ? (
            <p className="mt-0.5 text-[11px] text-slate-400">Persona física</p>
          ) : null}
        </div>
      </div>
    ),
  },
  { key: "contacto", label: "Contacto", movil: "dato", td: `${TD} whitespace-nowrap text-sm text-slate-700`, render: (c) => (c.tipo_cliente === "empresa" ? c.nombre_contacto : c.ciudad) || "—",
    renderMovil: (c) => (c.ruc || c.documento ? `RUC ${c.ruc || c.documento}` : c.tipo_cliente === "empresa" ? "Empresa" : "Persona física") },
  { key: "telefono", label: "Teléfono", movil: "dato", td: `${TD} whitespace-nowrap text-sm tabular-nums text-slate-600`, render: (c) => c.telefono || "—" },
  {
    key: "suscripcion", label: "Suscripción activa", td: TD, movil: "dato", renderMovil: (c) => c.suscripcion_activa || null,
    render: (c) => c.suscripcion_activa ? (
      <span className="inline-flex max-w-56 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold"
        style={{ borderColor: `${TEAL}4d`, backgroundColor: `${TEAL}1a`, color: TEAL }} title={c.suscripcion_activa}>
        <span aria-hidden className="h-1 w-1 shrink-0 rounded-full" style={{ backgroundColor: TEAL }} />
        <span className="truncate">{c.suscripcion_activa}</span>
      </span>
    ) : <span className="whitespace-nowrap text-xs italic text-slate-400">Sin suscripción</span>,
  },
  { key: "origen", label: "Origen", td: TD, render: (c) => <BadgeOrigen origen={c.origen} /> },
  { key: "categoria", label: "Categoría", movil: "oculto", td: `${TD} whitespace-nowrap`, render: (c) => <CategoriaChip nombre={c.categoria_nombre} color={c.categoria_color} /> },
  // En el celular solo lo que pide atención: dado de baja / inactivo, o lo vencido.
  {
    key: "estado", label: "Estado", movil: "chip", td: TD, render: (c) => <BadgeEstado estado={estadoDe(c)} />,
    renderMovil: (c) => (estadoDe(c) !== "activo" ? <BadgeEstado estado={estadoDe(c)} />
      : Number(c.vencido) > 0 ? <span className="whitespace-nowrap text-[12px] font-semibold text-rose-600">vencido {gs(c.vencido)}</span> : null),
  },
  { key: "desde", label: "Desde", td: `${TD} whitespace-nowrap text-xs tabular-nums text-slate-500`, render: (c) => fechaCorta(c.creado_at) },
  { key: "creado_por", label: "Creado por", td: `${TD} whitespace-nowrap text-xs text-slate-500`, render: (c) => c.creado_por_nombre || "—" },
  { key: "ruc_documento", label: "RUC / documento", td: `${TD} whitespace-nowrap text-sm text-slate-600`, render: (c) => c.ruc?.trim() || c.documento?.trim() || "—" },
  { key: "email", label: "Email", td: `${TD} whitespace-nowrap text-sm text-slate-600`, render: (c) => c.email || "—" },
  {
    key: "vendedor", label: "Vendedor", td: `${TD} whitespace-nowrap text-xs text-slate-500`,
    render: (c) => (c.vendedor_nombre ? <span className="font-medium text-slate-700">{c.vendedor_nombre}</span> : <span className="text-slate-400">Sin asignar</span>),
  },
  {
    key: "deuda", label: "Deuda", th: "text-right", movil: "valor", td: `${TD} whitespace-nowrap text-right`,
    render: (c) => Number(c.deuda) > 0 ? (
      <div>
        <p className={`text-sm font-semibold tabular-nums ${Number(c.vencido) > 0 ? "text-rose-600" : "text-slate-900"}`}>{gs(c.deuda)}</p>
        {Number(c.vencido) > 0 ? <p className="text-[11px] font-semibold text-rose-600">vencido {gs(c.vencido)}</p> : null}
      </div>
    ) : <span className="text-xs text-slate-400">Al día</span>,
    renderMovil: (c) => (Number(c.deuda) > 0
      ? <span className={Number(c.vencido) > 0 ? "text-rose-600" : "text-slate-900"}>{gs(c.deuda)}</span>
      : <span className="text-[13px] font-normal text-slate-400">Al día</span>),
  },
  {
    key: "ultima_compra", label: "Última compra", td: `${TD} whitespace-nowrap text-xs tabular-nums text-slate-500`,
    render: (c) => (c.ultima_compra ? fechaCorta(c.ultima_compra) : <span className="text-slate-400">Nunca compró</span>),
  },
];

const claveCliente = (c: Fila) => c.id;
// Inactivos / de baja: fila atenuada (el chip de Estado dice cuál es).
const claseCliente = (c: Fila) => (c.activo && !c.baja_at ? "" : "bg-slate-50/70 opacity-60 hover:opacity-100");

function normalizarCols(raw: unknown): ColKey[] {
  const validas = new Set(COLUMNAS.map((c) => c.key));
  const src = Array.isArray(raw) ? raw : DEFAULT_COLS;
  const next = src.filter((k): k is ColKey => typeof k === "string" && validas.has(k as ColKey));
  for (const c of COLUMNAS) if (c.required && !next.includes(c.key)) next.push(c.key);
  return next.length > 0 ? next : [...DEFAULT_COLS];
}

type Filtros = { q: string; estado: string; tipo: string; origen: string; categoria: string; deuda: string };
const FILTROS_INICIALES: Filtros = { q: "", estado: "activos", tipo: "", origen: "", categoria: "", deuda: "" };

function paramsFiltros(f: Filtros) {
  const sp = new URLSearchParams();
  if (f.q) sp.set("q", f.q);
  sp.set("estado", f.estado);
  if (f.tipo) sp.set("tipo", f.tipo);
  if (f.origen) sp.set("origen", f.origen);
  if (f.categoria) sp.set("categoria", f.categoria);
  if (f.deuda) sp.set("deuda", f.deuda);
  return sp;
}
/** URL de una página de la lista: también es la clave del cache en memoria (filtros + página). */
function urlLista(f: Filtros, pagina: number) {
  const sp = paramsFiltros(f);
  sp.set("paginado", "1");
  sp.set("pagina", String(pagina));
  sp.set("por_pagina", String(POR_PAGINA));
  return `/api/clientes?${sp}`;
}

// Columna de la página → columna de TablaTarjetas (tabla en ≥ 768 px, tarjetas en celular).
// Las filas quedan memorizadas adentro: abrir/cerrar la ficha o tipear en el buscador no las
// vuelve a dibujar si no cambió su cliente o las columnas.
const aColumnaTabla = (c: Col): ColumnaTabla<Fila> => ({
  key: c.key, titulo: c.label, celda: c.render, claseTh: c.th, claseTd: c.td, movil: c.movil, celdaMovil: c.renderMovil,
});
// Solo en el celular: el avatar a la izquierda del renglón (en la tabla va junto al nombre).
const COL_AVATAR: ColumnaTabla<Fila> = { key: "avatar", titulo: "", claseTh: "hidden", claseTd: "hidden", movil: "imagen", celda: (c) => <Avatar nombre={c.nombre} /> };

export default function ClientesPage() {
  const router = useRouter();
  // Volver a /clientes pinta en el primer render lo último que se vio (y se refresca atrás).
  const [inicial] = useState(() => guardadoAlInstante<Resp>(urlLista(FILTROS_INICIALES, 1)));
  const [rows, setRows] = useState<Fila[]>(inicial?.rows ?? []);
  const [total, setTotal] = useState(inicial?.total ?? 0);
  const [kpis, setKpis] = useState<Kpis | null>(inicial?.kpis ?? null);
  const [pagina, setPagina] = useState(1);
  const [cargando, setCargando] = useState(!inicial);
  const [borrador, setBorrador] = useState("");
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState("activos");
  const [tipo, setTipo] = useState("");
  const [origen, setOrigen] = useState("");
  const [categoria, setCategoria] = useState("");
  const [deuda, setDeuda] = useState("");
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [nuevo, setNuevo] = useState(false);
  const [ficha, setFicha] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [exportando, setExportando] = useState(false);
  const [bajaOk, setBajaOk] = useState(false);
  const [colsOpen, setColsOpen] = useState(false);
  const [colsListas, setColsListas] = useState(false);
  const [visibles, setVisibles] = useState<ColKey[]>(DEFAULT_COLS);
  const colsRef = useRef<HTMLDivElement>(null);
  const vistaTarjetas = useVistaTarjetas();

  // Debounce del buscador. Si el texto no cambió (al montar, o espacios de más) no hace nada:
  // así no vuelve a la página 1 ni dispara otra carga.
  useEffect(() => {
    const t = borrador.trim();
    if (t === q) return;
    const id = setTimeout(() => { setQ(t); setPagina(1); }, 300);
    return () => clearTimeout(id);
  }, [borrador, q]);

  useEffect(() => {
    apiFetchCache<Categoria[]>("/api/clientes/categorias").then(setCategorias).catch(() => {});
  }, []);

  // Columnas recordadas en este navegador.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COLUMNAS_KEY);
      if (raw) {
        setVisibles(normalizarCols(JSON.parse(raw)));
      } else {
        const v1 = window.localStorage.getItem(COLUMNAS_KEY_V1);
        const previas = v1 ? normalizarCols(JSON.parse(v1)) : null;
        if (previas && !previas.includes("suscripcion")) {
          const i = previas.indexOf("telefono");
          previas.splice(i >= 0 ? i + 1 : previas.length, 0, "suscripcion");
        }
        setVisibles(previas ?? [...DEFAULT_COLS]);
      }
    } catch {
      setVisibles([...DEFAULT_COLS]);
    } finally {
      setColsListas(true);
    }
  }, []);
  useEffect(() => {
    if (!colsListas) return;
    try { window.localStorage.setItem(COLUMNAS_KEY, JSON.stringify(visibles)); } catch { /* modo privado: quedan los defaults */ }
  }, [visibles, colsListas]);
  useEffect(() => {
    if (!colsOpen) return;
    const fuera = (e: MouseEvent) => colsRef.current && !colsRef.current.contains(e.target as Node) && setColsOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setColsOpen(false);
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fuera); document.removeEventListener("keydown", esc); };
  }, [colsOpen]);

  // Los datos del cliente se abren en un modal sobre la lista; ?cliente=<id> lo reabre.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("cliente");
    if (id) setFicha(id);
  }, []);
  // Estables (useCallback) para que las filas memorizadas no se re-rendericen.
  const abrirFicha = useCallback((id: string) => {
    setFicha(id);
    window.history.replaceState({}, "", `/clientes?cliente=${encodeURIComponent(id)}`);
  }, []);
  // Cerrar no toca la lista (ni re-pide nada).
  function cerrarFicha() {
    setFicha(null);
    window.history.replaceState({}, "", "/clientes");
  }
  // Se editó / dio de baja / reactivó desde el modal: se descartan las páginas guardadas y
  // se recarga la actual en el momento (atrás del modal).
  const cambioEnDatos = useCallback(() => {
    invalidar("/api/clientes");
    setRecarga((k) => k + 1);
  }, []);

  // Prefetch de la ficha: con el mouse ~150 ms sobre la fila (o al apretar) se pide en
  // segundo plano, así el modal abre con los datos ya en memoria.
  const intencion = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onIntencion = useCallback((id: string, ya?: boolean) => {
    if (intencion.current) clearTimeout(intencion.current);
    intencion.current = null;
    if (ya) void precargar(urlFicha(id));
    else intencion.current = setTimeout(() => void precargar(urlFicha(id)), 150);
  }, []);
  const onSinIntencion = useCallback(() => {
    if (intencion.current) clearTimeout(intencion.current);
    intencion.current = null;
  }, []);

  // Aviso después de dar de baja desde la ficha.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("baja_ok") !== "1") return;
    setBajaOk(true);
    window.history.replaceState({}, "", "/clientes");
    const t = setTimeout(() => setBajaOk(false), 5000);
    return () => clearTimeout(t);
  }, []);

  const f = useMemo<Filtros>(() => ({ q, estado, tipo, origen, categoria, deuda }), [q, estado, tipo, origen, categoria, deuda]);
  const filtros = useCallback(() => paramsFiltros(f), [f]);

  // Carga de la página: cache en memoria por filtros + página (volver a una página es
  // instantáneo y se refresca atrás), las filas anteriores quedan visibles mientras llega
  // la nueva (sin parpadeo) y un request viejo se aborta si cambia la URL antes de que
  // responda. No se aborta en el cleanup: en dev (StrictMode) el efecto corre dos veces y
  // la segunda reusa el MISMO request en curso (uno solo en la red).
  const vigente = useRef<{ url: string; ctrl: AbortController } | null>(null);
  const recargaVista = useRef(recarga);
  useEffect(() => {
    const url = urlLista(f, pagina);
    const previo = vigente.current;
    if (previo && previo.url !== url) previo.ctrl.abort();
    const ctrl = previo && previo.url === url && !previo.ctrl.signal.aborted ? previo.ctrl : new AbortController();
    vigente.current = { url, ctrl };
    // Después de guardar algo (alta, cambios en la ficha) no sirve lo guardado.
    const fresco = recargaVista.current !== recarga;
    recargaVista.current = recarga;
    setCargando(true);
    apiFetchSWR<Resp>(url, (r, viejo) => {
      setRows(r.rows); setTotal(r.total); setKpis(r.kpis);
      if (viejo) setCargando(false);
      // Prefetch de la página siguiente (es una consulta barata), cuando el navegador está libre.
      if (!viejo && pagina * POR_PAGINA < r.total) {
        const sig = urlLista(f, pagina + 1);
        if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(() => void precargar(sig));
        else setTimeout(() => void precargar(sig), 300);
      }
    }, { signal: ctrl.signal, fresco, maxEdadMs: 2000 })
      .catch(() => { if (!ctrl.signal.aborted) { setRows([]); setTotal(0); } })
      .finally(() => { if (!ctrl.signal.aborted) setCargando(false); });
  }, [f, pagina, recarga]);

  const hayFiltros = !!(q || borrador || estado !== "activos" || tipo || origen || categoria || deuda);
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const visibleSet = useMemo(() => new Set(visibles), [visibles]);
  const columnas = useMemo(() => [COL_AVATAR, ...COLUMNAS.filter((c) => visibleSet.has(c.key)).map(aColumnaTabla)], [visibleSet]);
  const abrirFila = useCallback((c: Fila) => abrirFicha(c.id), [abrirFicha]);
  const intencionFila = useCallback((c: Fila, ya?: boolean) => onIntencion(c.id, ya), [onIntencion]);
  const filtrosActivos = [estado !== "activos", tipo, origen, categoria, deuda].filter(Boolean).length;
  const sinClientes = !!kpis && kpis.clientes === 0;

  function toggleCol(key: ColKey) {
    const col = COLUMNAS.find((c) => c.key === key);
    if (!col || col.required) return;
    setVisibles((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  function limpiar() {
    setBorrador(""); setQ(""); setEstado("activos"); setTipo(""); setOrigen(""); setCategoria(""); setDeuda(""); setPagina(1);
  }

  async function exportar() {
    setExportando(true);
    try {
      await descargarArchivo(`/api/clientes/export?${filtros()}`, "clientes.xlsx");
    } catch {
      /* best-effort */
    } finally {
      setExportando(false);
    }
  }

  const fil = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPagina(1); };

  return (
    <div className="space-y-4 pb-10">
      {bajaOk ? (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-emerald-800">
          <span className="text-lg">✓</span>
          <p className="text-sm font-medium">Baja procesada correctamente</p>
        </div>
      ) : null}

      {/* Encabezado (en celular: "Nuevo cliente" a la vista y "Exportar" en el menú ⋯) */}
      <EncabezadoPagina
        volver={{ href: "/comercial", label: "Comercial" }}
        kicker="Base"
        titulo="Clientes"
        subtitulo="Base de clientes activos de la empresa"
        acciones={
          <AccionesPagina acciones={[
            { etiqueta: "Exportar Excel", icono: <Download />, onClick: exportar, cargando: exportando },
            { etiqueta: "Nuevo cliente", icono: <Plus strokeWidth={2.5} />, onClick: () => setNuevo(true), primaria: true },
          ]} />
        }
      />

      {/* Filtros: búsqueda siempre a la vista; en celular el resto va en la hoja "Filtros (n)". */}
      <BarraFiltros
        activos={hayFiltros ? Math.max(filtrosActivos, borrador || q ? 1 : 0) : 0}
        onLimpiar={limpiar}
        busqueda={
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: TEAL }} />
            <input type="search" value={borrador} onChange={(e) => setBorrador(e.target.value)} placeholder="Buscar por nombre, código, email, RUC…"
              aria-label="Buscar clientes" enterKeyHint="search"
              className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 hover:border-slate-300 focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-100)] md:h-auto md:py-2" />
          </div>
        }
      >
        <Select value={estado} onChange={fil(setEstado)} minWidth={140} etiqueta="Estado"
          options={[["activos", "Activos"], ["inactivos", "Inactivos"], ["baja", "De baja"], ["todos", "Todos los estados"]]} />
        <Select value={tipo} onChange={fil(setTipo)} minWidth={140} etiqueta="Tipo" options={[["", "Todos los tipos"], ["empresa", "Empresa"], ["persona", "Persona"]]} />
        <Select value={origen} onChange={fil(setOrigen)} minWidth={150} etiqueta="Origen" options={[["", "Todos los orígenes"], ["CRM", "CRM"], ["VENTA", "Venta"], ["MANUAL", "Manual"]]} />
        <Select value={categoria} onChange={fil(setCategoria)} minWidth={160} etiqueta="Categoría"
          options={[["", "Todas las categorías"], ...categorias.map((c) => [c.id, c.nombre] as [string, string])]} />
        <Select value={deuda} onChange={fil(setDeuda)} minWidth={200} etiqueta="Deuda"
          options={[["", "Con y sin deuda"], ["con_deuda", "Con deuda"], ["vencidos", "Con deuda vencida"], ["sin_deuda", "Sin deuda"]]} />
      </BarraFiltros>

      {/* Contador + columnas */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          <span className="font-semibold tabular-nums text-slate-800">{total.toLocaleString("es-PY")}</span> de{" "}
          <span className="font-semibold tabular-nums text-slate-800">{(kpis?.clientes ?? 0).toLocaleString("es-PY")}</span> clientes
        </p>
        <div className="flex items-center gap-2.5">
          {kpis ? (
            <div className="hidden gap-2.5 text-[11px] text-slate-500 sm:flex">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <span className="tabular-nums">{kpis.activos.toLocaleString("es-PY")}</span> activos
              </span>
              <span className="text-slate-300">·</span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: TEAL }} />
                <span className="tabular-nums">{kpis.empresas.toLocaleString("es-PY")}</span> empresas
              </span>
              {kpis.con_deuda > 0 ? (
                <>
                  <span className="text-slate-300">·</span>
                  <button type="button" onClick={() => fil(setDeuda)(deuda === "con_deuda" ? "" : "con_deuda")}
                    className={`inline-flex items-center gap-1.5 hover:text-slate-700 ${deuda === "con_deuda" ? "font-semibold text-rose-600" : ""}`}
                    title={`A cobrar: ${gs(kpis.a_cobrar)}`}>
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                    <span className="tabular-nums">{kpis.con_deuda.toLocaleString("es-PY")}</span> con deuda
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
          <div ref={colsRef} className={`relative ${vistaTarjetas ? "hidden" : ""}`}>
            <button type="button" onClick={() => setColsOpen((v) => !v)} aria-expanded={colsOpen}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 shadow-sm transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]">
              <span>Columnas</span>
              <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums" style={{ backgroundColor: `${TEAL}1a`, color: TEAL }}>
                {columnas.length}/{COLUMNAS.length}
              </span>
            </button>
            {colsOpen ? (
              <div className="absolute right-0 z-20 mt-2 w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
                <div className="border-b border-slate-100 p-4">
                  <p className="text-sm font-semibold text-slate-800">Columnas visibles</p>
                  <p className="mt-1 text-xs text-slate-500">Personalizá qué información querés ver en esta tabla.</p>
                </div>
                <div className="max-h-80 overflow-y-auto p-2">
                  {COLUMNAS.map((col) => (
                    <label key={col.key}
                      className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${col.required ? "cursor-not-allowed bg-slate-50 text-slate-500" : "cursor-pointer text-slate-700 hover:bg-[var(--brand-50)]"}`}>
                      <span>{col.label}</span>
                      <input type="checkbox" checked={visibleSet.has(col.key)} disabled={col.required} onChange={() => toggleCol(col.key)}
                        className="h-4 w-4 rounded border-slate-300 accent-[var(--brand)]" />
                    </label>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-slate-100 p-3">
                  <p className="text-[11px] text-slate-400">Empresa / Nombre queda siempre visible.</p>
                  <button type="button" onClick={() => setVisibles([...DEFAULT_COLS])} className="text-xs font-semibold transition hover:brightness-90" style={{ color: TEAL }}>
                    Restablecer
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Tabla */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {cargando && rows.length === 0 ? (
          <div className="flex items-center justify-center gap-3 py-20 text-sm text-slate-500">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full" style={{ backgroundColor: TEAL }} />
            Cargando clientes…
          </div>
        ) : rows.length === 0 ? (
          <div className="py-20 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border" style={{ borderColor: `${TEAL}40`, backgroundColor: `${TEAL}1a`, color: TEAL }}>
              <Users className="h-5 w-5" />
            </div>
            <p className="text-sm font-semibold text-slate-700">{sinClientes ? "No hay clientes registrados" : "Sin resultados para los filtros aplicados"}</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
              {sinClientes ? "Empezá creando tu primer cliente para construir tu base." : "Probá ajustar la búsqueda o limpiar los filtros."}
            </p>
            {sinClientes ? (
              <button type="button" onClick={() => setNuevo(true)} className="mt-4 inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-95" style={{ backgroundColor: TEAL }}>
                <Plus className="h-4 w-4" /> Crear primer cliente
              </button>
            ) : null}
          </div>
        ) : (
          <TablaTarjetas
            filas={rows}
            columnas={columnas}
            claveFila={claveCliente}
            claseFila={claseCliente}
            onFila={abrirFila}
            onIntencion={intencionFila}
            onSinIntencion={onSinIntencion}
            cargando={cargando}
            claseTabla="w-full min-w-full"
            thBase={TH}
            tdBase=""
          />
        )}
        {total > POR_PAGINA ? (
          <div className="flex flex-col gap-2 border-t border-slate-100 px-3 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-4">
            <span className="text-center sm:text-left">Página {pagina} de {totalPaginas} · {total.toLocaleString("es-PY")} clientes</span>
            <div className="flex gap-2">
              <button disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 hover:bg-slate-50 disabled:opacity-40 max-sm:min-h-11 max-sm:flex-1 max-sm:text-sm">Anterior</button>
              <button disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 hover:bg-slate-50 disabled:opacity-40 max-sm:min-h-11 max-sm:flex-1 max-sm:text-sm">Siguiente</button>
            </div>
          </div>
        ) : null}
      </div>

      {nuevo ? <ClienteForm onClose={() => setNuevo(false)} onSaved={(id) => { setNuevo(false); setRecarga((k) => k + 1); if (id) abrirFicha(id); }} /> : null}
      {ficha ? <ClienteDatosModal id={ficha} onCerrar={cerrarFicha} onCambio={cambioEnDatos} /> : null}
    </div>
  );
}
