"use client";

/**
 * Estado › Sub-estado en UN paso: buscador con la lista agrupada por estado (no es un
 * <select>). Escribir filtra (sin tildes, cualquier orden de palabras), ↑/↓ mueven, Enter
 * elige. Elegido, queda como una franja con "Cambiar". Muestra qué acción dispara cada
 * sub-estado (crea ticket / agenda capacitación).
 */
import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from "react";
import { CalendarClock, Check, Headset, Search, X } from "lucide-react";
import { sufijoAccion, type EstadoCat, type SubEstadoCat } from "@/modules/tipificacion/dominio";

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

type Opcion = { familia: EstadoCat; sub: SubEstadoCat; texto: string };

export type ElegirSubestadoRef = { enfocar: () => void };

export const ElegirSubestado = forwardRef<ElegirSubestadoRef, {
  familias: EstadoCat[];
  estadoId: string;
  subestadoId: string;
  onElegir: (estadoId: string, subestadoId: string) => void;
  deshabilitado?: boolean;
}>(function ElegirSubestado({ familias, estadoId, subestadoId, onElegir, deshabilitado }, ref) {
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState(!subestadoId);
  const [hi, setHi] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const id = useId();

  useImperativeHandle(ref, () => ({
    enfocar: () => { setAbierto(true); window.setTimeout(() => input.current?.focus({ preventScroll: true }), 0); },
  }), []);

  // Un borrador recuperado (o un reinicio) cambia lo elegido desde afuera.
  useEffect(() => { setAbierto(!subestadoId); }, [subestadoId]);

  const opciones = useMemo<Opcion[]>(
    () => familias.flatMap((f) => f.subestados.map((s) => ({ familia: f, sub: s, texto: norm(`${f.nombre} ${s.nombre} ${sufijoAccion(s.comportamiento)}`) }))),
    [familias],
  );
  const filtradas = useMemo(() => {
    const t = norm(q).split(/\s+/).filter(Boolean);
    return t.length ? opciones.filter((o) => t.every((x) => o.texto.includes(x))) : opciones;
  }, [opciones, q]);
  useEffect(() => { setHi(0); }, [q]);
  useEffect(() => {
    lista.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: "nearest" });
  }, [hi]);

  const elegida = opciones.find((o) => o.sub.id === subestadoId && o.familia.id === estadoId) ?? null;

  function elegir(o: Opcion) {
    onElegir(o.familia.id, o.sub.id);
    setQ("");
    setAbierto(false);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, filtradas.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter" && !(e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const o = filtradas[hi];
      if (o) elegir(o);
    } else if (e.key === "Escape" && elegida && abierto) {
      // Vuelve a lo que estaba elegido sin cerrar el formulario.
      e.preventDefault();
      e.stopPropagation();
      setQ("");
      setAbierto(false);
    }
  }

  if (elegida && !abierto) {
    const Icono = iconoAccion(elegida.sub.comportamiento);
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[var(--brand)]/40 bg-[var(--brand-50)] px-3 py-2">
        <Check className="h-4 w-4 shrink-0 text-[var(--brand)]" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{elegida.familia.nombre}</p>
          <p className="text-[13.5px] font-semibold leading-snug text-slate-800 [overflow-wrap:anywhere]">{elegida.sub.nombre}</p>
        </div>
        {Icono ? <AccionChip comp={elegida.sub.comportamiento} /> : null}
        <button type="button" disabled={deshabilitado} onClick={() => { setAbierto(true); window.setTimeout(() => input.current?.focus(), 0); }}
          className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--brand)] transition hover:bg-white max-sm:min-h-11">
          Cambiar
        </button>
      </div>
    );
  }

  let ultimaFamilia = "";
  return (
    <div className="rounded-xl border border-slate-200 bg-white focus-within:border-[var(--brand)] focus-within:ring-2 focus-within:ring-[var(--brand)]/15">
      <div className="flex items-center gap-2 border-b border-slate-100 px-3">
        <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
        <input
          ref={input}
          value={q}
          disabled={deshabilitado}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          role="combobox"
          aria-expanded
          aria-controls={`${id}-lista`}
          aria-activedescendant={filtradas[hi] ? `${id}-${hi}` : undefined}
          aria-label="Buscar estado o sub-estado"
          placeholder="Buscá el motivo: reclamo, factura, capacitación…"
          className="min-h-11 w-full min-w-0 bg-transparent py-2 text-[13.5px] text-slate-800 outline-none placeholder:text-slate-400"
        />
        {q ? (
          <button type="button" aria-label="Borrar búsqueda" onClick={() => { setQ(""); input.current?.focus(); }}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        ) : null}
        {elegida ? (
          <button type="button" onClick={() => { setQ(""); setAbierto(false); }} className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100">
            Cancelar
          </button>
        ) : null}
      </div>
      <div ref={lista} id={`${id}-lista`} role="listbox" aria-label="Estados y sub-estados" className="max-h-64 overflow-y-auto overscroll-contain p-1.5">
        {filtradas.length === 0 ? (
          <p className="px-3 py-4 text-center text-[13px] text-slate-400">Nada coincide con “{q}”.</p>
        ) : (
          filtradas.map((o, i) => {
            const cabecera = o.familia.id !== ultimaFamilia;
            ultimaFamilia = o.familia.id;
            const activa = i === hi;
            const sel = o.sub.id === subestadoId;
            return (
              <div key={o.sub.id}>
                {cabecera ? <p className="px-2.5 pb-1 pt-2 text-[10.5px] font-bold uppercase tracking-[0.14em] text-slate-400 first:pt-1">{o.familia.nombre}</p> : null}
                <button
                  type="button"
                  id={`${id}-${i}`}
                  data-i={i}
                  role="option"
                  aria-selected={sel}
                  onMouseEnter={() => setHi(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => elegir(o)}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors max-sm:min-h-11 ${activa ? "bg-slate-100 text-slate-900" : "text-slate-700"} ${sel ? "font-semibold text-[var(--brand)]" : ""}`}
                >
                  <span className="min-w-0 [overflow-wrap:anywhere]">{o.sub.nombre}</span>
                  <AccionChip comp={o.sub.comportamiento} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
});

function iconoAccion(c: SubEstadoCat["comportamiento"]) {
  return c === "ticket_error" || c === "ticket_cambio" ? Headset : c === "capacitacion" ? CalendarClock : null;
}

function AccionChip({ comp }: { comp: SubEstadoCat["comportamiento"] }) {
  const Icono = iconoAccion(comp);
  if (!Icono) return null;
  const ticket = comp !== "capacitacion";
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${ticket ? "bg-rose-50 text-rose-700" : "bg-indigo-50 text-indigo-700"}`}>
      <Icono className="h-3 w-3" aria-hidden /> {ticket ? (comp === "ticket_error" ? "Ticket error" : "Ticket cambio") : "Capacitación"}
    </span>
  );
}
