"use client";

/**
 * /presupuestos — lista de presupuestos. Una consulta paginada en la base
 * (listar_presupuestos) trae la página, los conteos por estado y las cifras de arriba.
 * Búsqueda inteligente (número, cliente, RUC, teléfono, productos), filtros por estado,
 * cliente, vendedor y rango de fechas. Vuelve a la pantalla y pinta al instante lo último
 * que se vio (stale-while-revalidate).
 * Tocar una fila abre el detalle en un modal sobre la lista (como la ficha en Clientes);
 * ?ver=<id> en la URL lo reabre (link compartible). Ctrl/Cmd + clic o clic medio en el número
 * abre la página del presupuesto en otra pestaña.
 */
import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FileSignature, Plus, Search, Settings2 } from "lucide-react";
import { apiFetchCache, apiFetchSWR, guardadoAlInstante, invalidar, precargar } from "@/lib/api/cache-cliente";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import { hoyPY } from "@/lib/fecha/paraguay";
import { clienteConfig } from "@/cliente.config";
import { Select } from "@/components/Select";
import { AccionesPagina, BarraFiltros, EncabezadoPagina } from "@/components/EncabezadoPagina";
import { ScrollHorizontal } from "@/components/ScrollHorizontal";
import { TablaTarjetas } from "@/components/TablaResponsive";
import { BuscadorCliente } from "@/modules/clientes/gestion/BuscadorCliente";
import { BadgeEstado, textoVigencia } from "@/modules/presupuestos/ui";
import { ModalAjustes } from "@/modules/presupuestos/Modales";
import { PresupuestoModal } from "@/modules/presupuestos/PresupuestoModal";
import { diaCorto, monto, type ListaPresupuestos } from "@/modules/presupuestos/tipos";
import { SelectorFecha } from "@/components/SelectorFecha";

const TEAL = clienteConfig.color;
const POR_PAGINA = 25;
const ES_ID = /^[0-9a-f-]{36}$/i;

/** URL actual con ?ver=<id> puesto (o sacado), sin tocar los demás parámetros (ej. ?cliente=). */
function urlConVer(id: string | null) {
  const u = new URLSearchParams(window.location.search);
  if (id) u.set("ver", id);
  else u.delete("ver");
  const qs = u.toString();
  return `/presupuestos${qs ? `?${qs}` : ""}`;
}

const FILTROS: { id: string; texto: string; clave: keyof ListaPresupuestos["conteos"] }[] = [
  { id: "abiertos", texto: "Abiertos", clave: "abiertos" },
  { id: "", texto: "Todos", clave: "todos" },
  { id: "borrador", texto: "Borradores", clave: "borrador" },
  { id: "enviado", texto: "Enviados", clave: "enviado" },
  { id: "aceptado", texto: "Aceptados", clave: "aceptado" },
  { id: "vencido", texto: "Vencidos", clave: "vencido" },
  { id: "rechazado", texto: "Rechazados", clave: "rechazado" },
  { id: "convertido", texto: "Convertidos", clave: "convertido" },
];

export default function PresupuestosPage() {
  return (
    <Suspense>
      <Lista />
    </Suspense>
  );
}

function Lista() {
  const router = useRouter();
  const sp = useSearchParams();
  const me = useUsuario();
  const esAdmin = me?.rol === "ADMIN";

  const [borrador, setBorrador] = useState("");
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState("abiertos");
  const [cliente, setCliente] = useState<{ id: string; nombre: string } | null>(null);
  const [vendedor, setVendedor] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [pagina, setPagina] = useState(1);
  const [vendedores, setVendedores] = useState<{ id: string; nombre: string }[]>([]);
  const [ajustes, setAjustes] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ver, setVer] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const cambioEnDetalle = useRef(false);

  // El detalle se abre en un modal sobre la lista; ?ver=<id> lo reabre (al cargar la página).
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("ver");
    if (id && ES_ID.test(id)) setVer(id);
  }, []);
  const abrir = useCallback((id: string) => {
    cambioEnDetalle.current = false;
    setVer(id);
    window.history.replaceState(null, "", urlConVer(id));
  }, []);
  // Cerrar sin cambios no toca la lista. Si cambió algo (estado, duplicar, convertir…), se
  // descarta lo guardado y se recarga la página actual.
  const cerrar = useCallback(() => {
    setVer(null);
    window.history.replaceState(null, "", urlConVer(null));
    if (cambioEnDetalle.current) {
      cambioEnDetalle.current = false;
      invalidar("/api/presupuestos");
      setRecarga((k) => k + 1);
    }
  }, []);
  const huboCambio = useCallback(() => { cambioEnDetalle.current = true; }, []);

  // ?cliente=<id>&nombre=… (desde la ficha del cliente) → filtra por ese cliente.
  const clienteUrl = sp.get("cliente");
  const nombreUrl = sp.get("nombre");
  useEffect(() => {
    if (clienteUrl && /^[0-9a-f-]{36}$/i.test(clienteUrl)) { setCliente({ id: clienteUrl, nombre: nombreUrl || "Cliente" }); setEstado(""); }
  }, [clienteUrl, nombreUrl]);

  useEffect(() => {
    apiFetchCache<{ id: string; nombre: string }[]>("/api/usuarios").then(setVendedores).catch(() => {});
  }, []);
  useEffect(() => {
    const t = setTimeout(() => { setQ(borrador.trim()); setPagina(1); }, 300);
    return () => clearTimeout(t);
  }, [borrador]);

  const url = useMemo(() => {
    const u = new URLSearchParams({ pagina: String(pagina), por_pagina: String(POR_PAGINA) });
    if (q) u.set("q", q);
    if (estado) u.set("estado", estado);
    if (cliente) u.set("cliente", cliente.id);
    if (vendedor) u.set("vendedor", vendedor);
    if (desde) u.set("desde", desde);
    if (hasta) u.set("hasta", hasta);
    return `/api/presupuestos?${u}`;
  }, [pagina, q, estado, cliente, vendedor, desde, hasta]);

  const [data, setData] = useState<ListaPresupuestos | null>(() => guardadoAlInstante<ListaPresupuestos>(url) ?? null);
  const [cargando, setCargando] = useState(!data);
  const [error, setError] = useState<string | null>(null);
  const ultimo = useRef<ListaPresupuestos | null>(data);
  const recargaVista = useRef(recarga);

  useEffect(() => {
    const ctrl = new AbortController();
    // Después de un cambio en el detalle no sirve lo guardado: se pide fresco.
    const fresco = recargaVista.current !== recarga;
    recargaVista.current = recarga;
    setCargando(true);
    setError(null);
    apiFetchSWR<ListaPresupuestos>(url, (d) => { ultimo.current = d; setData(d); }, { signal: ctrl.signal, fresco })
      .catch((e) => { if (!ctrl.signal.aborted) setError((e as Error).message); })
      .finally(() => { if (!ctrl.signal.aborted) setCargando(false); });
    return () => ctrl.abort();
  }, [url, recarga]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 5000);
    return () => clearTimeout(t);
  }, [aviso]);

  const d = data ?? ultimo.current;
  const hoy = hoyPY();
  const totalPaginas = Math.max(1, Math.ceil((d?.total ?? 0) / POR_PAGINA));
  const k = d?.kpis;
  const tasa = k && k.mes_emitidos > 0 ? Math.round((k.mes_convertidos / k.mes_emitidos) * 100) : null;
  const hayFiltros = !!(q || cliente || vendedor || desde || hasta);

  function limpiarFiltros() {
    setBorrador(""); setQ(""); setCliente(null); setVendedor(""); setDesde(""); setHasta(""); setPagina(1);
    if (clienteUrl) router.replace("/presupuestos");
  }

  const activos = (q ? 1 : 0) + (cliente ? 1 : 0) + (vendedor ? 1 : 0) + (desde ? 1 : 0) + (hasta ? 1 : 0);
  const vacio = (
    <div className="px-5 py-16 text-center">
      <FileSignature className="mx-auto h-8 w-8 text-slate-300" />
      <p className="mt-3 text-sm font-medium text-slate-700">
        {hayFiltros ? "Ningún presupuesto coincide con la búsqueda" : estado === "abiertos" ? "No hay presupuestos abiertos" : "No hay presupuestos en este estado"}
      </p>
      {!hayFiltros ? (
        <Link href="/presupuestos/nuevo" className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white sm:min-h-0" style={{ backgroundColor: TEAL }}>
          <Plus className="h-4 w-4" /> Nuevo presupuesto
        </Link>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-4 pb-10 sm:space-y-5">
      <EncabezadoPagina kicker="Comercial" titulo="Presupuestos"
        subtitulo={
          // Cifras en una línea: lo abierto, cuánto hay en juego y cuánto se convierte.
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {k ? (
              <>
                <span><b className="font-semibold tabular-nums text-slate-900">{k.abiertos}</b> abiertos</span>
                <span aria-hidden className="text-slate-300">·</span>
                <span><b className="font-semibold tabular-nums text-slate-900">{monto(k.en_negociacion)}</b> en negociación</span>
                <span aria-hidden className="text-slate-300">·</span>
                <span title={`${k.mes_convertidos} de ${k.mes_emitidos} presupuestos enviados este mes`}>
                  {tasa == null ? "sin envíos este mes" : <><b className="font-semibold tabular-nums text-slate-900">{tasa}%</b> convertidos este mes <span className="text-slate-400">({k.mes_convertidos} de {k.mes_emitidos})</span></>}
                </span>
              </>
            ) : <span className="inline-block h-4 w-80 max-w-full animate-pulse rounded bg-slate-200" />}
          </span>
        }
        acciones={<AccionesPagina acciones={[
          { etiqueta: "Nuevo presupuesto", icono: <Plus />, href: cliente ? `/presupuestos/nuevo?cliente=${cliente.id}` : "/presupuestos/nuevo", primaria: true },
          ...(esAdmin ? [{ etiqueta: "Ajustes", icono: <Settings2 />, onClick: () => setAjustes(true) }] : []),
        ]} />} />

      {aviso ? <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">✓ {aviso}</p> : null}

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        {/* Estados con su conteo (si no entran, scrollean adentro) */}
        <ScrollHorizontal role="tablist" ariaLabel="Estado" claseFila="gap-1" className="border-b border-slate-100 px-3 pt-2" dependencias={[estado]}>
          {FILTROS.map((f) => {
            const sel = estado === f.id;
            const n = d?.conteos?.[f.clave];
            return (
              <button key={f.id || "todos"} type="button" role="tab" aria-selected={sel} onClick={() => { setEstado(f.id); setPagina(1); }}
                className={`-mb-px flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors sm:min-h-0 ${sel ? "text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700"}`}
                style={sel ? { borderColor: TEAL } : undefined}>
                {f.texto}
                {n != null ? <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${sel ? "bg-[var(--brand-50)] text-[var(--brand)]" : "bg-slate-100 text-slate-500"}`}>{n}</span> : null}
              </button>
            );
          })}
        </ScrollHorizontal>

        {/* Búsqueda y filtros (en celular, los filtros en una hoja) */}
        <BarraFiltros plano className="border-b border-slate-100 px-3 py-3 sm:px-4" activos={activos - (q ? 1 : 0)} onLimpiar={limpiarFiltros}
          busqueda={
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={borrador} onChange={(e) => setBorrador(e.target.value)} placeholder="Buscar por número, cliente, RUC, teléfono o producto…"
                type="search" enterKeyHint="search" aria-label="Buscar presupuestos"
                className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]" />
            </div>
          }>
          <div className="min-w-[200px] flex-1">
            <BuscadorCliente variant="toolbar" seleccionado={cliente?.nombre ?? null}
              onSelect={(c) => { setCliente({ id: c.id, nombre: c.nombre }); setPagina(1); }}
              onClear={() => { setCliente(null); setPagina(1); if (clienteUrl) router.replace("/presupuestos"); }} />
          </div>
          <Select value={vendedor} onChange={(v) => { setVendedor(v); setPagina(1); }} minWidth={170} etiqueta="Vendedor"
            options={[["", "Todos los vendedores"], ...vendedores.map((u): [string, string] => [u.id, u.nombre])]} />
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <SelectorFecha compacto etiqueta="Desde" value={desde} max={hasta || undefined} onChange={(v) => { setDesde(v); setPagina(1); }}
              claseBoton="rounded-xl px-2.5 py-2 text-slate-700" className="min-w-0 flex-1 md:w-[140px] md:flex-none" />
            <span>a</span>
            <SelectorFecha compacto etiqueta="Hasta" value={hasta} min={desde || undefined} onChange={(v) => { setHasta(v); setPagina(1); }}
              claseBoton="rounded-xl px-2.5 py-2 text-slate-700" className="min-w-0 flex-1 md:w-[140px] md:flex-none" />
          </div>
        </BarraFiltros>

        {!d && cargando ? (
          <div className="space-y-3 px-5 py-4">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-4 animate-pulse rounded bg-slate-100" />)}</div>
        ) : error && !d ? (
          <p className="px-5 py-10 text-center text-sm text-rose-600">{error}</p>
        ) : (
          <TablaTarjetas
            filas={d?.rows ?? []}
            claveFila={(r) => r.id}
            onFila={(r) => abrir(r.id)}
            onIntencion={(r) => void precargar(`/api/presupuestos/${r.id}`)}
            cargando={cargando}
            minAncho={880}
            vacio={vacio}
            claseTabla="w-full text-left text-sm"
            claseThead="border-b-2 border-[#4FAEB2]/15 bg-[#4FAEB2]/[0.05]"
            thBase="whitespace-nowrap px-3 py-3 text-[11px] font-bold uppercase tracking-wider text-[#3F8E91] first:pl-5 last:pr-5"
            tdBase="px-3 py-3 first:pl-5 last:pr-5"
            columnas={[
              {
                key: "num", titulo: "Número", claseTd: "whitespace-nowrap", movil: "subtitulo",
                celda: (r) => (
                  <>
                    <Link href={`/presupuestos/${r.id}`}
                      // Clic normal: lo maneja la fila (abre el modal). Ctrl/Cmd/Shift + clic: otra pestaña.
                      onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) { e.stopPropagation(); return; } e.preventDefault(); }}
                      className="font-mono text-xs font-semibold text-slate-800 hover:text-[var(--brand)]">{r.numero}</Link>
                    {r.revision > 1 ? <span className="ml-1.5 rounded bg-slate-100 px-1 py-0.5 text-[10px] font-semibold text-slate-500">rev {r.revision}</span> : null}
                  </>
                ),
                celdaMovil: (r) => <span className="font-mono text-xs">{r.numero}{r.revision > 1 ? ` rev ${r.revision}` : ""} · {diaCorto(r.fecha)}</span>,
              },
              {
                key: "cliente", titulo: "Cliente", claseTd: "max-w-[260px]", movil: "titulo",
                celda: (r) => (
                  <>
                    <p className="truncate font-semibold text-slate-800 max-md:whitespace-normal">{r.cliente_nombre}</p>
                    <p className="truncate text-[11px] font-normal text-slate-400">
                      {r.cliente_id ? (r.cliente_ruc ?? "Cliente") : <span className="font-medium text-amber-600">Prospecto</span>}
                      {!r.cliente_id && r.cliente_ruc ? ` · ${r.cliente_ruc}` : ""}
                    </p>
                  </>
                ),
              },
              { key: "fecha", titulo: "Fecha", claseTd: "whitespace-nowrap text-xs text-slate-600", movil: "oculto", celda: (r) => diaCorto(r.fecha) },
              {
                key: "valido", titulo: "Válido hasta", claseTd: "whitespace-nowrap text-xs", movil: "dato",
                celda: (r) => {
                  const vig = r.estado === "borrador" || r.estado === "enviado" || r.estado === "vencido" ? textoVigencia(r.valido_hasta, hoy) : null;
                  return (
                    <>
                      <span className={r.estado === "vencido" ? "font-semibold text-rose-600" : "text-slate-600"}>{diaCorto(r.valido_hasta)}</span>
                      {vig ? <span className={`block text-[11px] ${r.estado === "vencido" ? "text-rose-500" : vig.tono}`}>{vig.texto}</span> : null}
                    </>
                  );
                },
              },
              { key: "vend", titulo: "Vendedor", claseTd: "max-w-[140px] truncate text-xs text-slate-600", movil: "dato", celda: (r) => r.vendedor_nombre ?? "—" },
              {
                key: "total", titulo: "Total", claseTh: "text-right", claseTd: "whitespace-nowrap text-right", movil: "valor",
                celda: (r) => (
                  <>
                    <span className="font-bold tabular-nums text-slate-900">{monto(r.total, r.moneda)}</span>
                    {r.moneda === "USD" ? <span className="block text-[11px] font-normal tabular-nums text-slate-400">{monto(r.total * r.tipo_cambio)}</span> : null}
                  </>
                ),
              },
              {
                key: "estado", titulo: "Estado", claseTd: "whitespace-nowrap", movil: "chip",
                celda: (r) => (
                  <span className="flex items-center gap-2">
                    <BadgeEstado estado={r.estado} />
                    {r.venta_numero ? <span className="font-mono text-[11px] text-slate-500">{r.venta_numero}</span> : null}
                  </span>
                ),
              },
            ]}
          />
        )}
        {(d?.total ?? 0) > POR_PAGINA ? (
          <div className="flex flex-col gap-2 border-t border-slate-100 px-3 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <span className="text-center sm:text-left">Página {pagina} de {totalPaginas} · {d?.total} presupuestos</span>
            <div className="flex gap-2">
              <button disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40 max-sm:min-h-11 max-sm:flex-1 max-sm:text-sm">Anterior</button>
              <button disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40 max-sm:min-h-11 max-sm:flex-1 max-sm:text-sm">Siguiente</button>
            </div>
          </div>
        ) : null}
      </section>

      {ver ? <PresupuestoModal id={ver} onCerrar={cerrar} onCambio={huboCambio} /> : null}
      {ajustes ? <ModalAjustes onClose={() => setAjustes(false)} onGuardado={() => { setAjustes(false); setAviso("Ajustes guardados."); }} /> : null}
    </div>
  );
}
