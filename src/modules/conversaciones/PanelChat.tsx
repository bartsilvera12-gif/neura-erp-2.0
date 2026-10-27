"use client";

/** Panel central: cabecera + hilo + caja de escritura del chat abierto, y sus ventanas. */
import { useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Paperclip } from "lucide-react";
import { accionConversacion, pedirCatalogoCierre } from "@/modules/conversaciones/api";
import { nombreContacto, type FilaBandeja, type Mensaje, type OpcionesBandeja } from "@/modules/conversaciones/dominio";
import { useHilo } from "@/modules/conversaciones/useHilo";
import { CabeceraChat } from "@/modules/conversaciones/CabeceraChat";
import { Hilo } from "@/modules/conversaciones/Hilo";
import { Composer } from "@/modules/conversaciones/Composer";
import { olvidarFicha } from "@/modules/conversaciones/ficha-cache";

// Las ventanas se descargan recién cuando alguien las abre.
const FichaContacto = dynamic(() => import("@/modules/conversaciones/FichaContacto").then((m) => m.FichaContacto), { ssr: false });
const ModalTransferir = dynamic(() => import("@/modules/conversaciones/ModalTransferir").then((m) => m.ModalTransferir), { ssr: false });
const ModalFinalizar = dynamic(() => import("@/modules/conversaciones/ModalFinalizar").then((m) => m.ModalFinalizar), { ssr: false });
const ModalTicket = dynamic(() => import("@/modules/conversaciones/ModalTicket").then((m) => m.ModalTicket), { ssr: false });

type Ventana = null | "ficha" | "transferir" | "finalizar" | "ticket";

export function PanelChat({
  conv,
  opciones,
  yoNombre,
  sugeridas,
  onFila,
  onVolver,
  onAviso,
}: {
  conv: FilaBandeja;
  opciones: OpcionesBandeja;
  yoNombre: string;
  sugeridas: string[];
  onFila: (f: FilaBandeja) => void;
  onVolver: () => void;
  onAviso: (texto: string, tono?: "ok" | "error") => void;
}) {
  const [ventana, setVentana] = useState<Ventana>(null);
  const [respondiendo, setRespondiendo] = useState<Mensaje | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const hilo = useHilo(conv.id, { id: opciones.yo, nombre: yoNombre });

  const correr = useCallback(
    async (fn: () => Promise<FilaBandeja>) => {
      setOcupado(true);
      try {
        onFila(await fn());
      } catch (e) {
        onAviso((e as Error).message, "error");
      } finally {
        setOcupado(false);
      }
    },
    [onFila, onAviso],
  );

  const cerrarVentana = useCallback(() => setVentana(null), []);
  const nombre = nombreContacto(conv);

  // Arrastrar y soltar archivos sobre el chat (como WhatsApp Web): el Composer los muestra antes de enviar.
  const [arrastrando, setArrastrando] = useState(false);
  const [soltados, setSoltados] = useState<{ id: number; archivos: File[] } | null>(null);
  const capas = useRef(0);
  const conArchivos = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");

  return (
    <div
      className="@container relative flex min-h-0 flex-1 flex-col overflow-hidden"
      onDragEnter={(e) => {
        if (!conArchivos(e)) return;
        e.preventDefault();
        capas.current += 1;
        setArrastrando(true);
      }}
      onDragOver={(e) => {
        if (!conArchivos(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = conv.estado === "cerrada" ? "none" : "copy";
      }}
      onDragLeave={(e) => {
        if (!conArchivos(e)) return;
        capas.current = Math.max(0, capas.current - 1);
        if (!capas.current) setArrastrando(false);
      }}
      onDrop={(e) => {
        if (!conArchivos(e)) return;
        e.preventDefault();
        capas.current = 0;
        setArrastrando(false);
        const archivos = [...e.dataTransfer.files];
        if (archivos.length) setSoltados({ id: Date.now(), archivos });
      }}
    >
      {arrastrando ? (
        <div className="pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#4FAEB2] bg-white/90 text-center backdrop-blur-sm">
          <Paperclip className="h-8 w-8 text-[#4FAEB2]" aria-hidden />
          {conv.estado === "cerrada" ? (
            <p className="text-sm font-semibold text-slate-600">La conversación está cerrada: reabrila para enviar archivos</p>
          ) : (
            <>
              <p className="text-base font-semibold text-[#3F8E91]">Soltá los archivos para enviarlos</p>
              <p className="text-xs text-slate-500">Imágenes, videos, audios o documentos · hasta 10 por vez</p>
            </>
          )}
        </div>
      ) : null}
      <CabeceraChat
        conv={conv}
        yo={opciones.yo}
        puedeSoporte={opciones.puede_soporte}
        fichaAbierta={ventana === "ficha"}
        ocupado={ocupado}
        sugeridas={sugeridas}
        onVolver={onVolver}
        onFicha={() => setVentana((v) => (v === "ficha" ? null : "ficha"))}
        onTomar={() => void correr(() => accionConversacion(conv.id, { accion: "tomar" }))}
        onTransferir={() => setVentana("transferir")}
        onTicket={() => setVentana("ticket")}
        onFinalizar={() => setVentana("finalizar")}
        onPrecargarFinalizar={() => void pedirCatalogoCierre().catch(() => {})}
        onReabrir={() => void correr(() => accionConversacion(conv.id, { accion: "reabrir" }))}
        onFila={onFila}
      />
      {hilo.error && !hilo.mensajes.length ? (
        <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">{hilo.error}</div>
      ) : null}
      <Hilo
        convId={conv.id}
        mensajes={hilo.mensajes}
        hayMas={hilo.hayMas}
        cargando={hilo.cargando}
        cargandoAnteriores={hilo.cargandoAnteriores}
        error={hilo.error}
        ultimoId={hilo.ultimoId}
        cargarAnteriores={hilo.cargarAnteriores}
        onResponder={setRespondiendo}
        onReintentar={hilo.reintentar}
        onDescartar={hilo.descartar}
      />
      <Composer
        conv={conv}
        contactoNombre={nombre}
        respuestas={opciones.respuestas}
        plantillas={opciones.plantillas}
        respondiendo={respondiendo}
        onCancelarRespuesta={() => setRespondiendo(null)}
        onTexto={(t, r) => hilo.enviar({ tipo: "texto", contenido: t, responde_a: r })}
        onNota={(t) => hilo.enviar({ tipo: "nota", contenido: t })}
        onPlantilla={(id, vars) => hilo.enviar({ tipo: "plantilla", plantilla_id: id, variables: vars })}
        onArchivo={(a, o) => hilo.enviarArchivo(a, o)}
        onReabrir={() => void correr(() => accionConversacion(conv.id, { accion: "reabrir" }))}
        soltados={soltados}
      />

      {ventana === "ficha" ? <FichaContacto conv={conv} onCerrar={cerrarVentana} onFila={onFila} /> : null}
      {ventana === "transferir" ? (
        <ModalTransferir
          conv={conv}
          equipo={opciones.equipo}
          colas={opciones.colas ?? []}
          yo={opciones.yo}
          onCerrar={cerrarVentana}
          onListo={(f, cola) => {
            onFila(f);
            setVentana(null);
            onAviso(
              cola
                ? `Derivada a ${cola}${f.asignado_nombre ? ` · la tiene ${f.asignado_nombre}` : " · queda en la cola sin asesor"}`
                : f.asignado_nombre ? `Transferida a ${f.asignado_nombre}` : "Quedó sin asignar",
            );
          }}
        />
      ) : null}
      {ventana === "finalizar" ? (
        <ModalFinalizar
          conv={conv}
          onCerrar={cerrarVentana}
          onListo={(f, aviso) => {
            if (f) onFila(f);
            olvidarFicha(conv.id);
            setVentana(null);
            onAviso(aviso);
          }}
        />
      ) : null}
      {ventana === "ticket" ? <ModalTicket conv={conv} contacto={nombre} onCerrar={cerrarVentana} onAbrirFicha={() => setVentana("ficha")} /> : null}
    </div>
  );
}
