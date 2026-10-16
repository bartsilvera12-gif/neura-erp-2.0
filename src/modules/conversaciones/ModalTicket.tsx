"use client";

/**
 * Ticket de Soporte sin salir del chat (flujo de Tipificación): Estado → Sub-estado que crea
 * ticket (error / cambio), clasificación (con su SLA) y descripción. No cierra la conversación.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Headset } from "lucide-react";
import { crearTicket, pedirCatalogoCierre, type CatalogoCierre } from "@/modules/conversaciones/api";
import type { FilaBandeja } from "@/modules/conversaciones/dominio";
import { numeroTicket } from "@/modules/tipificacion/dominio";
import { Select } from "@/components/Select";
import { AvisoError, Ventana, botonPrimario, botonSecundario, claseCampo, claseEtiqueta } from "@/modules/conversaciones/ui";

const esTicket = (c: string | null) => c === "ticket_error" || c === "ticket_cambio";

export function ModalTicket({ conv, contacto, onCerrar, onAbrirFicha }: { conv: FilaBandeja; contacto: string; onCerrar: () => void; onAbrirFicha: () => void }) {
  const [cat, setCat] = useState<CatalogoCierre | null>(null);
  const [familia, setFamilia] = useState("");
  const [sub, setSub] = useState("");
  const [clas, setClas] = useState("");
  const [obs, setObs] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<{ id: string; numero: number } | null>(null);

  // Solo los estados que tienen algún sub-estado que crea ticket.
  const familias = useMemo(
    () => (cat?.familias ?? []).map((f) => ({ ...f, subestados: f.subestados.filter((s) => esTicket(s.comportamiento)) })).filter((f) => f.subestados.length),
    [cat],
  );
  useEffect(() => {
    pedirCatalogoCierre().then(setCat).catch((e) => setError((e as Error).message));
  }, []);
  useEffect(() => {
    if (!familia && familias[0]) setFamilia(familias[0].id);
  }, [familias, familia]);

  const fam = familias.find((f) => f.id === familia) ?? null;
  const subestado = fam?.subestados.find((s) => s.id === sub) ?? null;
  const tipo = subestado?.comportamiento === "ticket_error" ? "error" : subestado ? "cambio" : null;
  const clasificaciones = (cat?.clasificaciones ?? []).filter((c) => c.tipo_codigo === tipo);
  const listo = !!sub && !!obs.trim() && (!clasificaciones.length || !!clas);

  const guardar = async () => {
    setGuardando(true);
    setError(null);
    try {
      const r = await crearTicket(conv.id, { familia_id: familia, estado_id: sub, observacion: obs.trim(), clasificacion_codigo: clas || null });
      setHecho(r.ticket);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Ventana titulo="Ticket de Soporte" detalle={`Para ${contacto}. Queda en Soporte y en el historial del cliente.`} icono={Headset} onCerrar={() => !guardando && onCerrar()} z="z-[120]">
      {hecho ? (
        <div className="py-4 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
          <p className="mt-2 text-sm font-semibold text-slate-800">Ticket {numeroTicket(hecho.numero)} creado</p>
          <div className="mt-4 flex justify-center gap-2">
            <Link href={`/soporte/tickets/${hecho.id}`} className={botonSecundario}>Ver ticket</Link>
            <button type="button" onClick={onCerrar} className={botonPrimario}>Listo</button>
          </div>
        </div>
      ) : !conv.cliente_id ? (
        <div className="space-y-3 text-sm text-slate-600">
          <p>El contacto no tiene un cliente vinculado. El ticket se carga sobre un cliente del ERP.</p>
          <button type="button" onClick={onAbrirFicha} className={botonPrimario}>Abrir la ficha para vincularlo</button>
        </div>
      ) : !cat && !error ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <span key={i} className="block h-10 animate-pulse rounded-xl bg-slate-100" />)}
        </div>
      ) : cat && !cat.puede_soporte ? (
        <p className="text-sm text-red-700">Tu usuario no puede cargar tickets de Soporte.</p>
      ) : cat && !familias.length ? (
        <p className="text-sm text-amber-700">No hay sub-estados de tipificación que creen tickets (configuralos en Clientes › Tipificaciones).</p>
      ) : cat ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={claseEtiqueta}>Estado</label>
              <Select
                block
                etiqueta="Estado"
                value={familia}
                onChange={(v) => (setFamilia(v), setSub(""), setClas(""))}
                options={familias.map((f): [string, string] => [f.id, f.nombre])}
              />
            </div>
            <div>
              <label className={claseEtiqueta}>Subestado</label>
              <Select
                block
                etiqueta="Subestado"
                value={sub}
                onChange={(v) => (setSub(v), setClas(""))}
                options={[
                  ["", "Elegir…"],
                  ...(fam?.subestados ?? []).map((s): [string, string] => [s.id, `${s.nombre} · ${s.comportamiento === "ticket_error" ? "Error" : "Cambio"}`]),
                ]}
              />
            </div>
          </div>
          {clasificaciones.length ? (
            <div>
              <label className={claseEtiqueta}>Clasificación</label>
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
                {clasificaciones.map((c) => (
                  <button
                    key={c.codigo}
                    type="button"
                    onClick={() => setClas(c.codigo)}
                    className={`rounded-xl border px-3 py-2 text-left text-xs transition-colors ${clas === c.codigo ? "border-[#4FAEB2] bg-[#4FAEB2]/10 text-[#2F6E71]" : "border-slate-200 hover:bg-slate-50"}`}
                  >
                    <span className="block font-semibold">{c.nombre}</span>
                    {c.sla_horas ? <span className="text-[11px] text-slate-500">SLA {c.sla_horas} h laborales</span> : null}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div>
            <label className={claseEtiqueta}>Descripción</label>
            <textarea
              className={`${claseCampo} min-h-[110px] resize-y`}
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              placeholder="Qué pasa / qué pide el cliente. La primera línea es el asunto del ticket."
            />
          </div>
        </div>
      ) : null}
      <AvisoError>{error}</AvisoError>
      {!hecho && conv.cliente_id && cat?.puede_soporte && familias.length ? (
        <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
          <button type="button" disabled={guardando} onClick={onCerrar} className={botonSecundario}>Cancelar</button>
          <button type="button" disabled={guardando || !listo} onClick={() => void guardar()} className={botonPrimario}>
            {guardando ? "Creando…" : "Crear ticket"}
          </button>
        </div>
      ) : null}
    </Ventana>
  );
}
