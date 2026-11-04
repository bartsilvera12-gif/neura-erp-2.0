"use client";

/**
 * Receta 140: avisos a interesados.
 *   · Con `propiedadId` (ficha de la propiedad): todos los de esa propiedad; los descartados, plegados.
 *   · Sin él (pantalla de Propiedades): los pendientes de la empresa, con la propiedad de cada uno.
 * "WhatsApp" abre el chat con el mensaje armado (no manda nada solo) y deja el aviso como enviado;
 * "Ya le avisé" es para cuando se lo dijo por otro lado; "Descartar" lo saca de pendientes.
 */
import { useCallback, useEffect, useState } from "react";
import { BellRing, Check, ChevronDown, MessageCircle, Undo2, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { linkAviso } from "@/modules/inmobiliaria/avisos";
import type { AvisoInteresado } from "@/modules/inmobiliaria/tipos";

const fecha = (s: string | null) => (s ? new Date(s).toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit" }) : "");
const BTN = "inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition disabled:opacity-50 [@media(pointer:coarse)]:min-h-11";

function Fila({ a, conPropiedad, onAbrir, onCambio }: {
  a: AvisoInteresado; conPropiedad: boolean; onAbrir?: (id: string) => void; onCambio: (a: AvisoInteresado) => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = linkAviso(a);
  const resolver = async (estado: "enviado" | "descartado" | "pendiente", canal?: "whatsapp" | "otro") => {
    setOcupado(true); setError(null);
    try {
      onCambio(await apiFetch<AvisoInteresado>(`/api/inmobiliaria/avisos/${a.id}`, { method: "PATCH", body: JSON.stringify({ estado, canal: canal ?? null }) }));
    } catch (e) { setError((e as Error).message); } finally { setOcupado(false); }
  };
  const whatsapp = () => {
    if (!link) return;
    window.open(link, "_blank", "noopener");
    void resolver("enviado", "whatsapp");
  };
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 text-sm">
        {conPropiedad ? (
          <button type="button" onClick={() => onAbrir?.(a.propiedad_id)} className="block max-w-full truncate text-left text-[11px] font-medium text-[var(--brand)] hover:underline">
            {a.codigo} · {a.titulo}
          </button>
        ) : null}
        <p className="truncate font-semibold text-slate-900">{a.cliente}</p>
        <p className="truncate text-xs text-slate-500">
          Busca {a.gestion === "venta" ? "comprar" : "alquilar"}{a.telefono ? ` · ${a.telefono}` : " · sin teléfono"}{a.notas ? ` · ${a.notas}` : ""}
        </p>
        {error ? <p role="alert" className="mt-1 text-xs text-rose-600">{error}</p> : null}
      </div>
      {a.estado === "pendiente" ? (
        <div className="flex shrink-0 flex-wrap gap-1.5 max-sm:[&>*]:flex-1 max-sm:[&>*]:justify-center">
          {link ? (
            <button type="button" disabled={ocupado} onClick={whatsapp} className={`${BTN} bg-emerald-600 text-white hover:bg-emerald-700`}>
              <MessageCircle className="h-3.5 w-3.5" aria-hidden /> WhatsApp
            </button>
          ) : null}
          <button type="button" disabled={ocupado} onClick={() => void resolver("enviado", "otro")} className={`${BTN} border border-slate-200 text-slate-700 hover:bg-slate-50`}>
            <Check className="h-3.5 w-3.5" aria-hidden /> Ya le avisé
          </button>
          <button type="button" disabled={ocupado} onClick={() => void resolver("descartado")} aria-label={`Descartar el aviso a ${a.cliente}`} className={`${BTN} text-slate-500 hover:bg-slate-100`}>
            <X className="h-3.5 w-3.5" aria-hidden /> Descartar
          </button>
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-2 text-xs text-slate-500">
          <span>{a.estado === "enviado" ? `Avisado${a.canal === "whatsapp" ? " por WhatsApp" : ""} el ${fecha(a.resuelto_at)}` : "Descartado"}</span>
          <button type="button" disabled={ocupado} onClick={() => void resolver("pendiente")} className={`${BTN} text-slate-500 hover:bg-slate-100`}>
            <Undo2 className="h-3.5 w-3.5" aria-hidden /> Deshacer
          </button>
        </div>
      )}
    </li>
  );
}

export function AvisosInteresados({ propiedadId, onAbrir, recargar = 0 }: { propiedadId?: string; onAbrir?: (id: string) => void; recargar?: number }) {
  const [avisos, setAvisos] = useState<AvisoInteresado[] | null>(null);
  const [abierto, setAbierto] = useState(true);
  const [verDescartados, setVerDescartados] = useState(false);

  const cargar = useCallback(() => {
    apiFetch<AvisoInteresado[]>(`/api/inmobiliaria/avisos${propiedadId ? `?propiedad=${propiedadId}` : ""}`)
      .then(setAvisos).catch(() => setAvisos([]));
  }, [propiedadId]);
  useEffect(() => { cargar(); }, [cargar, recargar]);

  if (!avisos) return null;
  const cambiar = (n: AvisoInteresado) => setAvisos((l) => (l ?? []).map((x) => (x.id === n.id ? n : x)));
  const pendientes = avisos.filter((a) => a.estado === "pendiente");

  // Pantalla de Propiedades: solo si hay pendientes (los resueltos se quedan visibles hasta recargar).
  if (!propiedadId) {
    if (!avisos.length) return null;
    return (
      <section className="rounded-2xl border border-sky-200 bg-sky-50/60 p-3 sm:p-4">
        <button type="button" onClick={() => setAbierto((v) => !v)} className="flex w-full items-center justify-between gap-2 text-left" aria-expanded={abierto}>
          <span className="flex items-center gap-2 text-sm font-semibold text-sky-900">
            <BellRing className="h-4 w-4" aria-hidden />
            {pendientes.length ? `${pendientes.length} ${pendientes.length === 1 ? "cliente para avisar" : "clientes para avisar"}` : "Avisos al día"}
          </span>
          <ChevronDown className={`h-4 w-4 text-sky-700 transition ${abierto ? "rotate-180" : ""}`} aria-hidden />
        </button>
        {abierto ? (
          <>
            <p className="mt-1 text-xs text-sky-800">Entraron propiedades que coinciden con lo que buscan. WhatsApp abre el chat con el mensaje listo para enviar.</p>
            <ul className="m-0 mt-3 list-none space-y-2 p-0">
              {avisos.map((a) => <Fila key={a.id} a={a} conPropiedad onAbrir={onAbrir} onCambio={cambiar} />)}
            </ul>
          </>
        ) : null}
      </section>
    );
  }

  // Ficha de la propiedad.
  const visibles = avisos.filter((a) => a.estado !== "descartado");
  const descartados = avisos.filter((a) => a.estado === "descartado");
  if (!avisos.length) return null;
  return (
    <section className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
      <p className="flex items-center gap-2 font-semibold">
        <BellRing className="h-4 w-4" aria-hidden />
        {pendientes.length
          ? `${pendientes.length} ${pendientes.length === 1 ? "cliente busca" : "clientes buscan"} algo así: avisales`
          : `${avisos.length} ${avisos.length === 1 ? "cliente busca" : "clientes buscan"} algo así`}
      </p>
      {visibles.length ? <ul className="m-0 mt-2 list-none space-y-2 p-0">{visibles.map((a) => <Fila key={a.id} a={a} conPropiedad={false} onCambio={cambiar} />)}</ul> : null}
      {descartados.length ? (
        <>
          <button type="button" onClick={() => setVerDescartados((v) => !v)} className="mt-2 text-xs font-medium text-sky-800 hover:underline">
            {verDescartados ? "Ocultar" : "Ver"} {descartados.length} {descartados.length === 1 ? "que ya la conocía o se descartó" : "que ya la conocían o se descartaron"}
          </button>
          {verDescartados ? <ul className="m-0 mt-2 list-none space-y-2 p-0">{descartados.map((a) => <Fila key={a.id} a={a} conPropiedad={false} onCambio={cambiar} />)}</ul> : null}
        </>
      ) : null}
    </section>
  );
}
