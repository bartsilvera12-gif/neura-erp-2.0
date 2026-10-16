"use client";

/**
 * Caja de escritura (igual que el sistema actual): adjuntar, nota de voz (MediaRecorder),
 * emojis, respuestas rápidas con "/", plantillas (obligatorias fuera de las 24 h), nota
 * interna (amarilla, no le llega al cliente) y responder citando.
 * Enter envía · Shift+Enter salto de línea.
 *
 * Responsive por ancho del chat (PanelChat es `@container`): con el chat angosto (< 512 px:
 * celular, tablet) queda como WhatsApp: "+" (adjuntar, plantilla, respuestas, emojis, nota
 * interna en un menú / hoja), el texto a lo ancho (16 px) y a la derecha "Enviar" o, con el
 * texto vacío, el micrófono; todo a 44 px. En celular emojis, respuestas y plantillas se abren
 * en hoja inferior (sobre el teclado). Con el chat ancho, igual que siempre.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Lock, Mic, Paperclip, Plus, SendHorizontal, Smile, Square, Trash2, X, Zap } from "lucide-react";
import { HojaInferior } from "@/components/HojaInferior";
import { MenuAcciones, type ItemMenu } from "@/components/MenuAcciones";
import { useEsMovil, useEsTactil } from "@/lib/ui/responsive";
import {
  MAX_ADJUNTO_BYTES, previewMensaje, rellenarPlantilla, tamanoLegible, variablesDePlantilla, ventanaAbierta,
  type FilaBandeja, type Mensaje, type Plantilla, type RespuestaRapida,
} from "@/modules/conversaciones/dominio";

const EMOJI_GRUPOS: { grupo: string; items: string[] }[] = [
  { grupo: "Caras", items: ["😀","😃","😄","😁","😊","🙂","😉","😍","🥰","😘","😂","🤣","😅","😎","🤩","🥳","🤔","😌","😴","😢","😭","😡","😱","🥺","🙄","😬"] },
  { grupo: "Gestos", items: ["👍","👎","👌","🙌","👏","🙏","💪","🤝","👋","✌️","🤞","☝️","👉","👈","✋","🤙"] },
  { grupo: "Símbolos", items: ["❤️","🧡","💚","💙","💜","🔥","⭐","✨","✅","❌","⚠️","❓","❗","💯","🎉","🎁"] },
  { grupo: "Trabajo", items: ["📌","📎","📅","⏰","💰","💳","🧾","📞","📧","📦","🚀","📲","💻","📝","🔎","🏷️"] },
];

const MAX_GRABACION_S = 10 * 60;
const borradores = new Map<string, string>();
const tiempo = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

const botonIcono = (activo: boolean, alerta = false) =>
  `inline-flex h-9 w-9 items-center justify-center rounded-lg border disabled:opacity-50 ${
    activo
      ? "border-[#4FAEB2]/50 bg-[#4FAEB2]/10 text-[#3F8E91]"
      : alerta
        ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
        : "border-slate-200 text-slate-600 hover:bg-slate-50"
  }`;

export type ComposerProps = {
  conv: FilaBandeja;
  contactoNombre: string;
  respuestas: RespuestaRapida[];
  plantillas: Plantilla[];
  respondiendo: Mensaje | null;
  onCancelarRespuesta: () => void;
  onTexto: (texto: string, respondeA: string | null) => void;
  onNota: (texto: string) => void;
  onPlantilla: (id: string, variables: Record<string, string>) => void;
  onArchivo: (archivo: File | Blob, o: { nombre: string; caption?: string; responde_a?: string | null; notaVoz?: boolean }) => void;
  onReabrir: () => void;
};

export function Composer(p: ComposerProps) {
  const { conv } = p;
  const [texto, setTexto] = useState(() => borradores.get(p.conv.id) ?? "");
  const [modoNota, setModoNota] = useState(false);
  const [panel, setPanel] = useState<null | "emoji" | "respuestas" | "plantillas">(null);
  const [error, setError] = useState<string | null>(null);
  const [pegada, setPegada] = useState<File | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const archivoRef = useRef<HTMLInputElement>(null);
  const ventana = ventanaAbierta(conv);
  const cerrada = conv.estado === "cerrada";
  const esMovil = useEsMovil();
  const tactil = useEsTactil();

  // Borrador por conversación: se conserva al saltar entre chats en la misma pestaña.
  useEffect(() => {
    if (texto) borradores.set(conv.id, texto);
    else borradores.delete(conv.id);
  }, [texto, conv.id]);

  // Alto automático del textarea (hasta ~6 líneas).
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [texto]);

  useEffect(() => {
    if (p.respondiendo) area.current?.focus();
  }, [p.respondiendo]);

  // ── Respuestas rápidas con "/" ─────────────────────────────────────────────
  const [qrBusca, setQrBusca] = useState("");
  const [qrIdx, setQrIdx] = useState(0);
  const barra = !modoNota && /^\/[^\s\n]*$/.test(texto);
  const filtroQr = barra ? texto.slice(1).toLowerCase() : qrBusca.toLowerCase();
  const respuestasFiltradas = useMemo(
    () => p.respuestas.filter((r) => !filtroQr || r.atajo.toLowerCase().includes(filtroQr) || r.texto.toLowerCase().includes(filtroQr)).slice(0, 30),
    [p.respuestas, filtroQr],
  );
  const qrVisible = (barra && respuestasFiltradas.length > 0) || panel === "respuestas";
  useEffect(() => setQrIdx(0), [filtroQr]);

  const usarRespuesta = (r: RespuestaRapida) => {
    setTexto(r.texto);
    setPanel(null);
    setQrBusca("");
    requestAnimationFrame(() => area.current?.focus());
  };

  const insertar = (s: string) => {
    const el = area.current;
    if (!el) return setTexto((t) => t + s);
    const ini = el.selectionStart ?? texto.length;
    const fin = el.selectionEnd ?? texto.length;
    const nuevo = texto.slice(0, ini) + s + texto.slice(fin);
    setTexto(nuevo);
    requestAnimationFrame(() => {
      // En celular los emojis van en una hoja: no se abre el teclado con cada uno.
      if (!esMovil) el.focus();
      el.selectionStart = el.selectionEnd = ini + s.length;
    });
  };

  // ── Envío ──────────────────────────────────────────────────────────────────
  const enviarTexto = () => {
    const t = texto.trim();
    if (!t) return;
    if (modoNota) p.onNota(t);
    else {
      if (!ventana) {
        setError("Pasaron más de 24 h desde el último mensaje del cliente: solo se puede enviar una plantilla.");
        return;
      }
      p.onTexto(t, p.respondiendo?.id ?? null);
      p.onCancelarRespuesta();
    }
    setTexto("");
    setError(null);
  };

  const enviarArchivo = (f: File, caption?: string) => {
    if (f.size > MAX_ADJUNTO_BYTES) {
      setError(`El archivo pesa ${tamanoLegible(f.size)}: el máximo es ${tamanoLegible(MAX_ADJUNTO_BYTES)}.`);
      return;
    }
    p.onArchivo(f, { nombre: f.name || "archivo", caption, responde_a: p.respondiendo?.id ?? null });
    p.onCancelarRespuesta();
    setError(null);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (qrVisible && respuestasFiltradas.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setQrIdx((i) => (i + 1) % respuestasFiltradas.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setQrIdx((i) => (i - 1 + respuestasFiltradas.length) % respuestasFiltradas.length);
        return;
      }
      if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
        e.preventDefault();
        usarRespuesta(respuestasFiltradas[qrIdx] ?? respuestasFiltradas[0]);
        return;
      }
      if (e.key === "Escape") {
        setTexto("");
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      enviarTexto();
    }
  };

  // ── Nota de voz ────────────────────────────────────────────────────────────
  const voz = useNotaDeVoz(setError);

  if (cerrada) {
    return (
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-3 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
        <span className="text-xs text-slate-500">La conversación está cerrada. Si el cliente vuelve a escribir, se reabre sola.</span>
        <button type="button" onClick={p.onReabrir} className="shrink-0 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100 @max-lg:min-h-11 @max-lg:px-4 @max-lg:text-xs">
          Reabrir
        </button>
      </div>
    );
  }

  const bloqueado = !ventana && !modoNota;
  // Menú "+" del chat angosto (sólo lo que se puede usar ahora).
  const itemsMas: ItemMenu[] = [
    ...(!(bloqueado || modoNota || voz.grabando)
      ? [{ etiqueta: "Adjuntar archivo", icono: <Paperclip className="h-4 w-4" />, onClick: () => archivoRef.current?.click() }]
      : []),
    {
      etiqueta: !ventana ? "Recontactar con plantilla" : "Enviar plantilla",
      icono: <FileText className="h-4 w-4" />,
      onClick: () => setPanel("plantillas"),
      tono: !ventana ? ("peligro" as const) : undefined,
    },
    {
      etiqueta: "Respuestas rápidas",
      icono: <Zap className="h-4 w-4" />,
      onClick: () => {
        setQrBusca("");
        setPanel("respuestas");
      },
    },
    ...(!(voz.grabando || voz.pendiente) ? [{ etiqueta: "Emojis", icono: <Smile className="h-4 w-4" />, onClick: () => setPanel("emoji") }] : []),
    {
      etiqueta: modoNota ? "Volver a escribirle al cliente" : "Nota interna (solo la ve el equipo)",
      icono: <Lock className="h-4 w-4" />,
      onClick: () => setModoNota((v) => !v),
    },
  ];
  const puedeGrabar = !bloqueado && !modoNota && !voz.grabando && !voz.pendiente;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (voz.pendiente) {
          p.onArchivo(voz.pendiente.blob, { nombre: voz.pendiente.nombre, notaVoz: true });
          voz.descartar(true);
          return;
        }
        enviarTexto();
      }}
      className={`flex min-h-0 shrink-0 flex-col gap-1 border-t p-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] transition-colors ${modoNota ? "border-amber-200 bg-amber-50/70" : "border-slate-200 bg-white"}`}
    >
      <input
        ref={archivoRef}
        type="file"
        className="hidden"
        accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) enviarArchivo(f);
        }}
      />
      {error ? (
        <div className="flex items-start justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Cerrar aviso" className="-m-1 shrink-0 p-1 @max-lg:-my-2 @max-lg:p-2.5"><X className="h-3.5 w-3.5" /></button>
        </div>
      ) : null}
      {bloqueado ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 @max-sm:flex-col @max-sm:items-stretch">
          <span>Pasaron +24 h desde el último mensaje del cliente: para recontactarlo solo se puede enviar una plantilla (o dejar una nota interna).</span>
          <button type="button" onClick={() => setPanel("plantillas")} className="shrink-0 rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-700 @max-lg:min-h-10 @max-lg:text-xs">
            Elegir plantilla
          </button>
        </div>
      ) : null}
      {pegada ? (
        <ImagenPegada
          archivo={pegada}
          onCancelar={() => setPegada(null)}
          onEnviar={() => {
            enviarArchivo(pegada, texto.trim() || undefined);
            setTexto("");
            setPegada(null);
          }}
        />
      ) : null}
      {p.respondiendo ? (
        <div className="flex items-start gap-2 rounded-md border-l-[3px] border-[#4FAEB2] bg-slate-50 px-2 py-1.5">
          <div className="min-w-0 flex-1">
            <span className="block text-[10px] font-semibold uppercase tracking-wide text-[#3F8E91]">Respondiendo a {p.respondiendo.from_me ? "vos" : "el cliente"}</span>
            <span className="block truncate text-[12px] text-slate-600">{previewMensaje(p.respondiendo)}</span>
          </div>
          <button type="button" onClick={p.onCancelarRespuesta} aria-label="Cancelar respuesta" className="shrink-0 rounded px-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600 @max-lg:-my-1 @max-lg:inline-flex @max-lg:h-10 @max-lg:w-10 @max-lg:items-center @max-lg:justify-center">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      <div className="flex items-end gap-1">
        <div className="relative flex shrink-0 items-center gap-0.5">
          {/* Chat angosto: todo en "+" */}
          <MenuAcciones
            etiqueta="Adjuntar y más"
            items={itemsMas}
            className={`inline-flex h-11 w-11 items-center justify-center rounded-full transition-colors @lg:hidden ${
              modoNota ? "bg-amber-100 text-amber-800" : panel ? "bg-[#4FAEB2]/10 text-[#3F8E91]" : "text-slate-500 hover:bg-slate-100"
            }`}
          >
            {modoNota ? <Lock className="h-5 w-5" aria-hidden /> : <Plus className="h-6 w-6" aria-hidden />}
          </MenuAcciones>
          <div className="hidden items-center gap-0.5 @lg:flex">
          <button
            type="button"
            disabled={bloqueado || modoNota || voz.grabando}
            onClick={() => archivoRef.current?.click()}
            className={botonIcono(false)}
            title="Adjuntar imagen, audio, video o documento"
            aria-label="Adjuntar archivo"
          >
            <Paperclip className="h-[18px] w-[18px]" aria-hidden />
          </button>
          {!voz.grabando && !voz.pendiente ? (
            <button type="button" disabled={bloqueado || modoNota} onClick={() => void voz.iniciar()} className={botonIcono(false)} title="Grabar nota de voz" aria-label="Grabar nota de voz">
              <Mic className="h-[18px] w-[18px]" aria-hidden />
            </button>
          ) : null}
          <button type="button" disabled={voz.grabando || !!voz.pendiente} onClick={() => setPanel((x) => (x === "emoji" ? null : "emoji"))} className={botonIcono(panel === "emoji")} title="Emojis" aria-label="Insertar emoji">
            <Smile className="h-[18px] w-[18px]" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => {
              setQrBusca("");
              setPanel((x) => (x === "respuestas" ? null : "respuestas"));
            }}
            className={botonIcono(panel === "respuestas")}
            title="Respuestas rápidas (escribí / en el mensaje)"
            aria-label="Insertar respuesta rápida"
          >
            <Zap className="h-[18px] w-[18px]" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setPanel((x) => (x === "plantillas" ? null : "plantillas"))}
            className={botonIcono(panel === "plantillas", !ventana)}
            title={!ventana ? "Recontactar con plantilla (fuera de las 24 h)" : "Enviar plantilla"}
            aria-label="Enviar plantilla"
          >
            <FileText className="h-[18px] w-[18px]" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setModoNota((v) => !v)}
            className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border ${modoNota ? "border-amber-400 bg-amber-100 text-amber-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
            title={modoNota ? "Volver a escribirle al cliente" : "Nota interna (solo la ve el equipo)"}
            aria-pressed={modoNota}
            aria-label="Nota interna"
          >
            <Lock className="h-[17px] w-[17px]" aria-hidden />
          </button>
          </div>

          {panel === "emoji" ? (
            <Flotante onCerrar={() => setPanel(null)} ancho="w-[min(calc(100vw-2rem),18rem)]" hoja="Emojis">
              <div className="max-h-64 overflow-y-auto overscroll-contain p-2 max-sm:max-h-none">
                {EMOJI_GRUPOS.map((g) => (
                  <div key={g.grupo} className="mb-2 last:mb-0">
                    <p className="mb-1 px-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{g.grupo}</p>
                    <div className="grid grid-cols-8 gap-0.5">
                      {g.items.map((em) => (
                        <button key={em} type="button" onClick={() => insertar(em)} className="flex h-8 w-8 items-center justify-center rounded-md text-lg leading-none transition-colors hover:bg-slate-100 max-sm:h-11 max-sm:w-full max-sm:text-2xl">
                          {em}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Flotante>
          ) : null}

          {qrVisible ? (
            <Flotante onCerrar={() => (barra ? setTexto("") : setPanel(null))} ancho="w-[min(calc(100vw-2rem),22rem)]" hoja={barra ? undefined : "Respuestas rápidas"}>
              {!barra ? (
                <div className="border-b border-slate-100 px-2 py-1.5">
                  <input
                    type="search"
                    autoFocus
                    value={qrBusca}
                    onChange={(e) => setQrBusca(e.target.value)}
                    placeholder="Buscar…"
                    className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none max-sm:h-11 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
                  />
                </div>
              ) : (
                <div className="border-b border-slate-100 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Respuestas rápidas · ↑↓ y Enter</div>
              )}
              <div className="max-h-56 overflow-y-auto overscroll-contain p-1 max-sm:max-h-none">
                {respuestasFiltradas.length === 0 ? (
                  <p className="px-2 py-4 text-center text-xs text-slate-500">{p.respuestas.length ? "Sin coincidencias." : "No hay respuestas rápidas configuradas."}</p>
                ) : (
                  <ul className="space-y-0.5">
                    {respuestasFiltradas.map((r, i) => (
                      <li key={r.id}>
                        <button
                          type="button"
                          onMouseEnter={() => setQrIdx(i)}
                          onClick={() => usarRespuesta(r)}
                          className={`w-full rounded-lg px-2 py-2 text-left text-xs max-sm:min-h-12 max-sm:px-3 max-sm:text-sm ${barra && i === qrIdx ? "bg-[#4FAEB2]/10" : "hover:bg-slate-50"}`}
                        >
                          <span className="block font-mono font-semibold text-[#3F8E91]">{r.atajo}</span>
                          <span className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{r.texto}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Flotante>
          ) : null}

          {panel === "plantillas" ? (
            <PanelPlantillas
              plantillas={p.plantillas}
              fueraDeVentana={!ventana}
              contactoNombre={p.contactoNombre}
              onCerrar={() => setPanel(null)}
              onEnviar={(id, vars) => {
                p.onPlantilla(id, vars);
                setPanel(null);
              }}
            />
          ) : null}
        </div>

        {voz.grabando ? (
          <div className="flex min-h-[2.25rem] min-w-0 flex-1 items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 @max-lg:min-h-11 @max-lg:pr-1">
            <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-600" />
            </span>
            <span className="text-sm font-semibold tabular-nums text-red-700">{tiempo(voz.segundos)}</span>
            <span className="truncate text-xs text-red-600">Grabando nota de voz…</span>
            <button type="button" onClick={() => voz.descartar(true)} className="ml-auto inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-red-200 bg-white px-2 text-xs font-semibold text-red-700 hover:bg-red-100 @max-lg:h-10" aria-label="Cancelar grabación">
              <Trash2 className="h-3.5 w-3.5" aria-hidden /> <span className="@max-sm:sr-only">Cancelar</span>
            </button>
            <button type="button" onClick={voz.detener} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg bg-red-600 px-2.5 text-xs font-semibold text-white hover:bg-red-700 @max-lg:h-10">
              <Square className="h-3 w-3 fill-current" aria-hidden /> Listo
            </button>
          </div>
        ) : voz.pendiente ? (
          <div className="flex min-h-[2.25rem] min-w-0 flex-1 items-center gap-2 rounded-xl border border-[#4FAEB2]/40 bg-[#4FAEB2]/[0.06] px-2.5 py-1.5 @max-lg:min-h-11 @max-lg:gap-1 @max-lg:px-1.5 @max-lg:py-1">
            <Mic className="h-4 w-4 shrink-0 text-[#3F8E91] @max-sm:hidden" aria-hidden />
            <audio src={voz.pendiente.url} controls className="h-8 min-w-0 flex-1" />
            <button type="button" onClick={() => voz.descartar(true)} aria-label="Descartar nota de voz" className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-red-600 @max-lg:h-10 @max-lg:w-10 @max-lg:justify-center @max-lg:px-0">
              <Trash2 className="h-3.5 w-3.5 @max-lg:h-4 @max-lg:w-4" aria-hidden /> <span className="@max-lg:sr-only">Descartar</span>
            </button>
          </div>
        ) : (
          <textarea
            ref={area}
            rows={1}
            disabled={bloqueado}
            enterKeyHint={tactil ? "send" : undefined}
            className={`min-w-0 flex-1 resize-none rounded-xl border px-3.5 py-2 text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-50 @max-lg:min-h-11 @max-lg:rounded-[1.375rem] @max-lg:py-2.5 @max-lg:leading-snug ${
              modoNota
                ? "border-amber-300 bg-amber-50 focus:border-amber-400 focus:ring-amber-200"
                : "border-slate-200 bg-white hover:border-[#4FAEB2]/60 focus:border-[#4FAEB2] focus:ring-[#4FAEB2]/20"
            }`}
            placeholder={
              modoNota
                ? tactil ? "Nota interna (el cliente no la ve)…" : "Nota interna para el equipo (el cliente no la ve)…"
                : bloqueado
                  ? tactil ? "Fuera de las 24 h: usá una plantilla" : "Fuera de la ventana de 24 h: elegí una plantilla"
                  : tactil ? "Mensaje  ( / respuestas rápidas)" : "Escribí un mensaje…  (Enter envía · Shift+Enter salto de línea · / respuestas rápidas)"
            }
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={(e) => {
              const item = [...e.clipboardData.items].find((i) => i.kind === "file" && i.type.startsWith("image/"));
              const f = item?.getAsFile();
              if (!f || bloqueado || modoNota) return;
              e.preventDefault();
              setPegada(f);
            }}
          />
        )}
        {/* Chat angosto con el texto vacío: micrófono (como WhatsApp) en lugar de "Enviar". */}
        {puedeGrabar && !texto.trim() ? (
          <button
            type="button"
            onClick={() => void voz.iniciar()}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#4FAEB2] text-white shadow-sm shadow-[#4FAEB2]/20 @lg:hidden"
            aria-label="Grabar nota de voz"
          >
            <Mic className="h-5 w-5" aria-hidden />
          </button>
        ) : null}
        <button
          type="submit"
          disabled={voz.grabando || (!texto.trim() && !voz.pendiente) || (bloqueado && !voz.pendiente)}
          aria-label={modoNota ? "Guardar nota" : "Enviar"}
          className={`shrink-0 items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 @max-lg:h-11 @max-lg:w-11 @max-lg:justify-center @max-lg:rounded-full @max-lg:p-0 ${
            puedeGrabar && !texto.trim() ? "hidden @lg:inline-flex" : "inline-flex"
          } ${modoNota ? "bg-amber-500 hover:bg-amber-600" : "bg-[#4FAEB2] shadow-[#4FAEB2]/20 hover:bg-[#3F8E91]"}`}
        >
          <span className="@max-lg:hidden">{modoNota ? "Guardar nota" : "Enviar"}</span>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 @max-lg:hidden" aria-hidden="true">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
          <SendHorizontal className="hidden h-5 w-5 @max-lg:block" aria-hidden />
        </button>
      </div>
    </form>
  );
}

/**
 * Panel flotante sobre el composer; se cierra con clic afuera o Esc. En celular, si tiene
 * `hoja` (su título), se abre como hoja inferior (las sugerencias de "/" siguen flotando: no
 * pueden robarle el foco al texto). El alto se limita al viewport visible (--capa-alto de la
 * capa del chat): con el teclado abierto nunca queda cortado arriba.
 */
function Flotante({ children, onCerrar, ancho, hoja }: { children: React.ReactNode; onCerrar: () => void; ancho: string; hoja?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const cerrar = useRef(onCerrar);
  cerrar.current = onCerrar;
  const enHoja = useEsMovil() && !!hoja;
  useEffect(() => {
    if (enHoja) return;
    const fuera = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && cerrar.current();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && cerrar.current();
    const t = window.setTimeout(() => document.addEventListener("mousedown", fuera), 0);
    document.addEventListener("keydown", esc);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", esc);
    };
  }, [enHoja]);
  if (enHoja) {
    return (
      <HojaInferior titulo={hoja} onClose={onCerrar} sinPadding>
        {children}
      </HojaInferior>
    );
  }
  return (
    <div ref={ref} className={`absolute bottom-full left-0 z-30 mb-1 flex ${ancho} max-h-[min(26rem,calc(var(--capa-alto,100dvh)-9rem))] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl`}>
      {children}
    </div>
  );
}

function PanelPlantillas({
  plantillas,
  fueraDeVentana,
  contactoNombre,
  onCerrar,
  onEnviar,
}: {
  plantillas: Plantilla[];
  fueraDeVentana: boolean;
  contactoNombre: string;
  onCerrar: () => void;
  onEnviar: (id: string, vars: Record<string, string>) => void;
}) {
  const [sel, setSel] = useState<Plantilla | null>(null);
  const [vars, setVars] = useState<Record<string, string>>({});
  const slots = sel ? variablesDePlantilla(sel.texto) : [];
  const faltan = slots.some((s) => !vars[s]?.trim());
  return (
    <Flotante onCerrar={onCerrar} ancho="w-[min(calc(100vw-2rem),24rem)]" hoja="Recontactar con plantilla">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 max-sm:hidden">
        <span className="text-xs font-semibold text-slate-800">Recontactar con plantilla</span>
        <button type="button" onClick={onCerrar} className="text-slate-400 hover:text-slate-600" aria-label="Cerrar"><X className="h-4 w-4" /></button>
      </div>
      {fueraDeVentana ? (
        <div className="border-b border-amber-100 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
          Pasaron +24 h desde el último mensaje del cliente: para recontactarlo solo se puede enviar una plantilla aprobada.
        </div>
      ) : null}
      <div className="max-h-[22rem] overflow-y-auto overscroll-contain p-2 max-sm:max-h-none max-sm:p-3">
        {!sel ? (
          plantillas.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-slate-500">No hay plantillas aprobadas para este canal.</p>
          ) : (
            <ul className="space-y-0.5">
              {plantillas.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSel(t);
                      const v = variablesDePlantilla(t.texto);
                      setVars(v.includes("1") && contactoNombre !== "Sin nombre" ? { "1": contactoNombre.split(" ")[0] } : {});
                    }}
                    className="w-full rounded-lg px-2 py-2 text-left text-xs hover:bg-slate-50 max-sm:min-h-12 max-sm:text-sm"
                  >
                    <span className="block font-semibold text-slate-900">{t.nombre}</span>
                    <span className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{t.texto}</span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : (
          <div className="space-y-2">
            <button type="button" onClick={() => setSel(null)} className="text-[11px] text-[#3F8E91] hover:underline max-sm:min-h-10 max-sm:text-sm">← Elegir otra</button>
            <p className="text-xs font-semibold text-slate-800">{sel.nombre}</p>
            {slots.map((s) => (
              <label key={s} className="block">
                <span className="mb-0.5 block text-[11px] font-medium text-slate-600">{`{{${s}}}`}</span>
                <input
                  type="text"
                  value={vars[s] ?? ""}
                  onChange={(e) => setVars((prev) => ({ ...prev, [s]: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 max-sm:h-11"
                  placeholder={`Valor para {{${s}}}`}
                />
              </label>
            ))}
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-2">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Vista previa</span>
              <p className="whitespace-pre-wrap break-words text-[12px] text-slate-700">{rellenarPlantilla(sel.texto, vars)}</p>
            </div>
            <button
              type="button"
              disabled={faltan}
              onClick={() => onEnviar(sel.id, vars)}
              className="w-full rounded-lg bg-[#4FAEB2] px-3 py-2 text-xs font-semibold text-white hover:bg-[#3F8E91] disabled:bg-slate-200 disabled:text-slate-400 max-sm:min-h-11 max-sm:text-sm"
            >
              Enviar plantilla
            </button>
          </div>
        )}
      </div>
    </Flotante>
  );
}

function ImagenPegada({ archivo, onCancelar, onEnviar }: { archivo: File; onCancelar: () => void; onEnviar: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(archivo);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [archivo]);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[#4FAEB2]/40 bg-[#4FAEB2]/[0.06] p-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url ? <img src={url} alt="Imagen pegada" className="h-16 w-16 rounded-lg border border-slate-200 bg-white object-cover" /> : null}
      <div className="min-w-0 flex-1 text-xs text-slate-600">
        <p className="font-semibold text-slate-800">Imagen del portapapeles</p>
        <p className="text-[11px] text-slate-500">El texto escrito va como pie de foto.</p>
      </div>
      <button type="button" onClick={onCancelar} className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 @max-lg:min-h-10">Cancelar</button>
      <button type="button" onClick={onEnviar} className="shrink-0 rounded-lg bg-[#4FAEB2] px-3 py-1 text-xs font-semibold text-white hover:bg-[#3F8E91] @max-lg:min-h-10">Enviar</button>
    </div>
  );
}

/** Grabación con MediaRecorder (webm/opus; mp4 en Safari). El servidor la pasa a MP3. */
function useNotaDeVoz(setError: (e: string | null) => void) {
  const [grabando, setGrabando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [pendiente, setPendiente] = useState<{ blob: Blob; url: string; nombre: string } | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const cancelado = useRef(false);
  const reloj = useRef<number | null>(null);

  const pararReloj = () => {
    if (reloj.current != null) window.clearInterval(reloj.current);
    reloj.current = null;
  };

  const detener = useCallback(() => {
    pararReloj();
    if (rec.current && rec.current.state !== "inactive") rec.current.stop();
    setGrabando(false);
  }, []);

  const iniciar = useCallback(async () => {
    setError(null);
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Este navegador no permite grabar audio.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("No hay permiso para usar el micrófono.");
      return;
    }
    const tipo = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
    const r = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined);
    const partes: Blob[] = [];
    cancelado.current = false;
    r.ondataavailable = (e) => e.data.size && partes.push(e.data);
    r.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (cancelado.current || !partes.length) return;
      const mime = r.mimeType || tipo || "audio/webm";
      const blob = new Blob(partes, { type: mime });
      const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
      setPendiente({ blob, url: URL.createObjectURL(blob), nombre: `nota-de-voz-${Date.now()}.${ext}` });
    };
    rec.current = r;
    r.start(250);
    setSegundos(0);
    setGrabando(true);
    reloj.current = window.setInterval(() => {
      setSegundos((s) => {
        if (s + 1 >= MAX_GRABACION_S) detener();
        return s + 1;
      });
    }, 1000);
  }, [detener, setError]);

  const descartar = useCallback(
    (revocar: boolean) => {
      cancelado.current = true;
      detener();
      setPendiente((p) => {
        if (p && revocar) URL.revokeObjectURL(p.url);
        return null;
      });
    },
    [detener],
  );

  useEffect(() => () => {
    cancelado.current = true;
    pararReloj();
    if (rec.current && rec.current.state !== "inactive") rec.current.stop();
  }, []);

  return { grabando, segundos, pendiente, iniciar, detener, descartar };
}
