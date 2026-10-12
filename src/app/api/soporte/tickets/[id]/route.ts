/**
 * Un ticket de Soporte.
 *   GET   /api/soporte/tickets/[id] → { ticket (con etiquetas, personas y SLA), contadores }
 *   PATCH /api/soporte/tickets/[id] → edita y deja rastro de CADA cambio en el historial.
 *
 * Reglas del flujo (iguales al actual):
 *   · el cambio de estado respeta las transiciones (ver TRANSICIONES; QA según soporte_config);
 *   · un estado abierto que no es el inicial no puede quedar sin responsable;
 *   · no se pasa a Resuelto ni a Cerrado con subtareas sin finalizar;
 *   · devolver desde "Listo para revisión" exige comentario (queda como es_rechazo_qa);
 *   · un estado que detiene el SLA fija resuelto_at; Cerrado / Cancelado fijan cerrado_at;
 *   · al entrar a "Listo para revisión" se abre la subtarea de revisión de QA;
 *   · cambiar la clasificación recalcula el SLA (y la fecha objetivo), y queda registrado.
 * El historial se escribe DESPUÉS de guardar: un cambio rechazado no deja eventos.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import {
  ESTADOS_EXIGEN_SUBTAREAS_FINALIZADAS,
  eventoDeTransicion,
  fechaObjetivoAIso,
  mensajeEstadoFinal,
  numeroTicket,
  puedeEstarACargo,
  requiereResponsable,
  slaDe,
  transicionPermitida,
  vencimientoSla,
} from "@/modules/soporte/dominio";
import {
  abrirRevisionQa,
  accesoSoporte,
  avisarEstadoACreador,
  cuerpo,
  enriquecerTickets,
  falla,
  idTras,
  leerCatalogos,
  leerConfig,
  notificar,
  personasDeEmpresa,
  registrarHistorial,
  sinAccesoSoporte,
  subtareasSinFinalizar,
  ticketDeEmpresa,
  type EventoHistorial,
} from "@/modules/soporte/server";

export const GET = withTenant(async (ctx, req) => {
  if (!(await accesoSoporte(ctx))) return sinAccesoSoporte();
  const id = idTras(req, "tickets");
  if (!id) return falla("Ticket no encontrado", 404);
  try {
    const [fila, cat, cfg, com, arch, rel] = await Promise.all([
      ticketDeEmpresa(ctx, id),
      leerCatalogos(ctx),
      leerConfig(ctx),
      ctx.db.select("soporte_ticket_comentarios", "id", { count: "exact", head: true }).eq("ticket_id", id).is("subtarea_id", null),
      ctx.db.select("soporte_ticket_archivos", "id", { count: "exact", head: true }).eq("ticket_id", id).is("deleted_at", null),
      ctx.db.select("soporte_ticket_relaciones", "id", { count: "exact", head: true }).or(`ticket_id.eq.${id},relacionado_id.eq.${id}`),
    ]);
    if (!fila) return falla("Ticket no encontrado", 404);
    const [ticket] = await enriquecerTickets(ctx, cat, cfg, [fila]);
    return ok({ ticket, contadores: { comentarios: com.count ?? 0, archivos: arch.count ?? 0, relaciones: rel.count ?? 0 } });
  } catch (e) {
    console.error("[soporte/ticket]", (e as Error)?.message);
    return falla("No se pudo cargar el ticket", 500);
  }
});

const TEXTOS = [
  ["asunto", 200],
  ["descripcion", 20_000],
  ["resultado_esperado", 20_000],
  ["impacto_operativo", 20_000],
] as const;

export const PATCH = withTenant(async (ctx, req) => {
  if (!(await accesoSoporte(ctx))) return sinAccesoSoporte();
  const id = idTras(req, "tickets");
  if (!id) return falla("Ticket no encontrado", 404);
  try {
    const actual = await ticketDeEmpresa(ctx, id);
    if (!actual) return falla("Ticket no encontrado", 404);
    const body = await cuerpo(req);
    if (!body) return falla("Datos inválidos");

    const [cat, cfg] = await Promise.all([leerCatalogos(ctx), leerConfig(ctx)]);
    const patch: Record<string, unknown> = {};
    const eventos: EventoHistorial[] = [];
    const ahora = new Date().toISOString();

    // ---- textos
    const editados: string[] = [];
    for (const [campo, max] of TEXTOS) {
      if (!(campo in body)) continue;
      const v = typeof body[campo] === "string" ? (body[campo] as string).trim().slice(0, max) : "";
      const nuevo = v || null;
      if ((campo === "asunto" || campo === "descripcion") && !nuevo) {
        return falla(campo === "asunto" ? "El asunto es obligatorio" : "La descripción es obligatoria");
      }
      if (nuevo !== (actual[campo] ?? null)) {
        patch[campo] = nuevo;
        editados.push(campo);
      }
    }
    if (editados.length) eventos.push({ tipo_evento: "edicion", metadata: { campos: editados } });

    // ---- tipo y clasificación (definen el SLA)
    let tipoNuevo = actual.tipo_codigo;
    let clasifNueva = actual.clasificacion_codigo;
    if ("tipo_codigo" in body && body.tipo_codigo !== actual.tipo_codigo) {
      const t = cat.tipos.find((x) => x.activo && x.codigo === body.tipo_codigo);
      if (!t) return falla("Tipo inválido");
      tipoNuevo = t.codigo;
      patch.tipo_codigo = t.codigo;
      eventos.push({ tipo_evento: "cambio_tipo", valor_anterior: actual.tipo_codigo, valor_nuevo: t.codigo });
      clasifNueva = null;
    }
    if ("clasificacion_codigo" in body || patch.tipo_codigo) {
      const deseada = "clasificacion_codigo" in body ? (body.clasificacion_codigo as string | null) : clasifNueva;
      const posibles = cat.clasificaciones.filter((c) => c.activo && c.tipo_codigo === tipoNuevo);
      if (posibles.length > 0) {
        const c = posibles.find((x) => x.codigo === deseada);
        if (!c) return falla("Elegí una clasificación válida para el tipo");
        clasifNueva = c.codigo;
      } else {
        clasifNueva = null;
      }
      if (clasifNueva !== actual.clasificacion_codigo) {
        patch.clasificacion_codigo = clasifNueva;
        eventos.push({ tipo_evento: "cambio_clasificacion", valor_anterior: actual.clasificacion_codigo, valor_nuevo: clasifNueva });
      }
    }
    if (patch.tipo_codigo !== undefined || patch.clasificacion_codigo !== undefined) {
      const sla = slaDe(cat, tipoNuevo, clasifNueva);
      const previo = actual.sla_horas == null ? null : Number(actual.sla_horas);
      if (sla !== previo) {
        patch.sla_horas = sla;
        eventos.push({ tipo_evento: "cambio_sla", valor_anterior: previo == null ? null : String(previo), valor_nuevo: sla == null ? null : String(sla) });
      }
    }

    // ---- prioridad
    if ("prioridad_codigo" in body && body.prioridad_codigo !== actual.prioridad_codigo) {
      const pr = cat.prioridades.find((x) => x.activo && x.codigo === body.prioridad_codigo);
      if (!pr) return falla("Prioridad inválida");
      patch.prioridad_codigo = pr.codigo;
      eventos.push({ tipo_evento: "cambio_prioridad", valor_anterior: actual.prioridad_codigo, valor_nuevo: pr.codigo });
    }

    // ---- responsable
    let responsableFinal = actual.responsable_id;
    if ("responsable_id" in body) {
      const nuevo = typeof body.responsable_id === "string" && body.responsable_id ? body.responsable_id : null;
      if (nuevo !== actual.responsable_id) {
        if (nuevo) {
          const equipo = await personasDeEmpresa(ctx);
          const hayEquipo = equipo.some((p) => p.es_tecnico || p.es_qa);
          if (!equipo.some((u) => u.id === nuevo && puedeEstarACargo(u, hayEquipo))) {
            return falla(hayEquipo ? "A cargo sólo pueden quedar Técnicos o QA" : "A cargo sólo puede quedar un administrador");
          }
        }
        patch.responsable_id = nuevo;
        responsableFinal = nuevo;
        eventos.push({ tipo_evento: "cambio_responsable", valor_anterior: actual.responsable_id, valor_nuevo: nuevo });
      }
    }

    // ---- próxima acción
    if ("proxima_accion" in body) {
      const v = typeof body.proxima_accion === "string" ? body.proxima_accion.trim().slice(0, 500) || null : null;
      if (v !== actual.proxima_accion) {
        patch.proxima_accion = v;
        eventos.push({ tipo_evento: "cambio_proxima_accion", valor_anterior: actual.proxima_accion, valor_nuevo: v });
      }
    }

    // ---- fecha objetivo: si cambia la clasificación y no se mandó fecha, vence con el SLA nuevo desde el alta.
    const nivelCambiado = patch.clasificacion_codigo !== undefined && clasifNueva != null;
    if ("fecha_objetivo" in body || nivelCambiado) {
      let v: string | null = null;
      if (typeof body.fecha_objetivo === "string" && body.fecha_objetivo) {
        const iso = fechaObjetivoAIso(body.fecha_objetivo);
        if (!iso) return falla("Fecha objetivo inválida");
        v = iso;
      } else if (nivelCambiado) {
        v = vencimientoSla(actual.created_at, slaDe(cat, tipoNuevo, clasifNueva), cfg);
      }
      const mismo = (a: string | null, b: string | null) => (a == null || b == null ? a === b : Date.parse(a) === Date.parse(b));
      if (!mismo(v, actual.fecha_objetivo)) {
        patch.fecha_objetivo = v;
        eventos.push({ tipo_evento: "cambio_fecha_objetivo", valor_anterior: actual.fecha_objetivo, valor_nuevo: v });
      }
    }

    // ---- estado
    let motivoDevolucion: string | null = null;
    if ("estado_codigo" in body && body.estado_codigo !== actual.estado_codigo) {
      const hacia = cat.estados.find((e) => e.activo && e.codigo === body.estado_codigo);
      if (!hacia) return falla("Estado inválido");
      if (!transicionPermitida(actual.estado_codigo, hacia.codigo, { qaActivo: cfg.qa_activo })) {
        const desde = cat.estados.find((e) => e.codigo === actual.estado_codigo)?.nombre ?? actual.estado_codigo;
        const final = mensajeEstadoFinal(actual, desde);
        if (final) return falla(final);
        return falla(`No se puede pasar de "${desde}" a "${hacia.nombre}"`);
      }
      if (requiereResponsable(hacia) && !responsableFinal) {
        return falla(`Para pasar a "${hacia.nombre}" el ticket necesita un responsable`);
      }
      if (ESTADOS_EXIGEN_SUBTAREAS_FINALIZADAS.includes(hacia.codigo)) {
        const pendientes = await subtareasSinFinalizar(ctx, id);
        if (pendientes.length > 0) {
          return falla(
            `No se puede pasar a "${hacia.nombre}": hay ${pendientes.length === 1 ? "una subtarea" : `${pendientes.length} subtareas`} sin finalizar (${pendientes.map((x) => x.titulo).join(", ")})`,
          );
        }
      }
      const evento = eventoDeTransicion(actual.estado_codigo, hacia.codigo);
      if (evento === "devolucion_qa") {
        motivoDevolucion = typeof body.comentario === "string" ? body.comentario.trim().slice(0, 20_000) : "";
        if (!motivoDevolucion) return falla("Explicá qué observó QA para devolver el ticket");
      }
      patch.estado_codigo = hacia.codigo;
      if (hacia.detiene_sla) {
        if (!actual.resuelto_at) patch.resuelto_at = ahora;
      } else {
        patch.resuelto_at = null;
      }
      patch.cerrado_at = hacia.codigo === "cerrado" || hacia.codigo === "cancelado" ? ahora : null;
      eventos.push({ tipo_evento: evento, valor_anterior: actual.estado_codigo, valor_nuevo: hacia.codigo });
    }

    if (Object.keys(patch).length === 0) return ok({ sin_cambios: true });

    patch.updated_at = ahora;
    patch.updated_by = ctx.usuarioId;
    const { error } = await ctx.db.update("soporte_tickets", patch).eq("id", id);
    if (error) return falla("No se pudo guardar el ticket");

    if (motivoDevolucion) {
      const { data: com } = await ctx.db.insert("soporte_ticket_comentarios", {
        ticket_id: id,
        usuario_id: ctx.usuarioId,
        contenido: motivoDevolucion,
        es_rechazo_qa: true,
      });
      const comId = (com?.[0] as { id?: string } | undefined)?.id ?? null;
      eventos.push({ tipo_evento: "comentario", metadata: { comentario_id: comId, rechazo_qa: true } });
    }

    await registrarHistorial(ctx, id, eventos);
    const asunto = (patch.asunto as string | undefined) ?? actual.asunto;

    if (patch.responsable_id) {
      await notificar(ctx, { usuarioId: patch.responsable_id as string, titulo: `Te asignaron el ticket ${numeroTicket(actual.numero)}`, cuerpo: asunto, ticketId: id });
    }
    if (patch.estado_codigo === "listo_revision") {
      await abrirRevisionQa(ctx, { id, numero: actual.numero, asunto });
    }
    if (motivoDevolucion) {
      await notificar(ctx, {
        usuarioId: responsableFinal,
        titulo: `QA pidió cambios en el ticket ${numeroTicket(actual.numero)}`,
        cuerpo: motivoDevolucion,
        ticketId: id,
      });
    }
    if (typeof patch.estado_codigo === "string") {
      await avisarEstadoACreador(ctx, { id, numero: actual.numero, asunto, created_by: actual.created_by, cliente_id: actual.cliente_id }, patch.estado_codigo);
    }
    return ok({ actualizado: true, eventos: eventos.map((e) => e.tipo_evento) });
  } catch (e) {
    console.error("[soporte/ticket PATCH]", (e as Error)?.message);
    return falla("No se pudo guardar el ticket", 500);
  }
});
