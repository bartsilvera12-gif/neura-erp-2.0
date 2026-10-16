"use client";

/**
 * Pestaña "Suscripciones" de la ficha, igual que el sistema actual: título "Suscripciones"
 * con "Nueva suscripción" y la tabla Plan, Precio, Moneda, Inicio, Meses, Día fact.,
 * Día venc., Estado y Acción. El cambio de plan programado se marca bajo el plan.
 * En Acción quedan las funciones del 2.0 (Ver facturación, Cambiar plan, Pausar /
 * Reactivar, Cancelar); los modales viven acá y al cambiar algo se avisa a la ficha.
 * Responsive: en celular cada suscripción es una tarjeta (tocarla abre su facturación).
 */
import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { MenuAcciones, type ItemMenu } from "@/components/MenuAcciones";
import { TablaTarjetas, useVistaTarjetas, type ColumnaTabla } from "@/components/TablaResponsive";
import { TEAL } from "@/modules/clientes/ui";
import type { EstadoSuscripcion, SuscripcionCliente } from "@/modules/clientes/suscripciones/tipos";
import { fechaDia } from "@/modules/clientes/suscripciones/ui";
import { ModalFacturacion } from "@/modules/clientes/suscripciones/ModalFacturacion";
import { ModalCambioPlan } from "@/modules/clientes/suscripciones/ModalCambioPlan";
import { ModalEstado } from "@/modules/clientes/suscripciones/ModalEstado";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">{children}</p>;
}

const TH = "whitespace-nowrap px-4 py-3 text-left text-xs font-semibold text-slate-600";
const TD = "px-4 py-3";

const numero = (v: number, moneda: string) =>
  Number(v || 0).toLocaleString("es-PY", moneda === "USD" ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 });

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
  const vistaTarjetas = useVistaTarjetas();

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

  const columnas: ColumnaTabla<SuscripcionCliente>[] = [
    {
      key: "plan", titulo: "Plan", movil: "titulo", claseTd: "font-medium text-slate-800",
      celda: (s) => (
        <>
          {s.plan || "—"}
          {s.pendiente_desde ? (
            <span className="mt-1 flex w-fit max-w-full items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
              🗓️ Cambio programado desde {fechaDia(s.pendiente_desde)}
              {s.plan_pendiente ? ` a ${s.plan_pendiente}` : ""}
              {s.precio_pendiente != null ? ` · ${s.moneda} ${numero(s.precio_pendiente, s.moneda)}` : ""}
            </span>
          ) : null}
        </>
      ),
    },
    {
      key: "precio", titulo: "Precio", movil: "valor", claseTd: "whitespace-nowrap text-slate-600",
      celda: (s) => numero(s.precio, s.moneda),
      celdaMovil: (s) => `${s.moneda === "USD" ? "US$" : "Gs."} ${numero(s.precio, s.moneda)}`,
    },
    { key: "moneda", titulo: "Moneda", movil: "oculto", claseTd: "text-slate-600", celda: (s) => s.moneda },
    { key: "inicio", titulo: "Inicio", movil: "dato", claseTd: "whitespace-nowrap text-slate-600", celda: (s) => fechaDia(s.fecha_inicio) },
    { key: "meses", titulo: "Meses", movil: "dato", claseTd: "text-slate-600", celda: (s) => s.duracion_meses ?? "—" },
    { key: "fact", titulo: "Día fact.", movil: "dato", claseTd: "text-slate-600", celda: (s) => s.dia_facturacion },
    { key: "venc", titulo: "Día venc.", movil: "dato", claseTd: "text-slate-600", celda: (s) => s.dia_vencimiento },
    {
      key: "estado", titulo: "Estado", movil: "chip",
      celda: (s) => (
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.estado === "activa" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>{s.estado}</span>
      ),
    },
    {
      key: "acc", titulo: "Acción", movil: "acciones", claseTh: "text-right", claseTd: "text-right",
      celda: (s) => (
        <MenuAcciones items={items(s)} etiqueta={`Acciones de ${s.plan}`}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 transition-colors hover:border-[#4FAEB2]/60 hover:bg-slate-50 hover:text-[#4FAEB2]">
          <MoreHorizontal className="h-4 w-4" />
        </MenuAcciones>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <SectionTitle>Suscripciones</SectionTitle>
        {puedeOperar ? (
          <button
            type="button"
            onClick={onNueva}
            className="min-h-11 shrink-0 text-white px-4 py-2 rounded-lg text-sm font-medium transition hover:brightness-95 sm:min-h-0"
            style={{ backgroundColor: TEAL }}
          >
            Nueva suscripción
          </button>
        ) : null}
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {cargando && suscripciones.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">Cargando suscripciones…</p>
      ) : suscripciones.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">No hay suscripciones.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <TablaTarjetas filas={suscripciones} columnas={columnas} claveFila={(s) => s.suscripcion_id}
            onFila={vistaTarjetas ? (s) => setFacturando(s.suscripcion_id) : undefined}
            claseThead="bg-slate-50" claseFila={() => "hover:bg-slate-50"} cargando={cargando} thBase={TH} tdBase={TD} />
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
