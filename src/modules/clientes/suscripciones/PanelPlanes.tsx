"use client";

/**
 * Planes (versión simple de PlanesDesktop del sistema actual): lista con nombre,
 * descripción, precio, moneda, IVA, cuántas suscripciones lo usan y estado; alta y
 * edición en un modal. Solo el administrador crea, edita, desactiva o borra (borrar
 * solo si ninguna suscripción lo usa). Receta 108: cada plan tiene su tipo (para organizarlos y
 * filtrarlos) y su plazo, con el que nace la suscripción: indefinido, un año u otro.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Tag, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { invalidar } from "@/lib/api/cache-cliente";
import { Modal } from "@/components/Modal";
import { MenuAcciones, type ItemMenu } from "@/components/MenuAcciones";
import { Select } from "@/components/Select";
import { TablaTarjetas, useVistaTarjetas, type ColumnaTabla } from "@/components/TablaResponsive";
import MontoInput from "@/components/ui/MontoInput";
import { PIE_MODAL, TEAL } from "@/modules/clientes/ui";
import type { Moneda, Plan, TipoIva, TipoPlan } from "@/modules/clientes/suscripciones/tipos";
import { IVA_LABEL, monto } from "@/modules/clientes/suscripciones/ui";
import { CampoPlazo, textoPlazo } from "@/modules/clientes/suscripciones/CampoPlazo";

const INPUT = "w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";
const LABEL = "mb-1 block text-xs font-medium text-slate-600";

export function PanelPlanes({ esAdmin, onCambio }: { esAdmin: boolean; onCambio?: () => void }) {
  const [planes, setPlanes] = useState<Plan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<Plan | "nuevo" | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [aBorrar, setABorrar] = useState<Plan | null>(null);
  const [tipos, setTipos] = useState<TipoPlan[]>([]);
  const [filtroTipo, setFiltroTipo] = useState("");
  const [viendoTipos, setViendoTipos] = useState(false);
  const vistaTarjetas = useVistaTarjetas();

  const cargar = useCallback(async () => {
    try {
      const [p, t] = await Promise.all([apiFetch<Plan[]>("/api/planes"), apiFetch<TipoPlan[]>("/api/planes/tipos")]);
      setPlanes(p);
      setTipos(t);
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
  // Ordenados por tipo: los del mismo tipo quedan juntos (los sin tipo, al final).
  const visibles = useMemo(() => (planes ?? [])
    .filter((p) => !filtroTipo || (filtroTipo === "__sin__" ? !p.tipo_id : p.tipo_id === filtroTipo))
    .slice()
    .sort((a, b) => Number(!a.tipo_nombre) - Number(!b.tipo_nombre) || (a.tipo_nombre ?? "").localeCompare(b.tipo_nombre ?? "", "es")), [planes, filtroTipo]);

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
    { key: "tipo", titulo: "Tipo", movil: "subtitulo", claseTd: "text-slate-600", celda: (p) => p.tipo_nombre ?? <span className="text-slate-400">Sin tipo</span>, celdaMovil: (p) => p.tipo_nombre },
    { key: "plazo", titulo: "Plazo", movil: "dato", claseTd: "whitespace-nowrap text-slate-600", celda: (p) => textoPlazo(p.duracion_meses) },
    { key: "precio", titulo: "Precio", movil: "valor", claseTh: "text-right", claseTd: "whitespace-nowrap text-right font-semibold tabular-nums", celda: (p) => <span style={{ color: TEAL }}>{monto(p.precio, p.moneda)}</span> },
    { key: "moneda", titulo: "Moneda", movil: "oculto", claseTd: "text-slate-600", celda: (p) => p.moneda },
    { key: "iva", titulo: "IVA", movil: "oculto", claseTd: "whitespace-nowrap text-xs text-slate-600", celda: (p) => IVA_LABEL[p.tipo_iva] ?? p.tipo_iva },
    { key: "susc", titulo: "Suscripciones", movil: "dato", claseTd: "tabular-nums text-slate-600", celda: (p) => p.suscripciones ?? 0, celdaMovil: (p) => `${p.suscripciones ?? 0} ${p.suscripciones === 1 ? "suscripción" : "suscripciones"}` },
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
            {" "}Cada plan se cobra a través de una suscripción; cambiar su precio o su plazo no toca las que ya existen.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 max-sm:w-full">
          {tipos.length ? (
            <div className="w-48 max-sm:w-full">
              <Select block value={filtroTipo} onChange={setFiltroTipo} etiqueta="Filtrar por tipo"
                options={[["", "Todos los tipos"], ...tipos.map((t): [string, string] => [t.id, t.nombre]), ["__sin__", "Sin tipo"]]} />
            </div>
          ) : null}
          {esAdmin ? (
            <>
              <button type="button" onClick={() => setViendoTipos(true)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)] max-sm:min-h-11 max-sm:flex-1 max-sm:justify-center max-sm:text-sm">
                <Tag className="h-3.5 w-3.5" /> Tipos de plan
              </button>
              <button type="button" onClick={() => setEditando("nuevo")}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:brightness-95 max-sm:min-h-11 max-sm:flex-1 max-sm:justify-center max-sm:text-sm"
                style={{ backgroundColor: TEAL }}>
                <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> Nuevo plan
              </button>
            </>
          ) : null}
        </div>
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
          <TablaTarjetas filas={visibles} columnas={columnas} claveFila={(p) => p.id} minAncho={920}
            vacio={<p className="py-12 text-center text-sm text-slate-400">No hay planes de este tipo.</p>}
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
        <ModalPlan plan={editando === "nuevo" ? null : editando} tipos={tipos} onClose={() => setEditando(null)}
          onGuardado={(m) => { setEditando(null); listo(m); }} />
      ) : null}
      {viendoTipos ? (
        <ModalTipos tipos={tipos} onClose={() => setViendoTipos(false)} onCambio={() => { setFiltroTipo(""); void cargar(); }} />
      ) : null}
    </div>
  );
}

/** Tipos de plan: crear, renombrar y borrar (los planes de un tipo borrado quedan sin tipo). */
function ModalTipos({ tipos, onClose, onCambio }: { tipos: TipoPlan[]; onClose: () => void; onCambio: () => void }) {
  const [nuevo, setNuevo] = useState("");
  const [nombres, setNombres] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function hacer(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onCambio();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const crear = () => void hacer(() => apiFetch("/api/planes/tipos", { method: "POST", body: JSON.stringify({ nombre: nuevo.trim() }) })).then((ok) => { if (ok) setNuevo(""); });
  const renombrar = (t: TipoPlan) => {
    const n = (nombres[t.id] ?? t.nombre).trim();
    if (n && n !== t.nombre) void hacer(() => apiFetch(`/api/planes/tipos/${t.id}`, { method: "PATCH", body: JSON.stringify({ nombre: n }) }));
  };

  return (
    <Modal titulo="Tipos de plan" onClose={() => { if (!busy) onClose(); }}>
      <div className="space-y-3">
        <p className="text-xs text-slate-500">Sirven para organizar los planes y filtrarlos. Si borrás un tipo, sus planes quedan sin tipo: no se borra ningún plan.</p>
        <form onSubmit={(e) => { e.preventDefault(); if (nuevo.trim()) crear(); }} className="flex gap-2">
          <input autoFocus className={INPUT} value={nuevo} onChange={(e) => setNuevo(e.target.value)} maxLength={60} placeholder="Ej: Abonos, Mantenimiento, Cuotas sociales" aria-label="Nuevo tipo" />
          <button type="submit" disabled={busy || !nuevo.trim()} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: TEAL }}>
            <Plus className="h-4 w-4" /> Agregar
          </button>
        </form>
        {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
        {tipos.length ? (
          <ul className="space-y-2">
            {tipos.map((t) => (
              <li key={t.id} className="flex items-center gap-2">
                <input className={INPUT} value={nombres[t.id] ?? t.nombre} maxLength={60} aria-label={`Nombre del tipo ${t.nombre}`}
                  onChange={(e) => setNombres((x) => ({ ...x, [t.id]: e.target.value }))} onBlur={() => renombrar(t)} />
                <button type="button" disabled={busy} onClick={() => void hacer(() => apiFetch(`/api/planes/tipos/${t.id}`, { method: "DELETE" }))} aria-label={`Borrar el tipo ${t.nombre}`}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50">
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="py-3 text-center text-sm text-slate-400">Todavía no hay tipos.</p>}
        <div className={PIE_MODAL}>
          <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">Listo</button>
        </div>
      </div>
    </Modal>
  );
}

function ModalPlan({ plan, tipos, onClose, onGuardado }: { plan: Plan | null; tipos: TipoPlan[]; onClose: () => void; onGuardado: (mensaje: string) => void }) {
  const [nombre, setNombre] = useState(plan?.nombre ?? "");
  const [descripcion, setDescripcion] = useState(plan?.descripcion ?? "");
  const [precio, setPrecio] = useState<number | "">(plan ? Number(plan.precio) : "");
  const [moneda, setMoneda] = useState<Moneda>(plan?.moneda ?? "GS");
  const [iva, setIva] = useState<TipoIva>(plan?.tipo_iva ?? "10%");
  const [activo, setActivo] = useState(plan?.activo ?? true);
  const [tipoId, setTipoId] = useState(plan?.tipo_id ?? "");
  const [tipoNuevo, setTipoNuevo] = useState("");
  const [plazo, setPlazo] = useState<number | null>(plan?.duracion_meses ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) { setError("El nombre es obligatorio"); return; }
    if (precio === "" || Number(precio) < 0) { setError("Indicá el precio"); return; }
    if (tipoId === "__nuevo__" && !tipoNuevo.trim()) { setError("Escribí el nombre del tipo nuevo"); return; }
    if (plazo !== null && (plazo < 1 || plazo > 600)) { setError("Cargá el plazo: de 1 a 600 meses"); return; }
    setBusy(true);
    setError(null);
    try {
      // El tipo nuevo se crea recién al guardar el plan.
      const tipo = tipoId === "__nuevo__"
        ? (await apiFetch<TipoPlan>("/api/planes/tipos", { method: "POST", body: JSON.stringify({ nombre: tipoNuevo.trim() }) })).id
        : tipoId || null;
      const body = JSON.stringify({ nombre: nombre.trim(), descripcion: descripcion.trim() || null, precio: Number(precio), moneda, tipo_iva: iva, activo, tipo_id: tipo, duracion_meses: plazo });
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
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <span className={LABEL}>Tipo de plan</span>
            <Select block value={tipoId} onChange={setTipoId} etiqueta="Tipo de plan"
              options={[["", "Sin tipo"], ...tipos.map((t): [string, string] => [t.id, t.nombre]), ["__nuevo__", "+ Crear un tipo nuevo…"]]} />
            {tipoId === "__nuevo__" ? (
              <input autoFocus className={`${INPUT} mt-2`} value={tipoNuevo} onChange={(e) => setTipoNuevo(e.target.value)} maxLength={60} placeholder="Ej: Abonos, Mantenimiento" aria-label="Nombre del tipo nuevo" />
            ) : null}
          </div>
          <CampoPlazo value={plazo} onChange={setPlazo} claseInput={INPUT} claseEtiqueta={LABEL} />
        </div>
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
            Lo usan {plan.suscripciones} suscripci{plan.suscripciones === 1 ? "ón" : "ones"}: cada una mantiene su precio y su plazo. Para cambiarle el precio, usá "Cambiar plan" en la ficha del cliente.
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
