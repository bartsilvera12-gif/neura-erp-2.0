"use client";

/**
 * /caja/mesas — Caja › Pedidos de mesas (receta 68). "Atender pedidos de mesas".
 *   · Cola en tiempo casi real (cada 4 s), el más viejo primero: de dónde viene (mesa · zona ·
 *     sucursal), hace cuánto, ítems, notas y nombre. Aceptar / Rechazar (con motivo, lo ve el
 *     cliente). Aviso sonoro y contador en la pestaña cuando llega uno nuevo.
 *   · En curso: los aceptados con su estado de cocina; se pueden marcar entregados.
 *   · Cuentas abiertas por mesa con el total acumulado: "Enviar a caja" (receta 69: la cobra la
 *     caja desde Nueva venta › Mesas por cobrar; "Volver a abrir" si se envió por error) o
 *     Liberar (si todo se rechazó). El cobro ya no se hace acá: un solo camino, por la caja.
 * Escritorio: cola y cuentas lado a lado. Celular/tablet: pestañas.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BellRing, Check, CheckCircle2, ChefHat, Loader2, Receipt, RotateCcw, Send, Volume2, VolumeX, X } from "lucide-react";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { apiFetch } from "@/lib/api/client-fetch";
import { invalidar } from "@/lib/api/cache-cliente";
import { tienePermiso, useUsuario } from "@/lib/sesion/ContextoUsuario";
import { useEsEscritorio } from "@/lib/ui/responsive";
import { clienteConfig } from "@/cliente.config";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, PedirMotivo, Pestanas } from "@/modules/inventario/ui";
import { useTablero } from "@/modules/mesas/useTablero";
import {
  cant, ESTADOS_PEDIDO, gs, haceCuanto, horaCorta, origenPedido, pitido, URL_TABLERO, type CuentaMesa, type PedidoMesa,
} from "@/modules/mesas/tipos";

const COLOR = clienteConfig.color;
const CLAVE_SONIDO = "neura.mesas.sonido";

export default function PedidosMesasPage() {
  const me = useUsuario();
  const puedeAtender = tienePermiso(me, "pedidos_mesas");
  const [sonido, setSonido] = useState(true);
  useEffect(() => { try { setSonido(localStorage.getItem(CLAVE_SONIDO) !== "0"); } catch { /* sin storage */ } }, []);
  const sonidoRef = useRef(sonido);
  sonidoRef.current = sonido;
  const [llegaron, setLlegaron] = useState(0);
  const { datos, error, recargar, ahora } = useTablero(4000, (n) => {
    setLlegaron((x) => x + n.length);
    if (sonidoRef.current) pitido();
  });
  const [, tic] = useState(0);
  useEffect(() => { const id = setInterval(() => tic((x) => x + 1), 30_000); return () => clearInterval(id); }, []);

  const nuevos = useMemo(() => (datos?.pedidos ?? []).filter((p) => p.estado === "nuevo"), [datos]);
  const enCurso = useMemo(() => (datos?.pedidos ?? []).filter((p) => ["aceptado", "en_preparacion", "listo"].includes(p.estado)), [datos]);
  const cerrados = useMemo(() => (datos?.pedidos ?? []).filter((p) => p.estado === "entregado" || p.estado === "rechazado").slice(-8).reverse(), [datos]);
  const cuentas = datos?.cuentas ?? [];
  const variasSucursales = new Set([...(datos?.pedidos ?? []).map((p) => p.sucursal.id), ...cuentas.map((c) => c.sucursal.id)]).size > 1;

  // Contador en el título de la pestaña: pedidos sin atender.
  useEffect(() => {
    const base = "Pedidos de mesas";
    document.title = nuevos.length ? `(${nuevos.length}) ${base}` : base;
    return () => { document.title = clienteConfig.nombre; };
  }, [nuevos.length]);
  useEffect(() => { if (!nuevos.length) setLlegaron(0); }, [nuevos.length]);

  const escritorio = useEsEscritorio();
  const [tab, setTab] = useState<"cola" | "cuentas">("cola");
  const [rechazar, setRechazar] = useState<PedidoMesa | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  const accion = useCallback(async (p: PedidoMesa, a: "aceptar" | "rechazar" | "entregar", motivo?: string) => {
    setOcupado(p.id);
    setAviso(null);
    try {
      await apiFetch(`/api/mesas/pedidos/${p.id}`, { method: "POST", body: JSON.stringify({ accion: a, motivo: motivo ?? null }) });
      invalidar(URL_TABLERO);
      await recargar();
    } catch (e) {
      setAviso({ tipo: "error", texto: (e as Error).message });
      if (a === "rechazar") throw e;
    } finally {
      setOcupado(null);
    }
  }, [recargar]);

  async function accionCuenta(c: CuentaMesa, a: "liberar" | "enviar_caja" | "reabrir") {
    setOcupado(c.id);
    setAviso(null);
    try {
      await apiFetch(`/api/mesas/cuentas/${c.id}`, { method: "POST", body: JSON.stringify({ accion: a }) });
      invalidar(URL_TABLERO);
      await recargar();
      setAviso({
        tipo: "ok",
        texto: a === "liberar" ? `${c.mesa.nombre} quedó libre.`
          : a === "enviar_caja" ? `Cuenta de ${c.mesa.nombre} enviada a caja (${gs(c.total)}): la cobran desde Nueva venta.`
            : `La cuenta de ${c.mesa.nombre} volvió a quedar abierta.`,
      });
    } catch (e) {
      setAviso({ tipo: "error", texto: (e as Error).message });
    } finally {
      setOcupado(null);
    }
  }

  const cambiarSonido = () => {
    const v = !sonido;
    setSonido(v);
    try { localStorage.setItem(CLAVE_SONIDO, v ? "1" : "0"); } catch { /* sin storage */ }
    if (v) pitido();
  };

  const cola = (
    <section className="space-y-4">
      <div>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
          <BellRing className="h-4 w-4 text-amber-600" aria-hidden /> Nuevos
          {nuevos.length ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">{nuevos.length}</span> : null}
        </h2>
        {!datos ? (
          <Esqueleto />
        ) : nuevos.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">No hay pedidos esperando. Los nuevos aparecen acá solos.</p>
        ) : (
          <ul className="space-y-3">
            {nuevos.map((p) => (
              <TarjetaPedido key={p.id} p={p} ahora={ahora()} conSucursal={variasSucursales} resaltar>
                {puedeAtender ? (
                  <div className="flex gap-2">
                    <button type="button" disabled={ocupado === p.id} onClick={() => setRechazar(p)} className={`${BOTON_SECUNDARIO} min-h-11 flex-1 lg:min-h-0`}>
                      <X className="h-4 w-4" aria-hidden /> Rechazar
                    </button>
                    <button type="button" disabled={ocupado === p.id} onClick={() => void accion(p, "aceptar")} className={`${BOTON_PRIMARIO} min-h-11 flex-[2] lg:min-h-0`} style={{ backgroundColor: COLOR }}>
                      {ocupado === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" aria-hidden />} Aceptar
                    </button>
                  </div>
                ) : null}
              </TarjetaPedido>
            ))}
          </ul>
        )}
      </div>

      {enCurso.length ? (
        <div>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800"><ChefHat className="h-4 w-4 text-violet-600" aria-hidden /> En curso</h2>
          <ul className="space-y-2">
            {enCurso.map((p) => (
              <TarjetaPedido key={p.id} p={p} ahora={ahora()} conSucursal={variasSucursales} compacta>
                {p.estado === "listo" ? (
                  <button type="button" disabled={ocupado === p.id} onClick={() => void accion(p, "entregar")} className={`${BOTON_SECUNDARIO} min-h-10 w-full lg:min-h-0`}>
                    <CheckCircle2 className="h-4 w-4" aria-hidden /> Marcar entregado
                  </button>
                ) : null}
              </TarjetaPedido>
            ))}
          </ul>
        </div>
      ) : null}

      {cerrados.length ? (
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Última hora</h2>
          <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
            {cerrados.map((p) => (
              <li key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="w-12 shrink-0 font-mono text-xs text-slate-400">#{p.numero}</span>
                <span className="min-w-0 flex-1 truncate text-slate-700">{origenPedido(p, variasSucursales)}{p.motivo_rechazo ? <span className="text-slate-400"> · {p.motivo_rechazo}</span> : null}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${ESTADOS_PEDIDO[p.estado].clase}`}>{ESTADOS_PEDIDO[p.estado].texto}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );

  const listaCuentas = (
    <section>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800"><Receipt className="h-4 w-4 text-slate-500" aria-hidden /> Cuentas abiertas</h2>
      {!datos ? (
        <Esqueleto />
      ) : cuentas.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">No hay mesas con cuenta abierta.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          {cuentas.map((c) => {
            const enCaja = c.estado === "en_caja";
            const lugar = [c.mesa.zona, variasSucursales ? c.sucursal.nombre : null].filter(Boolean).join(" · ");
            return (
              <li key={c.id} className={`flex flex-col rounded-2xl border bg-white p-4 shadow-sm ${enCaja ? "border-sky-300" : "border-slate-200"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-slate-900 [overflow-wrap:anywhere]">{c.mesa.nombre}</p>
                    <p className="text-xs text-slate-500">
                      {lugar ? <>{lugar} · </> : null}<span className="whitespace-nowrap">abierta {horaCorta(c.abierta_at)}</span>
                    </p>
                  </div>
                  <p className="shrink-0 text-lg font-bold tabular-nums text-slate-900">{gs(c.total)}</p>
                </div>
                {enCaja ? (
                  <p className="mt-2 inline-flex w-fit flex-wrap items-center gap-x-1.5 rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-semibold text-sky-800">
                    <Receipt className="h-3.5 w-3.5" aria-hidden /> En caja · esperando cobro
                    {c.en_caja_at ? <span className="font-normal text-sky-700">desde {horaCorta(c.en_caja_at)}</span> : null}
                  </p>
                ) : null}
                <p className="mt-2 line-clamp-2 text-xs text-slate-500">
                  {c.items.length ? c.items.map((i) => `${cant(i.cantidad)} × ${i.nombre}`).join(" · ") : "Sin pedidos aceptados"}
                </p>
                {c.pendientes ? (
                  <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800">
                    {c.pendientes} pedido{c.pendientes === 1 ? "" : "s"} sin atender: aceptá o rechazá {enCaja ? "para que la caja pueda cobrar." : "antes de enviar la cuenta a caja."}
                  </p>
                ) : null}
                {puedeAtender ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {c.total <= 0 && !c.pendientes && !enCaja ? (
                      <button type="button" disabled={ocupado === c.id} onClick={() => void accionCuenta(c, "liberar")} className={`${BOTON_SECUNDARIO} min-h-11 flex-1 lg:min-h-0`}>Liberar mesa</button>
                    ) : enCaja ? (
                      <button type="button" disabled={ocupado === c.id} onClick={() => void accionCuenta(c, "reabrir")}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800 lg:min-h-8">
                        {ocupado === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" aria-hidden />} Volver a abrir
                      </button>
                    ) : (
                      <button type="button" disabled={ocupado === c.id || c.pendientes > 0 || c.total <= 0} onClick={() => void accionCuenta(c, "enviar_caja")}
                        className={`${BOTON_PRIMARIO} min-h-11 flex-1 lg:min-h-0`} style={{ backgroundColor: COLOR }}>
                        {ocupado === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" aria-hidden />} Enviar a caja
                      </button>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  return (
    <div className="space-y-5 pb-10">
      <EncabezadoPagina
        volver={{ href: "/caja/panel", label: "Caja" }}
        kicker="Caja"
        titulo="Pedidos de mesas"
        subtitulo="Los pedidos que llegan por el QR de cada mesa. Aceptalos para que pasen a la cocina y, cuando la mesa pida la cuenta, enviala a caja."
        acciones={
          <div className="flex items-center gap-2">
            <button type="button" onClick={cambiarSonido} className={`${BOTON_SECUNDARIO} min-h-11 lg:min-h-0`} aria-pressed={sonido} title={sonido ? "Silenciar el aviso" : "Activar el aviso sonoro"}>
              {sonido ? <Volume2 className="h-4 w-4" aria-hidden /> : <VolumeX className="h-4 w-4" aria-hidden />}
              <span className="max-sm:hidden">{sonido ? "Sonido" : "Silencio"}</span>
            </button>
            {tienePermiso(me, "cocina") ? <Link href="/caja/cocina" className={`${BOTON_SECUNDARIO} min-h-11 no-underline lg:min-h-0`}><ChefHat className="h-4 w-4" aria-hidden /> Cocina</Link> : null}
          </div>
        }
      />

      {llegaron > 0 && nuevos.length > 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
          <BellRing className="h-4 w-4 shrink-0" aria-hidden />
          <span className="flex-1">{llegaron === 1 ? "Llegó un pedido nuevo." : `Llegaron ${llegaron} pedidos nuevos.`}</span>
          <button type="button" onClick={() => setLlegaron(0)} aria-label="Cerrar aviso" className="rounded p-1"><X className="h-4 w-4" /></button>
        </div>
      ) : null}
      {aviso ? (
        <p className={`rounded-xl px-3 py-2 text-sm ${aviso.tipo === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`} role={aviso.tipo === "error" ? "alert" : "status"}>{aviso.texto}</p>
      ) : null}
      {error && !datos ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      {escritorio ? (
        <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-6">
          {cola}
          {listaCuentas}
        </div>
      ) : (
        <>
          <Pestanas valor={tab} onChange={(v) => setTab(v as "cola" | "cuentas")} opciones={[
            { id: "cola", label: "Pedidos", badge: nuevos.length || undefined },
            { id: "cuentas", label: "Cuentas abiertas", badge: cuentas.length || undefined },
          ]} />
          {tab === "cola" ? cola : listaCuentas}
        </>
      )}

      {rechazar ? (
        <PedirMotivo
          titulo={`Rechazar pedido #${rechazar.numero}`}
          descripcion={<>El cliente de <strong>{origenPedido(rechazar, variasSucursales)}</strong> ve el motivo en su celular.</>}
          confirmar="Rechazar pedido"
          onClose={() => setRechazar(null)}
          onConfirmar={async (m) => { await accion(rechazar, "rechazar", m); setRechazar(null); }}
        />
      ) : null}
    </div>
  );
}

function TarjetaPedido({ p, ahora, conSucursal, resaltar, compacta, children }: {
  p: PedidoMesa; ahora: number; conSucursal: boolean; resaltar?: boolean; compacta?: boolean; children?: React.ReactNode;
}) {
  const e = ESTADOS_PEDIDO[p.estado];
  const minutos = (ahora - Date.parse(p.creado_at)) / 60000;
  return (
    <li className={`rounded-2xl border bg-white shadow-sm ${resaltar ? (minutos > 5 ? "border-rose-300" : "border-amber-300") : "border-slate-200"}`}>
      <div className="flex items-start gap-3 px-4 pt-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold text-slate-900">{origenPedido(p, conSucursal)}</p>
          <p className="text-xs text-slate-500">
            <span className="font-mono">#{p.numero}</span> · {horaCorta(p.creado_at)} · <span className={resaltar && minutos > 5 ? "font-semibold text-rose-600" : ""}>{haceCuanto(p.creado_at, ahora)}</span>
            {p.nombre_cliente ? <> · <span className="font-medium text-slate-700">{p.nombre_cliente}</span></> : null}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${e.clase}`}>{e.texto}</span>
          <p className="mt-1 text-sm font-bold tabular-nums text-slate-900">{gs(p.total)}</p>
        </div>
      </div>
      <ul className={`px-4 ${compacta ? "pt-1.5 pb-2" : "pt-2 pb-2.5"}`}>
        {p.items.map((it, i) => (
          <li key={i} className="flex gap-2 py-0.5 text-sm">
            <span className="w-8 shrink-0 font-semibold tabular-nums text-slate-900">{cant(it.cantidad)}×</span>
            <span className="min-w-0 flex-1 text-slate-800">{it.nombre}{it.nota ? <span className="block text-xs text-amber-700">“{it.nota}”</span> : null}</span>
          </li>
        ))}
      </ul>
      {p.nota ? <p className="mx-4 mb-2.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">Nota: {p.nota}</p> : null}
      {children ? <div className="border-t border-slate-100 px-4 py-2.5">{children}</div> : null}
    </li>
  );
}

function Esqueleto() {
  return <div className="space-y-3" aria-busy="true">{[0, 1].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-200/70" />)}</div>;
}
