"use client";

/**
 * Contrato de alquiler (receta 133), en panel lateral. Nuevo: propiedad (las de alquiler disponibles),
 * inquilino, alquiler, día de vencimiento, inicio, duración, garantía, aumento y comisión (si es de un
 * dueño). Abierto: sus cuotas (cobrado, saldo, liquidada), "Emitir el mes" y terminar o rescindir.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Loader2, ReceiptText, X } from "lucide-react";
import { Drawer } from "@/components/Drawer";
import { Select } from "@/components/Select";
import { SelectorFecha } from "@/components/SelectorFecha";
import { apiFetch } from "@/lib/api/client-fetch";
import { BuscadorCliente } from "@/modules/clientes/gestion/BuscadorCliente";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, ET, INPUT } from "@/modules/inventario/ui";
import type { Contrato, ListaPropiedades, TipoIvaPropiedad } from "@/modules/inmobiliaria/tipos";

const gs = (n: number | null | undefined) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;
const hoy = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const CHIP: Record<string, string> = {
  pagada: "bg-emerald-50 text-emerald-800", parcial: "bg-amber-50 text-amber-800", pendiente: "bg-slate-100 text-slate-600", anulada: "bg-slate-100 text-slate-400 line-through",
};

function Campo({ label, children, ancho }: { label: string; children: ReactNode; ancho?: boolean }) {
  return <div className={`min-w-0 ${ancho ? "sm:col-span-2" : ""}`}><span className={ET}>{label}</span>{children}</div>;
}

function Monto({ valor, onChange }: { valor: number; onChange: (n: number) => void }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">Gs.</span>
      <input inputMode="numeric" className={`${INPUT} pl-10 text-right tabular-nums`} value={valor ? valor.toLocaleString("es-PY") : ""} placeholder="0"
        onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, "")) || 0)} />
    </div>
  );
}

export function FormContrato({ id, puedeEditar, onCerrar, onCambio }: {
  id: string | null;
  puedeEditar: boolean;
  onCerrar: () => void;
  onCambio: (c: Contrato) => void;
}) {
  const [c, setC] = useState<Contrato | null>(null);
  const [cargando, setCargando] = useState(!!id);
  const [props, setProps] = useState<ListaPropiedades["items"]>([]);
  const [propiedadId, setPropiedadId] = useState("");
  const [inquilino, setInquilino] = useState<{ id: string; nombre: string } | null>(null);
  const [monto, setMonto] = useState(0);
  const [iva, setIva] = useState<TipoIvaPropiedad>("5%");
  const [dia, setDia] = useState("10");
  const [inicio, setInicio] = useState(hoy());
  const [meses, setMeses] = useState("24");
  const [garantia, setGarantia] = useState(0);
  const [ajuste, setAjuste] = useState("");
  const [ajusteCada, setAjusteCada] = useState("12");
  const [comision, setComision] = useState("");
  const [notas, setNotas] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargarFicha = (x: Contrato) => {
    setC(x); setPropiedadId(x.propiedad_id); setInquilino({ id: x.inquilino_id, nombre: x.inquilino }); setMonto(Number(x.monto));
    setIva(x.tipo_iva); setDia(String(x.dia_vencimiento)); setInicio(x.fecha_inicio); setMeses(x.meses ? String(x.meses) : "");
    setGarantia(Number(x.garantia)); setAjuste(Number(x.ajuste_pct) ? String(Number(x.ajuste_pct)) : ""); setAjusteCada(String(x.ajuste_cada_meses));
    setComision(x.propietario_id ? String(Number(x.comision_pct)) : ""); setNotas(x.notas ?? "");
  };

  useEffect(() => {
    if (!id) return;
    apiFetch<Contrato>(`/api/inmobiliaria/alquileres/${id}`).then(cargarFicha).catch((e: Error) => setError(e.message)).finally(() => setCargando(false));
  }, [id]);
  useEffect(() => {
    apiFetch<ListaPropiedades>("/api/inmobiliaria/propiedades?gestion=alquiler&limite=200").then((l) => setProps(l.items)).catch(() => setProps([]));
  }, []);

  const elegida = props.find((p) => p.id === propiedadId);
  const opcionesProp: [string, string][] = useMemo(() => {
    const libres = props.filter((p) => p.estado === "disponible" || p.estado === "reservada" || p.id === c?.propiedad_id);
    const o = libres.map((p) => [p.id, `${p.codigo} · ${p.titulo}`] as [string, string]);
    if (c && !o.some(([k]) => k === c.propiedad_id)) o.unshift([c.propiedad_id, `${c.propiedad_codigo} · ${c.propiedad}`]);
    return [["", "Elegí la propiedad"], ...o];
  }, [props, c]);
  const tieneCuotas = !!c?.cuotas.some((q) => q.estado !== "anulada");
  const editable = puedeEditar && (!c || c.estado === "vigente");
  const deDueno = elegida ? !elegida.propia : !!c?.propietario_id;

  async function guardar() {
    if (!propiedadId) { setError("Elegí la propiedad."); return; }
    if (!inquilino) { setError("Elegí el inquilino."); return; }
    setEnviando(true); setError(null); setAviso(null);
    try {
      const x = await apiFetch<Contrato>(id ? `/api/inmobiliaria/alquileres/${id}` : "/api/inmobiliaria/alquileres", {
        method: id ? "PUT" : "POST",
        body: JSON.stringify({
          propiedad_id: propiedadId, inquilino_id: inquilino.id, monto, tipo_iva: iva, dia_vencimiento: parseInt(dia) || 10, fecha_inicio: inicio,
          meses: parseInt(meses) || null, garantia, ajuste_pct: Number(ajuste.replace(",", ".")) || 0, ajuste_cada_meses: parseInt(ajusteCada) || 12,
          comision_pct: deDueno && comision ? Number(comision.replace(",", ".")) : null, notas: notas.trim() || null,
        }),
      });
      cargarFicha(x); onCambio(x); setAviso(id ? "Contrato guardado." : `Contrato ${x.numero} creado: la propiedad quedó alquilada.`);
    } catch (e) { setError((e as Error).message); } finally { setEnviando(false); }
  }

  async function emitir() {
    if (!c) return;
    setEnviando(true); setError(null); setAviso(null);
    try {
      const r = await apiFetch<{ numero_control: string; monto: number; mes: string }>(`/api/inmobiliaria/alquileres/${c.id}/emitir`, { method: "POST", body: "{}" });
      const x = await apiFetch<Contrato>(`/api/inmobiliaria/alquileres/${c.id}`);
      cargarFicha(x); onCambio(x); setAviso(`Alquiler de ${r.mes} emitido (${r.numero_control}, ${gs(r.monto)}): ya está en Cuentas a cobrar.`);
    } catch (e) { setError((e as Error).message); } finally { setEnviando(false); }
  }

  async function terminar(estado: "finalizado" | "rescindido") {
    if (!c) return;
    setEnviando(true); setError(null);
    try {
      const x = await apiFetch<Contrato>(`/api/inmobiliaria/alquileres/${c.id}`, { method: "PATCH", body: JSON.stringify({ estado }) });
      cargarFicha(x); onCambio(x); setAviso(estado === "finalizado" ? "Contrato terminado: la propiedad volvió a disponible." : "Contrato rescindido: la propiedad volvió a disponible.");
    } catch (e) { setError((e as Error).message); } finally { setEnviando(false); }
  }

  return (
    <Drawer
      titulo={c ? `${c.numero} · ${c.propiedad}` : "Nuevo contrato de alquiler"}
      subtitulo={c ? `${c.inquilino} · ${c.estado === "vigente" ? "Vigente" : c.estado === "finalizado" ? "Terminado" : "Rescindido"}${Number(c.deuda) ? ` · debe ${gs(c.deuda)}` : ""}` : "La propiedad queda alquilada y cada mes se emite su cuota."}
      onClose={onCerrar}
      footer={editable ? (
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          {c && c.estado === "vigente" ? (
            <div className="flex gap-2 max-sm:[&>*]:min-h-11 max-sm:[&>*]:flex-1">
              <button type="button" disabled={enviando} onClick={() => void terminar("finalizado")} className={BOTON_SECUNDARIO}>Terminar</button>
              <button type="button" disabled={enviando} onClick={() => void terminar("rescindido")} className={`${BOTON_SECUNDARIO} text-rose-600`}>Rescindir</button>
            </div>
          ) : <span />}
          <div className="flex gap-2 max-sm:[&>*]:min-h-11 max-sm:[&>*]:flex-1">
            <button type="button" onClick={onCerrar} disabled={enviando} className={BOTON_SECUNDARIO}>Cerrar</button>
            <button type="button" onClick={() => void guardar()} disabled={enviando || cargando} className={`${BOTON_PRIMARIO} bg-[var(--brand)]`}>
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar
            </button>
          </div>
        </div>
      ) : <button type="button" onClick={onCerrar} className={`${BOTON_SECUNDARIO} max-sm:min-h-11 max-sm:w-full`}>Cerrar</button>}
    >
      {cargando ? <div className="h-40 animate-pulse rounded-xl bg-slate-100" /> : (
        <div className="space-y-6">
          {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
          {aviso ? <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{aviso}</p> : null}

          {c && c.estado === "vigente" && puedeEditar ? (
            <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-600">Este mes: <strong className="text-slate-900">{gs(c.monto_actual)}</strong>, vence el día {c.dia_vencimiento}.</p>
              <button type="button" disabled={enviando} onClick={() => void emitir()} className={`${BOTON_PRIMARIO} bg-[var(--brand)] max-sm:min-h-11`}>
                <ReceiptText className="h-4 w-4" /> Emitir el mes
              </button>
            </div>
          ) : null}

          <fieldset disabled={!editable} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Campo label="Propiedad" ancho>
              <Select block value={propiedadId} onChange={(v) => { setPropiedadId(v); const p = props.find((x) => x.id === v); if (p && !monto) setMonto(Number(p.precio_alquiler) || 0); }}
                options={opcionesProp} etiqueta="Propiedad" disabled={!editable || tieneCuotas} />
            </Campo>
            <Campo label="Inquilino" ancho>
              {inquilino ? (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
                  <span className="min-w-0 truncate font-medium text-slate-800">{inquilino.nombre}</span>
                  {editable && !tieneCuotas ? <button type="button" aria-label="Cambiar inquilino" onClick={() => setInquilino(null)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-white hover:text-slate-600"><X className="h-4 w-4" /></button> : null}
                </div>
              ) : <BuscadorCliente variant="toolbar" onSelect={(x) => setInquilino({ id: x.id, nombre: x.nombre })} />}
            </Campo>
            <Campo label="Alquiler por mes"><Monto valor={monto} onChange={setMonto} /></Campo>
            <Campo label="IVA"><Select block value={iva} onChange={(v) => setIva(v as TipoIvaPropiedad)} options={[["5%", "5 %"], ["10%", "10 %"], ["EXENTA", "Exenta"]]} etiqueta="IVA" /></Campo>
            <Campo label="Vence el día">
              <Select block value={dia} onChange={setDia} options={Array.from({ length: 28 }, (_, i) => [String(i + 1), `Día ${i + 1} de cada mes`] as [string, string])} etiqueta="Día de vencimiento" />
            </Campo>
            <Campo label="Inicio"><SelectorFecha value={inicio} onChange={setInicio} etiqueta="Inicio del contrato" /></Campo>
            <Campo label="Duración (meses)"><input inputMode="numeric" className={`${INPUT} text-right tabular-nums`} value={meses} placeholder="Sin fin" onChange={(e) => setMeses(e.target.value.replace(/\D/g, "").slice(0, 3))} /></Campo>
            <Campo label="Garantía"><Monto valor={garantia} onChange={setGarantia} /></Campo>
            <Campo label="Aumento (%)"><input inputMode="decimal" className={`${INPUT} text-right tabular-nums`} value={ajuste} placeholder="0" onChange={(e) => setAjuste(e.target.value.replace(/[^\d.,]/g, "").slice(0, 5))} /></Campo>
            <Campo label="Cada (meses)"><input inputMode="numeric" className={`${INPUT} text-right tabular-nums`} value={ajusteCada} onChange={(e) => setAjusteCada(e.target.value.replace(/\D/g, "").slice(0, 2))} /></Campo>
            {deDueno ? <Campo label="Comisión de la inmobiliaria (%)"><input inputMode="decimal" className={`${INPUT} text-right tabular-nums`} value={comision} placeholder="La de la propiedad" onChange={(e) => setComision(e.target.value.replace(/[^\d.,]/g, "").slice(0, 5))} /></Campo> : null}
            <Campo label="Notas" ancho><textarea className={`${INPUT} min-h-20`} value={notas} maxLength={2000} onChange={(e) => setNotas(e.target.value)} /></Campo>
          </fieldset>

          {c?.cuotas.length ? (
            <section>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Cuotas</h3>
              <ul className="m-0 list-none divide-y divide-slate-100 rounded-xl border border-slate-200 p-0 text-sm">
                {c.cuotas.map((q) => (
                  <li key={q.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block font-medium capitalize text-slate-800">{q.mes}</span>
                      <span className="block text-xs text-slate-500">{q.numero}{q.liquidada ? " · liquidada al dueño" : ""}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${CHIP[q.estado] ?? CHIP.pendiente}`}>{q.estado === "pagada" ? "Cobrada" : q.estado === "parcial" ? "Parcial" : q.estado === "anulada" ? "Anulada" : "Pendiente"}</span>
                      <span className="tabular-nums font-semibold text-slate-900">{gs(q.monto)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}
