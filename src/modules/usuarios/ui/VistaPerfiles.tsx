"use client";

/**
 * Vista 2 — Perfiles: pantallas y permisos.
 *   · lista de perfiles (los de sistema primero) con cuántos usuarios usan cada uno
 *   · editor: nivel base, alcance de sucursal, tope de descuento, árbol de pantallas por
 *     familia (con "seleccionar todo") y permisos agrupados con su explicación
 *   · vista previa "este perfil ve…" al costado
 * Administrador no se edita (tiene todo); los de sistema conservan nombre y nivel base.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Building2, Copy, History, Info, Layers, Loader2, Lock, Plus, ShieldCheck, Sparkles, Trash2, Users } from "lucide-react";
import { CapaModal, ALTO_MAX_MODAL } from "@/components/CapaModal";
import { ORDEN_FAMILIAS, pantallasCatalogo, type Pantalla } from "@/modules/registry";
import { iconoModulo } from "@/modules/icons";
import { GRUPOS_PERMISOS, NIVELES, nivelLabel, permisoAplica, permisoDef, TODOS_LOS_PERMISOS, type DefPermiso } from "@/modules/usuarios/permisos";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, ET, INPUT, ModalDocumento } from "@/modules/inventario/ui";
import { Historial } from "@/modules/usuarios/ui/Historial";
import { VistaPrevia } from "@/modules/usuarios/ui/VistaPrevia";
import { api, Casilla, invalidarTodo, TEAL, type PerfilCompleto } from "@/modules/usuarios/ui/comun";

type Nivel = PerfilCompleto["nivel_base"];
type Borrador = {
  id: string | null;
  nombre: string;
  descripcion: string;
  nivel_base: Nivel;
  alcance_sucursal: "propia" | "todas";
  tope_descuento_pct: string;
  pantallas: string[];
  permisos: string[];
  sistema: boolean;
  codigo: string | null;
  todo: boolean;
};

const dePerfil = (p: PerfilCompleto): Borrador => ({
  id: p.id,
  nombre: p.nombre,
  descripcion: p.descripcion ?? "",
  nivel_base: p.nivel_base,
  alcance_sucursal: p.alcance_sucursal,
  tope_descuento_pct: p.tope_descuento_pct == null ? "" : String(p.tope_descuento_pct),
  pantallas: [...p.pantallas].sort(),
  permisos: [...p.permisos].sort(),
  sistema: p.sistema,
  codigo: p.codigo,
  todo: p.todo,
});

const NUEVO: Borrador = {
  id: null, nombre: "", descripcion: "", nivel_base: "CAJERO", alcance_sucursal: "propia", tope_descuento_pct: "",
  pantallas: [], permisos: [], sistema: false, codigo: null, todo: false,
};

const pantallaAplica = (p: Pantalla, nivel: string) => !p.niveles?.length || p.niveles.includes(nivel);
const soloNiveles = (niveles?: string[]) => (niveles?.length ? `Solo nivel ${niveles.map(nivelLabel).join(" / ")}` : "");

/** Lo que se guarda: sin pantallas / permisos que el nivel base no puede usar. */
function limpio(b: Borrador, catalogo: Pantalla[]) {
  const pant = new Map(catalogo.map((p) => [p.href, p]));
  const tope = b.tope_descuento_pct.trim() === "" ? null : Number(b.tope_descuento_pct.replace(",", "."));
  const permisos = b.permisos.filter((x) => { const d = permisoDef(x); return d && permisoAplica(d, b.nivel_base); });
  return {
    id: b.id,
    nombre: b.nombre.trim(),
    descripcion: b.descripcion.trim() || null,
    nivel_base: b.nivel_base,
    alcance_sucursal: b.nivel_base === "ADMIN" ? "todas" : b.alcance_sucursal,
    tope_descuento_pct: permisos.includes("descuentos_precio") && tope != null && !Number.isNaN(tope) ? tope : null,
    pantallas: b.pantallas.filter((h) => { const p = pant.get(h); return !p || pantallaAplica(p, b.nivel_base); }).sort(),
    permisos: permisos.sort(),
  };
}

export function VistaPerfiles({ perfiles, cargando, error, onCambio }: {
  perfiles: PerfilCompleto[] | null;
  cargando: boolean;
  error: string | null;
  onCambio: () => void;
}) {
  const catalogo = useMemo(() => pantallasCatalogo(), []);
  const [sel, setSel] = useState<string | null>(null);
  const [b, setB] = useState<Borrador | null>(null);
  const [original, setOriginal] = useState<string>("");
  const [busy, setBusy] = useState<null | "guardar" | "eliminar">(null);
  const [errorEd, setErrorEd] = useState<string | null>(null);
  const [okEd, setOkEd] = useState<string | null>(null);
  const [pendiente, setPendiente] = useState<null | (() => void)>(null);
  const [confirmarEliminar, setConfirmarEliminar] = useState(false);
  const [verHistorial, setVerHistorial] = useState(false);

  const actual = perfiles?.find((p) => p.id === sel) ?? null;
  const sucio = !!b && JSON.stringify(limpio(b, catalogo)) !== original;

  function abrir(nuevo: Borrador) {
    setB(nuevo);
    setOriginal(nuevo.id ? JSON.stringify(limpio(nuevo, catalogo)) : "");
    setSel(nuevo.id);
    setErrorEd(null);
    setOkEd(null);
  }
  /** Cambiar de perfil con cambios sin guardar → pregunta. */
  const conCuidado = (accion: () => void) => (sucio ? setPendiente(() => accion) : accion());

  // Primer perfil al cargar; si el elegido se borró, el primero.
  useEffect(() => {
    if (!perfiles?.length) return;
    if (b && (b.id === null || perfiles.some((p) => p.id === b.id))) {
      // se recargó la lista: refrescar el original del elegido (después de guardar)
      if (b.id && !sucio) {
        const p = perfiles.find((x) => x.id === b.id)!;
        abrir(dePerfil(p));
      }
      return;
    }
    abrir(dePerfil(perfiles.find((p) => p.codigo !== "ADMIN") ?? perfiles[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfiles]);

  // Avisar antes de cerrar la pestaña con cambios sin guardar.
  useEffect(() => {
    if (!sucio) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [sucio]);

  const set = <K extends keyof Borrador>(k: K, v: Borrador[K]) => setB((p) => (p ? { ...p, [k]: v } : p));
  const soloLectura = !!b?.todo;

  async function guardar() {
    if (!b || busy || !b.nombre.trim()) return;
    const cuerpo = limpio(b, catalogo);
    if (cuerpo.tope_descuento_pct != null && (cuerpo.tope_descuento_pct < 0 || cuerpo.tope_descuento_pct > 100)) {
      setErrorEd("El tope de descuento va de 0 a 100 %");
      return;
    }
    setBusy("guardar");
    setErrorEd(null);
    setOkEd(null);
    try {
      const r = await api.guardarPerfil(cuerpo);
      invalidarTodo();
      setB((p) => (p ? { ...p, id: r.id } : p));
      setSel(r.id);
      setOriginal(JSON.stringify({ ...cuerpo, id: r.id }));
      setOkEd(r.cambios ? "Cambios guardados. Los usuarios con este perfil los ven en menos de un minuto." : "No había cambios para guardar.");
      onCambio();
    } catch (e) {
      setErrorEd((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function eliminar() {
    if (!b?.id || busy) return;
    setBusy("eliminar");
    setErrorEd(null);
    try {
      await api.eliminarPerfil(b.id);
      invalidarTodo();
      setConfirmarEliminar(false);
      setB(null);
      setSel(null);
      onCambio();
    } catch (e) {
      setErrorEd((e as Error).message);
      setConfirmarEliminar(false);
    } finally {
      setBusy(null);
    }
  }

  function duplicar() {
    if (!b) return;
    const base = b.todo
      ? { pantallas: catalogo.map((p) => p.href), permisos: [...TODOS_LOS_PERMISOS] as string[] }
      : { pantallas: b.pantallas, permisos: b.permisos };
    let nombre = `Copia de ${b.nombre}`;
    for (let i = 2; perfiles?.some((p) => p.nombre.toLowerCase() === nombre.toLowerCase()); i++) nombre = `Copia de ${b.nombre} (${i})`;
    abrir({ ...b, ...base, id: null, nombre: nombre.slice(0, 60), sistema: false, codigo: null, todo: false });
  }

  // ── Pantallas: árbol familia → módulo → pantalla ─────────────────────────
  const arbol = useMemo(() => {
    const fam = new Map<string, Map<string, Pantalla[]>>();
    for (const p of catalogo) {
      if (!fam.has(p.familia)) fam.set(p.familia, new Map());
      const m = fam.get(p.familia)!;
      if (!m.has(p.moduloId)) m.set(p.moduloId, []);
      m.get(p.moduloId)!.push(p);
    }
    return [...fam.entries()]
      .sort((a, z) => (ORDEN_FAMILIAS.indexOf(a[0]) + 1 || 99) - (ORDEN_FAMILIAS.indexOf(z[0]) + 1 || 99))
      .map(([familia, mods]) => ({ familia, modulos: [...mods.values()] }));
  }, [catalogo]);

  const marcada = (h: string) => !!b && (b.todo || b.pantallas.includes(h));
  const estadoGrupo = (ps: Pantalla[]): boolean | "algunos" => {
    const hab = ps.filter((p) => b && pantallaAplica(p, b.nivel_base));
    const n = hab.filter((p) => marcada(p.href)).length;
    return n === 0 ? false : n === hab.length ? true : "algunos";
  };
  const alternarPantallas = (ps: Pantalla[], valor: boolean) => {
    if (!b || soloLectura) return;
    const hrefs = ps.filter((p) => pantallaAplica(p, b.nivel_base)).map((p) => p.href);
    set("pantallas", valor ? [...new Set([...b.pantallas, ...hrefs])] : b.pantallas.filter((h) => !hrefs.includes(h)));
  };

  // ── Permisos ─────────────────────────────────────────────────────────────
  const tiene = (id: string) => !!b && (b.todo || b.permisos.includes(id));
  const estadoPermisos = (ps: DefPermiso[]): boolean | "algunos" => {
    const hab = ps.filter((p) => b && permisoAplica(p, b.nivel_base));
    const n = hab.filter((p) => tiene(p.id)).length;
    return n === 0 ? false : n === hab.length ? true : "algunos";
  };
  const alternarPermisos = (ps: DefPermiso[], valor: boolean) => {
    if (!b || soloLectura) return;
    const ids = ps.filter((p) => permisoAplica(p, b.nivel_base)).map((p) => p.id as string);
    set("permisos", valor ? [...new Set([...b.permisos, ...ids])] : b.permisos.filter((x) => !ids.includes(x)));
  };

  const previa = b
    ? {
        nivel_base: b.nivel_base,
        alcance_sucursal: b.nivel_base === "ADMIN" ? ("todas" as const) : b.alcance_sucursal,
        tope_descuento_pct: b.tope_descuento_pct.trim() === "" ? null : Number(b.tope_descuento_pct.replace(",", ".")),
        pantallas: b.pantallas,
        permisos: b.permisos,
        todo: b.todo,
      }
    : null;

  if (cargando && !perfiles) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-300" /></div>;
  if (error && !perfiles) return <p className="rounded-xl border border-rose-100 bg-rose-50 p-4 text-sm text-rose-700">{error}</p>;

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[250px_1fr]">
      {/* Lista de perfiles */}
      <aside className="space-y-2 lg:sticky lg:top-0">
        <button type="button" onClick={() => conCuidado(() => abrir({ ...NUEVO }))}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-[var(--brand)] hover:text-[var(--brand)]">
          <Plus className="h-4 w-4" /> Nuevo perfil
        </button>
        <ul className="space-y-1.5">
          {b && b.id === null ? (
            <li className="rounded-xl border-2 bg-white px-3 py-2.5" style={{ borderColor: TEAL }}>
              <p className="truncate text-sm font-semibold text-slate-900">{b.nombre.trim() || "Perfil nuevo"}</p>
              <p className="text-[11px] text-slate-500">Sin guardar</p>
            </li>
          ) : null}
          {(perfiles ?? []).map((p) => {
            const activo = sel === p.id;
            return (
              <li key={p.id}>
                <button type="button" onClick={() => !activo && conCuidado(() => abrir(dePerfil(p)))}
                  className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors duration-150 ${activo ? "border-transparent bg-white shadow-sm ring-2" : "border-slate-200 bg-white hover:border-slate-300"}`}
                  style={activo ? ({ ["--tw-ring-color" as string]: TEAL } as React.CSSProperties) : undefined}>
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-slate-900">{p.nombre}</span>
                    {p.codigo === "ADMIN" ? <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[#023047]" /> : p.sistema ? <Lock className="h-3 w-3 shrink-0 text-slate-400" /> : null}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                    <span>{p.sistema ? "Sistema" : `Nivel ${nivelLabel(p.nivel_base)}`}</span>
                    <span className="inline-flex items-center gap-0.5 tabular-nums"><Users className="h-3 w-3" /> {p.usuarios}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="px-1 pt-1 text-[11px] leading-relaxed text-slate-400">
          Los perfiles de sistema replican los roles de antes. Podés ajustarlos o crear los tuyos (ej. Depósito, Contador).
        </p>
      </aside>

      {/* Editor */}
      {!b ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Elegí un perfil de la lista.</div>
      ) : (
        <div className="min-w-0 space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                {b.sistema ? (
                  <h2 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
                    {b.nombre}
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500"><Lock className="h-3 w-3" /> Sistema</span>
                  </h2>
                ) : (
                  <input value={b.nombre} onChange={(e) => set("nombre", e.target.value)} maxLength={60} placeholder="Nombre del perfil (ej. Depósito)"
                    className="w-full max-w-md rounded-lg border border-transparent bg-transparent px-1 -ml-1 text-xl font-semibold text-slate-900 outline-none transition hover:border-slate-200 focus:border-[var(--brand)]" />
                )}
                <input value={b.descripcion} onChange={(e) => set("descripcion", e.target.value)} disabled={soloLectura} maxLength={300}
                  placeholder="Para qué es este perfil (opcional)"
                  className="mt-1 w-full rounded-lg border border-transparent bg-transparent px-1 -ml-1 text-sm text-slate-500 outline-none transition hover:border-slate-200 focus:border-[var(--brand)] disabled:hover:border-transparent" />
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {b.id ? (
                  <button type="button" onClick={() => setVerHistorial(true)} className={BOTON_SECUNDARIO} title="Quién cambió qué">
                    <History className="h-4 w-4" /> Historial
                  </button>
                ) : null}
                {b.id ? (
                  <button type="button" onClick={() => conCuidado(duplicar)} className={BOTON_SECUNDARIO}>
                    <Copy className="h-4 w-4" /> Duplicar
                  </button>
                ) : null}
                {b.id && !b.sistema ? (
                  <button type="button" onClick={() => setConfirmarEliminar(true)} disabled={!!actual && actual.usuarios + actual.usuarios_inactivos > 0}
                    title={actual && actual.usuarios + actual.usuarios_inactivos > 0 ? "Lo usan usuarios: cambiales el perfil primero" : "Eliminar perfil"}
                    className={`${BOTON_SECUNDARIO} hover:!border-rose-300 hover:!text-rose-600`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            </div>
            {b.todo ? (
              <div className="mt-4 flex gap-3 rounded-xl bg-[#023047]/[0.05] p-3.5 text-[13px] text-slate-700">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#023047]" />
                <p>El Administrador ve <b>todas las pantallas</b> y puede hacer <b>todo</b>, también lo que se agregue en el futuro. No se edita ni se elimina. Para un perfil parecido con menos permisos, usá <b>Duplicar</b>.</p>
              </div>
            ) : actual ? (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
                <Users className="h-3.5 w-3.5" /> {actual.usuarios === 0 ? "Ningún usuario activo lo usa" : `${actual.usuarios} usuario${actual.usuarios === 1 ? "" : "s"} activo${actual.usuarios === 1 ? "" : "s"}`}
                {actual.usuarios_inactivos ? <span className="text-slate-400">· {actual.usuarios_inactivos} inactivo{actual.usuarios_inactivos === 1 ? "" : "s"}</span> : null}
              </p>
            ) : null}
          </section>

          <div className="grid items-start gap-4 xl:grid-cols-[1fr_300px]">
            <div className="min-w-0 space-y-4">
              {/* Nivel y alcance */}
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Layers className="h-4 w-4 text-[var(--brand)]" /> Nivel base y alcance</h3>
                <p className="mt-0.5 text-xs text-slate-500">El nivel base es el rol de siempre: define lo que el sistema le deja hacer por dentro. Las pantallas y permisos de abajo afinan qué ve y qué puede hacer.</p>
                <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
                  {NIVELES.map((n) => {
                    const on = b.nivel_base === n.id;
                    return (
                      <button key={n.id} type="button" disabled={b.sistema || soloLectura} onClick={() => set("nivel_base", n.id)}
                        className={`rounded-xl border px-3 py-2.5 text-left transition-colors duration-150 disabled:cursor-not-allowed ${on ? "border-transparent bg-[var(--brand-50)] ring-2" : "border-slate-200 bg-white hover:border-slate-300 disabled:opacity-50"}`}
                        style={on ? ({ ["--tw-ring-color" as string]: TEAL } as React.CSSProperties) : undefined}>
                        <span className="block text-sm font-semibold text-slate-900">{n.label}</span>
                        <span className="block text-[11px] leading-snug text-slate-500">{n.detalle}</span>
                      </button>
                    );
                  })}
                </div>
                {b.sistema && !b.todo ? <p className="mt-2 text-[11px] text-slate-400">En los perfiles de sistema el nivel base no cambia. Para otro nivel, duplicalo.</p> : null}

                <div className="mt-4">
                  <span className={ET}>Sucursales</span>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {([["propia", "Solo su sucursal", "Ve y opera las cajas, ventas y reportes de la sucursal del usuario."], ["todas", "Todas las sucursales", "Ve y opera en cualquier sucursal (como el administrador)."]] as const).map(([id, label, detalle]) => {
                      const on = (b.nivel_base === "ADMIN" ? "todas" : b.alcance_sucursal) === id;
                      return (
                        <button key={id} type="button" disabled={soloLectura || b.nivel_base === "ADMIN"} onClick={() => set("alcance_sucursal", id)}
                          className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors duration-150 disabled:cursor-not-allowed ${on ? "border-transparent bg-[var(--brand-50)] ring-2" : "border-slate-200 bg-white hover:border-slate-300 disabled:opacity-50"}`}
                          style={on ? ({ ["--tw-ring-color" as string]: TEAL } as React.CSSProperties) : undefined}>
                          <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                          <span>
                            <span className="block text-sm font-semibold text-slate-900">{label}</span>
                            <span className="block text-[11px] leading-snug text-slate-500">{detalle}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </section>

              {/* Pantallas */}
              <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Pantallas</h3>
                    <p className="text-xs text-slate-500">Lo que aparece en su menú. Entrar por URL a otra pantalla muestra &ldquo;Sin acceso&rdquo;.</p>
                  </div>
                  {!soloLectura ? (
                    <div className="flex gap-1 text-xs font-semibold">
                      <button type="button" onClick={() => alternarPantallas(catalogo, true)} className="rounded-lg px-2 py-1 text-[var(--brand)] hover:bg-[var(--brand-50)]">Marcar todo</button>
                      <button type="button" onClick={() => alternarPantallas(catalogo, false)} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100">Ninguna</button>
                    </div>
                  ) : null}
                </div>
                <div className="divide-y divide-slate-100">
                  {arbol.map(({ familia, modulos }) => {
                    const todas = modulos.flat();
                    const eg = estadoGrupo(todas);
                    return (
                      <div key={familia} className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <Casilla estado={b.todo || eg} disabled={soloLectura || todas.every((p) => !pantallaAplica(p, b.nivel_base))}
                            onClick={() => alternarPantallas(todas, eg !== true)} etiqueta={`Todas las pantallas de ${familia}`} />
                          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{familia}</span>
                        </div>
                        <div className="mt-2 grid gap-x-6 gap-y-1.5 pl-[28px] sm:grid-cols-2">
                          {modulos.map((ps) => {
                            const m = ps[0];
                            const Icono = iconoModulo(m.icon);
                            const conHijos = ps.length > 1 || ps[0].label !== ps[0].moduloLabel;
                            if (!conHijos) {
                              return <FilaPantalla key={m.href} p={m} icono={<Icono className="h-4 w-4 text-slate-400" />} nivel={b.nivel_base} marcada={marcada(m.href)} soloLectura={soloLectura}
                                onClick={() => alternarPantallas([m], !marcada(m.href))} />;
                            }
                            const em = estadoGrupo(ps);
                            const deshab = soloLectura || ps.every((p) => !pantallaAplica(p, b.nivel_base));
                            return (
                              <div key={m.moduloId} className="sm:col-span-2">
                                <div className="flex items-center gap-2.5 py-0.5">
                                  <Casilla estado={b.todo || em} disabled={deshab} onClick={() => alternarPantallas(ps, em !== true)} etiqueta={`Todo ${m.moduloLabel}`} />
                                  <Icono className="h-4 w-4 text-slate-400" />
                                  <span className={`text-sm font-medium ${deshab && !b.todo ? "text-slate-400" : "text-slate-800"}`}>{m.moduloLabel}</span>
                                  {m.niveles?.length && !pantallaAplica(m, b.nivel_base) ? <span className="text-[10px] text-slate-400">{soloNiveles(m.niveles)}</span> : null}
                                </div>
                                <div className="mt-1 grid gap-x-6 gap-y-1 pl-[28px] sm:grid-cols-2">
                                  {ps.map((p) => (
                                    <FilaPantalla key={p.href} p={p} nivel={b.nivel_base} marcada={marcada(p.href)} soloLectura={soloLectura} sub
                                      onClick={() => alternarPantallas([p], !marcada(p.href))} />
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Permisos */}
              <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-5 py-4">
                  <h3 className="text-sm font-semibold text-slate-900">Permisos</h3>
                  <p className="text-xs text-slate-500">Acciones delicadas. Se controlan también en el servidor y en la base: aunque alguien llame directo, sin el permiso no puede.</p>
                </div>
                <div className="divide-y divide-slate-100">
                  {GRUPOS_PERMISOS.map((g) => {
                    const eg = estadoPermisos(g.permisos);
                    return (
                      <div key={g.id} className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <Casilla estado={b.todo || eg} disabled={soloLectura || g.permisos.every((p) => !permisoAplica(p, b.nivel_base))}
                            onClick={() => alternarPermisos(g.permisos, eg !== true)} etiqueta={`Todos los permisos de ${g.label}`} />
                          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{g.label}</span>
                        </div>
                        <ul className="mt-2 space-y-1 pl-[28px]">
                          {g.permisos.map((p) => {
                            const aplica = permisoAplica(p, b.nivel_base);
                            const on = tiene(p.id) && (aplica || b.todo);
                            return (
                              <li key={p.id}>
                                <div className={`-mx-2 flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors ${!soloLectura && aplica ? "cursor-pointer hover:bg-slate-50" : ""}`}
                                  onClick={() => !soloLectura && aplica && alternarPermisos([p], !on)}>
                                  <span className="mt-0.5" onClick={(e) => e.stopPropagation()}>
                                    <Casilla estado={on} disabled={soloLectura || !aplica} onClick={() => alternarPermisos([p], !on)} etiqueta={p.label} />
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className={`flex flex-wrap items-center gap-1.5 text-sm font-medium ${aplica || b.todo ? "text-slate-800" : "text-slate-400"}`}>
                                      {p.label}
                                      {p.sensible ? <span className="rounded bg-amber-50 px-1.5 py-px text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200">Delicado</span> : null}
                                      {!aplica && !b.todo ? <span className="text-[10px] font-normal text-slate-400">{soloNiveles(p.niveles)}</span> : null}
                                    </span>
                                    <span className="block text-xs leading-snug text-slate-500">{p.descripcion}</span>
                                  </span>
                                </div>
                                {p.id === "descuentos_precio" && on && !b.todo ? (
                                  <div className="mb-1 ml-[26px] mt-1 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
                                    <span className="text-xs text-slate-600">Descuento máximo</span>
                                    <div className="relative w-24">
                                      <input inputMode="decimal" value={b.tope_descuento_pct} onChange={(e) => set("tope_descuento_pct", e.target.value.replace(/[^\d.,]/g, "").slice(0, 6))}
                                        placeholder="Sin tope" className={`${INPUT} !py-1.5 pr-7 text-right tabular-nums`} />
                                      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
                                    </div>
                                    <span className="text-[11px] text-slate-400">Vacío = sin tope. Cuenta el descuento que da la persona (además del que ya trae el producto).</span>
                                  </div>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>

            {/* Vista previa */}
            <aside className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 xl:sticky xl:top-0">
              {previa ? <VistaPrevia b={previa} /> : null}
            </aside>
          </div>

          {/* Barra de guardar */}
          {!soloLectura ? (
            <div className={`sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-3 rounded-2xl border bg-white/95 px-4 py-3 shadow-[0_-8px_24px_-12px_rgba(2,48,71,0.18)] backdrop-blur transition-colors ${sucio || !b.id ? "border-[var(--brand-100)]" : "border-slate-200"}`}>
              <div className="min-w-0 flex-1 text-xs">
                {errorEd ? <span className="flex items-center gap-1.5 text-rose-700"><AlertTriangle className="h-4 w-4 shrink-0" /> {errorEd}</span>
                  : okEd && !sucio ? <span className="flex items-center gap-1.5 text-emerald-700"><Sparkles className="h-4 w-4 shrink-0" /> {okEd}</span>
                  : sucio || !b.id ? <span className="flex items-center gap-1.5 text-slate-600"><Info className="h-4 w-4 shrink-0 text-[var(--brand)]" /> {b.id ? "Tenés cambios sin guardar." : "Perfil nuevo: elegí sus pantallas y permisos y guardalo."}</span>
                  : <span className="text-slate-400">Sin cambios.</span>}
              </div>
              {sucio && b.id ? (
                <button type="button" onClick={() => actual && abrir(dePerfil(actual))} disabled={!!busy} className={BOTON_SECUNDARIO}>Descartar</button>
              ) : null}
              {!b.id ? (
                <button type="button" onClick={() => { setB(null); setSel(null); if (perfiles?.length) abrir(dePerfil(perfiles[0])); }} disabled={!!busy} className={BOTON_SECUNDARIO}>Cancelar</button>
              ) : null}
              <button type="button" onClick={guardar} disabled={!!busy || !b.nombre.trim() || (!sucio && !!b.id)} className={BOTON_PRIMARIO} style={{ backgroundColor: TEAL }}>
                {busy === "guardar" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {b.id ? "Guardar cambios" : "Crear perfil"}
              </button>
            </div>
          ) : null}
        </div>
      )}

      {pendiente ? (
        <CapaModal onClose={() => setPendiente(null)} z="z-[120]">
          <div role="alertdialog" aria-modal="true" className={`w-full max-w-sm ${ALTO_MAX_MODAL} overflow-hidden rounded-2xl bg-white p-5 shadow-2xl`} style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
            <p className="text-base font-semibold text-slate-900">¿Descartar los cambios?</p>
            <p className="mt-1 text-sm text-slate-500">Hay cambios sin guardar en &ldquo;{b?.nombre || "el perfil"}&rdquo;.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setPendiente(null)} className={BOTON_SECUNDARIO}>Seguir editando</button>
              <button type="button" onClick={() => { const f = pendiente; setPendiente(null); f(); }} className={BOTON_PRIMARIO} style={{ backgroundColor: "#e11d48" }}>Descartar</button>
            </div>
          </div>
        </CapaModal>
      ) : null}

      {confirmarEliminar && b ? (
        <CapaModal onClose={busy ? undefined : () => setConfirmarEliminar(false)} z="z-[120]">
          <div role="alertdialog" aria-modal="true" className={`w-full max-w-sm ${ALTO_MAX_MODAL} overflow-hidden rounded-2xl bg-white p-5 shadow-2xl`} style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
            <p className="text-base font-semibold text-slate-900">Eliminar &ldquo;{b.nombre}&rdquo;</p>
            <p className="mt-1 text-sm text-slate-500">Nadie lo usa. Queda registrado en el historial.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmarEliminar(false)} disabled={!!busy} className={BOTON_SECUNDARIO}>Cancelar</button>
              <button type="button" onClick={eliminar} disabled={!!busy} className={BOTON_PRIMARIO} style={{ backgroundColor: "#e11d48" }}>
                {busy === "eliminar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Eliminar
              </button>
            </div>
          </div>
        </CapaModal>
      ) : null}

      {verHistorial && b?.id ? (
        <ModalDocumento titulo={<><History className="h-5 w-5 text-[var(--brand)]" /> Historial de {b.nombre}</>} subtitulo="Quién cambió qué en este perfil" ancho="max-w-lg" onClose={() => setVerHistorial(false)}>
          <Historial perfilId={b.id} />
        </ModalDocumento>
      ) : null}
    </div>
  );
}

function FilaPantalla({ p, nivel, marcada, soloLectura, onClick, icono, sub = false }: {
  p: Pantalla; nivel: string; marcada: boolean; soloLectura: boolean; onClick: () => void; icono?: React.ReactNode; sub?: boolean;
}) {
  const aplica = pantallaAplica(p, nivel);
  const hab = !soloLectura && aplica;
  return (
    <div className={`-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-1 transition-colors ${hab ? "cursor-pointer hover:bg-slate-50" : ""}`} onClick={() => hab && onClick()}>
      <span onClick={(e) => e.stopPropagation()}>
        <Casilla estado={marcada && (aplica || soloLectura)} disabled={!hab} onClick={onClick} etiqueta={p.label} />
      </span>
      {icono}
      <span className="min-w-0">
        <span className={`block truncate ${sub ? "text-[13px]" : "text-sm font-medium"} ${aplica || soloLectura ? "text-slate-700" : "text-slate-400"}`}>{p.label}</span>
        {!aplica && !soloLectura ? <span className="block text-[10px] text-slate-400">{soloNiveles(p.niveles)}</span>
          : p.permiso ? <span className="block text-[10px] text-slate-400">Necesita el permiso &ldquo;{permisoDef(p.permiso)?.label}&rdquo;</span> : null}
      </span>
    </div>
  );
}
