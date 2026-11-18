"use client";

/** /comedor/configuracion — Empresa(s) contratante(s): subsidio mensual y cierre de reservas. */
import { useEffect, useState, useCallback } from "react";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { CapaModal } from "@/components/CapaModal";
import { Select } from "@/components/Select";
import { apiFetch } from "@/lib/api/client-fetch";
import { Building2, Loader2, Pencil, Plus } from "lucide-react";

type Empresa = {
  id: string; nombre: string; ruc: string | null; subsidio_mensual: number;
  cierre_dia: number | null; cierre_hora: string | null; activa: boolean; funcionarios: number;
};

const gs = (n: number) => Math.round(Number(n) || 0).toLocaleString("es-PY");
const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

export default function ConfiguracionComedorPage() {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editar, setEditar] = useState<Empresa | "nueva" | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setEmpresas(await apiFetch<Empresa[]>("/api/comedor/empresas"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  return (
    <div className="space-y-5">
      <EncabezadoPagina
        kicker="Comedor"
        titulo="Configuración del comedor"
        subtitulo="La empresa contratante, su subsidio mensual por funcionario y el cierre de reservas."
        volver={{ href: "/comedor/panel", label: "Comedor" }}
        acciones={
          <button
            onClick={() => setEditar("nueva")}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-95"
          >
            <Plus className="h-4 w-4" /> Nueva empresa
          </button>
        }
      />

      {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

      {cargando ? (
        <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>
      ) : empresas.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-8 text-center">
          <Building2 className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 text-sm font-medium text-slate-700">Todavía no cargaste la empresa contratante</p>
          <p className="mt-1 text-xs text-slate-500">Agregá la empresa (ej. Kingspan MV Aceros) para empezar con el padrón.</p>
          <button onClick={() => setEditar("nueva")} className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white">
            <Plus className="h-4 w-4" /> Nueva empresa
          </button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {empresas.map((e) => (
            <div key={e.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-800">{e.nombre}</p>
                  {e.ruc ? <p className="text-xs text-slate-500">RUC {e.ruc}</p> : null}
                </div>
                <div className="flex items-center gap-2">
                  {!e.activa ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">Inactiva</span> : null}
                  <button onClick={() => setEditar(e)} aria-label="Editar" className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"><Pencil className="h-4 w-4" /></button>
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-[11px] uppercase tracking-wide text-slate-400">Subsidio / mes</dt><dd className="font-semibold tabular-nums text-[var(--brand-700)]">Gs {gs(e.subsidio_mensual)}</dd></div>
                <div><dt className="text-[11px] uppercase tracking-wide text-slate-400">Funcionarios</dt><dd className="font-semibold tabular-nums text-slate-700">{e.funcionarios}</dd></div>
                <div className="col-span-2"><dt className="text-[11px] uppercase tracking-wide text-slate-400">Cierre de reservas</dt><dd className="text-slate-700">{e.cierre_dia != null ? `${DIAS[e.cierre_dia]}${e.cierre_hora ? ` ${e.cierre_hora}` : ""}` : "Sin definir"}</dd></div>
              </dl>
            </div>
          ))}
        </div>
      )}

      {editar ? <ModalEmpresa empresa={editar === "nueva" ? null : editar} onClose={() => setEditar(null)} onGuardado={() => { setEditar(null); void cargar(); }} /> : null}
    </div>
  );
}

function ModalEmpresa({ empresa, onClose, onGuardado }: { empresa: Empresa | null; onClose: () => void; onGuardado: () => void }) {
  const [nombre, setNombre] = useState(empresa?.nombre ?? "");
  const [ruc, setRuc] = useState(empresa?.ruc ?? "");
  const [subsidio, setSubsidio] = useState(String(empresa?.subsidio_mensual ?? 350000));
  const [cierreDia, setCierreDia] = useState<string>(empresa?.cierre_dia != null ? String(empresa.cierre_dia) : "");
  const [cierreHora, setCierreHora] = useState(empresa?.cierre_hora ?? "");
  const [activa, setActiva] = useState(empresa?.activa ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/comedor/empresas", {
        method: "POST",
        body: JSON.stringify({
          id: empresa?.id,
          nombre: nombre.trim(),
          ruc: ruc.trim() || null,
          subsidio_mensual: Number(String(subsidio).replace(/\D/g, "")) || 0,
          cierre_dia: cierreDia === "" ? null : Number(cierreDia),
          cierre_hora: cierreHora || null,
          activa,
        }),
      });
      onGuardado();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <CapaModal onClose={busy ? undefined : onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-slate-800">{empresa ? "Editar empresa" : "Nueva empresa contratante"}</h2>
        {error ? <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">{error}</div> : null}
        <div className="mt-4 space-y-3">
          <Campo label="Nombre de la empresa">
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Kingspan MV Aceros S.A." className={INPUT} />
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo label="RUC (opcional)"><input value={ruc} onChange={(e) => setRuc(e.target.value)} className={INPUT} /></Campo>
            <Campo label="Subsidio mensual (Gs)"><input value={subsidio} inputMode="numeric" onChange={(e) => setSubsidio(e.target.value.replace(/\D/g, ""))} className={INPUT} /></Campo>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Día de cierre de reservas">
              <Select
                block
                value={cierreDia}
                onChange={setCierreDia}
                textoVacio="Sin definir"
                options={[["", "Sin definir"], ...DIAS.map((d, i) => [String(i), d] as [string, string])]}
              />
            </Campo>
            <Campo label="Hora de cierre"><input type="time" value={cierreHora} onChange={(e) => setCierreHora(e.target.value)} className={INPUT} /></Campo>
          </div>
          <label className="flex min-h-11 cursor-pointer select-none items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={activa} onChange={(e) => setActiva(e.target.checked)} className="h-5 w-5 rounded border-slate-300 sm:h-4 sm:w-4" />
            Empresa activa
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2 max-sm:[&>button]:flex-1">
          <button onClick={onClose} disabled={busy} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancelar</button>
          <button onClick={guardar} disabled={busy || nombre.trim().length < 1} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{busy ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </CapaModal>
  );
}

const INPUT = "min-h-11 w-full rounded-lg border border-slate-200 px-3 text-base outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20 sm:min-h-0 sm:py-2 sm:text-sm";
function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>{children}</label>;
}
