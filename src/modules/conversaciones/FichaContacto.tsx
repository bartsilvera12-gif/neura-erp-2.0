"use client";

/**
 * Ficha del contacto, superpuesta a la derecha del chat (cerrada no existe; abierta no mueve
 * nada de lugar). Muestra la tarjeta del cliente del 2.0 (código, deuda, suscripción activa,
 * últimos tickets, última tipificación) y el prospecto del CRM, con "Ver ficha", "Crear
 * cliente" y "Crear prospecto en CRM". Se pide una vez por conversación (cache en memoria).
 * Debajo de 1024 px (celular / tablet) se abre en una HOJA (inferior en celular).
 */
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ExternalLink, Sparkles, UserPlus, X } from "lucide-react";
import { HojaInferior } from "@/components/HojaInferior";
import { useEsEscritorio } from "@/lib/ui/responsive";
import { NuevoCliente } from "@/modules/clientes/NuevoCliente";
import { crearProspecto, pedirFicha, vincularCliente, type Ficha } from "@/modules/conversaciones/api";
import { telefonoLegible, type FilaBandeja } from "@/modules/conversaciones/dominio";
import { fechaHoraPy, numeroTicket } from "@/modules/tipificacion/dominio";
import { CodigoChip, gs, usd } from "@/modules/clientes/ui";
import { cacheFicha } from "@/modules/conversaciones/ficha-cache";

const cache = cacheFicha;

export function FichaContacto({ conv, onCerrar, onFila }: { conv: FilaBandeja; onCerrar: () => void; onFila: (f: FilaBandeja) => void }) {
  const [ficha, setFicha] = useState<Ficha | null>(cache.get(conv.id) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [creandoCliente, setCreandoCliente] = useState(false);
  const escritorio = useEsEscritorio();

  const cargar = useCallback(
    async (fresco = false) => {
      if (!fresco && cache.has(conv.id)) {
        setFicha(cache.get(conv.id)!);
        return;
      }
      setError(null);
      try {
        const f = await pedirFicha(conv.id);
        cache.set(conv.id, f);
        setFicha(f);
        // Se vinculó por teléfono recién: que la cabecera/lista lo sepan.
        if (f.cliente?.vinculado_ahora && !conv.cliente_id) onFila({ ...conv, cliente_id: f.cliente.id });
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [conv, onFila],
  );

  useEffect(() => {
    setFicha(cache.get(conv.id) ?? null);
    void cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.id]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && !creandoCliente && onCerrar();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onCerrar, creandoCliente]);

  const accion = async (clave: string, fn: () => Promise<FilaBandeja | null | undefined>) => {
    setOcupado(clave);
    setError(null);
    try {
      const f = await fn();
      if (f) onFila(f);
      cache.delete(conv.id);
      await cargar(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const c = ficha?.cliente ?? null;
  const p = ficha?.prospecto ?? null;

  const nuevoCliente = creandoCliente ? (
    <NuevoCliente
      inicial={{ nombre: conv.contacto_nombre ?? "", telefono: conv.contacto_telefono ?? "" }}
      onClose={() => setCreandoCliente(false)}
      onCreado={(cli) => {
        setCreandoCliente(false);
        void accion("vincular", () => vincularCliente(conv.id, cli.id));
      }}
    />
  ) : null;

  const cuerpo = (
        <>
          {error ? <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{error}</p> : null}
          {!ficha ? (
            <div className="flex animate-pulse flex-col gap-3" aria-hidden>
              <div className="h-4 w-2/3 rounded bg-slate-200" />
              <div className="h-3 w-1/3 rounded bg-slate-100" />
              <div className="h-24 rounded-xl bg-slate-100" />
              <div className="h-20 rounded-xl bg-slate-100" />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Identidad */}
              <section>
                <p className="text-base font-semibold leading-tight text-slate-900">{ficha.contacto.nombre ?? "Sin nombre"}</p>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="font-mono text-xs tabular-nums text-slate-500">{telefonoLegible(ficha.contacto.telefono)}</span>
                  {ficha.contacto.telefono ? <BotonCopiar valor={ficha.contacto.telefono} /> : null}
                </div>
                <p className="mt-1 text-[11px] text-slate-400">Primer contacto: {fechaHoraPy(ficha.contacto.creado_at)}</p>
              </section>

              {/* Último cierre de la conversación */}
              {ficha.cierre ? (
                <Seccion titulo="Último cierre">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="text-xs font-semibold text-slate-800">
                      {ficha.cierre.estado ?? "—"}
                      {ficha.cierre.subestado ? <span className="font-normal text-slate-500"> · {ficha.cierre.subestado}</span> : null}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {fechaHoraPy(ficha.cierre.fecha)}
                      {ficha.cierre.por ? ` · cerró ${ficha.cierre.por}` : ""}
                    </p>
                    {ficha.cierre.observacion ? <p className="mt-1 whitespace-pre-wrap text-[11px] leading-snug text-slate-600">{ficha.cierre.observacion}</p> : null}
                    {ficha.cierre.reabierta ? (
                      <p className="mt-1.5 rounded-lg bg-amber-50 px-2 py-1 text-[10px] leading-snug text-amber-800">
                        La conversación se reabrió después de este cierre, así que no refleja lo que está pasando ahora.
                      </p>
                    ) : null}
                  </div>
                </Seccion>
              ) : null}

              {/* Cliente */}
              <Seccion titulo="Cliente">
                {c ? (
                  <div className="rounded-xl border border-[#4FAEB2]/30 bg-[#4FAEB2]/5 px-3 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900">{c.nombre}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {c.codigo ? <CodigoChip codigo={c.codigo} fondo="bg-white" /> : null}
                          {!c.activo ? <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Inactivo</span> : null}
                        </div>
                      </div>
                      <Link href={`/clientes/${c.id}`} className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-[#3F8E91] hover:underline max-lg:-my-2 max-lg:min-h-10 max-lg:text-xs">
                        Ver ficha <ExternalLink className="h-3 w-3" />
                      </Link>
                    </div>
                    <dl className="mt-2 grid gap-x-3 gap-y-1 text-[11px] sm:grid-cols-2">
                      <Dato etiqueta="RUC / CI" valor={c.ruc} />
                      <Dato etiqueta="Teléfono" valor={c.telefono} />
                      <Dato etiqueta="Email" valor={c.email} />
                      <Dato etiqueta="Ciudad" valor={c.ciudad} />
                    </dl>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div className={`rounded-lg border px-2 py-1.5 ${c.deuda > 0 ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`}>
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">Deuda</p>
                        <p className={`text-xs font-bold tabular-nums ${c.deuda > 0 ? "text-rose-700" : "text-emerald-700"}`}>{gs(c.deuda)}</p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-white px-2 py-1.5">
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">Suscripción</p>
                        {c.suscripciones.length ? (
                          <p className="truncate text-xs font-semibold text-slate-800" title={c.suscripciones.map((s) => s.plan_nombre).join(", ")}>
                            {c.suscripciones[0].plan_nombre}
                            <span className="font-normal text-slate-500"> · {c.suscripciones[0].moneda === "USD" ? usd(c.suscripciones[0].precio) : gs(c.suscripciones[0].precio)}</span>
                            {c.suscripciones.length > 1 ? <span className="text-slate-400"> +{c.suscripciones.length - 1}</span> : null}
                          </p>
                        ) : (
                          <p className="text-xs text-slate-400">Sin suscripción activa</p>
                        )}
                      </div>
                    </div>
                    {c.vinculado_ahora ? <p className="mt-1.5 text-[10px] italic text-slate-500">Vinculado por teléfono</p> : null}
                    <button
                      type="button"
                      disabled={!!ocupado}
                      onClick={() => window.confirm("¿Desvincular este cliente del contacto?") && void accion("desvincular", () => vincularCliente(conv.id, null))}
                      className="mt-1.5 text-[10px] font-semibold text-slate-500 underline-offset-2 hover:text-[#3F8E91] hover:underline max-lg:min-h-10 max-lg:text-xs"
                    >
                      No es este cliente
                    </button>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 px-3 py-2.5">
                    <p className="text-[11px] text-slate-500">Sin cliente vinculado (no hay un cliente con este teléfono).</p>
                    <button
                      type="button"
                      onClick={() => setCreandoCliente(true)}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-[#3F8E91] max-lg:min-h-11 max-lg:px-4 max-lg:text-sm"
                    >
                      <UserPlus className="h-3.5 w-3.5" /> Crear cliente
                    </button>
                  </div>
                )}
              </Seccion>

              {c && c.tickets.length ? (
                <Seccion titulo={`Últimos tickets de Soporte (${c.tickets.length})`}>
                  <ul className="flex flex-col gap-1">
                    {c.tickets.map((t) => (
                      <li key={t.id}>
                        <Link href={`/soporte/tickets/${t.id}`} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] hover:border-[#4FAEB2]/50 hover:bg-slate-50 max-lg:min-h-11">
                          <span className="font-mono font-semibold text-slate-700">{numeroTicket(t.numero)}</span>
                          <span className="min-w-0 flex-1 truncate text-slate-600">{t.asunto}</span>
                          <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: `${t.estado_color ?? "#94a3b8"}22`, color: t.estado_color ?? "#475569" }}>
                            {t.estado_nombre}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Seccion>
              ) : null}

              {c?.ultima_tipificacion ? (
                <Seccion titulo="Última tipificación del cliente">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="text-xs font-semibold text-slate-800">
                      {c.ultima_tipificacion.tipo_gestion}
                      <span className="font-normal text-slate-500"> · {c.ultima_tipificacion.resultado}</span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {fechaHoraPy(c.ultima_tipificacion.fecha)} · {c.ultima_tipificacion.usuario}
                    </p>
                    {c.ultima_tipificacion.observacion ? <p className="mt-1 line-clamp-3 text-[11px] text-slate-600">{c.ultima_tipificacion.observacion}</p> : null}
                  </div>
                </Seccion>
              ) : null}

              {/* CRM */}
              <Seccion titulo="CRM">
                {p ? (
                  <div className="rounded-xl border border-violet-200 bg-violet-50/60 px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-mono text-[11px] font-semibold text-violet-700">{p.numero_control}</p>
                        <p className="truncate text-xs font-semibold text-slate-800">{p.empresa || p.contacto}</p>
                      </div>
                      <Link href={`/crm?p=${p.id}`} className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-violet-700 hover:underline max-lg:-my-2 max-lg:min-h-10 max-lg:text-xs">
                        Ver en CRM <ExternalLink className="h-3 w-3" />
                      </Link>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-600">
                      Etapa: <span className="font-semibold">{p.etapa_nombre ?? p.etapa}</span>
                      {p.valor_estimado ? ` · ${gs(p.valor_estimado)}` : ""}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 px-3 py-2.5">
                    <p className="text-[11px] text-slate-500">Este contacto no es prospecto del CRM.</p>
                    <button
                      type="button"
                      disabled={!!ocupado}
                      onClick={() => void accion("prospecto", async () => (await crearProspecto(conv.id)).fila)}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-50 max-lg:min-h-11 max-lg:px-4 max-lg:text-sm"
                    >
                      <Sparkles className="h-3.5 w-3.5" /> {ocupado === "prospecto" ? "Creando…" : "Crear prospecto en CRM"}
                    </button>
                  </div>
                )}
              </Seccion>
            </div>
          )}
        </>
  );

  // Celular / tablet: hoja (z por debajo de los modales, para que "Crear cliente" quede arriba).
  if (!escritorio) {
    return (
      <>
        <HojaInferior titulo="Ficha del contacto" onClose={onCerrar} z="z-[48]" ancho="sm:max-w-lg">
          {cuerpo}
        </HojaInferior>
        {nuevoCliente}
      </>
    );
  }

  return (
    <>
      <button type="button" aria-label="Cerrar ficha" onClick={onCerrar} className="absolute inset-0 z-20 cursor-default bg-slate-900/10" />
      <aside
        role="dialog"
        aria-label="Ficha del contacto"
        className="absolute inset-y-0 right-0 z-30 flex w-[min(26rem,92%)] flex-col border-l border-slate-200 bg-white shadow-2xl"
        style={{ animation: "drawer-in 0.2s cubic-bezier(0.16,1,0.3,1)" }}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Ficha del contacto</h2>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{cuerpo}</div>
      </aside>
      {nuevoCliente}
    </>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{titulo}</h3>
      {children}
    </section>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string | null }) {
  if (!valor) return null;
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-slate-400">{etiqueta}</dt>
      <dd className="truncate text-[11px] text-slate-700" title={valor}>{valor}</dd>
    </div>
  );
}

function BotonCopiar({ valor }: { valor: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard
          ?.writeText(valor)
          .then(() => {
            setCopiado(true);
            setTimeout(() => setCopiado(false), 1200);
          })
          .catch(() => undefined)
      }
      title="Copiar número"
      className="text-[10px] font-semibold text-slate-400 transition-colors hover:text-[#3F8E91] max-lg:-my-2 max-lg:min-h-10 max-lg:px-2 max-lg:text-xs"
    >
      {copiado ? "copiado" : "copiar"}
    </button>
  );
}
