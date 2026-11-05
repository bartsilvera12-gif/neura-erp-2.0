"use client";

/**
 * /gimnasio/autoasistencia — El link y el QR para que los alumnos marquen su asistencia solos
 * (receta 153). Se copia, se comparte (WhatsApp) o se imprime para pegar en la entrada. Cada alumno
 * entra con su CI y su PIN, que se crea en su card de Asistencia (Recepción o ficha del cliente).
 */
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, Loader2, Printer, RefreshCw, Share2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO } from "@/modules/inventario/ui";

async function qrSvg(texto: string): Promise<string> {
  const QRCode = (await import("qrcode")).default;
  return QRCode.toString(texto, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0f172a", light: "#ffffff" } });
}

const escapar = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export default function AutoasistenciaPage() {
  const [d, setD] = useState<{ token: string; puede_cambiar: boolean; empresa?: string } | null>(null);
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [rehacer, setRehacer] = useState(false);
  const [cambiando, setCambiando] = useState(false);
  async function cambiarLink() {
    setCambiando(true); setError(null);
    try { setD(await apiFetch("/api/gimnasio/autoasistencia", { method: "POST", body: JSON.stringify({ rehacer: true }) })); setRehacer(false); }
    catch (e) { setError((e as Error).message); } finally { setCambiando(false); }
  }

  const link = d && typeof window !== "undefined" ? `${window.location.origin}/a/${d.token}` : "";
  const cargar = useCallback(() => {
    apiFetch<{ token: string; puede_cambiar: boolean; empresa?: string }>("/api/gimnasio/autoasistencia").then(setD).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { if (link) void qrSvg(link).then(setSvg); }, [link]);

  async function copiar() {
    try { await navigator.clipboard.writeText(link); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch { setError("No se pudo copiar: copialo a mano."); }
  }
  async function compartir() {
    const texto = `Marcá tu asistencia acá con tu CI y tu PIN: ${link}`;
    if (navigator.share) { try { await navigator.share({ title: "Marcar asistencia", text: texto, url: link }); return; } catch { return; } }
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
  }
  function imprimir() {
    const empresa = escapar(d?.empresa ?? "");
    const w = window.open("", "_blank", "width=800,height=1000");
    if (!w) { setError("El navegador bloqueó la ventana para imprimir: permití las ventanas emergentes."); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Marcá tu asistencia</title>
<style>@page{size:A4;margin:18mm}body{font-family:system-ui,sans-serif;color:#0f172a;text-align:center;margin:0}
h1{font-size:40px;margin:24px 0 6px}p{font-size:20px;margin:6px 0;color:#334155}.qr{width:360px;height:360px;margin:28px auto}.qr svg{width:100%;height:100%}
ol{display:inline-block;text-align:left;font-size:20px;line-height:1.7;color:#1e293b}.link{font-size:13px;color:#64748b;word-break:break-all;margin-top:24px}</style></head>
<body>${empresa ? `<p>${empresa}</p>` : ""}<h1>Marcá tu asistencia</h1><p>Escaneá con la cámara de tu celular</p><div class="qr">${svg}</div>
<ol><li>Escribí tu cédula.</li><li>Escribí tu PIN de 4 números.</li><li>Tocá <b>Llegué</b> en tu clase, o <b>Entrada libre</b>.</li></ol>
<p>¿No tenés PIN? Pedilo en recepción.</p><div class="link">${escapar(link)}</div>
<script>window.onload=()=>{window.print();}</script></body></html>`);
    w.document.close();
  }

  return (
    <div className="space-y-4 pb-10">
      <EncabezadoPagina kicker="Asistencia" titulo="Que el alumno marque solo" volver={{ href: "/gimnasio/panel", label: "Asistencia" }}
        subtitulo="Compartí este link o imprimí el QR para la entrada. El alumno pone su CI y su PIN y marca su llegada; ya cuenta como asistencia." />
      {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      {!d && !error ? <div className="h-72 animate-pulse rounded-2xl border border-slate-200 bg-white" /> : null}
      {d ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          <section className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white p-5">
            {svg ? <div className="aspect-square w-full max-w-[260px] [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="aspect-square w-full max-w-[260px] animate-pulse rounded-xl bg-slate-100" />}
            <p className="w-full break-all rounded-lg bg-slate-50 px-3 py-2 text-center text-xs text-slate-500">{link}</p>
          </section>
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
            <div className="grid gap-2 sm:grid-cols-3">
              <button type="button" onClick={() => void copiar()} className={`${BOTON_SECUNDARIO} min-h-11`}>{copiado ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />} {copiado ? "Copiado" : "Copiar link"}</button>
              <button type="button" onClick={() => void compartir()} className={`${BOTON_SECUNDARIO} min-h-11`}><Share2 className="h-4 w-4" /> Compartir</button>
              <button type="button" disabled={!svg} onClick={imprimir} className={`${BOTON_PRIMARIO} min-h-11 bg-[var(--brand)]`}><Printer className="h-4 w-4" /> Imprimir QR</button>
            </div>
            <div className="space-y-2 text-sm leading-relaxed text-slate-600">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><KeyRound className="h-4 w-4 text-slate-400" /> Cómo funciona</h2>
              <ol className="list-decimal space-y-1 pl-5">
                <li>Cada alumno necesita un PIN: en Recepción buscalo y tocá <span className="font-medium text-slate-800">Crear PIN</span>. Dáselo; se ve una sola vez.</li>
                <li>El alumno abre el link o escanea el QR, pone su CI y su PIN.</li>
                <li>Toca <span className="font-medium text-slate-800">Llegué</span> en su clase de hoy (se anota si hay lugar) o <span className="font-medium text-slate-800">Entrada libre</span>.</li>
                <li>Cuenta como asistencia en el momento: descuenta su membresía o queda la clase suelta para pagar en caja.</li>
              </ol>
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">Si tiene una cuota vencida, no puede marcar: le pide pasar por recepción. Con 5 PIN incorrectos se bloquea 15 minutos.</p>
            </div>
            {d.puede_cambiar ? (rehacer ? (
              <div className="space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-3">
                <p className="text-sm text-rose-900">El link y los QR que ya repartiste o imprimiste dejan de andar. Vas a tener que compartir e imprimir el nuevo.</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setRehacer(false)} className={`${BOTON_SECUNDARIO} min-h-11`}>No, dejarlo</button>
                  <button type="button" disabled={cambiando} onClick={() => void cambiarLink()} className={`${BOTON_PRIMARIO} min-h-11 bg-rose-600`}>{cambiando ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Sí, cambiar el link</button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setRehacer(true)} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-rose-700">
                <RefreshCw className="h-4 w-4" /> Cambiar el link
              </button>
            )) : null}
          </section>
        </div>
      ) : null}

    </div>
  );
}