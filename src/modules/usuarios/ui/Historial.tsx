"use client";

/** Historial de cambios (quién cambió qué) de un usuario o de un perfil. */
import { useEffect, useState } from "react";
import { History, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { permisoDef, nivelLabel } from "@/modules/usuarios/permisos";
import { pantallasCatalogo } from "@/modules/registry";
import { fechaHora, type EventoHistorial } from "@/modules/usuarios/ui/comun";

const ACCIONES: Record<string, string> = {
  creado: "Lo creó",
  vinculado: "Lo vinculó (cuenta que ya existía)",
  editado: "Cambió",
  activado: "Lo activó",
  desactivado: "Lo desactivó",
  eliminado: "Eliminó el perfil",
  invitacion_enviada: "Le mandó la invitación por email",
  link_invitacion: "Copió un link de invitación",
  link_restablecer: "Copió un link para restablecer la contraseña",
  restablecer_enviado: "Le mandó el email para restablecer la contraseña",
};

const CAMPOS: Record<string, string> = {
  nombre: "Nombre", ci: "CI", telefono: "Teléfono", perfil: "Perfil", sucursal: "Sucursal", activo: "Activo",
  es_tecnico: "Técnico de Soporte", es_qa: "QA de Soporte", usa_soporte: "Usa Soporte", descripcion: "Descripción",
  nivel_base: "Nivel base", alcance_sucursal: "Alcance", tope_descuento_pct: "Tope de descuento",
};

function valor(campo: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Sí" : "No";
  if (campo === "nivel_base") return nivelLabel(String(v));
  if (campo === "alcance_sucursal") return v === "todas" ? "Todas las sucursales" : "Solo su sucursal";
  if (campo === "tope_descuento_pct") return `${v} %`;
  return String(v);
}

const nombrePantalla = (() => {
  let mapa: Map<string, string> | null = null;
  return (href: string) => {
    mapa ??= new Map(pantallasCatalogo().map((p) => [p.href, p.label === p.moduloLabel ? p.label : `${p.moduloLabel} › ${p.label}`]));
    return mapa.get(href) ?? href;
  };
})();

function Detalle({ ev }: { ev: EventoHistorial }) {
  const d = ev.detalle ?? {};
  const filas: React.ReactNode[] = [];
  for (const [k, v] of Object.entries(d)) {
    if (k === "pantallas" || k === "permisos") {
      const x = v as { agregadas?: string[]; quitadas?: string[]; agregados?: string[]; quitados?: string[] } | string[];
      const nombre = (s: string) => (k === "pantallas" ? nombrePantalla(s) : permisoDef(s)?.label ?? s);
      if (Array.isArray(x)) {
        if (x.length) filas.push(<li key={k}><span className="text-slate-500">{k === "pantallas" ? "Pantallas" : "Permisos"}:</span> {x.map(nombre).join(", ")}</li>);
        continue;
      }
      const mas = x.agregadas ?? x.agregados ?? [];
      const menos = x.quitadas ?? x.quitados ?? [];
      if (mas.length) filas.push(<li key={`${k}+`}><span className="font-medium text-emerald-700">+ {k === "pantallas" ? "Pantallas" : "Permisos"}:</span> {mas.map(nombre).join(", ")}</li>);
      if (menos.length) filas.push(<li key={`${k}-`}><span className="font-medium text-rose-700">− {k === "pantallas" ? "Pantallas" : "Permisos"}:</span> {menos.map(nombre).join(", ")}</li>);
      continue;
    }
    if (Array.isArray(v) && v.length === 2) {
      filas.push(<li key={k}><span className="text-slate-500">{CAMPOS[k] ?? k}:</span> {valor(k, v[0])} <span className="text-slate-400">→</span> <span className="font-medium text-slate-700">{valor(k, v[1])}</span></li>);
    } else if (k !== "email" || ev.accion === "creado" || ev.accion === "vinculado") {
      filas.push(<li key={k}><span className="text-slate-500">{CAMPOS[k] ?? (k === "email" ? "Email" : k)}:</span> {valor(k, v)}</li>);
    }
  }
  return filas.length ? <ul className="mt-1 space-y-0.5 text-xs text-slate-600">{filas}</ul> : null;
}

export function Historial({ usuarioId, perfilId, recarga = 0 }: { usuarioId?: string; perfilId?: string; recarga?: number }) {
  const [eventos, setEventos] = useState<EventoHistorial[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    const q = new URLSearchParams();
    if (usuarioId) q.set("usuario", usuarioId);
    if (perfilId) q.set("perfil", perfilId);
    q.set("limite", "60");
    apiFetch<EventoHistorial[]>(`/api/configuracion/usuarios/historial?${q.toString()}`)
      .then((d) => vivo && setEventos(d))
      .catch((e: Error) => vivo && setError(e.message));
    return () => {
      vivo = false;
    };
  }, [usuarioId, perfilId, recarga]);

  if (error) return <p className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700">{error}</p>;
  if (!eventos) return <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>;
  if (!eventos.length) {
    return (
      <div className="flex flex-col items-center gap-1 py-6 text-center text-xs text-slate-400">
        <History className="h-5 w-5" />
        Todavía no hay cambios registrados.
      </div>
    );
  }
  return (
    <ol className="relative space-y-3 pl-4">
      <span className="absolute bottom-1 left-[3px] top-1 w-px bg-slate-200" aria-hidden />
      {eventos.map((ev) => (
        <li key={ev.id} className="relative">
          <span className="absolute -left-4 top-1.5 h-[7px] w-[7px] rounded-full ring-2 ring-white" style={{ backgroundColor: ev.accion === "desactivado" || ev.accion === "eliminado" ? "#e11d48" : "#4FAEB2" }} aria-hidden />
          <p className="text-[13px] text-slate-800">
            <span className="font-semibold">{ev.actor_nombre ?? "Sistema"}</span>{" "}
            <span className="text-slate-600">{(ACCIONES[ev.accion] ?? ev.accion).toLowerCase()}</span>
            {!usuarioId && !perfilId && ev.nombre ? <span className="text-slate-600"> · {ev.nombre}</span> : null}
          </p>
          <p className="text-[11px] tabular-nums text-slate-400">{fechaHora(ev.created_at)}</p>
          <Detalle ev={ev} />
        </li>
      ))}
    </ol>
  );
}
