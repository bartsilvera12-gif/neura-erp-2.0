"use client";

/**
 * Estado de la lista de la bandeja.
 *   · Primera página por keyset (40) y "cargar más" con el cursor del último.
 *   · Aviso Realtime "conversacion" → se pide SOLO esa fila (/resumen, con coalescencia por
 *     id) y se inserta/reordena/quita en el lugar. Nunca se recarga la lista entera.
 *   · Contadores de las pestañas: se refrescan con una consulta mínima, agrupada (2.5 s).
 *   · Sin Realtime: sondeo de respaldo (30 s, solo con la pestaña visible).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { marcarLeida, pedirBandeja, pedirContadores, pedirResumen, type FiltrosBandeja } from "@/modules/conversaciones/api";
import { CONTADORES_VACIOS, compararFilas, filaEnVista, type Contadores, type Cursor, type FilaBandeja } from "@/modules/conversaciones/dominio";
import { useBroadcast, useRespaldo } from "@/modules/conversaciones/realtime";

export function useBandeja({ empresaId, yo, filtros }: { empresaId: string | null; yo: string | null; filtros: FiltrosBandeja }) {
  const [filas, setFilas] = useState<FilaBandeja[]>([]);
  const [siguiente, setSiguiente] = useState<Cursor | null>(null);
  const [contadores, setContadores] = useState<Contadores>(CONTADORES_VACIOS);
  const [cargando, setCargando] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [sel, setSel] = useState<FilaBandeja | null>(null);

  const filasRef = useRef(filas);
  filasRef.current = filas;
  const filtrosRef = useRef(filtros);
  filtrosRef.current = filtros;
  const sigRef = useRef(siguiente);
  sigRef.current = siguiente;
  const selIdRef = useRef(selId);
  selIdRef.current = selId;
  const abortRef = useRef<AbortController | null>(null);
  const cargandoMasRef = useRef(false);

  // ── Primera página ─────────────────────────────────────────────────────────
  const cargar = useCallback(async (silencioso = false) => {
    if (!yo) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    if (!silencioso) setCargando(true);
    try {
      const p = await pedirBandeja(filtrosRef.current, null, ac.signal);
      if (ac.signal.aborted) return;
      setContadores(p.contadores);
      if (silencioso && sigRef.current && filasRef.current.length > p.rows.length) {
        // Respaldo con varias páginas cargadas: se mezcla la primera en lo que ya hay.
        // Con búsqueda el orden es por relevancia (las páginas ya vienen en orden): no se reordena por fecha.
        const nuevas = new Map(p.rows.map((r) => [r.id, r]));
        const conQ = !!filtrosRef.current.q.trim();
        setFilas((prev) => {
          const juntas = [...p.rows, ...prev.filter((f) => !nuevas.has(f.id))];
          return conQ ? juntas : juntas.sort(compararFilas);
        });
      } else {
        setFilas(p.rows);
        setSiguiente(p.siguiente);
      }
      setError(null);
    } catch (e) {
      if (!ac.signal.aborted) setError((e as Error).message);
    } finally {
      if (!ac.signal.aborted) setCargando(false);
    }
  }, [yo]);

  const claveFiltros = `${filtros.vista}|${filtros.q}|${filtros.canal}|${filtros.asesor}|${filtros.cola ?? ""}`;
  useEffect(() => {
    setFilas([]);
    setSiguiente(null);
    void cargar();
  }, [claveFiltros, cargar]);

  const cargarMas = useCallback(async () => {
    const cur = sigRef.current;
    if (!cur || cargandoMasRef.current) return;
    cargandoMasRef.current = true;
    setCargandoMas(true);
    try {
      const p = await pedirBandeja(filtrosRef.current, cur);
      setFilas((prev) => {
        const ya = new Set(prev.map((f) => f.id));
        return [...prev, ...p.rows.filter((r) => !ya.has(r.id))];
      });
      setSiguiente(p.siguiente);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      cargandoMasRef.current = false;
      setCargandoMas(false);
    }
  }, []);

  // ── Contadores (agrupados) ─────────────────────────────────────────────────
  const timerCont = useRef<number | null>(null);
  const refrescarContadores = useCallback((ms = 2500) => {
    if (timerCont.current != null) return;
    timerCont.current = window.setTimeout(() => {
      timerCont.current = null;
      pedirContadores().then(setContadores).catch(() => {});
    }, ms);
  }, []);
  useEffect(() => () => {
    if (timerCont.current != null) window.clearTimeout(timerCont.current);
  }, []);

  // ── Marcar leída la abierta (agrupado por id) ──────────────────────────────
  const timerLeida = useRef<number | null>(null);
  const leerPronto = useCallback((id: string) => {
    if (timerLeida.current != null) window.clearTimeout(timerLeida.current);
    timerLeida.current = window.setTimeout(() => {
      timerLeida.current = null;
      if (selIdRef.current === id && document.visibilityState === "visible") void marcarLeida(id).catch(() => {});
    }, 700);
  }, []);

  // ── Insertar / reordenar / quitar UNA fila ─────────────────────────────────
  const aplicarFila = useCallback(
    (fila: FilaBandeja) => {
      const esSel = fila.id === selIdRef.current;
      const visible = typeof document !== "undefined" && document.visibilityState === "visible";
      const f = esSel && visible && fila.no_leidos > 0 ? { ...fila, no_leidos: 0 } : fila;
      if (esSel && visible && fila.no_leidos > 0) leerPronto(fila.id);
      if (esSel) setSel(f);
      const yoId = yo ?? "";
      const entra = filaEnVista(f, filtrosRef.current.vista, yoId, filtrosRef.current);
      setFilas((prev) => {
        const i = prev.findIndex((x) => x.id === f.id);
        if (!entra) return i < 0 ? prev : prev.filter((x) => x.id !== f.id);
        // Con búsqueda activa: la fila se actualiza en su lugar (orden por relevancia, no por
        // fecha) y conserva el fragmento que coincidió (/resumen no lo trae).
        if (filtrosRef.current.q.trim()) {
          if (i < 0) return prev;
          const copia = prev.slice();
          copia[i] = { ...f, coincidencia: f.coincidencia ?? prev[i].coincidencia };
          return copia;
        }
        if (i < 0) {
          // Más vieja que lo cargado (y hay más páginas): llegará al paginar.
          const cur = sigRef.current;
          if (cur && f.ultimo_mensaje_at && Date.parse(f.ultimo_mensaje_at) < Date.parse(cur.at)) return prev;
        }
        const sin = i < 0 ? prev : prev.filter((x) => x.id !== f.id);
        // Inserción ordenada (la lista ya viene ordenada).
        let j = 0;
        while (j < sin.length && compararFilas(sin[j], f) < 0) j++;
        return [...sin.slice(0, j), f, ...sin.slice(j)];
      });
    },
    [yo, leerPronto],
  );

  const quitarFila = useCallback((id: string) => setFilas((prev) => prev.filter((x) => x.id !== id)), []);

  // Pedido de /resumen por id con coalescencia (avisos seguidos de la misma conversación → 1-2 pedidos).
  const enCurso = useRef(new Map<string, boolean>());
  const refrescarFila = useCallback(
    async (id: string) => {
      if (enCurso.current.has(id)) {
        enCurso.current.set(id, true);
        return;
      }
      enCurso.current.set(id, false);
      try {
        for (let vuelta = 0; vuelta < 3; vuelta++) {
          try {
            aplicarFila(await pedirResumen(id));
          } catch {
            quitarFila(id);
            // La abierta ya no existe (o no es de la empresa): se cierra el panel.
            if (selIdRef.current === id) {
              setSelId(null);
              setSel(null);
            }
          }
          if (!enCurso.current.get(id)) break;
          enCurso.current.set(id, false);
        }
      } finally {
        enCurso.current.delete(id);
      }
    },
    [aplicarFila, quitarFila],
  );

  // ── Realtime: chat:<empresa> ───────────────────────────────────────────────
  const onConversacion = useCallback(
    (p: Record<string, unknown>) => {
      const id = typeof p.id === "string" ? p.id : null;
      if (!id) return;
      refrescarContadores();
      const presente = filasRef.current.some((f) => f.id === id);
      const f = filtrosRef.current;
      const aprox = { estado: (p.estado as FilaBandeja["estado"]) ?? "abierta", asignado_id: (p.asignado_id as string | null) ?? null };
      // Descarte sin red: no entra a la vista (vista y asesor se saben por el aviso; canal y cola no).
      const entraAprox = filaEnVista({ ...aprox, canal_id: "" }, f.vista, yo ?? "", { canal: "", asesor: f.asesor });
      if (id === selIdRef.current) {
        void refrescarFila(id);
        return;
      }
      if (!entraAprox) {
        if (presente) quitarFila(id);
        return;
      }
      if (!presente && f.q.trim()) return;
      const cur = sigRef.current;
      const at = typeof p.ultimo_mensaje_at === "string" ? Date.parse(p.ultimo_mensaje_at) : NaN;
      if (!presente && cur && Number.isFinite(at) && at < Date.parse(cur.at)) return;
      void refrescarFila(id);
    },
    [refrescarContadores, refrescarFila, quitarFila, yo],
  );

  const topic = empresaId ? `chat:${empresaId}` : null;
  const suscripto = useBroadcast(topic, useMemo(() => ({ conversacion: onConversacion }), [onConversacion]));
  useRespaldo(!!yo, suscripto, () => void cargar(true));

  // ── Selección ──────────────────────────────────────────────────────────────
  const abrir = useCallback(
    (id: string | null) => {
      setSelId(id);
      if (!id) {
        setSel(null);
        return;
      }
      const f = filasRef.current.find((x) => x.id === id) ?? null;
      setSel(f ? { ...f, no_leidos: 0 } : null);
      if (f && f.no_leidos > 0) {
        setFilas((prev) => prev.map((x) => (x.id === id ? { ...x, no_leidos: 0 } : x)));
        void marcarLeida(id).catch(() => {});
        refrescarContadores(800);
      }
      if (!f) void refrescarFila(id);
    },
    [refrescarContadores, refrescarFila],
  );

  return {
    filas,
    contadores,
    cargando,
    cargandoMas,
    hayMas: !!siguiente,
    error,
    suscripto,
    sel,
    selId,
    abrir,
    cargarMas,
    recargar: () => void cargar(),
    aplicarFila,
    refrescarContadores,
  };
}
