/**
 * Registrar una tipificación de un cliente desde OTRO módulo (hoy: Conversaciones al
 * finalizar un chat). Mismo comportamiento que POST /api/clientes/[id]/tipificaciones:
 *   · sub-estado ticket_error / ticket_cambio → tipificación + ticket en UNA transacción
 *     (RPC soporte_crear_ticket_desde_tipificacion) y aviso al responsable.
 *   · el resto (incluida capacitación, sin agendar) → solo la tipificación + rastro en la
 *     Actividad del cliente.
 * Solo servidor (detrás de withTenant).
 */
import type { TenantContext } from "@/lib/api/with-tenant";
import { leerEquipo, notificar, puedeCargarSoporte } from "@/modules/tipificacion/server";
import { asuntoDesdeDescripcion, numeroTicket } from "@/modules/tipificacion/dominio";

export type EntradaTipificacion = {
  clienteId: string;
  estadoId: string;
  subestadoId: string;
  observacion: string;
  ticket?: { clasificacion_codigo?: string | null } | null;
};

export type ResultadoTipificacion =
  | { ok: true; tipificacion_id: string; ticket: { id: string; numero: number } | null }
  | { ok: false; status: number; mensaje: string };

export async function registrarTipificacion(ctx: TenantContext, e: EntradaTipificacion): Promise<ResultadoTipificacion> {
  const observacion = e.observacion.trim().slice(0, 5000);
  if (!observacion) return { ok: false, status: 400, mensaje: "La observación es obligatoria." };

  const [cli, estRes, subRes, eq] = await Promise.all([
    ctx.db.select("clientes", "id, nombre").eq("id", e.clienteId).is("deleted_at", null).limit(1),
    ctx.db.select("tipificacion_familias", "id, nombre").eq("id", e.estadoId).limit(1),
    ctx.db.select("tipificacion_estados", "id, nombre, comportamiento, familia_id").eq("id", e.subestadoId).limit(1),
    leerEquipo(ctx.db, ctx.usuarioId),
  ]);
  if (cli.error || estRes.error || subRes.error) return { ok: false, status: 500, mensaje: "Error interno" };
  const cliente = (cli.data?.[0] ?? null) as unknown as { id: string; nombre: string } | null;
  if (!cliente) return { ok: false, status: 404, mensaje: "Cliente no encontrado" };
  const estado = (estRes.data?.[0] ?? null) as unknown as { id: string; nombre: string } | null;
  const sub = (subRes.data?.[0] ?? null) as unknown as { id: string; nombre: string; comportamiento: string | null; familia_id: string } | null;
  if (!estado) return { ok: false, status: 400, mensaje: "El estado no existe." };
  if (!sub || sub.familia_id !== e.estadoId) return { ok: false, status: 400, mensaje: "El sub-estado no corresponde al estado elegido." };

  const tipoGestion = estado.nombre;
  const resultado = sub.nombre;
  const comportamiento = (sub.comportamiento ?? "").trim();
  const usuarioNombre = eq.yo?.nombre ?? ctx.user.email ?? "Usuario";

  if (comportamiento === "ticket_error" || comportamiento === "ticket_cambio") {
    if (!puedeCargarSoporte(ctx.rol, eq.yo)) return { ok: false, status: 403, mensaje: "Tu usuario no puede cargar tickets de Soporte." };
    const tipoCodigo = comportamiento === "ticket_error" ? "error" : "cambio";
    const { data: clasData } = await ctx.db
      .select("soporte_clasificaciones", "codigo, nombre, sla_horas, prioridad_sugerida")
      .eq("tipo_codigo", tipoCodigo)
      .eq("activo", true);
    const clasificaciones = (clasData ?? []) as unknown as { codigo: string; nombre: string; sla_horas: number | null; prioridad_sugerida: string | null }[];
    const codigo = e.ticket?.clasificacion_codigo ?? "";
    const clas = clasificaciones.find((c) => c.codigo === codigo) ?? null;
    if (clasificaciones.length && !clas) return { ok: false, status: 400, mensaje: "Elegí la clasificación del ticket." };

    const { data, error } = await ctx.db.rpc<{ tipificacion_id: string; ticket_id: string; numero: number }>(
      "soporte_crear_ticket_desde_tipificacion",
      {
        p_tipificacion: { cliente_id: e.clienteId, tipo_gestion: tipoGestion, resultado, observacion, familia_id: e.estadoId, estado_id: e.subestadoId },
        p_ticket: {
          asunto: asuntoDesdeDescripcion(observacion) || `${tipoCodigo === "error" ? "Error" : "Cambio"} · ${cliente.nombre}`.slice(0, 90),
          descripcion: observacion,
          tipo_codigo: tipoCodigo,
          clasificacion_codigo: clas?.codigo ?? "",
          prioridad_codigo: clas?.prioridad_sugerida || "normal",
          sla_horas: clas?.sla_horas ?? "",
        },
      },
    );
    if (error || !data) {
      console.error("[tipificacion/registrar] ticket", error?.message);
      return { ok: false, status: 400, mensaje: error?.message ?? "No se pudo crear el ticket." };
    }
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
    return { ok: true, tipificacion_id: data.tipificacion_id, ticket: { id: data.ticket_id, numero: Number(data.numero) } };
  }

  const { data, error } = await ctx.db.insert("tipificaciones", {
    cliente_id: e.clienteId,
    usuario: usuarioNombre,
    usuario_id: ctx.usuarioId,
    tipo_gestion: tipoGestion,
    resultado,
    observacion,
    familia_id: e.estadoId,
    estado_id: e.subestadoId,
  });
  const tip = (data?.[0] ?? null) as { id?: string } | null;
  if (error || !tip?.id) {
    console.error("[tipificacion/registrar] alta", error?.message);
    return { ok: false, status: 500, mensaje: "Error al guardar la tipificación." };
  }
  await ctx.db.rpc("registrar_historial_cliente", {
    p_cliente: e.clienteId,
    p_accion: "tipificacion",
    p_detalle: { tipo_gestion: tipoGestion, resultado, ticket: null, capacitacion: false, observacion: observacion.slice(0, 200), origen: "conversaciones" },
  });
  return { ok: true, tipificacion_id: tip.id, ticket: null };
}
