"use client";

/**
 * Configuración › Usuarios › Conexiones (receta 111): quién está conectado ahora y cuándo se conectó
 * por última vez. Se actualiza sola cada 30 s mientras la pantalla se ve; primero los conectados.
 */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { TablaTarjetas, type ColumnaTabla } from "@/components/TablaResponsive";
import { Avatar, fechaHora, haceCuanto, InsigniaPerfil, URL_USUARIOS } from "@/modules/usuarios/ui/comun";

type Conexion = {
  id: string;
  nombre: string;
  email: string | null;
  perfil_nombre: string | null;
  perfil_codigo: string | null;
  activo: boolean;
  es_yo: boolean;
  conectado: boolean;
  ultima_conexion: string | null;
};

const REFRESCO_MS = 30_000;

function PillConexion({ c }: { c: Conexion }) {
  const [etiqueta, clase, punto] = !c.activo
    ? ["Inactivo", "bg-slate-100 text-slate-500 ring-slate-200", "bg-slate-400"]
    : c.conectado
      ? ["Conectado", "bg-emerald-50 text-emerald-700 ring-emerald-200", "bg-emerald-500"]
      : ["Desconectado", "bg-slate-50 text-slate-600 ring-slate-200", "bg-slate-300"];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${clase}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${punto}`} />
      {etiqueta}
    </span>
  );
}

const columnas: ColumnaTabla<Conexion>[] = [
  {
    key: "usuario", titulo: "Usuario", movil: "titulo", claseTh: "!pl-5", claseTd: "!pl-5",
    celda: (c) => (
      <div className="flex min-w-0 items-center gap-3">
        <Avatar nombre={c.nombre} tenue={!c.conectado} />
        <div className="min-w-0">
          <p className={`flex items-center gap-1.5 font-medium md:truncate ${c.activo ? "text-slate-900" : "text-slate-500"}`}>
            <span className="min-w-0 md:truncate">{c.nombre}</span>
            {c.es_yo ? <span className="shrink-0 rounded bg-slate-100 px-1.5 py-px text-[10px] font-semibold text-slate-500">Vos</span> : null}
          </p>
          <p className="text-xs font-normal text-slate-500 [overflow-wrap:anywhere] md:truncate">{c.email ?? "—"}</p>
        </div>
      </div>
    ),
  },
  { key: "estado", titulo: "Estado", movil: "chip", celda: (c) => <PillConexion c={c} /> },
  {
    key: "ultima", titulo: "Última conexión", movil: "dato", claseTd: "text-xs md:whitespace-nowrap",
    celda: (c) => (c.conectado ? (
      <span className="font-semibold text-emerald-700">Ahora</span>
    ) : c.ultima_conexion ? (
      <span className="tabular-nums text-slate-600">
        {/* Después de 30 días haceCuanto ya da la fecha: no se repite. */}
        {/^\d/.test(haceCuanto(c.ultima_conexion)) ? null : <><span className="font-medium text-slate-800">{haceCuanto(c.ultima_conexion)}</span> · </>}
        {fechaHora(c.ultima_conexion)}
      </span>
    ) : (
      <span className="text-slate-400">Nunca entró</span>
    )),
  },
  { key: "perfil", titulo: "Perfil", movil: "chip", celda: (c) => <InsigniaPerfil nombre={c.perfil_nombre} codigo={c.perfil_codigo} /> },
];

/** La lista de conexiones, al día: cada 30 s mientras la pantalla se ve. También la usa la pestaña Usuarios. */
export function useConexiones() {
  const [filas, setFilas] = useState<Conexion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let t: number | null = null;
    const cargar = () => {
      apiFetch<Conexion[]>(`${URL_USUARIOS}/conexiones`)
        .then((d) => { setFilas(d); setError(null); })
        .catch((e: Error) => setError(e.message));
    };
    const arrancar = () => {
      if (t != null) return;
      cargar();
      t = window.setInterval(cargar, REFRESCO_MS);
    };
    const parar = () => {
      if (t != null) window.clearInterval(t);
      t = null;
    };
    const onVis = () => (document.visibilityState === "visible" ? arrancar() : parar());
    if (document.visibilityState === "visible") arrancar();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      parar();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return { filas, error };
}

export function VistaConexiones() {
  const { filas, error } = useConexiones();
  const conectados =filas?.filter((c) => c.conectado).length ?? 0;
  const activos = filas?.filter((c) => c.activo).length ?? 0;

  return (
    <div className="space-y-3">
      <div>
        {filas ? <p className="text-sm font-semibold text-slate-800">{conectados} conectado{conectados === 1 ? "" : "s"} de {activos} usuario{activos === 1 ? "" : "s"} activo{activos === 1 ? "" : "s"}</p> : null}
        <p className="text-xs text-slate-500">Conectado es quien tiene el sistema abierto y a la vista. Se actualiza solo cada 30 segundos.</p>
      </div>
      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {filas === null ? (
          error ? <p className="py-12 text-center text-sm text-slate-400">No se pudieron cargar las conexiones.</p> : <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-300" /></div>
        ) : (
          <TablaTarjetas filas={filas} columnas={columnas} claveFila={(c) => c.id} minAncho={700}
            vacio={<p className="py-12 text-center text-sm text-slate-400">Todavía no hay usuarios.</p>}
            claseFila={(c) => (c.activo ? "" : "opacity-60")}
            thBase="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500" tdBase="px-3 py-3" />
        )}
      </section>
    </div>
  );
}
