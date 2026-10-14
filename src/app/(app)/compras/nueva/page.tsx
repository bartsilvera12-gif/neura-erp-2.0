"use client";

/**
 * /compras/nueva — cargar una factura de compra (Fase 2, portado de Ferretería).
 * 1) Factura del proveedor: proveedor (propone su condición, plazo y moneda), número,
 *    timbrado, fecha, contado/crédito y moneda.
 * 2) Productos: se buscan o escanean; por cada uno cantidad, costo c/u (con la última
 *    compra y cuánto subió) y, si querés, el nuevo precio de venta con el margen en vivo.
 * 3) Resumen: totales con IVA contenido, qué falta completar y "Registrar compra".
 * Todo se guarda junto en la base (registrar_compra): stock, costo promedio, precio y kardex.
 * Productos con lotes: cada línea lleva lote (prellenado L-YYMMDD, editable) y vencimiento
 * (obligatorio). Una línea = un lote: para dos lotes del mismo producto, dos líneas.
 * Al contado se elige el medio de pago: en efectivo sale de la caja abierta (solo Gs.).
 * Recibiendo una orden (?oc=ID): no deja pasar de lo pendiente de cada línea sin confirmar
 * la recepción excedente. Un doble clic no duplica la compra (idempotency_key).
 */
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, ClipboardList, Loader2, Package, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { clienteConfig } from "@/cliente.config";
import { Select } from "@/components/Select";
import MontoInput from "@/components/ui/MontoInput";
import { METODOS_PAGO_PROV, type MetodoPagoProv } from "@/modules/compras/pagos";
import { hoyPY } from "@/lib/fecha/paraguay";
import { SelectorProveedor } from "@/modules/proveedores/SelectorProveedor";
import { Variacion, type HistorialCostosData } from "@/modules/inventario/HistorialCostos";
import { traerProductosLote } from "@/modules/inventario/lote";
import type { ProductoInventario } from "@/modules/inventario/tipos";
import type { ProveedorMin } from "@/modules/proveedores/tipos";
import { cargarProveedores } from "@/modules/proveedores/cache";
import type { OrdenCompra } from "@/modules/compras/ordenes";
import { AdjuntosPendientes, subirComprobantes } from "@/modules/compras/Comprobantes";
import { ProductoForm } from "@/modules/inventario/ProductoForm";
import { BuscadorProductos, ET, Fila, gs, INPUT, ivaDe, Segmentado, sumarDias, Tarjeta, usd } from "@/modules/compras/partes";
import { loteAutomatico } from "@/modules/inventario/vencimientos";

const TEAL = clienteConfig.color;
type Linea = {
  key: string;
  prod: ProductoInventario;
  cantidad: string;
  costo: number;          // en la moneda de la factura, IVA incluido
  precioNuevo: number;    // 0 = no cambia
  ultima: { costo: number; fecha: string; proveedor: string | null } | null;
  /** productos con lotes: N° de lote (vacío → L-YYMMDD) y vencimiento YYYY-MM-DD */
  lote: string;
  vencimiento: string;
  /** línea de la orden que se está recibiendo */
  ocItemId?: string;
  pedido?: number;
  recibidoAntes?: number;
};

// useSearchParams necesita un Suspense alrededor (si no, el build de Next falla).
export default function NuevaCompraPage() {
  return (
    <Suspense>
      <NuevaCompra />
    </Suspense>
  );
}

function NuevaCompra() {
  const ocId = useSearchParams().get("oc");
  const [orden, setOrden] = useState<OrdenCompra | null>(null);
  const [proveedores, setProveedores] = useState<ProveedorMin[]>([]);
  const [proveedorId, setProveedorId] = useState<string | null>(null);
  const [factura, setFactura] = useState("");
  const [timbrado, setTimbrado] = useState("");
  const [fechaFactura, setFechaFactura] = useState(hoyPY());
  const [tipoPago, setTipoPago] = useState<"contado" | "credito">("contado");
  const [plazo, setPlazo] = useState("30");
  const [moneda, setMoneda] = useState<"GS" | "USD">("GS");
  const [cambio, setCambio] = useState(0);
  const [observacion, setObservacion] = useState("");
  const [creandoProd, setCreandoProd] = useState<string | null>(null);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecha, setHecha] = useState<{ id: string; numero: string; total: number; adjuntos: number; fallidos: string[] } | null>(null);
  const [adjuntos, setAdjuntos] = useState<File[]>([]);
  const [subiendoAdjuntos, setSubiendoAdjuntos] = useState(false);
  // Contado: cómo se pagó. El efectivo sale de la caja abierta (solo en Gs.).
  const [medioPago, setMedioPago] = useState<MetodoPagoProv | "">("");
  const [referenciaPago, setReferenciaPago] = useState("");
  const [cajaAbierta, setCajaAbierta] = useState<boolean | null>(null);
  // Recepción de una orden: llegó más de lo pendiente y el usuario lo confirma.
  const [excedenteOk, setExcedenteOk] = useState(false);
  // Un doble clic o un reintento devuelve la misma compra (no dos). Nueva por cada compra.
  const [idem, setIdem] = useState(() => crypto.randomUUID());

  useEffect(() => {
    // Misma lista (y misma llamada) que usa el SelectorProveedor.
    void cargarProveedores().then(setProveedores);
    apiFetch<{ caja: { id: string } | null }>("/api/caja").then((r) => setCajaAbierta(!!r.caja)).catch(() => setCajaAbierta(false));
  }, []);

  // Recibir una orden de compra: proveedor, condición y moneda de la orden, y sus
  // productos con lo que falta recibir (se ajusta a lo que llegó de verdad).
  useEffect(() => {
    if (!ocId) return;
    let vivo = true;
    (async () => {
      try {
        const o = await apiFetch<OrdenCompra>(`/api/ordenes-compra/${ocId}`);
        if (!vivo) return;
        setOrden(o);
        setProveedorId(o.proveedor_id);
        setTipoPago(o.tipo_pago);
        if (o.plazo_dias) setPlazo(String(o.plazo_dias));
        setMoneda(o.moneda);
        if (o.moneda === "USD") setCambio(Number(o.tipo_cambio) || 0);
        const pendientes = (o.items ?? []).filter((i) => Number(i.cantidad) > Number(i.cantidad_recibida));
        // Los productos y la última compra de cada uno (para comparar el costo) en un
        // solo request, en vez de 2 por producto.
        const { productos: prods, costos: historiales } = await traerProductosLote<ProductoInventario>(
          pendientes.map((i) => i.producto_id),
          { costos: true, costosLimite: 1 },
        );
        if (!vivo) return;
        setLineas(pendientes.flatMap((i) => {
          const prod = prods.get(i.producto_id);
          if (!prod) return [];
          const u = historiales.get(i.producto_id)?.compras[0];
          return [{
            key: i.id,
            prod,
            cantidad: String(Number(i.cantidad) - Number(i.cantidad_recibida)),
            costo: Number(i.costo_unitario_original) || 0,
            precioNuevo: 0,
            ultima: u ? { costo: Number(u.costo), fecha: u.fecha, proveedor: u.proveedor } : null,
            lote: loteAutomatico(hoyPY()),
            vencimiento: "",
            ocItemId: i.id,
            pedido: Number(i.cantidad),
            recibidoAntes: Number(i.cantidad_recibida),
          }];
        }));
      } catch (e) {
        if (vivo) setError((e as Error).message);
      }
    })();
    return () => { vivo = false; };
  }, [ocId]);

  // Al elegir el proveedor se proponen su condición, plazo y moneda habituales.
  function elegirProveedor(id: string | null) {
    setProveedorId(id);
    const p = proveedores.find((x) => x.id === id);
    if (!p) {
      // recién creado desde el selector: él ya recargó la lista compartida (sale del cache)
      if (id) void cargarProveedores().then(setProveedores);
      return;
    }
    setTipoPago(p.condicion_pago);
    if (p.plazo_pago_dias) setPlazo(String(p.plazo_pago_dias));
    setMoneda(p.moneda);
  }

  const conLotes = (p: ProductoInventario) => !!(p.controla_stock && p.controla_lotes);

  async function agregar(prod: ProductoInventario) {
    // Con lotes, cada vez que se agrega es otra línea (otro lote); sin lotes, suma 1.
    const existente = conLotes(prod) ? null : lineas.find((l) => l.prod.id === prod.id);
    if (existente) {
      setLineas((ls) => ls.map((l) => (l.key === existente.key ? { ...l, cantidad: String((Number(l.cantidad.replace(",", ".")) || 0) + 1) } : l)));
      return;
    }
    const key = `${prod.id}-${Date.now()}`;
    // Recibiendo una orden: si el producto está en la orden (p. ej. otro lote del mismo
    // producto), la línea nueva también cuenta como recibido de esa orden.
    const oi = orden?.items?.find((i) => i.producto_id === prod.id);
    const deOrden = oi ? { ocItemId: oi.id, pedido: Number(oi.cantidad), recibidoAntes: Number(oi.cantidad_recibida) } : {};
    const costoOrden = oi ? Number(oi.costo_unitario_original) || 0 : 0;
    setLineas((ls) => [...ls, { key, prod, cantidad: "1", costo: costoOrden, precioNuevo: 0, ultima: null, lote: loteAutomatico(hoyPY()), vencimiento: "", ...deOrden }]);
    // Última compra: se muestra al lado del costo y se propone el mismo costo.
    try {
      const h = await apiFetch<HistorialCostosData>(`/api/productos/${prod.id}/costos`);
      const u = h.compras[0];
      const base = u ? Number(u.costo) : Number(prod.costo_promedio) || 0;
      setLineas((ls) => ls.map((l) => (l.key === key ? {
        ...l,
        ultima: u ? { costo: Number(u.costo), fecha: u.fecha, proveedor: u.proveedor } : null,
        costo: l.costo || (moneda === "GS" ? Math.round(base) : 0),
      } : l)));
    } catch {
      /* sin historial */
    }
  }

  const cambiar = (key: string, patch: Partial<Linea>) => setLineas((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const factor = moneda === "USD" ? cambio : 1;

  const calc = useMemo(() => {
    let total = 0, iva10 = 0, iva5 = 0, unidades = 0, totalOrig = 0;
    for (const l of lineas) {
      const cant = Number(l.cantidad.replace(",", ".")) || 0;
      const linea = Math.round(cant * l.costo * factor);
      total += linea;
      totalOrig += cant * l.costo;
      unidades += cant;
      if (l.prod.tipo_iva === "10%") iva10 += ivaDe(linea, "10%");
      if (l.prod.tipo_iva === "5%") iva5 += ivaDe(linea, "5%");
    }
    return { total, iva10, iva5, subtotal: total - iva10 - iva5, unidades, totalOrig };
  }, [lineas, factor]);

  // Recibiendo una orden: lo que llega de cada línea (puede venir en varias, una por lote)
  // contra lo que quedaba pendiente. Pasarse pide confirmación explícita.
  const excedidas = useMemo(() => {
    const suma = new Map<string, { recibe: number; pendiente: number }>();
    for (const l of lineas) {
      if (!l.ocItemId || l.pedido == null) continue;
      const x = suma.get(l.ocItemId) ?? { recibe: 0, pendiente: Math.max(l.pedido - (l.recibidoAntes ?? 0), 0) };
      x.recibe += Number(l.cantidad.replace(",", ".")) || 0;
      suma.set(l.ocItemId, x);
    }
    return new Set([...suma].filter(([, x]) => x.recibe > x.pendiente).map(([k]) => k));
  }, [lineas]);
  const hayExcedente = excedidas.size > 0;
  const efectivo = tipoPago === "contado" && medioPago === "efectivo";

  const ordenCerrada = !!orden && orden.estado !== "pendiente" && orden.estado !== "recibida_parcial";
  const faltan = [
    ordenCerrada && `una orden abierta (la ${orden?.numero_oc} ${orden?.estado === "cancelada" ? "está cancelada" : "ya se recibió completa"})`,
    !proveedorId && "el proveedor",
    !factura.trim() && "el número de factura",
    fechaFactura > hoyPY() && "una fecha de factura que no sea futura",
    tipoPago === "contado" && !medioPago && "el medio de pago",
    efectivo && moneda === "USD" && "otro medio de pago (el efectivo de la caja es en guaraníes)",
    efectivo && moneda === "GS" && cajaAbierta === false && "abrir la caja (el efectivo sale de la caja)",
    hayExcedente && !excedenteOk && "confirmar que llegó más de lo pedido",
    moneda === "USD" && !(cambio > 0) && "la cotización del dólar",
    lineas.length === 0 && "al menos un producto",
    lineas.some((l) => !(Number(l.cantidad.replace(",", ".")) > 0)) && "la cantidad de algún producto",
    lineas.some((l) => !(l.costo > 0)) && "el costo de algún producto",
    lineas.some((l) => conLotes(l.prod) && !l.vencimiento) && "el vencimiento de algún producto con lotes",
  ].filter(Boolean) as string[];

  async function registrar() {
    if (faltan.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ id: string; numero_control: string; total: number }>("/api/compras", {
        method: "POST",
        body: JSON.stringify({
          proveedor_id: proveedorId,
          numero_factura: factura.trim(),
          nro_timbrado: timbrado.trim() || null,
          fecha_factura: fechaFactura || null,
          tipo_pago: tipoPago,
          plazo_dias: tipoPago === "credito" ? Number(plazo) || null : null,
          medio_pago: tipoPago === "contado" && medioPago ? medioPago : null,
          referencia_pago: tipoPago === "contado" && medioPago !== "efectivo" ? referenciaPago.trim() || null : null,
          moneda,
          tipo_cambio: moneda === "USD" ? cambio : null,
          observacion: observacion.trim() || null,
          orden_compra_id: orden?.id ?? null,
          permitir_excedente: hayExcedente && excedenteOk,
          idempotency_key: idem,
          items: lineas.map((l) => ({
            producto_id: l.prod.id,
            cantidad: Number(l.cantidad.replace(",", ".")),
            costo_unitario: l.costo,
            precio_venta_nuevo: l.precioNuevo > 0 ? l.precioNuevo : null,
            oc_item_id: l.ocItemId ?? null,
            lote: conLotes(l.prod) ? l.lote.trim() || null : null,
            vencimiento: conLotes(l.prod) ? l.vencimiento : null,
          })),
        }),
      });
      // Los comprobantes se suben recién con la compra creada. Si alguno falla, la compra
      // queda igual (ya está registrada) y se avisa para adjuntarlo desde el detalle.
      let fallidos: string[] = [];
      if (adjuntos.length) {
        setSubiendoAdjuntos(true);
        fallidos = await subirComprobantes(r.id, adjuntos);
        setSubiendoAdjuntos(false);
      }
      setHecha({ id: r.id, numero: r.numero_control, total: r.total, adjuntos: adjuntos.length - fallidos.length, fallidos });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function otra() {
    setHecha(null);
    setFactura("");
    setTimbrado("");
    setObservacion("");
    setLineas([]);
    setAdjuntos([]);
    setFechaFactura(hoyPY());
    setReferenciaPago("");
    setExcedenteOk(false);
    setIdem(crypto.randomUUID());
  }

  if (hecha) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" />
        <h1 className="mt-4 text-2xl font-semibold text-slate-900">Compra registrada</h1>
        <p className="mt-1 text-sm text-slate-500">
          <strong className="font-semibold text-slate-700">{hecha.numero}</strong> por <strong className="font-semibold text-slate-700">{gs(hecha.total)}</strong>.
          El stock, los costos y el kardex ya quedaron actualizados.
          {hecha.adjuntos ? ` Se ${hecha.adjuntos === 1 ? "adjuntó 1 comprobante" : `adjuntaron ${hecha.adjuntos} comprobantes`}.` : ""}
        </p>
        {hecha.fallidos.length ? (
          <div className="mx-auto mt-4 max-w-md rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-xs text-amber-800">
            <p className="font-semibold">La compra quedó registrada, pero no se pudo subir {hecha.fallidos.length === 1 ? "un comprobante" : `${hecha.fallidos.length} comprobantes`}:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">{hecha.fallidos.map((f, i) => <li key={i}>{f}</li>)}</ul>
            <p className="mt-1">Podés adjuntarlo después desde el detalle de la compra (Compras → tocá la compra → Adjuntar comprobante).</p>
          </div>
        ) : null}
        <div className="mt-6 flex justify-center gap-2">
          <Link href={`/compras?ver=${hecha.id}`} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Ver la compra</Link>
          {orden ? (
            <Link href={`/compras/ordenes?ver=${orden.id}`} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white" style={{ backgroundColor: TEAL }}>Ver la orden {orden.numero_oc}</Link>
          ) : (
            <button onClick={otra} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white" style={{ backgroundColor: TEAL }}>Cargar otra compra</button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      <header className="flex items-start gap-3">
        <Link href="/compras" aria-label="Volver a compras" className="mt-1 flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Operaciones · Compras</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{orden ? `Recibir ${orden.numero_oc}` : "Nueva compra"}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {orden
              ? "Cargá la factura y ajustá las cantidades a lo que llegó de verdad. Lo que no llegó queda pendiente en la orden."
              : "Cargá la factura del proveedor: suma el stock y actualiza los costos solo."}
          </p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          {/* ── 1. Factura ───────────────────────────────────────────────── */}
          <Tarjeta numero={1} titulo="Factura del proveedor">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <span className={ET}>Proveedor *</span>
                {orden ? (
                  <p className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm font-semibold text-slate-800">
                    <ClipboardList className="h-4 w-4 text-slate-400" /> {orden.proveedor_nombre}
                    <span className="ml-auto text-xs font-normal text-slate-500">de la {orden.numero_oc}</span>
                  </p>
                ) : (
                  <SelectorProveedor value={proveedorId} onChange={(id) => elegirProveedor(id)} />
                )}
              </div>
              <label className="block">
                <span className={ET}>Nº de factura *</span>
                <input value={factura} onChange={(e) => setFactura(e.target.value)} maxLength={40} placeholder="Ej: 001-001-0000123" className={`${INPUT} font-mono`} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className={ET}>Timbrado <span className="font-normal text-slate-400">(opcional)</span></span>
                  <input value={timbrado} onChange={(e) => setTimbrado(e.target.value.replace(/\D/g, "").slice(0, 12))} inputMode="numeric" placeholder="Ej: 12345678" className={`${INPUT} font-mono`} />
                </label>
                <label className="block">
                  <span className={ET}>Fecha de la factura</span>
                  <input type="date" value={fechaFactura} max={hoyPY()} onChange={(e) => setFechaFactura(e.target.value)} className={INPUT} />
                </label>
              </div>
              <div>
                <span className={ET}>Condición</span>
                <Segmentado valor={tipoPago} onChange={(v) => setTipoPago(v as "contado" | "credito")} opciones={[["contado", "Contado"], ["credito", "Crédito"]]} />
                {tipoPago === "credito" ? (
                  <div className="mt-2 flex items-center gap-2">
                    <input inputMode="numeric" value={plazo} onChange={(e) => setPlazo(e.target.value.replace(/\D/g, "").slice(0, 4))} className={`${INPUT} w-20 py-2 text-right tabular-nums`} />
                    <span className="text-sm text-slate-500">días</span>
                    {fechaFactura && Number(plazo) > 0 ? (
                      <span className="ml-auto rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">Vence el {sumarDias(fechaFactura, Number(plazo))}</span>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-2 space-y-2">
                    <Select value={medioPago} onChange={(v) => setMedioPago(v as MetodoPagoProv)} block
                      options={[["", "¿Cómo le pagaste?"], ...METODOS_PAGO_PROV.map((m): [string, string] => [m.v, m.l])]} />
                    {medioPago && medioPago !== "efectivo" ? (
                      <input value={referenciaPago} onChange={(e) => setReferenciaPago(e.target.value.slice(0, 120))} placeholder="N° de operación o de cheque (opcional)" className={`${INPUT} py-2`} />
                    ) : null}
                    {medioPago === "efectivo" ? (
                      <p className={`text-[11px] ${moneda === "USD" || cajaAbierta === false ? "font-semibold text-rose-600" : "text-slate-500"}`}>
                        {moneda === "USD" ? "El efectivo de la caja es en guaraníes: una factura en dólares va por transferencia u otro medio."
                          : cajaAbierta === false ? "No hay caja abierta: el efectivo sale de la caja, abrila primero."
                          : "El total sale de la caja abierta como egreso."}
                      </p>
                    ) : null}
                  </div>
                )}
              </div>
              <div>
                <span className={ET}>Moneda de la factura</span>
                <Segmentado valor={moneda} onChange={(v) => setMoneda(v as "GS" | "USD")} opciones={[["GS", "Guaraníes"], ["USD", "Dólares"]]} />
                {moneda === "USD" ? (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-sm text-slate-500">1 US$ =</span>
                    <MontoInput value={cambio} onChange={setCambio} decimals={false} placeholder="7.300" className={`${INPUT} w-28 py-2 text-right tabular-nums`} />
                    <span className="text-sm text-slate-500">Gs.</span>
                  </div>
                ) : null}
              </div>
            </div>
          </Tarjeta>

          {/* ── 2. Productos ─────────────────────────────────────────────── */}
          <Tarjeta numero={2} titulo="Productos" extra={lineas.length ? <span className="text-xs text-slate-500">{lineas.length} {lineas.length === 1 ? "producto" : "productos"}</span> : null}>
            <BuscadorProductos onElegir={agregar} onCrear={(t) => setCreandoProd(t)} />
            {creandoProd !== null ? (
              <ProductoForm modal inicial={{ nombre: creandoProd, proveedor_principal_id: proveedorId }}
                onClose={() => setCreandoProd(null)}
                onSaved={async (c) => {
                  setCreandoProd(null);
                  // El producto recién creado entra solo a la lista.
                  if (c?.id) { try { void agregar(await apiFetch<ProductoInventario>(`/api/productos/${c.id}`)); } catch { /* lo busca a mano */ } }
                }} />
            ) : null}
            {lineas.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center">
                <Package className="mx-auto h-7 w-7 text-slate-300" />
                <p className="mt-2 text-sm text-slate-500">Buscá o escaneá los productos de la factura.</p>
              </div>
            ) : (
              <ul className="mt-4 space-y-3">
                {lineas.map((l) => (
                  <LineaCompra key={l.key} l={l} moneda={moneda} factor={factor} excede={!!l.ocItemId && excedidas.has(l.ocItemId)} onCambiar={(p) => cambiar(l.key, p)} onQuitar={() => setLineas((ls) => ls.filter((x) => x.key !== l.key))} />
                ))}
              </ul>
            )}
          </Tarjeta>
        </div>

        {/* ── 3. Resumen ─────────────────────────────────────────────────── */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Resumen</p>
            <dl className="mt-3 space-y-1.5 text-sm">
              <Fila l="Productos" v={String(lineas.length)} />
              <Fila l="Unidades" v={calc.unidades.toLocaleString("es-PY", { maximumFractionDigits: 3 })} />
              <Fila l="Subtotal sin IVA" v={gs(calc.subtotal)} />
              {calc.iva10 ? <Fila l="IVA 10 % contenido" v={gs(calc.iva10)} /> : null}
              {calc.iva5 ? <Fila l="IVA 5 % contenido" v={gs(calc.iva5)} /> : null}
            </dl>
            <div className="mt-3 flex items-baseline justify-between border-t border-slate-100 pt-3">
              <span className="text-sm font-semibold text-slate-800">Total</span>
              <span className="text-2xl font-extrabold tabular-nums text-slate-900">{gs(calc.total)}</span>
            </div>
            {moneda === "USD" ? <p className="text-right text-xs text-slate-500">{usd(calc.totalOrig)} a {gs(cambio)}</p> : null}
            <p className="mt-1 text-right text-xs text-slate-500">
              {tipoPago === "credito"
                ? `A crédito${Number(plazo) > 0 && fechaFactura ? ` · vence el ${sumarDias(fechaFactura, Number(plazo))}` : ""} · queda en Pagos a proveedores`
                : `Al contado${medioPago ? ` · ${METODOS_PAGO_PROV.find((m) => m.v === medioPago)?.l.toLowerCase()}` : ""}${efectivo ? " (sale de la caja)" : ""}`}
            </p>

            <label className="mt-4 block">
              <span className={ET}>Observación <span className="font-normal text-slate-400">(opcional)</span></span>
              <textarea value={observacion} onChange={(e) => setObservacion(e.target.value)} rows={2} maxLength={2000} placeholder="Ej: faltó 1 caja, la traen el lunes" className={INPUT} />
            </label>

            <div className="mt-4">
              <AdjuntosPendientes files={adjuntos} onChange={setAdjuntos} disabled={busy} />
            </div>

            {hayExcedente ? (
              <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <input type="checkbox" checked={excedenteOk} onChange={(e) => setExcedenteOk(e.target.checked)} className="mt-0.5" />
                <span>Estás recibiendo <strong>más de lo que falta</strong> de {excedidas.size === 1 ? "un producto" : `${excedidas.size} productos`} de la orden. Confirmo que llegó de más y lo quiero ingresar.</span>
              </label>
            ) : null}
            {faltan.length ? (
              <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">Falta: {faltan.join(", ")}.</p>
            ) : null}
            {error ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
            <button onClick={registrar} disabled={!!faltan.length || busy}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-40" style={{ backgroundColor: TEAL }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {subiendoAdjuntos ? "Subiendo comprobantes…" : busy ? "Registrando…" : "Registrar compra"}
            </button>
            <p className="mt-2 text-center text-[11px] text-slate-400">Suma el stock, recalcula el costo promedio y queda en el kardex.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

/** Una línea de la compra: cantidad, costo (con la última compra) y precio de venta nuevo. */
function LineaCompra({ l, moneda, factor, excede, onCambiar, onQuitar }: {
  l: Linea; moneda: "GS" | "USD"; factor: number;
  /** recibiendo una orden: entre todas sus líneas se pasa de lo pendiente */
  excede: boolean;
  onCambiar: (p: Partial<Linea>) => void; onQuitar: () => void;
}) {
  const cant = Number(l.cantidad.replace(",", ".")) || 0;
  const costoGs = l.costo * factor;
  const totalLinea = Math.round(cant * costoGs);
  const variacion = l.ultima && l.ultima.costo > 0 && costoGs > 0 ? Math.round(((costoGs - l.ultima.costo) / l.ultima.costo) * 1000) / 10 : null;
  const precio = l.precioNuevo > 0 ? l.precioNuevo : Number(l.prod.precio_venta) || 0;
  const margen = precio > 0 && costoGs > 0 ? Math.round(((precio - costoGs) / precio) * 1000) / 10 : null;
  const unidad = l.prod.unidad_medida === "Unidad" ? "u." : l.prod.unidad_medida;

  return (
    <li className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 text-xs font-semibold text-slate-500">
          {l.prod.imagen_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={l.prod.imagen_url} alt="" className="h-full w-full object-contain" />
          ) : l.prod.nombre.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{l.prod.nombre}</p>
          <p className="text-[11px] text-slate-500"><span className="font-mono">{l.prod.sku}</span> · stock {Number(l.prod.stock_actual).toLocaleString("es-PY")} {unidad} · IVA {l.prod.tipo_iva}</p>
          {l.pedido != null ? (
            <p className="mt-0.5 text-[11px] font-medium text-sky-700">
              Pedido {l.pedido.toLocaleString("es-PY")}{l.recibidoAntes ? ` · ya llegaron ${l.recibidoAntes.toLocaleString("es-PY")}` : ""}
              {` · faltan ${Math.max(l.pedido - (l.recibidoAntes ?? 0), 0).toLocaleString("es-PY")}`}
              {excede ? <span className="text-amber-600"> · estás recibiendo más de lo que falta</span> : null}
            </p>
          ) : null}
        </div>
        <p className="text-right text-sm font-bold tabular-nums text-slate-900">{gs(totalLinea)}</p>
        <button onClick={onQuitar} aria-label={`Quitar ${l.prod.nombre}`} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <label className="block">
          <span className={ET}>Cantidad</span>
          <input inputMode="decimal" value={l.cantidad} onChange={(e) => onCambiar({ cantidad: e.target.value.replace(/[^\d.,]/g, "") })} className={`${INPUT} py-2 text-right tabular-nums`} />
        </label>
        <label className="block">
          <span className={ET}>Costo c/u {moneda === "USD" ? "(US$)" : ""} <span className="font-normal text-slate-400">IVA incl.</span></span>
          <MontoInput value={l.costo} onChange={(v) => onCambiar({ costo: v })} decimals={moneda === "USD"} placeholder="0" className={`${INPUT} py-2 text-right tabular-nums`} />
        </label>
        <label className="block">
          <span className={ET}>Nuevo precio de venta <span className="font-normal text-slate-400">(opcional)</span></span>
          <MontoInput value={l.precioNuevo || ""} onChange={(v) => onCambiar({ precioNuevo: v })} decimals={false} placeholder={Number(l.prod.precio_venta).toLocaleString("es-PY")} className={`${INPUT} py-2 text-right tabular-nums`} />
        </label>
      </div>

      {l.prod.controla_stock && l.prod.controla_lotes ? (
        <div className="mt-2 grid grid-cols-3 gap-2 rounded-lg bg-slate-50/70 p-2">
          <label className="block">
            <span className={ET}>Lote <span className="font-normal text-slate-400">(editable)</span></span>
            <input value={l.lote} onChange={(e) => onCambiar({ lote: e.target.value.slice(0, 40) })} placeholder={loteAutomatico(hoyPY())} className={`${INPUT} bg-white py-2 font-mono uppercase`} />
          </label>
          <label className="block">
            <span className={ET}>Vencimiento *</span>
            <input type="date" value={l.vencimiento} onChange={(e) => onCambiar({ vencimiento: e.target.value })} className={`${INPUT} bg-white py-2 ${l.vencimiento ? "" : "border-amber-300"}`} />
          </label>
          <p className="self-end pb-2 text-[11px] text-slate-500">
            {!l.vencimiento ? "Cargá el vencimiento de este lote."
              : l.vencimiento < hoyPY() ? <span className="font-semibold text-rose-600">Esa fecha ya pasó: el lote entra vencido.</span>
              : "Para otro lote del mismo producto, agregalo de nuevo."}
          </p>
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
        <span className="flex items-center gap-2">
          {l.ultima ? (
            <>Última compra: <strong className="font-semibold text-slate-700">{gs(l.ultima.costo)}</strong>{l.ultima.proveedor ? ` · ${l.ultima.proveedor}` : ""}{variacion != null ? <Variacion pct={variacion} /> : null}</>
          ) : <>Primera compra de este producto.</>}
        </span>
        {margen != null ? (
          <span className={margen < 0 ? "font-semibold text-rose-600" : margen < 15 ? "font-semibold text-amber-600" : "text-slate-500"}>
            {l.precioNuevo > 0 ? "Margen con el precio nuevo" : `Margen a ${gs(precio)}`}: {margen.toLocaleString("es-PY")} %{margen < 0 ? " · vendés a pérdida" : ""}
          </span>
        ) : null}
      </div>
    </li>
  );
}

