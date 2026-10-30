/**
 * Link público de un presupuesto: /p/<token>. Lo abre el cliente desde WhatsApp o el
 * correo, sin cuenta. Muestra SOLO lo que devuelve presupuesto_publico (sin datos
 * internos), deja descargar el PDF y, si la empresa lo permite, Aceptar / Rechazar.
 * El link vence con la validez del presupuesto.
 */
import type { Metadata } from "next";
import { cache } from "react";
import { CalendarClock, Download, FileText, UserRound } from "lucide-react";
import { clienteConfig } from "@/cliente.config";
import { hoyPY } from "@/lib/fecha/paraguay";
import { presupuestoPorToken } from "@/modules/presupuestos/publico";
import { LOGO_INSTALACION } from "@/modules/empresa/tipos";
import {
  cantidad, condicionTexto, diaCorto, ESTADOS, monto, numeroConRevision, pct, type PresupuestoDoc,
} from "@/modules/presupuestos/tipos";
import { Respuesta } from "./Respuesta";

export const dynamic = "force-dynamic";

const traer = cache((token: string) => presupuestoPorToken(token));

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const p = await traer(token);
  return {
    title: p ? `Presupuesto ${p.numero} · ${clienteConfig.nombre}` : `Presupuesto · ${clienteConfig.nombre}`,
    robots: { index: false, follow: false },
  };
}

export default async function PresupuestoPublicoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const p = await traer(token);

  if (!p) {
    return (
      <Marco>
        <Aviso titulo="Este presupuesto no está disponible" texto="El link no es válido o el presupuesto todavía no fue enviado. Pedile a quien te lo mandó que lo vuelva a compartir." />
      </Marco>
    );
  }
  if (p.expirado) {
    return (
      <Marco>
        <Aviso titulo={`El presupuesto ${p.numero} venció`}
          texto={`Era válido hasta el ${diaCorto(p.valido_hasta)}. Los precios y la disponibilidad pueden haber cambiado: pedí uno actualizado${p.vendedor_nombre ? ` a ${p.vendedor_nombre}` : ""}.`} />
      </Marco>
    );
  }
  return (
    <Marco logo={(p as { emisor?: { logo_url?: string | null } | null }).emisor?.logo_url}>
      <Documento p={p} token={token} />
    </Marco>
  );
}

function Marco({ children, logo }: { children: React.ReactNode; logo?: string | null }) {
  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="pt-safe border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo || LOGO_INSTALACION} alt={clienteConfig.nombre} className="h-9 w-auto max-w-[160px] object-contain" />
          <div className="text-right">
            <p className="text-sm font-semibold text-slate-900">{clienteConfig.nombre}</p>
            <p className="text-[11px] text-slate-500">{clienteConfig.dominio}</p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-3 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}

function Aviso({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-6 py-14 text-center shadow-sm">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <FileText className="h-6 w-6" />
      </span>
      <h1 className="mt-4 text-lg font-semibold text-slate-900">{titulo}</h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">{texto}</p>
    </div>
  );
}

function Documento({ p, token }: { p: PresupuestoDoc & { permite_responder: boolean }; token: string }) {
  const m = (v: number) => monto(v, p.moneda);
  const est = ESTADOS[p.estado];
  const dias = Math.round((Date.parse(`${p.valido_hasta}T12:00:00`) - Date.parse(`${hoyPY()}T12:00:00`)) / 86_400_000);
  const vigencia = dias <= 0 ? "Vence hoy" : dias === 1 ? "Vence mañana" : `Quedan ${dias} días`;
  const hayDesc = Number(p.descuento_lineas) > 0 || Number(p.descuento_global) > 0;

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="px-5 py-5 sm:px-7" style={{ backgroundImage: `linear-gradient(to bottom right, #fff, #fff, ${clienteConfig.color}14)` }}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: clienteConfig.color }}>Presupuesto</p>
              <h1 className="mt-1 font-mono text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{numeroConRevision(p.numero, p.revision)}</h1>
              <p className="mt-1 text-sm text-slate-600">Para <strong className="font-semibold text-slate-900">{p.cliente.nombre}</strong>{p.cliente.ruc ? <span className="text-slate-400"> · {p.cliente.ruc}</span> : null}</p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${est.clase}`}>{p.estado === "convertido" ? "Aceptado" : est.texto}</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-200/70 pt-4 text-sm sm:grid-cols-3">
            <Dato icono={<CalendarClock className="h-3.5 w-3.5" />} l="Válido hasta" v={diaCorto(p.valido_hasta)} extra={p.estado === "enviado" ? vigencia : undefined} />
            <Dato icono={<FileText className="h-3.5 w-3.5" />} l="Condición" v={condicionTexto(p.condicion, p.plazo_dias, p.cuotas, p.cuotas_cada)} />
            {p.vendedor_nombre ? <Dato icono={<UserRound className="h-3.5 w-3.5" />} l="Te atiende" v={p.vendedor_nombre} /> : null}
          </div>
        </div>

        {/* Líneas */}
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {p.items.map((it, n) => (
            <li key={n} className="flex items-start gap-3 px-5 py-3.5 sm:px-7">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">{it.descripcion}</p>
                {it.detalle ? <p className="mt-0.5 whitespace-pre-wrap text-xs text-slate-500">{it.detalle}</p> : null}
                <p className="mt-1 text-xs tabular-nums text-slate-500">
                  {cantidad(it.cantidad)}{it.unidad && it.unidad !== "Unidad" ? ` ${it.unidad}` : ""} × {m(it.precio_unitario)}
                  {Number(it.descuento_pct) > 0 ? <span className="ml-1.5 rounded bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700">−{pct(it.descuento_pct)}</span> : null}
                  <span className="ml-1.5 text-slate-400">IVA {it.tipo_iva === "EXENTA" ? "exenta" : it.tipo_iva}</span>
                </p>
              </div>
              <p className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{m(it.total)}</p>
            </li>
          ))}
        </ul>

        {/* Totales */}
        <div className="border-t border-slate-200 bg-slate-50/60 px-5 py-4 sm:px-7">
          <dl className="ml-auto max-w-xs space-y-1.5 text-sm">
            {hayDesc ? (
              <>
                <Fila l="Subtotal" v={m(p.subtotal_bruto)} />
                {Number(p.descuento_lineas) > 0 ? <Fila l="Descuentos" v={`− ${m(p.descuento_lineas)}`} verde /> : null}
                {Number(p.descuento_global) > 0 ? <Fila l={`Descuento general (${pct(p.descuento_pct)})`} v={`− ${m(p.descuento_global)}`} verde /> : null}
              </>
            ) : null}
            <div className="flex items-baseline justify-between border-t border-slate-200 pt-2">
              <dt className="font-semibold text-slate-800">Total</dt>
              <dd className="text-2xl font-bold tabular-nums tracking-tight text-slate-900">{m(p.total)}</dd>
            </div>
            <p className="text-right text-[11px] text-slate-500">
              IVA incluido {m(p.total_iva)}
              {Number(p.total_10) ? ` · 10%: ${m(p.iva_10)}` : ""}{Number(p.total_5) ? ` · 5%: ${m(p.iva_5)}` : ""}{Number(p.total_exenta) ? ` · exento ${m(p.total_exenta)}` : ""}
            </p>
          </dl>
        </div>
      </section>

      {p.condiciones ? (
        <section className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm sm:px-7">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Condiciones</p>
          <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-700">{p.condiciones}</p>
        </section>
      ) : null}

      <section className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <a href={`/p/${token}/pdf`} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50">
          <Download className="h-4 w-4" /> Descargar PDF
        </a>
        <Respuesta token={token} estado={p.estado} permite={p.permite_responder} aceptadoAt={p.aceptado_at} rechazadoAt={p.rechazado_at} color={clienteConfig.color} />
      </section>

      <p className="text-center text-[11px] text-slate-400">
        Precios con IVA incluido{p.moneda === "USD" ? ", en dólares americanos" : ""}. Válido hasta el {diaCorto(p.valido_hasta)}.
      </p>
    </div>
  );
}

function Dato({ icono, l, v, extra }: { icono: React.ReactNode; l: string; v: string; extra?: string }) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">{icono}{l}</p>
      <p className="mt-0.5 truncate font-medium text-slate-800">{v}</p>
      {extra ? <p className="text-[11px] font-semibold text-amber-600">{extra}</p> : null}
    </div>
  );
}

function Fila({ l, v, verde }: { l: string; v: string; verde?: boolean }) {
  return (
    <div className="flex justify-between gap-4 text-slate-600">
      <dt>{l}</dt>
      <dd className={`tabular-nums ${verde ? "text-emerald-700" : ""}`}>{v}</dd>
    </div>
  );
}
