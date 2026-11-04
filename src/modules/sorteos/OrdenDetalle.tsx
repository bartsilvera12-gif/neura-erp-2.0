"use client";

/**
 * Detalle de una compra de sorteo (receta 123) en un modal: datos, números, comprobante y las acciones
 * que permite su estado y el perfil: confirmar / rechazar (sorteos_revisar) y anular (sorteos_administrar).
 */
import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, XCircle } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { usePermiso } from "@/lib/sesion/ContextoUsuario";
import { Modal } from "@/components/Modal";
import type { Orden } from "@/modules/sorteos/tipos";
import { NOMBRE_CANAL, NOMBRE_METODO } from "@/modules/sorteos/tipos";
import { BOTON, BOTON_PRIMARIO, Campo, EstadoOrdenChip, fechaHoraPY, gs, INPUT, telefonoLindo } from "@/modules/sorteos/ui";

type Detalle = Orden & { comprobante_url: string | null; comprobante: Record<string, unknown> | null };

function Dato({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd className="m-0 text-sm text-slate-800 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

export function OrdenDetalle({ id, onClose, onCambio }: { id: string; onClose: () => void; onCambio: (o: Orden) => void }) {
  const [o, setO] = useState<Detalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [baja, setBaja] = useState<"rechazar" | "anular" | null>(null);
  const [motivo, setMotivo] = useState("");
  const revisar = usePermiso("sorteos_revisar");
  const administrar = usePermiso("sorteos_administrar");

  useEffect(() => {
    apiFetch<Detalle>(`/api/sorteos/ordenes/${id}`).then(setO).catch((e: Error) => setError(e.message));
  }, [id]);

  async function accion(a: "confirmar" | "rechazar" | "anular") {
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<Orden>(`/api/sorteos/ordenes/${id}`, { method: "POST", body: JSON.stringify({ accion: a, motivo: a === "confirmar" ? null : motivo }) });
      setO((x) => (x ? { ...x, ...r } : x));
      setBaja(null);
      setMotivo("");
      onCambio(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const pendiente = o && (o.estado === "en_revision" || o.estado === "pendiente_pago");
  return (
    <Modal titulo={o ? `Compra ${o.numero}` : "Compra"} onClose={() => !busy && onClose()} size="xl">
      {!o && !error ? <div className="h-40 animate-pulse rounded-xl bg-slate-100" /> : null}
      {o ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-base font-semibold text-slate-900">{o.comprador_nombre}</p>
              <p className="text-xs text-slate-500">{o.sorteo} · {fechaHoraPY(o.created_at)}</p>
            </div>
            <EstadoOrdenChip estado={o.estado} />
          </div>

          <dl className="m-0 grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-3">
            <Dato label="Monto"><b className="tabular-nums">{gs(o.monto)}</b>{o.precio_lista > o.monto ? <span className="block text-[11px] text-emerald-700">combo · lista {gs(o.precio_lista)}</span> : null}</Dato>
            <Dato label="Boletas">{o.cantidad.toLocaleString("es-PY")}</Dato>
            <Dato label="Pago">{NOMBRE_METODO[o.metodo_pago]}{o.referencia_pago ? ` · op. ${o.referencia_pago}` : ""}</Dato>
            <Dato label="Cédula">{o.comprador_documento ?? "—"}</Dato>
            <Dato label="Teléfono">{telefonoLindo(o.comprador_telefono) || "—"}</Dato>
            <Dato label="Ciudad">{o.comprador_ciudad ?? "—"}</Dato>
            <Dato label="Canal">{NOMBRE_CANAL[o.canal]}{o.vendedor ? ` · ${o.vendedor}` : ""}{o.anuncio_id ? ` · anuncio ${o.anuncio_id}` : ""}</Dato>
            <Dato label="Confirmación">{o.validacion === "auto" ? "Automática (comprobante leído)" : o.revisado_at ? `Manual · ${fechaHoraPY(o.revisado_at)}` : "—"}</Dato>
            {o.vence_at && o.estado === "pendiente_pago" ? <Dato label="Reserva hasta">{fechaHoraPY(o.vence_at)}</Dato> : null}
          </dl>

          {o.motivo ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800"><b>Motivo:</b> {o.motivo}</p> : null}

          <div>
            <p className="mb-1.5 text-xs font-semibold text-slate-600">{o.numeros.length ? `Números (${o.numeros.length})` : "Sin números"}{o.estado === "en_revision" || o.estado === "pendiente_pago" ? " · reservados hasta confirmar" : ""}</p>
            {o.numeros.length ? (
              <ul className="m-0 flex max-h-40 list-none flex-wrap gap-1.5 overflow-y-auto p-0">
                {o.numeros.map((n) => <li key={n} className="rounded-lg bg-[var(--brand-50,#eef7f7)] px-2 py-1 text-sm font-semibold tabular-nums text-[var(--brand)]">{n}</li>)}
              </ul>
            ) : <p className="text-sm text-slate-500">Los números se liberaron (compra {o.estado}).</p>}
          </div>

          {o.comprobante_url ? (
            <div>
              <p className="mb-1.5 flex items-center justify-between text-xs font-semibold text-slate-600">
                Comprobante
                <a href={o.comprobante_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-[var(--brand)]">Abrir <ExternalLink className="h-3.5 w-3.5" /></a>
              </p>
              {/\.pdf(\?|$)/i.test(o.comprobante_path ?? "")
                ? <a href={o.comprobante_url} target="_blank" rel="noopener noreferrer" className={`${BOTON} no-underline`}>Ver PDF</a>
                : <img src={o.comprobante_url} alt="Comprobante de pago" className="max-h-[50vh] w-full rounded-xl border border-slate-200 object-contain" />}
            </div>
          ) : pendiente ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Todavía no subió el comprobante.</p> : null}

          {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}

          {baja ? (
            <div className="space-y-3 rounded-xl border border-rose-200 p-3">
              <Campo label={baja === "rechazar" ? "¿Por qué se rechaza el pago?" : "¿Por qué se anula la compra?"} ayuda="Los números vuelven a quedar libres para vender.">
                <input className={INPUT} autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300}
                  placeholder={baja === "rechazar" ? "Ej. la transferencia no llegó" : "Ej. devolución del dinero"} />
              </Campo>
              <div className="flex justify-end gap-2 max-sm:[&>*]:flex-1">
                <button type="button" className={BOTON} disabled={busy} onClick={() => { setBaja(null); setMotivo(""); }}>Volver</button>
                <button type="button" className={`${BOTON_PRIMARIO} !bg-rose-600`} disabled={busy || motivo.trim().length < 3} onClick={() => accion(baja)}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} {baja === "rechazar" ? "Rechazar pago" : "Anular compra"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap justify-end gap-2 max-sm:[&>*]:flex-1">
              {administrar && ["en_revision", "pendiente_pago", "confirmada"].includes(o.estado) ? (
                <button type="button" className={`${BOTON} text-rose-600`} disabled={busy} onClick={() => setBaja("anular")}>Anular</button>
              ) : null}
              {revisar && pendiente ? (
                <>
                  <button type="button" className={BOTON} disabled={busy} onClick={() => setBaja("rechazar")}>Rechazar pago</button>
                  <button type="button" className={BOTON_PRIMARIO} disabled={busy} onClick={() => accion("confirmar")}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Confirmar pago
                  </button>
                </>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
      {!o && error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
    </Modal>
  );
}
