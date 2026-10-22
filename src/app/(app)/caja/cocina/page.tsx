"use client";

/**
 * /caja/cocina — Cocina (receta 68). "Pantalla de cocina". Pensada para una pantalla grande en la
 * cocina: los pedidos ACEPTADOS por la caja, por mesa, en tres columnas (Para preparar · En
 * preparación · Listos para llevar), el más viejo primero, con letra grande. Botones "En
 * preparación" y "Listo" (y "Entregado" cuando sale). La caja ve el estado en su cola.
 * Se actualiza sola cada 4 s; suena cuando llega un pedido aceptado. "Pantalla completa" para el
 * televisor de la cocina. En celular / tablet las columnas se apilan.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChefHat, Expand, Flame, Loader2, Minimize, Volume2, VolumeX } from "lucide-react";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { apiFetch } from "@/lib/api/client-fetch";
import { clienteConfig } from "@/cliente.config";
import { BOTON_SECUNDARIO } from "@/modules/inventario/ui";
import { useTablero } from "@/modules/mesas/useTablero";
import { cant, haceCuanto, horaCorta, pitido, type PedidoMesa } from "@/modules/mesas/tipos";

const COLOR = clienteConfig.color;
const CLAVE_SONIDO = "neura.cocina.sonido";

export default function CocinaPage() {
  const [sonido, setSonido] = useState(true);
  useEffect(() => { try { setSonido(localStorage.getItem(CLAVE_SONIDO) !== "0"); } catch { /* sin storage */ } }, []);
  const sonidoRef = useRef(sonido);
  sonidoRef.current = sonido;
  const { datos, error, recargar, ahora } = useTablero(4000, () => { if (sonidoRef.current) pitido(); }, "aceptado");
  const [, tic] = useState(0);
  useEffect(() => { const id = setInterval(() => tic((x) => x + 1), 30_000); return () => clearInterval(id); }, []);

  const pedidos = datos?.pedidos ?? [];
  const porEstado = useMemo(() => ({
    aceptado: pedidos.filter((p) => p.estado === "aceptado"),
    en_preparacion: pedidos.filter((p) => p.estado === "en_preparacion"),
    listo: pedidos.filter((p) => p.estado === "listo"),
  }), [pedidos]);
  const variasSucursales = new Set(pedidos.map((p) => p.sucursal.id)).size > 1;

  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const accion = useCallback(async (p: PedidoMesa, a: "preparar" | "listo" | "entregar") => {
    setOcupado(p.id);
    setAviso(null);
    try {
      await apiFetch(`/api/mesas/pedidos/${p.id}`, { method: "POST", body: JSON.stringify({ accion: a }) });
      await recargar();
    } catch (e) {
      setAviso((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }, [recargar]);

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
    try { localStorage.setItem(CLAVE_SONIDO, v ? "1" : "0"); } catch { /* sin storage */ }
    if (v) pitido();
  };

  const columnas: { id: keyof typeof porEstado; titulo: string; icono: React.ReactNode; tono: string }[] = [
    { id: "aceptado", titulo: "Para preparar", icono: <ChefHat className="h-5 w-5" aria-hidden />, tono: "text-sky-700" },
    { id: "en_preparacion", titulo: "En preparación", icono: <Flame className="h-5 w-5" aria-hidden />, tono: "text-violet-700" },
    { id: "listo", titulo: "Listos para llevar", icono: <CheckCircle2 className="h-5 w-5" aria-hidden />, tono: "text-emerald-700" },
  ];

  return (
    <div ref={raiz} className={`space-y-5 pb-10 ${completa ? "overflow-y-auto bg-slate-50 p-6" : ""}`}>
      <EncabezadoPagina
        volver={completa ? undefined : { href: "/caja/panel", label: "Caja" }}
        kicker={completa ? undefined : "Caja"}
        titulo="Cocina"
        subtitulo={completa ? undefined : "Los pedidos que aceptó la caja, por mesa. Marcalos en preparación y listos: la caja lo ve al instante."}
        acciones={
          <div className="flex items-center gap-2">
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
                  {lista.map((p) => {
                    const min = (ahora() - Date.parse(p.aceptado_at ?? p.creado_at)) / 60000;
                    return (
                      <li key={p.id} className={`overflow-hidden rounded-2xl border-2 bg-white shadow-sm ${col.id !== "listo" && min > 15 ? "border-rose-300" : "border-slate-200"}`}>
                        <div className="flex items-start justify-between gap-3 px-4 pt-3">
                          <div className="min-w-0">
                            <p className="truncate text-2xl font-extrabold tracking-tight text-slate-900">{p.mesa.nombre}</p>
                            <p className="truncate text-sm text-slate-500">{[p.mesa.zona, variasSucursales ? p.sucursal.nombre : null].filter(Boolean).join(" · ")}{p.nombre_cliente ? `${p.mesa.zona || variasSucursales ? " · " : ""}${p.nombre_cliente}` : ""}</p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="font-mono text-sm font-semibold text-slate-400">#{p.numero}</p>
                            <p className={`text-sm font-semibold ${col.id !== "listo" && min > 15 ? "text-rose-600" : "text-slate-600"}`}>{haceCuanto(p.aceptado_at ?? p.creado_at, ahora())}</p>
                          </div>
                        </div>
                        <ul className="px-4 py-2">
                          {p.items.map((it, i) => (
                            <li key={i} className="flex gap-3 py-1 text-lg leading-snug">
                              <span className="w-10 shrink-0 font-extrabold tabular-nums text-slate-900">{cant(it.cantidad)}×</span>
                              <span className="min-w-0 flex-1 font-medium text-slate-800">
                                {it.nombre}
                                {it.nota ? <span className="block text-base font-semibold text-amber-700">→ {it.nota}</span> : null}
                              </span>
                            </li>
                          ))}
                        </ul>
                        {p.nota ? <p className="mx-4 mb-3 rounded-lg bg-amber-50 px-3 py-2 text-base text-amber-900">Nota: {p.nota}</p> : null}
                        <div className="flex items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-2.5">
                          <span className="flex-1 text-xs text-slate-400">Aceptado {horaCorta(p.aceptado_at ?? p.creado_at)}</span>
                          {col.id === "aceptado" ? (
                            <>
                              <Boton ocupado={ocupado === p.id} onClick={() => void accion(p, "preparar")} secundario>En preparación</Boton>
                              <Boton ocupado={ocupado === p.id} onClick={() => void accion(p, "listo")}>Listo</Boton>
                            </>
                          ) : col.id === "en_preparacion" ? (
                            <Boton ocupado={ocupado === p.id} onClick={() => void accion(p, "listo")}>Listo</Boton>
                          ) : (
                            <Boton ocupado={ocupado === p.id} onClick={() => void accion(p, "entregar")} secundario>Entregado</Boton>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      {datos && !pedidos.some((p) => ["aceptado", "en_preparacion", "listo"].includes(p.estado)) ? (
        <p className="text-center text-sm text-slate-400">Cuando la caja acepte un pedido aparece acá (y suena).</p>
      ) : null}
    </div>
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
