"use client";

/**
 * Tablas responsive del ERP. Dos patrones — CUÁNDO USAR CADA UNO:
 *
 * 1) `TablaTarjetas` — LISTAS de registros (clientes, productos, ventas, compras, usuarios,
 *    tickets…): en < 768 px cada fila es una TARJETA con los 3–4 datos clave arriba (título,
 *    subtítulo, valor destacado, chips) y el resto plegado en "Ver más"; en tablet/escritorio
 *    es la tabla de siempre. Úsala cuando la persona busca UN registro y lo abre / actúa sobre él.
 *
 *      <TablaTarjetas
 *        filas={rows} claveFila={(r) => r.id} onFila={(r) => abrir(r.id)}
 *        columnas={[
 *          { key: "nombre", titulo: "Nombre", celda: (r) => r.nombre, movil: "titulo" },
 *          { key: "ruc", titulo: "RUC", celda: (r) => r.ruc, movil: "subtitulo" },
 *          { key: "deuda", titulo: "Deuda", celda: (r) => gs(r.deuda), movil: "valor", claseTd: "text-right" },
 *          { key: "estado", titulo: "Estado", celda: (r) => <Badge …/>, movil: "chip" },
 *          { key: "tel", titulo: "Teléfono", celda: (r) => r.tel, movil: "dato" },      // visible, con etiqueta
 *          { key: "email", titulo: "Email", celda: (r) => r.email },                    // (por defecto) "detalle": plegado
 *          { key: "acc", titulo: "", celda: (r) => <Acciones …/>, movil: "acciones" },
 *        ]}
 *      />
 *    Roles en la tarjeta (`movil`): titulo · subtitulo · valor (arriba a la derecha) · chip (fila
 *    de chips) · dato (grilla 2 col. siempre visible, máx. 4) · detalle (plegado, por defecto) ·
 *    acciones (pie de la tarjeta, no abre la fila) · oculto.
 *
 * 2) `TablaScroll` — tablas NATURALMENTE ANCHAS y numéricas (reportes, estados de cuenta,
 *    kardex, comparativos por mes): se mantiene la tabla en todas las pantallas, con scroll
 *    horizontal INTERNO dentro de su tarjeta (la página nunca scrollea de costado), primera
 *    columna fija y sombras en los bordes que indican que hay más.
 *
 *      <TablaScroll primeraFija minAncho={720}>
 *        <table className="w-full text-sm">…</table>
 *      </TablaScroll>
 *
 *    Regla práctica: si en el celular hay que COMPARAR columnas entre filas → TablaScroll; si
 *    hay que ENCONTRAR una fila y abrirla → TablaTarjetas.
 */
import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useMediaQuery } from "@/lib/ui/responsive";

/** Debajo de este ancho las listas se ven como tarjetas (tablet vertical ya ve la tabla). */
export const MQ_TARJETAS = "(max-width: 767.98px)";
export const useVistaTarjetas = () => useMediaQuery(MQ_TARJETAS);

export type RolMovil = "titulo" | "subtitulo" | "valor" | "chip" | "dato" | "detalle" | "acciones" | "oculto";

export type ColumnaTabla<T> = {
  key: string;
  /** encabezado de la tabla (y etiqueta en la tarjeta si es texto) */
  titulo: ReactNode;
  celda: (fila: T) => ReactNode;
  /** clases del <th> (alineación, ocultar en md: "hidden lg:table-cell"…) */
  claseTh?: string;
  /** clases del <td> */
  claseTd?: string;
  /** rol en la tarjeta móvil (por defecto "detalle": plegado en "Ver más") */
  movil?: RolMovil;
  /** etiqueta en la tarjeta si `titulo` no es texto */
  etiquetaMovil?: string;
  /** contenido distinto en la tarjeta (ej. más corto) */
  celdaMovil?: (fila: T) => ReactNode;
};

const TH_BASE = "whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500";
const TD_BASE = "px-3 py-2.5";

export function TablaTarjetas<T>({
  filas,
  columnas,
  claveFila,
  onFila,
  onIntencion,
  onSinIntencion,
  vacio,
  cargando = false,
  claseFila,
  claseTabla = "w-full text-sm",
  claseThead = "border-b border-slate-200 bg-slate-50/80",
  minAncho,
  forzar,
  thBase = TH_BASE,
  tdBase = TD_BASE,
}: {
  filas: T[];
  columnas: ColumnaTabla<T>[];
  claveFila: (fila: T) => string;
  /** tocar la fila / tarjeta (abrir ficha) */
  onFila?: (fila: T) => void;
  /** hover / pointerdown (prefetch) */
  onIntencion?: (fila: T, ya?: boolean) => void;
  /** el mouse salió de la fila (cancelar el prefetch) */
  onSinIntencion?: () => void;
  /** contenido cuando no hay filas (se muestra igual en tabla y tarjetas) */
  vacio?: ReactNode;
  /** atenúa las filas mientras llega la página nueva */
  cargando?: boolean;
  claseFila?: (fila: T) => string;
  claseTabla?: string;
  claseThead?: string;
  /** ancho mínimo de la tabla (≥ 768 px; si no entra, scroll interno) */
  minAncho?: number;
  /** forzar una vista (pruebas / pantallas que deciden solas) */
  forzar?: "tabla" | "tarjetas";
  /** clases base de cada <th> / <td> (las de la columna se suman) */
  thBase?: string;
  tdBase?: string;
}) {
  const esAngosta = useVistaTarjetas();
  const tarjetas = forzar ? forzar === "tarjetas" : esAngosta;

  if (!filas.length && vacio) return <>{vacio}</>;

  if (tarjetas) {
    return (
      <ul className={`divide-y divide-slate-100 ${cargando ? "opacity-60" : ""}`}>
        {filas.map((f) => (
          <TarjetaFila key={claveFila(f)} fila={f} columnas={columnas} onFila={onFila} onIntencion={onIntencion} clase={claseFila?.(f)} />
        ))}
      </ul>
    );
  }

  return (
    <TablaScroll minAncho={minAncho}>
      <table className={claseTabla}>
        <thead className={claseThead}>
          <tr>
            {columnas.map((c) => <th key={c.key} scope="col" className={`${thBase} ${c.claseTh ?? ""}`}>{c.titulo}</th>)}
          </tr>
        </thead>
        <tbody className={`divide-y divide-slate-100 ${cargando ? "opacity-60" : ""}`}>
          {filas.map((f) => (
            <FilaTabla key={claveFila(f)} fila={f} columnas={columnas} onFila={onFila} onIntencion={onIntencion} onSinIntencion={onSinIntencion} clase={claseFila?.(f)} tdBase={tdBase} />
          ))}
        </tbody>
      </table>
    </TablaScroll>
  );
}

// Filas memorizadas: tipear en un buscador o abrir un modal re-renderiza la página, pero una
// fila sólo se vuelve a dibujar si cambió su registro (o las columnas / callbacks).
const FilaTabla = memo(function FilaTabla<T>({ fila, columnas, onFila, onIntencion, onSinIntencion, clase, tdBase }: {
  fila: T; columnas: ColumnaTabla<T>[]; onFila?: (f: T) => void; onIntencion?: (f: T, ya?: boolean) => void; onSinIntencion?: () => void; clase?: string; tdBase: string;
}) {
  return (
    <tr
      onClick={onFila ? () => onFila(fila) : undefined}
      onMouseEnter={onIntencion ? () => onIntencion(fila) : undefined}
      onMouseLeave={onSinIntencion}
      onPointerDown={onIntencion ? () => onIntencion(fila, true) : undefined}
      className={`group transition-colors ${onFila ? "cursor-pointer hover:bg-[var(--brand-50)]" : ""} ${clase ?? ""}`}
    >
      {columnas.map((c) => <td key={c.key} className={`${tdBase} ${c.claseTd ?? ""}`}>{c.celda(fila)}</td>)}
    </tr>
  );
}) as <T>(p: { fila: T; columnas: ColumnaTabla<T>[]; onFila?: (f: T) => void; onIntencion?: (f: T, ya?: boolean) => void; onSinIntencion?: () => void; clase?: string; tdBase: string }) => ReactNode;

const etiqueta = <T,>(c: ColumnaTabla<T>) => c.etiquetaMovil ?? (typeof c.titulo === "string" ? c.titulo : "");

const TarjetaFila = memo(function TarjetaFila<T>({ fila, columnas, onFila, onIntencion, clase }: {
  fila: T; columnas: ColumnaTabla<T>[]; onFila?: (f: T) => void; onIntencion?: (f: T, ya?: boolean) => void; clase?: string;
}) {
  const [abierta, setAbierta] = useState(false);
  const rol = (c: ColumnaTabla<T>) => c.movil ?? "detalle";
  const ver = (c: ColumnaTabla<T>) => (c.celdaMovil ?? c.celda)(fila);
  const de = (r: RolMovil) => columnas.filter((c) => rol(c) === r);
  const titulo = de("titulo")[0];
  const subtitulo = de("subtitulo");
  const valor = de("valor")[0];
  const chips = de("chip");
  const datos = de("dato").slice(0, 4);
  const detalle = [...de("dato").slice(4), ...de("detalle")];
  const acciones = de("acciones");

  return (
    <li className={`relative ${clase ?? ""}`}>
      <div
        role={onFila ? "button" : undefined}
        tabIndex={onFila ? 0 : undefined}
        onClick={onFila ? () => onFila(fila) : undefined}
        onKeyDown={onFila ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onFila(fila); } } : undefined}
        onPointerDown={onIntencion ? () => onIntencion(fila, true) : undefined}
        className={`block px-3.5 py-3 ${onFila ? "cursor-pointer active:bg-slate-50" : ""}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {titulo ? <div className="min-w-0 text-[15px] font-semibold leading-snug text-slate-900 [overflow-wrap:anywhere]">{ver(titulo)}</div> : null}
            {subtitulo.map((c) => <div key={c.key} className="mt-0.5 min-w-0 text-[13px] text-slate-500 [overflow-wrap:anywhere]">{ver(c)}</div>)}
          </div>
          {valor ? <div className="shrink-0 text-right text-[15px] font-semibold tabular-nums text-slate-900">{ver(valor)}</div> : null}
        </div>
        {chips.length ? <div className="mt-2 flex flex-wrap items-center gap-1.5">{chips.map((c) => <span key={c.key} className="inline-flex max-w-full">{ver(c)}</span>)}</div> : null}
        {datos.length ? (
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
            {datos.map((c) => (
              <div key={c.key} className="min-w-0">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{etiqueta(c)}</dt>
                <dd className="min-w-0 text-[13px] text-slate-700 [overflow-wrap:anywhere]">{ver(c)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {abierta && detalle.length ? (
          <dl className="mt-2 space-y-1.5 rounded-lg bg-slate-50 px-3 py-2.5">
            {detalle.map((c) => (
              <div key={c.key} className="flex items-start justify-between gap-3">
                <dt className="shrink-0 text-[12px] text-slate-500">{etiqueta(c)}</dt>
                <dd className="min-w-0 text-right text-[13px] text-slate-800 [overflow-wrap:anywhere]">{ver(c)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
      {detalle.length || acciones.length ? (
        <div className="flex items-center justify-between gap-2 px-2 pb-1.5">
          {detalle.length ? (
            <button type="button" onClick={() => setAbierta((v) => !v)} aria-expanded={abierta}
              className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-[var(--brand)]">
              {abierta ? "Ver menos" : `Ver más (${detalle.length})`}
              <ChevronDown className={`h-4 w-4 transition-transform ${abierta ? "rotate-180" : ""}`} />
            </button>
          ) : <span />}
          {acciones.length ? (
            <div className="flex items-center gap-1 [&_button]:min-h-11 [&_button]:min-w-11" onClick={(e) => e.stopPropagation()}>
              {acciones.map((c) => <span key={c.key} className="contents">{ver(c)}</span>)}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}) as <T>(p: { fila: T; columnas: ColumnaTabla<T>[]; onFila?: (f: T) => void; onIntencion?: (f: T, ya?: boolean) => void; clase?: string }) => ReactNode;

/**
 * Contenedor de una tabla ancha: scroll horizontal INTERNO, sombras que indican que hay más a
 * la izquierda/derecha y (opcional) primera columna fija. Los colores de fondo de la columna
 * fija salen de `--tabla-fondo` (filas, por defecto blanco) y `--tabla-fondo-cabecera`.
 */
export function TablaScroll({
  children,
  primeraFija = false,
  minAncho,
  className = "",
}: {
  children: ReactNode;
  primeraFija?: boolean;
  /** ancho mínimo de la tabla en px (si la tabla no lo define) */
  minAncho?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [bordes, setBordes] = useState({ izq: false, der: false });
  const medir = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const izq = el.scrollLeft > 1;
    const der = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setBordes((b) => (b.izq === izq && b.der === der ? b : { izq, der }));
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    const t = el.querySelector("table");
    if (t) ro.observe(t);
    el.addEventListener("scroll", medir, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener("scroll", medir); };
  }, [medir]);

  return (
    <div className={`relative min-w-0 ${className}`}>
      <div
        ref={ref}
        className={`overflow-x-auto overscroll-x-contain ${primeraFija ? "tabla-primera-fija" : ""} ${bordes.izq ? "tabla-desplazada" : ""}`}
        style={minAncho ? ({ ["--tabla-min" as string]: `${minAncho}px` } as React.CSSProperties) : undefined}
      >
        <div className={minAncho ? "min-w-[var(--tabla-min)]" : ""}>{children}</div>
      </div>
      {/* Sombras de "hay más" (no capturan toques) */}
      <span aria-hidden className={`pointer-events-none absolute inset-y-0 left-0 w-4 bg-gradient-to-r from-slate-900/10 to-transparent transition-opacity ${bordes.izq && !primeraFija ? "opacity-100" : "opacity-0"}`} />
      <span aria-hidden className={`pointer-events-none absolute inset-y-0 right-0 w-5 bg-gradient-to-l from-slate-900/12 to-transparent transition-opacity ${bordes.der ? "opacity-100" : "opacity-0"}`} />
    </div>
  );
}
