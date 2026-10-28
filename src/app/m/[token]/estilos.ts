/**
 * Clases del menú QR (/m/<token>) para claro y oscuro (data-tema="oscuro" en <html>, ver
 * globals.css). Un solo lugar para que todas las pantallas del celular se vean iguales.
 *
 * Oscuro: una sola escala neutra (tokens --qr-bg / --qr-surface / --qr-raised / --qr-panel en
 * globals.css), bordes hairline blancos al 6–10 %, texto zinc-100 / zinc-400 y el turquesa de
 * marca más profundo (degradé + halo: clases .qr-acento / .qr-acento-grande). Claro no cambia.
 */
export const FONDO = "bg-slate-50 dark:bg-[var(--qr-bg)]";
export const TARJETA =
  "rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/[0.07] dark:bg-[var(--qr-surface)] dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.04),0_1px_2px_rgb(0_0_0/0.3)]";
export const TEXTO = "text-slate-900 dark:text-zinc-100";
export const SUAVE = "text-slate-500 dark:text-zinc-400";
export const TENUE = "text-slate-400 dark:text-zinc-500";
/** Texto intermedio (montos dentro de una línea secundaria). */
export const MEDIO = "text-slate-700 dark:text-zinc-200";
export const LINEA = "border-slate-100 dark:border-white/[0.06]";
export const DIVIDE = "divide-slate-100 dark:divide-white/[0.06]";
export const INPUT =
  "w-full rounded-xl border border-slate-200 bg-white text-base text-slate-900 outline-none placeholder:text-slate-400 focus:border-[var(--brand)] dark:border-white/10 dark:bg-[var(--qr-raised)] dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:transition-shadow dark:focus:border-[var(--brand)] dark:focus:ring-4 dark:focus:ring-[color-mix(in_srgb,var(--brand)_28%,transparent)]";
export const BOTON_SEC =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 active:scale-[0.99] disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-200 dark:hover:bg-white/[0.07]";
export const PANEL_MODAL = "bg-white dark:bg-[var(--qr-panel)] dark:ring-1 dark:ring-white/[0.08] dark:shadow-[0_24px_60px_-12px_rgb(0_0_0/0.7)]";
/** Fondo detrás de los modales del QR (en oscuro más profundo). */
export const FONDO_MODAL = "bg-slate-900/45 backdrop-blur-[2px] dark:bg-black/60 dark:backdrop-blur-sm";

/** Cabecera de la página: en oscuro es parte del mismo fondo (sin franja ni corte). */
export const CABECERA = "pt-safe bg-white dark:border-white/[0.06] dark:bg-[var(--qr-bg)]";
/** Barra "Volver" pegada arriba y barras fijas abajo: translúcidas con blur. */
export const BARRA_STICKY = "bg-white/95 backdrop-blur dark:bg-[color-mix(in_srgb,var(--qr-bg)_82%,transparent)] dark:backdrop-blur-xl";
export const BARRA_PIE =
  "border-t border-slate-200 bg-white/95 backdrop-blur dark:border-white/[0.06] dark:bg-[color-mix(in_srgb,var(--qr-bg)_82%,transparent)] dark:backdrop-blur-xl";
/** Logo de la empresa: en oscuro va en una placa clara suave con borde fino (no un rectángulo blanco). */
export const LOGO =
  "dark:box-content dark:rounded-xl dark:bg-[#e8ecef] dark:px-2 dark:py-1 dark:ring-1 dark:ring-white/15 dark:shadow-[0_1px_3px_rgb(0_0_0/0.5)]";

/** Botón / tarjeta con el color de marca (lleva además style={{ backgroundColor: color }}). */
export const ACENTO = "qr-acento";
export const ACENTO_GRANDE = "qr-acento-grande";
/** Ícono con fondo de marca tenue (tarjetas del inicio). */
export const CHIP_MARCA =
  "bg-[color-mix(in_srgb,var(--brand)_14%,transparent)] text-[var(--brand)] dark:bg-[color-mix(in_srgb,var(--brand)_16%,transparent)] dark:text-[var(--qr-brand-texto)] dark:ring-1 dark:ring-inset dark:ring-[color-mix(in_srgb,var(--brand)_32%,transparent)]";
/** Ícono neutro / deshabilitado. */
export const CHIP_NEUTRO = "bg-slate-100 text-slate-400 dark:bg-white/[0.04] dark:text-zinc-500 dark:ring-1 dark:ring-inset dark:ring-white/[0.06]";
/** Chip seleccionable sin elegir (personas, destinatario de la factura). */
export const PILDORA = "border-slate-200 text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-200";
/** Texto de link con color de marca (en oscuro más claro). */
export const LINK_MARCA = "dark:text-[var(--qr-brand-texto)]!";
/** Contador − n + y cajas de controles. */
export const CONTROL = "border border-slate-200 bg-white dark:border-white/10 dark:bg-white/[0.04]";
export const BOTON_ICONO = "text-slate-700 active:bg-slate-100 dark:text-zinc-200 dark:active:bg-white/[0.08]";
/** Hueco de foto / inicial sin foto. */
export const FOTO_VACIA = "bg-slate-100 dark:bg-white/[0.04]";

export const AVISO_OK = "border border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/20 dark:bg-emerald-400/[0.08] dark:text-emerald-200";
export const AVISO_INFO = "border border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-400/20 dark:bg-sky-400/[0.08] dark:text-sky-100";
export const AVISO_ALERTA = "border border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-400/25 dark:bg-amber-400/[0.08] dark:text-amber-100";
export const AVISO_ERROR = "bg-rose-50 text-rose-700 dark:bg-rose-400/[0.08] dark:text-rose-200 dark:ring-1 dark:ring-inset dark:ring-rose-400/20";
export const PILDORA_PAGADA = "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20";

/** Estado de un pedido (ESTADOS_PEDIDO trae solo la versión clara): se suma al lado de `clase`. */
export const ESTADO_OSCURO: Record<string, string> = {
  nuevo: "dark:bg-amber-400/10 dark:text-amber-300 dark:ring-1 dark:ring-inset dark:ring-amber-400/20",
  aceptado: "dark:bg-sky-400/10 dark:text-sky-300 dark:ring-1 dark:ring-inset dark:ring-sky-400/20",
  en_preparacion: "dark:bg-violet-400/10 dark:text-violet-300 dark:ring-1 dark:ring-inset dark:ring-violet-400/20",
  listo: "dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20",
  entregado: "dark:bg-white/[0.06] dark:text-zinc-300 dark:ring-1 dark:ring-inset dark:ring-white/10",
  rechazado: "dark:bg-rose-400/10 dark:text-rose-300 dark:ring-1 dark:ring-inset dark:ring-rose-400/20",
};
