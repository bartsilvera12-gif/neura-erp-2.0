"use client";

/**
 * Wizard de importación inicial del catálogo.
 * Paso 1: cargar los 3 reportes → Paso 2: revisar el consolidado (conflictos,
 * faltantes, duplicados evitados) → Paso 3: confirmar e importar.
 */
import Link from "next/link";
import { invalidar } from "@/lib/api/cache-cliente";
import { useMemo, useState } from "react";
import { apiForm } from "@/lib/api/client-fetch";
import { Select } from "@/components/Select";
import { ScrollHorizontal } from "@/components/ScrollHorizontal";
import { invalidarDepositos, opcionesDepositos, useDepositos } from "@/modules/inventario/depositos";
import { invalidarLista } from "@/modules/inventario/lista-cache";

type Fuente = "productos" | "stock_general" | "stock_valorizado";

const FUENTES: { fuente: Fuente; campo: string; titulo: string; aporta: string }[] = [
  { fuente: "productos", campo: "file_productos", titulo: "1 · Productos",
    aporta: "Código interno y de fábrica, descripción, stock, costo, costo mayorista, precio de venta y unidad de medida." },
  { fuente: "stock_general", campo: "file_stock_general", titulo: "2 · Stock General",
    aporta: "Código de fábrica, descripción, categoría/familia, código de barras y stock." },
  { fuente: "stock_valorizado", campo: "file_stock_valorizado", titulo: "3 · Stock Valorizado",
    aporta: "Código interno y de fábrica, descripción, código de barras, IVA, stock, costo unitario y precio de venta." },
];

const FUENTE_LABEL: Record<Fuente, string> = {
  productos: "Productos",
  stock_general: "Stock General",
  stock_valorizado: "Stock Valorizado",
};

const CAMPO_LABEL: Record<string, string> = {
  producto: "Producto", codigo_interno: "Código interno", codigo_fabrica: "Código de fábrica",
  codigo_barras: "Código de barras", descripcion: "Descripción",
  categoria: "Categoría", unidad: "Unidad de medida", stock: "Stock",
  costo: "Precio de costo", mayorista: "Costo mayorista", costo_mayorista: "Costo mayorista",
  precio_venta: "Precio de venta", iva: "IVA",
};

interface Conflicto { campo: string; elegido: string; valores: { fuente: Fuente; valor: string }[] }
interface Item {
  clave: string; matched_por: string[]; fuentes: Fuente[];
  codigo_interno: string; codigo_fabrica: string; codigo_barras: string;
  descripcion: string; categoria: string; unidad: string;
  stock: number | null; costo: number | null; costo_mayorista: number | null;
  precio_venta: number | null; iva: string;
  conflictos: Conflicto[]; faltantes: string[]; errores: string[];
  match_existente_id?: string | null;
}
interface Archivo {
  fuente: Fuente; filename: string;
  filas_datos: number; filas_ignoradas: number; con_codigo_fabrica: number;
  columnas: Record<string, number>; columnas_faltantes: string[];
}
interface Preview {
  items: Item[];
  archivos: Archivo[];
  resumen: {
    total: number; con_conflictos: number; con_faltantes: number; con_errores: number;
    nuevos: number; existentes: number;
    por_fuente: Record<Fuente, number>;
    por_criterio: Record<string, number>;
  };
}

const num = (n: number | null) =>
  n === null || n === undefined ? "—" : new Intl.NumberFormat("es-PY").format(n);

type Filtro = "todos" | "conflictos" | "faltantes" | "errores" | "nuevos" | "existentes";

export function ImportInicialWizard() {
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [cargando, setCargando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Record<string, unknown> | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [actualizarExistentes, setActualizarExistentes] = useState(true);
  const [crearCategorias, setCrearCategorias] = useState(true);
  const [expandido, setExpandido] = useState<string | null>(null);
  // Depósito donde está el stock inicial (por defecto el del usuario / Casa central).
  const deps = useDepositos();
  const [deposito, setDeposito] = useState("");
  const depositoEf = deposito || deps.datos?.mi_deposito_id || "";
  const opcDepositos = opcionesDepositos(deps.datos);

  const algunArchivo = Object.values(files).some(Boolean);

  function buildForm(): FormData {
    const fd = new FormData();
    for (const { campo } of FUENTES) {
      const f = files[campo];
      if (f) fd.append(campo, f);
    }
    return fd;
  }

  async function analizar() {
    setCargando(true); setError(null); setResultado(null);
    try {
      setPreview(await apiForm<Preview>("/api/inventario/productos/import-inicial/preview", buildForm()));
      setFiltro("todos");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo analizar.");
    } finally {
      setCargando(false);
    }
  }

  async function importar() {
    setImportando(true); setError(null);
    try {
      const fd = buildForm();
      fd.append("actualizar_existentes", actualizarExistentes ? "1" : "0");
      fd.append("crear_categorias", crearCategorias ? "1" : "0");
      if (depositoEf) fd.append("deposito_id", depositoEf);
      setResultado(await apiForm<Record<string, unknown>>("/api/inventario/productos/import-inicial/commit", fd));
      invalidar("/api/inventario/categorias");
      invalidarLista("/api/productos");
      invalidarLista("/api/inventario/movimientos");
      invalidarLista("/api/inventario/ajustes");
      invalidarDepositos();
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo importar.");
    } finally {
      setImportando(false);
    }
  }

  const items = useMemo(() => {
    if (!preview) return [];
    switch (filtro) {
      case "conflictos": return preview.items.filter((i) => i.conflictos.length > 0);
      case "faltantes": return preview.items.filter((i) => i.faltantes.length > 0);
      case "errores": return preview.items.filter((i) => i.errores.length > 0);
      case "nuevos": return preview.items.filter((i) => !i.match_existente_id);
      case "existentes": return preview.items.filter((i) => !!i.match_existente_id);
      default: return preview.items;
    }
  }, [preview, filtro]);

  // ── Resultado final ───────────────────────────────────────────────────────
  if (resultado) {
    const r = resultado as Record<string, number & string>;
    return (
      <div className="rounded-2xl border-2 border-[var(--brand-100)] bg-white p-4 shadow-sm sm:p-6">
        <h2 className="text-lg font-bold text-slate-900">Importación completada</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Productos creados", r.creados], ["Actualizados", r.actualizados],
            ["Omitidos", r.omitidos], ["Errores", r.errores],
            ["Categorías creadas", r.categorias_creadas],
            ["Movimientos de stock", r.movimientos_generados],
            ["Unidades iniciales", r.unidades_iniciales],
          ].map(([k, v]) => (
            <div key={String(k)} className="rounded-xl border border-[var(--brand-100)] bg-[var(--brand-50)] p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{String(k)}</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-[var(--brand)] [overflow-wrap:anywhere]">{num(Number(v ?? 0))}</p>
            </div>
          ))}
        </div>
        {resultado.ajuste_numero ? (
          <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            El stock inicial quedó en <strong>{String(resultado.deposito ?? "el depósito")}</strong> como el ajuste de inventario{" "}
            <Link href="/inventario/ajustes" className="font-mono font-semibold text-[var(--brand)] hover:underline">{String(resultado.ajuste_numero)}</Link>.
          </p>
        ) : null}
        {Array.isArray(resultado.mensajes_error) && (resultado.mensajes_error as string[]).length > 0 && (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3">
            <p className="text-xs font-semibold text-rose-700">Errores</p>
            <ul className="mt-1 max-h-48 list-disc space-y-0.5 overflow-auto pl-5 text-xs text-rose-700">
              {(resultado.mensajes_error as string[]).map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          </div>
        )}
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Link href="/inventario" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white hover:brightness-95 sm:min-h-0">
            Ir al inventario
          </Link>
          <button
            onClick={() => { setResultado(null); setFiles({}); }}
            className="min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:min-h-0"
          >
            Importar de nuevo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {/* Paso 1 — archivos */}
      <section className="rounded-2xl border-2 border-[var(--brand-100)] bg-white p-4 shadow-sm sm:p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--brand)]">Paso 1 · Cargar los reportes</h2>
        <p className="mt-1 text-xs text-slate-500">
          Podés cargar los tres o solo los que tengas. Los datos que falten en un reporte
          se completan con los otros.
        </p>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {FUENTES.map(({ campo, titulo, aporta }) => (
            <label
              key={campo}
              className={`min-w-0 cursor-pointer rounded-xl border-2 p-3.5 transition sm:p-4 ${
                files[campo] ? "border-[var(--brand)] bg-[var(--brand-50)]" : "border-dashed border-slate-300 hover:border-[var(--brand)]"
              }`}
            >
              <p className="text-sm font-bold text-slate-900">{titulo}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{aporta}</p>
              <input
                type="file" accept=".xlsx,.xls,.csv" className="mt-3 block w-full min-w-0 text-xs file:mr-3 file:min-h-10 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:text-xs file:font-semibold file:text-slate-700"
                onChange={(e) => {
                  setFiles((p) => ({ ...p, [campo]: e.target.files?.[0] ?? null }));
                  setPreview(null);
                }}
              />
              {files[campo] && (
                <p className="mt-2 truncate text-[11px] font-semibold text-[var(--brand)]">{files[campo]!.name}</p>
              )}
            </label>
          ))}
        </div>
        <button
          onClick={analizar}
          disabled={!algunArchivo || cargando}
          className="mt-4 min-h-11 w-full rounded-lg bg-[var(--brand)] px-5 py-2.5 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-40 sm:w-auto"
        >
          {cargando ? "Analizando…" : "Analizar y consolidar"}
        </button>
      </section>

      {/* Paso 2 — revisión */}
      {preview && (
        <>
          <section className="rounded-2xl border-2 border-[var(--brand-100)] bg-white p-4 shadow-sm sm:p-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--brand)]">Paso 2 · Revisar el consolidado</h2>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[
                ["Productos", preview.resumen.total, "text-[var(--brand)]"],
                ["Nuevos", preview.resumen.nuevos, "text-emerald-600"],
                ["Ya existen", preview.resumen.existentes, "text-sky-600"],
                ["Con diferencias", preview.resumen.con_conflictos, "text-amber-600"],
                ["Con datos faltantes", preview.resumen.con_faltantes, "text-orange-600"],
                ["Con errores", preview.resumen.con_errores, "text-rose-600"],
              ].map(([k, v, c]) => (
                <div key={String(k)} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{String(k)}</p>
                  <p className={`mt-1 text-xl font-bold tabular-nums ${c}`}>{num(Number(v))}</p>
                </div>
              ))}
            </div>

            {/* Diagnóstico por archivo: qué columnas se reconocieron */}
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              {preview.archivos.map((a) => (
                <div key={a.fuente} className="min-w-0 rounded-xl border border-slate-200 p-3">
                  <p className="text-xs font-bold text-slate-900">{FUENTE_LABEL[a.fuente]}</p>
                  <p className="truncate text-[11px] text-slate-500">{a.filename}</p>
                  <p className="mt-2 text-[11px] text-slate-600">
                    <span className="font-semibold text-[var(--brand)]">{num(a.filas_datos)}</span> filas de datos
                    {a.filas_ignoradas > 0 && <span className="text-slate-400"> · {num(a.filas_ignoradas)} ignoradas</span>}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-600 [overflow-wrap:anywhere]">
                    Columnas: {Object.entries(a.columnas).filter(([, v]) => v >= 0).map(([c]) => CAMPO_LABEL[c] ?? c).join(", ") || "ninguna"}
                  </p>
                  {a.columnas_faltantes.length > 0 && (
                    <p className="mt-1 text-[11px] text-amber-700">
                      No se encontró: {a.columnas_faltantes.map((c) => CAMPO_LABEL[c] ?? c).join(", ")}
                    </p>
                  )}
                </div>
              ))}
            </div>

            {/* Cómo se cruzaron */}
            <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
              <span className="w-full text-slate-500 sm:w-auto">Productos cruzados por:</span>
              {Object.entries(preview.resumen.por_criterio).map(([k, v]) => (
                <span key={k} className="rounded-full bg-[var(--brand-50)] px-2 py-0.5 font-semibold text-[var(--brand)]">
                  {CAMPO_LABEL[k] ?? k}: {num(Number(v))}
                </span>
              ))}
            </div>
          </section>

          {/* Tabla */}
          <section className="rounded-2xl border-2 border-[var(--brand-100)] bg-white shadow-sm">
            {/* Filtros: en una fila; si no entran, scrollean adentro (nunca saltan de línea ni se cortan). */}
            <div className="flex flex-col gap-2 border-b border-slate-200 p-3 sm:flex-row sm:items-center sm:p-4">
              <ScrollHorizontal className="min-w-0" claseFila="gap-2" dependencias={[filtro]}>
              {([
                ["todos", "Todos"], ["conflictos", "Con diferencias"], ["faltantes", "Datos faltantes"],
                ["errores", "Errores"], ["nuevos", "Nuevos"], ["existentes", "Ya existen"],
              ] as [Filtro, string][]).map(([k, label]) => (
                <button
                  key={k} onClick={() => setFiltro(k)} aria-pressed={filtro === k} data-activo={filtro === k ? "true" : undefined}
                  className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition max-sm:min-h-10 max-sm:text-[13px] ${
                    filtro === k ? "bg-[var(--brand)] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >{label}</button>
              ))}
              </ScrollHorizontal>
              <span className="shrink-0 text-xs text-slate-500 sm:ml-auto">
                Mostrando {num(Math.min(items.length, 300))} de {num(items.length)}
              </span>
            </div>

            {/* Vista previa: scroll interno en los dos sentidos (cabecera fija arriba y la
                descripción fija a la izquierda); la página nunca se corre de costado. */}
            <div className="tabla-primera-fija max-h-[65dvh] overflow-auto overscroll-contain sm:max-h-[560px]"
              style={{ ["--tabla-fondo-cabecera" as string]: "var(--brand-50)" } as React.CSSProperties}>
              <table className="w-full min-w-[980px] text-left text-xs">
                <thead className="sticky top-0 z-[2] bg-[var(--brand-50)] text-[11px] uppercase tracking-wide text-[var(--brand)]">
                  <tr>
                    <th className="p-2 pl-3">Descripción</th>
                    <th className="p-2">Cód. interno</th>
                    <th className="p-2">Cód. fábrica</th>
                    <th className="p-2">Cód. barras</th>
                    <th className="p-2">Categoría</th>
                    <th className="p-2">Un.</th>
                    <th className="p-2 text-right">Stock</th>
                    <th className="p-2 text-right">Costo</th>
                    <th className="p-2 text-right">Costo may.</th>
                    <th className="p-2 text-right">Venta</th>
                    <th className="p-2">IVA</th>
                    <th className="p-2">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {items.slice(0, 300).map((it, idx) => {
                    const key = `${it.clave}-${idx}`;
                    const abierto = expandido === key;
                    const campoEnConflicto = new Set(it.conflictos.map((c) => c.campo));
                    const cell = (campo: string, valor: string) => (
                      <td className={`p-2 ${campoEnConflicto.has(campo) ? "bg-amber-50 font-semibold text-amber-800" : ""}`}>
                        {valor}
                      </td>
                    );
                    return (
                      <tr
                        key={key}
                        onClick={() => setExpandido(abierto ? null : key)}
                        className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50 ${
                          it.errores.length ? "bg-rose-50/60" : ""
                        }`}
                        style={{ ["--tabla-fondo" as string]: it.errores.length ? "#fff6f7" : "#fff" } as React.CSSProperties}
                      >
                        <td className="w-[170px] min-w-[170px] max-w-[170px] p-2 pl-3 sm:w-auto sm:min-w-[200px] sm:max-w-[260px]">
                          <p className="truncate font-semibold text-slate-800">{it.descripcion || "—"}</p>
                          <p className="text-[10px] text-slate-400">
                            {it.fuentes.map((f) => FUENTE_LABEL[f]).join(" · ")}
                          </p>
                          {abierto && (
                            <div className="mt-2 space-y-1 whitespace-normal">
                              {it.conflictos.map((c) => (
                                <p key={c.campo} className="text-[10px] text-amber-800">
                                  <b>{CAMPO_LABEL[c.campo] ?? c.campo}</b>: se usará <b>{c.elegido}</b> —{" "}
                                  {c.valores.map((v) => `${FUENTE_LABEL[v.fuente]}: ${v.valor}`).join(" | ")}
                                </p>
                              ))}
                              {it.faltantes.length > 0 && (
                                <p className="text-[10px] text-orange-700">
                                  Sin dato en ningún reporte: {it.faltantes.map((c) => CAMPO_LABEL[c] ?? c).join(", ")}
                                </p>
                              )}
                              {it.errores.map((e, i) => (
                                <p key={i} className="text-[10px] font-semibold text-rose-700">{e}</p>
                              ))}
                            </div>
                          )}
                        </td>
                        {cell("codigo_interno", it.codigo_interno || "—")}
                        {cell("codigo_fabrica", it.codigo_fabrica || "—")}
                        {cell("codigo_barras", it.codigo_barras || "—")}
                        {cell("categoria", it.categoria || "—")}
                        {cell("unidad", it.unidad || "—")}
                        <td className={`p-2 text-right ${campoEnConflicto.has("stock") ? "bg-amber-50 font-semibold text-amber-800" : ""}`}>{num(it.stock)}</td>
                        <td className={`p-2 text-right ${campoEnConflicto.has("costo") ? "bg-amber-50 font-semibold text-amber-800" : ""}`}>{num(it.costo)}</td>
                        <td className={`p-2 text-right ${campoEnConflicto.has("costo_mayorista") ? "bg-amber-50 font-semibold text-amber-800" : ""}`}>{num(it.costo_mayorista)}</td>
                        <td className={`p-2 text-right ${campoEnConflicto.has("precio_venta") ? "bg-amber-50 font-semibold text-amber-800" : ""}`}>{num(it.precio_venta)}</td>
                        {cell("iva", it.iva)}
                        <td className="p-2">
                          {it.errores.length ? (
                            <span className="rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-700">Error</span>
                          ) : it.match_existente_id ? (
                            <span className="rounded-full bg-sky-100 px-2 py-0.5 font-semibold text-sky-700">Ya existe</span>
                          ) : (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700">Nuevo</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {items.length === 0 && (
                <p className="p-6 text-center text-xs text-slate-500">Nada que mostrar con este filtro.</p>
              )}
            </div>
          </section>

          {/* Paso 3 — confirmar */}
          <section className="rounded-2xl border-2 border-[var(--brand-100)] bg-white p-4 shadow-sm sm:p-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--brand)]">Paso 3 · Confirmar</h2>
            <div className="mt-3 space-y-2">
              <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-slate-700 sm:min-h-0 sm:gap-2">
                <input type="checkbox" className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" checked={crearCategorias} onChange={(e) => setCrearCategorias(e.target.checked)} />
                Crear las categorías que no existan
              </label>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-slate-700 sm:min-h-0 sm:gap-2">
                <input type="checkbox" className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" checked={actualizarExistentes} onChange={(e) => setActualizarExistentes(e.target.checked)} />
                Actualizar los productos que ya existen ({num(preview.resumen.existentes)})
              </label>
            </div>
            {opcDepositos.length > 1 ? (
              <div className="mt-3 max-w-sm">
                <span className="mb-1 block text-xs font-medium text-slate-600">El stock de los reportes está en</span>
                <Select value={depositoEf} onChange={setDeposito} block options={opcDepositos} etiqueta="Depósito del stock inicial" />
              </div>
            ) : null}
            <p className="mt-3 text-xs text-slate-500">
              Se crearán los productos y el stock de los reportes quedará como un <strong>ajuste de inventario inicial</strong> (AJ-)
              en ese depósito: cada diferencia queda en el kardex con su documento.
            </p>
            <button
              onClick={importar}
              disabled={importando}
              className="mt-4 min-h-11 w-full rounded-lg bg-[var(--brand)] px-5 py-2.5 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-40 sm:w-auto"
            >
              {importando ? "Importando…" : `Importar ${num(preview.resumen.total)} productos`}
            </button>
          </section>
        </>
      )}
    </div>
  );
}
