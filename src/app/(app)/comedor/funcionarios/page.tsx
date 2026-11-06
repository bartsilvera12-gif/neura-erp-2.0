"use client";

/** /comedor/funcionarios — Padrón de funcionarios: alta, edición, baja, import Excel y saldo del mes. */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { CapaModal } from "@/components/CapaModal";
import { Select } from "@/components/Select";
import { apiFetch } from "@/lib/api/client-fetch";
import { ExcelImportWizard } from "@/modules/inventario/ExcelImportWizard";
import { Loader2, Pencil, Plus, Search, Upload, Users } from "lucide-react";

type Funcionario = {
  id: string; nombre: string; documento: string | null; activo: boolean;
  empresa_id: string | null; empresa_nombre: string | null;
  subsidio: number; consumido: number; disponible: number;
};
type Lista = { total: number; rows: Funcionario[]; periodo: string };
type Empresa = { id: string; nombre: string; activa: boolean };

const gs = (n: number) => Math.round(Number(n) || 0).toLocaleString("es-PY");
const PAGINA = 50;

export default function FuncionariosPage() {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [q, setQ] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [estado, setEstado] = useState("activos");
  const [data, setData] = useState<Lista | null>(null);
  const [offset, setOffset] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editar, setEditar] = useState<Funcionario | "nuevo" | null>(null);
  const [importar, setImportar] = useState(false);

  useEffect(() => {
    void apiFetch<Empresa[]>("/api/comedor/empresas").then((e) => setEmpresas(e)).catch(() => {});
  }, []);

  const cargar = useCallback(async (nuevoOffset: number, append: boolean) => {
    setCargando(true);
    setError(null);
    try {
      const sp = new URLSearchParams({ limit: String(PAGINA), offset: String(nuevoOffset), estado });
      if (q.trim()) sp.set("q", q.trim());
      if (empresa) sp.set("empresa", empresa);
      const res = await apiFetch<Lista>(`/api/comedor/funcionarios?${sp}`);
      setData((prev) => (append && prev ? { ...res, rows: [...prev.rows, ...res.rows] } : res));
      setOffset(nuevoOffset);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, [q, empresa, estado]);

  // Recargar al cambiar filtros (con pequeño debounce para el buscador).
  useEffect(() => {
    const t = setTimeout(() => void cargar(0, false), 250);
    return () => clearTimeout(t);
  }, [cargar]);

  const empresaOptions = useMemo<[string, string][]>(
    () => [["", "Todas las empresas"], ...empresas.map((e) => [e.id, e.nombre] as [string, string])],
    [empresas],
  );
  const sinEmpresa = empresas.filter((e) => e.activa).length === 0;

  return (
    <div className="space-y-5">
      <EncabezadoPagina
        kicker="Comedor"
        titulo="Funcionarios"
        subtitulo="El padrón de la empresa, con su subsidio del mes. Importalo del Excel o cargalo a mano."
        volver={{ href: "/comedor/panel", label: "Comedor" }}
        acciones={
          <div className="flex gap-2 max-sm:w-full max-sm:[&>button]:flex-1">
            <button onClick={() => setImportar(true)} disabled={sinEmpresa} title={sinEmpresa ? "Primero cargá la empresa contratante" : undefined} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">
              <Upload className="h-4 w-4" /> Importar padrón
            </button>
            <button onClick={() => setEditar("nuevo")} disabled={sinEmpresa} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:opacity-50">
              <Plus className="h-4 w-4" /> Nuevo funcionario
            </button>
          </div>
        }
      />

      {sinEmpresa ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Antes de cargar funcionarios, agregá la empresa contratante en{" "}
          <Link href="/comedor/configuracion" className="font-semibold underline">Configuración del comedor</Link>.
        </div>
      ) : null}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre o CI…" className="min-h-11 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-base outline-none focus:border-[var(--brand)] sm:min-h-0 sm:py-2 sm:text-sm" />
        </div>
        <Select value={empresa} onChange={setEmpresa} options={empresaOptions} />
        <Select value={estado} onChange={setEstado} options={[["activos", "Activos"], ["inactivos", "Inactivos"], ["", "Todos"]]} />
      </div>

      {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

      {data ? <p className="text-xs text-slate-500">{data.total.toLocaleString("es-PY")} funcionario(s)</p> : null}

      {cargando && !data ? (
        <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>
      ) : data && data.rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-8 text-center">
          <Users className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 text-sm font-medium text-slate-700">Sin funcionarios para mostrar</p>
          <p className="mt-1 text-xs text-slate-500">{sinEmpresa ? "Cargá primero la empresa contratante." : "Importá el padrón o agregá uno a mano."}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {data?.rows.map((f) => (
            <div key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link href={`/clientes/${f.id}`} className="truncate font-semibold text-slate-800 hover:text-[var(--brand)] hover:underline">{f.nombre}</Link>
                  {!f.activo ? <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">Inactivo</span> : null}
                </div>
                <p className="text-xs text-slate-500">CI {f.documento || "—"}{f.empresa_nombre ? ` · ${f.empresa_nombre}` : ""}</p>
              </div>
              <div className="text-right">
                <p className="text-[11px] uppercase tracking-wide text-slate-400">Saldo del mes</p>
                <p className="font-semibold tabular-nums text-[var(--brand-700)]">Gs {gs(f.disponible)}</p>
                <p className="text-[10px] text-slate-400">de Gs {gs(f.subsidio)}</p>
              </div>
              <button onClick={() => setEditar(f)} aria-label="Editar" className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"><Pencil className="h-4 w-4" /></button>
            </div>
          ))}
          {data && data.rows.length < data.total ? (
            <button onClick={() => void cargar(offset + PAGINA, true)} disabled={cargando} className="mx-auto mt-2 flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Ver más ({data.total - data.rows.length})
            </button>
          ) : null}
        </div>
      )}

      {editar ? (
        <ModalFuncionario funcionario={editar === "nuevo" ? null : editar} empresas={empresas} onClose={() => setEditar(null)} onGuardado={() => { setEditar(null); void cargar(0, false); }} />
      ) : null}

      {importar ? (
        <ImportarPadron empresas={empresas} onClose={() => setImportar(false)} onCompleted={() => void cargar(0, false)} />
      ) : null}
    </div>
  );
}

function ImportarPadron({ empresas, onClose, onCompleted }: { empresas: Empresa[]; onClose: () => void; onCompleted: () => void }) {
  const activas = empresas.filter((e) => e.activa);
  const [empresaId, setEmpresaId] = useState(activas[0]?.id ?? "");
  return (
    <ExcelImportWizard
      entidad="funcionarios"
      previewUrl="/api/comedor/padron/preview"
      commitUrl="/api/comedor/padron/commit"
      templateUrl="/api/comedor/padron/plantilla"
      camposExtra={{ empresa_id: empresaId }}
      etiquetas={{ INSERT: "Nuevos", UPDATE: "Actualizar" }}
      opcionesExtra={
        <label className="block rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <span className="mb-1 block text-xs font-medium text-slate-500">Empresa contratante del padrón</span>
          <Select block value={empresaId} onChange={setEmpresaId} options={activas.map((e) => [e.id, e.nombre] as [string, string])} />
        </label>
      }
      onClose={onClose}
      onCompleted={onCompleted}
    />
  );
}

function ModalFuncionario({ funcionario, empresas, onClose, onGuardado }: { funcionario: Funcionario | null; empresas: Empresa[]; onClose: () => void; onGuardado: () => void }) {
  const activas = empresas.filter((e) => e.activa);
  const [nombre, setNombre] = useState(funcionario?.nombre ?? "");
  const [documento, setDocumento] = useState(funcionario?.documento ?? "");
  const [empresaId, setEmpresaId] = useState(funcionario?.empresa_id ?? activas[0]?.id ?? "");
  const [activo, setActivo] = useState(funcionario?.activo ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setBusy(true);
    setError(null);
    try {
      if (funcionario) {
        await apiFetch(`/api/comedor/funcionarios/${funcionario.id}`, {
          method: "PATCH",
          body: JSON.stringify({ nombre: nombre.trim(), documento: documento.trim(), comedor_empresa_id: empresaId || null, activo }),
        });
      } else {
        await apiFetch("/api/comedor/funcionarios", {
          method: "POST",
          body: JSON.stringify({ nombre: nombre.trim(), documento: documento.trim(), comedor_empresa_id: empresaId }),
        });
      }
      onGuardado();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <CapaModal onClose={busy ? undefined : onClose}>
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-slate-800">{funcionario ? "Editar funcionario" : "Nuevo funcionario"}</h2>
        {error ? <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">{error}</div> : null}
        <div className="mt-4 space-y-3">
          <label className="block"><span className="mb-1 block text-xs font-medium text-slate-500">Nombre y apellido</span>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={INPUT} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-slate-500">Cédula (CI)</span>
            <input value={documento} inputMode="numeric" onChange={(e) => setDocumento(e.target.value)} className={INPUT} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-slate-500">Empresa contratante</span>
            <Select block value={empresaId} onChange={setEmpresaId} options={activas.map((e) => [e.id, e.nombre] as [string, string])} /></label>
          {funcionario ? (
            <label className="flex min-h-11 cursor-pointer select-none items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} className="h-5 w-5 rounded border-slate-300 sm:h-4 sm:w-4" />
              Funcionario activo
            </label>
          ) : null}
        </div>
        <div className="mt-5 flex justify-end gap-2 max-sm:[&>button]:flex-1">
          <button onClick={onClose} disabled={busy} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancelar</button>
          <button onClick={guardar} disabled={busy || nombre.trim().length < 1 || documento.trim().length < 1 || !empresaId} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{busy ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </CapaModal>
  );
}

const INPUT = "min-h-11 w-full rounded-lg border border-slate-200 px-3 text-base outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20 sm:min-h-0 sm:py-2 sm:text-sm";
