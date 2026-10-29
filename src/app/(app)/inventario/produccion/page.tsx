"use client";

/**
 * /inventario/produccion — Producción por tanda (receta 97): cada vez que se fabrica queda un
 * documento FAB-000001 con el producto, cuánto se planeó y cuánto salió (merma), las materias
 * primas que se descontaron y su costo real (PEPS).
 *   · "Fabricar" abre el modal (FabricarModal); ?fabricar=1 lo abre al entrar y
 *     ?fabricar=<producto> lo abre con ese producto elegido (desde la receta).
 *   · ?ver=<id> abre el detalle, con "Anular" (Administrador o Supervisor con el permiso).
 */
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Factory, Loader2, Search, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { tienePermiso, useUsuario } from "@/lib/sesion/ContextoUsuario";
import { Select } from "@/components/Select";
import { BarraFiltros } from "@/components/EncabezadoPagina";
import { SelectorFecha } from "@/components/SelectorFecha";
import { TablaTarjetas, useVistaTarjetas, type ColumnaTabla } from "@/components/TablaResponsive";
import { invalidarLista, useListaCacheada } from "@/modules/inventario/lista-cache";
import { hayVariosDepositos, invalidarDepositos, opcionesDepositos, useDepositos } from "@/modules/inventario/depositos";
import { dia, fechaHora, gs } from "@/modules/inventario/documentos";
import { cant, unidadCorta } from "@/modules/inventario/recetas";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, Cabecera, Dato, INPUT_FILTRO, ModalDocumento, Paginador, PedirMotivo, Pestanas, TEAL } from "@/modules/inventario/ui";
import { FabricarModal } from "@/modules/inventario/FabricarModal";
import { ESTADO_PRODUCCION, decimalesDe, type DetalleProduccion, type FilaProduccion, type ListaProducciones } from "@/modules/inventario/produccion";

const POR_PAGINA = 25;
const RE_UUID = /^[0-9a-f-]{36}$/i;
const u = (x: string | null | undefined) => unidadCorta(x ?? "Unidad");

function ChipEstado({ e }: { e: FilaProduccion["estado"] }) {
  const d = ESTADO_PRODUCCION[e];
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${d.clase}`}>{d.label}</span>;
}

/** "38 u. (de 40)" con la merma resaltada. */
function Salio({ f }: { f: Pick<FilaProduccion, "cantidad_planeada" | "cantidad_obtenida" | "merma" | "producto"> }) {
  const d = decimalesDe(f.producto.unidad_medida);
  const merma = Number(f.merma);
  return (
    <span className="tabular-nums">
      <span className="font-semibold text-slate-900">{cant(f.cantidad_obtenida, d)} {u(f.producto.unidad_medida)}</span>
      {merma !== 0 ? (
        <span className={`block text-[11px] ${merma > 0 ? "text-amber-700" : "text-sky-700"}`}>
          de {cant(f.cantidad_planeada, d)} · {merma > 0 ? `merma ${cant(merma, d)}` : `+${cant(-merma, d)}`}
        </span>
      ) : null}
    </span>
  );
}

const columnasMovil: ColumnaTabla<FilaProduccion>[] = [
  { key: "producto", titulo: "Producto", movil: "titulo", celda: (f) => f.producto.nombre },
  { key: "numero", titulo: "Documento", movil: "subtitulo", celda: (f) => <><span className="font-mono">{f.numero}</span> · {fechaHora(f.created_at)}</> },
  { key: "salio", titulo: "Salió", movil: "valor", celda: (f) => <Salio f={f} /> },
  { key: "estado", titulo: "Estado", movil: "chip", celda: (f) => <ChipEstado e={f.estado} /> },
  { key: "costo", titulo: "Costo", movil: "dato", celda: (f) => (f.costo_unitario == null ? "—" : <>{gs(f.costo_unitario)} <span className="text-slate-400">/{u(f.producto.unidad_medida)}</span></>) },
  { key: "deposito", titulo: "Depósito", movil: "dato", celda: (f) => f.deposito.nombre },
  { key: "lote", titulo: "Lote", movil: "detalle", celda: (f) => (f.lote_numero ? <><span className="font-mono">{f.lote_numero}</span>{f.vencimiento ? ` · vence ${dia(f.vencimiento)}` : ""}</> : "—") },
  { key: "usuario", titulo: "Fabricó", movil: "detalle", celda: (f) => f.usuario_nombre ?? "—" },
];

export default function ProduccionPage() {
  return (
    <Suspense fallback={null}>
      <Produccion />
    </Suspense>
  );
}

function Produccion() {
  const router = useRouter();
  const sp = useSearchParams();
  const ver = sp.get("ver");
  const me = useUsuario();
  const puedeFabricar = tienePermiso(me, "fabricar");
  const deps = useDepositos();
  const [vista, setVista] = useState("");
  const [deposito, setDeposito] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [q, setQ] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [pagina, setPagina] = useState(1);
  const [recarga, setRecarga] = useState(0);
  // Modal Fabricar: null = cerrado; "" = sin producto elegido; <id> = con ese producto.
  const [fabricando, setFabricando] = useState<string | null>(null);

  // ?fabricar=1 / ?fabricar=<producto>: abre el modal al entrar (y limpia la URL).
  useEffect(() => {
    const f = sp.get("fabricar");
    if (f == null) return;
    setFabricando(RE_UUID.test(f) ? f : "");
    router.replace("/inventario/produccion", { scroll: false });
  }, [sp, router]);

  useEffect(() => {
    const t = setTimeout(() => { setQ(busqueda.trim()); setPagina(1); }, 350);
    return () => clearTimeout(t);
  }, [busqueda]);

  const url = useMemo(() => {
    const p = new URLSearchParams({ pagina: String(pagina), por_pagina: String(POR_PAGINA) });
    if (vista) p.set("estado", vista);
    if (deposito) p.set("deposito", deposito);
    if (q) p.set("q", q);
    if (desde) p.set("desde", desde);
    if (hasta) p.set("hasta", hasta);
    return `/api/inventario/produccion?${p}`;
  }, [pagina, vista, deposito, q, desde, hasta]);
  const lista = useListaCacheada<ListaProducciones>(url, recarga);
  const rows = lista.error ? [] : lista.datos?.rows ?? [];
  const total = lista.error ? 0 : lista.datos?.total ?? 0;
  const verCostos = !!lista.datos?.ver_costos;

  const abrir = (id: string | null) => router.replace(id ? `/inventario/produccion?ver=${id}` : "/inventario/produccion", { scroll: false });
  const cambio = () => {
    invalidarLista("/api/inventario/produccion");
    invalidarLista("/api/productos");
    invalidarLista("/api/inventario/movimientos");
    invalidarLista("/api/inventario/vencimientos");
    invalidarLista("/api/inventario/recetas");
    invalidarDepositos();
    setRecarga((k) => k + 1);
  };

  const vistaTarjetas = useVistaTarjetas();
  const vacio = (
    <div className="px-4 py-14 text-center">
      {lista.cargando ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /> : (
        <>
          <div className="mb-3 inline-flex h-14 w-14 items-center justify-center rounded-2xl border" style={{ backgroundColor: `${TEAL}14`, borderColor: `${TEAL}33` }}>
            <Factory className="h-6 w-6" style={{ color: TEAL }} />
          </div>
          <p className="text-sm font-semibold text-slate-700">{q || vista || deposito || desde || hasta ? "Ninguna producción coincide con los filtros" : "Todavía no fabricaste nada"}</p>
          {!(q || vista || deposito || desde || hasta) ? (
            <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500">Elegí un producto Fabricado (con su receta), cuánto vas a fabricar y cuánto salió: se descuentan las materias primas y se suma al stock.</p>
          ) : null}
        </>
      )}
    </div>
  );

  return (
    <div className="space-y-5 pb-10 sm:space-y-6">
      <Cabecera volver={{ href: "/inventario/panel", label: "Inventario" }} kicker="Inventario · Documentos" titulo="Producción"
        subtitulo="Lo que fabricás con tus recetas: descuenta las materias primas y suma el stock del producto, al costo real de lo que usaste">
        {puedeFabricar ? (
          <button type="button" onClick={() => setFabricando("")} className={BOTON_PRIMARIO} style={{ backgroundColor: TEAL }}>
            <Factory className="h-4 w-4" /> Fabricar
          </button>
        ) : null}
      </Cabecera>

      {lista.datos ? (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3">
          <Cifra etiqueta="Producciones" valor={String(lista.datos.totales.producciones)} detalle={vista === "anulada" ? "fabricadas (no anuladas)" : "fabricadas en el filtro"} />
          {verCostos && lista.datos.totales.costo != null ? (
            <Cifra etiqueta="Costo de lo fabricado" valor={gs(lista.datos.totales.costo)} detalle="materias primas usadas" />
          ) : null}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: `${TEAL}33` }}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-3 py-3 sm:px-5" style={{ borderColor: `${TEAL}22`, background: `linear-gradient(to right, ${TEAL}0d, transparent)` }}>
          <div className="min-w-0 max-md:w-full">
            <Pestanas valor={vista} onChange={(v) => { setVista(v); setPagina(1); }}
              opciones={[{ id: "", label: "Todas" }, { id: "confirmada", label: "Fabricadas" }, { id: "anulada", label: "Anuladas" }]} />
          </div>
          <BarraFiltros plano className="max-md:w-full" activos={(deposito ? 1 : 0) + (desde ? 1 : 0) + (hasta ? 1 : 0)}
            onLimpiar={() => { setDeposito(""); setDesde(""); setHasta(""); setPagina(1); }}
            busqueda={
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="N°, producto, materia prima…" type="search" enterKeyHint="search" aria-label="Buscar producciones"
                  className={`${INPUT_FILTRO} w-full pl-9 max-md:h-11 md:w-56`} />
              </div>
            }>
            {hayVariosDepositos(deps.datos) ? (
              <Select value={deposito} onChange={(v) => { setDeposito(v); setPagina(1); }} minWidth={200} etiqueta="Depósito" className="max-sm:!min-w-0"
                options={[["", "Todos los depósitos"], ...opcionesDepositos(deps.datos, { soloActivos: false })]} />
            ) : null}
            <div className="flex flex-col gap-1 md:block">
              <span className="text-xs font-medium text-slate-600 md:sr-only">Desde</span>
              <SelectorFecha compacto etiqueta="Desde" value={desde} onChange={(v) => { setDesde(v); setPagina(1); }} max={hasta || undefined} claseBoton="h-10 rounded-xl px-3 text-slate-800 max-md:h-11" className="max-md:w-full md:w-[150px]" />
            </div>
            <div className="flex flex-col gap-1 md:block">
              <span className="text-xs font-medium text-slate-600 md:sr-only">Hasta</span>
              <SelectorFecha compacto etiqueta="Hasta" value={hasta} onChange={(v) => { setHasta(v); setPagina(1); }} min={desde || undefined} claseBoton="h-10 rounded-xl px-3 text-slate-800 max-md:h-11" className="max-md:w-full md:w-[150px]" />
            </div>
          </BarraFiltros>
        </div>

        {vistaTarjetas ? (
          <TablaTarjetas filas={rows} columnas={columnasMovil} claveFila={(f) => f.id} onFila={(f) => abrir(f.id)} cargando={lista.cargando} vacio={vacio} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-slate-50/70 text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Documento</th>
                  <th className="px-3 py-3 font-semibold">Producto</th>
                  <th className="px-3 py-3 font-semibold">Depósito</th>
                  <th className="px-3 py-3 text-right font-semibold">Salió</th>
                  {verCostos ? <th className="px-3 py-3 text-right font-semibold">Costo</th> : null}
                  <th className="px-3 py-3 font-semibold">Estado</th>
                  <th className="px-5 py-3 font-semibold">Fabricó</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.length === 0 ? (
                  <tr><td colSpan={verCostos ? 7 : 6}>{vacio}</td></tr>
                ) : rows.map((f) => (
                  <tr key={f.id} onClick={() => abrir(f.id)} className={`cursor-pointer transition-colors hover:bg-[var(--brand-50)] ${lista.cargando ? "opacity-60" : ""}`}>
                    <td className="px-5 py-3">
                      <p className="font-mono text-sm font-semibold text-slate-900">{f.numero}</p>
                      <p className="text-[11px] text-slate-500">{f.insumos} {f.insumos === 1 ? "materia prima" : "materias primas"}</p>
                    </td>
                    <td className="max-w-[260px] px-3 py-3">
                      <p className="font-medium text-slate-800">{f.producto.nombre}</p>
                      <p className="font-mono text-[11px] text-slate-400">
                        {f.producto.sku}{f.lote_numero ? <span className="font-sans"> · lote <span className="font-mono">{f.lote_numero}</span>{f.vencimiento ? ` · vence ${dia(f.vencimiento)}` : ""}</span> : null}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-xs">
                      <p className="font-medium text-slate-700">{f.deposito.nombre}</p>
                      <p className="text-[11px] text-slate-400">{f.deposito.sucursal}</p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right"><Salio f={f} /></td>
                    {verCostos ? (
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                        <p className="font-semibold text-slate-900">{gs(f.costo_total)}</p>
                        <p className="text-[11px] text-slate-400">{gs(f.costo_unitario)} /{u(f.producto.unidad_medida)}</p>
                      </td>
                    ) : null}
                    <td className="px-3 py-3"><ChipEstado e={f.estado} /></td>
                    <td className="whitespace-nowrap px-5 py-3 text-xs text-slate-500">
                      {fechaHora(f.created_at)}
                      <span className="block text-[11px] text-slate-400">{f.usuario_nombre}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Paginador pagina={pagina} porPagina={POR_PAGINA} total={total} cargando={lista.cargando} onCambiar={setPagina} />
      </section>

      {ver ? <DetalleProduccionModal id={ver} onClose={() => abrir(null)} onCambio={cambio} /> : null}
      {fabricando !== null ? (
        <FabricarModal productoInicial={fabricando || null} onClose={() => setFabricando(null)}
          onHecho={(d) => { setFabricando(null); cambio(); abrir(d.id); }} />
      ) : null}
    </div>
  );
}

function Cifra({ etiqueta, valor, detalle }: { etiqueta: string; valor: string; detalle: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white px-3.5 py-3 shadow-sm sm:px-5 sm:py-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{etiqueta}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 [overflow-wrap:anywhere] sm:text-xl">{valor}</p>
      <p className="text-[11px] text-slate-400">{detalle}</p>
    </div>
  );
}

function DetalleProduccionModal({ id, onClose, onCambio }: { id: string; onClose: () => void; onCambio: () => void }) {
  const [recarga, setRecarga] = useState(0);
  const det = useListaCacheada<DetalleProduccion>(`/api/inventario/produccion/${id}`, recarga);
  const a = det.cargando && recarga === 0 ? null : det.datos;
  const [anulando, setAnulando] = useState(false);

  if (det.error) return <ModalDocumento titulo="Producción" onClose={onClose} ancho="max-w-md"><p className="text-sm text-rose-700">No se encontró la producción.</p></ModalDocumento>;
  if (!a) return <ModalDocumento titulo="Producción" onClose={onClose} ancho="max-w-md"><div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div></ModalDocumento>;

  const d = decimalesDe(a.producto.unidad_medida);
  const merma = Number(a.merma);
  return (
    <>
      <ModalDocumento
        ancho="max-w-2xl"
        titulo={<><span className="font-mono">{a.numero}</span><ChipEstado e={a.estado} /></>}
        subtitulo={<>Producción · {a.deposito.nombre} ({a.deposito.sucursal})</>}
        onClose={onClose}
        footer={
          <>
            {a.puede_anular ? (
              <button onClick={() => setAnulando(true)} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3.5 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 max-sm:min-h-11 max-sm:flex-1">
                <X className="h-4 w-4" /> Anular
              </button>
            ) : null}
            <button onClick={onClose} className={`${BOTON_SECUNDARIO} max-sm:min-h-11 max-sm:flex-1`}>Cerrar</button>
          </>
        }>
        <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
          <p className="text-base font-semibold text-slate-900">{a.producto.nombre}</p>
          <p className="font-mono text-[11px] text-slate-400">{a.producto.sku}</p>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            <Dato etiqueta="Planeado">{cant(a.cantidad_planeada, d)} {u(a.producto.unidad_medida)}</Dato>
            <Dato etiqueta="Salió"><span className="font-semibold">{cant(a.cantidad_obtenida, d)} {u(a.producto.unidad_medida)}</span></Dato>
            <Dato etiqueta={merma < 0 ? "De más" : "Merma"}>
              <span className={merma > 0 ? "text-amber-700" : merma < 0 ? "text-sky-700" : "text-slate-400"}>
                {merma === 0 ? "—" : `${cant(Math.abs(merma), d)} ${u(a.producto.unidad_medida)}${a.merma_pct != null ? ` (${cant(a.merma_pct, 1)} %)` : ""}`}
              </span>
            </Dato>
            {a.ver_costos ? <Dato etiqueta="Costo por unidad">{gs(a.costo_unitario)}<span className="block text-[11px] text-slate-400">total {gs(a.costo_total)}</span></Dato> : null}
            <Dato etiqueta="Fabricó">{a.usuario_nombre ?? "—"}<span className="block text-[11px] text-slate-400">{fechaHora(a.created_at)}</span></Dato>
            {a.lote_numero ? <Dato etiqueta="Lote"><span className="font-mono">{a.lote_numero}</span>{a.vencimiento ? <span className="block text-[11px] text-slate-400">vence {dia(a.vencimiento)}</span> : null}</Dato> : null}
            {a.estado === "anulada" ? <Dato etiqueta="Anuló">{a.anulado_por_nombre ?? "—"}<span className="block text-[11px] text-slate-400">{a.anulado_at ? fechaHora(a.anulado_at) : ""}</span></Dato> : null}
          </div>
        </div>
        {a.notas ? <p className="mt-3 text-sm text-slate-700"><span className="text-slate-400">Notas:</span> {a.notas}</p> : null}
        {a.anulado_motivo ? (
          <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600"><strong>Anulada:</strong> {a.anulado_motivo}. Lo fabricado salió del stock y las materias primas volvieron.</p>
        ) : null}

        <h3 className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Materias primas que se usaron</h3>
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {a.items.map((i) => {
            const di = decimalesDe(i.unidad_medida);
            return (
              <li key={i.insumo_id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="font-medium leading-snug text-slate-800 [overflow-wrap:anywhere]">{i.nombre}</p>
                  <p className="text-[11px] text-slate-500">
                    <span className="font-mono">{i.sku}</span>
                    {!i.movio_stock ? " · no controla stock (solo costo)" : null}
                    {i.lotes?.length ? i.lotes.map((l) => <span key={`${l.numero}-${l.vencimiento}`} className="block">lote <span className="font-mono">{l.numero}</span> · {cant(l.cantidad, di === 0 ? 2 : 3)} · vence {dia(l.vencimiento)}</span>) : null}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-semibold tabular-nums text-slate-900">−{cant(i.cantidad, di === 0 ? 2 : 3)} <span className="text-xs font-normal text-slate-500">{u(i.unidad_medida)}</span></p>
                  {i.costo_total != null ? <p className="text-[11px] tabular-nums text-slate-500">{gs(i.costo_total)}</p> : null}
                </div>
              </li>
            );
          })}
        </ul>
        {a.ver_costos ? (
          <p className="mt-2 text-right text-[11px] text-slate-400">Costo real de cada compra (PEPS){merma > 0 ? "; la merma queda repartida en lo que salió" : ""}.</p>
        ) : null}
      </ModalDocumento>

      {anulando ? (
        <PedirMotivo
          titulo={`Anular ${a.numero}`}
          confirmar="Anular"
          etiqueta="Motivo de la anulación"
          descripcion={<>Lo fabricado sale del stock y las materias primas vuelven al depósito, con su mismo costo y lote. Si ya se vendió o trasladó parte de lo fabricado, no se puede.</>}
          onClose={() => setAnulando(false)}
          onConfirmar={async (motivo) => {
            await apiFetch(`/api/inventario/produccion/${a.id}/anular`, { method: "POST", body: JSON.stringify({ motivo }) });
            setAnulando(false);
            onCambio();
            setRecarga((k) => k + 1);
          }} />
      ) : null}
    </>
  );
}
