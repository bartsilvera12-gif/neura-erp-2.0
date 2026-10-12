"use client";

/**
 * Finalizar la conversación con su tipificación (Estado → Sub-estado del catálogo de
 * Tipificación + comentario). Si el sub-estado crea ticket, se elige la clasificación y el
 * ticket de Soporte sale junto con el cierre. El catálogo viene cacheado: el modal abre al instante.
 */
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Headset } from "lucide-react";
import { finalizar, pedirCatalogoCierre, type CatalogoCierre } from "@/modules/conversaciones/api";
import type { FilaBandeja } from "@/modules/conversaciones/dominio";
import { numeroTicket } from "@/modules/tipificacion/dominio";
import { AvisoError, Ventana, botonPrimario, botonSecundario, claseCampo, claseEtiqueta } from "@/modules/conversaciones/ui";

export function ModalFinalizar({ conv, onCerrar, onListo }: { conv: FilaBandeja; onCerrar: () => void; onListo: (f: FilaBandeja | null, aviso: string) => void }) {
  const [cat, setCat] = useState<CatalogoCierre | null>(null);
  const [familia, setFamilia] = useState("");
  const [sub, setSub] = useState("");
  const [clas, setClas] = useState("");
  const [obs, setObs] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    pedirCatalogoCierre()
      .then((c) => {
        setCat(c);
        setFamilia(c.familias[0]?.id ?? "");
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const fam = cat?.familias.find((f) => f.id === familia) ?? null;
  const subestado = fam?.subestados.find((s) => s.id === sub) ?? null;
  const tipoTicket = subestado?.comportamiento === "ticket_error" ? "error" : subestado?.comportamiento === "ticket_cambio" ? "cambio" : null;
  const clasificaciones = useMemo(() => (tipoTicket ? (cat?.clasificaciones ?? []).filter((c) => c.tipo_codigo === tipoTicket) : []), [cat, tipoTicket]);
  const bloqueoTicket = tipoTicket ? (!conv.cliente_id ? "Ese sub-estado crea un ticket: primero vinculá un cliente (Ficha)." : !cat?.puede_soporte ? "Tu usuario no puede cargar tickets de Soporte." : null) : null;

  const listo = !!familia && !!sub && !!obs.trim() && !bloqueoTicket && (!tipoTicket || !clasificaciones.length || !!clas);

  const confirmar = async () => {
    setGuardando(true);
    setError(null);
    try {
      const r = await finalizar(conv.id, {
        familia_id: familia,
        estado_id: sub,
        observacion: obs.trim(),
        ticket: tipoTicket ? { clasificacion_codigo: clas || null } : null,
      });
      onListo(r.fila, r.ticket ? `Conversación finalizada · Ticket ${numeroTicket(r.ticket.numero)} creado` : "Conversación finalizada");
    } catch (e) {
      setError((e as Error).message);
      setGuardando(false);
    }
  };

  return (
    <Ventana titulo="Finalizar conversación" detalle="El resultado queda en el historial. Todos los campos son obligatorios." icono={CheckCircle2} onCerrar={() => !guardando && onCerrar()}>
      {!cat && !error ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i}>
              <span className="mb-1.5 block h-2.5 w-20 animate-pulse rounded bg-slate-100" />
              <span className="block h-10 animate-pulse rounded-xl bg-slate-100" />
            </div>
          ))}
          <span className="block h-20 animate-pulse rounded-xl bg-slate-100" />
        </div>
      ) : cat && cat.familias.length === 0 ? (
        <p className="text-sm text-red-700">No hay estados de tipificación configurados (Clientes › Tipificaciones).</p>
      ) : cat ? (
        <div className="space-y-3">
          <div>
            <label className={claseEtiqueta}>Estado</label>
            <select className={claseCampo} value={familia} onChange={(e) => (setFamilia(e.target.value), setSub(""), setClas(""))}>
              {cat.familias.map((f) => (
                <option key={f.id} value={f.id}>{f.nombre}</option>
              ))}
            </select>
          </div>
          {fam && fam.subestados.length ? (
            <div>
              <label className={claseEtiqueta}>Subestado</label>
              <select className={claseCampo} value={sub} onChange={(e) => (setSub(e.target.value), setClas(""))}>
                <option value="">Elegir…</option>
                {fam.subestados.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                    {s.comportamiento === "ticket_error" || s.comportamiento === "ticket_cambio" ? " · crea ticket" : ""}
                  </option>
                ))}
              </select>
            </div>
          ) : fam ? (
            <p className="text-xs text-amber-700">Este estado no tiene sub-estados activos.</p>
          ) : null}
          {tipoTicket ? (
            <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-violet-800">
                <Headset className="h-4 w-4" /> Se crea un ticket de Soporte ({tipoTicket === "error" ? "Error" : "Cambio"})
              </p>
              {bloqueoTicket ? (
                <p className="text-xs text-red-700">{bloqueoTicket}</p>
              ) : clasificaciones.length ? (
                <select className={claseCampo} value={clas} onChange={(e) => setClas(e.target.value)}>
                  <option value="">Clasificación…</option>
                  {clasificaciones.map((c) => (
                    <option key={c.codigo} value={c.codigo}>
                      {c.nombre}
                      {c.sla_horas ? ` · SLA ${c.sla_horas} h` : ""}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          ) : null}
          <div>
            <label className={claseEtiqueta}>Comentario</label>
            <textarea
              className={`${claseCampo} min-h-[88px] resize-y`}
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              placeholder={tipoTicket ? "Describí el pedido: la primera línea es el asunto del ticket." : "Resumí el resultado o próximos pasos para el equipo."}
            />
          </div>
          {!conv.cliente_id ? (
            <p className="rounded-lg border border-amber-100 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
              El contacto no tiene cliente vinculado: se cierra la conversación, pero la tipificación no queda en la ficha de ningún cliente.
            </p>
          ) : null}
        </div>
      ) : null}
      <AvisoError>{error}</AvisoError>
      <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
        <button type="button" disabled={guardando} onClick={onCerrar} className={botonSecundario}>Cancelar</button>
        <button type="button" disabled={guardando || !listo} onClick={() => void confirmar()} className={botonPrimario}>
          {guardando ? "Guardando…" : "Confirmar finalización"}
        </button>
      </div>
    </Ventana>
  );
}
