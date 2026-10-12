"use client";

/**
 * Lectura de un chat (Monitoreo, Finalizadas, Historial omnicanal): el MISMO hilo de la
 * bandeja (últimos 50 + "ver anteriores", en vivo por Realtime) pero sin caja de escritura
 * ni botón Responder. Arriba se puede sumar un bloque (p. ej. el cierre) y acciones.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { MessagesSquare } from "lucide-react";
import { telefonoLegible } from "@/modules/conversaciones/dominio";
import { useHilo } from "@/modules/conversaciones/useHilo";
import { Hilo } from "@/modules/conversaciones/Hilo";
import { Ventana } from "@/modules/conversaciones/ui";

const nada = () => {};

export function VisorChat({
  convId,
  nombre,
  telefono,
  detalle,
  arriba,
  acciones,
  onCerrar,
}: {
  convId: string;
  nombre: string | null;
  telefono: string | null;
  /** Línea bajo el título (si no, el teléfono). */
  detalle?: string;
  /** Bloque sobre el hilo (cierre, datos del chat…). */
  arriba?: ReactNode;
  /** Botones al pie (Reabrir…). "Abrir en la bandeja" va siempre. */
  acciones?: ReactNode;
  onCerrar: () => void;
}) {
  const hilo = useHilo(convId, null);
  return (
    <Ventana
      titulo={nombre?.trim() || telefonoLegible(telefono)}
      detalle={detalle ?? (nombre?.trim() ? telefonoLegible(telefono) : "Lectura del chat")}
      icono={MessagesSquare}
      onCerrar={onCerrar}
      ancho="max-w-2xl"
      z="z-[120]"
    >
      {arriba ? <div className="mb-3">{arriba}</div> : null}
      <div className="flex h-[min(58vh,520px)] flex-col overflow-hidden rounded-xl border border-slate-200">
        <Hilo
          convId={convId}
          mensajes={hilo.mensajes}
          hayMas={hilo.hayMas}
          cargando={hilo.cargando}
          cargandoAnteriores={hilo.cargandoAnteriores}
          error={hilo.error}
          ultimoId={hilo.ultimoId}
          cargarAnteriores={hilo.cargarAnteriores}
          onReintentar={nada}
          onDescartar={nada}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-slate-400">Solo lectura · se actualiza en vivo</span>
        <div className="flex flex-wrap items-center gap-2">
          {acciones}
          <Link
            href={`/conversaciones?c=${convId}`}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-[#4FAEB2]/60 hover:text-[#3F8E91]"
          >
            Abrir en la bandeja →
          </Link>
        </div>
      </div>
    </Ventana>
  );
}
