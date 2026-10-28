"use client";

/** Simular un mensaje entrante por el canal simulador (ADMIN) — para probar sin WhatsApp. */
import { useState } from "react";
import { FlaskConical } from "lucide-react";
import { simularEntrante } from "@/modules/conversaciones/api";
import { AvisoError, Ventana, botonPrimario, botonSecundario, claseCampo, claseEtiqueta } from "@/modules/conversaciones/ui";

export function ModalSimular({ inicial, onCerrar, onListo }: { inicial?: { telefono: string; nombre: string }; onCerrar: () => void; onListo: (conversacionId: string) => void }) {
  const [telefono, setTelefono] = useState(inicial?.telefono ?? "595981");
  const [nombre, setNombre] = useState(inicial?.nombre ?? "");
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const enviar = async () => {
    setEnviando(true);
    setError(null);
    setOk(null);
    try {
      const r = await simularEntrante({ telefono, nombre: nombre.trim() || undefined, texto });
      setOk("Listo: el mensaje ya está en la bandeja. Podés simular otro o cerrar.");
      setTexto("");
      onListo(r.conversacion_id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Ventana titulo="Simular mensaje entrante" detalle="Llega como si el cliente escribiera por WhatsApp (canal simulador)." icono={FlaskConical} onCerrar={onCerrar}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={claseEtiqueta}>Teléfono</label>
            <input className={claseCampo} value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="595981123456" inputMode="tel" />
          </div>
          <div>
            <label className={claseEtiqueta}>Nombre</label>
            <input className={claseCampo} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Juan Pérez" />
          </div>
        </div>
        <div>
          <label className={claseEtiqueta}>Mensaje</label>
          <textarea
            className={`${claseCampo} min-h-[80px]`}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && texto.trim()) {
                e.preventDefault();
                void enviar();
              }
            }}
            placeholder="Hola, quería consultar…"
          />
        </div>
        {ok ? <p className="rounded-lg border border-emerald-100 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-800">{ok}</p> : null}
      </div>
      <AvisoError>{error}</AvisoError>
      <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
        <button type="button" onClick={onCerrar} className={botonSecundario}>Cerrar</button>
        <button type="button" disabled={enviando || !texto.trim() || telefono.replace(/\D/g, "").length < 8} onClick={() => void enviar()} className={botonPrimario}>
          {enviando ? "Enviando…" : "Simular entrante"}
        </button>
      </div>
    </Ventana>
  );
}
