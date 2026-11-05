"use client";

/**
 * /configuracion/funciones — Rubro y funciones (receta 75).
 * Arriba el rubro (Comercio / Gastronomía / Sorteos, tarjetas seleccionables); debajo un interruptor por
 * función (Mesas y QR, Cocina y estaciones, Recetas e ingredientes, y — receta 77 — Pedidos de
 * mostrador, independiente del rubro). Elegir un rubro aplica su
 * preset; si después se ajusta una función y no coincide con ninguno: "Personalizado".
 * Solo el Administrador guarda (la base lo vuelve a exigir). Apagar no borra nada.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Blocks, Check, ChevronDown, Building2, ChefHat, ClipboardList, Dumbbell, Loader2, QrCode, Sparkles, Store, Ticket, UtensilsCrossed, BookOpen, X } from "lucide-react";
import type { ReactNode } from "react";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { CapaModal, ALTO_MAX_MODAL } from "@/components/CapaModal";
import { apiFetch } from "@/lib/api/client-fetch";
import { recargarUsuario } from "@/lib/sesion/ContextoUsuario";
import { Aviso, Interruptor, Tarjeta } from "@/modules/facturacion/ui";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO } from "@/modules/inventario/ui";
import { MODULOS_APAGADOS_RUBRO, MODULOS_RUBRO, rubroDe, URL_FUNCIONES, type FuncionesEmpresa, type FuncionPantalla, type ModuloRubroId, type Rubro } from "@/modules/configuracion/funciones";
import { pantallasCatalogo } from "@/modules/registry";

type Borrador = { mesas: boolean; cocina: boolean; recetas: boolean; pedidos: boolean; sorteos: boolean; inmobiliaria: boolean; gimnasio: boolean; modulos_apagados: ModuloRubroId[] };

const RUBROS: { key: Exclude<Rubro, "personalizado">; titulo: string; ejemplos: string; resumen: string; Icono: typeof Store }[] = [
  {
    key: "comercio",
    titulo: "Comercio",
    ejemplos: "Ferretería, almacén, tienda",
    resumen: "Suma pedidos de mostrador. Sin mesas, cocina ni recetas.",
    Icono: Store,
  },
  {
    key: "gastronomia",
    titulo: "Gastronomía",
    ejemplos: "Restaurante, bar, pizzería",
    resumen: "Suma mesas con QR, pedidos, pantalla de cocina por estación y recetas con ingredientes.",
    Icono: UtensilsCrossed,
  },
  {
    key: "sorteos",
    titulo: "Sorteos",
    ejemplos: "Rifas, sorteos de motos, autos, premios",
    resumen: "Venta de boletas por combos, por WhatsApp, web y vendedores; cupones para la urna, premios y sorteo verificable.",
    Icono: Ticket,
  },
  {
    key: "inmobiliaria",
    titulo: "Inmobiliaria",
    ejemplos: "Venta y alquiler de casas, lotes, locales",
    resumen: "Propiedades con su ficha (ciudad, m², catastro, lote, documentación), propias o de un dueño, para vender o alquilar.",
    Icono: Building2,
  },
  {
    key: "gimnasio",
    titulo: "Gimnasio",
    ejemplos: "Gimnasio, natación, artes marciales, academias",
    resumen: "Clases con cupo y horario, turnos individuales, recepción con control de deuda, membresías con clases por mes y comisión de profesores.",
    Icono: Dumbbell,
  },
  {
    key: "neura",
    titulo: "Neura",
    ejemplos: "Uso interno de Neura",
    resumen: "Todas las pantallas de todos los rubros, más Soporte.",
    Icono: Sparkles,
  },
];

const PRESET: Record<Exclude<Rubro, "personalizado">, Borrador> = {
  comercio: { mesas: false, cocina: false, recetas: false, pedidos: true, sorteos: false, inmobiliaria: false, gimnasio: false, modulos_apagados: MODULOS_APAGADOS_RUBRO.comercio },
  gastronomia: { mesas: true, cocina: true, recetas: true, pedidos: false, sorteos: false, inmobiliaria: false, gimnasio: false, modulos_apagados: MODULOS_APAGADOS_RUBRO.gastronomia },
  sorteos: { mesas: false, cocina: false, recetas: false, pedidos: false, sorteos: true, inmobiliaria: false, gimnasio: false, modulos_apagados: MODULOS_APAGADOS_RUBRO.sorteos },
  inmobiliaria: { mesas: false, cocina: false, recetas: false, pedidos: false, sorteos: false, inmobiliaria: true, gimnasio: false, modulos_apagados: MODULOS_APAGADOS_RUBRO.inmobiliaria },
  neura: { mesas: true, cocina: true, recetas: true, pedidos: true, sorteos: true, inmobiliaria: true, gimnasio: true, modulos_apagados: MODULOS_APAGADOS_RUBRO.neura },
  gimnasio: { mesas: false, cocina: false, recetas: false, pedidos: false, sorteos: false, inmobiliaria: false, gimnasio: true, modulos_apagados: MODULOS_APAGADOS_RUBRO.gimnasio },
};

const deEmpresa = (d: FuncionesEmpresa): Borrador => ({
  mesas: d.mesas, cocina: d.cocina, recetas: d.recetas, pedidos: d.pedidos !== false, sorteos: !!d.sorteos, inmobiliaria: !!d.inmobiliaria, gimnasio: !!d.gimnasio,
  modulos_apagados: d.modulos_apagados ?? [],
});

/**
 * Sección que se despliega: cerrada muestra solo el título y cuántas cosas están prendidas,
 * para que la pantalla no abrume. Tocar la cabecera la abre o la cierra.
 */
function Plegable({ icono, titulo, resumen, detalle, children }: { icono: ReactNode; titulo: string; resumen: string; detalle: string; children: ReactNode }) {
  const [abierta, setAbierta] = useState(false);
  return (
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <button type="button" onClick={() => setAbierta((x) => !x)} aria-expanded={abierta}
        className="flex min-h-[64px] w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-colors hover:bg-slate-50 sm:px-5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--brand-50,#eef7f7)] text-[var(--brand)]">{icono}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-900">{titulo}</span>
          <span className="block text-xs text-slate-500">{resumen}</span>
        </span>
        <ChevronDown aria-hidden className={`h-5 w-5 shrink-0 text-slate-400 transition-transform duration-200 ${abierta ? "rotate-180" : ""}`} />
      </button>
      {abierta ? (
        <div className="border-t border-slate-100 px-4 pb-4 pt-3 sm:px-5 sm:pb-5">
          <p className="mb-3 text-xs leading-relaxed text-slate-500">{detalle}</p>
          {children}
        </div>
      ) : null}
    </section>
  );
}

const prendidas = (n: number, total: number, o = "a") => (n === total ? `Tod${o}s prendid${o}s (${total})` : n === 0 ? `Tod${o}s apagad${o}s` : `${n} de ${total} prendid${o}s`);

/** Para comparar el borrador con lo guardado (la lista de módulos, sin importar el orden). */
const huella = (b: Borrador) => JSON.stringify({ ...b, modulos_apagados: [...b.modulos_apagados].sort() });

const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;

/** Las pantallas propias de un rubro salen del menú real: lo que dice acá es lo que se ve. */
function pantallasDelRubro(r: Exclude<Rubro, "personalizado">) {
  const preset = PRESET[r];
  const propias = (Object.keys(preset) as (keyof Borrador)[]).filter((k) => k !== "modulos_apagados" && preset[k]);
  const catalogo = pantallasCatalogo();
  return propias.flatMap((f) => catalogo.filter((p) => p.funcion === (f as FuncionPantalla)).map((p) => p.label));
}

/** Receta 138: módulos que el rubro deja apagados. */
const apagadosDelRubro = (r: Exclude<Rubro, "personalizado">) =>
  MODULOS_APAGADOS_RUBRO[r].map((id) => MODULOS_RUBRO.find((m) => m.id === id)?.label ?? id);

export default function RubroFuncionesPage() {
  const [cfg, setCfg] = useState<FuncionesEmpresa | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [b, setB] = useState<Borrador>(PRESET.comercio);
  const [guardando, setGuardando] = useState(false);
  const [errGuardar, setErrGuardar] = useState<string | null>(null);
  const [okGuardar, setOkGuardar] = useState<string | null>(null);
  const [confirmarRecetas, setConfirmarRecetas] = useState<number | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const d = await apiFetch<FuncionesEmpresa>(URL_FUNCIONES);
      setCfg(d);
      setB(deEmpresa(d));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  const rubro = rubroDe(b);
  const cambios = !!cfg && huella(deEmpresa(cfg)) !== huella(b);
  const soloLectura = !cfg?.puede_editar;
  const abiertas = (cfg?.cuentas_abiertas ?? 0) + (cfg?.pedidos_sin_cerrar ?? 0);
  const bloqueaMesas = !!cfg && cfg.mesas && !b.mesas && abiertas > 0;

  const tocar = (p: Partial<Borrador>) => {
    setB((x) => {
      const n = { ...x, ...p };
      if (!n.mesas) n.cocina = false; // Cocina requiere Mesas
      return n;
    });
    setErrGuardar(null);
    setOkGuardar(null);
  };

  async function guardar(confirmar = false) {
    if (!cfg) return;
    if (!confirmar && cfg.recetas && !b.recetas && (cfg.productos_recetas ?? 0) > 0) {
      setConfirmarRecetas(cfg.productos_recetas ?? 0);
      return;
    }
    setGuardando(true);
    setErrGuardar(null);
    try {
      const d = await apiFetch<FuncionesEmpresa>(URL_FUNCIONES, {
        method: "PUT",
        body: JSON.stringify({ ...b, ...(confirmar ? { confirmar_recetas: true } : {}) }),
      });
      setCfg(d);
      setB(deEmpresa(d));
      setConfirmarRecetas(null);
      setOkGuardar("Funciones guardadas. El menú ya se actualizó.");
      recargarUsuario();
      setTimeout(() => setOkGuardar(null), 4000);
    } catch (e) {
      setConfirmarRecetas(null);
      setErrGuardar((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  const encabezado = (
    <EncabezadoPagina
      volver={{ href: "/configuracion", label: "Configuración" }}
      kicker="Configuración"
      titulo="Rubro y funciones"
      subtitulo="Elegí el tipo de negocio y prendé solo lo que usás. Apagar una función no borra nada: si la volvés a prender, todo queda como estaba."
    />
  );

  if (cargando && !cfg) {
    return (
      <div className="space-y-5 pb-10">
        {encabezado}
        {[0, 1].map((i) => <div key={i} className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}
      </div>
    );
  }
  if (error && !cfg) {
    return (
      <div className="space-y-5 pb-10">
        {encabezado}
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 sm:flex-row sm:items-center">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span className="min-w-0 flex-1">{error}</span>
          <button type="button" onClick={cargar} className={`${BOTON_SECUNDARIO} max-sm:min-h-11 max-sm:w-full`}>Reintentar</button>
        </div>
      </div>
    );
  }
  if (!cfg) return null;

  return (
    <div className="space-y-5 pb-28 sm:pb-10">
      {encabezado}

      {cfg.ocultas ? (
        <Aviso tono="alerta">Esta sección la administra Neura para tu empresa: no se puede cambiar desde acá.</Aviso>
      ) : soloLectura ? (
        <Aviso tono="alerta">Podés ver esta configuración, pero cambiarla es solo para el Administrador.</Aviso>
      ) : null}

      {/* ── Rubro ─────────────────────────────────────────────────────────── */}
      <Tarjeta
        icono={<Store className="h-4 w-4" />}
        titulo="Rubro"
        detalle="Aplica las funciones típicas del rubro. Después podés ajustar cada una."
        acciones={rubro === "personalizado" ? <span className="inline-flex items-center justify-center rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-900 ring-1 ring-violet-200">Personalizado</span> : null}
      >
        <div role="radiogroup" aria-label="Rubro" className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {RUBROS.map((r) => {
            const sel = rubro === r.key;
            const trae = r.key === "neura" ? [] : pantallasDelRubro(r.key);
            // Soporte es de uso interno de Neura: no hace falta repetir en cada rubro que no lo trae.
            const noTrae = apagadosDelRubro(r.key).filter((x) => x !== "Soporte");
            return (
              <button
                key={r.key}
                type="button"
                role="radio"
                aria-checked={sel}
                disabled={soloLectura || guardando}
                onClick={() => tocar(PRESET[r.key])}
                className={`flex h-full min-h-11 flex-col rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed ${sel ? "border-[var(--brand)] bg-[var(--brand-50,#eef7f7)] ring-2 ring-[var(--brand-100)]" : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"} ${soloLectura && !sel ? "opacity-60" : ""}`}
              >
                <span className="flex w-full items-start gap-3">
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${sel ? "bg-[var(--brand)] text-white" : "bg-slate-100 text-slate-500"}`}>
                    <r.Icono className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold text-slate-900">{r.titulo}</span>
                    <span className="block text-xs text-slate-500">{r.ejemplos}</span>
                  </span>
                  <span aria-hidden className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${sel ? "border-[var(--brand)] bg-[var(--brand)]" : "border-slate-300 bg-white"}`}>
                    {sel ? <Check className="h-3 w-3 text-white" strokeWidth={3} /> : null}
                  </span>
                </span>
                <span className="mt-3 block text-[13px] leading-relaxed text-slate-600">{r.resumen}</span>
                <span className="mt-auto block w-full pt-3">
                  <span className="block border-t border-slate-200/80 pt-3">
                    {trae.length ? (
                      <span className="flex flex-wrap gap-1.5">
                        {trae.map((p) => (
                          <span key={p} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${sel ? "bg-white text-[var(--brand)] ring-1 ring-[var(--brand-100)]" : "bg-slate-100 text-slate-600"}`}>{p}</span>
                        ))}
                      </span>
                    ) : (
                      <span className="block text-xs font-medium text-slate-500">{r.key === "neura" ? "Incluye Soporte" : "Solo lo básico: caja, ventas, stock y clientes"}</span>
                    )}
                    {noTrae.length ? <span className="mt-2 block text-[11px] text-slate-400">Sin {noTrae.join(", ")}</span> : null}
                  </span>
                </span>
              </button>
            );
          })}
        </div>      </Tarjeta>

      {/* ── Funciones ─────────────────────────────────────────────────────── */}
      <Plegable icono={<Sparkles className="h-4 w-4" />} titulo="Funciones"
        resumen={prendidas([b.mesas, b.cocina, b.recetas, b.pedidos, b.sorteos, b.inmobiliaria, b.gimnasio].filter(Boolean).length, 7)}
        detalle="La Caja, el inventario y las compras funcionan igual con todo apagado. Al prender Mesas y QR o Cocina, los perfiles Cajero y Supervisor ya las reciben; con Sorteos, también el Vendedor. Recetas y Producción quedan para el Administrador. Se ajusta en Usuarios › Perfiles y permisos.">
        <div className="space-y-2.5">
          <Interruptor
            activo={b.mesas}
            disabled={soloLectura || guardando}
            onChange={(v) => tocar({ mesas: v })}
            etiqueta={<span className="inline-flex items-center gap-1.5"><QrCode className="h-4 w-4 text-slate-400" aria-hidden /> Mesas y QR</span>}
            descripcion="Mesas con su QR, menú público para pedir desde el celular, Caja › Pedidos de mesas y cuentas abiertas."
          />
          {bloqueaMesas ? (
            <Aviso tono="error">
              Cobrá o liberá las mesas abiertas primero: hay {cfg.cuentas_abiertas ? plural(cfg.cuentas_abiertas, "cuenta de mesa abierta", "cuentas de mesa abiertas") : plural(cfg.pedidos_sin_cerrar ?? 0, "pedido sin cerrar", "pedidos sin cerrar")}.
            </Aviso>
          ) : null}
          <Interruptor
            activo={b.cocina}
            disabled={soloLectura || guardando || !b.mesas}
            onChange={(v) => tocar({ cocina: v })}
            etiqueta={<span className="inline-flex items-center gap-1.5"><ChefHat className="h-4 w-4 text-slate-400" aria-hidden /> Cocina y estaciones</span>}
            descripcion={b.mesas ? "Pantalla de cocina, estaciones (Plancha, Barra…) y comanda impresa." : "Necesita Mesas y QR prendida."}
          />
          <Interruptor
            activo={b.recetas}
            disabled={soloLectura || guardando}
            onChange={(v) => tocar({ recetas: v })}
            etiqueta={<span className="inline-flex items-center gap-1.5"><BookOpen className="h-4 w-4 text-slate-400" aria-hidden /> Recetas e ingredientes</span>}
            descripcion="Tipos de producto Menú, Materia prima y Fabricado, recetas con merma, extras y opciones de los platos, y Producción (fabricar por tanda)."
          />
          <Interruptor
            activo={b.pedidos}
            disabled={soloLectura || guardando}
            onChange={(v) => tocar({ pedidos: v })}
            etiqueta={<span className="inline-flex items-center gap-1.5"><ClipboardList className="h-4 w-4 text-slate-400" aria-hidden /> Pedidos de mostrador</span>}
            descripcion="El vendedor arma el pedido en Caja › Pedidos y lo envía a caja con un número; la caja lo cobra. Sirve para cualquier rubro (ferretería, tienda…)."
          />
          <Interruptor
            activo={b.sorteos}
            disabled={soloLectura || guardando}
            onChange={(v) => tocar({ sorteos: v })}
            etiqueta={<span className="inline-flex items-center gap-1.5"><Ticket className="h-4 w-4 text-slate-400" aria-hidden /> Sorteos</span>}
            descripcion="Sorteos con combos, venta manual, por la web y por vendedores con link y PIN, cupones para la urna, premios y sorteo digital verificable. Al prenderla, Supervisor, Cajero y Vendedor ya pueden vender."
          />
          <Interruptor
            activo={b.inmobiliaria}
            disabled={soloLectura || guardando}
            onChange={(v) => tocar({ inmobiliaria: v })}
            etiqueta={<span className="inline-flex items-center gap-1.5"><Building2 className="h-4 w-4 text-slate-400" aria-hidden /> Inmobiliaria</span>}
            descripcion="Propiedades para vender o alquilar con su ficha: ciudad y barrio, m² de terreno y construidos, cuenta catastral, finca, manzana y lote, documentación, y si son propias o de un dueño con su comisión. Al prenderla, Supervisor, Cajero y Vendedor ya ven las propiedades."
          />
          <Interruptor
            activo={b.gimnasio}
            disabled={soloLectura || guardando}
            onChange={(v) => tocar({ gimnasio: v })}
            etiqueta={<span className="inline-flex items-center gap-1.5"><Dumbbell className="h-4 w-4 text-slate-400" aria-hidden /> Gimnasio</span>}
            descripcion="Clases con horario y cupo, turnos individuales, recepción que marca la asistencia y frena a quien debe, membresías con clases por mes, clase suelta que se cobra en la caja y comisión de profesores. Al prenderla, Supervisor, Cajero y Vendedor ya atienden la recepción."
          />
        </div>
      </Plegable>

      {/* ── Módulos (receta 138) ─────────────────────────────────────────── */}
      <Plegable icono={<Blocks className="h-4 w-4" />} titulo="Módulos"
        resumen={prendidas(MODULOS_RUBRO.filter((m) => !b.modulos_apagados.includes(m.id)).length, MODULOS_RUBRO.length, "o")}
        detalle="El rubro deja prendidos solo los módulos que usa. Podés prender o apagar cada uno: apagar lo saca del menú, no borra nada. Configuración está siempre.">
        <div className="space-y-2.5">
          {MODULOS_RUBRO.map((m) => (
            <Interruptor
              key={m.id}
              activo={!b.modulos_apagados.includes(m.id)}
              disabled={soloLectura || guardando}
              onChange={(v) => tocar({ modulos_apagados: v ? b.modulos_apagados.filter((x) => x !== m.id) : [...b.modulos_apagados, m.id] })}
              etiqueta={m.label}
              descripcion={m.descripcion}
            />
          ))}
        </div>
      </Plegable>

      {errGuardar ? <Aviso tono="error">{errGuardar}</Aviso> : null}
      {okGuardar ? <Aviso tono="ok">{okGuardar}</Aviso> : null}

      {!soloLectura ? (
        <div className="max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-30 max-sm:border-t max-sm:border-slate-200 max-sm:bg-white/95 max-sm:px-4 max-sm:pt-3 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-sm:backdrop-blur sm:flex sm:justify-end">
          <div className="flex gap-2 max-sm:[&>*]:min-h-11 max-sm:[&>*]:flex-1">
            {cambios ? (
              <button type="button" disabled={guardando} onClick={() => { setB(deEmpresa(cfg)); setErrGuardar(null); }} className={BOTON_SECUNDARIO}>
                Descartar
              </button>
            ) : null}
            <button type="button" disabled={!cambios || guardando || bloqueaMesas} onClick={() => guardar()} className={`${BOTON_PRIMARIO} bg-[var(--brand)]`}>
              {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Guardar cambios
            </button>
          </div>
        </div>
      ) : null}

      {confirmarRecetas !== null ? (
        <CapaModal onClose={() => !guardando && setConfirmarRecetas(null)}>
          <div className={`flex w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-xl ${ALTO_MAX_MODAL}`} role="dialog" aria-modal="true" aria-labelledby="titulo-apagar-recetas">
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <h2 id="titulo-apagar-recetas" className="text-base font-semibold text-slate-900">¿Apagar Recetas e ingredientes?</h2>
              <button type="button" aria-label="Cerrar" onClick={() => setConfirmarRecetas(null)} disabled={guardando} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4 text-sm text-slate-600">
              <p>
                Tenés <span className="font-semibold text-slate-800">{plural(confirmarRecetas, "producto activo", "productos activos")}</span> de tipo Menú, Materia prima o Fabricado.
              </p>
              <p>Siguen existiendo y se pueden vender y editar con su tipo; solo se ocultan la pantalla de Recetas y el selector de tipo en los productos nuevos. Si la volvés a prender, todo queda como estaba.</p>
            </div>
            <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-100 px-5 py-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setConfirmarRecetas(null)} disabled={guardando} className={`${BOTON_SECUNDARIO} max-sm:min-h-11`}>Cancelar</button>
              <button type="button" onClick={() => guardar(true)} disabled={guardando} className={`${BOTON_PRIMARIO} bg-[var(--brand)] max-sm:min-h-11`}>
                {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Apagar y guardar
              </button>
            </div>
          </div>
        </CapaModal>
      ) : null}
    </div>
  );
}
