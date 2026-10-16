"use client";

/**
 * /inventario/vencimientos — lotes vencidos y por vencer en los próximos N días
 * (7 / 15 / 30 / 60; se recuerda en esta computadora, por defecto 30). Lista sin
 * gráficos: producto, lote, vence, días, unidades y valor al costo; filtros de búsqueda
 * y estado; Exportar Excel. Arriba, una franja de cifras en una línea. Desde cada fila
 * (ADMIN) se puede dar de baja el lote (queda como pérdida PE-). Sin productos con lotes:
 * estado vacío explicativo. Cada lote vive en un depósito: filtro y columna de depósito.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Download, Loader2, Search, X } from "lucide-react";
import { invalidarLista, useListaCacheada } from "@/modules/inventario/lista-cache";
import { descargarArchivo } from "@/lib/api/client-blob";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import { clienteConfig } from "@/cliente.config";
import { Select } from "@/components/Select";
import { AccionesPagina, BarraFiltros, EncabezadoPagina, GrillaKpis } from "@/components/EncabezadoPagina";
import { TablaTarjetas, type ColumnaTabla } from "@/components/TablaResponsive";
import { DarDeBajaLote } from "@/modules/inventario/LotesProducto";
import { hayVariosDepositos, opcionesDepositos, useDepositos } from "@/modules/inventario/depositos";
import {
  OPCIONES_DIAS, diasAlerta, fechaCorta, guardarDiasAlerta, textoDias,
  type FilaVencimiento, type ReporteVencimientos,
} from "@/modules/inventario/vencimientos";

const TEAL = clienteConfig.color;
const gs = (v: number) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
const cant = (n: number) => Number(n).toLocaleString("es-PY", { maximumFractionDigits: 3 });

export default function VencimientosPage() {
  const esAdmin = useUsuario()?.rol === "ADMIN";
  const [dias, setDias] = useState<number | null>(null); // null hasta leer la preferencia
  const [busqueda, setBusqueda] = useState("");
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState("");
  const [deposito, setDeposito] = useState("");
  const deps = useDepositos();
  const variosDepositos = hayVariosDepositos(deps.datos);
  const [exportando, setExportando] = useState(false);
  const [recarga, setRecarga] = useState(0);
  const [baja, setBaja] = useState<FilaVencimiento | null>(null);

  useEffect(() => setDias(diasAlerta()), []);
  // Debounce de la búsqueda; no dispara si el texto no cambió (al montar).
  useEffect(() => {
    const texto = busqueda.trim();
    if (texto === q) return;
    const t = setTimeout(() => setQ(texto), 300);
    return () => clearTimeout(t);
  }, [busqueda, q]);

  const filtros = useMemo(() => {
    const sp = new URLSearchParams({ dias: String(dias ?? 30) });
    if (q) sp.set("q", q);
    if (estado) sp.set("estado", estado);
    if (deposito) sp.set("deposito", deposito);
    return sp;
  }, [dias, q, estado, deposito]);

  // Un request por combinación de filtros, cacheado (volver a la pantalla pinta al
  // instante y se refresca en segundo plano); mientras llega, queda la lista anterior.
  const lista = useListaCacheada<ReporteVencimientos>(dias == null ? null : `/api/inventario/vencimientos?${filtros}`, recarga);
  const { datos, error } = lista;
  const cargando = lista.cargando || dias == null;

  function cambiarDias(v: string) {
    const n = Number(v);
    setDias(n);
    guardarDiasAlerta(n);
  }

  async function exportar() {
    setExportando(true);
    try {
      await descargarArchivo(`/api/inventario/vencimientos/export?${filtros}`, "vencimientos.xlsx");
    } catch {
      /* best-effort */
    } finally {
      setExportando(false);
    }
  }

  const t = datos?.totales;
  const items = useMemo(() => datos?.items ?? [], [datos]);
  const sinLotes = datos && !datos.hay_productos_con_lotes;
  // Columnas: en celular cada lote es una tarjeta (producto, días como chip, valor, lote,
  // depósito, vence, unidades; "Dar de baja" al pie). Desde tablet, la tabla de siempre.
  const columnas = useMemo<ColumnaTabla<FilaVencimiento>[]>(() => {
    const cols: ColumnaTabla<FilaVencimiento>[] = [
      {
        key: "producto", titulo: "Producto", movil: "titulo", claseTh: "!pl-5", claseTd: "!pl-5",
        celda: (f) => (
          <>
            <p className="font-semibold text-slate-900">{f.producto}</p>
            <p className="font-mono text-[11px] font-normal text-slate-500">{f.sku}</p>
          </>
        ),
      },
      { key: "lote", titulo: "Lote", movil: "dato", claseTd: "font-mono text-xs font-semibold text-slate-700", celda: (f) => f.numero },
      {
        key: "deposito", titulo: "Depósito", movil: "dato", claseTd: "text-xs",
        celda: (f) => (
          <>
            <p className="font-medium text-slate-700">{f.deposito ?? "—"}</p>
            {variosDepositos && f.sucursal ? <p className="text-[11px] text-slate-400">{f.sucursal}</p> : null}
          </>
        ),
      },
      { key: "vence", titulo: "Vence", movil: "dato", claseTd: "whitespace-nowrap text-slate-700", celda: (f) => fechaCorta(f.vencimiento) },
      {
        key: "dias", titulo: "Días", movil: "chip", claseTd: "whitespace-nowrap",
        celda: (f) => {
          const vencido = f.estado === "vencido";
          return (
            <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${vencido ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200" : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"}`}>
              {vencido ? `Vencido ${textoDias(f.dias)}` : `Vence ${textoDias(f.dias)}`}
            </span>
          );
        },
      },
      {
        key: "unidades", titulo: "Unidades", movil: "dato", claseTh: "text-right", claseTd: "whitespace-nowrap text-right font-semibold tabular-nums text-slate-900 max-md:text-left",
        celda: (f) => <>{cant(f.cantidad)} <span className="text-[10px] font-normal text-slate-400">{f.unidad_medida === "Unidad" ? "u." : f.unidad_medida}</span></>,
      },
      { key: "valor", titulo: "Valor al costo", movil: "valor", claseTh: "text-right", claseTd: "whitespace-nowrap text-right tabular-nums text-slate-700", celda: (f) => gs(f.valor) },
    ];
    if (esAdmin) {
      cols.push({
        key: "acciones", titulo: "", movil: "acciones", claseTh: "w-px", claseTd: "!pr-5 text-right",
        celda: (f) => (
          <button onClick={() => setBaja(f)} className="whitespace-nowrap rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 max-md:px-3.5 max-md:text-[13px] max-md:active:bg-rose-50">
            Dar de baja
          </button>
        ),
      });
    }
    return cols;
  }, [esAdmin, variosDepositos]);
  const hayFiltros = !!(busqueda || estado || deposito);
  const input = "h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)] md:h-10";

  const vacio = (
    <div className="px-5 py-14 text-center">
      {cargando && !datos ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" />
      : error ? <p className="text-sm text-rose-600">No se pudieron cargar los vencimientos. Probá de nuevo.</p>
      : sinLotes ? (
        <>
          <CalendarClock className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm font-medium text-slate-700">Todavía no hay productos con lotes</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
            Para perecibles (alimentos, medicamentos, veterinaria), abrí el producto en <Link href="/inventario" className="font-semibold text-[var(--brand)] hover:underline">Inventario</Link> y
            activá <strong>Controla lotes y vencimiento</strong>. Desde ahí cada compra pide lote y vencimiento, la caja vende primero el que vence antes y acá vas a ver lo que vence.
          </p>
        </>
      ) : (
        <>
          <CalendarClock className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm font-medium text-slate-700">{hayFiltros ? "Ningún lote coincide con los filtros" : `Nada vencido ni por vencer en los próximos ${dias} días`}</p>
          <p className="mt-1 text-xs text-slate-500">{hayFiltros ? "Probá con otra búsqueda o cambiá el estado." : "Probá con un rango de días más largo."}</p>
        </>
      )}
    </div>
  );

  return (
    <div className="space-y-5 pb-10 sm:space-y-6">
      <EncabezadoPagina
        volver={{ href: "/inventario", label: "Inventario" }}
        kicker="Inventario · Lotes"
        titulo="Vencimientos"
        subtitulo="Lotes vencidos y los que vencen pronto, por depósito, para venderlos o darlos de baja a tiempo"
        acciones={
          <AccionesPagina acciones={[
            { etiqueta: exportando ? "Generando..." : "Exportar Excel", icono: <Download />, onClick: exportar, cargando: exportando, deshabilitada: items.length === 0 },
          ]} />
        }
      />

      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: `${TEAL}33` }}>
        {/* Cifras: vencidos y por vencer (2 columnas también en celular). */}
        <div className="border-b px-3 py-3 sm:px-5" style={{ borderColor: `${TEAL}22`, background: `linear-gradient(to right, ${TEAL}0d, transparent)` }}>
          <GrillaKpis columnas={2} className="lg:max-w-2xl">
            <div className="min-w-0 rounded-xl border border-rose-100 bg-white px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-rose-500" /> Vencidos
              </p>
              <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-rose-700">{t ? cant(t.vencidos_unidades) : "—"} unid.</p>
              <p className="text-xs tabular-nums text-slate-600 [overflow-wrap:anywhere]">{t ? gs(t.vencidos_valor) : "—"}</p>
            </div>
            <div className="min-w-0 rounded-xl border border-amber-100 bg-white px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-amber-500" /> Vencen en {dias ?? 30} días
              </p>
              <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-amber-700">{t ? cant(t.por_vencer_unidades) : "—"} unid.</p>
              <p className="text-xs tabular-nums text-slate-600 [overflow-wrap:anywhere]">{t ? gs(t.por_vencer_valor) : "—"}</p>
            </div>
          </GrillaKpis>
          <p className="mt-2 text-[11px] text-slate-400">Valor al costo de cada lote</p>
        </div>

        {/* Filtros: búsqueda siempre visible; depósito, estado y días en "Filtros" en celular. */}
        <div className="border-b border-slate-100 bg-slate-50/40 px-3 py-3 sm:px-5 sm:py-4">
          <BarraFiltros
            plano
            activos={(estado ? 1 : 0) + (deposito ? 1 : 0)}
            onLimpiar={() => { setBusqueda(""); setEstado(""); setDeposito(""); }}
            busqueda={
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input type="search" enterKeyHint="search" aria-label="Buscar lotes" placeholder="Buscar por producto, SKU o lote..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} className={`${input} w-full pl-9 pr-10`} />
                {busqueda ? (
                  <button onClick={() => setBusqueda("")} aria-label="Limpiar búsqueda" className="absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            }
          >
            {variosDepositos ? (
              <Select value={deposito} onChange={setDeposito} minWidth={200} etiqueta="Depósito" options={[["", "Todos los depósitos"], ...opcionesDepositos(deps.datos, { soloActivos: false })]} />
            ) : null}
            <Select value={estado} onChange={setEstado} minWidth={190} etiqueta="Estado" options={[["", "Vencidos y por vencer"], ["vencido", "Solo vencidos"], ["por_vencer", "Solo por vencer"]]} />
            <Select value={String(dias ?? 30)} onChange={cambiarDias} minWidth={160} etiqueta="Rango de días" options={OPCIONES_DIAS.map((n): [string, string] => [String(n), `Próximos ${n} días`])} />
          </BarraFiltros>
        </div>

        {/* Lista: tarjetas en celular, tabla desde tablet. */}
        {(cargando && !datos) || error || sinLotes ? vacio : (
          <TablaTarjetas
            filas={items}
            columnas={columnas}
            claveFila={(f) => f.lote_id}
            cargando={cargando}
            minAncho={820}
            vacio={vacio}
            claseTabla="w-full text-left text-sm"
            claseThead="bg-slate-50/70"
            thBase="whitespace-nowrap px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500"
            tdBase="px-3 py-3"
            claseFila={() => "hover:bg-[var(--brand-50)]"}
          />
        )}
        {items.length ? (
          <p className="border-t border-slate-100 px-3 py-2.5 text-[11px] text-slate-500 sm:px-5">
            {items.length} {items.length === 1 ? "lote" : "lotes"}. La caja no vende los vencidos: dalos de baja (o devolvelos al proveedor) para que el stock quede al día.
          </p>
        ) : null}
      </section>

      {baja ? (
        <DarDeBajaLote
          lote={{ id: baja.lote_id, numero: baja.numero, vencimiento: baja.vencimiento, cantidad: baja.cantidad, producto: baja.producto }}
          deposito={baja.deposito}
          unidad={baja.unidad_medida === "Unidad" ? "u." : baja.unidad_medida}
          onClose={() => setBaja(null)}
          onHecho={() => { setBaja(null); invalidarLista("/api/productos"); invalidarLista("/api/inventario/movimientos"); invalidarLista("/api/inventario/ajustes"); setRecarga((k) => k + 1); }}
        />
      ) : null}
    </div>
  );
}
