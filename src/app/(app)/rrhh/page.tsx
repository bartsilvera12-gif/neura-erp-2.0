"use client";

/** /rrhh — Todos los usuarios del sistema con sus datos de RR HH (receta 118). Tocar uno abre su ficha. */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ReceiptText, Search } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { hoyPY } from "@/lib/fecha/paraguay";
import { filtrar } from "@/lib/busqueda";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { gs } from "@/components/graficos/formato";
import { TablaTarjetas } from "@/components/TablaResponsive";
import { antiguedad, textoAntiguedad } from "@/modules/rrhh/calculo";
import type { PersonaFila } from "@/modules/rrhh/tipos";
import { BOTON, INPUT } from "@/modules/rrhh/ui";

export default function PaginaPersonal() {
  const router = useRouter();
  const [filas, setFilas] = useState<PersonaFila[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    apiFetch<PersonaFila[]>("/api/rrhh").then(setFilas).catch((e: Error) => setError(e.message));
  }, []);

  const visibles = useMemo(() => filtrar(filas ?? [], q, (p) => ({ principal: p.nombre, otros: [p.area, p.sucursal, p.perfil], documentos: [p.ci] })), [filas, q]);
  const faltan = (filas ?? []).filter((p) => p.activo && !p.tiene_legajo).length;
  const hoy = hoyPY();

  return (
    <div className="space-y-4">
      <EncabezadoPagina kicker="RR HH" titulo="Personal" subtitulo="Datos, salario, ausencias, vacaciones e historial de cada persona."
        acciones={<Link href="/rrhh/liquidaciones" className={BOTON}><ReceiptText className="h-4 w-4" /> Liquidaciones</Link>} />

      {faltan > 0 ? (
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {faltan === 1 ? "Falta cargar los datos de 1 persona." : `Falta cargar los datos de ${faltan} personas.`}
        </p>
      ) : null}

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input className={`${INPUT} pl-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, CI, área o sucursal" aria-label="Buscar" />
      </div>

      {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      {!filas && !error ? <p className="text-sm text-slate-400">Cargando…</p> : null}
      {filas ? (
        <TablaTarjetas
          filas={visibles}
          claveFila={(p) => p.id}
          onFila={(p) => router.push(`/rrhh/${p.id}`)}
          columnas={[
            { key: "nombre", titulo: "Nombre", movil: "titulo", celda: (p) => <span className="font-medium text-slate-900">{p.nombre}</span> },
            { key: "ci", titulo: "CI", movil: "dato", celda: (p) => p.ci ?? "—" },
            { key: "sucursal", titulo: "Sucursal", movil: "subtitulo", celda: (p) => p.sucursal ?? "—" },
            { key: "area", titulo: "Área", movil: "dato", celda: (p) => p.area ?? "—" },
            { key: "tipo", titulo: "Tipo", movil: "dato", celda: (p) => (p.tipo_salario === "jornalero" ? "Jornalero" : p.tipo_salario === "mensualero" ? "Mensualero" : "—") },
            { key: "salario", titulo: "Salario", movil: "valor", claseTh: "text-right", claseTd: "text-right tabular-nums", celda: (p) => (p.salario == null ? "—" : gs(p.salario)) },
            { key: "antiguedad", titulo: "Antigüedad", movil: "detalle", celda: (p) => (p.fecha_ingreso ? textoAntiguedad(antiguedad(p.fecha_ingreso, p.fecha_egreso && p.fecha_egreso < hoy ? p.fecha_egreso : hoy)) : "—") },
            { key: "estado", titulo: "Estado", movil: "chip", celda: (p) => (
              !p.activo ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">Inactivo</span>
              : !p.tiene_legajo ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">Falta cargar</span>
              : <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">Al día</span>
            ) },
          ]}
        />
      ) : null}
    </div>
  );
}
