"use client";

/**
 * "Convertir a venta": antes de ir a la Caja muestra TODO lo que hay que saber —precios de
 * lista que cambiaron desde que se cotizó, stock que no alcanza, productos inactivos y
 * líneas libres (no son productos: la caja no las vende). Una línea libre se puede ligar
 * a un producto existente o crear el producto (administrador) sin salir de acá.
 * Nada se hace solo: la venta se confirma en la Caja como siempre.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Ban, CircleDollarSign, Link2, Loader2, PackagePlus, PackageX, ShoppingCart, UserRound } from "lucide-react";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import { apiFetch } from "@/lib/api/client-fetch";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import { clienteConfig } from "@/cliente.config";
import { BuscadorProductos } from "@/modules/compras/partes";
import { ProductoForm } from "@/modules/inventario/ProductoForm";
import { analizarConversion, type AnalisisConversion, type ConversionPresupuesto } from "@/modules/presupuestos/caja";
import { cantidad, condicionTexto, diaCorto, monto, numeroConRevision } from "@/modules/presupuestos/tipos";

const TEAL = clienteConfig.color;

export function ModalConvertir({ presupuestoId, validoHasta, onClose, onCambio }: {
  presupuestoId: string;
  validoHasta: string;
  onClose: () => void;
  /** se ligó una línea a un producto: la ficha se refresca */
  onCambio: () => void;
}) {
  const router = useRouter();
  const esAdmin = useUsuario()?.rol === "ADMIN";
  const [conv, setConv] = useState<ConversionPresupuesto | null>(null);
  const [a, setA] = useState<AnalisisConversion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [eligiendo, setEligiendo] = useState<string | null>(null);   // item_id de la línea libre
  const [creando, setCreando] = useState<{ itemId: string; nombre: string } | null>(null);
  const [ligando, setLigando] = useState(false);

  const cargar = useCallback(() => {
    apiFetch<ConversionPresupuesto>(`/api/presupuestos/${presupuestoId}/conversion`)
      .then((c) => { setConv(c); setA(analizarConversion(c)); })
      .catch((e) => setError((e as Error).message));
  }, [presupuestoId]);
  useEffect(() => { cargar(); }, [cargar]);

  async function ligar(itemId: string, productoId: string) {
    setLigando(true);
    setError(null);
    try {
      await apiFetch(`/api/presupuestos/${presupuestoId}/accion`, { method: "POST", body: JSON.stringify({ accion: "vincular_producto", item_id: itemId, producto_id: productoId }) });
      setEligiendo(null);
      cargar();
      onCambio();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLigando(false);
    }
  }

  const p = conv?.presupuesto;
  const puede = !!a && a.lineas.length > 0 && p?.estado !== "rechazado" && p?.estado !== "convertido";

  return (
    <CapaModal onClose={ligando || creando ? undefined : onClose}>
      <div role="dialog" aria-modal className={`flex w-full max-w-2xl ${ALTO_MAX_MODAL} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl`}>
        <div className="flex shrink-0 items-start gap-3 px-6 pt-6 pb-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-50)] text-[var(--brand)]"><ShoppingCart className="h-5 w-5" /></span>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900">Convertir en venta{p ? ` · ${numeroConRevision(p.numero, p.revision)}` : ""}</h2>
            <p className="mt-0.5 text-sm text-slate-500">Revisá esto antes de ir a la caja. La venta se confirma allá, como siempre.</p>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-2">
          {!a || !p ? (
            error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
              : <p className="flex items-center gap-2 py-6 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Revisando precios y stock…</p>
          ) : (
            <>
              {/* Resumen */}
              <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 sm:grid-cols-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">Pasa a la caja</p>
                  <p className="mt-0.5 text-sm font-semibold text-slate-900">{a.lineas.length} línea{a.lineas.length === 1 ? "" : "s"}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">A cobrar (aprox.)</p>
                  <p className="mt-0.5 text-sm font-bold tabular-nums text-slate-900">{monto(a.totalCaja)}</p>
                  {a.enDolares || a.libres.length || a.inactivos.length ? <p className="text-[11px] text-slate-500">Presupuesto: {monto(p.total, p.moneda)}</p> : null}
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">Condición</p>
                  <p className="mt-0.5 text-sm font-semibold text-slate-900">{condicionTexto(p.condicion, p.plazo_dias)}</p>
                </div>
              </div>

              {p.estado === "rechazado" || p.estado === "convertido" ? (
                <Bloque tono="rojo" icono={<Ban className="h-4 w-4" />} titulo={p.estado === "rechazado" ? "Está rechazado" : "Ya se convirtió en venta"}>
                  {p.estado === "rechazado" ? "Reabrilo si el cliente cambió de idea." : "No se puede convertir dos veces."}
                </Bloque>
              ) : null}

              {conv.cliente ? (
                <Bloque tono="neutro" icono={<UserRound className="h-4 w-4" />} titulo={`Cliente: ${conv.cliente.razon_social || conv.cliente.nombre}`}>
                  Queda elegido en la caja.
                </Bloque>
              ) : (
                <Bloque tono="ambar" icono={<UserRound className="h-4 w-4" />} titulo={`Es un prospecto: ${p.cliente_nombre}`}>
                  En la caja elegí o cargá el cliente (para factura o venta a crédito es obligatorio). Para ticket al contado podés seguir sin cliente.
                </Bloque>
              )}

              {p.estado === "vencido" ? (
                <Bloque tono="ambar" icono={<AlertTriangle className="h-4 w-4" />} titulo={`Venció el ${diaCorto(validoHasta)}`}>
                  Se cobran los precios del presupuesto: confirmalos con el cliente.
                </Bloque>
              ) : null}

              {a.enDolares ? (
                <Bloque tono="neutro" icono={<CircleDollarSign className="h-4 w-4" />} titulo="Está en dólares">
                  La caja cobra en guaraníes: se pasa con la cotización del presupuesto (1 US$ = Gs. {Math.round(p.tipo_cambio).toLocaleString("es-PY")}).
                </Bloque>
              ) : null}

              {a.cambiosPrecio.length ? (
                <Bloque tono="ambar" icono={<AlertTriangle className="h-4 w-4" />} titulo="Cambió el precio de lista desde que cotizaste">
                  <ul className="mt-1 space-y-0.5">
                    {a.cambiosPrecio.map((c) => (
                      <li key={c.item_id} className="tabular-nums"><b className="font-semibold">{c.nombre}</b>: cotizado {monto(c.cotizado)} · lista hoy {monto(c.hoy)}</li>
                    ))}
                  </ul>
                  <p className="mt-1">Se cobra lo cotizado. En la caja podés pasar a los precios de hoy con un clic.</p>
                </Bloque>
              ) : null}

              {a.faltaStock.length ? (
                <Bloque tono="rojo" icono={<PackageX className="h-4 w-4" />} titulo="No alcanza el stock">
                  <ul className="mt-1 space-y-0.5">
                    {a.faltaStock.map((s) => (
                      <li key={s.nombre} className="tabular-nums"><b className="font-semibold">{s.nombre}</b>: pide {cantidad(s.pedido)}, hay {cantidad(s.hay)}</li>
                    ))}
                  </ul>
                  <p className="mt-1">La caja no cobra sin stock: ajustá la cantidad allá o cargá la compra primero.</p>
                </Bloque>
              ) : null}

              {a.inactivos.length ? (
                <Bloque tono="rojo" icono={<Ban className="h-4 w-4" />} titulo="Productos que ya no se venden (no pasan a la caja)">
                  {a.inactivos.map((x) => x.nombre).join(", ")}
                </Bloque>
              ) : null}

              {a.libres.length ? (
                <Bloque tono="ambar" icono={<Link2 className="h-4 w-4" />} titulo="Líneas libres: la caja solo vende productos del catálogo">
                  <p>Ligalas a un producto (o crealo) para que pasen. Si no, quedan afuera y las cobrás aparte.</p>
                  <ul className="mt-2 space-y-2">
                    {a.libres.map((l) => (
                      <li key={l.item_id} className="rounded-xl border border-amber-200 bg-white p-2.5 text-slate-700">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="min-w-0 text-sm"><b className="font-semibold">{l.descripcion}</b> <span className="text-xs text-slate-500">· {cantidad(l.cantidad)} · {monto(l.total)}</span></span>
                          <span className="flex gap-1.5">
                            <button type="button" onClick={() => setEligiendo(eligiendo === l.item_id ? null : l.item_id)} disabled={ligando}
                              className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:border-[var(--brand)] hover:text-[var(--brand)]">
                              Elegir producto
                            </button>
                            {esAdmin ? (
                              <button type="button" onClick={() => setCreando({ itemId: l.item_id, nombre: l.descripcion })} disabled={ligando}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:border-[var(--brand)] hover:text-[var(--brand)]">
                                <PackagePlus className="h-3.5 w-3.5" /> Crear producto
                              </button>
                            ) : null}
                          </span>
                        </div>
                        {eligiendo === l.item_id ? (
                          <div className="mt-2">
                            <BuscadorProductos mostrarPrecio onElegir={(prod) => void ligar(l.item_id, prod.id)} />
                            <p className="mt-1 text-[11px] text-slate-500">Se mantiene la descripción, el precio y el IVA del presupuesto.</p>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </Bloque>
              ) : null}

              {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose} disabled={ligando} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancelar</button>
          <button type="button" disabled={!puede || ligando} onClick={() => router.push(`/caja/nueva?presupuesto=${presupuestoId}`)}
            className="inline-flex items-center gap-2 rounded-xl px-5 py-2 text-sm font-semibold text-white shadow-sm hover:brightness-95 disabled:opacity-40" style={{ backgroundColor: TEAL }}>
            Ir a la caja <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {creando ? (
        <ProductoForm modal inicial={{ nombre: creando.nombre }} onClose={() => setCreando(null)}
          onSaved={(c) => { const itemId = creando.itemId; setCreando(null); if (c?.id) void ligar(itemId, c.id); }} />
      ) : null}
    </CapaModal>
  );
}

function Bloque({ tono, icono, titulo, children }: { tono: "ambar" | "rojo" | "neutro"; icono: React.ReactNode; titulo: string; children: React.ReactNode }) {
  const c = tono === "ambar" ? "border-amber-200 bg-amber-50/70 text-amber-900" : tono === "rojo" ? "border-rose-200 bg-rose-50/70 text-rose-900" : "border-slate-200 bg-white text-slate-700";
  const ic = tono === "ambar" ? "text-amber-600" : tono === "rojo" ? "text-rose-600" : "text-slate-400";
  return (
    <div className={`flex gap-2.5 rounded-xl border px-3.5 py-3 text-xs ${c}`}>
      <span className={`mt-0.5 shrink-0 ${ic}`}>{icono}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{titulo}</p>
        <div className="mt-0.5">{children}</div>
      </div>
    </div>
  );
}
