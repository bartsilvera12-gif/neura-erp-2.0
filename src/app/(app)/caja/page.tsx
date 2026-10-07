"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  Banknote,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  Landmark,
  Lock,
  Plus,
  Search,
  SlidersHorizontal,
  Wallet,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { clienteConfig } from "@/cliente.config";
import { Modal } from "@/components/Modal";
import { Select } from "@/components/Select";
import { VentaDetalle } from "@/modules/caja/VentaDetalle";
import { formatGs } from "@/modules/caja/lib";

const TEAL = clienteConfig.color;

type Caja = { id: string; numero_caja: number; fecha_apertura: string; monto_apertura: number };
type PorMedio = { medio: string; label: string; cantidad: number; total: number };
type Arqueo = {
  monto_apertura: number;
  ingresos: { total: number; por_medio: PorMedio[] };
  efectivo_esperado: number;
};
type VentaItem = { producto_nombre: string; sku?: string | null; cantidad: number; tipo_iva: string };
type Venta = {
  id: string;
  numero_control: string;
  fecha: string;
  total: number;
  tipo_venta: string;
  estado: string;
  ventas_items: VentaItem[];
};

const fechaLarga = (iso: string) =>
  new Date(iso).toLocaleString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const medioTotal = (a: Arqueo | null, m: string) => a?.ingresos.por_medio.find((p) => p.medio === m)?.total ?? 0;

export default function CajaDashboard() {
  const [caja, setCaja] = useState<Caja | null>(null);
  const [arqueo, setArqueo] = useState<Arqueo | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    try {
      const r = await apiFetch<{ caja: Caja | null }>("/api/caja");
      setCaja(r.caja);
      if (r.caja) {
        const a = await apiFetch<{ arqueo: Arqueo | null }>("/api/caja/cierre");
        setArqueo(a.arqueo);
      } else {
        setArqueo(null);
      }
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div className="space-y-6 pb-10">
      {/* Encabezado estilo dashboard */}
      <div>
        <div className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TEAL, boxShadow: `0 0 0 3px ${TEAL}2e` }} />
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Comercial</p>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Caja</h1>
        <p className="mt-1 text-sm text-slate-500">Caja de ventas y despacho de productos</p>
      </div>

      {/* Estado de la caja */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-900">
          <Wallet className="h-4 w-4" style={{ color: TEAL }} /> Caja abierta
        </h2>
        {cargando ? (
          <div className="h-32 animate-pulse rounded-2xl border border-slate-200 bg-white" />
        ) : caja ? (
          <TarjetaCaja caja={caja} arqueo={arqueo} onCambio={cargar} />
        ) : (
          <Apertura onAbierta={cargar} />
        )}
      </section>

      {/* Órdenes de venta */}
      <Ordenes caja={caja} />
    </div>
  );
}

// ── Tarjeta de caja abierta + KPIs ──────────────────────────────────────────
function TarjetaCaja({ caja, arqueo, onCambio }: { caja: Caja; arqueo: Arqueo | null; onCambio: () => void }) {
  const [mov, setMov] = useState(false);
  const apertura = arqueo?.monto_apertura ?? caja.monto_apertura;
  const ventas = arqueo?.ingresos.por_medio.reduce((s, m) => s + m.cantidad, 0) ?? 0;
  const esperado = arqueo?.efectivo_esperado ?? apertura;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `${TEAL}1f`, color: TEAL }}>
            <Wallet className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-slate-900">Caja {caja.numero_caja}</h3>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Abierta
              </span>
            </div>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
              <Clock className="h-3 w-3" /> Abierta el {fechaLarga(caja.fecha_apertura)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setMov(true)} className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50">
            <Plus className="h-4 w-4" /> Movimiento
          </button>
          <Link href="/caja/cierre" className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-red-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-700">
            <Lock className="h-4 w-4" /> Cerrar
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 border-t border-slate-100 sm:grid-cols-3 sm:divide-y-0 xl:grid-cols-6">
        <Cifra label="Apertura" valor={formatGs(apertura)} icono={Wallet} />
        <Cifra label="Ventas" valor={String(ventas)} icono={Check} />
        <Cifra label="Efectivo" valor={formatGs(medioTotal(arqueo, "efectivo"))} icono={ArrowDownLeft} />
        <Cifra label="Transfer" valor={formatGs(medioTotal(arqueo, "transferencia"))} icono={Landmark} />
        <Cifra label="Tarjeta" valor={formatGs(medioTotal(arqueo, "tarjeta"))} icono={CreditCard} />
        <Cifra label="Esperado efectivo" valor={formatGs(esperado)} icono={Wallet} destacado />
      </div>

      {mov ? <MovimientoModal onClose={() => setMov(false)} onListo={() => { setMov(false); onCambio(); }} /> : null}
    </div>
  );
}

function Cifra({ label, valor, icono: Icono, destacado }: { label: string; valor: string; icono: React.ComponentType<{ className?: string }>; destacado?: boolean }) {
  return (
    <div className="min-w-0 px-4 py-3.5" style={destacado ? { backgroundColor: `${TEAL}14` } : undefined}>
      <p className="flex items-start gap-1.5 text-[10px] font-semibold uppercase leading-tight tracking-[0.08em] text-slate-500">
        <Icono className="mt-px h-3 w-3 shrink-0" /> <span>{label}</span>
      </p>
      <p className="mt-1 whitespace-nowrap text-lg font-bold tabular-nums tracking-tight" style={destacado ? { color: TEAL } : { color: "#0f172a" }}>{valor}</p>
    </div>
  );
}

// ── Apertura ────────────────────────────────────────────────────────────────
function Apertura({ onAbierta }: { onAbierta: () => void }) {
  const [monto, setMonto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function abrir() {
    setGuardando(true); setError(null);
    try {
      await apiFetch("/api/caja", { method: "POST", body: JSON.stringify({ monto_apertura: Number(monto) || 0 }) });
      onAbierta();
    } catch (e) { setError((e as Error).message); setGuardando(false); }
  }
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-8">
      <div className="mx-auto max-w-sm text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full" style={{ backgroundColor: `${TEAL}1a` }}>
          <Banknote className="h-7 w-7" style={{ color: TEAL }} />
        </div>
        <h3 className="mt-4 text-lg font-bold text-slate-900">Abrir caja</h3>
        <p className="mt-1 text-sm text-slate-500">Contá el efectivo con el que arrancás. Es la base contra la que cuadra el arqueo.</p>
        <label className="mt-6 block text-left">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-400">Monto de apertura</span>
          <input autoFocus inputMode="numeric" value={monto} onChange={(e) => setMonto(e.target.value.replace(/\D/g, ""))} placeholder="0"
            className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-right text-lg font-semibold tabular-nums outline-none focus:ring-2" style={{ ["--tw-ring-color" as string]: TEAL }} />
        </label>
        {error ? <p className="mt-3 rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
        <button onClick={abrir} disabled={guardando} className="mt-5 w-full rounded-xl py-3 text-sm font-semibold text-white transition-opacity disabled:opacity-40" style={{ backgroundColor: TEAL }}>
          {guardando ? "Abriendo…" : "Abrir caja"}
        </button>
      </div>
    </div>
  );
}

// ── Modal movimiento ──────────────────────────────────────────────────────────
const TIPOS = [
  { v: "ingreso", l: "Ingreso" },
  { v: "egreso", l: "Egreso" },
  { v: "retiro", l: "Retiro" },
  { v: "ajuste", l: "Ajuste" },
] as const;

function MovimientoModal({ onClose, onListo }: { onClose: () => void; onListo: () => void }) {
  const [tipo, setTipo] = useState<(typeof TIPOS)[number]["v"]>("ingreso");
  const [concepto, setConcepto] = useState("");
  const [monto, setMonto] = useState("");
  const [medio, setMedio] = useState("efectivo");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const puede = concepto.trim() !== "" && Number(monto) > 0;

  async function guardar() {
    if (!puede || busy) return;
    setBusy(true); setError(null);
    try {
      await apiFetch("/api/caja/movimientos", {
        method: "POST",
        body: JSON.stringify({ tipo, concepto: concepto.trim(), monto: Number(monto), medio_pago: medio }),
      });
      onListo();
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  const CAMPO = "h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-100)]";
  const ET = "mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500";

  return (
    <Modal titulo="Registrar movimiento" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <span className={ET}>Tipo</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {TIPOS.map((t) => (
              <button key={t.v} type="button" onClick={() => setTipo(t.v)}
                className="h-11 rounded-lg border text-sm font-semibold transition-colors"
                style={tipo === t.v ? { borderColor: "transparent", backgroundColor: TEAL, color: "#fff" } : { borderColor: "#e2e8f0", color: "#475569" }}>
                {t.l}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className={ET}>Concepto</span>
          <input value={concepto} onChange={(e) => { setError(null); setConcepto(e.target.value); }} placeholder="Ej: Pago de delivery, vuelto…" className={CAMPO} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={ET}>Monto (Gs.)</span>
            <input inputMode="numeric" value={monto ? Number(monto).toLocaleString("es-PY") : ""} onChange={(e) => setMonto(e.target.value.replace(/\D/g, ""))} placeholder="0" className={`${CAMPO} tabular-nums`} />
          </label>
          <label className="block">
            <span className={ET}>Medio de pago</span>
            <Select
              value={medio}
              onChange={setMedio}
              block
              options={[["efectivo", "Efectivo"], ["transferencia", "Transferencia"], ["tarjeta", "Tarjeta"], ["cheque", "Cheque"], ["otro", "Otro"]]}
            />
          </label>
        </div>
        {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="h-11 rounded-lg px-4 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancelar</button>
          <button onClick={guardar} disabled={!puede || busy} className="h-11 rounded-lg px-6 text-sm font-semibold text-white transition-opacity disabled:opacity-40" style={{ backgroundColor: TEAL }}>
            {busy ? "Guardando…" : "Registrar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Órdenes de venta ──────────────────────────────────────────────────────────
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

function Ordenes({ caja }: { caja: Caja | null }) {
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [tipo, setTipo] = useState("");
  const [iva, setIva] = useState("");
  const [estado, setEstado] = useState("");
  const [producto, setProducto] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const [viendo, setViendo] = useState<string | null>(null);
  // Paginado de la tabla.
  const [porPagina, setPorPagina] = useState(25);
  const [pagina, setPagina] = useState(1);

  const cargar = useCallback(() => {
    const url = caja ? `/api/ventas?caja=${caja.id}` : "/api/ventas";
    apiFetch<Venta[]>(url).then(setVentas).catch(() => setVentas([]));
  }, [caja]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const filtrosActivos = (tipo ? 1 : 0) + (iva ? 1 : 0) + (estado ? 1 : 0) + (producto ? 1 : 0) + (desde ? 1 : 0) + (hasta ? 1 : 0);

  // Productos distintos presentes en las ventas cargadas (para el filtro por producto).
  const productosOpts = useMemo<[string, string][]>(() => {
    const set = new Set<string>();
    ventas.forEach((v) => (v.ventas_items ?? []).forEach((i) => i.producto_nombre && set.add(i.producto_nombre)));
    return [["", "Todos los productos"], ...[...set].sort().map((n) => [n, n] as [string, string])];
  }, [ventas]);

  const filtradas = useMemo(() => {
    // Búsqueda inteligente: por tokens, contra CUALQUIER dato de la venta y sus
    // ítems, sin importar el orden en que se tipee (cada palabra debe aparecer).
    const terms = norm(busqueda).split(/\s+/).filter(Boolean);
    const d0 = desde ? new Date(`${desde}T00:00:00`) : null;
    const d1 = hasta ? new Date(`${hasta}T23:59:59`) : null;
    return ventas.filter((v) => {
      if (tipo && v.tipo_venta !== tipo) return false;
      if (estado && v.estado !== estado) return false;
      const items = v.ventas_items ?? [];
      if (iva && !items.some((i) => i.tipo_iva === iva)) return false;
      if (producto && !items.some((i) => i.producto_nombre === producto)) return false;
      const f = new Date(v.fecha);
      if (d0 && f < d0) return false;
      if (d1 && f > d1) return false;
      if (!terms.length) return true;
      const hay = norm(
        [
          v.numero_control,
          v.tipo_venta === "CREDITO" ? "credito crédito" : "contado",
          v.estado,
          String(v.total),
          v.total.toLocaleString("es-PY"),
          new Date(v.fecha).toLocaleDateString("es-PY"),
          ...items.flatMap((i) => [i.producto_nombre, i.sku ?? "", i.tipo_iva, "iva " + i.tipo_iva, String(i.cantidad)]),
        ].join(" "),
      );
      return terms.every((t) => hay.includes(t));
    });
  }, [ventas, busqueda, tipo, iva, estado, producto, desde, hasta]);

  // Si cambia lo que se filtra o el tamaño de página, volver a la primera.
  useEffect(() => { setPagina(1); }, [busqueda, tipo, iva, estado, producto, desde, hasta, porPagina]);

  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / porPagina));
  const paginaActual = Math.min(pagina, totalPaginas);
  const inicio = (paginaActual - 1) * porPagina;
  const visibles = filtradas.slice(inicio, inicio + porPagina);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="block h-5 w-1 rounded-full" style={{ backgroundColor: TEAL }} />
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">Órdenes de venta</h2>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/caja/cierre" className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50">Arqueo de caja</Link>
          <Link href="/caja/nueva" className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:brightness-95" style={{ backgroundColor: TEAL }}>+ Nueva venta</Link>
        </div>
      </div>

      <div className="mb-5 border-b border-slate-100 pb-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative w-full min-w-56 flex-1 sm:max-w-md">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar número, producto, SKU, monto…"
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-11 pr-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]"
            />
          </div>
          <button
            type="button"
            onClick={() => setFiltrosAbiertos((v) => !v)}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors"
            style={filtrosActivos || filtrosAbiertos ? { borderColor: TEAL, color: TEAL, backgroundColor: "var(--brand-50)" } : { borderColor: "#e2e8f0", color: "#475569" }}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filtros
            {filtrosActivos ? (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold text-white" style={{ backgroundColor: TEAL }}>{filtrosActivos}</span>
            ) : null}
          </button>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Filas</span>
            <Select value={String(porPagina)} onChange={(v) => setPorPagina(Number(v))} options={[["25", "25"], ["50", "50"], ["100", "100"]]} minWidth={84} />
          </div>
          <span className="ml-auto text-sm text-slate-400">{filtradas.length} de {ventas.length} ventas</span>
        </div>

        {filtrosAbiertos ? (
          <div className="mt-3 flex flex-wrap items-end gap-2.5 rounded-xl bg-slate-50 p-3" style={{ animation: "rb-pop 0.15s cubic-bezier(0.16,1,0.3,1)" }}>
            <Select value={tipo} onChange={setTipo} options={[["", "Todos los tipos"], ["CONTADO", "Contado"], ["CREDITO", "Crédito"]]} minWidth={150} />
            <Select value={iva} onChange={setIva} options={[["", "Todos los IVA"], ["10%", "IVA 10%"], ["5%", "IVA 5%"], ["EXENTA", "Exenta"]]} minWidth={140} />
            <Select value={estado} onChange={setEstado} options={[["", "Todos los estados"], ["completada", "Completada"], ["anulada", "Anulada"]]} minWidth={160} />
            <Select value={producto} onChange={setProducto} options={productosOpts} minWidth={190} />
            <label className="flex flex-col gap-1">
              <span className="px-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Desde</span>
              <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="px-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Hasta</span>
              <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]" />
            </label>
            {filtrosActivos ? (
              <button
                type="button"
                onClick={() => { setTipo(""); setIva(""); setEstado(""); setProducto(""); setDesde(""); setHasta(""); }}
                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-slate-500 transition-colors hover:text-rose-600"
              >
                <X className="h-3.5 w-3.5" /> Limpiar
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="bg-slate-50 text-xs font-semibold text-slate-500">
              <th className="rounded-l-lg px-4 py-3">Número</th>
              <th className="px-4 py-3">Productos</th>
              <th className="px-4 py-3 text-center">Ítems</th>
              <th className="px-4 py-3 text-right">Cant. total</th>
              <th className="px-4 py-3">IVA</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="rounded-r-lg px-4 py-3">Fecha</th>
            </tr>
          </thead>
          <tbody>
            {filtradas.length === 0 ? (
              <tr><td colSpan={8} className="py-12 text-center text-slate-400">{ventas.length === 0 ? "No hay ventas registradas" : "Ninguna venta coincide con los filtros"}</td></tr>
            ) : (
              visibles.map((v) => {
                const items = v.ventas_items ?? [];
                const cantTotal = items.reduce((s, i) => s + Number(i.cantidad), 0);
                const ivas = [...new Set(items.map((i) => i.tipo_iva))];
                const primero = items[0];
                const anulada = v.estado === "anulada";
                return (
                  <tr
                    key={v.id}
                    onClick={() => setViendo(v.id)}
                    title="Ver el detalle de la venta"
                    className={`cursor-pointer border-b border-slate-100 last:border-0 transition-colors hover:bg-slate-50 ${anulada ? "opacity-50" : ""}`}
                  >
                    <td className="px-4 py-4 font-mono text-xs text-slate-500">{v.numero_control}</td>
                    <td className="px-4 py-4">
                      <span className="block truncate text-slate-800">{primero?.producto_nombre ?? "—"}</span>
                      <span className="text-xs text-slate-400">
                        {primero?.sku ?? ""}{items.length > 1 ? `${primero?.sku ? " · " : ""}+${items.length - 1} más` : ""}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-center">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{items.length}</span>
                    </td>
                    <td className="px-4 py-4 text-right tabular-nums text-slate-700">{cantTotal}</td>
                    <td className="px-4 py-4"><span className="rounded-full bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700">{ivas.length === 1 ? `IVA ${ivas[0]}` : "Varios"}</span></td>
                    <td className="px-4 py-4 text-right font-semibold tabular-nums text-slate-800">{formatGs(v.total)}</td>
                    <td className="px-4 py-4">
                      <span className="rounded-full px-2 py-1 text-xs font-semibold" style={v.tipo_venta === "CREDITO" ? { backgroundColor: "#fff7ed", color: "#ea580c" } : { backgroundColor: "#f1f5f9", color: "#475569" }}>
                        {v.tipo_venta === "CREDITO" ? "Crédito" : "Contado"}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-xs tabular-nums text-slate-500">{new Date(v.fecha).toLocaleString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Paginado */}
      {filtradas.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <span className="text-sm text-slate-500">
            Mostrando <strong className="font-semibold text-slate-700">{inicio + 1}–{Math.min(inicio + porPagina, filtradas.length)}</strong> de{" "}
            <strong className="font-semibold text-slate-700">{filtradas.length}</strong>
          </span>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPagina((p) => Math.max(1, p - 1))}
                disabled={paginaActual <= 1}
                aria-label="Página anterior"
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-[110px] text-center text-sm tabular-nums text-slate-600">
                Página <strong className="font-semibold text-slate-800">{paginaActual}</strong> de {totalPaginas}
              </span>
              <button
                type="button"
                onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
                disabled={paginaActual >= totalPaginas}
                aria-label="Página siguiente"
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {viendo ? (
        <VentaDetalle ventaId={viendo} onClose={() => setViendo(null)} onAnulada={() => { setViendo(null); cargar(); }} />
      ) : null}
    </section>
  );
}

