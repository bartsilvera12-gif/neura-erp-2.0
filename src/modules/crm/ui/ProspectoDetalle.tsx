"use client";

/**
 * Detalle del prospecto (modal desde el tablero o página /crm/[id]): etapa del funnel,
 * datos editables, timeline de notas (se cargan recién al abrir), "Transformar a cliente"
 * y eliminar. Los cambios se avisan al tablero para que se actualice sin recargar todo.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRightLeft, Loader2, Mail, MessageCircle, Phone, StickyNote, Trash2, Users } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { apiFetchCache } from "@/lib/api/cache-cliente";
import { fechaHora } from "@/modules/clientes/ui";
import { ORIGEN_LABEL, tonoEtapa, type Etapa, type Nota, type Prospecto, type Tarjeta } from "@/modules/crm/tipos";
import { BTN_PRIMARIO, INPUT, LABEL, ModalGrande, SectionTitle } from "./comun";
import { ProspectoForm } from "./ProspectoForm";
import { ConvertirClienteModal, MotivoPerdidaModal, type Convertido } from "./Modales";

const TIPOS_NOTA: { v: Nota["tipo"]; t: string; I: typeof StickyNote }[] = [
  { v: "nota", t: "Nota", I: StickyNote },
  { v: "llamada", t: "Llamada", I: Phone },
  { v: "whatsapp", t: "WhatsApp", I: MessageCircle },
  { v: "email", t: "Email", I: Mail },
  { v: "reunion", t: "Reunión", I: Users },
];

export type MovidoResp = { updated_at?: string; sin_cambios?: boolean };

export function ProspectoDetalle({
  id, variant, etapas: etapasProp, onClose, onMovido, onGuardado, onEliminado, onConvertido,
}: {
  id: string;
  variant: "modal" | "page";
  etapas?: Etapa[];
  onClose: () => void;
  onMovido?: (antes: Tarjeta, etapa: string, r: MovidoResp & { motivo?: string | null }) => void;
  onGuardado?: (p: Prospecto) => void;
  onEliminado?: (id: string) => void;
  onConvertido?: (antes: Tarjeta, r: Convertido) => void;
}) {
  const [p, setP] = useState<Prospecto | null>(null);
  const [notas, setNotas] = useState<Nota[]>([]);
  const [estado, setEstado] = useState<"cargando" | "ok" | "no">("cargando");
  const [etapas, setEtapas] = useState<Etapa[]>(etapasProp ?? []);
  const [moviendo, setMoviendo] = useState<string | null>(null);
  const [pideMotivo, setPideMotivo] = useState<string | null>(null);
  const [convirtiendo, setConvirtiendo] = useState(false);
  const [confirmarEliminar, setConfirmarEliminar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [nuevaNota, setNuevaNota] = useState("");
  const [tipoNota, setTipoNota] = useState<Nota["tipo"]>("nota");
  const [guardandoNota, setGuardandoNota] = useState(false);
  const notaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let vivo = true;
    setEstado("cargando");
    apiFetch<{ prospecto: Prospecto; notas: Nota[] }>(`/api/crm/${id}`)
      .then((r) => { if (vivo) { setP(r.prospecto); setNotas(r.notas); setEstado("ok"); } })
      .catch(() => vivo && setEstado("no"));
    return () => { vivo = false; };
  }, [id]);

  useEffect(() => {
    if (etapasProp?.length) { setEtapas(etapasProp); return; }
    apiFetchCache<Etapa[]>("/api/crm/etapas?activas=1").then(setEtapas).catch(() => {});
  }, [etapasProp]);

  const recargarNotas = useCallback(() => {
    apiFetch<Nota[]>(`/api/crm/${id}/notas`).then(setNotas).catch(() => {});
  }, [id]);

  async function ejecutarMover(codigo: string, motivo: string | null) {
    if (!p) return;
    setMoviendo(codigo);
    setError(null);
    try {
      const r = await apiFetch<MovidoResp>(`/api/crm/${p.id}/mover`, { method: "POST", body: JSON.stringify({ etapa: codigo, motivo }) });
      const antes = p;
      const ahora = r.updated_at ?? new Date().toISOString();
      setP({ ...p, etapa: codigo, updated_at: ahora, etapa_desde: ahora, motivo_perdida: motivo ?? p.motivo_perdida });
      onMovido?.(antes, codigo, { ...r, motivo });
      recargarNotas();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setMoviendo(null);
    }
  }

  function moverA(codigo: string) {
    if (!p || p.etapa === codigo || moviendo) return;
    const e = etapas.find((x) => x.codigo === codigo);
    if (e?.es_perdido) setPideMotivo(codigo);
    else void ejecutarMover(codigo, null);
  }

  async function agregarNota(e?: React.FormEvent) {
    e?.preventDefault();
    if (!nuevaNota.trim() || guardandoNota) return;
    setGuardandoNota(true);
    try {
      const n = await apiFetch<Nota>(`/api/crm/${id}/notas`, { method: "POST", body: JSON.stringify({ texto: nuevaNota.trim(), tipo: tipoNota }) });
      setNotas((prev) => [n, ...prev]);
      setNuevaNota("");
      setTimeout(() => notaRef.current?.focus(), 0);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardandoNota(false);
    }
  }

  async function eliminar() {
    try {
      await apiFetch(`/api/crm/${id}`, { method: "DELETE" });
      onEliminado?.(id);
    } catch (err) {
      setError((err as Error).message);
      setConfirmarEliminar(false);
    }
  }

  const etapaActual = etapas.find((e) => e.codigo === p?.etapa);
  const tonoActual = tonoEtapa(etapaActual?.color);
  const badgeEtapa = etapaActual ? (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tonoActual.badge}`}>{etapaActual.nombre}</span>
  ) : null;
  const botonTransformar = p && !p.cliente_id ? (
    <button type="button" onClick={() => setConvirtiendo(true)} className="rounded-xl bg-[var(--brand)] px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[var(--brand-600)]">
      Transformar a cliente
    </button>
  ) : null;

  let cuerpo: React.ReactNode;
  if (estado === "cargando") {
    cuerpo = (
      <div className="flex h-full items-center justify-center gap-3 py-16 text-sm text-slate-500">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--brand)]" /> Cargando prospecto…
      </div>
    );
  } else if (estado === "no" || !p) {
    cuerpo = (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
        <h2 className="text-lg font-semibold text-slate-800">Prospecto no encontrado</h2>
        <button onClick={onClose} className="text-sm font-medium text-[var(--brand)] hover:underline">← Volver</button>
      </div>
    );
  } else {
    cuerpo = (
      <div className={variant === "modal" ? "h-full space-y-5 overflow-y-auto bg-slate-50/50 px-6 py-5" : "space-y-5"}>
        {confirmarEliminar ? (
          <div className="flex items-center justify-between gap-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
            <p className="text-sm font-medium text-rose-700">¿Eliminar permanentemente este prospecto y sus notas?</p>
            <div className="flex shrink-0 gap-2">
              <button onClick={eliminar} className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700">Sí, eliminar</button>
              <button onClick={() => setConfirmarEliminar(false)} className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-100">Cancelar</button>
            </div>
          </div>
        ) : null}
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">⚠ {error}</div> : null}
        {okMsg ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">✓ {okMsg}</div> : null}

        {/* Etapa del funnel */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <SectionTitle>Etapa del funnel</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {etapas.map((e) => {
              const t = tonoEtapa(e.color);
              const activa = p.etapa === e.codigo;
              return (
                <button key={e.codigo} type="button" onClick={() => moverA(e.codigo)} disabled={!!moviendo}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all ${
                    activa ? `${t.badge} ring-2 ring-[var(--brand)]/30 ring-offset-1` : "border-slate-200 bg-white text-slate-600 hover:border-[var(--brand)]/60 hover:text-[var(--brand)]"
                  }`}>
                  {moviendo === e.codigo ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />}
                  {e.nombre}
                </button>
              );
            })}
          </div>
          {etapaActual?.es_perdido && p.motivo_perdida ? (
            <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700"><strong>Motivo:</strong> {p.motivo_perdida}</p>
          ) : null}
          {p.cliente_id ? (
            <div className="mt-3 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5">
              <p className="text-sm font-medium text-emerald-700">✓ Cliente creado</p>
              <Link href={`/clientes/${p.cliente_id}`} className="text-sm font-semibold text-emerald-700 underline hover:text-emerald-900">Ver cliente →</Link>
            </div>
          ) : etapaActual?.es_ganado ? (
            <div className="mt-3 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5">
              <p className="text-sm font-medium text-emerald-700">✓ Oportunidad ganada</p>
              <button type="button" onClick={() => setConvirtiendo(true)} className="text-sm font-semibold text-emerald-700 underline hover:text-emerald-900">Crear cliente →</button>
            </div>
          ) : null}
        </section>

        {/* Datos */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3 text-sm text-slate-600">
            <span><span className="font-semibold text-slate-700">Origen:</span> {ORIGEN_LABEL[p.origen_creacion] ?? "—"}{p.origen_detalle ? ` · ${p.origen_detalle}` : ""}</span>
            <span className="text-xs text-slate-400">Creado {fechaHora(p.created_at)}</span>
          </div>
          <ProspectoForm
            key={p.id}
            modo="editar"
            variant="page"
            prospecto={p}
            etapas={etapas}
            onGuardado={({ prospecto }) => {
              if (!prospecto) return;
              setP(prospecto);
              setOkMsg("Cambios guardados");
              setTimeout(() => setOkMsg(null), 2500);
              onGuardado?.(prospecto);
            }}
          />
        </section>

        {/* Notas */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <SectionTitle>Notas internas ({notas.length})</SectionTitle>
          <form onSubmit={agregarNota} className="mb-5">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {TIPOS_NOTA.map(({ v, t, I }) => (
                <button key={v} type="button" onClick={() => setTipoNota(v)}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${tipoNota === v ? "border-[var(--brand)]/50 bg-[var(--brand-50)] text-[var(--brand-700)]" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                  <I className="h-3 w-3" /> {t}
                </button>
              ))}
            </div>
            <label className={LABEL}>Nueva nota</label>
            <textarea
              ref={notaRef}
              value={nuevaNota}
              onChange={(e) => setNuevaNota(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void agregarNota(); } }}
              rows={3}
              placeholder="Escribí una nota interna (Ctrl+Enter para guardar rápido)…"
              className={`${INPUT} mb-3 resize-none`}
            />
            <button type="submit" disabled={!nuevaNota.trim() || guardandoNota} className={BTN_PRIMARIO}>{guardandoNota ? "Agregando…" : "Agregar nota"}</button>
          </form>
          {notas.length === 0 ? (
            <p className="text-sm italic text-slate-400">No hay notas registradas aún.</p>
          ) : (
            <ol className="relative space-y-3 border-l border-slate-200 pl-4">
              {notas.map((n) => {
                const auto = n.tipo === "cambio_etapa" || n.tipo === "sistema";
                const tipo = TIPOS_NOTA.find((x) => x.v === n.tipo);
                const Icono = auto ? ArrowRightLeft : (tipo?.I ?? StickyNote);
                return (
                  <li key={n.id} className="relative">
                    <span className={`absolute -left-[25px] top-3 flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-white ${auto ? "bg-slate-200 text-slate-500" : "bg-[var(--brand)] text-white"}`}>
                      <Icono className="h-2.5 w-2.5" />
                    </span>
                    <div className={`rounded-xl border px-4 py-3 ${auto ? "border-slate-100 bg-slate-50" : "border-slate-200 bg-white shadow-sm"}`}>
                      <p className={`whitespace-pre-wrap text-sm ${auto ? "text-slate-500" : "text-slate-700"}`}>{n.texto}</p>
                      <p className="mt-2 text-xs text-slate-400">
                        {tipo && !auto && n.tipo !== "nota" ? `${tipo.t} · ` : ""}{n.usuario_nombre ? `${n.usuario_nombre} · ` : ""}{fechaHora(n.created_at)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <div className="flex justify-end">
          <button type="button" onClick={() => setConfirmarEliminar(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-medium text-rose-600 shadow-sm transition-colors hover:bg-rose-50">
            <Trash2 className="h-4 w-4" /> Eliminar prospecto
          </button>
        </div>
      </div>
    );
  }

  const modales = p ? (
    <>
      {pideMotivo ? (
        <MotivoPerdidaModal
          etapaNombre={etapas.find((e) => e.codigo === pideMotivo)?.nombre ?? "Perdido"}
          prospecto={p.empresa || p.contacto}
          onCancel={() => setPideMotivo(null)}
          onConfirm={(m) => { const c = pideMotivo; setPideMotivo(null); void ejecutarMover(c, m); }}
        />
      ) : null}
      {convirtiendo ? (
        <ConvertirClienteModal
          prospecto={p}
          onClose={() => setConvirtiendo(false)}
          onConvertido={(r) => {
            setConvirtiendo(false);
            const antes = p;
            setP({ ...p, cliente_id: r.cliente_id, etapa: r.etapa ?? p.etapa, updated_at: r.updated_at ?? p.updated_at, etapa_desde: r.etapa_desde ?? p.etapa_desde });
            onConvertido?.(antes, r);
            recargarNotas();
          }}
        />
      ) : null}
    </>
  ) : null;

  if (variant === "modal") {
    return (
      <ModalGrande
        eyebrow="Editar"
        titulo={p?.empresa || p?.contacto || "Prospecto"}
        subtitulo={p ? <><span className="font-mono text-xs text-slate-400">{p.numero_control}</span>{badgeEtapa}</> : null}
        extra={botonTransformar}
        onClose={onClose}
      >
        {cuerpo}
        {modales}
      </ModalGrande>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/crm" className="mb-2 inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600">← CRM Funnel</Link>
          <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-900">{p?.empresa || p?.contacto || "Prospecto"}</h1>
          {p ? <div className="mt-1 flex items-center gap-2"><span className="font-mono text-sm text-slate-400">{p.numero_control}</span>{badgeEtapa}</div> : null}
        </div>
        {botonTransformar}
      </div>
      {cuerpo}
      {modales}
    </div>
  );
}
