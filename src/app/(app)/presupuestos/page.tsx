"use client";

/**
 * /presupuestos — lista de presupuestos. Una consulta paginada en la base
 * (listar_presupuestos) trae la página, los conteos por estado y las cifras de arriba.
 * Búsqueda inteligente (número, cliente, RUC, teléfono, productos), filtros por estado,
 * cliente, vendedor y rango de fechas. Vuelve a la pantalla y pinta al instante lo último
 * que se vio (stale-while-revalidate).
 */
import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, FileSignature, Plus, Search, Settings2, X } from "lucide-react";
import { apiFetchCache, apiFetchSWR, guardadoAlInstante, precargar } from "@/lib/api/cache-cliente";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import { hoyPY } from "@/lib/fecha/paraguay";
import { clienteConfig } from "@/cliente.config";
import { Select } from "@/components/Select";
import { BuscadorCliente } from "@/modules/clientes/gestion/BuscadorCliente";
import { BadgeEstado, textoVigencia } from "@/modules/presupuestos/ui";
import { ModalAjustes } from "@/modules/presupuestos/Modales";
import { diaCorto, monto, type ListaPresupuestos } from "@/modules/presupuestos/tipos";

const TEAL = clienteConfig.color;
const POR_PAGINA = 25;

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

  useEffect(() => {
    const ctrl = new AbortController();
    setCargando(true);
    setError(null);
    apiFetchSWR<ListaPresupuestos>(url, (d) => { ultimo.current = d; setData(d); }, { signal: ctrl.signal })
      .catch((e) => { if (!ctrl.signal.aborted) setError((e as Error).message); })
      .finally(() => { if (!ctrl.signal.aborted) setCargando(false); });
    return () => ctrl.abort();
  }, [url]);

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

  return (
    <div className="space-y-5 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TEAL, boxShadow: `0 0 0 3px ${TEAL}2e` }} />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Comercial</p>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Presupuestos</h1>
          {/* Cifras en una línea: lo abierto, cuánto hay en juego y cuánto se convierte. */}
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
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
          </p>
        </div>
        <div className="flex items-center gap-2">
          {esAdmin ? (
            <button type="button" onClick={() => setAjustes(true)} title="Ajustes de presupuestos"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm hover:border-[var(--brand)] hover:text-[var(--brand)]">
              <Settings2 className="h-4 w-4" /> Ajustes
            </button>
          ) : null}
          <Link href={cliente ? `/presupuestos/nuevo?cliente=${cliente.id}` : "/presupuestos/nuevo"}
            className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-95" style={{ backgroundColor: TEAL }}>
            <Plus className="h-4 w-4" /> Nuevo presupuesto
          </Link>
        </div>
      </header>

      {aviso ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">✓ {aviso}</p> : null}

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        {/* Estados con su conteo */}
        <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-3 pt-2">
          {FILTROS.map((f) => {
            const sel = estado === f.id;
            const n = d?.conteos?.[f.clave];
            return (
              <button key={f.id || "todos"} type="button" onClick={() => { setEstado(f.id); setPagina(1); }}
                className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${sel ? "text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700"}`}
                style={sel ? { borderColor: TEAL } : undefined}>
                {f.texto}
                {n != null ? <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${sel ? "bg-[var(--brand-50)] text-[var(--brand)]" : "bg-slate-100 text-slate-500"}`}>{n}</span> : null}
              </button>
            );
          })}
        </div>

        {/* Búsqueda y filtros */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
          <div className="relative min-w-[220px] flex-[2]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={borrador} onChange={(e) => setBorrador(e.target.value)} placeholder="Buscar por número, cliente, RUC, teléfono o producto…"
              className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]" />
          </div>
          <div className="min-w-[200px] flex-1">
            <BuscadorCliente variant="toolbar" seleccionado={cliente?.nombre ?? null}
              onSelect={(c) => { setCliente({ id: c.id, nombre: c.nombre }); setPagina(1); }}
              onClear={() => { setCliente(null); setPagina(1); if (clienteUrl) router.replace("/presupuestos"); }} />
          </div>
          <Select value={vendedor} onChange={(v) => { setVendedor(v); setPagina(1); }} minWidth={170}
            options={[["", "Todos los vendedores"], ...vendedores.map((u): [string, string] => [u.id, u.nombre])]} />
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <input type="date" value={desde} max={hasta || undefined} onChange={(e) => { setDesde(e.target.value); setPagina(1); }} aria-label="Desde"
              className="rounded-xl border border-slate-200 px-2.5 py-2 text-sm text-slate-700 outline-none focus:border-[var(--brand)]" />
            <span>a</span>
            <input type="date" value={hasta} min={desde || undefined} onChange={(e) => { setHasta(e.target.value); setPagina(1); }} aria-label="Hasta"
              className="rounded-xl border border-slate-200 px-2.5 py-2 text-sm text-slate-700 outline-none focus:border-[var(--brand)]" />
          </div>
          {hayFiltros ? (
            <button type="button" onClick={limpiarFiltros} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50 hover:text-slate-800">
              <X className="h-3.5 w-3.5" /> Limpiar
            </button>
          ) : null}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead>
              <tr className="border-b-2 text-[11px] font-bold uppercase tracking-wider" style={{ borderColor: `${TEAL}26`, backgroundColor: `${TEAL}0d`, color: TEAL }}>
                <th className="px-5 py-3">Número</th>
                <th className="px-3 py-3">Cliente</th>
                <th className="px-3 py-3">Fecha</th>
                <th className="px-3 py-3">Válido hasta</th>
                <th className="px-3 py-3">Vendedor</th>
                <th className="px-3 py-3 text-right">Total</th>
                <th className="px-5 py-3">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!d && cargando ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}><td colSpan={7} className="px-5 py-3.5"><div className="h-4 animate-pulse rounded bg-slate-100" /></td></tr>
                ))
              ) : error && !d ? (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-rose-600">{error}</td></tr>
              ) : !d?.rows.length ? (
                <tr>
                  <td colSpan={7} className="px-5 py-16 text-center">
                    <FileSignature className="mx-auto h-8 w-8 text-slate-300" />
                    <p className="mt-3 text-sm font-medium text-slate-700">
                      {hayFiltros ? "Ningún presupuesto coincide con la búsqueda" : estado === "abiertos" ? "No hay presupuestos abiertos" : "No hay presupuestos en este estado"}
                    </p>
                    {!hayFiltros ? (
                      <Link href="/presupuestos/nuevo" className="mt-4 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white" style={{ backgroundColor: TEAL }}>
                        <Plus className="h-4 w-4" /> Nuevo presupuesto
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ) : (
                d.rows.map((r) => {
                  const vig = r.estado === "borrador" || r.estado === "enviado" || r.estado === "vencido" ? textoVigencia(r.valido_hasta, hoy) : null;
                  return (
                    <tr key={r.id} onClick={() => router.push(`/presupuestos/${r.id}`)} onMouseEnter={() => void precargar(`/api/presupuestos/${r.id}`)}
                      className={`cursor-pointer transition-colors hover:bg-[var(--brand-50)] ${cargando ? "opacity-70" : ""}`}>
                      <td className="whitespace-nowrap px-5 py-3">
                        <Link href={`/presupuestos/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-xs font-semibold text-slate-800 hover:text-[var(--brand)]">{r.numero}</Link>
                        {r.revision > 1 ? <span className="ml-1.5 rounded bg-slate-100 px-1 py-0.5 text-[10px] font-semibold text-slate-500">rev {r.revision}</span> : null}
                      </td>
                      <td className="max-w-[260px] px-3 py-3">
                        <p className="truncate font-semibold text-slate-800">{r.cliente_nombre}</p>
                        <p className="truncate text-[11px] text-slate-400">
                          {r.cliente_id ? (r.cliente_ruc ?? "Cliente") : <span className="font-medium text-amber-600">Prospecto</span>}
                          {!r.cliente_id && r.cliente_ruc ? ` · ${r.cliente_ruc}` : ""}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-600">{diaCorto(r.fecha)}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs">
                        <span className={r.estado === "vencido" ? "font-semibold text-rose-600" : "text-slate-600"}>{diaCorto(r.valido_hasta)}</span>
                        {vig && r.estado !== "vencido" ? <span className={`block text-[11px] ${vig.tono}`}>{vig.texto}</span> : null}
                        {r.estado === "vencido" && vig ? <span className="block text-[11px] text-rose-500">{vig.texto}</span> : null}
                      </td>
                      <td className="max-w-[140px] truncate px-3 py-3 text-xs text-slate-600">{r.vendedor_nombre ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right">
                        <span className="font-bold tabular-nums text-slate-900">{monto(r.total, r.moneda)}</span>
                        {r.moneda === "USD" ? <span className="block text-[11px] tabular-nums text-slate-400">{monto(r.total * r.tipo_cambio)}</span> : null}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3">
                        <div className="flex items-center gap-2">
                          <BadgeEstado estado={r.estado} />
                          {r.venta_numero ? <span className="font-mono text-[11px] text-slate-500">{r.venta_numero}</span> : null}
                          {r.vistas > 0 && (r.estado === "enviado" || r.estado === "vencido") ? (
                            <span title={`El cliente lo abrió ${r.vistas} ${r.vistas === 1 ? "vez" : "veces"}`} className="inline-flex items-center gap-0.5 text-[11px] text-slate-400">
                              <Eye className="h-3.5 w-3.5" />{r.vistas}
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {(d?.total ?? 0) > POR_PAGINA ? (
          <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
            <span>Página {pagina} de {totalPaginas} · {d?.total} presupuestos</span>
            <div className="flex gap-2">
              <button disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40">Anterior</button>
              <button disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40">Siguiente</button>
            </div>
          </div>
        ) : null}
      </section>

      {ajustes ? <ModalAjustes onClose={() => setAjustes(false)} onGuardado={() => { setAjustes(false); setAviso("Ajustes guardados."); }} /> : null}
    </div>
  );
}
