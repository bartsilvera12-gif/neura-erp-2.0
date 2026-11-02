"use client";

/**
 * /rrhh/liquidaciones — Extracto del mes para el asesor (receta 118). Abierta se recalcula con los datos
 * de hoy; cerrada queda como estaba. No mueve plata.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Download, Loader2, Lock, Plus, Printer, Trash2, Unlock } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { descargarArchivo } from "@/lib/api/client-blob";
import { hoyPY } from "@/lib/fecha/paraguay";
import { usePermiso } from "@/lib/sesion/ContextoUsuario";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { Modal } from "@/components/Modal";
import { Select } from "@/components/Select";
import { TablaTarjetas } from "@/components/TablaResponsive";
import { gs } from "@/components/graficos/formato";
import { etiquetaMes } from "@/modules/comisiones/calculo";
import { imprimirHtml } from "@/modules/mesas/imprimirComanda";
import { PIE_MODAL } from "@/modules/clientes/ui";
import type { Ajuste } from "@/modules/rrhh/calculo";
import type { ExtractoFila, ExtractoMes } from "@/modules/rrhh/tipos";
import { BOTON, BOTON_PRIMARIO, Campo, CampoMonto, Cifra, INPUT, Interruptor, htmlExtracto, renglonesExtracto } from "@/modules/rrhh/ui";

function ultimosMeses(n: number): [string, string][] {
  const [a, m] = hoyPY().slice(0, 7).split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const total = a * 12 + (m - 1) - i;
    const mes = `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
    return [mes, etiquetaMes(mes)];
  });
}

const liquidar = (body: object) => apiFetch("/api/rrhh/liquidaciones", { method: "POST", body: JSON.stringify(body) });

function ModalExtracto({ f, mes, periodo, onClose, onCambio }: { f: ExtractoFila; mes: string; periodo: string; onClose: () => void; onCambio: () => void }) {
  const r = f.resultado;
  const cerrada = f.estado === "cerrada";
  const [dias, setDias] = useState(r.tipo_salario === "jornalero" && !f.faltan_dias ? String(r.dias_pagados) : "");
  const [ajustes, setAjustes] = useState<Ajuste[]>(r.ajustes);
  const [motivo, setMotivo] = useState("");
  const [reabriendo, setReabriendo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jornalero = r.tipo_salario === "jornalero";
  const ajustesValidos = ajustes.filter((a) => a.concepto.trim() && a.monto > 0);
  const cambiar = (i: number, c: Partial<Ajuste>) => setAjustes((l) => l.map((a, k) => (k === i ? { ...a, ...c } : a)));

  async function correr(fn: () => Promise<unknown>, cerrar = false) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onCambio();
      if (cerrar) onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const guardar = () => liquidar({ accion: "ajustar", mes, usuario_id: f.usuario_id, dias_trabajados: jornalero ? (dias.trim() === "" ? null : Number(dias.replace(",", "."))) : null, ajustes: ajustesValidos });

  return (
    <Modal titulo={`${f.nombre}: ${periodo}`} onClose={busy ? () => {} : onClose} size="xl">
      <div className="space-y-4">
        <dl className="rounded-xl border border-slate-200 p-3 text-sm">
          {renglonesExtracto(r).map((x, i) => (
            <div key={i} className={`flex justify-between gap-3 py-1 ${x.total ? "font-semibold text-slate-900" : x.info ? "text-xs text-slate-500" : "text-slate-600"}`}>
              <dt className="min-w-0">{x.label}</dt><dd className="shrink-0 tabular-nums">{x.signo === "-" ? "− " : ""}{gs(x.monto)}</dd>
            </div>
          ))}
        </dl>
        {cerrada ? <p className="text-xs text-slate-500">Cerrada por {f.cerrada_por ?? "—"}. Para cambiarla, primero reabrila.</p> : <p className="text-xs text-slate-500">Lo que cambies se ve en el extracto al guardar.</p>}

        {!cerrada ? (
          <>
            {jornalero ? <Campo label="Días trabajados en el mes *"><input inputMode="decimal" className={INPUT} value={dias} onChange={(e) => setDias(e.target.value)} /></Campo> : null}
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-600">Extras y descuentos</p>
              {ajustes.map((a, i) => (
                <div key={i} className="space-y-2 rounded-xl border border-slate-200 p-3">
                  <div className="flex gap-2">
                    <input className={INPUT} aria-label="Concepto" placeholder="Concepto: horas extra, adelanto…" value={a.concepto} onChange={(e) => cambiar(i, { concepto: e.target.value })} />
                    <button type="button" aria-label="Quitar" className={BOTON} onClick={() => setAjustes((l) => l.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4" /></button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Select block value={a.tipo} etiqueta="Tipo" options={[["extra", "Suma"], ["descuento", "Resta"]]} onChange={(v) => cambiar(i, { tipo: v as Ajuste["tipo"] })} />
                    <CampoMonto valor={a.monto} onChange={(n) => cambiar(i, { monto: n })} />
                  </div>
                  {a.tipo === "extra" ? <Interruptor valor={a.imponible} onChange={(v) => cambiar(i, { imponible: v })} label="Aporta IPS" ayuda="Horas extra sí. Bonificación familiar no." /> : null}
                </div>
              ))}
              <button type="button" className={`${BOTON} w-full`} onClick={() => setAjustes((l) => [...l, { concepto: "", monto: 0, tipo: "extra", imponible: true }])}><Plus className="h-4 w-4" /> Agregar</button>
            </div>
          </>
        ) : null}

        {reabriendo ? <Campo label="Motivo para reabrir *"><input autoFocus className={INPUT} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo> : null}
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        <div className={`${PIE_MODAL} flex-wrap`}>
          <button type="button" className={BOTON} onClick={() => void imprimirHtml(htmlExtracto({ periodo, nombre: f.nombre, ci: f.ci, sucursal: f.sucursal, area: f.area, antiguedad: f.antiguedad, vacaciones: f.vacaciones_saldo, aguinaldo: f.aguinaldo.total, estado: f.estado, resultado: r }))}><Printer className="h-4 w-4" /> Imprimir</button>
          {cerrada ? (
            reabriendo
              ? <button type="button" className={BOTON_PRIMARIO} disabled={busy || motivo.trim().length < 3} onClick={() => void correr(() => liquidar({ accion: "reabrir", mes, usuario_id: f.usuario_id, motivo }), true)}>Confirmar</button>
              : <button type="button" className={BOTON} onClick={() => setReabriendo(true)}><Unlock className="h-4 w-4" /> Reabrir</button>
          ) : (
            <>
              <button type="button" className={BOTON} disabled={busy} onClick={() => void correr(guardar)}>Guardar</button>
              <button type="button" className={BOTON_PRIMARIO} disabled={busy} onClick={() => void correr(async () => { await guardar(); await liquidar({ accion: "cerrar", mes, usuarios: [f.usuario_id] }); }, true)}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />} Cerrar
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default function PaginaLiquidaciones() {
  const puedeExportar = usePermiso("exportar");
  const [mes, setMes] = useState(hoyPY().slice(0, 7));
  const [datos, setDatos] = useState<ExtractoMes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(() => {
    setError(null);
    apiFetch<ExtractoMes>(`/api/rrhh/liquidaciones?mes=${mes}`).then(setDatos).catch((e: Error) => setError(e.message));
  }, [mes]);
  useEffect(() => { cargar(); }, [cargar]);

  const filas = datos?.mes === mes ? datos.filas : [];
  const sumar = (fn: (f: ExtractoFila) => number) => filas.reduce((s, f) => s + fn(f), 0);
  const abiertas = filas.filter((f) => f.estado === "abierta");
  const elegida = filas.find((f) => f.usuario_id === abierta) ?? null;

  async function cerrarTodas() {
    setBusy(true);
    setError(null);
    try {
      await liquidar({ accion: "cerrar", mes, usuarios: abiertas.map((f) => f.usuario_id) });
      cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <EncabezadoPagina titulo="Liquidaciones" subtitulo="Extracto del mes para revisar con el asesor. No genera pagos ni gastos." volver={{ href: "/rrhh/panel", label: "RR HH" }}
        acciones={
          <div className="flex flex-wrap gap-2 max-sm:w-full max-sm:[&>*]:flex-1">
            {puedeExportar ? <button type="button" className={BOTON} disabled={!filas.length} onClick={() => void descargarArchivo(`/api/rrhh/liquidaciones/export?mes=${mes}`, `liquidacion-${mes}.xlsx`).catch((e: Error) => setError(e.message))}><Download className="h-4 w-4" /> Excel</button> : null}
            <button type="button" className={BOTON_PRIMARIO} disabled={busy || !abiertas.length} onClick={() => void cerrarTodas()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />} Cerrar el mes</button>
          </div>
        } />

      <div className="max-w-xs"><Select block value={mes} onChange={setMes} options={ultimosMeses(24)} etiqueta="Mes" /></div>

      {datos && datos.sin_legajo > 0 ? (
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{datos.sin_legajo === 1 ? "1 persona no sale acá porque" : `${datos.sin_legajo} personas no salen acá porque`} falta cargar sus datos. <Link href="/rrhh" className="font-semibold underline">Ir a Personal</Link></span>
        </p>
      ) : null}
      {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra label="Neto a cobrar" valor={gs(sumar((f) => f.resultado.neto))} />
        <Cifra label="Imponible" valor={gs(sumar((f) => f.resultado.imponible))} />
        <Cifra label="IPS trabajadores" valor={gs(sumar((f) => f.resultado.ips_trabajador))} />
        <Cifra label="IPS empresa" valor={gs(sumar((f) => f.resultado.ips_empresa))} />
      </div>

      {!datos && !error ? <p className="text-sm text-slate-400">Cargando…</p> : null}
      {datos ? (
        <TablaTarjetas
          filas={filas}
          claveFila={(f) => f.usuario_id}
          onFila={(f) => setAbierta(f.usuario_id)}
          columnas={[
            { key: "nombre", titulo: "Nombre", movil: "titulo", celda: (f) => <span className="font-medium text-slate-900">{f.nombre}</span> },
            { key: "tipo", titulo: "Tipo", movil: "subtitulo", celda: (f) => (f.resultado.tipo_salario === "jornalero" ? "Jornalero" : "Mensualero") },
            { key: "ausencias", titulo: "Ausencias", movil: "dato", claseTd: "tabular-nums", celda: (f) => (f.resultado.dias_ausencia ? `${f.resultado.dias_ausencia} d` : "—") },
            { key: "imponible", titulo: "Imponible", movil: "detalle", claseTh: "text-right", claseTd: "text-right tabular-nums", celda: (f) => gs(f.resultado.imponible) },
            { key: "ips", titulo: "IPS", movil: "detalle", claseTh: "text-right", claseTd: "text-right tabular-nums", celda: (f) => gs(f.resultado.ips_trabajador) },
            { key: "neto", titulo: "Neto", movil: "valor", claseTh: "text-right", claseTd: "text-right font-semibold tabular-nums", celda: (f) => gs(f.resultado.neto) },
            { key: "estado", titulo: "Estado", movil: "chip", celda: (f) => (
              f.estado === "cerrada" ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">Cerrada</span>
              : f.faltan_dias ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">Faltan días</span>
              : <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700">Abierta</span>
            ) },
          ]}
        />
      ) : null}

      {elegida && datos ? <ModalExtracto key={`${elegida.usuario_id}-${elegida.estado}`} f={elegida} mes={mes} periodo={datos.periodo} onClose={() => setAbierta(null)} onCambio={cargar} /> : null}
    </div>
  );
}
