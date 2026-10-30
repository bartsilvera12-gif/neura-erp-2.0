"use client";

/** Historial de un presupuesto, con el mismo diseño que el historial del cliente (LineaTiempo). */
import { EventoDatos, EventoMotivo, EventoTarjeta, LineaTiempo } from "@/components/LineaTiempo";
import { monto, type Presupuesto, type PresupuestoEvento } from "@/modules/presupuestos/tipos";

const VERDE = "bg-emerald-100 text-emerald-700";
const CELESTE = "bg-sky-100 text-sky-700";
const GRIS = "bg-slate-200 text-slate-700";
const ROJO = "bg-rose-100 text-rose-700";
const VIOLETA = "bg-violet-100 text-violet-700";
const AMBAR = "bg-amber-100 text-amber-700";

const CANAL: Record<string, string> = { whatsapp: "WhatsApp", link: "link", email: "email", caja: "la caja" };

/** Etiqueta y color del evento. */
function metaEvento(ev: PresupuestoEvento, estabaVencido: boolean): { label: string; color: string } {
  switch (ev.tipo) {
    case "creado": return { label: "Creado", color: VERDE };
    case "editado": return { label: "Editado", color: CELESTE };
    case "revision": return { label: `Revisión ${ev.revision ?? ""}`.trim(), color: CELESTE };
    case "enviado": return { label: ev.canal && CANAL[ev.canal] ? "Enviado" : "Marcado como enviado", color: CELESTE };
    case "reenviado": return { label: "Compartido de nuevo", color: CELESTE };
    case "visto": return { label: "Visto por el cliente", color: VIOLETA };
    case "pdf": return { label: "PDF descargado", color: GRIS };
    case "aceptado": return { label: ev.canal === "link" ? "Aceptado por el cliente" : `Marcado como aceptado${estabaVencido ? " (estaba vencido)" : ""}`, color: VERDE };
    case "rechazado": return { label: ev.canal === "link" ? "Rechazado por el cliente" : "Rechazado", color: ROJO };
    case "reabierto": return { label: "Reabierto", color: AMBAR };
    case "convertido": return { label: "Convertido en venta", color: VERDE };
    case "venta_anulada": return { label: "Venta anulada", color: ROJO };
    case "producto_vinculado": return { label: "Producto vinculado", color: CELESTE };
    default: return { label: ev.tipo, color: GRIS };
  }
}

/** La línea de detalle del evento, si tiene algo que agregar a la etiqueta. */
function detalleEvento(ev: PresupuestoEvento, p: Presupuesto): React.ReactNode {
  const d = (ev.detalle ?? {}) as Record<string, string | number | null>;
  switch (ev.tipo) {
    case "creado": return d.duplicado_de ? <>Copia de <b className="font-mono font-semibold">{d.duplicado_de}</b></> : null;
    case "revision": return `Antes: ${monto(Number(d.total_anterior), p.moneda)}`;
    case "enviado": case "reenviado": return ev.canal && CANAL[ev.canal] ? `Por ${CANAL[ev.canal]}` : null;
    case "convertido": return <>Venta <b className="font-mono font-semibold">{d.numero_control}</b></>;
    case "venta_anulada": return <>Se anuló la venta <b className="font-mono font-semibold">{d.numero_control}</b>: vuelve a aceptado</>;
    case "producto_vinculado": return <>«{d.linea}» ligada al producto <b className="font-semibold">{d.producto}</b></>;
    default: return null;
  }
}

export function HistorialPresupuesto({ p }: { p: Presupuesto }) {
  if (!p.eventos.length) return <p className="text-sm italic text-slate-400">Todavía no hay movimientos en este presupuesto.</p>;
  return (
    <LineaTiempo eventos={p.eventos} clave={(ev) => ev.id} fecha={(ev) => ev.created_at} render={(ev) => {
      const d = (ev.detalle ?? {}) as Record<string, string | number | boolean | null>;
      const meta = metaEvento(ev, !!d.estaba_vencido);
      const detalle = detalleEvento(ev, p);
      // Lo que hizo el cliente desde el link: "Por" es quien aceptó, si dejó su nombre.
      const por = ev.usuario_nombre ?? (ev.canal === "link" ? (d.nombre ? String(d.nombre) : "Cliente") : null);
      return (
        <EventoTarjeta etiqueta={meta.label} color={meta.color} fecha={ev.created_at}>
          {detalle ? <p className="mt-2 text-sm text-slate-800">{detalle}</p> : null}
          <EventoDatos filas={[["Por", por]]} />
          {ev.tipo === "rechazado" && d.motivo ? <EventoMotivo>{String(d.motivo)}</EventoMotivo> : null}
        </EventoTarjeta>
      );
    }} />
  );
}
