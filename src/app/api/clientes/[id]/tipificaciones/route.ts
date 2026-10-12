/**
 * Tipificaciones de UN cliente (portado del sistema actual).
 *
 *   GET  /api/clientes/[id]/tipificaciones
 *        → cliente, usuario actual, equipo, puede_soporte, horario laboral, clasificaciones
 *          y prioridades de Soporte, responsable por defecto, e historial con el estado EN
 *          VIVO del ticket vinculado (#0001, estado) o de la capacitación agendada.
 *
 *   POST /api/clientes/[id]/tipificaciones
 *        { estado_id, subestado_id, observacion, ticket?, agenda? }
 *        · sub-estado ticket_error / ticket_cambio → tipificación + ticket en UNA transacción
 *          (RPC soporte_crear_ticket_desde_tipificacion) y aviso en la campanita del responsable.
 *        · capacitacion (+ agenda) → primero la cita (valida horario y choque, 409), después
 *          la tipificación; si la tipificación falla, la cita se borra.
 *        · sin acción → sólo la tipificación.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, fail, ERR } from "@/lib/api/responses";
import {
  agendarCapacitacion, idDeRuta, leerAgendaCapacitacion, leerConfig, leerEquipo, notificar, puedeCargarSoporte,
  TIPO_CITA_CAPACITACION, UUID_RE,
} from "@/modules/tipificacion/server";
import {
  asuntoDesdeDescripcion, numeroTicket, type CitaDeTipificacion, type Clasificacion, type TicketDeTipificacion,
} from "@/modules/tipificacion/dominio";

const CLIENTE_COLS = "id, nombre, codigo, ruc, documento, telefono, email, activo, baja_at";

export const GET = withTenant(async (ctx, req) => {
  const clienteId = idDeRuta(req, "clientes");
  if (!clienteId) return ERR.invalid("Cliente inválido");

  const [cli, filas, eq, cfg, clas, prios, estados] = await Promise.all([
    ctx.db.select("clientes", CLIENTE_COLS).eq("id", clienteId).is("deleted_at", null).limit(1),
    ctx.db
      .select("tipificaciones", "id, fecha, usuario, usuario_id, tipo_gestion, resultado, observacion")
      .eq("cliente_id", clienteId)
      .order("fecha", { ascending: false })
      .limit(500),
    leerEquipo(ctx.db, ctx.usuarioId),
    leerConfig(ctx.db),
    ctx.db.select("soporte_clasificaciones", "codigo, tipo_codigo, nombre, sla_horas, prioridad_sugerida").eq("activo", true).order("sort_order"),
    ctx.db.select("soporte_prioridades", "codigo, nombre, color").eq("activo", true).order("sort_order"),
    ctx.db.select("soporte_estados", "codigo, nombre, color"),
  ]);
  if (cli.error || filas.error) return ERR.server();
  if (!cli.data?.length) return ERR.notFound("Cliente");

  const lista = (filas.data ?? []) as unknown as {
    id: string; fecha: string; usuario: string; usuario_id: string | null; tipo_gestion: string; resultado: string; observacion: string;
  }[];
  const ids = lista.map((f) => f.id);
  const nombres = new Map(eq.equipo.map((p) => [p.id, p.nombre]));
  const prioridades = (prios.data ?? []) as unknown as { codigo: string; nombre: string; color: string | null }[];
  const estadosSop = (estados.data ?? []) as unknown as { codigo: string; nombre: string; color: string | null }[];

  // Tickets vinculados (estado de AHORA, no una copia).
  const tickets = new Map<string, TicketDeTipificacion>();
  const citas = new Map<string, CitaDeTipificacion>();
  if (ids.length) {
    const [tks, cs] = await Promise.all([
      ctx.db
        .select("soporte_tickets", "id, numero, asunto, estado_codigo, prioridad_codigo, tipificacion_id")
        .eq("cliente_id", clienteId)
        .not("tipificacion_id", "is", null),
      ctx.db
        .select("agenda_citas", "id, inicio_at, fin_at, estado, responsable_id, metadata")
        .eq("cliente_id", clienteId)
        .eq("tipo", TIPO_CITA_CAPACITACION),
    ]);
    for (const t of (tks.data ?? []) as unknown as {
      id: string; numero: number; asunto: string; estado_codigo: string; prioridad_codigo: string; tipificacion_id: string;
    }[]) {
      const est = estadosSop.find((e) => e.codigo === t.estado_codigo);
      const pri = prioridades.find((p) => p.codigo === t.prioridad_codigo);
      tickets.set(t.tipificacion_id, {
        id: t.id,
        numero: Number(t.numero),
        asunto: t.asunto ?? "",
        estado_codigo: t.estado_codigo,
        estado_nombre: est?.nombre ?? t.estado_codigo,
        estado_color: est?.color ?? null,
        prioridad_codigo: t.prioridad_codigo,
        prioridad_nombre: pri?.nombre ?? t.prioridad_codigo,
      });
    }
    for (const c of (cs.data ?? []) as unknown as {
      id: string; inicio_at: string; fin_at: string; estado: string; responsable_id: string | null; metadata: Record<string, unknown> | null;
    }[]) {
      const tid = typeof c.metadata?.tipificacion_id === "string" ? c.metadata.tipificacion_id : null;
      if (!tid) continue;
      citas.set(tid, {
        id: c.id,
        inicio_at: c.inicio_at,
        fin_at: c.fin_at,
        estado: c.estado,
        responsable: c.responsable_id ? nombres.get(c.responsable_id) ?? null : null,
      });
    }
  }

  const c = cli.data[0] as unknown as Record<string, unknown>;
  const defId = cfg.responsable_defecto_id;
  return ok({
    cliente: {
      id: String(c.id),
      nombre: String(c.nombre ?? ""),
      codigo: (c.codigo as string | null) ?? null,
      ruc: (c.ruc as string | null) ?? null,
      documento: (c.documento as string | null) ?? null,
      telefono: (c.telefono as string | null) ?? null,
      email: (c.email as string | null) ?? null,
      activo: c.activo !== false,
      baja_at: (c.baja_at as string | null) ?? null,
    },
    usuario_actual: { id: ctx.usuarioId, nombre: eq.yo?.nombre ?? ctx.user.email ?? "Usuario" },
    equipo: eq.equipo,
    puede_soporte: puedeCargarSoporte(ctx.rol, eq.yo),
    horario: cfg.horario,
    clasificaciones: ((clas.data ?? []) as unknown as Clasificacion[]).map((x) => ({ ...x, sla_horas: Number(x.sla_horas) })),
    prioridades,
    responsable_defecto: defId && nombres.has(defId) ? { id: defId, nombre: nombres.get(defId)! } : null,
    tipificaciones: lista.map((f) => ({
      ...f,
      observacion: f.observacion ?? "",
      ticket: tickets.get(f.id) ?? null,
      cita: citas.get(f.id) ?? null,
    })),
  });
});

export const POST = withTenant(async (ctx, req) => {
  const clienteId = idDeRuta(req, "clientes");
  if (!clienteId) return ERR.invalid("Cliente inválido");

  let body: Record<string, unknown> | null = null;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object") return fail("Datos inválidos");

  const observacion = typeof body.observacion === "string" ? body.observacion.trim().slice(0, 5000) : "";
  if (!observacion) return fail("La observación es obligatoria.");
  const estadoId = typeof body.estado_id === "string" ? body.estado_id.trim() : "";
  const subestadoId = typeof body.subestado_id === "string" ? body.subestado_id.trim() : "";
  if (!UUID_RE.test(estadoId) || !UUID_RE.test(subestadoId)) return fail("Elegí el estado y el sub-estado.");

  const [cli, estRes, subRes, eq] = await Promise.all([
    ctx.db.select("clientes", "id, nombre").eq("id", clienteId).is("deleted_at", null).limit(1),
    ctx.db.select("tipificacion_familias", "id, nombre").eq("id", estadoId).limit(1),
    ctx.db.select("tipificacion_estados", "id, nombre, comportamiento, familia_id").eq("id", subestadoId).limit(1),
    leerEquipo(ctx.db, ctx.usuarioId),
  ]);
  if (cli.error || estRes.error || subRes.error) return ERR.server();
  const cliente = (cli.data?.[0] ?? null) as unknown as { id: string; nombre: string } | null;
  if (!cliente) return ERR.notFound("Cliente");
  const estado = (estRes.data?.[0] ?? null) as unknown as { id: string; nombre: string } | null;
  const sub = (subRes.data?.[0] ?? null) as unknown as { id: string; nombre: string; comportamiento: string | null; familia_id: string } | null;
  if (!estado) return fail("El estado no existe.");
  if (!sub || sub.familia_id !== estadoId) return fail("El sub-estado no corresponde al estado elegido.");

  // El historial muestra "Estado / Sub-estado": Estado en tipo_gestion, Sub-estado en resultado.
  const tipoGestion = estado.nombre;
  const resultado = sub.nombre;
  const comportamiento = (sub.comportamiento ?? "").trim();
  const usuarioNombre = eq.yo?.nombre ?? ctx.user.email ?? "Usuario";

  // ── Sub-estado que crea ticket ──────────────────────────────────────────────
  if (comportamiento === "ticket_error" || comportamiento === "ticket_cambio") {
    if (!puedeCargarSoporte(ctx.rol, eq.yo)) return fail("Tu usuario no puede cargar tickets de Soporte.", 403);
    const t = body.ticket && typeof body.ticket === "object" ? (body.ticket as Record<string, unknown>) : null;
    if (!t) return fail("Completá los datos del ticket de soporte.");

    const tipoCodigo = comportamiento === "ticket_error" ? "error" : "cambio";
    const { data: clasData } = await ctx.db
      .select("soporte_clasificaciones", "codigo, nombre, sla_horas, prioridad_sugerida")
      .eq("tipo_codigo", tipoCodigo)
      .eq("activo", true);
    const clasificaciones = (clasData ?? []) as unknown as { codigo: string; nombre: string; sla_horas: number | null; prioridad_sugerida: string | null }[];
    const codigo = typeof t.clasificacion_codigo === "string" ? t.clasificacion_codigo : "";
    const clas = clasificaciones.find((c) => c.codigo === codigo) ?? null;
    if (clasificaciones.length && !clas) return fail("Elegí la clasificación.");

    // La descripción del ticket es la observación; el asunto, su primera línea.
    const { data, error } = await ctx.db.rpc<{ tipificacion_id: string; ticket_id: string; numero: number }>(
      "soporte_crear_ticket_desde_tipificacion",
      {
        p_tipificacion: { cliente_id: clienteId, tipo_gestion: tipoGestion, resultado, observacion, familia_id: estadoId, estado_id: subestadoId },
        p_ticket: {
          asunto: asuntoDesdeDescripcion(observacion) || `${tipoCodigo === "error" ? "Error" : "Cambio"} · ${cliente.nombre}`.slice(0, 90),
          descripcion: observacion,
          tipo_codigo: tipoCodigo,
          clasificacion_codigo: clas?.codigo ?? "",
          // La prioridad la pone el nivel (sugerida del catálogo); no se elige a mano.
          prioridad_codigo: clas?.prioridad_sugerida || "normal",
          sla_horas: clas?.sla_horas ?? "",
        },
      },
    );
    if (error || !data) {
      console.error("[tipificaciones] ticket", error?.message);
      return fail(error?.message ?? "No se pudo crear el ticket. No se guardó la tipificación.");
    }

    // Aviso en la campanita (bandeja Soporte) a quien le cayó el ticket, salvo que sea quien lo cargó.
    const { data: tk } = await ctx.db.select("soporte_tickets", "responsable_id, asunto").eq("id", data.ticket_id).limit(1);
    const fila = (tk?.[0] ?? null) as unknown as { responsable_id: string | null; asunto: string } | null;
    if (fila?.responsable_id && fila.responsable_id !== ctx.usuarioId) {
      await notificar(ctx.db, ctx.empresaId, {
        usuarioId: fila.responsable_id,
        tipo: "soporte_revision",
        bandeja: "soporte",
        titulo: `Nuevo ticket ${numeroTicket(data.numero)} · ${cliente.nombre}`,
        cuerpo: `${tipoCodigo === "error" ? "Error" : "Cambio"}${clas ? ` ${clas.nombre}` : ""} · ${fila.asunto}`,
        url: `/soporte/tickets/${data.ticket_id}`,
      });
    }
    return created({ tipificacion_id: data.tipificacion_id, ticket: { id: data.ticket_id, numero: data.numero }, cita_id: null });
  }

  // ── Capacitación: la cita va ANTES (valida horario y choque) ───────────────
  let citaId: string | null = null;
  if (comportamiento === "capacitacion" && body.agenda) {
    const cfg = await leerConfig(ctx.db);
    const leida = leerAgendaCapacitacion(body.agenda, eq.equipo, cfg.horario);
    if (!leida.ok) return fail(leida.mensaje);
    const cita = await agendarCapacitacion(ctx.db, {
      clienteId,
      clienteNombre: cliente.nombre,
      agenda: leida.agenda,
      observaciones: observacion,
      creadoPor: ctx.usuarioId,
    });
    if (!cita.ok) return fail(cita.mensaje, cita.status, cita.status === 409 ? "conflicto_horario" : undefined);
    citaId = cita.id;
  }

  const { data, error } = await ctx.db.insert("tipificaciones", {
    cliente_id: clienteId,
    usuario: usuarioNombre,
    usuario_id: ctx.usuarioId,
    tipo_gestion: tipoGestion,
    resultado,
    observacion,
    familia_id: estadoId,
    estado_id: subestadoId,
  });
  const tip = (data?.[0] ?? null) as { id?: string } | null;
  if (error || !tip?.id) {
    if (citaId) await ctx.db.delete("agenda_citas").eq("id", citaId);
    console.error("[tipificaciones] alta", error?.message);
    return fail("Error al guardar la tipificación.");
  }
  if (citaId) {
    await ctx.db.update("agenda_citas", { metadata: { origen: "tipificacion", tipificacion_id: tip.id } }).eq("id", citaId);
    // Aviso a quien da la capacitación (si no es quien la agendó).
    const cita = (body.agenda as Record<string, unknown>) ?? {};
    const resp = typeof cita.responsable_id === "string" ? cita.responsable_id : null;
    if (resp && resp !== ctx.usuarioId) {
      const ini = typeof cita.inicio === "string" ? cita.inicio : "";
      await notificar(ctx.db, ctx.empresaId, {
        usuarioId: resp,
        tipo: "agenda_capacitacion",
        bandeja: "general",
        titulo: `Capacitación agendada · ${cliente.nombre}`,
        cuerpo: ini ? `${ini.slice(8, 10)}/${ini.slice(5, 7)} a las ${ini.slice(11, 16)} · por ${usuarioNombre}` : `Por ${usuarioNombre}`,
        url: `/clientes/agenda?cita=${citaId}`,
      });
    }
  }
  // Rastro en la Actividad del cliente (el ticket ya lo deja la RPC).
  await ctx.db.rpc("registrar_historial_cliente", {
    p_cliente: clienteId,
    p_accion: "tipificacion",
    p_detalle: { tipo_gestion: tipoGestion, resultado, ticket: null, capacitacion: !!citaId, observacion: observacion.slice(0, 200) },
  });
  return created({ tipificacion_id: tip.id, ticket: null, cita_id: citaId });
});
