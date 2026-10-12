"use client";

/** Descripción del ticket: qué pasa, las revisiones de QA y la conversación del equipo. */
import { MessageSquare } from "lucide-react";
import { useTicket } from "@/modules/soporte/detalle/TicketContexto";
import ComentariosTicket from "@/modules/soporte/detalle/ComentariosTicket";
import SubtareasTicket from "@/modules/soporte/detalle/SubtareasTicket";
import { IconoTile } from "@/modules/soporte/ui";

function Bloque({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="mt-4 border-t border-slate-100 pt-3">
      <h4 className="text-[12.5px] font-bold uppercase tracking-wide text-slate-400">{titulo}</h4>
      <p className="mt-1 whitespace-pre-line text-[14px] leading-relaxed text-slate-600">{texto}</p>
    </div>
  );
}

export default function TicketDescripcionPage() {
  const { ticket: t, contadores } = useTicket();
  return (
    <div>
      <section className="rounded-xl border border-slate-200/80 bg-white px-5 py-4">
        <h3 className="text-[15px] font-bold text-slate-800">Descripción del problema</h3>
        {t.descripcion ? (
          <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-slate-600">{t.descripcion}</p>
        ) : (
          <p className="mt-2 text-[13px] italic text-slate-400">Sin descripción.</p>
        )}
        {t.resultado_esperado ? <Bloque titulo="Resultado esperado" texto={t.resultado_esperado} /> : null}
        {t.impacto_operativo ? <Bloque titulo="Impacto operativo" texto={t.impacto_operativo} /> : null}
        {t.proxima_accion ? <Bloque titulo="Próxima acción" texto={t.proxima_accion} /> : null}
      </section>

      <SubtareasTicket />

      <div id="comentarios" className="mt-5 flex scroll-mt-24 gap-3.5">
        <IconoTile icono={MessageSquare} tono="violeta" tam="sm" />
        <div className="min-w-0 flex-1">
          <h3 className="mb-3 text-[13.5px] font-bold text-slate-800">
            Comentarios{contadores.comentarios ? <span className="ml-1.5 font-semibold text-slate-400">{contadores.comentarios}</span> : null}
          </h3>
          <ComentariosTicket enTarjeta={false} />
        </div>
      </div>
    </div>
  );
}
