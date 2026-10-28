"use client";

/**
 * Aceptar / Rechazar desde el link público (si la empresa lo permite) y la constancia de
 * que el cliente lo abrió. La vista se registra desde el navegador, así los robots que
 * arman la vista previa de WhatsApp no cuentan como "visto".
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, ThumbsDown, XCircle } from "lucide-react";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import { accionResponder, accionVisto } from "./acciones";

const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function Respuesta({ token, estado, permite, aceptadoAt, rechazadoAt, color }: {
  token: string;
  estado: string;
  permite: boolean;
  aceptadoAt: string | null;
  rechazadoAt: string | null;
  color: string;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState<"aceptar" | "rechazar" | null>(null);
  const [nombre, setNombre] = useState("");
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<"aceptado" | "rechazado" | null>(null);
  const visto = useRef(false);

  useEffect(() => {
    if (visto.current) return;
    visto.current = true;
    void accionVisto(token).catch(() => {});
  }, [token]);

  async function enviar() {
    if (!abierto || busy) return;
    if (abierto === "rechazar" && !motivo.trim()) { setError("Contanos el motivo."); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await accionResponder(token, abierto, nombre, motivo);
      if (!r.ok) { setError(r.error); return; }
      setHecho(abierto === "aceptar" ? "aceptado" : "rechazado");
      setAbierto(null);
      router.refresh();
    } catch {
      setError("No se pudo enviar. Probá de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  const final = hecho ?? (estado === "aceptado" || estado === "convertido" ? "aceptado" : estado === "rechazado" ? "rechazado" : null);
  if (final === "aceptado") {
    return (
      <p className="inline-flex items-center gap-2 text-sm font-medium text-emerald-700">
        <CheckCircle2 className="h-5 w-5" /> {hecho ? "¡Gracias! Avisamos a tu vendedor que lo aceptaste." : `Presupuesto aceptado${aceptadoAt ? ` el ${fechaHora(aceptadoAt)}` : ""}.`}
      </p>
    );
  }
  if (final === "rechazado") {
    return (
      <p className="inline-flex items-center gap-2 text-sm font-medium text-slate-600">
        <XCircle className="h-5 w-5 text-rose-500" /> {hecho ? "Gracias por avisarnos. Tu vendedor te va a contactar." : `Presupuesto rechazado${rechazadoAt ? ` el ${fechaHora(rechazadoAt)}` : ""}.`}
      </p>
    );
  }
  if (!permite) {
    return <p className="text-sm text-slate-500">¿Te sirve? Respondé el mensaje de tu vendedor para confirmarlo.</p>;
  }

  return (
    <>
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <button type="button" onClick={() => { setAbierto("rechazar"); setError(null); }}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700">
          <ThumbsDown className="h-4 w-4" /> No me interesa
        </button>
        <button type="button" onClick={() => { setAbierto("aceptar"); setError(null); }}
          className="inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-95"
          style={{ backgroundColor: color }}>
          <CheckCircle2 className="h-4 w-4" /> Aceptar presupuesto
        </button>
      </div>

      {abierto ? (
        <CapaModal onClose={busy ? undefined : () => setAbierto(null)}>
          <div role="dialog" aria-modal className={`flex w-full max-w-md ${ALTO_MAX_MODAL} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl`}>
            <div className="px-6 pt-6">
              <h2 className="text-lg font-semibold text-slate-900">{abierto === "aceptar" ? "Aceptar el presupuesto" : "¿Por qué no te sirve?"}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {abierto === "aceptar"
                  ? "Le avisamos a tu vendedor para coordinar la entrega y el pago."
                  : "Así te podemos ofrecer algo que se ajuste mejor."}
              </p>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
              {abierto === "rechazar" ? (
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">Motivo *</span>
                  <textarea autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} maxLength={500}
                    placeholder="Ej: el precio, el plazo de entrega, ya compramos…"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-rose-300 focus:ring-4 focus:ring-rose-100" />
                </label>
              ) : null}
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Tu nombre <span className="font-normal text-slate-400">(opcional)</span></span>
                <input autoFocus={abierto === "aceptar"} value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={120}
                  onKeyDown={(e) => { if (e.key === "Enter") void enviar(); }}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-4"
                  style={{ ["--tw-ring-color" as string]: `${color}33` }} />
              </label>
              {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
              <button type="button" onClick={() => setAbierto(null)} disabled={busy} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">Volver</button>
              <button type="button" onClick={() => void enviar()} disabled={busy || (abierto === "rechazar" && !motivo.trim())}
                className={`inline-flex items-center gap-2 rounded-xl px-5 py-2 text-sm font-semibold text-white disabled:opacity-40 ${abierto === "rechazar" ? "bg-rose-600 hover:bg-rose-700" : "hover:brightness-95"}`}
                style={abierto === "aceptar" ? { backgroundColor: color } : undefined}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {abierto === "aceptar" ? "Confirmar" : "Enviar"}
              </button>
            </div>
          </div>
        </CapaModal>
      ) : null}
    </>
  );
}
