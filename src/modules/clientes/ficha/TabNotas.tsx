"use client";

/**
 * Pestaña "Notas": notas internas con autor y fecha (lo más nuevo arriba). Ctrl+Enter
 * guarda. Cada uno puede borrar sus notas (el administrador, cualquiera).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import type { Nota } from "@/modules/clientes/ficha/tipos";
import { TEAL, fechaHora } from "@/modules/clientes/ui";

export function TabNotas({ clienteId, notaAnterior, onCambio }: { clienteId: string; notaAnterior?: string | null; onCambio: (cantidad: number) => void }) {
  const me = useUsuario();
  const [notas, setNotas] = useState<Nota[] | null>(null);
  const [texto, setTexto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await apiFetch<Nota[]>(`/api/clientes/${clienteId}/notas`);
      setNotas(r);
    } catch (e) {
      setNotas([]);
      setError((e as Error).message);
    }
  }, [clienteId]);
  useEffect(() => { void cargar(); }, [cargar]);

  async function agregar(e?: React.FormEvent) {
    e?.preventDefault();
    const t = texto.trim();
    if (!t || guardando) return;
    setGuardando(true);
    setError(null);
    try {
      const n = await apiFetch<Nota>(`/api/clientes/${clienteId}/notas`, { method: "POST", body: JSON.stringify({ texto: t }) });
      const lista = [n, ...(notas ?? [])];
      setNotas(lista);
      onCambio(lista.length);
      setTexto("");
      setTimeout(() => ref.current?.focus(), 0);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(id: string) {
    setError(null);
    try {
      await apiFetch(`/api/clientes/${clienteId}/notas?nota_id=${id}`, { method: "DELETE" });
      const lista = (notas ?? []).filter((n) => n.id !== id);
      setNotas(lista);
      onCambio(lista.length);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const puedeBorrar = (n: Nota) => me?.rol === "ADMIN" || (!!me?.usuarioId && n.usuario_id === me.usuarioId);

  return (
    <div className="max-w-2xl space-y-6">
      <form onSubmit={agregar}>
        <label htmlFor="nueva-nota" className="mb-1.5 block text-sm font-medium text-slate-700">Nueva nota</label>
        <textarea id="nueva-nota" ref={ref} value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} maxLength={4000}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void agregar(); } }}
          placeholder="Escribí una nota interna (Ctrl+Enter para guardar)…"
          className="mb-3 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-100)]" />
        <button type="submit" disabled={!texto.trim() || guardando}
          className="rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:brightness-95 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40" style={{ backgroundColor: TEAL }}>
          {guardando ? "Guardando…" : "Agregar nota"}
        </button>
        {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
      </form>

      {notas === null ? (
        <p className="text-sm text-slate-400">Cargando notas…</p>
      ) : notas.length === 0 && !notaAnterior ? (
        <p className="text-sm italic text-slate-400">No hay notas registradas aún.</p>
      ) : (
        <div className="space-y-3">
          {notas.map((n) => (
            <div key={n.id} className="group rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <p className="whitespace-pre-wrap text-sm text-slate-700">{n.texto}</p>
                {puedeBorrar(n) ? (
                  <button type="button" onClick={() => void borrar(n.id)} aria-label="Borrar nota" title="Borrar nota"
                    className="shrink-0 rounded-md p-1 text-slate-300 opacity-0 transition hover:bg-rose-50 hover:text-rose-500 focus:opacity-100 group-hover:opacity-100">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
              <p className="mt-2 text-xs text-slate-400">{n.usuario_nombre ? `${n.usuario_nombre} · ` : ""}{fechaHora(n.created_at)}</p>
            </div>
          ))}
          {notaAnterior ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-3">
              <p className="whitespace-pre-wrap text-sm text-slate-700">{notaAnterior}</p>
              <p className="mt-2 text-xs text-slate-400">Nota cargada antes (sin fecha)</p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
