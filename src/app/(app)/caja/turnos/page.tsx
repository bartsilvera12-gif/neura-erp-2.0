"use client";

/**
 * Caja › Apertura y cierre. Estado de cada caja de la sucursal (ADMIN: de todas):
 *   · abierta: turno, quién la abrió, ventas y efectivo esperado → ver turno, retiro /
 *     ingreso de efectivo, cerrar con arqueo
 *   · cerrada: último cierre → abrir un turno nuevo
 *   · resumen del día y los últimos cierres (con su PDF)
 *   · ADMIN: alta / edición de cajas (nombre, sucursal, depósito de salida)
 * ?abrir=1 abre la ventana de apertura; ?cerrar=<turno> la de cierre (links del POS).
 */
import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeftRight, Building2, Clock, Download, Eye, Loader2, Lock, Settings2, ShoppingCart, Unlock, Wallet } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { descargarArchivo } from "@/lib/api/client-blob";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, Cabecera, TEAL } from "@/modules/inventario/ui";
import { fechaHora, hora, invalidarCajas, useEstadoCajas, type CajaPunto, type EstadoCajas } from "@/modules/caja/turno";
import { formatGs } from "@/modules/caja/lib";
import { AperturaModal } from "@/modules/caja/AperturaModal";
import { MovimientoModal } from "@/modules/caja/MovimientoModal";
import { CierreModal } from "@/modules/caja/CierreModal";
import { TurnoModal } from "@/modules/caja/TurnoModal";
import { ConfigurarCajasModal } from "@/modules/caja/ConfigurarCajas";

type Dia = {
  fecha: string;
  totales: { turnos: number; abiertos: number; total_vendido: number; ventas_contado: number; ventas_credito: number; cobros: number; efectivo_esperado: number; diferencia: number };
};

export default function TurnosPage() {
  return (
    <Suspense>
      <TurnosContenido />
    </Suspense>
  );
}

function TurnosContenido() {
  const sp = useSearchParams();
  const router = useRouter();
  const [recarga, setRecarga] = useState(0);
  const { datos, error, cargando } = useEstadoCajas(recarga);
  const [dia, setDia] = useState<Dia | null>(null);
  const [abrir, setAbrir] = useState<{ punto: string | null } | null>(null);
  const [mov, setMov] = useState<{ turno: string; etiqueta: string; efectivo: number } | null>(null);
  const [cerrar, setCerrar] = useState<string | null>(null);
  const [ver, setVer] = useState<string | null>(null);
  const [config, setConfig] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const refrescar = useCallback(() => {
    invalidarCajas();
    setRecarga((k) => k + 1);
  }, []);

  useEffect(() => {
    apiFetch<Dia>("/api/caja/dia").then(setDia).catch(() => {});
  }, [recarga]);

  // Pedidos por URL (desde el POS o el menú).
  useEffect(() => {
    if (!datos) return;
    const c = sp.get("cerrar");
    if (c) setCerrar(c);
    if (sp.get("abrir") === "1") setAbrir({ punto: sp.get("punto") });
    if (c || sp.get("abrir")) router.replace("/caja/turnos", { scroll: false });
  }, [datos, sp, router]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 5000);
    return () => clearTimeout(t);
  }, [aviso]);

  const sucursales = (datos?.sucursales ?? []).filter((s) => s.activa || s.cajas.some((c) => c.turno));
  const abiertas = datos?.abiertas.length ?? 0;

  return (
    <div className="space-y-6 pb-10">
      <Cabecera kicker="Finanzas · Caja" titulo="Apertura y cierre"
        subtitulo={datos ? (datos.es_admin ? "Las cajas de todas las sucursales: abrí, mové efectivo y cerrá con arqueo" : `Las cajas de ${sucursales[0]?.nombre ?? "tu sucursal"}`) : "Cargando cajas…"}>
        {datos?.es_admin ? (
          <button type="button" onClick={() => setConfig(true)} className={BOTON_SECUNDARIO}><Settings2 className="h-4 w-4" /> Configurar cajas</button>
        ) : null}
        <Link href="/caja/nueva" className={BOTON_SECUNDARIO}><ShoppingCart className="h-4 w-4" /> Ir a vender</Link>
        <button type="button" onClick={() => setAbrir({ punto: null })} disabled={!datos} className={BOTON_PRIMARIO} style={{ backgroundColor: TEAL }}>
          <Unlock className="h-4 w-4" /> Abrir caja
        </button>
      </Cabecera>

      {aviso ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-800">{aviso}</p> : null}

      {/* Resumen del día */}
      <section className="grid grid-cols-2 divide-x divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-5">
        <Cifra label="Cajas abiertas" valor={String(abiertas)} icono={Wallet} />
        <Cifra label="Vendido hoy" valor={dia ? formatGs(dia.totales.total_vendido) : "…"} icono={ShoppingCart} destacado />
        <Cifra label="Contado" valor={dia ? formatGs(dia.totales.ventas_contado) : "…"} icono={Wallet} />
        <Cifra label="Crédito" valor={dia ? formatGs(dia.totales.ventas_credito) : "…"} icono={Clock} />
        <Cifra label="Cobros de cuentas" valor={dia ? formatGs(dia.totales.cobros) : "…"} icono={ArrowLeftRight} />
      </section>
      <p className="-mt-4 text-[11px] text-slate-400">Turnos abiertos hoy. El resto del detalle, en cada caja.</p>

      {cargando ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : error ? (
        <p className="rounded-xl border border-rose-100 bg-rose-50 p-4 text-sm text-rose-700">No se pudieron cargar las cajas: {error}</p>
      ) : (
        sucursales.map((s) => (
          <section key={s.id}>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Building2 className="h-4 w-4" style={{ color: TEAL }} /> {s.nombre}
              {s.es_principal ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200">Principal</span> : null}
            </h2>
            {s.cajas.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
                Esta sucursal no tiene cajas.
                {datos?.es_admin ? <button type="button" onClick={() => setConfig(true)} className="ml-1 font-semibold text-[var(--brand)] hover:underline">Crear una</button> : " Pedile a un administrador que cree una."}
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {s.cajas.filter((c) => c.activo || c.turno).map((c) => (
                  <TarjetaCaja key={c.id} c={c} estado={datos!}
                    onAbrir={() => setAbrir({ punto: c.id })}
                    onVer={() => c.turno && setVer(c.turno.id)}
                    onMov={() => c.turno && setMov({ turno: c.turno.id, etiqueta: `${c.nombre} · ${s.nombre} · Turno N° ${c.turno.numero_caja}`, efectivo: c.turno.efectivo_esperado })}
                    onCerrar={() => c.turno && setCerrar(c.turno.id)} />
                ))}
              </div>
            )}
          </section>
        ))
      )}

      {/* Últimos cierres */}
      {datos && datos.recientes.length ? (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">Últimos cierres</h2>
            <Link href="/reportes/cajas" className="text-xs font-semibold text-[var(--brand)] hover:underline">Todos los cierres →</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 text-left">Turno</th>
                  <th className="px-4 py-2.5 text-left">Caja</th>
                  <th className="px-4 py-2.5 text-left">Apertura → cierre</th>
                  <th className="px-4 py-2.5 text-left">Cerró</th>
                  <th className="px-4 py-2.5 text-right">Vendido</th>
                  <th className="px-4 py-2.5 text-right">Diferencia</th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {datos.recientes.map((t) => {
                  const dif = (t.diferencia ?? 0) + (t.diferencia_otros ?? 0);
                  return (
                    <tr key={t.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-500">N° {t.numero_caja}</td>
                      <td className="px-4 py-2.5 text-slate-800">{t.punto_nombre} <span className="text-slate-400">· {t.sucursal_nombre}</span></td>
                      <td className="px-4 py-2.5 text-xs tabular-nums text-slate-500">{fechaHora(t.fecha_apertura)} → {t.fecha_cierre ? hora(t.fecha_cierre) : "—"}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">{t.cerrada_por_nombre ?? "—"}</td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-800">{formatGs(t.total_vendido)}</td>
                      <td className={`px-4 py-2.5 text-right text-xs font-semibold tabular-nums ${t.diferencia == null ? "text-slate-400" : dif === 0 ? "text-emerald-600" : dif < 0 ? "text-rose-600" : "text-amber-600"}`}>
                        {t.diferencia == null ? "—" : dif === 0 ? "Cuadró" : `${dif > 0 ? "+" : "−"} ${formatGs(Math.abs(dif))}`}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button type="button" onClick={() => setVer(t.id)} title="Ver turno" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Eye className="h-4 w-4" /></button>
                        <button type="button" onClick={() => descargarArchivo(`/api/caja/turnos/${t.id}/pdf`, `cierre-caja-${t.numero_caja}.pdf`).catch(() => {})} title="PDF del cierre" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Download className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {abrir && datos ? (
        <AperturaModal estado={datos} puntoInicial={abrir.punto} onClose={() => setAbrir(null)}
          onAbierta={() => { setAbrir(null); setAviso("Caja abierta. Ya podés vender."); refrescar(); }} />
      ) : null}
      {mov ? (
        <MovimientoModal cajaId={mov.turno} etiqueta={mov.etiqueta} efectivoDisponible={mov.efectivo} onClose={() => setMov(null)}
          onHecho={(n) => { setMov(null); setAviso(`Movimiento ${n} registrado.`); refrescar(); }} />
      ) : null}
      {cerrar ? <CierreModal turnoId={cerrar} onClose={() => setCerrar(null)} onCerrada={refrescar} /> : null}
      {ver ? <TurnoModal turnoId={ver} onClose={() => setVer(null)} onCambio={refrescar} onCerrar={() => { const id = ver; setVer(null); setCerrar(id); }} /> : null}
      {config && datos ? <ConfigurarCajasModal estado={datos} onClose={() => setConfig(false)} onCambio={refrescar} /> : null}
    </div>
  );
}

function TarjetaCaja({ c, estado, onAbrir, onVer, onMov, onCerrar }: {
  c: CajaPunto; estado: EstadoCajas; onAbrir: () => void; onVer: () => void; onMov: () => void; onCerrar: () => void;
}) {
  const t = c.turno;
  const mia = t && t.abierta_por === estado.mi_usuario_id;
  if (!t) {
    const u = c.ultimo_cierre;
    const dif = u ? (u.diferencia ?? 0) + (u.diferencia_otros ?? 0) : 0;
    return (
      <div className={`flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${c.activo ? "" : "opacity-60"}`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="flex items-center gap-2 text-base font-semibold text-slate-900">{c.nombre}
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{c.activo ? "Cerrada" : "Inactiva"}</span>
            </p>
            <p className="mt-0.5 text-xs text-slate-500">Sale de {c.deposito_nombre}</p>
          </div>
          <Lock className="h-4 w-4 text-slate-300" />
        </div>
        <p className="mt-3 flex-1 text-xs text-slate-500">
          {u?.fecha_cierre ? <>Último cierre {fechaHora(u.fecha_cierre)}{u.cerrada_por_nombre ? ` · ${u.cerrada_por_nombre}` : ""} · <span className={dif === 0 ? "text-emerald-600" : "text-rose-600"}>{dif === 0 ? "cuadró" : `diferencia ${formatGs(dif)}`}</span></> : "Todavía no tuvo turnos."}
        </p>
        {c.activo ? (
          <button type="button" onClick={onAbrir} className={`${BOTON_PRIMARIO} mt-4 w-full`} style={{ backgroundColor: TEAL }}><Unlock className="h-4 w-4" /> Abrir caja</button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm ring-1 ring-emerald-500/5">
      <div className="bg-gradient-to-r from-emerald-50/80 to-white px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <span className="relative flex h-2.5 w-2.5 shrink-0"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" /></span>
              {c.nombre}
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">Abierta</span>
            </p>
            <p className="mt-0.5 truncate text-xs text-slate-500">Turno N° {t.numero_caja} · {t.abierta_por_nombre ?? "—"}{mia ? " (vos)" : ""} · desde {hora(t.fecha_apertura)}</p>
          </div>
          <button type="button" onClick={onVer} title="Ver turno" className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-slate-700"><Eye className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="grid grid-cols-3 divide-x divide-slate-100 border-y border-slate-100 text-center">
        <Mini label="Inicial" valor={formatGs(t.monto_apertura)} />
        <Mini label={`Ventas (${t.ventas_cantidad})`} valor={formatGs(t.ventas_total)} />
        <Mini label="Efectivo esperado" valor={formatGs(t.efectivo_esperado)} destacado />
      </div>
      <div className="flex gap-2 p-3">
        <button type="button" onClick={onMov} className={`${BOTON_SECUNDARIO} flex-1`}><ArrowLeftRight className="h-4 w-4" /> Retiro / ingreso</button>
        <button type="button" onClick={onCerrar} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3.5 py-2 text-sm font-semibold text-rose-600 shadow-sm transition hover:bg-rose-50">
          <Lock className="h-4 w-4" /> Cerrar
        </button>
      </div>
      <p className="px-4 pb-3 text-[11px] text-slate-400">Sale de {c.deposito_nombre}</p>
    </div>
  );
}

function Mini({ label, valor, destacado }: { label: string; valor: string; destacado?: boolean }) {
  return (
    <div className="px-2 py-2.5" style={destacado ? { backgroundColor: `${TEAL}10` } : undefined}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 truncate text-sm font-bold tabular-nums" style={{ color: destacado ? TEAL : "#0f172a" }}>{valor}</p>
    </div>
  );
}

function Cifra({ label, valor, icono: Icono, destacado }: { label: string; valor: string; icono: React.ComponentType<{ className?: string }>; destacado?: boolean }) {
  return (
    <div className="min-w-0 px-4 py-3.5" style={destacado ? { backgroundColor: `${TEAL}12` } : undefined}>
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500"><Icono className="h-3 w-3" /> {label}</p>
      <p className="mt-1 truncate text-lg font-bold tabular-nums" style={{ color: destacado ? TEAL : "#0f172a" }}>{valor}</p>
    </div>
  );
}

