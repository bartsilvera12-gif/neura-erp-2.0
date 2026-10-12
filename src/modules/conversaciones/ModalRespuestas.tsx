"use client";

/** Configuración de respuestas rápidas (ADMIN): atajo "/hola" → texto. */
import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2, Zap } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { olvidarOpciones } from "@/modules/conversaciones/api";
import type { RespuestaRapida } from "@/modules/conversaciones/dominio";
import { AvisoError, Ventana, botonPrimario, claseCampo } from "@/modules/conversaciones/ui";

const B = "/api/conversaciones/respuestas";

export function ModalRespuestas({ onCerrar }: { onCerrar: (cambio: boolean) => void }) {
  const [lista, setLista] = useState<RespuestaRapida[] | null>(null);
  const [edit, setEdit] = useState<{ id: string | null; atajo: string; texto: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [cambio, setCambio] = useState(false);

  const cargar = () =>
    apiFetch<{ respuestas: RespuestaRapida[] }>(B)
      .then((r) => setLista(r.respuestas))
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void cargar();
  }, []);

  const correr = async (fn: () => Promise<unknown>) => {
    setGuardando(true);
    setError(null);
    try {
      await fn();
      olvidarOpciones();
      setCambio(true);
      await cargar();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setGuardando(false);
    }
  };

  const guardar = async () => {
    if (!edit) return;
    const cuerpo = JSON.stringify({ atajo: edit.atajo, texto: edit.texto });
    const ok = await correr(() => (edit.id ? apiFetch(`${B}/${edit.id}`, { method: "PATCH", body: cuerpo }) : apiFetch(B, { method: "POST", body: cuerpo })));
    if (ok) setEdit(null);
  };

  return (
    <Ventana titulo="Respuestas rápidas" detalle='En el chat, escribí "/" y el atajo para insertar el texto.' icono={Zap} onCerrar={() => onCerrar(cambio)} ancho="max-w-xl">
      {edit ? (
        <div className="mb-4 space-y-2 rounded-xl border border-[#4FAEB2]/30 bg-[#4FAEB2]/5 p-3">
          <input className={claseCampo} placeholder="/atajo" value={edit.atajo} onChange={(e) => setEdit({ ...edit, atajo: e.target.value })} autoFocus />
          <textarea className={`${claseCampo} min-h-[90px]`} placeholder="Texto de la respuesta" value={edit.texto} onChange={(e) => setEdit({ ...edit, texto: e.target.value })} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEdit(null)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100">Cancelar</button>
            <button type="button" disabled={guardando || !edit.atajo.trim() || !edit.texto.trim()} onClick={() => void guardar()} className={botonPrimario}>
              {guardando ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setEdit({ id: null, atajo: "/", texto: "" })} className="mb-3 inline-flex items-center gap-1.5 rounded-xl bg-[#4FAEB2] px-3 py-2 text-xs font-semibold text-white hover:bg-[#3F8E91]">
          <Plus className="h-3.5 w-3.5" /> Nueva respuesta
        </button>
      )}
      {!lista ? (
        <p className="py-6 text-center text-sm text-slate-400">Cargando…</p>
      ) : lista.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">Todavía no hay respuestas rápidas.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {lista.map((r) => (
            <li key={r.id} className={`flex items-start gap-3 px-3 py-2.5 ${r.activo ? "" : "opacity-50"}`}>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs font-semibold text-[#3F8E91]">{r.atajo}</p>
                <p className="line-clamp-2 whitespace-pre-wrap text-xs text-slate-600">{r.texto}</p>
              </div>
              <label className="flex shrink-0 items-center gap-1 text-[11px] text-slate-500">
                <input
                  type="checkbox"
                  checked={r.activo}
                  disabled={guardando}
                  onChange={(e) => void correr(() => apiFetch(`${B}/${r.id}`, { method: "PATCH", body: JSON.stringify({ activo: e.target.checked }) }))}
                />
                Activa
              </label>
              <button type="button" onClick={() => setEdit({ id: r.id, atajo: r.atajo, texto: r.texto })} className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Editar">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={guardando}
                onClick={() => window.confirm(`¿Borrar ${r.atajo}?`) && void correr(() => apiFetch(`${B}/${r.id}`, { method: "DELETE" }))}
                className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                aria-label="Borrar"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <AvisoError>{error}</AvisoError>
    </Ventana>
  );
}
