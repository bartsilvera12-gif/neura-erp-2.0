"use client";

/**
 * Pestaña "Suscripciones" de la ficha (copia del sistema actual): tabla con Plan, Precio,
 * Moneda, Inicio, Meses, Día fact., Día venc., Estado y acciones con texto (Ver facturación,
 * Cambiar plan, Pausar / Reactivar, Cancelar). Los modales viven acá; al cambiar algo se
 * avisa a la ficha para que recargue (facturación, estado de cuenta y actividad).
 */
import { useState } from "react";
import { CalendarClock, ChevronDown, Plus } from "lucide-react";
import { MenuAcciones, type ItemMenu } from "@/components/MenuAcciones";
import { TEAL } from "@/modules/clientes/ui";
import type { EstadoSuscripcion, SuscripcionCliente } from "@/modules/clientes/suscripciones/tipos";
import { BadgeSuscripcion, fechaDia, mesActual, monto, nombreMes } from "@/modules/clientes/suscripciones/ui";
import { ModalFacturacion } from "@/modules/clientes/suscripciones/ModalFacturacion";
import { ModalCambioPlan } from "@/modules/clientes/suscripciones/ModalCambioPlan";
import { ModalEstado } from "@/modules/clientes/suscripciones/ModalEstado";

export function TabSuscripciones({ clienteNombre, suscripciones, cargando, error, rol, onNueva, onCambio }: {
  clienteNombre: string;
  suscripciones: SuscripcionCliente[];
  cargando: boolean;
  error: string | null;
  rol: string | undefined;
  onNueva: () => void;
  /** algo cambió: la ficha recarga; `mensaje` se muestra como aviso */
  onCambio: (mensaje?: string) => Promise<void> | void;
}) {
  const puedeOperar = rol === "ADMIN" || rol === "VENDEDOR";
  const esAdmin = rol === "ADMIN";
  const [facturando, setFacturando] = useState<string | null>(null);
  const [cambiando, setCambiando] = useState<string | null>(null);
  const [estado, setEstado] = useState<{ id: string; plan: string; estado: EstadoSuscripcion } | null>(null);
  const actual = mesActual();

  const viendo = suscripciones.find((s) => s.suscripcion_id === facturando) ?? null;
  const aCambiar = suscripciones.find((s) => s.suscripcion_id === cambiando) ?? null;

  function items(s: SuscripcionCliente): ItemMenu[] {
    const lista: ItemMenu[] = [{ etiqueta: "Ver facturación", onClick: () => setFacturando(s.suscripcion_id) }];
    if (!puedeOperar || s.estado === "cancelada") return lista;
    lista.push({ etiqueta: "Cambiar plan", onClick: () => setCambiando(s.suscripcion_id) });
    if (s.estado === "activa") lista.push({ etiqueta: "Pausar", tono: "peligro", onClick: () => setEstado({ id: s.suscripcion_id, plan: s.plan, estado: "pausada" }) });
    if (s.estado === "pausada") lista.push({ etiqueta: "Reactivar", tono: "exito", onClick: () => setEstado({ id: s.suscripcion_id, plan: s.plan, estado: "activa" }) });
    if (esAdmin) lista.push({ etiqueta: "Cancelar", tono: "peligro", onClick: () => setEstado({ id: s.suscripcion_id, plan: s.plan, estado: "cancelada" }) });
    return lista;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Suscripciones</h3>
          <p className="text-xs text-slate-500">Lo que este cliente paga todos los meses. Cada cuota se emite con un botón y queda en su cuenta a cobrar.</p>
        </div>
        {puedeOperar ? (
          <button type="button" onClick={onNueva}
            className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-95"
            style={{ backgroundColor: TEAL }}>
            <Plus className="h-4 w-4" /> Nueva suscripción
          </button>
        ) : null}
      </div>

      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      {cargando && suscripciones.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">Cargando suscripciones…</p>
      ) : suscripciones.length === 0 ? (
        <p className="py-10 text-center text-sm italic text-slate-400">Este cliente no tiene suscripciones.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/80">
              <tr className="text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                {["Plan", "Precio", "Moneda", "Inicio", "Meses", "Día fact.", "Día venc.", "Cuota del mes", "Estado"].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-2.5">{h}</th>
                ))}
                <th className="px-4 py-2.5 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className={`divide-y divide-slate-100 ${cargando ? "opacity-60" : ""}`}>
              {suscripciones.map((s) => {
                const mes = s.meses.find((m) => m.periodo.slice(0, 7) === actual);
                return (
                  <tr key={s.suscripcion_id} className={`hover:bg-slate-50/70 ${s.estado === "cancelada" ? "opacity-60" : ""}`}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-800">{s.plan}</p>
                      {s.plan_pendiente && s.pendiente_desde ? (
                        <span className="mt-1 flex w-fit items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                          <CalendarClock className="h-3 w-3" />
                          Desde {nombreMes(s.pendiente_desde)} pasa a {s.plan_pendiente}
                          {s.precio_pendiente != null ? ` · ${monto(s.precio_pendiente, s.moneda)}` : ""}
                        </span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-semibold tabular-nums text-slate-800">{monto(s.precio, s.moneda)}</td>
                    <td className="px-4 py-3 text-slate-600">{s.moneda}</td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">{fechaDia(s.fecha_inicio)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{s.duracion_meses ?? <span className="text-slate-400">Sin fin</span>}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-600">{s.dia_facturacion}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-600">{s.dia_vencimiento}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs">
                      {mes?.venta_id ? (
                        <span className={mes.estado === "pagada" ? "font-semibold text-emerald-700" : mes.estado === "vencida" ? "font-semibold text-rose-600" : "text-slate-700"}>
                          {mes.estado === "pagada" ? "Pagada" : mes.estado === "vencida" ? "Vencida" : "Emitida"} <span className="font-mono text-slate-500">{mes.numero}</span>
                        </span>
                      ) : mes && s.estado === "activa" ? (
                        <span className="font-medium text-amber-700">Pendiente de emitir</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3"><BadgeSuscripcion estado={s.estado} /></td>
                    <td className="px-4 py-3 text-right">
                      <MenuAcciones items={items(s)} etiqueta={`Acciones de ${s.plan}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]">
                        Acciones <ChevronDown className="h-3.5 w-3.5" />
                      </MenuAcciones>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {viendo ? (
        <ModalFacturacion clienteNombre={clienteNombre} suscripcion={viendo} puedeEmitir={puedeOperar}
          onClose={() => setFacturando(null)} onCambio={() => onCambio()} />
      ) : null}
      {aCambiar ? (
        <ModalCambioPlan suscripcion={aCambiar} onClose={() => setCambiando(null)}
          onHecho={(m) => { setCambiando(null); void onCambio(m); }} />
      ) : null}
      {estado ? (
        <ModalEstado suscripcionId={estado.id} plan={estado.plan} estado={estado.estado} onClose={() => setEstado(null)}
          onHecho={(m) => { setEstado(null); void onCambio(m); }} />
      ) : null}
    </div>
  );
}
