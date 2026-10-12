"use client";

/** Transferir la conversación a otro usuario de la empresa (o dejarla sin asignar). */
import { useMemo, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { filtrar } from "@/lib/busqueda";
import { accionConversacion } from "@/modules/conversaciones/api";
import type { FilaBandeja } from "@/modules/conversaciones/dominio";
import { AvisoError, Ventana } from "@/modules/conversaciones/ui";

export function ModalTransferir({
  conv,
  equipo,
  yo,
  onCerrar,
  onListo,
}: {
  conv: FilaBandeja;
  equipo: { id: string; nombre: string; rol: string }[];
  yo: string;
  onCerrar: () => void;
  onListo: (f: FilaBandeja) => void;
}) {
  const [q, setQ] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lista = useMemo(() => filtrar(equipo, q, (u) => ({ principal: u.nombre, otros: [u.rol] })), [equipo, q]);

  const correr = async (clave: string, fn: () => Promise<FilaBandeja>) => {
    setOcupado(clave);
    setError(null);
    try {
      onListo(await fn());
    } catch (e) {
      setError((e as Error).message);
      setOcupado(null);
    }
  };

  return (
    <Ventana titulo="Transferir conversación" detalle="Elegí a quién pasarle el chat. Le aparece en su pestaña Mías." icono={ArrowLeftRight} onCerrar={onCerrar} ancho="max-w-lg" z="z-[115]">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-500">Agentes</label>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar"
          autoFocus
          className="w-full max-w-[14rem] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
        />
      </div>
      <div className="max-h-[min(42vh,320px)] divide-y divide-slate-100 overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-slate-50/40">
        {lista.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-500">No hay agentes para mostrar.</p>
        ) : (
          lista.map((a) => {
            const actual = a.id === conv.asignado_id;
            return (
              <div key={a.id} className={`flex items-center justify-between gap-2 px-4 py-3 ${actual ? "bg-emerald-50/80" : ""}`}>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold leading-snug text-slate-900">
                    {a.nombre}
                    {a.id === yo ? <span className="ml-1 text-[11px] font-normal text-slate-400">(vos)</span> : null}
                  </span>
                  <span className="text-[11px] text-slate-500">{a.rol}</span>
                </span>
                <button
                  type="button"
                  disabled={!!ocupado || actual}
                  onClick={() => void correr(a.id, () => accionConversacion(conv.id, { accion: "transferir", asignado_id: a.id }))}
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors disabled:pointer-events-none ${
                    actual ? "bg-emerald-100 text-emerald-700" : "bg-[#4FAEB2] text-white hover:bg-[#3F8E91] disabled:opacity-50"
                  }`}
                >
                  {actual ? "Asignado" : ocupado === a.id ? "…" : "Transferir"}
                </button>
              </div>
            );
          })
        )}
      </div>
      {conv.asignado_id ? (
        <button
          type="button"
          disabled={!!ocupado}
          onClick={() => void correr("soltar", () => accionConversacion(conv.id, { accion: "soltar" }))}
          className="mt-3 text-xs font-semibold text-slate-500 underline-offset-2 hover:text-[#3F8E91] hover:underline disabled:opacity-50"
        >
          Dejar sin asignar
        </button>
      ) : null}
      <AvisoError>{error}</AvisoError>
    </Ventana>
  );
}
