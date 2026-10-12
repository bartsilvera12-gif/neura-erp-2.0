/**
 * Una cita de la agenda (portado de app/api/agenda/[id] del sistema actual).
 *
 *   GET    /api/agenda/[id] → cita enriquecida
 *   PATCH  /api/agenda/[id]
 *          · { accion: "reprogramar", inicio_at, fin_at, responsable_id?, responsable_ids?, observaciones? }
 *            → crea una cita NUEVA (pendiente, reprogramada_de_id = la original) y marca la
 *              original como `reprogramada`.
 *          · edición / cambio de estado: { titulo?, tipo?, estado?, motivo?|cancelada_motivo?,
 *            cliente_id?, contacto_nombre?, contacto_telefono?, ubicacion?, observaciones?,
 *            responsable_id?, responsable_ids?, inicio_at?, fin_at?, metadata? }
 *            (pendiente → confirmada → completada / no_asistio / cancelada).
 *          Anti-doble-reserva (409) si cambia el horario/responsable o se reactiva.
 *   DELETE /api/agenda/[id][?motivo=] → cancela (estado 'cancelada'). ?hard=1 la borra (ADMIN).
 *
 * La cambia el ADMIN, quien la cargó o cualquiera de sus responsables. Una cita
 * reprogramada ya no se cambia (la vigente es la nueva).
 */
import type { NextRequest } from "next/server";
import { withTenant, type TenantContext } from "@/lib/api/with-tenant";
import { ok, fail, ERR } from "@/lib/api/responses";
import { ESTADOS_NO_BLOQUEAN, isAgendaEstado, type AgendaCitaRow } from "@/modules/agenda/dominio";
import {
  UUID_RE, avisarResponsables, buscarConflictoHorario, clienteExiste, enrichAgendaRows, guardarResponsables,
  mensajeConflicto, puedeModificar, responsablesPorCita, usuariosValidos,
} from "@/modules/agenda/server";

function parseIso(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
function optStr(v: unknown, max = 2000): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}
function hasKey(body: Record<string, unknown>, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, k);
}
function idCita(req: NextRequest): string | null {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const i = segs.indexOf("agenda");
  const v = i >= 0 ? segs[i + 1] : null;
  return v && UUID_RE.test(v) ? v : null;
}

async function leer(ctx: TenantContext, id: string): Promise<AgendaCitaRow | null> {
  const { data, error } = await ctx.db.select("agenda_citas", "*").eq("id", id).limit(1);
  if (error) throw new Error(error.message);
  return (data?.[0] ?? null) as unknown as AgendaCitaRow | null;
}

export const GET = withTenant(async (ctx, req) => {
  const id = idCita(req);
  if (!id) return ERR.invalid("Cita inválida");
  try {
    const row = await leer(ctx, id);
    if (!row) return ERR.notFound("Cita");
    const [enriched] = await enrichAgendaRows(ctx.db, [row], ctx);
    return ok(enriched ?? row);
  } catch (e) {
    console.error("[agenda] GET id", (e as Error).message);
    return ERR.server();
  }
});

export const PATCH = withTenant(async (ctx, req) => {
  const id = idCita(req);
  if (!id) return ERR.invalid("Cita inválida");
  let body: Record<string, unknown> | null = null;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object") return fail("Datos inválidos");

  try {
    const prev = await leer(ctx, id);
    if (!prev) return ERR.notFound("Cita");
    const respPrev = (await responsablesPorCita(ctx.db, [id])).get(id) ?? [];
    if (!puedeModificar(ctx, prev, respPrev)) return ERR.forbidden();
    if (prev.estado === "reprogramada") return fail("La cita fue reprogramada: ya no se puede cambiar.");
    const ahora = new Date().toISOString();

    // ── Reprogramación: nueva cita vinculada + la original queda `reprogramada` ──
    if (body.accion === "reprogramar") {
      const inicioIso = parseIso(body.inicio_at);
      const finIso = parseIso(body.fin_at);
      if (!inicioIso || !finIso) return fail("Indicá fecha, hora de inicio y fin.");
      if (Date.parse(finIso) <= Date.parse(inicioIso)) return fail("El fin debe ser posterior al inicio.");
      const responsableId = optStr(body.responsable_id) ?? prev.responsable_id;
      const pedidos = Array.isArray(body.responsable_ids)
        ? body.responsable_ids.filter((v): v is string => typeof v === "string")
        : respPrev;
      const validos = await usuariosValidos(ctx.db, [responsableId, ...pedidos]);
      if (!validos.includes(responsableId)) return fail("El responsable no es un usuario activo de la empresa.");

      // La original deja de ocupar el horario al reprogramarse: no choca consigo misma.
      const conflicto = await buscarConflictoHorario(ctx.db, { responsableId, inicioIso, finIso, excluirId: prev.id });
      if (conflicto) return fail(mensajeConflicto(conflicto), 409, "conflicto_horario");

      const { data, error } = await ctx.db.insert("agenda_citas", {
        cliente_id: prev.cliente_id,
        responsable_id: responsableId,
        contacto_nombre: prev.contacto_nombre,
        contacto_telefono: prev.contacto_telefono,
        titulo: prev.titulo,
        tipo: prev.tipo ?? "reunion",
        estado: "pendiente",
        inicio_at: inicioIso,
        fin_at: finIso,
        ubicacion: prev.ubicacion,
        observaciones: optStr(body.observaciones, 5000) ?? prev.observaciones,
        reprogramada_de_id: prev.id,
        metadata: prev.metadata ?? {},
        created_by: ctx.usuarioId,
        updated_by: ctx.usuarioId,
      });
      const row = (data?.[0] ?? null) as unknown as AgendaCitaRow | null;
      if (error || !row) return fail(error?.message ?? "No se pudo reprogramar.");

      await ctx.db.update("agenda_citas", { estado: "reprogramada", updated_by: ctx.usuarioId, updated_at: ahora }).eq("id", prev.id);
      // Arrastra a los mismos responsables: se mueve la misma reunión, no se crea otra.
      await guardarResponsables(ctx.db, row.id, responsableId, validos);
      await avisarResponsables(ctx.db, ctx.empresaId, { cita: row, usuarioIds: validos, actorId: ctx.usuarioId, motivo: "reprogramada" });
      const [enriched] = await enrichAgendaRows(ctx.db, [row], ctx);
      return ok(enriched ?? row);
    }

    // ── Edición / cambio de estado ──────────────────────────────────────────
    const patch: Record<string, unknown> = { updated_by: ctx.usuarioId, updated_at: ahora };

    if (hasKey(body, "titulo")) {
      const t = typeof body.titulo === "string" ? body.titulo.trim().slice(0, 200) : "";
      if (!t) return fail("El título no puede quedar vacío.");
      patch.titulo = t;
    }
    if (hasKey(body, "tipo")) patch.tipo = optStr(body.tipo, 60) ?? "reunion";
    if (hasKey(body, "cliente_id")) {
      const cid = optStr(body.cliente_id);
      if (cid && !(await clienteExiste(ctx.db, cid))) return fail("El cliente no existe.");
      patch.cliente_id = cid;
    }
    if (hasKey(body, "contacto_nombre")) patch.contacto_nombre = optStr(body.contacto_nombre, 200);
    if (hasKey(body, "contacto_telefono")) patch.contacto_telefono = optStr(body.contacto_telefono, 60);
    if (hasKey(body, "ubicacion")) patch.ubicacion = optStr(body.ubicacion, 500);
    if (hasKey(body, "observaciones")) patch.observaciones = optStr(body.observaciones, 5000);
    if (hasKey(body, "cancelada_motivo")) patch.cancelada_motivo = optStr(body.cancelada_motivo, 500);
    if (hasKey(body, "motivo")) patch.cancelada_motivo = optStr(body.motivo, 500);
    if (hasKey(body, "metadata") && body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)) {
      patch.metadata = body.metadata;
    }
    if (hasKey(body, "estado")) {
      if (!isAgendaEstado(body.estado)) return fail("Estado inválido.");
      if (body.estado === "reprogramada") return fail("Para reprogramar usá «Reprogramar».");
      patch.estado = body.estado;
      // Al salir de cancelada, el motivo ya no corresponde.
      if (body.estado !== "cancelada" && prev.estado === "cancelada") patch.cancelada_motivo = null;
    }
    let validos: string[] | null = null;
    if (hasKey(body, "responsable_id") || hasKey(body, "responsable_ids")) {
      const rid = hasKey(body, "responsable_id") ? optStr(body.responsable_id) : prev.responsable_id;
      if (!rid) return fail("Elegí al menos un responsable.");
      const pedidos = Array.isArray(body.responsable_ids) ? body.responsable_ids.filter((v): v is string => typeof v === "string") : respPrev;
      validos = await usuariosValidos(ctx.db, [rid, ...pedidos]);
      if (!validos.includes(rid)) return fail("El responsable no es un usuario activo de la empresa.");
      patch.responsable_id = rid;
    }
    if (hasKey(body, "inicio_at")) {
      const v = parseIso(body.inicio_at);
      if (!v) return fail("Inicio inválido.");
      patch.inicio_at = v;
    }
    if (hasKey(body, "fin_at")) {
      const v = parseIso(body.fin_at);
      if (!v) return fail("Fin inválido.");
      patch.fin_at = v;
    }

    // Valores efectivos tras el patch para validar rango y solape.
    const inicioEff = (patch.inicio_at as string | undefined) ?? prev.inicio_at;
    const finEff = (patch.fin_at as string | undefined) ?? prev.fin_at;
    const responsableEff = (patch.responsable_id as string | undefined) ?? prev.responsable_id;
    const estadoEff = (patch.estado as string | undefined) ?? prev.estado;
    if (Date.parse(finEff) <= Date.parse(inicioEff)) return fail("El fin debe ser posterior al inicio.");

    // Anti-solape si la cita ocupará horario y cambió tiempo/responsable, o se reactiva.
    const cambiaHorario = hasKey(body, "inicio_at") || hasKey(body, "fin_at") || patch.responsable_id !== undefined;
    const seReactiva = ESTADOS_NO_BLOQUEAN.has(prev.estado) && !ESTADOS_NO_BLOQUEAN.has(estadoEff);
    if ((cambiaHorario || seReactiva) && !ESTADOS_NO_BLOQUEAN.has(estadoEff) && responsableEff) {
      const conflicto = await buscarConflictoHorario(ctx.db, { responsableId: responsableEff, inicioIso: inicioEff, finIso: finEff, excluirId: prev.id });
      if (conflicto) return fail(mensajeConflicto(conflicto), 409, "conflicto_horario");
    }

    const { data, error } = await ctx.db.update("agenda_citas", patch).eq("id", id).select("*");
    const row = (data?.[0] ?? null) as unknown as AgendaCitaRow | null;
    if (error || !row) return fail(error?.message ?? "No se pudo actualizar.");

    if (validos) {
      await guardarResponsables(ctx.db, row.id, row.responsable_id, validos);
      // Aviso sólo a quienes se SUMARON (los que ya estaban ya sabían).
      const antes = new Set([prev.responsable_id, ...respPrev]);
      const nuevos = validos.filter((u) => !antes.has(u));
      await avisarResponsables(ctx.db, ctx.empresaId, { cita: row, usuarioIds: nuevos, actorId: ctx.usuarioId, motivo: "asignada" });
    }
    const [enriched] = await enrichAgendaRows(ctx.db, [row], ctx);
    return ok(enriched ?? row);
  } catch (e) {
    console.error("[agenda] PATCH", (e as Error).message);
    return ERR.server();
  }
});

/** Por defecto cancela (estado 'cancelada', con motivo opcional). Borrado físico sólo con ?hard=1 (ADMIN). */
export const DELETE = withTenant(async (ctx, req) => {
  const id = idCita(req);
  if (!id) return ERR.invalid("Cita inválida");
  const sp = new URL(req.url).searchParams;
  const hard = sp.get("hard") === "1";
  const motivo = sp.get("motivo")?.trim().slice(0, 500) || null;
  try {
    const prev = await leer(ctx, id);
    if (!prev) return ERR.notFound("Cita");
    const respPrev = (await responsablesPorCita(ctx.db, [id])).get(id) ?? [];
    if (!puedeModificar(ctx, prev, respPrev)) return ERR.forbidden();

    if (hard) {
      if (ctx.rol !== "ADMIN") return ERR.forbidden();
      const { error } = await ctx.db.delete("agenda_citas").eq("id", id);
      if (error) return fail(error.message);
      return ok({ id, deleted: true });
    }
    if (prev.estado === "reprogramada") return fail("La cita fue reprogramada: ya no se puede cambiar.");

    const { data, error } = await ctx.db
      .update("agenda_citas", { estado: "cancelada", cancelada_motivo: motivo, updated_by: ctx.usuarioId, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*");
    if (error) return fail(error.message);
    const row = (data?.[0] ?? null) as unknown as AgendaCitaRow | null;
    if (!row) return ERR.notFound("Cita");
    return ok(row);
  } catch (e) {
    console.error("[agenda] DELETE", (e as Error).message);
    return ERR.server();
  }
});
