"use client";

/**
 * Estado del hilo abierto.
 *   · Últimos 50; "ver anteriores" con cursor (el componente conserva la posición del scroll).
 *   · UN canal Realtime: chat:conv:<id>. "mensaje" → se piden SOLO los nuevos desde el último
 *     que se ve; "estado" → se actualiza la tilde en el lugar, sin red.
 *   · Envío optimista: burbuja "pendiente" al instante, se reemplaza con la del servidor.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { enviarAdjunto, enviarMensaje, pedirHilo, type CuerpoMensaje } from "@/modules/conversaciones/api";
import { PLANTILLAS, rellenarPlantilla, tipoDesdeMime, type EstadoEntrega, type Mensaje } from "@/modules/conversaciones/dominio";
import { useBroadcast, useRespaldo } from "@/modules/conversaciones/realtime";
import { sembrarUrl } from "@/modules/conversaciones/media";

const RANGO: Record<EstadoEntrega, number> = { pendiente: 0, enviado: 1, entregado: 2, leido: 3, recibido: 3, fallido: 9 };
/** Las tildes solo avanzan (un aviso viejo que llega tarde no las hace retroceder). */
const avanzar = (actual: EstadoEntrega, nuevo: EstadoEntrega) => (RANGO[nuevo] >= RANGO[actual] ? nuevo : actual);

const orden = (a: Mensaje, b: Mensaje) => {
  if (!!a.local !== !!b.local) return a.local ? 1 : -1;
  const d = Date.parse(a.created_at) - Date.parse(b.created_at);
  return d || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
};

/** Mezcla por id: solo se reemplaza el objeto que cambió (las burbujas memo no se re-dibujan). */
function fusionar(prev: Mensaje[], nuevos: Mensaje[]): Mensaje[] {
  if (!nuevos.length) return prev;
  const idx = new Map(prev.map((m, i) => [m.id, i]));
  let out = prev;
  let agregados = false;
  for (const n of nuevos) {
    const i = idx.get(n.id);
    if (i == null) {
      if (out === prev) out = [...prev];
      out.push(n);
      idx.set(n.id, out.length - 1);
      agregados = true;
      continue;
    }
    const v = out[i];
    const estado = avanzar(v.estado_entrega, n.estado_entrega);
    if (estado !== v.estado_entrega || n.error !== v.error || n.contenido !== v.contenido || n.media_path !== v.media_path) {
      if (out === prev) out = [...prev];
      out[i] = { ...n, estado_entrega: estado, autor_nombre: n.autor_nombre ?? v.autor_nombre };
    }
  }
  return agregados ? out.sort(orden) : out;
}

/**
 * El aviso Realtime de MI mensaje puede llegar antes que la respuesta del POST: la burbuja
 * optimista que coincide (mismo tipo y texto, todavía pendiente) se retira para no verla doble.
 */
function sinEspejos(prev: Mensaje[], nuevos: Mensaje[], yo: string | null): Mensaje[] {
  const mios = nuevos.filter((n) => n.from_me && n.autor_usuario_id === yo);
  if (!mios.length || !prev.some((m) => m.local)) return prev;
  const usados = new Set<string>();
  return prev.filter((m) => {
    if (!m.local || m.local.fallo || m.estado_entrega !== "pendiente") return true;
    const par = mios.find((n) => !usados.has(n.id) && n.tipo === m.tipo && (n.contenido ?? null) === (m.contenido ?? null));
    if (!par) return true;
    usados.add(par.id);
    return false;
  });
}

export function useHilo(convId: string | null, yo: { id: string; nombre: string } | null) {
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [hayMas, setHayMas] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [cargandoAnteriores, setCargandoAnteriores] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const msgRef = useRef(mensajes);
  msgRef.current = mensajes;
  const convRef = useRef(convId);
  convRef.current = convId;
  const yoRef = useRef<string | null>(yo?.id ?? null);
  yoRef.current = yo?.id ?? null;
  const estadosPendientes = useRef(new Map<string, EstadoEntrega>());
  const reintentos = useRef(new Map<string, () => void>());

  const aplicar = setMensajes;

  // ── Carga inicial ──────────────────────────────────────────────────────────
  useEffect(() => {
    setMensajes([]);
    setHayMas(false);
    setError(null);
    estadosPendientes.current.clear();
    if (!convId) return;
    const ac = new AbortController();
    setCargando(true);
    pedirHilo(convId, {}, ac.signal)
      .then((p) => {
        if (ac.signal.aborted) return;
        setMensajes(p.mensajes);
        setHayMas(p.hay_mas);
      })
      .catch((e) => !ac.signal.aborted && setError((e as Error).message))
      .finally(() => !ac.signal.aborted && setCargando(false));
    return () => ac.abort();
  }, [convId]);

  // ── Anteriores ─────────────────────────────────────────────────────────────
  const cargandoAntRef = useRef(false);
  const cargarAnteriores = useCallback(async () => {
    const id = convRef.current;
    const primero = msgRef.current.find((m) => !m.local);
    if (!id || !primero || cargandoAntRef.current) return;
    cargandoAntRef.current = true;
    setCargandoAnteriores(true);
    try {
      const p = await pedirHilo(id, { antes: { at: primero.created_at, id: primero.id } });
      if (convRef.current !== id) return;
      setMensajes((prev) => fusionar(prev, p.mensajes));
      setHayMas(p.hay_mas);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      cargandoAntRef.current = false;
      setCargandoAnteriores(false);
    }
  }, []);

  // ── Nuevos desde el último (coalescido) ────────────────────────────────────
  const alDia = useRef<{ corriendo: boolean; otra: boolean }>({ corriendo: false, otra: false });
  const ponerseAlDia = useCallback(async () => {
    const id = convRef.current;
    if (!id) return;
    if (alDia.current.corriendo) {
      alDia.current.otra = true;
      return;
    }
    alDia.current.corriendo = true;
    try {
      do {
        alDia.current.otra = false;
        const servidor = msgRef.current.filter((m) => !m.local);
        const ult = servidor[servidor.length - 1];
        const p = await pedirHilo(id, ult ? { desde: ult.created_at } : {});
        if (convRef.current !== id) return;
        const conEstados = p.mensajes.map((m) => {
          const e = estadosPendientes.current.get(m.id);
          return e ? { ...m, estado_entrega: avanzar(m.estado_entrega, e) } : m;
        });
        aplicar((prev) => fusionar(sinEspejos(prev, conEstados, yoRef.current), conEstados));
      } while (alDia.current.otra);
    } catch {
      /* el respaldo vuelve a intentar */
    } finally {
      alDia.current.corriendo = false;
    }
  }, [aplicar]);

  // Respaldo sin Realtime: re-lee los últimos 50 (trae mensajes nuevos Y tildes).
  const refrescarCola = useCallback(async () => {
    const id = convRef.current;
    if (!id) return;
    try {
      const p = await pedirHilo(id);
      if (convRef.current === id) aplicar((prev) => fusionar(prev, p.mensajes));
    } catch {
      /* siguiente vuelta */
    }
  }, [aplicar]);

  // ── Realtime: chat:conv:<id> ───────────────────────────────────────────────
  const manejadores = useMemo(
    () => ({
      mensaje: (p: Record<string, unknown>) => {
        const id = typeof p.id === "string" ? p.id : null;
        if (id && msgRef.current.some((m) => m.id === id)) return;
        void ponerseAlDia();
      },
      estado: (p: Record<string, unknown>) => {
        const id = typeof p.id === "string" ? p.id : null;
        const estado = p.estado as EstadoEntrega | undefined;
        if (!id || !estado) return;
        if (!msgRef.current.some((m) => m.id === id)) {
          estadosPendientes.current.set(id, estado);
          return;
        }
        setMensajes((prev) =>
          prev.map((m) => (m.id === id && avanzar(m.estado_entrega, estado) !== m.estado_entrega ? { ...m, estado_entrega: avanzar(m.estado_entrega, estado) } : m)),
        );
      },
    }),
    [ponerseAlDia],
  );
  const suscripto = useBroadcast(convId ? `chat:conv:${convId}` : null, manejadores);
  useRespaldo(!!convId, suscripto, () => void refrescarCola());

  // ── Envío optimista ────────────────────────────────────────────────────────
  const reemplazar = useCallback(
    (tmpId: string, m: Mensaje) => {
      const e = estadosPendientes.current.get(m.id);
      const final = e ? { ...m, estado_entrega: avanzar(m.estado_entrega, e) } : m;
      aplicar((prev) => fusionar(prev.filter((x) => x.id !== tmpId), [{ ...final, autor_nombre: final.autor_nombre ?? yo?.nombre ?? null }]));
      reintentos.current.delete(tmpId);
    },
    [aplicar, yo],
  );

  const fallar = useCallback((tmpId: string, msg: string) => {
    setMensajes((prev) => prev.map((m) => (m.id === tmpId ? { ...m, estado_entrega: "fallido", local: { ...m.local, fallo: msg } } : m)));
  }, []);

  const burbujaLocal = useCallback(
    (parcial: Partial<Mensaje>): Mensaje => ({
      id: `tmp-${crypto.randomUUID()}`,
      from_me: true,
      tipo: "texto",
      contenido: null,
      media_path: null,
      media_mime: null,
      media_nombre: null,
      media_size: null,
      responde_a: null,
      estado_entrega: "pendiente",
      error: null,
      autor_usuario_id: yo?.id ?? null,
      autor_nombre: yo?.nombre ?? null,
      created_at: new Date().toISOString(),
      local: {},
      ...parcial,
    }),
    [yo],
  );

  const enviar = useCallback(
    (cuerpo: CuerpoMensaje) => {
      const id = convRef.current;
      if (!id) return;
      const tmp = burbujaLocal({
        tipo: cuerpo.tipo,
        contenido:
          cuerpo.tipo === "plantilla"
            ? rellenarPlantilla(PLANTILLAS.find((p) => p.id === cuerpo.plantilla_id)?.texto ?? "", cuerpo.variables)
            : cuerpo.contenido,
        responde_a: cuerpo.tipo === "texto" ? cuerpo.responde_a ?? null : null,
        estado_entrega: cuerpo.tipo === "nota" ? "enviado" : "pendiente",
      });
      const correr = () => {
        setMensajes((prev) => prev.map((m) => (m.id === tmp.id ? { ...m, estado_entrega: "pendiente", local: {} } : m)));
        enviarMensaje(id, cuerpo)
          .then((m) => reemplazar(tmp.id, m))
          .catch((e) => fallar(tmp.id, (e as Error).message));
      };
      reintentos.current.set(tmp.id, correr);
      aplicar((prev) => [...prev, tmp]);
      enviarMensaje(id, cuerpo)
        .then((m) => reemplazar(tmp.id, m))
        .catch((e) => fallar(tmp.id, (e as Error).message));
    },
    [aplicar, burbujaLocal, reemplazar, fallar],
  );

  const enviarArchivo = useCallback(
    (archivo: File | Blob, o: { nombre: string; caption?: string; responde_a?: string | null; notaVoz?: boolean }) => {
      const id = convRef.current;
      if (!id) return;
      const mime = archivo.type || "application/octet-stream";
      const url = URL.createObjectURL(archivo);
      const tmp = burbujaLocal({
        tipo: o.notaVoz ? "audio" : tipoDesdeMime(mime),
        contenido: o.caption || null,
        media_mime: mime,
        media_nombre: o.nombre,
        media_size: archivo.size,
        media_path: "local",
        responde_a: o.responde_a ?? null,
        local: { url },
      });
      const correr = () => {
        setMensajes((prev) => prev.map((m) => (m.id === tmp.id ? { ...m, estado_entrega: "pendiente", local: { url } } : m)));
        subir();
      };
      const subir = () =>
        enviarAdjunto(id, archivo, o)
          .then((m) => {
            sembrarUrl(m.id, url);
            reemplazar(tmp.id, m);
          })
          .catch((e) => fallar(tmp.id, (e as Error).message));
      reintentos.current.set(tmp.id, correr);
      aplicar((prev) => [...prev, tmp]);
      subir();
    },
    [aplicar, burbujaLocal, reemplazar, fallar],
  );

  const reintentar = useCallback((tmpId: string) => reintentos.current.get(tmpId)?.(), []);
  const descartar = useCallback((tmpId: string) => {
    reintentos.current.delete(tmpId);
    setMensajes((prev) => prev.filter((m) => m.id !== tmpId));
  }, []);

  /** Cambia cuando se agrega un mensaje AL FINAL (para el auto-scroll). */
  const ultimoId = mensajes[mensajes.length - 1]?.id ?? null;

  return {
    mensajes,
    hayMas,
    cargando,
    cargandoAnteriores,
    error,
    ultimoId,
    suscripto,
    cargarAnteriores,
    enviar,
    enviarArchivo,
    reintentar,
    descartar,
  };
}
