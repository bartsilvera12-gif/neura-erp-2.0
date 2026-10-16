"use client";

/**
 * Alta de proyecto (modal del tablero, página /proyectos/nuevo y "+ Nuevo proyecto" de la
 * ficha del cliente). Núcleo genérico del formulario del actual: título, cliente,
 * descripción, responsables comercial / técnico / PM, prioridad, fechas, monto y archivos
 * (se suben a la pestaña Archivos al crear). Sin los campos de fábrica de software.
 */
import { useMemo, useState } from "react";
import { Select } from "@/components/Select";
import MontoInput from "@/components/ui/MontoInput";
import { apiFetch } from "@/lib/api/client-fetch";
import { hoyPY } from "@/lib/fecha/paraguay";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import { ClienteSelect, type ClienteOpcion } from "@/modules/agenda/ui/components/ClienteSelect";
import ZonaArchivos from "@/modules/soporte/detalle/ZonaArchivos";
import { PRIORIDADES, PRIORIDAD_LABEL, localAIso, type Prioridad, type Tarjeta } from "@/modules/proyectos/tipos";
import { BTN_PRIMARIO, BTN_SECUNDARIO, INPUT, LABEL, PANEL, TituloPanel, useUsuarios } from "./comun";
import { subirArchivos } from "./api";

export function ProyectoForm({ variant, clienteInicial, onCreado, onCancel }: {
  variant: "modal" | "page";
  clienteInicial?: ClienteOpcion | null;
  onCreado: (t: Tarjeta, avisos: string[]) => void;
  onCancel?: () => void;
}) {
  const me = useUsuario();
  const usuarios = useUsuarios();
  const [titulo, setTitulo] = useState("");
  const [cliente, setCliente] = useState<ClienteOpcion | null>(clienteInicial ?? null);
  const [descripcion, setDescripcion] = useState("");
  const [prioridad, setPrioridad] = useState<Prioridad>("normal");
  const [comercial, setComercial] = useState<string | null>(null); // null = yo (hasta que elija)
  const [tecnico, setTecnico] = useState("");
  const [pm, setPm] = useState("");
  const [ingreso, setIngreso] = useState(hoyPY());
  const [prometida, setPrometida] = useState("");
  const [montoV, setMontoV] = useState(0);
  const [moneda, setMoneda] = useState<"GS" | "USD">("GS");
  const [archivos, setArchivos] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [progreso, setProgreso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const opciones = useMemo<[string, string][]>(() => [["", "— Sin asignar —"], ...usuarios.map((u) => [u.id, u.nombre] as [string, string])], [usuarios]);
  const comercialValor = comercial ?? me?.usuarioId ?? "";

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!titulo.trim()) return setError("Poné un título al proyecto.");
    if (prometida && !localAIso(prometida)) return setError("La fecha prometida no es válida.");
    setSaving(true);
    try {
      const t = await apiFetch<Tarjeta>("/api/proyectos", {
        method: "POST",
        body: JSON.stringify({
          titulo: titulo.trim(),
          descripcion: descripcion.trim() || null,
          cliente_id: cliente?.id ?? null,
          prioridad,
          responsable_comercial_id: comercialValor || null,
          responsable_tecnico_id: tecnico || null,
          project_manager_id: pm || null,
          fecha_ingreso: ingreso || null,
          fecha_prometida: prometida ? localAIso(prometida) : null,
          monto_vendido: montoV || 0,
          moneda,
        }),
      });
      const avisos: string[] = [];
      if (archivos.length) {
        setProgreso(`Subiendo archivos 0/${archivos.length}…`);
        const r = await subirArchivos(t.id, archivos, { alAvanzar: (h, n) => setProgreso(`Subiendo archivos ${h}/${n}…`) });
        if (r.errores.length) avisos.push(`El proyecto se creó, pero no se subieron: ${r.errores.join(" · ")}`);
      }
      onCreado(t, avisos);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
      setProgreso(null);
    }
  }

  const isModal = variant === "modal";
  const seccion = isModal ? PANEL : "";

  return (
    <form onSubmit={guardar} className={isModal ? "flex min-h-0 flex-1 flex-col" : "space-y-6 rounded-2xl border border-[var(--brand)]/45 bg-white p-6 shadow-sm"}>
      <div className={isModal ? "min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-slate-50/50 px-3 py-4 sm:space-y-5 sm:px-6 sm:py-5" : "space-y-6"}>
        <section className={seccion}>
          <TituloPanel>Datos generales</TituloPanel>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className={LABEL}>Título <span className="text-rose-500">*</span></span>
              <input autoFocus value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={200} placeholder="Nombre del proyecto" className={INPUT} />
            </label>
            <div className="sm:col-span-2">
              <span className={LABEL}>Cliente</span>
              <ClienteSelect valor={cliente} onChange={setCliente} />
              {!cliente ? <p className="mt-1 text-[11px] text-amber-700">Sin cliente asignado el proyecto no aparece en la ficha de ningún cliente.</p> : null}
            </div>
            <label className="block sm:col-span-2">
              <span className={LABEL}>Descripción</span>
              <textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={4} maxLength={8000}
                placeholder="Contanos qué necesita el cliente: alcance, entregables, acuerdos…" className={`${INPUT} min-h-[96px] resize-y`} />
            </label>
            <div>
              <span className={LABEL}>Prioridad</span>
              <Select block value={prioridad} onChange={(v) => setPrioridad(v as Prioridad)} options={PRIORIDADES.map((p) => [p, PRIORIDAD_LABEL[p]] as [string, string])} />
            </div>
            <label className="block">
              <span className={LABEL}>Fecha de ingreso</span>
              <input type="date" value={ingreso} onChange={(e) => setIngreso(e.target.value)} className={INPUT} />
            </label>
            <label className="block">
              <span className={LABEL}>Fecha prometida</span>
              <input type="datetime-local" value={prometida} onChange={(e) => setPrometida(e.target.value)} className={INPUT} />
              <span className="mt-1 block text-[11px] text-slate-400">Si no la sabés todavía, queda &quot;A definir&quot; en la tarjeta.</span>
            </label>
            <div>
              <span className={LABEL}>Monto vendido</span>
              <div className="flex gap-2">
                <MontoInput value={montoV} onChange={setMontoV} decimals={moneda === "USD"} className={`${INPUT} tabular-nums`} />
                <Select value={moneda} onChange={(v) => setMoneda(v as "GS" | "USD")} options={[["GS", "Gs."], ["USD", "US$"]]} minWidth={92} />
              </div>
            </div>
          </div>
        </section>

        <section className={seccion}>
          <TituloPanel>Responsables</TituloPanel>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <span className={LABEL}>Comercial</span>
              <Select block value={comercialValor} onChange={setComercial} options={opciones} />
            </div>
            <div>
              <span className={LABEL}>Técnico</span>
              <Select block value={tecnico} onChange={setTecnico} options={opciones} />
            </div>
            <div>
              <span className={LABEL}>Project Manager</span>
              <Select block value={pm} onChange={setPm} options={opciones} />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">El técnico y el PM reciben un aviso. Ellos (y un administrador) mueven el proyecto de estado.</p>
        </section>

        <section className={seccion}>
          <TituloPanel>Archivos <span className="font-normal text-slate-400">(opcional)</span></TituloPanel>
          <div className="mt-4">
            <ZonaArchivos archivos={archivos} onCambio={setArchivos} compacta deshabilitada={saving} />
          </div>
        </section>

        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</div> : null}
      </div>

      <div className={isModal ? "flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-white px-4 py-3 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-sm:[&>*]:flex-1 sm:px-6 sm:py-4" : "flex flex-wrap items-center justify-end gap-2 pt-2"}>
        {progreso ? <span className="mr-auto text-xs text-slate-500">{progreso}</span> : null}
        {onCancel ? <button type="button" onClick={onCancel} className={BTN_SECUNDARIO} disabled={saving}>Cancelar</button> : null}
        <button type="submit" disabled={saving || !titulo.trim()} className={BTN_PRIMARIO}>{saving ? "Creando…" : "Crear proyecto"}</button>
      </div>
    </form>
  );
}
