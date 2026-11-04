"use client";

/**
 * /sorteos/vendedores — Vendedores de sorteos (receta 123): uno solo por persona, con link de referido
 * (/r/<código>), punto de venta con link + PIN, cupo por sorteo, comisión y rendición del efectivo.
 * El PIN y el link del punto de venta se muestran una sola vez.
 */
import { useCallback, useEffect, useState } from "react";
import { Banknote, Check, Copy, KeyRound, Link2, Loader2, Pencil, Plus, Search, UserPlus } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { usePermiso } from "@/lib/sesion/ContextoUsuario";
import { filtrar } from "@/lib/busqueda";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { Modal } from "@/components/Modal";
import type { Vendedor } from "@/modules/sorteos/tipos";
import { BOTON, BOTON_PRIMARIO, Campo, Etiqueta, gs, INPUT, Interruptor, telefonoLindo } from "@/modules/sorteos/ui";

type Borrador = { id?: string; nombre: string; telefono: string; codigo: string; cupo: string; comision: string; activo: boolean; pin: string };
const VACIO: Borrador = { nombre: "", telefono: "", codigo: "", cupo: "", comision: "0", activo: true, pin: "" };

function Copiable({ texto, etiqueta }: { texto: string; etiqueta: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 break-all rounded-lg bg-slate-50 px-2.5 py-2 font-mono text-xs text-slate-800">{texto}</code>
      <button type="button" aria-label={`Copiar ${etiqueta}`} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-200 text-slate-600 hover:border-[var(--brand)] sm:h-9 sm:w-9"
        onClick={() => { void navigator.clipboard?.writeText(texto); setOk(true); setTimeout(() => setOk(false), 1500); }}>
        {ok ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}

export default function VendedoresSorteoPage() {
  const [filas, setFilas] = useState<Vendedor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [editando, setEditando] = useState<Borrador | null>(null);
  const [secreto, setSecreto] = useState<{ titulo: string; texto: string; valor: string; etiqueta: string } | null>(null);
  const [rendir, setRendir] = useState<Vendedor | null>(null);
  const admin = usePermiso("sorteos_administrar");
  const revisar = usePermiso("sorteos_revisar");

  const cargar = useCallback(() => {
    apiFetch<Vendedor[]>("/api/sorteos/vendedores").then(setFilas).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const visibles = filas ? filtrar(filas, q, (v) => ({ principal: v.nombre, otros: [v.codigo], documentos: [v.telefono] })) : [];
  const origen = typeof window !== "undefined" ? window.location.origin : "";

  async function generarLink(v: Vendedor) {
    try {
      const r = await apiFetch<{ link: string }>(`/api/sorteos/vendedores/${v.id}`, { method: "POST", body: JSON.stringify({ accion: "link" }) });
      setSecreto({ titulo: `Punto de venta de ${v.nombre}`, etiqueta: "link",
        texto: "Pasale este link por un canal privado: con él y su PIN vende desde el celular. Se muestra una sola vez; si lo pierde, generá otro (el anterior deja de funcionar).", valor: r.link });
      cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-4 pb-10">
      <EncabezadoPagina
        titulo="Vendedores"
        subtitulo="Cada vendedor tiene su link de referido, su punto de venta con PIN, su comisión y su cupo por sorteo."
        volver={{ href: "/sorteos/panel", label: "Sorteos" }}
        acciones={admin ? <button type="button" className={`${BOTON_PRIMARIO} max-sm:w-full`} onClick={() => setEditando({ ...VACIO })}><UserPlus className="h-4 w-4" /> Nuevo vendedor</button> : null}
      />
      {filas?.length ? (
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className={`${INPUT} pl-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar" aria-label="Buscar vendedor por nombre, código o teléfono" />
        </div>
      ) : null}
      {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      {!filas && !error ? <div className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-white" /> : null}
      {filas && !filas.length ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white p-10 text-center">
          <p className="text-sm font-semibold text-slate-800">Todavía no hay vendedores</p>
          <p className="max-w-sm text-sm text-slate-500">Un vendedor comparte su link para que la gente le compre por WhatsApp o la web, y puede vender en la calle desde su celular con un PIN.</p>
          {admin ? <button type="button" className={BOTON_PRIMARIO} onClick={() => setEditando({ ...VACIO })}><Plus className="h-4 w-4" /> Nuevo vendedor</button> : null}
        </div>
      ) : null}
      {visibles.length ? (
        <ul className="m-0 grid list-none gap-3 p-0 lg:grid-cols-2">
          {visibles.map((v) => (
            <li key={v.id} className={`rounded-2xl border bg-white p-4 ${v.activo ? "border-slate-200" : "border-slate-200 opacity-70"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold text-slate-900">N.º {v.numero} · {v.nombre}</p>
                  <p className="text-xs text-slate-500">Código {v.codigo}{v.telefono ? ` · ${telefonoLindo(v.telefono)}` : ""} · comisión {v.comision_pct}%{v.cupo ? ` · cupo ${v.cupo.toLocaleString("es-PY")} por sorteo` : ""}</p>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                  {!v.activo ? <Etiqueta tono="neutro">Inactivo</Etiqueta> : null}
                  {v.tiene_link ? <Etiqueta tono="ok">Con link</Etiqueta> : null}
                </div>
              </div>
              <dl className="m-0 mt-3 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-center">
                <div><dt className="text-[11px] text-slate-500">Clics</dt><dd className="m-0 text-sm font-semibold tabular-nums">{v.clicks.toLocaleString("es-PY")}</dd></div>
                <div><dt className="text-[11px] text-slate-500">Boletas</dt><dd className="m-0 text-sm font-semibold tabular-nums">{v.boletas.toLocaleString("es-PY")}</dd></div>
                <div><dt className="text-[11px] text-slate-500">Vendido</dt><dd className="m-0 text-sm font-semibold tabular-nums">{gs(v.monto)}</dd></div>
              </dl>
              {v.por_rendir > 0 ? <p className="mt-2 text-xs font-medium text-amber-800">Efectivo por rendir: {gs(v.por_rendir)}</p> : null}
              <div className="mt-3">
                <p className="mb-1 text-[11px] font-medium text-slate-500">Link de referido (para compartir)</p>
                <Copiable texto={`${origen}/r/${v.codigo}`} etiqueta="link de referido" />
              </div>
              <div className="mt-3 flex flex-wrap gap-2 max-sm:[&>*]:flex-1">
                {admin ? <button type="button" className={BOTON} onClick={() => setEditando({ id: v.id, nombre: v.nombre, telefono: v.telefono ?? "", codigo: v.codigo, cupo: v.cupo ? String(v.cupo) : "", comision: String(v.comision_pct), activo: v.activo, pin: "" })}><Pencil className="h-4 w-4" /> Editar</button> : null}
                {admin && v.activo ? <button type="button" className={BOTON} onClick={() => void generarLink(v)}><Link2 className="h-4 w-4" /> {v.tiene_link ? "Link nuevo" : "Link de venta"}</button> : null}
                {revisar && v.por_rendir > 0 ? <button type="button" className={BOTON_PRIMARIO} onClick={() => setRendir(v)}><Banknote className="h-4 w-4" /> Rendición</button> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : filas?.length && q ? <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">No hay vendedores con esa búsqueda.</p> : null}

      {editando ? <EditarVendedor b={editando} onClose={() => setEditando(null)} onGuardado={(v) => {
        setEditando(null);
        cargar();
        if (v.pin) setSecreto({ titulo: `PIN de ${v.nombre}`, etiqueta: "PIN", texto: "Pasáselo en privado. Con el link del punto de venta y este PIN vende desde el celular. Se muestra una sola vez (lo podés cambiar desde Editar).", valor: v.pin });
      }} /> : null}

      {secreto ? (
        <Modal titulo={secreto.titulo} onClose={() => setSecreto(null)}>
          <div className="space-y-3">
            <p className="flex items-start gap-2 text-sm text-slate-600"><KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand)]" /> {secreto.texto}</p>
            <Copiable texto={secreto.valor} etiqueta={secreto.etiqueta} />
            <div className="flex justify-end"><button type="button" className={BOTON_PRIMARIO} onClick={() => setSecreto(null)}>Listo, lo guardé</button></div>
          </div>
        </Modal>
      ) : null}

      {rendir ? <Rendir v={rendir} onClose={() => setRendir(null)} onListo={() => { setRendir(null); cargar(); }} /> : null}
    </div>
  );
}

function EditarVendedor({ b: inicial, onClose, onGuardado }: { b: Borrador; onClose: () => void; onGuardado: (v: Vendedor) => void }) {
  const [b, setB] = useState(inicial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<Borrador>) => setB((x) => ({ ...x, ...p }));
  async function guardar() {
    setBusy(true);
    setError(null);
    try {
      const v = await apiFetch<Vendedor>("/api/sorteos/vendedores", {
        method: "POST",
        body: JSON.stringify({
          id: b.id ?? null, nombre: b.nombre.trim(), telefono: b.telefono.trim() || null, codigo: b.codigo.trim() || null,
          cupo: Number(b.cupo) || null, comision_pct: Number(b.comision.replace(",", ".")) || 0, activo: b.activo, pin: b.pin || null,
        }),
      });
      onGuardado(v);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal titulo={b.id ? "Editar vendedor" : "Nuevo vendedor"} onClose={() => !busy && onClose()} size="lg">
      <div className="space-y-3">
        <Campo label="Nombre"><input className={INPUT} autoFocus value={b.nombre} onChange={(e) => set({ nombre: e.target.value })} maxLength={80} /></Campo>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo label="Teléfono (opcional)"><input className={INPUT} inputMode="tel" value={b.telefono} onChange={(e) => set({ telefono: e.target.value })} maxLength={30} /></Campo>
          <Campo label="Código de referido" ayuda="Letras y números. Vacío = se arma del nombre.">
            <input className={`${INPUT} uppercase`} value={b.codigo} onChange={(e) => set({ codigo: e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase() })} maxLength={20} />
          </Campo>
          <Campo label="Comisión (%)"><input className={`${INPUT} tabular-nums`} inputMode="decimal" value={b.comision} onChange={(e) => set({ comision: e.target.value.replace(/[^\d.,]/g, "") })} /></Campo>
          <Campo label="Cupo por sorteo (opcional)" ayuda="Máximo de boletas que puede vender en cada sorteo.">
            <input className={`${INPUT} tabular-nums`} inputMode="numeric" value={b.cupo} onChange={(e) => set({ cupo: e.target.value.replace(/\D/g, "") })} placeholder="Sin cupo" />
          </Campo>
          <Campo label={b.id ? "PIN nuevo (opcional)" : "PIN (opcional)"} ayuda={b.id ? "Solo si querés cambiarlo. De 4 a 8 números." : "De 4 a 8 números. Vacío = se genera uno."} className="sm:col-span-2">
            <input className={`${INPUT} tabular-nums`} inputMode="numeric" value={b.pin} onChange={(e) => set({ pin: e.target.value.replace(/\D/g, "").slice(0, 8) })} autoComplete="new-password" />
          </Campo>
        </div>
        {b.id ? <Interruptor valor={b.activo} onChange={(v) => set({ activo: v })} label="Activo" ayuda="Inactivo: no vende ni cuenta los clics de su link." /> : null}
        {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
        <div className="flex justify-end gap-2 max-sm:[&>*]:flex-1">
          <button type="button" className={BOTON} disabled={busy} onClick={onClose}>Cancelar</button>
          <button type="button" className={BOTON_PRIMARIO} disabled={busy || b.nombre.trim().length < 2} onClick={guardar}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar</button>
        </div>
      </div>
    </Modal>
  );
}

function Rendir({ v, onClose, onListo }: { v: Vendedor; onClose: () => void; onListo: () => void }) {
  const [nota, setNota] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<{ monto: number; comision: number; entregado: number; ordenes: number } | null>(null);
  const comision = Math.round((v.por_rendir * v.comision_pct) / 100);
  async function confirmar() {
    setBusy(true);
    setError(null);
    try {
      setHecho(await apiFetch(`/api/sorteos/vendedores/${v.id}`, { method: "POST", body: JSON.stringify({ accion: "rendir", nota: nota || null }) }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal titulo={`Rendición de ${v.nombre}`} onClose={() => (hecho ? onListo() : !busy && onClose())}>
      {hecho ? (
        <div className="space-y-3 text-center">
          <Check className="mx-auto h-10 w-10 text-emerald-500" />
          <p className="text-sm text-slate-600">{hecho.ordenes} venta{hecho.ordenes === 1 ? "" : "s"} rendida{hecho.ordenes === 1 ? "" : "s"}.</p>
          <p className="text-2xl font-black tabular-nums">{gs(hecho.entregado)}</p>
          <p className="text-xs text-slate-500">Vendió {gs(hecho.monto)} · comisión {gs(hecho.comision)}</p>
          <button type="button" className={BOTON_PRIMARIO} onClick={onListo}>Listo</button>
        </div>
      ) : (
        <div className="space-y-3">
          <dl className="m-0 space-y-1.5 rounded-xl bg-slate-50 p-3 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Ventas en efectivo sin rendir</dt><dd className="m-0 font-semibold tabular-nums">{gs(v.por_rendir)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Su comisión ({v.comision_pct}%)</dt><dd className="m-0 font-semibold tabular-nums">− {gs(comision)}</dd></div>
            <div className="flex justify-between border-t border-slate-200 pt-1.5"><dt className="font-semibold text-slate-800">Tiene que entregar</dt><dd className="m-0 text-base font-black tabular-nums">{gs(v.por_rendir - comision)}</dd></div>
          </dl>
          <Campo label="Nota (opcional)"><input className={INPUT} value={nota} onChange={(e) => setNota(e.target.value)} maxLength={300} placeholder="Ej. entregó en la oficina" /></Campo>
          {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
          <div className="flex justify-end gap-2 max-sm:[&>*]:flex-1">
            <button type="button" className={BOTON} disabled={busy} onClick={onClose}>Volver</button>
            <button type="button" className={BOTON_PRIMARIO} disabled={busy} onClick={confirmar}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />} Recibí el efectivo</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
