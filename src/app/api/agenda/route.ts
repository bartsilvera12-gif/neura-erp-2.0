/**
 * Agenda (portado de app/api/agenda del sistema actual).
 *
 *   GET  /api/agenda?desde&hasta&estado&responsable_id&cliente_id&q
 *        → citas enriquecidas (cliente, responsables con el principal primero, creado_por,
 *          puede_editar) ordenadas por inicio. `responsable_id` = principal O entre los
 *          responsables; `q` busca en título y nombre del contacto.
 *   POST /api/agenda { titulo, responsable_id, responsable_ids?, tipo?, estado?, inicio_at,
 *        fin_at, cliente_id?, contacto_nombre?, contacto_telefono?, ubicacion?,
 *        observaciones?, metadata? }
 *        → cita creada. Anti-doble-reserva del responsable principal (409). Avisa en la
 *          campanita a cada responsable que no sea quien la cargó.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { created, fail, ok, ERR } from "@/lib/api/responses";
import { isAgendaEstado, type AgendaCitaRow } from "@/modules/agenda/dominio";
import {
  UUID_RE, avisarResponsables, buscarConflictoHorario, citaIdsDeUsuario, clienteExiste, enrichAgendaRows,
  guardarResponsables, mensajeConflicto, usuariosValidos,
} from "@/modules/agenda/server";

function parseIso(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function optStr(v: unknown, max = 2000): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  const desde = parseIso(sp.get("desde"));
  const hasta = parseIso(sp.get("hasta"));
  const estado = sp.get("estado");
  const responsableId = sp.get("responsable_id");
  const clienteId = sp.get("cliente_id");
  // Sin los caracteres que arman la sintaxis de `or` de PostgREST.
  const q = (sp.get("q") ?? "").replace(/[,()*%\\]/g, " ").trim().slice(0, 100);

  try {
    let qq = ctx.db.select("agenda_citas", "*");
    if (desde) qq = qq.gte("inicio_at", desde);
    if (hasta) qq = qq.lte("inicio_at", hasta);
    if (estado && isAgendaEstado(estado)) qq = qq.eq("estado", estado);
    if (responsableId && UUID_RE.test(responsableId)) {
      // Una cita es "de" alguien si es su responsable principal O si figura entre los responsables.
      const ids = await citaIdsDeUsuario(ctx.db, responsableId);
      qq = ids.length ? qq.or(`responsable_id.eq.${responsableId},id.in.(${ids.join(",")})`) : qq.eq("responsable_id", responsableId);
    }
    if (clienteId && UUID_RE.test(clienteId)) qq = qq.eq("cliente_id", clienteId);
    if (q) qq = qq.or(`titulo.ilike.%${q}%,contacto_nombre.ilike.%${q}%`);

    const { data, error } = await qq.order("inicio_at", { ascending: true }).limit(2000);
    if (error) return fail(error.message);
    const rows = (data ?? []) as unknown as AgendaCitaRow[];
    return ok(await enrichAgendaRows(ctx.db, rows, ctx));
  } catch (e) {
    console.error("[agenda] GET", (e as Error).message);
    return ERR.server();
  }
});

export const POST = withTenant(async (ctx, req) => {
  let body: Record<string, unknown> | null = null;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object") return fail("Datos inválidos");

  const titulo = typeof body.titulo === "string" ? body.titulo.trim().slice(0, 200) : "";
  const responsableId = optStr(body.responsable_id);
  const inicioIso = parseIso(body.inicio_at);
  const finIso = parseIso(body.fin_at);
  if (!titulo) return fail("El título es obligatorio.");
  if (!responsableId) return fail("Elegí al menos un responsable.");
  if (!inicioIso || !finIso) return fail("Indicá fecha, hora de inicio y fin.");
  if (Date.parse(finIso) <= Date.parse(inicioIso)) return fail("El fin debe ser posterior al inicio.");

  try {
    // `responsable_ids` es la lista completa; `responsable_id` sigue siendo el principal
    // (el que usan disponibilidad y anti-doble-reserva).
    const pedidos = Array.isArray(body.responsable_ids) ? body.responsable_ids.filter((v): v is string => typeof v === "string") : [];
    const validos = await usuariosValidos(ctx.db, [responsableId, ...pedidos]);
    if (!validos.includes(responsableId)) return fail("El responsable no es un usuario activo de la empresa.");

    const clienteId = optStr(body.cliente_id);
    if (clienteId && !(await clienteExiste(ctx.db, clienteId))) return fail("El cliente no existe.");

    const estadoRaw = typeof body.estado === "string" ? body.estado : "pendiente";
    const estado = isAgendaEstado(estadoRaw) ? estadoRaw : "pendiente";

    const conflicto = await buscarConflictoHorario(ctx.db, { responsableId, inicioIso, finIso });
    if (conflicto) return fail(mensajeConflicto(conflicto), 409, "conflicto_horario");

    const metadata =
      body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata) ? (body.metadata as Record<string, unknown>) : {};

    const { data, error } = await ctx.db.insert("agenda_citas", {
      cliente_id: clienteId,
      responsable_id: responsableId,
      contacto_nombre: clienteId ? null : optStr(body.contacto_nombre, 200),
      contacto_telefono: clienteId ? null : optStr(body.contacto_telefono, 60),
      titulo,
      tipo: optStr(body.tipo, 60) ?? "reunion",
      estado,
      inicio_at: inicioIso,
      fin_at: finIso,
      ubicacion: optStr(body.ubicacion, 500),
      observaciones: optStr(body.observaciones, 5000),
      metadata,
      created_by: ctx.usuarioId,
      updated_by: ctx.usuarioId,
    });
    const row = (data?.[0] ?? null) as unknown as AgendaCitaRow | null;
    if (error || !row) return fail(error?.message ?? "No se pudo crear la cita.");

    await guardarResponsables(ctx.db, row.id, responsableId, validos);
    await avisarResponsables(ctx.db, ctx.empresaId, { cita: row, usuarioIds: validos, actorId: ctx.usuarioId, motivo: "nueva" });
    const [enriched] = await enrichAgendaRows(ctx.db, [row], ctx);
    return created(enriched ?? row);
  } catch (e) {
    console.error("[agenda] POST", (e as Error).message);
    return ERR.server();
  }
});
