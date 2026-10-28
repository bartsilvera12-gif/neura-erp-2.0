"use client";

/**
 * /inventario/recetas — Recetas (receta 72): los productos Menú y las preparaciones (materias
 * primas con receta) con su costo calculado, precio, margen, porciones posibles en el depósito
 * del usuario y estado (completa / sin receta / falta ingrediente). Tocar una fila abre el editor
 * (CapaModal). "Nueva preparación" elige una materia prima para cargarle su receta.
 * /inventario/recetas?producto=<id> abre directo el editor de ese producto (desde la ficha).
 */
import { useEffect, useMemo, useState } from "react";
import { ChefHat, Loader2, Plus, Search, X } from "lucide-react";
import { clienteConfig } from "@/cliente.config";
import { tienePermiso, useUsuario } from "@/lib/sesion/ContextoUsuario";
import { buscar } from "@/lib/busqueda";
import { Select } from "@/components/Select";
import { AccionesPagina, BarraFiltros, EncabezadoPagina, GrillaKpis } from "@/components/EncabezadoPagina";
import { TablaTarjetas, type ColumnaTabla } from "@/components/TablaResponsive";
import { invalidarLista, useListaCacheada } from "@/modules/inventario/lista-cache";
import { BuscadorProductos } from "@/modules/compras/partes";
import { ModalDocumento, Pestanas } from "@/modules/inventario/ui";
import { RecetaEditor } from "@/modules/inventario/RecetaEditor";
import { ExtrasComunes } from "@/modules/inventario/ExtrasComunes";
import {
  ESTADOS_RECETA, cant, colorMargen, gs, margenPct, precioFinal, unidadCorta,
  type FilaReceta, type ListaRecetas,
} from "@/modules/inventario/recetas";

const TEAL = clienteConfig.color;

export default function RecetasPage() {
  const me = useUsuario();
  const puedeEditar = tienePermiso(me, "editar_productos");
  const [recarga, setRecarga] = useState(0);
  const { datos, cargando, error } = useListaCacheada<ListaRecetas>("/api/inventario/recetas", recarga);
  const [busqueda, setBusqueda] = useState("");
  const [estado, setEstado] = useState("");
  const [tipo, setTipo] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);
  const [eligiendo, setEligiendo] = useState(false);
  // Receta 73: "Extras" = la lista común de extras de los platos.
  const [vista, setVista] = useState<"recetas" | "extras">("recetas");

  // ?producto=<id> (desde la ficha del producto): abre su receta. ?vista=extras: la lista de extras.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const id = sp.get("producto");
    if (id && /^[0-9a-f-]{36}$/i.test(id)) setAbierto(id);
    if (sp.get("vista") === "extras") setVista("extras");
  }, []);

  const todas = useMemo(() => datos?.items ?? [], [datos]);
  const filas = useMemo(() => {
    let l = todas;
    if (estado) l = l.filter((f) => f.estado === estado);
    if (tipo) l = l.filter((f) => f.tipo === tipo);
    return busqueda.trim() ? buscar(l, busqueda, (f) => ({ principal: f.nombre, codigos: [f.sku] })) : l;
  }, [todas, estado, tipo, busqueda]);
  const cuenta = useMemo(() => ({
    completa: todas.filter((f) => f.estado === "completa").length,
    sin_receta: todas.filter((f) => f.estado === "sin_receta").length,
    faltante: todas.filter((f) => f.estado === "faltante").length,
  }), [todas]);

  function guardado() {
    invalidarLista("/api/inventario/recetas");
    invalidarLista("/api/productos");
    setRecarga((k) => k + 1);
  }

  const columnas = useMemo<ColumnaTabla<FilaReceta>[]>(() => [
    {
      key: "producto", titulo: "Producto", movil: "titulo", claseTh: "!pl-5", claseTd: "!pl-5",
      celda: (f) => (
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-xs font-semibold text-slate-500">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {f.imagen_url ? <img src={f.imagen_url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" /> : f.nombre.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-slate-900">{f.nombre}</p>
            <p className="font-mono text-[11px] font-normal text-slate-500">
              {f.sku}
              {f.modificadores ? <span className="ml-1.5 rounded-full bg-violet-50 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-violet-700 ring-1 ring-violet-200">Con modificadores</span> : null}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "tipo", titulo: "Tipo", movil: "chip",
      celda: (f) => (
        <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${f.tipo === "menu" ? "bg-orange-50 text-orange-700 ring-orange-200" : "bg-lime-50 text-lime-800 ring-lime-200"}`}>
          {f.tipo === "menu" ? "Menú" : `Preparación · ${unidadCorta(f.unidad_medida)}`}
        </span>
      ),
    },
    {
      key: "estado", titulo: "Estado", movil: "chip",
      celda: (f) => (
        <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${ESTADOS_RECETA[f.estado].chip}`} title={f.faltan ? `Falta: ${f.faltan}` : undefined}>
          {ESTADOS_RECETA[f.estado].label}
        </span>
      ),
    },
    {
      key: "costo", titulo: "Costo", movil: "dato", claseTh: "text-right", claseTd: "whitespace-nowrap text-right tabular-nums text-slate-700 max-md:text-left",
      celda: (f) => {
        if (f.costo == null) return <span className="text-slate-300">—</span>;
        // Receta 74: con grupos obligatorios cuyas opciones llevan ingredientes, "desde" la opción más barata.
        if (f.costo_desde != null) {
          return (
            <span title={`Base ${gs(f.costo)} · con opciones de ${gs(f.costo_desde)} a ${gs(f.costo_hasta ?? f.costo_desde)}`}>
              <span className="text-[10px] text-slate-400">desde </span>{gs(f.costo_desde)}<span className="text-[10px] text-slate-400"> /porc.</span>
              <span className="block text-[10px] text-slate-400">base {gs(f.costo)}{f.costo_hasta != null && f.costo_hasta !== f.costo_desde ? ` · hasta ${gs(f.costo_hasta)}` : ""}</span>
            </span>
          );
        }
        return <>{gs(f.costo)}<span className="text-[10px] text-slate-400"> /{f.tipo === "menu" ? "porc." : unidadCorta(f.unidad_medida)}</span></>;
      },
    },
    {
      key: "precio", titulo: "Precio", movil: "valor", claseTh: "text-right", claseTd: "whitespace-nowrap text-right font-semibold tabular-nums text-slate-900",
      celda: (f) => (f.tipo === "menu" ? gs(precioFinal(f.precio_venta, f.descuento_pct)) : <span className="text-xs font-medium text-slate-400">No se vende</span>),
    },
    {
      key: "margen", titulo: "Margen", movil: "dato", claseTh: "text-right", claseTd: "whitespace-nowrap text-right font-semibold tabular-nums max-md:text-left",
      celda: (f) => {
        if (f.tipo !== "menu" || f.costo == null) return <span className="text-slate-300">—</span>;
        // Receta 74: con opciones que cambian el costo, el margen con la opción más cara (peor caso).
        const m = margenPct(f.costo_hasta ?? f.costo, precioFinal(f.precio_venta, f.descuento_pct));
        return <span className={colorMargen(m)} title={f.costo_hasta != null ? "Con la opción más cara" : undefined}>{m == null ? "—" : `${m.toFixed(1).replace(".", ",")} %`}</span>;
      },
    },
    {
      key: "porciones", titulo: "Alcanza para", movil: "dato", claseTh: "text-right", claseTd: "whitespace-nowrap text-right tabular-nums max-md:text-left",
      celda: (f) => {
        if (f.estado === "sin_receta") return <span className="text-xs text-slate-400">Cargá su receta</span>;
        if (f.porciones == null) return <span className="text-xs text-slate-400">sin límite</span>;
        return (
          <span className={f.porciones <= 0 ? "font-semibold text-rose-600" : "text-slate-700"} title={f.faltan ? `Falta: ${f.faltan}` : undefined}>
            {cant(f.porciones, 0)} {f.tipo === "menu" ? "porc." : unidadCorta(f.unidad_medida)}
          </span>
        );
      },
    },
    {
      key: "faltan", titulo: "Falta", movil: "detalle", claseTd: "max-w-[14rem] truncate text-xs text-rose-700 max-md:max-w-none max-md:whitespace-normal",
      celda: (f) => f.faltan ?? <span className="text-slate-300">—</span>,
    },
  ], []);

  const hayFiltros = !!(busqueda || estado || tipo);
  const input = "h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)] md:h-10";

  const vacio = (
    <div className="px-5 py-14 text-center">
      {cargando && !datos ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" />
      : error ? <p className="text-sm text-rose-600">No se pudieron cargar las recetas (se necesita el permiso «Ver costos y márgenes»). Probá de nuevo.</p>
      : (
        <>
          <ChefHat className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm font-medium text-slate-700">{hayFiltros ? "Ninguna receta coincide con los filtros" : "Todavía no hay platos ni preparaciones"}</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
            {hayFiltros ? "Probá con otra búsqueda o cambiá los filtros." : "Creá tus platos en Productos con el tipo «Menú» y tus insumos como «Materia prima»; después cargá acá la receta de cada plato."}
          </p>
        </>
      )}
    </div>
  );

  return (
    <div className="space-y-5 pb-10 sm:space-y-6">
      <EncabezadoPagina
        volver={{ href: "/inventario/panel", label: "Inventario" }}
        kicker="Inventario · Cocina"
        titulo="Recetas"
        subtitulo="Ingredientes, merma y costo de cada plato. Al vender se descuentan los ingredientes; si falta uno, no se vende."
        acciones={puedeEditar && vista === "recetas" ? (
          <AccionesPagina acciones={[{ etiqueta: "Nueva preparación", icono: <Plus />, onClick: () => setEligiendo(true) }]} />
        ) : undefined}
      />

      <Pestanas valor={vista} onChange={(v) => setVista(v as typeof vista)}
        opciones={[{ id: "recetas", label: "Platos y preparaciones" }, { id: "extras", label: "Extras" }]} />

      {vista === "extras" ? (
        <section className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: `${TEAL}33` }}>
          <ExtrasComunes puedeEditar={puedeEditar} />
        </section>
      ) : (
      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: `${TEAL}33` }}>
        <div className="border-b px-3 py-3 sm:px-5" style={{ borderColor: `${TEAL}22`, background: `linear-gradient(to right, ${TEAL}0d, transparent)` }}>
          <GrillaKpis columnas={3} className="lg:max-w-3xl">
            <Kpi color="bg-emerald-500" etiqueta="Completas" valor={cuenta.completa} onClick={() => setEstado(estado === "completa" ? "" : "completa")} activo={estado === "completa"} />
            <Kpi color="bg-rose-500" etiqueta="Falta ingrediente" valor={cuenta.faltante} onClick={() => setEstado(estado === "faltante" ? "" : "faltante")} activo={estado === "faltante"} />
            <Kpi color="bg-slate-400" etiqueta="Sin receta" valor={cuenta.sin_receta} onClick={() => setEstado(estado === "sin_receta" ? "" : "sin_receta")} activo={estado === "sin_receta"} />
          </GrillaKpis>
          <p className="mt-2 text-[11px] text-slate-400">
            Porciones con el stock de {datos?.deposito ? <strong className="font-semibold text-slate-500">{datos.deposito}</strong> : "tu depósito"} · costos con IVA incluido
          </p>
        </div>

        <div className="border-b border-slate-100 bg-slate-50/40 px-3 py-3 sm:px-5 sm:py-4">
          <BarraFiltros
            plano
            activos={(estado ? 1 : 0) + (tipo ? 1 : 0)}
            onLimpiar={() => { setBusqueda(""); setEstado(""); setTipo(""); }}
            busqueda={
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input type="search" enterKeyHint="search" aria-label="Buscar recetas" placeholder="Buscar plato o preparación..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} className={`${input} w-full pl-9 pr-10`} />
                {busqueda ? (
                  <button onClick={() => setBusqueda("")} aria-label="Limpiar búsqueda" className="absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            }
          >
            <Select value={tipo} onChange={setTipo} minWidth={180} etiqueta="Tipo" options={[["", "Platos y preparaciones"], ["menu", "Solo platos (Menú)"], ["preparacion", "Solo preparaciones"]]} />
            <Select value={estado} onChange={setEstado} minWidth={180} etiqueta="Estado" options={[["", "Todos los estados"], ["completa", "Completas"], ["faltante", "Falta ingrediente"], ["sin_receta", "Sin receta"]]} />
          </BarraFiltros>
        </div>

        {(cargando && !datos) || error ? vacio : (
          <TablaTarjetas
            filas={filas}
            columnas={columnas}
            claveFila={(f) => f.id}
            onFila={(f) => setAbierto(f.id)}
            cargando={cargando}
            minAncho={860}
            vacio={vacio}
            claseTabla="w-full text-left text-sm"
            claseThead="bg-slate-50/70"
            thBase="whitespace-nowrap px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500"
            tdBase="px-3 py-3"
            claseFila={() => "cursor-pointer hover:bg-[var(--brand-50)]"}
          />
        )}
        {filas.length ? (
          <p className="border-t border-slate-100 px-3 py-2.5 text-[11px] text-slate-500 sm:px-5">
            {filas.length} {filas.length === 1 ? "receta" : "recetas"}. Tocá una para ver o editar sus ingredientes, extras y opciones. Una preparación (ej. salsa) se usa como ingrediente y se descuenta en sus materias primas.
          </p>
        ) : null}
      </section>
      )}

      {abierto ? (
        <RecetaEditor productoId={abierto} puedeEditar={puedeEditar} onClose={() => setAbierto(null)} onGuardado={guardado} />
      ) : null}

      {eligiendo ? (
        <ModalDocumento ancho="max-w-lg" titulo="Nueva preparación" subtitulo="Elegí la materia prima que se prepara en la cocina (ej. Salsa de la casa)" onClose={() => setEligiendo(false)}>
          <div className="space-y-3 pb-2">
            <BuscadorProductos tipo="materia_prima" onElegir={(p) => { setEligiendo(false); setAbierto(p.id); }} />
            <p className="text-[11px] leading-relaxed text-slate-500">
              Si todavía no existe, creala en <strong>Productos</strong> como «Materia prima» con su unidad (kg, l, unidad) y stock en 0: una preparación con receta no lleva stock propio.
              Para un plato nuevo, creá el producto con el tipo «Menú»: aparece acá para cargarle la receta.
            </p>
          </div>
        </ModalDocumento>
      ) : null}
    </div>
  );
}

function Kpi({ color, etiqueta, valor, onClick, activo }: { color: string; etiqueta: string; valor: number; onClick: () => void; activo: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={activo}
      className={`min-w-0 rounded-xl border bg-white px-3 py-2.5 text-left transition hover:border-[var(--brand)] max-sm:min-h-11 ${activo ? "border-[var(--brand)] ring-2 ring-[var(--brand-100)]" : "border-slate-200"}`}>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${color}`} /> <span className="truncate">{etiqueta}</span>
      </p>
      <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-slate-900">{valor}</p>
    </button>
  );
}
