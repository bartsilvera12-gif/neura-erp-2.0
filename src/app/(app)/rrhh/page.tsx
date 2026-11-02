"use client";

/** /rrhh — Todos los usuarios del sistema con sus datos de RR HH (receta 118). Tocar uno abre su ficha. */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, ReceiptText, Search, UserPlus } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { hoyPY } from "@/lib/fecha/paraguay";
import { filtrar } from "@/lib/busqueda";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { gs } from "@/components/graficos/formato";
import { antiguedad, textoAntiguedad } from "@/modules/rrhh/calculo";
import type { PersonaFila } from "@/modules/rrhh/tipos";
import { BOTON, INPUT } from "@/modules/rrhh/ui";

type Filtro = "activos" | "faltan" | "inactivos";

const iniciales = (nombre: string) => nombre.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");

function Fila({ p, hoy }: { p: PersonaFila; hoy: string }) {
  const detalle = [p.perfil, p.sucursal, p.area].filter(Boolean).join(" · ");
  return (
    <li>
      <Link href={`/rrhh/${p.id}`} className="flex min-h-[72px] items-center gap-3 px-4 py-3 no-underline transition-colors hover:bg-slate-50 sm:gap-4 sm:px-5">
        <span aria-hidden className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-semibold ${p.activo ? "bg-[var(--brand-50)] text-[var(--brand)]" : "bg-slate-100 text-slate-400"}`}>{iniciales(p.nombre)}</span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[15px] font-semibold ${p.activo ? "text-slate-900" : "text-slate-500"}`}>{p.nombre}</span>
          {detalle ? <span className="mt-0.5 block truncate text-[13px] text-slate-500">{detalle}</span> : null}
        </span>
        {!p.activo ? (
          <span className="shrink-0 text-[13px] font-medium text-slate-400">Inactivo</span>
        ) : !p.tiene_legajo ? (
          <span className="shrink-0 text-[13px] font-semibold text-[var(--brand)]">Cargar datos</span>
        ) : (
          <>
            <span className="hidden w-36 shrink-0 md:block">
              <span className="block text-sm text-slate-700">{p.fecha_ingreso ? textoAntiguedad(antiguedad(p.fecha_ingreso, p.fecha_egreso && p.fecha_egreso < hoy ? p.fecha_egreso : hoy)) : ""}</span>
              <span className="block text-xs text-slate-500">Antigüedad</span>
            </span>
            <span className="shrink-0 text-right sm:w-36">
              <span className="block text-sm font-semibold tabular-nums text-slate-900">{gs(p.salario)}</span>
              <span className="block text-xs text-slate-500">{p.tipo_salario === "jornalero" ? "Por día" : "Por mes"}</span>
            </span>
          </>
        )}
        <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-slate-300" />
      </Link>
    </li>
  );
}

export default function PaginaPersonal() {
  const [filas, setFilas] = useState<PersonaFila[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("activos");

  useEffect(() => {
    apiFetch<PersonaFila[]>("/api/rrhh").then(setFilas).catch((e: Error) => setError(e.message));
  }, []);

  const todas = filas ?? [];
  const activos = todas.filter((p) => p.activo);
  const faltan = activos.filter((p) => !p.tiene_legajo);
  const inactivos = todas.filter((p) => !p.activo);
  const delFiltro = filtro === "faltan" ? faltan : filtro === "inactivos" ? inactivos : activos;
  const visibles = useMemo(() => filtrar(delFiltro, q, (p) => ({ principal: p.nombre, otros: [p.area, p.sucursal, p.perfil], documentos: [p.ci] })), [delFiltro, q]);
  const hoy = hoyPY();

  const opciones: [Filtro, string, number][] = [
    ["activos", "Activos", activos.length],
    ["faltan", "Falta cargar", faltan.length],
    ["inactivos", "Inactivos", inactivos.length],
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <EncabezadoPagina titulo="Personal" subtitulo="Tocá una persona para ver o cargar sus datos." volver={{ href: "/rrhh/panel", label: "RR HH" }}
        acciones={<Link href="/rrhh/liquidaciones" className={`${BOTON} no-underline max-sm:w-full`}><ReceiptText className="h-4 w-4" /> Liquidaciones</Link>} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 overflow-x-auto [scrollbar-width:none]" role="tablist" aria-label="Filtrar personal">
          {opciones.filter(([id, , n]) => id === "activos" || n > 0).map(([id, label, n]) => (
            <button key={id} type="button" role="tab" aria-selected={filtro === id} onClick={() => setFiltro(id)}
              className={`min-h-11 shrink-0 rounded-xl px-3.5 text-sm font-semibold transition-colors sm:min-h-9 ${filtro === id ? "bg-[var(--brand)] text-white" : "text-slate-600 hover:bg-slate-100"}`}>
              {label} <span className={filtro === id ? "text-white/80" : "text-slate-400"}>{n}</span>
            </button>
          ))}
        </div>
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className={`${INPUT} pl-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar" aria-label="Buscar por nombre, CI, área o sucursal" />
        </div>
      </div>

      {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      {!filas && !error ? <p className="text-sm text-slate-400">Cargando…</p> : null}
      {filas ? (
        visibles.length ? (
          <ul className="m-0 list-none divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            {visibles.map((p) => <Fila key={p.id} p={p} hoy={hoy} />)}
          </ul>
        ) : (
          <p className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">{q ? "No hay nadie con esa búsqueda." : "No hay nadie en esta lista."}</p>
        )
      ) : null}

      <p className="flex items-start gap-2 text-[13px] text-slate-500">
        <UserPlus aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Para sumar a alguien, crealo en <Link href="/configuracion/usuarios" className="font-medium text-[var(--brand)]">Configuración › Usuarios</Link>: después aparece acá.</span>
      </p>
    </div>
  );
}
