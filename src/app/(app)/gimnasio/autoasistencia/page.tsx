"use client";

/**
 * /gimnasio/autoasistencia — Que el alumno marque solo (receta 155): cada alumno tiene SU link. Con él
 * reserva sus clases, las cancela y marca su asistencia desde donde esté, sin CI ni PIN. Acá se busca
 * al alumno y se le manda el link por WhatsApp (también está en su card de Recepción).
 */
import { useState } from "react";
import { CalendarCheck } from "lucide-react";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { ET } from "@/modules/inventario/ui";
import { ClienteSelect, type ClienteOpcion } from "@/modules/agenda/ui/components/ClienteSelect";
import { LinkAlumno } from "@/modules/gimnasio/ui";

export default function AutoasistenciaPage() {
  const [alumno, setAlumno] = useState<ClienteOpcion | null>(null);
  return (
    <div className="space-y-4 pb-10">
      <EncabezadoPagina kicker="Asistencia" titulo="Que el alumno marque solo" volver={{ href: "/gimnasio/panel", label: "Asistencia" }}
        subtitulo="Cada alumno tiene su link: con él reserva sus clases y marca su asistencia desde el celular, sin claves." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
          <label className="block">
            <span className={ET}>Alumno</span>
            <ClienteSelect valor={alumno} onChange={setAlumno} />
          </label>
          {alumno ? <LinkAlumno key={alumno.id} clienteId={alumno.id} conCambiar /> : (
            <p className="rounded-xl bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">Buscá al alumno para mandarle su link.</p>
          )}
        </section>
        <section className="space-y-2 rounded-2xl border border-slate-200 bg-white p-5 text-sm leading-relaxed text-slate-600">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><CalendarCheck className="h-4 w-4 text-slate-400" /> Qué puede hacer el alumno</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li><span className="font-medium text-slate-800">Reservar</span> las clases de los próximos 7 días, si hay lugar.</li>
            <li><span className="font-medium text-slate-800">Cancelar</span> su reserva antes de que empiece la clase.</li>
            <li><span className="font-medium text-slate-800">Marcar su asistencia</span> el día de la clase, desde una hora antes, esté donde esté. O una <span className="font-medium text-slate-800">Entrada libre</span> por día.</li>
          </ul>
          <p>Marcar cuenta como asistencia en el momento: descuenta su membresía o queda la clase suelta para pagar en caja. Las reservas aparecen en Recepción como confirmadas.</p>
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">Con una cuota vencida puede reservar, pero no marcar: le pide pasar por recepción.</p>
        </section>
      </div>
    </div>
  );
}
