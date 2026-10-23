"use client";

/**
 * /caja/cocina — Cocina por estación (recetas 68 y 70). "Pantalla de cocina". Pensada para una
 * pantalla grande en cada estación (Plancha, Pizzería, Barra…): las COMANDAS (la parte de cada pedido
 * aceptado que le toca a la estación), en tres columnas (Para preparar · En preparación · Listos), la
 * más vieja primero, con letra grande. Cada estación marca SOLO su parte; el estado del pedido se
 * deriva de todas sus partes (la caja ve el avance por estación).
 *
 * Estación: chips "Todas · Plancha · Pizzería · Barra · General" (se recuerda en este equipo);
 * "General" (comandas sin estación) solo se muestra cuando hay alguna.
 *   · /caja/cocina?estacion=<id>  (o ?estacion=general) fija la estación de esta pantalla.
 *   · Usuario con estación fija (Configuración › Mesas y QR › Estaciones): entra directo a la suya
 *     y no la puede cambiar.
 * Cada comanda muestra mesa, número de pedido, hace cuánto, sus ítems con nota y "También lleva:
 * Pizzería" si el pedido tiene otras partes.
 *
 * Impresión: botón "Imprimir" (ticket de comanda de Configuración › Tickets, receta 71) en cada comanda e interruptor "Imprimir al llegar"
 * (en este equipo): cada comanda nueva se imprime UNA vez (se marca impresa en la base y en este
 * equipo). Para que no aparezca el diálogo de impresión, abrir el navegador en modo kiosco con
 * --kiosk-printing (ver src/modules/mesas/imprimirComanda.ts).
 *
 * Se actualiza sola cada 4 s; suena cuando llega una comanda para esta estación. "Pantalla completa"
 * para el televisor. En celular / tablet las columnas se apilan.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChefHat, Expand, Flame, Loader2, Lock, Minimize, Printer, Volume2, VolumeX } from "lucide-react";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { apiFetch } from "@/lib/api/client-fetch";
import { invalidar } from "@/lib/api/cache-cliente";
import { clienteConfig } from "@/cliente.config";
import { BOTON_SECUNDARIO } from "@/modules/inventario/ui";
import { useTablero } from "@/modules/mesas/useTablero";
import { imprimirComanda } from "@/modules/mesas/imprimirComanda";
import {
  cant, ESTADOS_COMANDA, haceCuanto, horaCorta, itemsDeComanda, nombreEstacion, pitido, URL_TABLERO,
  type Comanda, type Estacion, type PedidoMesa,
} from "@/modules/mesas/tipos";

const COLOR = clienteConfig.color;
const CLAVE_SONIDO = "neura.cocina.sonido";
const CLAVE_ESTACION = "neura.cocina.estacion";
const CLAVE_AUTO = "neura.cocina.imprimir_auto";
const CLAVE_IMPRESAS = "neura.cocina.impresas";
/** Solo se imprimen solas las comandas de los últimos 30 min (al prender el interruptor no sale todo el día). */
const VENTANA_AUTO_MS = 30 * 60_000;

type Filtro = "todas" | "general" | string;
type Item = { p: PedidoMesa; k: Comanda };

const leer = (clave: string) => { try { return localStorage.getItem(clave); } catch { return null; } };
const guardar = (clave: string, v: string) => { try { localStorage.setItem(clave, v); } catch { /* sin storage */ } };
const impresasLocal = (): string[] => { try { return JSON.parse(leer(CLAVE_IMPRESAS) ?? "[]") as string[]; } catch { return []; } };

export default function CocinaPage() {
  const [sonido, setSonido] = useState(true);
  const [auto, setAuto] = useState(false);
  const [filtroElegido, setFiltroElegido] = useState<Filtro>("todas");
  const [filtroUrl, setFiltroUrl] = useState<Filtro | null>(null);
  useEffect(() => {
    setSonido(leer(CLAVE_SONIDO) !== "0");
    setAuto(leer(CLAVE_AUTO) === "1");
    const guardada = leer(CLAVE_ESTACION);
    if (guardada) setFiltroElegido(guardada);
    // ?estacion=<id>|general fija la estación de esta pantalla (sin useSearchParams: no hace falta Suspense).
    const q = new URLSearchParams(window.location.search).get("estacion");
    if (q) setFiltroUrl(q);
  }, []);

  const { datos, error, recargar, ahora } = useTablero(4000);
  const [, tic] = useState(0);
  useEffect(() => { const id = setInterval(() => tic((x) => x + 1), 30_000); return () => clearInterval(id); }, []);

  const estaciones = useMemo(() => datos?.estaciones ?? [], [datos]);
  const activas = estaciones.filter((e) => e.activa);
  const porId = useMemo(() => new Map(estaciones.map((e) => [e.id, e])), [estaciones]);
  // Prioridad: estación fija del usuario → la de la URL → la elegida en este equipo.
  const fijaUsuario = datos?.mi_estacion_id ?? null;
  const bloqueada = !!fijaUsuario || !!filtroUrl;
  const filtroCrudo: Filtro = fijaUsuario ?? filtroUrl ?? filtroElegido;
  // Una estación guardada que ya no existe vuelve a "Todas".
  const filtro: Filtro = filtroCrudo === "todas" || filtroCrudo === "general" || !datos || porId.has(filtroCrudo) ? filtroCrudo : "todas";
  const elegir = (f: Filtro) => { setFiltroElegido(f); guardar(CLAVE_ESTACION, f); };

  const pedidos = useMemo(() => datos?.pedidos ?? [], [datos]);
  const enCocina = useMemo<Item[]>(() => pedidos
    .filter((p) => ["aceptado", "en_preparacion", "listo"].includes(p.estado))
    .flatMap((p) => (p.comandas ?? []).map((k) => ({ p, k })))
    .filter(({ k }) => k.estado !== "entregado"), [pedidos]);
  const coincide = useCallback((k: Comanda) => filtro === "todas" || (filtro === "general" ? k.estacion_id === null : k.estacion_id === filtro), [filtro]);
  const visibles = useMemo(() => enCocina.filter(({ k }) => coincide(k))
    .sort((a, b) => Date.parse(a.k.creado_at) - Date.parse(b.k.creado_at) || a.p.numero - b.p.numero), [enCocina, coincide]);
  const porEstado = useMemo(() => ({
    aceptado: visibles.filter(({ k }) => k.estado === "aceptado"),
    en_preparacion: visibles.filter(({ k }) => k.estado === "en_preparacion"),
    listo: visibles.filter(({ k }) => k.estado === "listo"),
  }), [visibles]);
  const pendientesDe = (f: Filtro) => enCocina.filter(({ k }) => k.estado !== "listo" && (f === "todas" || (f === "general" ? k.estacion_id === null : k.estacion_id === f))).length;
  const hayGeneral = enCocina.some(({ k }) => k.estacion_id === null);
  const variasSucursales = new Set(pedidos.map((p) => p.sucursal.id)).size > 1;

  // ── Aviso sonoro e impresión automática de las comandas que llegan a ESTA estación ──────────
  const sonidoRef = useRef(sonido);
  sonidoRef.current = sonido;
  const vistas = useRef<{ filtro: Filtro; ids: Set<string> } | null>(null);
  const encoladas = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!datos) return;
    const nuevas = visibles.filter(({ k }) => k.estado === "aceptado");
    if (!vistas.current || vistas.current.filtro !== filtro) {
      vistas.current = { filtro, ids: new Set(nuevas.map(({ k }) => k.id)) };
    } else {
      const llegaron = nuevas.filter(({ k }) => !vistas.current!.ids.has(k.id));
      for (const { k } of nuevas) vistas.current.ids.add(k.id);
      if (llegaron.length && sonidoRef.current) pitido();
    }
    if (!auto) return;
    const yaLocal = new Set(impresasLocal());
    const limite = Date.now() - VENTANA_AUTO_MS;
    for (const it of visibles) {
      const { k } = it;
      if (k.impresa_at || yaLocal.has(k.id) || encoladas.current.has(k.id) || Date.parse(k.creado_at) < limite) continue;
      encoladas.current.add(k.id);
      void imprimirComanda(it.p, k).then(() => marcarImpresa(k.id));
    }
  }, [datos, visibles, filtro, auto]);

  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const accion = useCallback(async (k: Comanda, a: "preparar" | "listo" | "entregar") => {
    setOcupado(k.id);
    setAviso(null);
    try {
      await apiFetch(`/api/mesas/comandas/${k.id}`, { method: "POST", body: JSON.stringify({ accion: a }) });
      invalidar(URL_TABLERO);
      await recargar();
    } catch (e) {
      setAviso((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }, [recargar]);
  const imprimir = (it: Item) => { void imprimirComanda(it.p, it.k).then(() => marcarImpresa(it.k.id)); };

  // Pantalla completa (televisor de la cocina).
  const raiz = useRef<HTMLDivElement>(null);
  const [completa, setCompleta] = useState(false);
  useEffect(() => {
    const f = () => setCompleta(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", f);
    return () => document.removeEventListener("fullscreenchange", f);
  }, []);
  const alternarCompleta = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void raiz.current?.requestFullscreen?.().catch(() => {});
  };
  const cambiarSonido = () => {
    const v = !sonido;
    setSonido(v);
    guardar(CLAVE_SONIDO, v ? "1" : "0");
    if (v) pitido();
  };
  const cambiarAuto = () => {
    const v = !auto;
    setAuto(v);
    guardar(CLAVE_AUTO, v ? "1" : "0");
  };

  const columnas: { id: keyof typeof porEstado; titulo: string; icono: React.ReactNode; tono: string }[] = [
    { id: "aceptado", titulo: "Para preparar", icono: <ChefHat className="h-5 w-5" aria-hidden />, tono: "text-sky-700" },
    { id: "en_preparacion", titulo: "En preparación", icono: <Flame className="h-5 w-5" aria-hidden />, tono: "text-violet-700" },
    { id: "listo", titulo: "Listos para llevar", icono: <CheckCircle2 className="h-5 w-5" aria-hidden />, tono: "text-emerald-700" },
  ];
  const nombreFiltro = filtro === "todas" ? "Todas las estaciones" : filtro === "general" ? "Cocina general" : nombreEstacion(porId.get(filtro) ?? { icono: null, nombre: "Estación" });

  return (
    <div ref={raiz} className={`space-y-5 pb-10 ${completa ? "overflow-y-auto bg-slate-50 p-6" : ""}`}>
      <EncabezadoPagina
        volver={completa ? undefined : { href: "/caja/panel", label: "Caja" }}
        kicker={completa ? undefined : "Caja"}
        titulo={filtro === "todas" ? "Cocina" : nombreFiltro}
        subtitulo={completa ? undefined : "Las comandas que aceptó la caja, por estación. Marcalas en preparación y listas: la caja ve el avance de cada parte."}
        acciones={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={cambiarAuto} role="switch" aria-checked={auto} className={`${BOTON_SECUNDARIO} min-h-11 lg:min-h-0`} title="Imprime cada comanda nueva una sola vez (en este equipo)">
              <Printer className="h-4 w-4" aria-hidden />
              <span className="max-sm:hidden">Imprimir al llegar</span>
              <span className="relative h-4 w-7 shrink-0 rounded-full transition-colors" style={{ backgroundColor: auto ? COLOR : "#cbd5e1" }}>
                <span className="absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all" style={{ left: auto ? 14 : 2 }} />
              </span>
            </button>
            <button type="button" onClick={cambiarSonido} className={`${BOTON_SECUNDARIO} min-h-11 lg:min-h-0`} aria-pressed={sonido} title={sonido ? "Silenciar el aviso" : "Activar el aviso sonoro"}>
              {sonido ? <Volume2 className="h-4 w-4" aria-hidden /> : <VolumeX className="h-4 w-4" aria-hidden />}
              <span className="max-sm:hidden">{sonido ? "Sonido" : "Silencio"}</span>
            </button>
            <button type="button" onClick={alternarCompleta} className={`${BOTON_SECUNDARIO} min-h-11 max-lg:hidden lg:min-h-0`}>
              {completa ? <Minimize className="h-4 w-4" aria-hidden /> : <Expand className="h-4 w-4" aria-hidden />}
              {completa ? "Salir" : "Pantalla completa"}
            </button>
          </div>
        }
      />

      {/* Estación de esta pantalla */}
      {datos && (activas.length > 0 || hayGeneral) ? (
        bloqueada ? (
          <p className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200">
            <Lock className="h-3.5 w-3.5 text-slate-400" aria-hidden />
            {nombreFiltro}
            <span className="font-normal text-slate-400">{fijaUsuario ? "· tu estación" : "· fijada en el enlace"}</span>
          </p>
        ) : (
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Estación">
            <Chip activo={filtro === "todas"} onClick={() => elegir("todas")} cuenta={pendientesDe("todas")}>Todas</Chip>
            {activas.map((e) => (
              <Chip key={e.id} activo={filtro === e.id} onClick={() => elegir(e.id)} color={e.color} cuenta={pendientesDe(e.id)}>{nombreEstacion(e)}</Chip>
            ))}
            {/* "General" (productos sin estación) solo aparece cuando hay alguna comanda así (o si es la elegida). */}
            {hayGeneral || filtro === "general" ? (
              <Chip activo={filtro === "general"} onClick={() => elegir("general")} cuenta={pendientesDe("general")}>General</Chip>
            ) : null}
          </div>
        )
      ) : null}

      {aviso ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{aviso}</p> : null}
      {error && !datos ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      <div className="grid gap-5 lg:grid-cols-3">
        {columnas.map((col) => {
          const lista = porEstado[col.id];
          return (
            <section key={col.id} className="min-w-0">
              <h2 className={`mb-3 flex items-center gap-2 text-lg font-bold ${col.tono}`}>
                {col.icono} {col.titulo}
                <span className="rounded-full bg-white px-2.5 py-0.5 text-sm font-bold text-slate-700 shadow-sm ring-1 ring-slate-200">{lista.length}</span>
              </h2>
              {!datos ? (
                <div className="h-40 animate-pulse rounded-2xl bg-slate-200/70" aria-busy="true" />
              ) : lista.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400">Nada por ahora.</p>
              ) : (
                <ul className="space-y-3">
                  {lista.map((it) => (
                    <TarjetaComanda key={it.k.id} it={it} col={col.id} ahora={ahora()} conEstacion={filtro === "todas"} porId={porId}
                      variasSucursales={variasSucursales} ocupado={ocupado === it.k.id}
                      onAccion={(a) => void accion(it.k, a)} onImprimir={() => imprimir(it)} />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      {datos && visibles.length === 0 ? (
        <p className="text-center text-sm text-slate-400">Cuando la caja acepte un pedido{filtro === "todas" ? "" : " con algo para esta estación"} aparece acá (y suena).</p>
      ) : null}
    </div>
  );
}

function marcarImpresa(id: string) {
  const lista = impresasLocal().filter((x) => x !== id);
  lista.push(id);
  guardar(CLAVE_IMPRESAS, JSON.stringify(lista.slice(-300)));
  void apiFetch(`/api/mesas/comandas/${id}`, { method: "POST", body: JSON.stringify({ accion: "impresa" }) }).catch(() => {});
}

function TarjetaComanda({ it, col, ahora, conEstacion, porId, variasSucursales, ocupado, onAccion, onImprimir }: {
  it: Item; col: "aceptado" | "en_preparacion" | "listo"; ahora: number; conEstacion: boolean; porId: Map<string, Estacion>;
  variasSucursales: boolean; ocupado: boolean; onAccion: (a: "preparar" | "listo" | "entregar") => void; onImprimir: () => void;
}) {
  const { p, k } = it;
  const min = (ahora - Date.parse(k.creado_at)) / 60000;
  const tarde = col !== "listo" && min > 15;
  const items = itemsDeComanda(p, k);
  const otras = (p.comandas ?? []).filter((x) => x.id !== k.id);
  const color = k.estacion_id ? porId.get(k.estacion_id)?.color ?? k.color : null;
  const lugar = [p.mesa.zona, variasSucursales ? p.sucursal.nombre : null, p.nombre_cliente].filter(Boolean).join(" · ");
  return (
    <li className={`overflow-hidden rounded-2xl border-2 bg-white shadow-sm ${tarde ? "border-rose-300" : "border-slate-200"}`}>
      {conEstacion ? (
        <p className="flex items-center gap-2 px-4 pt-2 text-xs font-bold uppercase tracking-wide text-slate-500">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color ?? "#94a3b8" }} />
          {nombreEstacion(k)}
        </p>
      ) : null}
      <div className="flex items-start justify-between gap-3 px-4 pt-2">
        <div className="min-w-0">
          <p className="truncate text-2xl font-extrabold tracking-tight text-slate-900">{p.mesa.nombre}</p>
          {lugar ? <p className="truncate text-sm text-slate-500">{lugar}</p> : null}
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-sm font-semibold text-slate-400">#{p.numero}</p>
          <p className={`text-sm font-semibold ${tarde ? "text-rose-600" : "text-slate-600"}`}>{haceCuanto(k.creado_at, ahora)}</p>
        </div>
      </div>
      <ul className="px-4 py-2">
        {items.map((i, n) => (
          <li key={n} className="flex gap-3 py-1 text-lg leading-snug">
            <span className="w-10 shrink-0 font-extrabold tabular-nums text-slate-900">{cant(i.cantidad)}×</span>
            <span className="min-w-0 flex-1 font-medium text-slate-800">
              {i.nombre}
              {i.nota ? <span className="block text-base font-semibold text-amber-700">→ {i.nota}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      {p.nota ? <p className="mx-4 mb-2 rounded-lg bg-amber-50 px-3 py-2 text-base text-amber-900">Nota: {p.nota}</p> : null}
      {otras.length ? (
        <p className="mx-4 mb-2 text-xs text-slate-500">
          También lleva: {otras.map((x, n) => (
            <span key={x.id}>{n ? ", " : ""}<span className="font-semibold text-slate-600">{x.estacion_nombre}</span> <span className="text-slate-400">({ESTADOS_COMANDA[x.estado].texto})</span></span>
          ))}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-2.5">
        <span className="min-w-0 flex-1 text-xs text-slate-400">Aceptado {horaCorta(p.aceptado_at ?? p.creado_at)}{k.impresa_at ? " · impresa" : ""}</span>
        <button type="button" onClick={onImprimir} aria-label={`Imprimir la comanda de ${p.mesa.nombre}`} title="Imprimir comanda (80 mm)"
          className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 active:scale-[0.98]">
          <Printer className="h-4 w-4" aria-hidden />
        </button>
        {col === "aceptado" ? (
          <>
            <Boton ocupado={ocupado} onClick={() => onAccion("preparar")} secundario>En preparación</Boton>
            <Boton ocupado={ocupado} onClick={() => onAccion("listo")}>Listo</Boton>
          </>
        ) : col === "en_preparacion" ? (
          <Boton ocupado={ocupado} onClick={() => onAccion("listo")}>Listo</Boton>
        ) : (
          <Boton ocupado={ocupado} onClick={() => onAccion("entregar")} secundario>Entregado</Boton>
        )}
      </div>
    </li>
  );
}

function Chip({ activo, onClick, color, cuenta, children }: { activo: boolean; onClick: () => void; color?: string | null; cuenta: number; children: React.ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={activo} onClick={onClick}
      className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition active:scale-[0.98] lg:min-h-10 ${activo ? "border-transparent text-white shadow-sm" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
      style={activo ? { backgroundColor: color ?? COLOR } : undefined}>
      {!activo && color ? <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} /> : null}
      {children}
      {cuenta ? <span className={`rounded-full px-1.5 text-xs font-bold tabular-nums ${activo ? "bg-white/25" : "bg-slate-100 text-slate-600"}`}>{cuenta}</span> : null}
    </button>
  );
}

function Boton({ children, onClick, ocupado, secundario }: { children: React.ReactNode; onClick: () => void; ocupado: boolean; secundario?: boolean }) {
  return (
    <button type="button" disabled={ocupado} onClick={onClick}
      className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-bold shadow-sm transition active:scale-[0.98] disabled:opacity-50 ${secundario ? "border border-slate-200 bg-white text-slate-700" : "text-white"}`}
      style={secundario ? undefined : { backgroundColor: COLOR }}>
      {ocupado ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}
