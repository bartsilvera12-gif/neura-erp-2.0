"use client";

/**
 * Una burbuja del hilo (memo: un aviso de tilde re-dibuja solo esa burbuja).
 * Entrantes en blanco con filete turquesa, salientes en turquesa, notas internas en
 * amarillo. Imagen (visor), audio, video, documento, respuesta citada y tildes.
 * content-visibility:auto: las burbujas fuera de vista no se pintan.
 * Táctil (sin hover): tocar la burbuja muestra debajo "Responder" / "Descargar" (44 px);
 * los botones flotantes del hover quedan sólo para mouse.
 */
import { memo, useState } from "react";
import { AlertTriangle, CornerUpLeft, Download, FileText, Lock, RotateCw, Trash2 } from "lucide-react";
import { horaPy, tamanoLegible, type Mensaje } from "@/modules/conversaciones/dominio";
import { descargar } from "@/modules/conversaciones/media";
import { Ticks } from "@/modules/conversaciones/ui";

export type Cita = { preview: string; from_me: boolean | null; id: string | null };

type Props = {
  m: Mensaje;
  url: string | undefined;
  cita: Cita | null;
  /** Sin onResponder (lectura, p. ej. Monitoreo): no se muestra el botón Responder. */
  onResponder?: (m: Mensaje) => void;
  onVerImagen: (url: string, nombre: string) => void;
  onIrA: (id: string) => void;
  onReintentar: (id: string) => void;
  onDescartar: (id: string) => void;
};

function nombreArchivo(m: Mensaje): string {
  if (m.media_nombre) return m.media_nombre;
  const ext = (m.media_mime ?? "").split("/")[1]?.split(";")[0] ?? "bin";
  return `${m.tipo}-${m.id.slice(0, 8)}.${ext}`;
}

function Burbuja({ m, url, cita, onResponder, onVerImagen, onIrA, onReintentar, onDescartar }: Props) {
  const [imgError, setImgError] = useState(false);
  const [accionesTactil, setAccionesTactil] = useState(false);

  if (m.tipo === "sistema") {
    return (
      <div className="flex justify-center py-1.5">
        <span className="rounded-full bg-slate-200/70 px-3 py-1 text-[11px] text-slate-600">{m.contenido}</span>
      </div>
    );
  }

  const nota = m.tipo === "nota";
  const mio = m.from_me;
  const claseBurbuja = nota
    ? "bg-amber-50 text-amber-950 border border-amber-200 shadow-sm rounded-br-md"
    : mio
      ? "bg-[#4FAEB2] text-white rounded-br-md shadow-md shadow-[#4FAEB2]/25 ring-1 ring-white/15"
      : "bg-white text-slate-800 rounded-bl-md border border-slate-200 shadow-sm border-l-[3px] border-l-[#4FAEB2]/55";
  const tenue = nota ? "text-amber-700/80" : mio ? "text-sky-100" : "text-slate-400";
  const claro = mio && !nota;
  const archivo = nombreArchivo(m);
  const conAcciones = !m.local && !nota && (!!url || !!onResponder);
  // Toque en la burbuja (no en un control) con dedo → muestra/oculta las acciones.
  const alTocar = (e: React.MouseEvent) => {
    if (!conAcciones || !window.matchMedia("(hover: none)").matches) return;
    if ((e.target as HTMLElement).closest("button, a, audio, video, input")) return;
    setAccionesTactil((v) => !v);
  };

  return (
    <div
      id={`msg-${m.id}`}
      className={`flex flex-col ${mio || nota ? "items-end" : "items-start"} py-1`}
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 64px" }}
    >
      <div
        onClick={alTocar}
        className={`group relative min-w-0 max-w-[88%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed sm:max-w-[80%] sm:text-sm lg:max-w-[70%] ${claseBurbuja} ${
          m.local && m.estado_entrega === "pendiente" ? "opacity-80" : ""
        }`}
      >
        {/* Acciones al pasar el mouse */}
        {!m.local && !nota ? (
          <div className="absolute right-1 top-1 z-10 flex items-center gap-1 [@media(hover:none)]:hidden">
            {url ? (
              <button
                type="button"
                aria-label="Descargar archivo"
                title="Descargar"
                onClick={() => void descargar(url, archivo)}
                className={`grid h-6 w-6 place-items-center rounded-full opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100 ${
                  claro ? "bg-black/20 text-white hover:bg-black/35" : "bg-slate-900/10 text-slate-700 hover:bg-slate-900/20"
                }`}
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : null}
            {onResponder ? (
              <button
                type="button"
                aria-label="Responder"
                title="Responder"
                onClick={() => onResponder(m)}
                className={`grid h-6 w-6 place-items-center rounded-full opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100 ${
                  claro ? "bg-black/20 text-white hover:bg-black/35" : "bg-slate-900/10 text-slate-700 hover:bg-slate-900/20"
                }`}
              >
                <CornerUpLeft className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : null}
          </div>
        ) : null}

        {nota ? (
          <span className="mb-0.5 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-amber-700">
            <Lock className="h-3 w-3" aria-hidden /> Nota interna{m.autor_nombre ? ` · ${m.autor_nombre}` : ""}
          </span>
        ) : null}

        {/* Cita del mensaje respondido */}
        {cita ? (
          <button
            type="button"
            disabled={!cita.id}
            onClick={() => cita.id && onIrA(cita.id)}
            title={cita.id ? "Ir al mensaje citado" : undefined}
            className={`mb-1.5 block w-full rounded-lg border-l-[3px] px-2 py-1 text-left text-[12px] transition-colors enabled:hover:brightness-95 ${
              claro ? "border-white/60 bg-white/15 text-white/90" : "border-[#4FAEB2] bg-slate-50 text-slate-600"
            }`}
          >
            {cita.from_me == null ? null : (
              <span className="block text-[10px] font-semibold uppercase tracking-wide opacity-80">{cita.from_me ? "Vos" : "Cliente"}</span>
            )}
            <span className="line-clamp-2 break-words">{cita.preview}</span>
          </button>
        ) : null}

        {/* Contenido según el tipo */}
        {m.tipo === "imagen" || m.tipo === "sticker" ? (
          <div className="space-y-1.5">
            {url && !imgError ? (
              <button type="button" className="block max-w-full cursor-zoom-in border-0 bg-transparent p-0" onClick={() => onVerImagen(url, archivo)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt="Imagen del chat"
                  loading="lazy"
                  decoding="async"
                  onError={() => setImgError(true)}
                  className="max-h-60 min-h-[3rem] min-w-[6rem] max-w-full rounded-lg border border-white/30 bg-white object-contain"
                />
              </button>
            ) : (
              <div className={`flex h-32 w-48 max-w-full items-center justify-center rounded-lg text-xs ${claro ? "bg-white/15" : "bg-slate-100 text-slate-400"}`}>
                {imgError ? "No se pudo cargar la imagen" : "Cargando imagen…"}
              </div>
            )}
            {m.contenido ? <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.contenido}</p> : null}
          </div>
        ) : m.tipo === "audio" ? (
          <div className="space-y-1.5">
            <div className={`text-xs font-medium ${claro ? "text-white/85" : "text-slate-500"}`}>Audio</div>
            {url ? <audio controls src={url} preload="metadata" className="h-9 w-[260px] max-w-full" /> : <div className="h-9 w-[260px] max-w-full animate-pulse rounded-full bg-black/10" />}
            {m.contenido ? <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.contenido}</p> : null}
          </div>
        ) : m.tipo === "video" ? (
          <div className="space-y-1.5">
            {url ? (
              <video controls src={url} preload="metadata" className="max-h-64 max-w-full rounded-lg bg-black" />
            ) : (
              <div className={`flex h-32 w-56 max-w-full items-center justify-center rounded-lg text-xs ${claro ? "bg-white/15" : "bg-slate-100 text-slate-400"}`}>Cargando video…</div>
            )}
            {m.contenido ? <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.contenido}</p> : null}
          </div>
        ) : m.tipo === "documento" ? (
          <div className="space-y-1.5">
            <div className={`rounded-xl border px-3 py-2.5 ${claro ? "border-white/30 bg-white/20 text-white" : "border-slate-200 bg-slate-50 text-slate-900"}`}>
              <div className="flex items-start gap-3">
                <FileText className={`h-7 w-7 shrink-0 ${claro ? "text-white" : "text-[#4FAEB2]"}`} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className={`block text-[10px] font-bold uppercase tracking-wide ${claro ? "text-sky-100" : "text-slate-500"}`}>
                    Documento{m.media_size ? ` · ${tamanoLegible(m.media_size)}` : ""}
                  </span>
                  <span className="mt-0.5 block text-sm font-semibold [overflow-wrap:anywhere]">{archivo}</span>
                </span>
              </div>
              {url ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void descargar(url, archivo)}
                    className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors [@media(pointer:coarse)]:min-h-10 [@media(pointer:coarse)]:px-3.5 [@media(pointer:coarse)]:text-xs ${
                      claro ? "bg-white/25 text-white hover:bg-white/35" : "bg-[#4FAEB2] text-white hover:bg-[#3F8E91]"
                    }`}
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden /> Descargar
                  </button>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className={`inline-flex items-center rounded-lg px-2.5 py-1 text-[11px] font-semibold no-underline transition-colors [@media(pointer:coarse)]:min-h-10 [@media(pointer:coarse)]:px-3.5 [@media(pointer:coarse)]:text-xs ${
                      claro ? "bg-white/15 text-white hover:bg-white/25" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    Abrir
                  </a>
                </div>
              ) : null}
            </div>
            {m.contenido ? <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.contenido}</p> : null}
          </div>
        ) : m.tipo === "plantilla" ? (
          <div>
            <div className={`text-[10px] font-bold uppercase tracking-wide ${claro ? "text-sky-100" : "text-slate-500"}`}>Plantilla</div>
            <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.contenido}</p>
          </div>
        ) : (
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.contenido ?? (m.tipo === "ubicacion" ? "📍 Ubicación" : m.tipo === "reaccion" ? "Reacción" : "")}</p>
        )}

        {/* Hora · autor · tildes */}
        <p className={`mt-1 flex items-center justify-end gap-0.5 text-[10px] ${tenue}`}>
          {mio && !nota && m.autor_nombre ? <span className="mr-1 max-w-[10rem] truncate opacity-90">{m.autor_nombre}</span> : null}
          <span className="tabular-nums">{horaPy(m.created_at)}</span>
          {mio && !nota ? <Ticks estado={m.estado_entrega} claro /> : null}
        </p>

        {m.estado_entrega === "fallido" ? (
          <div className="mt-1 flex flex-wrap items-start gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="font-semibold">No entregado.</span> {m.local?.fallo ?? m.error ?? ""}
            </span>
            {m.local ? (
              <span className="flex gap-1">
                <button type="button" onClick={() => onReintentar(m.id)} className="inline-flex items-center gap-0.5 font-semibold underline-offset-2 hover:underline [@media(pointer:coarse)]:min-h-9 [@media(pointer:coarse)]:px-1">
                  <RotateCw className="h-3 w-3" /> Reintentar
                </button>
                <button type="button" onClick={() => onDescartar(m.id)} className="inline-flex items-center gap-0.5 font-semibold text-red-500 underline-offset-2 hover:underline [@media(pointer:coarse)]:min-h-9 [@media(pointer:coarse)]:px-1">
                  <Trash2 className="h-3 w-3" /> Descartar
                </button>
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      {accionesTactil && conAcciones ? (
        <div className="mt-1 flex gap-1.5" style={{ animation: "modal-pop 0.15s cubic-bezier(0.16,1,0.3,1)" }}>
          {onResponder ? (
            <button
              type="button"
              onClick={() => {
                setAccionesTactil(false);
                onResponder(m);
              }}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-700 shadow-sm active:bg-slate-50"
            >
              <CornerUpLeft className="h-4 w-4" aria-hidden /> Responder
            </button>
          ) : null}
          {url ? (
            <button
              type="button"
              onClick={() => {
                setAccionesTactil(false);
                void descargar(url, archivo);
              }}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-700 shadow-sm active:bg-slate-50"
            >
              <Download className="h-4 w-4" aria-hidden /> Descargar
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export const BurbujaMensaje = memo(Burbuja);
