"use client";

/**
 * Contactos del cliente (copia de ModalContactosCliente del sistema actual): otras personas
 * que hablan en su nombre (dueño, administración, cobranzas…). Lista con editar / quitar y
 * un formulario para agregar o editar. Usa /api/clientes/[id]/contactos.
 */
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Mail, Pencil, Phone, Plus, Trash2, UserRound, Users, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { TEAL } from "@/modules/clientes/ui";
import type { Contacto } from "@/modules/clientes/ficha/tipos";

type Form = { nombre: string; telefono: string; email: string; cargo: string; notas: string };
const VACIO: Form = { nombre: "", telefono: "", email: "", cargo: "", notas: "" };

const CAMPO = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-100)]";
const ETIQUETA = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500";

export function ModalContactos({ clienteId, clienteNombre, puedeEditar, onClose, onCambio }: {
  clienteId: string;
  clienteNombre: string;
  puedeEditar: boolean;
  onClose: () => void;
  /** se agregó, editó o quitó un contacto */
  onCambio?: () => void;
}) {
  const [lista, setLista] = useState<Contacto[] | null>(null);
  const [form, setForm] = useState<Form>(VACIO);
  const [editando, setEditando] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const url = `/api/clientes/${clienteId}/contactos`;
  const cargar = useCallback(async () => {
    try {
      setLista(await apiFetch<Contacto[]>(url));
    } catch (e) {
      setLista((l) => l ?? []);
      setError((e as Error).message || "No se pudieron cargar los contactos");
    }
  }, [url]);
  useEffect(() => { void cargar(); }, [cargar]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !guardando) onClose(); };
    window.addEventListener("keydown", k);
    const body = document.body;
    const prev = body.style.overflow;
    body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); body.style.overflow = prev; };
  }, [onClose, guardando]);

  function nuevo() {
    setForm(VACIO);
    setEditando(null);
    setAbierto(true);
    setError(null);
  }

  function editar(c: Contacto) {
    setForm({ nombre: c.nombre, telefono: c.telefono ?? "", email: c.email ?? "", cargo: c.cargo ?? "", notas: c.notas ?? "" });
    setEditando(c.id);
    setAbierto(true);
    setError(null);
  }

  async function guardar() {
    if (!form.nombre.trim()) { setError("El nombre del contacto es obligatorio"); return; }
    setGuardando(true);
    setError(null);
    const cuerpo = JSON.stringify({
      nombre: form.nombre.trim(),
      cargo: form.cargo.trim() || null,
      telefono: form.telefono.trim() || null,
      email: form.email.trim() || null,
      notas: form.notas.trim() || null,
    });
    try {
      if (editando) await apiFetch(`${url}?contacto_id=${encodeURIComponent(editando)}`, { method: "PATCH", body: cuerpo });
      else await apiFetch(url, { method: "POST", body: cuerpo });
      setAbierto(false);
      setForm(VACIO);
      setEditando(null);
      await cargar();
      onCambio?.();
    } catch (e) {
      setError((e as Error).message || "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  async function quitar(c: Contacto) {
    if (!window.confirm(`¿Quitar a ${c.nombre} de los contactos del cliente?`)) return;
    setError(null);
    try {
      await apiFetch(`${url}?contacto_id=${encodeURIComponent(c.id)}`, { method: "DELETE" });
      await cargar();
      onCambio?.();
    } catch (e) {
      setError((e as Error).message || "No se pudo quitar");
    }
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]" role="presentation"
      style={{ animation: "modal-backdrop 0.15s ease-out" }} onClick={() => { if (!guardando) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="contactos-cliente-titulo"
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4" style={{ backgroundImage: `linear-gradient(to right, ${TEAL}1f, ${TEAL}0d, transparent)` }}>
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ backgroundColor: `${TEAL}26`, color: TEAL }}>
            <Users className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="contactos-cliente-titulo" className="text-[16px] font-semibold text-slate-900">Contactos del cliente</h2>
            <p className="truncate text-[12.5px] text-slate-500">{clienteNombre} · con quién hablar para cobrar o tomar pedidos</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-slate-400 hover:bg-white/70 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {lista == null ? (
            <p className="flex items-center gap-2 py-6 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Cargando…
            </p>
          ) : lista.length === 0 && !abierto ? (
            <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
              Este cliente todavía no tiene contactos.
            </p>
          ) : lista.length > 0 ? (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {lista.map((c) => (
                <li key={c.id} className="flex items-start gap-3 px-3.5 py-2.5">
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500">
                    <UserRound className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-semibold text-slate-800">
                      {c.nombre}
                      {c.cargo ? <span className="ml-1.5 font-medium text-slate-400">· {c.cargo}</span> : null}
                    </p>
                    <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12.5px] text-slate-600">
                      {c.telefono ? <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3 text-slate-400" aria-hidden />{c.telefono}</span> : null}
                      {c.email ? <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3 text-slate-400" aria-hidden />{c.email}</span> : null}
                      {!c.telefono && !c.email ? <span className="text-slate-400">Sin teléfono ni correo</span> : null}
                    </p>
                    {c.notas ? <p className="mt-0.5 text-[12px] text-slate-400">{c.notas}</p> : null}
                  </div>
                  {puedeEditar ? (
                    <>
                      <button type="button" onClick={() => editar(c)} aria-label={`Editar ${c.nombre}`}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700">
                        <Pencil className="h-3.5 w-3.5" /> Editar
                      </button>
                      <button type="button" onClick={() => void quitar(c)} aria-label={`Quitar ${c.nombre}`}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-slate-500 hover:bg-rose-50 hover:text-rose-600">
                        <Trash2 className="h-3.5 w-3.5" /> Quitar
                      </button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {abierto ? (
            <div className="space-y-3 rounded-xl border p-3.5" style={{ borderColor: `${TEAL}4d`, backgroundColor: `${TEAL}0a` }}>
              <p className="text-[13px] font-semibold text-slate-700">{editando ? "Editar contacto" : "Nuevo contacto"}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className={ETIQUETA}>Nombre *</span>
                  <input className={CAMPO} value={form.nombre} maxLength={150} autoFocus placeholder="Ej.: María Gómez"
                    onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} />
                </label>
                <label className="block">
                  <span className={ETIQUETA}>Cargo</span>
                  <input className={CAMPO} value={form.cargo} maxLength={80} placeholder="Ej.: Administración"
                    onChange={(e) => setForm((f) => ({ ...f, cargo: e.target.value }))} />
                </label>
                <label className="block">
                  <span className={ETIQUETA}>Teléfono</span>
                  <input className={CAMPO} value={form.telefono} maxLength={40} inputMode="tel" placeholder="Ej.: 0981 123 456"
                    onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))} />
                </label>
                <label className="block">
                  <span className={ETIQUETA}>Correo</span>
                  <input className={CAMPO} value={form.email} maxLength={120} type="email" placeholder="Ej.: maria@empresa.com"
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
                </label>
              </div>
              <label className="block">
                <span className={ETIQUETA}>Notas</span>
                <input className={CAMPO} value={form.notas} maxLength={500} placeholder="Opcional"
                  onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))} />
              </label>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => { setAbierto(false); setError(null); }} disabled={guardando}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-slate-600 hover:bg-slate-50">
                  Cancelar
                </button>
                <button type="button" onClick={() => void guardar()} disabled={guardando}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold text-white transition hover:brightness-95 disabled:opacity-60"
                  style={{ backgroundColor: TEAL }}>
                  {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                  {editando ? "Guardar cambios" : "Agregar contacto"}
                </button>
              </div>
            </div>
          ) : null}

          {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p> : null}
        </div>

        {!abierto && puedeEditar ? (
          <div className="flex justify-end border-t border-slate-100 px-5 py-3">
            <button type="button" onClick={nuevo}
              className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:brightness-95"
              style={{ backgroundColor: TEAL }}>
              <Plus className="h-4 w-4" aria-hidden /> Añadir contacto
            </button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
