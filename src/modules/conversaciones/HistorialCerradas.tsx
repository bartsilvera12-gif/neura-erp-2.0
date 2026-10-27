"use client";

/**
 * Historial · modo bandeja: TODAS las conversaciones cerradas en una bandeja de solo
 * lectura (misma tarjeta y búsqueda que la bandeja), con filtro de asignación (todos, sin
 * asignar o un asesor), cola y canal. A la derecha se lee el chat (sin caja de escritura);
 * en celular se abre encima. Misma consulta keyset que la bandeja (chat_bandeja, vista cerradas).
 */
import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { History, MessagesSquare, Search } from "lucide-react";
import { Select } from "@/components/Select";
import { useMediaQuery } from "@/lib/ui/responsive";
import { SIN_ASIGNAR, pedirBandeja, pedirOpciones, type FiltrosBandeja } from "@/modules/conversaciones/api";
import { nombreContacto, telefonoLegible, type Cursor, type FilaBandeja, type OpcionesBandeja } from "@/modules/conversaciones/dominio";
import { ListaConversaciones } from "@/modules/conversaciones/ListaConversaciones";
import { useHilo } from "@/modules/conversaciones/useHilo";
import { Hilo } from "@/modules/conversaciones/Hilo";
import { Girando } from "@/modules/conversaciones/ui";

const VisorChat = dynamic(() => import("@/modules/conversaciones/VisorChat").then((m) => m.VisorChat), { ssr: false });

const MQ_MOVIL = "(max-width: 767.98px)";
const nada = () => {};

export function HistorialCerradas() {
  const movil = useMediaQuery(MQ_MOVIL);
  const [opciones, setOpciones] = useState<OpcionesBandeja | null>(null);
  const [texto, setTexto] = useState("");
  const [q, setQ] = useState("");
  const [asesor, setAsesor] = useState("");
  const [cola, setCola] = useState("");
  const [canal, setCanal] = useState("");
  const [filas, setFilas] = useState<FilaBandeja[]>([]);
  const [siguiente, setSiguiente] = useState<Cursor | null>(null);
  const [cargando, setCargando] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<FilaBandeja | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    pedirOpciones().then(setOpciones).catch((e) => setError((e as Error).message));
  }, []);
  useEffect(() => {
    const t = window.setTimeout(() => setQ(texto.trim()), 300);
    return () => window.clearTimeout(t);
  }, [texto]);

  const filtros = useMemo<FiltrosBandeja>(() => ({ vista: "cerradas", q, asesor, cola, canal }), [q, asesor, cola, canal]);

  useEffect(() => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setCargando(true);
    setError(null);
    pedirBandeja(filtros, null, ac.signal)
      .then((p) => {
        if (ac.signal.aborted) return;
        setFilas(p.rows);
        setSiguiente(p.siguiente);
      })
      .catch((e) => !ac.signal.aborted && setError((e as Error).message))
      .finally(() => !ac.signal.aborted && setCargando(false));
    return () => ac.abort();
  }, [filtros]);

  const cargarMas = useCallback(async () => {
    if (!siguiente || cargandoMas) return;
    setCargandoMas(true);
    try {
      const p = await pedirBandeja(filtros, siguiente);
      setFilas((prev) => {
        const ya = new Set(prev.map((f) => f.id));
        return [...prev, ...p.rows.filter((r) => !ya.has(r.id))];
      });
      setSiguiente(p.siguiente);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargandoMas(false);
    }
  }, [filtros, siguiente, cargandoMas]);

  const abrir = (id: string) => setSel(filas.find((f) => f.id === id) ?? null);
  const colas = opciones?.colas ?? [];

  return (
    <div className="flex min-h-[520px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" style={{ height: "max(520px, calc(100dvh - 17rem))" }}>
      {/* Lista */}
      <aside className="flex min-h-0 w-full shrink-0 flex-col border-slate-200 bg-slate-50/80 md:w-[300px] md:border-r lg:w-[340px] xl:w-[370px]">
        <div className="shrink-0 space-y-2 border-b border-slate-200 p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), setQ(texto.trim()))}
              placeholder="Buscar por nombre, número o mensaje"
              aria-label="Buscar conversaciones cerradas"
              enterKeyHint="search"
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-800 outline-none max-md:h-11 placeholder:text-slate-400 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
            />
          </div>
          <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 md:grid-cols-1 lg:grid-cols-2">
            <Select
              compacto
              block
              etiqueta="Filtrar por asignación"
              value={asesor}
              onChange={setAsesor}
              options={[["", "Todos los asesores"], [SIN_ASIGNAR, "Sin asignar"], ...(opciones?.equipo ?? []).map((u): [string, string] => [u.id, u.nombre])]}
            />
            {colas.length > 1 ? (
              <Select compacto block etiqueta="Filtrar por cola" value={cola} onChange={setCola} options={[["", "Todas las colas"], ...colas.map((c): [string, string] => [c.id, c.nombre])]} />
            ) : null}
            {(opciones?.canales.length ?? 0) > 1 ? (
              <Select compacto block etiqueta="Filtrar por canal" value={canal} onChange={setCanal} options={[["", "Todos los canales"], ...(opciones?.canales ?? []).map((c): [string, string] => [c.id, c.nombre])]} />
            ) : null}
          </div>
        </div>
        <p className="flex shrink-0 items-center justify-between px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Cerradas · solo lectura
          {cargando && filas.length ? <Girando className="h-3 w-3 text-[#3F8E91]" /> : null}
        </p>
        {error ? <p className="mx-3 mb-2 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">{error}</p> : null}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <ListaConversaciones
            filas={filas}
            seleccionadaId={sel?.id ?? null}
            detalle
            cargando={cargando || !opciones}
            hayMas={!!siguiente}
            cargandoMas={cargandoMas}
            hayBusqueda={!!q}
            onAbrir={abrir}
            onCargarMas={() => void cargarMas()}
          />
        </div>
      </aside>

      {/* Lectura (≥ 768 px); en celular, ventana encima */}
      <div className="hidden min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:flex">
        {sel && !movil ? (
          <Lectura key={sel.id} conv={sel} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-slate-400">
            <History className="h-10 w-10 text-slate-300" />
            Elegí una conversación para leerla
          </div>
        )}
      </div>
      {sel && movil ? (
        <VisorChat
          convId={sel.id}
          nombre={sel.contacto_nombre}
          telefono={sel.contacto_telefono}
          detalle={`${telefonoLegible(sel.contacto_telefono)} · ${sel.canal_nombre}${sel.asignado_nombre ? ` · ${sel.asignado_nombre}` : " · sin asignar"}`}
          onCerrar={() => setSel(null)}
          acciones={
            <Link href={`/conversaciones/historial?contacto=${sel.contacto_id}`} className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm">
              Historial del contacto
            </Link>
          }
        />
      ) : null}
    </div>
  );
}

function Lectura({ conv }: { conv: FilaBandeja }) {
  const hilo = useHilo(conv.id, null);
  const nombre = nombreContacto(conv);
  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{nombre}</p>
          <p className="truncate text-[11px] text-slate-500">
            <span className="font-mono tabular-nums">{telefonoLegible(conv.contacto_telefono)}</span> · {conv.canal_nombre}
            {conv.cola_nombre ? ` · ${conv.cola_nombre}` : ""} · {conv.asignado_nombre ?? "Sin asignar"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Link
            href={`/conversaciones/historial?contacto=${conv.contacto_id}`}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:border-[#4FAEB2]/60 hover:text-[#3F8E91]"
          >
            <History className="h-3.5 w-3.5" aria-hidden /> Historial del contacto
          </Link>
          <Link
            href={`/conversaciones?c=${conv.id}`}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:border-[#4FAEB2]/60 hover:text-[#3F8E91]"
          >
            <MessagesSquare className="h-3.5 w-3.5" aria-hidden /> Abrir en la bandeja
          </Link>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Hilo
          convId={conv.id}
          mensajes={hilo.mensajes}
          hayMas={hilo.hayMas}
          cargando={hilo.cargando}
          cargandoAnteriores={hilo.cargandoAnteriores}
          error={hilo.error}
          ultimoId={hilo.ultimoId}
          cargarAnteriores={hilo.cargarAnteriores}
          onReintentar={nada}
          onDescartar={nada}
        />
      </div>
      <p className="shrink-0 border-t border-slate-100 bg-slate-50 px-4 py-1.5 text-[11px] text-slate-400">Solo lectura · se actualiza en vivo</p>
    </>
  );
}
