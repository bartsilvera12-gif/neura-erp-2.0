"use client";

/**
 * Edición del ticket (el FormTicket del actual, en modo "editar"). Cada campo que
 * cambia queda en el historial con su valor anterior. El cliente no se cambia desde
 * acá. La prioridad la pone la clasificación (la sugerida del catálogo), y la fecha
 * objetivo se recalcula con el SLA de la clasificación mientras no la toques.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Clock, ListChecks, Tags, UserRoundCheck, type LucideIcon } from "lucide-react";
import { isoAFechaHoraLocal, puedeEstarACargo, slaDe, vencimientoSla } from "@/modules/soporte/dominio";
import { apiSoporte } from "@/modules/soporte/api";
import { useTicket } from "@/modules/soporte/detalle/TicketContexto";
import { Aviso, Boton, Desplegable, IconoTile, SelectorBuscable, TARJETA, TONO_AREA, claseBoton, claseEtiqueta, claseInput, type Tono } from "@/modules/soporte/ui";

function Campo({ etiqueta, requerido, children, ayuda }: { etiqueta: string; requerido?: boolean; children: React.ReactNode; ayuda?: React.ReactNode }) {
  return (
    <div>
      <span className={claseEtiqueta}>
        {etiqueta}
        {requerido ? <span className="text-rose-500"> *</span> : null}
      </span>
      {children}
      {ayuda ? <p className="mt-1 text-[11.5px] text-slate-400">{ayuda}</p> : null}
    </div>
  );
}

function Seccion({ titulo, descripcion, icono, tono, children }: { titulo: string; descripcion?: string; icono: LucideIcon; tono: Tono; children: React.ReactNode }) {
  return (
    <section className="grid gap-5 border-b border-slate-100 py-6 first:pt-0 last:border-0 last:pb-0 lg:grid-cols-[220px_1fr]">
      <div>
        <IconoTile icono={icono} tono={tono} />
        <h2 className="mt-2.5 text-sm font-bold text-slate-800">{titulo}</h2>
        {descripcion ? <p className="mt-1 text-[12.5px] leading-relaxed text-slate-500">{descripcion}</p> : null}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export default function TicketEditarPage() {
  const router = useRouter();
  const { ticket: t, catalogos: cat, recargar } = useTicket();
  const base = `/soporte/tickets/${t.id}`;
  const [v, setV] = useState({
    tipo_codigo: t.tipo_codigo,
    clasificacion_codigo: t.clasificacion_codigo ?? "",
    prioridad_codigo: t.prioridad_codigo,
    asunto: t.asunto,
    descripcion: t.descripcion ?? "",
    resultado_esperado: t.resultado_esperado ?? "",
    impacto_operativo: t.impacto_operativo ?? "",
    responsable_id: t.responsable_id ?? "",
    fecha_objetivo: isoAFechaHoraLocal(t.fecha_objetivo),
    proxima_accion: t.proxima_accion ?? "",
  });
  const [fechaTocada, setFechaTocada] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof v>(k: K, valor: (typeof v)[K]) => setV((p) => ({ ...p, [k]: valor }));

  const clasificaciones = useMemo(() => cat.clasificaciones.filter((c) => c.activo && c.tipo_codigo === v.tipo_codigo), [cat, v.tipo_codigo]);
  const sla = v.tipo_codigo ? slaDe(cat, v.tipo_codigo, v.clasificacion_codigo || null) : null;

  const tipoOpciones = [{ value: "", label: "Seleccionar…" }, ...cat.tipos.filter((x) => x.activo || x.codigo === t.tipo_codigo).map((x) => ({ value: x.codigo, label: x.nombre }))];
  const responsableOpciones = [
    { value: "", label: "Sin asignar" },
    ...cat.personas.filter((p) => puedeEstarACargo(p, cat.hay_equipo) || p.id === t.responsable_id).map((u) => ({ value: u.id, label: u.nombre, detalle: u.area, tono: TONO_AREA[u.area] })),
  ];

  const faltantes: string[] = [];
  if (!v.tipo_codigo) faltantes.push("tipo de solicitud");
  if (clasificaciones.length > 0 && !v.clasificacion_codigo) faltantes.push("clasificación");
  if (!v.asunto.trim()) faltantes.push("asunto");
  if (!v.descripcion.trim()) faltantes.push("descripción");

  const enviar = async () => {
    if (faltantes.length) {
      setError(`Completá: ${faltantes.join(", ")}.`);
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      // La fecha objetivo viaja sólo si la tocaste: si cambia la clasificación, el
      // servidor la recalcula con el SLA nuevo (y así no se "cambia" por redondeo de segundos).
      const { fecha_objetivo, ...resto } = v;
      await apiSoporte(`/api/soporte/tickets/${t.id}`, {
        method: "PATCH",
        json: {
          ...resto,
          clasificacion_codigo: v.clasificacion_codigo || null,
          responsable_id: v.responsable_id || null,
          ...(fechaTocada ? { fecha_objetivo } : {}),
        },
      });
      await recargar();
      router.push(base);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
      setGuardando(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void enviar();
      }}
      className={`${TARJETA} p-5 md:p-7`}
    >
      <Seccion icono={Tags} tono="violeta" titulo="Clasificación" descripcion="A quién corresponde y qué tipo de pedido es. La clasificación define el SLA.">
        <Campo etiqueta="Cliente" ayuda="El cliente no se cambia desde la edición.">
          <input className={`${claseInput} bg-slate-50 text-slate-500`} value={t.cliente_nombre ?? "Sin cliente"} disabled readOnly />
        </Campo>
        <div className="grid gap-4 md:grid-cols-2">
          <Campo etiqueta="Tipo de solicitud" requerido>
            <Desplegable
              value={v.tipo_codigo}
              onChange={(x) => setV((p) => ({ ...p, tipo_codigo: x, clasificacion_codigo: "" }))}
              options={tipoOpciones}
            />
          </Campo>
          <Campo etiqueta="Clasificación" requerido={clasificaciones.length > 0}>
            <Desplegable
              value={v.clasificacion_codigo}
              disabled={clasificaciones.length === 0}
              onChange={(x) => {
                const c = clasificaciones.find((y) => y.codigo === x);
                setV((p) => ({
                  ...p,
                  clasificacion_codigo: x,
                  prioridad_codigo: c?.prioridad_sugerida || p.prioridad_codigo || "normal",
                  fecha_objetivo: !fechaTocada && c ? isoAFechaHoraLocal(vencimientoSla(t.created_at, c.sla_horas, cat.config)) : p.fecha_objetivo,
                }));
              }}
              options={[
                { value: "", label: clasificaciones.length ? "Seleccionar…" : "No aplica" },
                ...clasificaciones.map((c) => ({ value: c.codigo, label: c.sla_horas != null ? `${c.nombre} · SLA ${c.sla_horas} h` : c.nombre })),
              ]}
            />
          </Campo>
        </div>
        {v.tipo_codigo ? (
          <p className="flex items-center gap-2 rounded-lg bg-[#4FAEB2]/8 px-3 py-2 text-[12.5px] text-[#2F6E71]">
            <Clock className="h-4 w-4 shrink-0" aria-hidden />
            {sla != null ? (
              <span>
                Service level: <strong>{sla} horas laborales</strong> — si cambiás la clasificación, el SLA se recalcula y queda en el historial.
              </span>
            ) : (
              <span>Este tipo de solicitud no tiene SLA configurado.</span>
            )}
          </p>
        ) : null}
      </Seccion>

      <Seccion icono={ListChecks} tono="celeste" titulo="Detalle" descripcion="Lo que el técnico y QA necesitan para reproducirlo y validarlo sin tener que preguntar.">
        <Campo etiqueta="Asunto" requerido>
          <input className={claseInput} value={v.asunto} onChange={(e) => set("asunto", e.target.value)} placeholder="Resumen breve del problema o solicitud" maxLength={200} />
        </Campo>
        <Campo etiqueta="Descripción" requerido>
          <textarea className={`${claseInput} min-h-32`} value={v.descripcion} onChange={(e) => set("descripcion", e.target.value)} placeholder="Describí en detalle el problema, solicitud o consulta…" />
        </Campo>
        <div className="grid gap-4 md:grid-cols-2">
          <Campo etiqueta="Resultado esperado">
            <textarea className={`${claseInput} min-h-20`} value={v.resultado_esperado} onChange={(e) => set("resultado_esperado", e.target.value)} />
          </Campo>
          <Campo etiqueta="Impacto operativo">
            <textarea className={`${claseInput} min-h-20`} value={v.impacto_operativo} onChange={(e) => set("impacto_operativo", e.target.value)} />
          </Campo>
        </div>
      </Seccion>

      <Seccion icono={UserRoundCheck} tono="turquesa" titulo="Asignación" descripcion="Quién tiene la próxima acción y para cuándo.">
        <div className="grid gap-4 md:grid-cols-2">
          <Campo etiqueta="Responsable">
            <SelectorBuscable avatares ariaLabel="Responsable" value={v.responsable_id} onChange={(x) => set("responsable_id", x)} opciones={responsableOpciones} placeholder="Sin asignar" buscarPlaceholder="Buscar persona o área…" vacio="Nadie coincide" />
          </Campo>
          <Campo
            etiqueta="Fecha objetivo"
            ayuda={v.clasificacion_codigo && sla != null && !fechaTocada ? `Calculada por la clasificación: ${sla} horas laborales desde que se creó. Podés cambiarla.` : undefined}
          >
            <input
              type="datetime-local"
              className={`${claseInput} h-[42px]`}
              value={v.fecha_objetivo}
              onChange={(e) => {
                setFechaTocada(true);
                set("fecha_objetivo", e.target.value);
              }}
            />
          </Campo>
        </div>
        <Campo etiqueta="Próxima acción">
          <input className={claseInput} value={v.proxima_accion} onChange={(e) => set("proxima_accion", e.target.value)} maxLength={500} placeholder="Qué hay que hacer a continuación" />
        </Campo>
      </Seccion>

      <div className="mt-6 space-y-3 border-t border-slate-100 pt-5">
        {error ? <Aviso>{error}</Aviso> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Link href={base} className={claseBoton("secundario")} aria-disabled={guardando}>
            Cancelar
          </Link>
          <Boton type="submit" cargando={guardando}>
            Guardar cambios
          </Boton>
        </div>
      </div>
    </form>
  );
}
