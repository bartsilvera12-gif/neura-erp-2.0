"use client";

/**
 * Planes (versión simple de PlanesDesktop del sistema actual): lista con nombre,
 * descripción, precio, moneda, IVA, cuántas suscripciones lo usan y estado; alta y
 * edición en un modal. Solo el administrador crea, edita, desactiva o borra (borrar
 * solo si ninguna suscripción lo usa).
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Tag } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { invalidar } from "@/lib/api/cache-cliente";
import { Modal } from "@/components/Modal";
import { MenuAcciones, type ItemMenu } from "@/components/MenuAcciones";
import { Select } from "@/components/Select";
import { TablaTarjetas, useVistaTarjetas, type ColumnaTabla } from "@/components/TablaResponsive";
import MontoInput from "@/components/ui/MontoInput";
import { PIE_MODAL, TEAL } from "@/modules/clientes/ui";
import type { Moneda, Plan, TipoIva } from "@/modules/clientes/suscripciones/tipos";
import { IVA_LABEL, monto } from "@/modules/clientes/suscripciones/ui";

const INPUT = "w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";
const LABEL = "mb-1 block text-xs font-medium text-slate-600";

export function PanelPlanes({ esAdmin, onCambio }: { esAdmin: boolean; onCambio?: () => void }) {
  const [planes, setPlanes] = useState<Plan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<Plan | "nuevo" | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [aBorrar, setABorrar] = useState<Plan | null>(null);
  const vistaTarjetas = useVistaTarjetas();

  const cargar = useCallback(async () => {
    try {
      setPlanes(await apiFetch<Plan[]>("/api/planes"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setPlanes((p) => p ?? []);
    }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  function listo(msg: string) {
    invalidar("/api/planes");
    setAviso(msg);
    setTimeout(() => setAviso(null), 5000);
    void cargar();
    onCambio?.();
  }

  async function activar(p: Plan, activo: boolean) {
    setError(null);
    try {
      await apiFetch(`/api/planes/${p.id}`, { method: "PATCH", body: JSON.stringify({ activo }) });
      listo(`Plan ${p.nombre} ${activo ? "activado" : "desactivado"}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function borrar(p: Plan) {
    setError(null);
    setABorrar(null);
    try {
      await apiFetch(`/api/planes/${p.id}`, { method: "DELETE" });
      listo(`Plan ${p.nombre} borrado`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function items(p: Plan): ItemMenu[] {
    const l: ItemMenu[] = [{ etiqueta: "Editar", onClick: () => setEditando(p) }];
    l.push(p.activo
      ? { etiqueta: "Desactivar", tono: "peligro", onClick: () => void activar(p, false) }
      : { etiqueta: "Activar", tono: "exito", onClick: () => void activar(p, true) });
    if (!p.suscripciones) l.push({ etiqueta: "Borrar", tono: "peligro", onClick: () => setABorrar(p) });
    return l;
  }

  const activos = planes?.filter((p) => p.activo).length ?? 0;

  // Tabla en ≥ 768 px; en celular, tarjetas (el administrador toca una para editarla).
  const columnas: ColumnaTabla<Plan>[] = [
    {
      key: "plan", titulo: "Plan", movil: "titulo",
      celda: (p) => (
        <>
          <p className="font-semibold text-slate-800">{p.nombre}</p>
          {p.descripcion ? <p className="mt-0.5 max-w-xs truncate text-[11px] font-normal text-slate-400 max-md:max-w-full max-md:whitespace-normal">{p.descripcion}</p> : null}
        </>
      ),
    },
    { key: "precio", titulo: "Precio", movil: "valor", claseTh: "text-right", claseTd: "whitespace-nowrap text-right font-semibold tabular-nums", celda: (p) => <span style={{ color: TEAL }}>{monto(p.precio, p.moneda)}</span> },
    { key: "moneda", titulo: "Moneda", movil: "dato", claseTd: "text-slate-600", celda: (p) => p.moneda },
    { key: "iva", titulo: "IVA", movil: "dato", claseTd: "whitespace-nowrap text-xs text-slate-600", celda: (p) => IVA_LABEL[p.tipo_iva] ?? p.tipo_iva },
    { key: "susc", titulo: "Suscripciones", movil: "dato", claseTd: "tabular-nums text-slate-600", celda: (p) => p.suscripciones ?? 0 },
    {
      key: "estado", titulo: "Estado", movil: "chip",
      celda: (p) => (
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${p.activo ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
          <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${p.activo ? "bg-emerald-500" : "bg-slate-400"}`} />
          {p.activo ? "Activo" : "Inactivo"}
        </span>
      ),
    },
    ...(esAdmin ? [{
      key: "acc", titulo: "Acción", movil: "pie" as const, claseTh: "text-right", claseTd: "text-right",
      celda: (p: Plan) => (
        <MenuAcciones items={items(p)} etiqueta={`Acciones de ${p.nombre}`}
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]">
          Acciones
        </MenuAcciones>
      ),
    }] : []),
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-800">Planes</p>
          <p className="text-xs text-slate-500">
            Lo que cobrás todos los meses (cuota, abono, mantenimiento…). {planes ? `${activos} activo${activos === 1 ? "" : "s"} de ${planes.length}.` : ""}
            {" "}Cambiar el precio de un plan no toca las suscripciones que ya existen.
          </p>
        </div>
        {esAdmin ? (
          <button type="button" onClick={() => setEditando("nuevo")}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:brightness-95 max-sm:min-h-11 max-sm:w-full max-sm:justify-center max-sm:text-sm"
            style={{ backgroundColor: TEAL }}>
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> Nuevo plan
          </button>
        ) : null}
      </div>

      {aviso ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{aviso}</p> : null}
      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {planes === null ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando planes…</div>
        ) : planes.length === 0 ? (
          <div className="py-16 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border" style={{ borderColor: `${TEAL}40`, backgroundColor: `${TEAL}1a`, color: TEAL }}>
              <Tag className="h-5 w-5" />
            </div>
            <p className="text-sm font-semibold text-slate-700">Todavía no hay planes</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">Creá el primero (ej. "Abono mensual", "Cuota social", "Mantenimiento") para poder suscribir clientes.</p>
          </div>
        ) : (
          <TablaTarjetas filas={planes} columnas={columnas} claveFila={(p) => p.id} minAncho={720}
            onFila={esAdmin && vistaTarjetas ? (p) => setEditando(p) : undefined}
            claseFila={(p) => `hover:bg-slate-50/70 ${p.activo ? "" : "opacity-60"}`}
            thBase="whitespace-nowrap px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500" tdBase="px-4 py-3" />
        )}
      </div>

      {aBorrar ? (
        <Modal titulo="Borrar plan" onClose={() => setABorrar(null)}>
          <p className="text-sm text-slate-600">¿Borrar el plan <strong>{aBorrar.nombre}</strong>? Ninguna suscripción lo usa. Si preferís conservarlo, desactivalo.</p>
          <div className={`mt-4 ${PIE_MODAL}`}>
            <button type="button" onClick={() => setABorrar(null)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Volver</button>
            <button type="button" onClick={() => void borrar(aBorrar)} className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700">Borrar plan</button>
          </div>
        </Modal>
      ) : null}
      {editando ? (
        <ModalPlan plan={editando === "nuevo" ? null : editando} onClose={() => setEditando(null)}
          onGuardado={(m) => { setEditando(null); listo(m); }} />
      ) : null}
    </div>
  );
}

function ModalPlan({ plan, onClose, onGuardado }: { plan: Plan | null; onClose: () => void; onGuardado: (mensaje: string) => void }) {
  const [nombre, setNombre] = useState(plan?.nombre ?? "");
  const [descripcion, setDescripcion] = useState(plan?.descripcion ?? "");
  const [precio, setPrecio] = useState<number | "">(plan ? Number(plan.precio) : "");
  const [moneda, setMoneda] = useState<Moneda>(plan?.moneda ?? "GS");
  const [iva, setIva] = useState<TipoIva>(plan?.tipo_iva ?? "10%");
  const [activo, setActivo] = useState(plan?.activo ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) { setError("El nombre es obligatorio"); return; }
    if (precio === "" || Number(precio) < 0) { setError("Indicá el precio"); return; }
    setBusy(true);
    setError(null);
    const body = JSON.stringify({ nombre: nombre.trim(), descripcion: descripcion.trim() || null, precio: Number(precio), moneda, tipo_iva: iva, activo });
    try {
      if (plan) await apiFetch(`/api/planes/${plan.id}`, { method: "PATCH", body });
      else await apiFetch("/api/planes", { method: "POST", body });
      onGuardado(plan ? `Plan ${nombre.trim()} guardado` : `Plan ${nombre.trim()} creado`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal titulo={plan ? "Editar plan" : "Nuevo plan"} onClose={() => { if (!busy) onClose(); }} size="lg">
      <form onSubmit={guardar} className="space-y-4">
        <label className="block">
          <span className={LABEL}>Nombre</span>
          <input autoFocus className={INPUT} value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={120} placeholder="Ej: Abono mensual, Cuota social, Mantenimiento" />
        </label>
        <label className="block">
          <span className={LABEL}>Descripción (opcional)</span>
          <textarea rows={2} maxLength={500} className={INPUT} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Qué incluye" />
        </label>
        <div className="grid gap-4 sm:grid-cols-3">
          <label>
            <span className={LABEL}>Precio mensual</span>
            <MontoInput value={precio} onChange={(n) => setPrecio(n)} decimals={moneda === "USD"} placeholder="0" className={`${INPUT} tabular-nums`} />
          </label>
          <div>
            <span className={LABEL}>Moneda</span>
            <Select block value={moneda} onChange={(v) => setMoneda(v as Moneda)} etiqueta="Moneda" options={[["GS", "Guaraníes (Gs.)"], ["USD", "Dólares (US$)"]]} />
          </div>
          <div>
            <span className={LABEL}>IVA</span>
            <Select block value={iva} onChange={(v) => setIva(v as TipoIva)} etiqueta="IVA" options={[["10%", "IVA 10%"], ["5%", "IVA 5%"], ["exenta", "Exenta"]]} />
          </div>
        </div>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 sm:min-h-0">
          <input type="checkbox" className="h-4 w-4 accent-[var(--brand)]" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
          <span className="text-sm text-slate-700">Activo <span className="text-xs text-slate-500">(se puede elegir en suscripciones nuevas)</span></span>
        </label>
        {plan && plan.suscripciones ? (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Lo usan {plan.suscripciones} suscripción{plan.suscripciones === 1 ? "" : "es"}: cada una mantiene su precio. Para cambiárselo, usá "Cambiar plan" en la ficha del cliente.
          </p>
        ) : null}
        {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
        <div className={PIE_MODAL}>
          <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
          <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-50" style={{ backgroundColor: TEAL }}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {busy ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
