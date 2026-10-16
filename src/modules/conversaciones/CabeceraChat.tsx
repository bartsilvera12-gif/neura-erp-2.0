"use client";

/**
 * Cabecera del chat abierto (igual que el sistema actual): identidad (abre la ficha),
 * acciones (Ficha, Tomar, Transferir, Etiquetas, Soporte, Finalizar/Reabrir) y chips
 * (canal, estado, ventana de 24 h, agente, etiquetas, cliente, CRM).
 *
 * Responsive por ANCHO DEL PANEL (container queries: PanelChat es `@container`), no de la
 * ventana: con el chat angosto (celular, tablet al lado de la lista, escritorio chico) quedan
 * a la vista la ficha y la acción principal (Tomar o Transferir) y el resto va a "⋯" (hoja
 * inferior en celular); los chips van en UNA fila con scroll horizontal. Con ≥ 672 px de chat,
 * todos los botones como siempre.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeftRight, CheckCircle2, ChevronLeft, Hand, Headset, MoreHorizontal, RotateCcw, Tag, UserRound, X } from "lucide-react";
import { HojaInferior } from "@/components/HojaInferior";
import { MenuAcciones, type ItemMenu } from "@/components/MenuAcciones";
import { ESTADO_CLASE, ESTADO_LABEL, inicial, nombreContacto, telefonoLegible, type FilaBandeja } from "@/modules/conversaciones/dominio";
import { EtiquetasPopover } from "@/modules/conversaciones/Etiquetas";
import { accionConversacion } from "@/modules/conversaciones/api";
import { Avatar, CanalBadge, VentanaWhatsApp } from "@/modules/conversaciones/ui";
import { SlaBadge } from "@/modules/conversaciones/ui-supervision";

const btn = "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[11px] font-semibold shadow-sm transition-colors disabled:opacity-50";
const btnBlanco = `${btn} border-slate-200 bg-white text-slate-700 hover:border-[#4FAEB2]/60 hover:text-[#3F8E91]`;
/** Botones de la versión compacta: 44 px al dedo (40 con mouse). */
const btnCompacto = "inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border text-xs font-semibold shadow-sm transition-colors disabled:opacity-50 [@media(pointer:fine)]:h-10";

export function CabeceraChat({
  conv,
  yo,
  puedeSoporte,
  fichaAbierta,
  ocupado,
  sugeridas,
  onVolver,
  onFicha,
  onTomar,
  onTransferir,
  onTicket,
  onFinalizar,
  onPrecargarFinalizar,
  onReabrir,
  onFila,
}: {
  conv: FilaBandeja;
  yo: string;
  puedeSoporte: boolean;
  fichaAbierta: boolean;
  ocupado: boolean;
  sugeridas: string[];
  onVolver: () => void;
  onFicha: () => void;
  onTomar: () => void;
  onTransferir: () => void;
  onTicket: () => void;
  onFinalizar: () => void;
  onPrecargarFinalizar: () => void;
  onReabrir: () => void;
  onFila: (f: FilaBandeja) => void;
}) {
  const [etiquetas, setEtiquetas] = useState<null | "popover" | "hoja">(null);
  const router = useRouter();
  const nombre = nombreContacto(conv);
  const cerrada = conv.estado === "cerrada";
  const mia = conv.asignado_id === yo;

  // Compacta: la acción principal a la vista; el resto en "⋯".
  const principal: "tomar" | "transferir" | "reabrir" | null = cerrada ? "reabrir" : !mia ? "tomar" : "transferir";
  const mas: ItemMenu[] = [];
  if (!cerrada && principal !== "transferir") mas.push({ etiqueta: "Transferir", icono: <ArrowLeftRight className="h-4 w-4" />, onClick: onTransferir });
  mas.push({ etiqueta: "Etiquetas", icono: <Tag className="h-4 w-4" />, onClick: () => setEtiquetas("hoja") });
  // En el chat angosto los accesos "Cliente →" / "CRM →" van acá (los chips no llegan a 44 px).
  if (conv.cliente_id) mas.push({ etiqueta: "Ver ficha del cliente", icono: <UserRound className="h-4 w-4" />, onClick: () => router.push(`/clientes/${conv.cliente_id}`) });
  if (conv.prospecto_id) mas.push({ etiqueta: "Ver prospecto en CRM", icono: <ArrowLeftRight className="h-4 w-4" />, onClick: () => router.push(`/crm?p=${conv.prospecto_id}`) });
  if (puedeSoporte) mas.push({ etiqueta: "Cargar ticket de soporte", icono: <Headset className="h-4 w-4" />, onClick: onTicket });
  if (!cerrada) {
    mas.push({
      etiqueta: "Finalizar conversación",
      icono: <CheckCircle2 className="h-4 w-4" />,
      onClick: () => {
        onPrecargarFinalizar();
        onFinalizar();
      },
      tono: "exito",
    });
  }

  return (
    <div className="shrink-0 border-b border-slate-200 bg-white px-2 py-2 @2xl:px-4 @2xl:py-3">
      <div className="flex w-full min-w-0 flex-col gap-2 @2xl:gap-2.5">
        <div className="flex min-w-0 items-center justify-between gap-2 @2xl:flex-wrap @2xl:gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 @2xl:flex-none @2xl:gap-2.5">
            <button
              type="button"
              onClick={onVolver}
              aria-label="Volver a la lista de chats"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 hover:text-[#4FAEB2] md:hidden"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <span className="contents @max-sm:hidden"><Avatar letra={inicial(nombre)} conNombre={nombre !== "Sin nombre"} grande /></span>
            <button
              type="button"
              onClick={onFicha}
              title="Ver la ficha del contacto"
              className="min-h-11 min-w-0 flex-1 rounded-lg px-1 py-0.5 text-left leading-tight transition-colors hover:bg-slate-100 @2xl:min-h-0 @2xl:flex-none"
            >
              <p className="truncate text-sm font-semibold text-slate-900 @2xl:max-w-[18rem]">{nombre}</p>
              <p className="mt-0.5 truncate font-mono text-[11px] tabular-nums text-slate-500">{telefonoLegible(conv.contacto_telefono)}</p>
            </button>
          </div>

          {/* Compacta (chat angosto) */}
          <div className="flex shrink-0 items-center gap-1 @2xl:hidden">
            <button
              type="button"
              onClick={onFicha}
              aria-expanded={fichaAbierta}
              aria-label="Ficha del contacto"
              title="Ficha del contacto: cliente, deuda, suscripción, tickets y CRM"
              className={`${btnCompacto} w-11 ${fichaAbierta ? "border-[#4FAEB2] bg-[#4FAEB2]/10 text-[#3F8E91]" : "border-slate-200 bg-white text-slate-700"} [@media(pointer:fine)]:w-10`}
            >
              <UserRound className="h-[18px] w-[18px]" aria-hidden />
            </button>
            {principal === "tomar" ? (
              <button type="button" disabled={ocupado} onClick={onTomar} title="Asignármela" className={`${btnCompacto} border-emerald-300 bg-emerald-50 px-3 text-emerald-800`}>
                <Hand className="h-4 w-4 shrink-0" aria-hidden /> Tomar
              </button>
            ) : principal === "transferir" ? (
              <button type="button" disabled={ocupado} onClick={onTransferir} title="Transferir" aria-label="Transferir" className={`${btnCompacto} border-transparent bg-[#4FAEB2] px-3 text-white`}>
                <ArrowLeftRight className="h-4 w-4 shrink-0" aria-hidden /> <span className="max-[380px]:sr-only">Transferir</span>
              </button>
            ) : (
              <button type="button" disabled={ocupado} onClick={onReabrir} className={`${btnCompacto} border-emerald-300 bg-emerald-50 px-3 text-emerald-800`}>
                <RotateCcw className="h-4 w-4 shrink-0" aria-hidden /> Reabrir
              </button>
            )}
            <MenuAcciones etiqueta="Más acciones del chat" items={mas} className={`${btnCompacto} w-11 border-slate-200 bg-white text-slate-600 [@media(pointer:fine)]:w-10`}>
              <MoreHorizontal className="h-5 w-5" aria-hidden />
            </MenuAcciones>
          </div>

          {/* Completa (chat ancho): igual que siempre */}
          <div className="hidden flex-wrap items-center justify-end gap-1.5 @2xl:flex">
            <button
              type="button"
              onClick={onFicha}
              aria-expanded={fichaAbierta}
              title="Ficha del contacto: cliente, deuda, suscripción, tickets y CRM"
              className={`${btn} ${fichaAbierta ? "border-[#4FAEB2] bg-[#4FAEB2]/10 text-[#3F8E91]" : "border-slate-200 bg-white text-slate-700 hover:border-[#4FAEB2]/60 hover:text-[#3F8E91]"}`}
            >
              <UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden /> Ficha
            </button>
            {!cerrada && !mia ? (
              <button type="button" disabled={ocupado} onClick={onTomar} className={`${btn} border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100`} title="Asignármela">
                <Hand className="h-3.5 w-3.5 shrink-0" aria-hidden /> Tomar
              </button>
            ) : null}
            {!cerrada ? (
              <button type="button" disabled={ocupado} onClick={onTransferir} className={`${btn} border-transparent bg-[#4FAEB2] text-white shadow-[#4FAEB2]/25 hover:bg-[#3F8E91]`}>
                <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" aria-hidden /> Transferir
              </button>
            ) : null}
            <div className="relative">
              <button type="button" onClick={() => setEtiquetas((v) => (v ? null : "popover"))} className={btnBlanco} aria-expanded={etiquetas === "popover"}>
                <Tag className="h-3.5 w-3.5 shrink-0" aria-hidden /> Etiquetas
              </button>
              {etiquetas === "popover" ? (
                <EtiquetasPopover conv={conv} sugeridas={sugeridas} onCerrar={() => setEtiquetas(null)} onListo={(f) => onFila(f)} />
              ) : null}
            </div>
            {puedeSoporte ? (
              <button type="button" onClick={onTicket} title="Cargar un ticket de soporte para este cliente" className={`${btn} border-violet-200 bg-white text-violet-700 hover:border-violet-300 hover:bg-violet-50`}>
                <Headset className="h-3.5 w-3.5 shrink-0" aria-hidden /> Soporte
              </button>
            ) : null}
            {!cerrada ? (
              <button type="button" disabled={ocupado} onClick={onFinalizar} onMouseEnter={onPrecargarFinalizar} onFocus={onPrecargarFinalizar} className={`${btnBlanco} hover:bg-[#4FAEB2]/5`}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 shrink-0" aria-hidden="true">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                Finalizar
              </button>
            ) : (
              <button type="button" disabled={ocupado} onClick={onReabrir} className={`${btn} border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100`}>
                Reabrir
              </button>
            )}
          </div>
        </div>

        {/* Chips: una fila con scroll horizontal en el chat angosto; en el ancho, se envuelven. */}
        <div className="scroll-x-oculto flex min-w-0 items-center gap-1.5 [&>*]:shrink-0 @2xl:flex-wrap @2xl:overflow-visible">
          <CanalBadge tipo={conv.canal_tipo} nombre={conv.canal_nombre} />
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${ESTADO_CLASE[conv.estado]}`}>{ESTADO_LABEL[conv.estado]}</span>
          <span aria-hidden="true" className="mx-0.5 h-3.5 w-px bg-slate-200" />
          {!cerrada ? <VentanaWhatsApp canalTipo={conv.canal_tipo} expira={conv.ventana_expira_at} /> : null}
          {!cerrada ? <SlaBadge vence={conv.sla_vence_at} primera={conv.primera_respuesta_at} /> : null}
          {conv.asignado_nombre ? (
            <span className="inline-flex max-w-[11rem] items-center gap-1 truncate rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800" title="Agente asignado">
              <UserRound className="h-3 w-3 shrink-0" aria-hidden /> {mia ? "Vos" : conv.asignado_nombre}
            </span>
          ) : !cerrada ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
              <UserRound className="h-3 w-3 shrink-0" aria-hidden /> Sin agente
            </span>
          ) : null}
          {conv.etiquetas.map((e) => (
            <span key={e} className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
              {e}
              <button
                type="button"
                onClick={() => void accionConversacion(conv.id, { accion: "etiquetas", etiquetas: conv.etiquetas.filter((x) => x !== e) }).then(onFila).catch(() => {})}
                aria-label={`Quitar ${e}`}
                className="text-indigo-300 hover:text-indigo-700 @max-2xl:hidden"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
          {conv.cliente_id ? (
            <>
              <span aria-hidden="true" className="mx-0.5 h-3.5 w-px bg-slate-200 @max-2xl:hidden" />
              <Link href={`/clientes/${conv.cliente_id}`} className="inline-flex items-center gap-1 rounded-full border border-[#4FAEB2]/30 bg-[#4FAEB2]/10 px-2 py-0.5 text-[10px] font-semibold text-[#3F8E91] hover:bg-[#4FAEB2]/20 @max-2xl:hidden">
                Cliente →
              </Link>
            </>
          ) : null}
          {conv.prospecto_id ? (
            <Link href={`/crm?p=${conv.prospecto_id}`} className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700 hover:bg-violet-100 @max-2xl:hidden">
              CRM →
            </Link>
          ) : null}
        </div>
      </div>

      {etiquetas === "hoja" ? (
        <HojaInferior titulo="Etiquetas" onClose={() => setEtiquetas(null)} z="z-[150]">
          <EtiquetasPopover conv={conv} sugeridas={sugeridas} onCerrar={() => setEtiquetas(null)} onListo={(f) => onFila(f)} enLinea />
        </HojaInferior>
      ) : null}
    </div>
  );
}
