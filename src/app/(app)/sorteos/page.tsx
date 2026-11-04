"use client";

/** /sorteos — Los sorteos de la empresa con su avance de venta (receta 123). Tocar uno abre su ficha. */
import Link from "next/link";
import { useEffect, useState } from "react";
import { CalendarClock, ImageOff, Plus, ShoppingCart, Ticket } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { usePermiso } from "@/lib/sesion/ContextoUsuario";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import type { SorteoFila } from "@/modules/sorteos/tipos";
import { BarraVenta, BOTON, BOTON_PRIMARIO, EstadoSorteoChip, Etiqueta, fechaHoraPY, gs } from "@/modules/sorteos/ui";

function TarjetaSorteo({ s }: { s: SorteoFila }) {
  return (
    <li>
      <Link href={`/sorteos/${s.id}`} className="group flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white no-underline shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-[var(--brand)] hover:shadow-md">
        <div className="relative aspect-[16/7] bg-slate-100">
          {s.imagen_url
            ? <img src={s.imagen_url} alt="" className="h-full w-full object-cover" loading="lazy" />
            : <span className="grid h-full place-items-center text-slate-300"><ImageOff className="h-7 w-7" aria-hidden /></span>}
          <span className="absolute left-3 top-3"><EstadoSorteoChip estado={s.estado} /></span>
          {s.stats.por_revisar ? <span className="absolute right-3 top-3"><Etiqueta tono="alerta">{s.stats.por_revisar} por revisar</Etiqueta></span> : null}
        </div>
        <div className="flex flex-1 flex-col gap-3 p-4">
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold text-slate-900">{s.nombre}</h2>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
              <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {s.fecha_sorteo ? `Sorteo: ${fechaHoraPY(s.fecha_sorteo)}` : "Sin fecha de sorteo"} · {gs(s.precio)} la boleta
            </p>
          </div>
          <BarraVenta stats={s.stats} />
          <div className="mt-auto grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
            <span>
              <span className="block text-[11px] text-slate-500">Recaudado</span>
              <span className="block text-sm font-semibold tabular-nums text-slate-900">{gs(s.stats.monto)}</span>
            </span>
            <span className="text-right">
              <span className="block text-[11px] text-slate-500">Hoy</span>
              <span className="block text-sm font-semibold tabular-nums text-slate-900">{s.stats.hoy_boletas.toLocaleString("es-PY")} · {gs(s.stats.hoy_monto)}</span>
            </span>
          </div>
        </div>
      </Link>
    </li>
  );
}

export default function PaginaSorteos() {
  const [filas, setFilas] = useState<SorteoFila[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const puedeAdministrar = usePermiso("sorteos_administrar");

  useEffect(() => {
    apiFetch<SorteoFila[]>("/api/sorteos").then(setFilas).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="space-y-4 pb-10">
      <EncabezadoPagina
        titulo="Sorteos"
        subtitulo="Cada sorteo con su avance de venta. Tocá uno para ver sus compras, premios y cupones."
        volver={{ href: "/sorteos/panel", label: "Sorteos" }}
        acciones={
          <div className="flex gap-2 max-sm:w-full max-sm:[&>*]:flex-1">
            <Link href="/sorteos/vender" className={`${BOTON} no-underline`}><ShoppingCart className="h-4 w-4" /> Vender</Link>
            {puedeAdministrar ? <Link href="/sorteos/nuevo" className={`${BOTON_PRIMARIO} no-underline`}><Plus className="h-4 w-4" /> Nuevo sorteo</Link> : null}
          </div>
        }
      />

      {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      {!filas && !error ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-72 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}
        </div>
      ) : null}
      {filas ? (
        filas.length ? (
          <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
            {filas.map((s) => <TarjetaSorteo key={s.id} s={s} />)}
          </ul>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white p-10 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--brand-50,#eef7f7)] text-[var(--brand)]"><Ticket className="h-6 w-6" /></span>
            <p className="text-sm font-semibold text-slate-800">Todavía no hay sorteos</p>
            <p className="max-w-sm text-sm text-slate-500">Creá el primero: el precio, los combos, las cuentas para cobrar y los números. Queda en borrador hasta que lo actives.</p>
            {puedeAdministrar ? <Link href="/sorteos/nuevo" className={`${BOTON_PRIMARIO} no-underline`}><Plus className="h-4 w-4" /> Nuevo sorteo</Link> : null}
          </div>
        )
      ) : null}
    </div>
  );
}
