"use client";

/**
 * /caja/pedidos-whatsapp — Pedidos que tomó el bot vendedor por WhatsApp (receta 172).
 * Arriba los que esperan ("Por preparar"): qué pidió, entrega (envío con dirección y mapa, o retiro),
 * forma de pago y el comprobante de la transferencia con lo que leyó la IA. La tienda lo prepara y
 * toca "Enviar a caja": desde ahí es un pedido de mostrador más (la caja lo cobra en Nueva venta,
 * se hace la venta y se descuenta el stock). Abajo, los de los últimos 7 días.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, MapPin, MessageCircle, Receipt, RotateCw, Send, Store, Truck, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { useFuncion } from "@/lib/sesion/ContextoUsuario";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { fechaHora } from "@/lib/fecha/paraguay";
import { formatGs } from "@/modules/caja/lib";
import { BOTON, BOTON_PRIMARIO } from "@/modules/rrhh/ui";
import { ESTADOS_PEDIDO_MOSTRADOR, type PedidoMostrador } from "@/modules/pedidos-mostrador/tipos";

type Lista = { ahora: string; pedidos: PedidoMostrador[] };
const cantTxt = (n: number) => Number(n).toLocaleString("es-PY", { maximumFractionDigits: 3 });
const mapa = (u: string) => {
  const m = u.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  return m ? `https://www.google.com/maps?q=${m[1]},${m[2]}` : null;
};

function TarjetaPedido({ p, onCambio }: { p: PedidoMostrador; onCambio: () => void }) {
  const w = p.whatsapp;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const est = ESTADOS_PEDIDO_MOSTRADOR[p.estado] ?? ESTADOS_PEDIDO_MOSTRADOR.whatsapp;
  const esperando = p.estado === "whatsapp";
  const lect = w?.comprobante_lectura ?? null;
  const montoOk = lect?.monto != null && Number(lect.monto) >= Number(p.total);

  async function accion(a: "a_caja" | "anular") {
    setBusy(a);
    setError(null);
    try {
      if (a === "a_caja") await apiFetch(`/api/pedidos-mostrador/whatsapp/${p.id}`, { method: "POST", body: JSON.stringify({ accion: "a_caja" }) });
      else await apiFetch(`/api/pedidos-mostrador/${p.id}/anular`, { method: "POST", body: JSON.stringify({ motivo: motivo.trim() || null }) });
      setAnulando(false);
      onCambio();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-lg font-bold text-slate-900">{p.etiqueta}<span className="ml-2 text-sm font-semibold text-slate-700">{p.cliente?.nombre ?? "Sin nombre"}</span></p>
          <p className="text-xs text-slate-500">{fechaHora(p.creado_at)}{w?.telefono ? ` · +${w.telefono}` : ""}</p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${est.clase}`}>{est.texto}</span>
      </div>

      <ul className="space-y-1 text-sm text-slate-700">
        {p.items.map((i) => (
          <li key={i.id} className="flex justify-between gap-3">
            <span className="min-w-0"><b className="tabular-nums">{cantTxt(i.cantidad)}</b> × {i.nombre}</span>
            <span className="shrink-0 tabular-nums">{formatGs(i.total)}</span>
          </li>
        ))}
        <li className="flex justify-between gap-3 border-t border-slate-100 pt-1 font-bold text-slate-900"><span>Total</span><span className="tabular-nums">{formatGs(p.total)}</span></li>
      </ul>
      {p.nota ? <p className="rounded-xl bg-slate-50 p-2 text-sm text-slate-700">Nota: {p.nota}</p> : null}

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-3 text-sm">
          <p className="flex items-center gap-1.5 font-semibold text-slate-800">{w?.entrega === "envio" ? <><Truck className="h-4 w-4" /> Envío</> : <><Store className="h-4 w-4" /> Retira en el local</>}</p>
          {w?.entrega === "envio" ? (
            <>
              {w.direccion ? <p className="mt-1 text-slate-600">{w.direccion}</p> : null}
              {w.ubicacion && mapa(w.ubicacion) ? (
                <a href={mapa(w.ubicacion)!} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 font-semibold text-[var(--brand)]"><MapPin className="h-4 w-4" /> Ver ubicación</a>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="rounded-xl border border-slate-200 p-3 text-sm">
          <p className="flex items-center gap-1.5 font-semibold text-slate-800"><Receipt className="h-4 w-4" /> {w?.forma_pago === "transferencia" ? "Transferencia" : "Paga al recibir"}</p>
          {w?.forma_pago === "transferencia" ? (
            w.pago_estado === "comprobante" ? (
              <div className="mt-1 space-y-1 text-slate-600">
                {w.comprobante_url ? <a href={w.comprobante_url} target="_blank" rel="noreferrer" className="font-semibold text-[var(--brand)]">Ver comprobante</a> : <p>Comprobante recibido</p>}
                {lect?.monto != null ? (
                  <p className={montoOk ? "text-emerald-700" : "text-amber-800"}>
                    Leído: {formatGs(Number(lect.monto))}{lect.fecha ? ` · ${lect.fecha}` : ""}{lect.referencia ? ` · op. ${lect.referencia}` : ""}{montoOk ? "" : " (no alcanza el total)"}
                  </p>
                ) : lect?.es_comprobante === false ? <p className="text-amber-800">La imagen no parece un comprobante</p> : null}
                <p className="text-xs text-slate-500">Verificalo en el banco antes de entregar.</p>
              </div>
            ) : <p className="mt-1 text-amber-800">Esperando el comprobante</p>
          ) : null}
        </div>
      </div>

      {p.estado === "cobrado" && p.venta ? <p className="text-sm text-emerald-700">Cobrado · venta {p.venta.numero}</p> : null}
      {p.estado === "anulado" ? <p className="text-sm text-slate-500">Anulado{p.motivo_anulacion ? `: ${p.motivo_anulacion}` : ""}</p> : null}
      {p.estado === "en_caja" ? <p className="text-sm text-sky-800">En caja: se cobra en Nueva venta › Pedidos por cobrar.</p> : null}
      {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}

      {anulando ? (
        <div className="space-y-2 rounded-xl bg-rose-50 p-3">
          <input className="min-h-11 w-full rounded-xl border border-rose-200 bg-white px-3 text-sm" placeholder="Motivo (opcional)" value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BOTON} onClick={() => setAnulando(false)} disabled={!!busy}>Volver</button>
            <button type="button" className={`${BOTON} border-rose-300 text-rose-700`} onClick={() => void accion("anular")} disabled={!!busy}>
              {busy === "anular" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} Anular pedido
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {w?.conversacion_id ? (
            <Link href={`/conversaciones?c=${w.conversacion_id}`} className={`${BOTON} max-sm:flex-1`}><MessageCircle className="h-4 w-4" /> Abrir chat</Link>
          ) : null}
          {esperando ? (
            <>
              <button type="button" className={`${BOTON} max-sm:flex-1`} onClick={() => setAnulando(true)} disabled={!!busy}><X className="h-4 w-4" /> Anular</button>
              <button type="button" className={`${BOTON_PRIMARIO} max-sm:w-full`} onClick={() => void accion("a_caja")} disabled={!!busy}>
                {busy === "a_caja" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar a caja
              </button>
            </>
          ) : null}
        </div>
      )}
    </article>
  );
}

export default function PedidosWhatsappPage() {
  const activa = useFuncion("pedidos");
  const [lista, setLista] = useState<Lista | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cargar = useCallback(async () => {
    try {
      setLista(await apiFetch<Lista>("/api/pedidos-mostrador/whatsapp"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    if (!activa) return;
    void cargar();
    const id = setInterval(() => { if (document.visibilityState === "visible") void cargar(); }, 15_000);
    return () => clearInterval(id);
  }, [activa, cargar]);

  const esperando = lista?.pedidos.filter((p) => p.estado === "whatsapp") ?? [];
  const resto = lista?.pedidos.filter((p) => p.estado !== "whatsapp") ?? [];

  return (
    <div className="space-y-4 pb-10">
      <EncabezadoPagina
        kicker="Caja"
        titulo="Pedidos de WhatsApp"
        subtitulo="Los toma el bot vendedor. Preparalos y tocá Enviar a caja: la caja los cobra en Nueva venta como cualquier pedido."
        volver={{ href: "/caja/panel", label: "Caja" }}
        acciones={<button type="button" className={`${BOTON} max-sm:w-full`} onClick={() => void cargar()}><RotateCw className="h-4 w-4" /> Actualizar</button>}
      />
      {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      {!lista && !error ? <div className="h-48 animate-pulse rounded-2xl border border-slate-200 bg-white" /> : null}
      {lista ? (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Por preparar ({esperando.length})</h2>
            {esperando.length ? (
              <div className="grid gap-3 lg:grid-cols-2">{esperando.map((p) => <TarjetaPedido key={p.id} p={p} onCambio={() => void cargar()} />)}</div>
            ) : (
              <p className="flex items-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-white p-4 text-sm text-slate-500"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> No hay pedidos esperando.</p>
            )}
          </section>
          {resto.length ? (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Últimos 7 días</h2>
              <div className="grid gap-3 lg:grid-cols-2">{resto.map((p) => <TarjetaPedido key={p.id} p={p} onCambio={() => void cargar()} />)}</div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
