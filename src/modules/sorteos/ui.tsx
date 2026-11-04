"use client";

/** Piezas comunes de las pantallas de Sorteos (receta 123). */
import type { ReactNode } from "react";
import { gs } from "@/components/graficos/formato";
import type { Cupon, EstadoOrden, EstadoSorteo, Stats } from "@/modules/sorteos/tipos";
import { NOMBRE_ESTADO_ORDEN, NOMBRE_ESTADO_SORTEO } from "@/modules/sorteos/tipos";

export { INPUT, BOTON, BOTON_PRIMARIO, Tarjeta, Campo, Interruptor, Cifra, CampoMonto } from "@/modules/rrhh/ui";
export { gs };

const TONO = {
  ok: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  marca: "bg-[var(--brand-50,#eef7f7)] text-[var(--brand)] ring-[var(--brand-100)]",
  neutro: "bg-slate-100 text-slate-600 ring-slate-200",
  alerta: "bg-amber-50 text-amber-800 ring-amber-200",
  error: "bg-rose-50 text-rose-700 ring-rose-200",
  violeta: "bg-violet-50 text-violet-900 ring-violet-200",
} as const;

export function Etiqueta({ tono, children }: { tono: keyof typeof TONO; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${TONO[tono]}`}>{children}</span>;
}

const TONO_SORTEO: Record<EstadoSorteo, keyof typeof TONO> = {
  borrador: "neutro", activo: "ok", pausado: "alerta", cerrado: "marca", sorteado: "violeta", anulado: "error",
};
export const EstadoSorteoChip = ({ estado }: { estado: EstadoSorteo }) => <Etiqueta tono={TONO_SORTEO[estado]}>{NOMBRE_ESTADO_SORTEO[estado]}</Etiqueta>;

const TONO_ORDEN: Record<EstadoOrden, keyof typeof TONO> = {
  pendiente_pago: "neutro", en_revision: "alerta", confirmada: "ok", rechazada: "error", anulada: "error", vencida: "neutro",
};
export const EstadoOrdenChip = ({ estado }: { estado: EstadoOrden }) => <Etiqueta tono={TONO_ORDEN[estado]}>{NOMBRE_ESTADO_ORDEN[estado]}</Etiqueta>;

/** Barra de avance de venta: vendidos y reservados sobre el total. */
export function BarraVenta({ stats, chica = false }: { stats: Stats; chica?: boolean }) {
  const total = Math.max(stats.total, 1);
  const v = (stats.vendidos / total) * 100;
  const r = (stats.reservados / total) * 100;
  return (
    <div>
      <div className={`flex overflow-hidden rounded-full bg-slate-100 ${chica ? "h-1.5" : "h-2.5"}`} role="progressbar" aria-valuemin={0} aria-valuemax={stats.total} aria-valuenow={stats.vendidos}
        aria-label={`${stats.vendidos} de ${stats.total} boletas vendidas`}>
        <span className="h-full bg-[var(--brand)]" style={{ width: `${v}%` }} />
        <span className="h-full bg-amber-300" style={{ width: `${r}%` }} />
      </div>
      {!chica ? (
        <p className="mt-1.5 flex flex-wrap justify-between gap-x-3 text-xs text-slate-500">
          <span><b className="font-semibold tabular-nums text-slate-800">{stats.vendidos.toLocaleString("es-PY")}</b> de {stats.total.toLocaleString("es-PY")} vendidas</span>
          {stats.reservados ? <span className="tabular-nums">{stats.reservados.toLocaleString("es-PY")} esperando pago</span> : null}
        </p>
      ) : null}
    </div>
  );
}

export const fechaHoraPY = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export const telefonoLindo = (t: string | null | undefined) => {
  if (!t) return "";
  const d = t.replace(/\D/g, "");
  const local = d.startsWith("595") && d.length >= 11 ? `0${d.slice(3)}` : d;
  return /^09\d{8}$/.test(local) ? `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}` : local;
};

/** Clave para que un doble clic o un reintento no registre dos veces la misma venta. */
export const nuevaClave = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type FormatoCupon = "58" | "80" | "a4";

/**
 * HTML de los cupones para la urna: uno por número. Ticketera (58/80 mm): uno por página, para que el
 * corte automático los separe. A4: grilla de 3 columnas con líneas de corte.
 */
export function htmlCupones(sorteo: string, cupones: Cupon[], formato: FormatoCupon): string {
  const fecha = (iso: string) => new Date(iso).toLocaleString("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const cupon = (c: Cupon) => `
    <div class="cupon">
      <div class="sorteo">${esc(sorteo)}</div>
      <div class="numero">${esc(c.numero)}</div>
      <div class="dato"><b>${esc(c.nombre)}</b></div>
      ${c.documento ? `<div class="dato">CI ${esc(c.documento)}</div>` : ""}
      ${c.telefono ? `<div class="dato">Tel. ${esc(telefonoLindo(c.telefono))}</div>` : ""}
      ${c.ciudad ? `<div class="dato">${esc(c.ciudad)}</div>` : ""}
      <div class="pie">Compra ${c.orden} · ${esc(fecha(c.fecha))}</div>
    </div>`;
  const ancho = formato === "58" ? "58mm" : formato === "80" ? "80mm" : "210mm";
  const ticket = formato !== "a4";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Cupones ${esc(sorteo)}</title><style>
    @page { size: ${ticket ? `${ancho} auto` : "A4"}; margin: ${ticket ? "2mm" : "8mm"}; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; }
    .cupon { text-align: center; padding: ${ticket ? "2mm 1mm 4mm" : "4mm"}; ${ticket ? "page-break-after: always; break-after: page;" : "border: 1px dashed #888; break-inside: avoid;"} }
    .cupon:last-child { page-break-after: auto; break-after: auto; }
    .sorteo { font-size: ${formato === "58" ? "11px" : "13px"}; font-weight: bold; text-transform: uppercase; letter-spacing: .5px; }
    .numero { font-size: ${formato === "58" ? "34px" : "42px"}; font-weight: 900; letter-spacing: 2px; margin: 1mm 0; }
    .dato { font-size: ${formato === "58" ? "11px" : "12px"}; line-height: 1.35; overflow-wrap: anywhere; }
    .pie { margin-top: 1.5mm; font-size: 10px; color: #333; }
    ${ticket ? "" : ".grilla { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; }"}
  </style></head><body>${ticket ? cupones.map(cupon).join("") : `<div class="grilla">${cupones.map(cupon).join("")}</div>`}</body></html>`;
}
