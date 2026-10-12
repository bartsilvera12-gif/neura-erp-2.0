/**
 * Un proyecto.
 *   GET    /api/proyectos/[id] → Detalle { proyecto, estado, permisos, sla, tramo_actual, horario }
 *          (liviano: comentarios, archivos, tareas e historial se piden recién al abrir su pestaña)
 *   PATCH  /api/proyectos/[id] { titulo?, descripcion?, cliente_id?, prioridad?, responsable_comercial_id?,
 *                                responsable_tecnico_id?, project_manager_id?, fecha_ingreso?, fecha_prometida?,
 *                                monto_vendido?, moneda?, bloqueado?, bloqueo_tipo?, bloqueo_motivo?,
 *                                bloqueo_responsable?, bloqueo_proxima_accion?, cancelacion_motivo?,
 *                                pausa_motivo?, archivado? } → Detalle
 *          Cada cambio queda en la bitácora; al técnico / PM nuevos les llega un aviso.
 *          El estado se cambia con POST /api/proyectos/[id]/estado.
 *   DELETE /api/proyectos/[id] → lo borra con todo lo suyo (solo ADMIN)
 */
import { z } from "zod";
import { withTenant, type TenantContext } from "@/lib/api/with-tenant";
import { ok, noContent, fail, ERR } from "@/lib/api/responses";
import { leerHorario } from "@/modules/agenda/server";
import { borrarObjeto } from "@/lib/proyectos/storage";
import {
  avisarUsuarios, clienteValido, enriquecerTarjetas, errorProy, idTras, nombreActor, nombresClientes, nombresUsuarios,
  permisosDe, proyectoBase, registrarEvento, sinPermiso, usuariosValidos, type FilaProyecto,
} from "@/modules/proyectos/server";
import {
  BLOQUEO_TIPOS, BLOQUEO_TIPO_LABEL, PRIORIDADES, PRIORIDAD_LABEL, fechaCorta, fechaHoraPY, monto,
  type BloqueoTipo, type Detalle, type Estado, type Prioridad, type Proyecto,
} from "@/modules/proyectos/tipos";

export const dynamic = "force-dynamic";

async function armarDetalle(ctx: TenantContext, p: FilaProyecto): Promise<Detalle> {
  const [est, [t], creado, hist, horario] = await Promise.all([
    ctx.db.select("proyecto_estados", "id, codigo, nombre, color, orden, tipo_sla, sla_horas_objetivo, rol, es_inicial, es_final, activo").eq("id", p.estado_id).maybeSingle(),
    enriquecerTarjetas(ctx, [p as unknown as Record<string, unknown>]),
    p.created_by ? nombresUsuarios(ctx, [p.created_by]) : Promise.resolve(new Map<string, string>()),
    ctx.db.select("proyecto_estado_historial", "tipo_sla_snapshot, horas_laborales, entered_at, exited_at").eq("proyecto_id", p.id),
    leerHorario(ctx.db),
  ]);
  const sla = { interno: 0, cliente: 0, pausado: 0 };
  let tramo: Detalle["tramo_actual"] = null;
  for (const h of (hist.data ?? []) as unknown as { tipo_sla_snapshot: string | null; horas_laborales: number | string | null; entered_at: string; exited_at: string | null }[]) {
    if (!h.exited_at) {
      if (!tramo || h.entered_at > tramo.entered_at) tramo = { entered_at: h.entered_at, tipo_sla: h.tipo_sla_snapshot };
      continue;
    }
    const k = h.tipo_sla_snapshot as keyof typeof sla;
    if (k in sla) sla[k] += Number(h.horas_laborales) || 0;
  }
  const e = est.data as unknown as Estado | null;
  const proyecto: Proyecto = {
    ...(p as unknown as Proyecto),
    ...t,
    fecha_ingreso: p.fecha_ingreso,
    pausa_horas_acumuladas: Number(p.pausa_horas_acumuladas) || 0,
    creado_por_nombre: p.created_by ? (creado.get(p.created_by) ?? null) : null,
  };
  return {
    proyecto,
    estado: e ? { ...e, sla_horas_objetivo: e.sla_horas_objetivo == null ? null : Number(e.sla_horas_objetivo) } : null,
    permisos: permisosDe(ctx, p),
    sla: { interno: Math.round(sla.interno * 100) / 100, cliente: Math.round(sla.cliente * 100) / 100, pausado: Math.round(sla.pausado * 100) / 100 },
    tramo_actual: tramo,
    horario,
  };
}

export const GET = withTenant(async (ctx, req) => {
  const id = idTras(req, "proyectos");
  if (!id) return ERR.notFound("Proyecto");
  const p = await proyectoBase(ctx, id);
  if (!p) return ERR.notFound("Proyecto");
  return ok(await armarDetalle(ctx, p));
});

const texto = (max: number) => z.string().trim().max(max).optional().nullable();
const uuidOpc = z.string().uuid().optional().nullable().or(z.literal(""));

const editar = z.object({
  titulo: z.string().trim().min(1, "El título es obligatorio").max(200).optional(),
  descripcion: texto(8000),
  cliente_id: uuidOpc,
  prioridad: z.enum(PRIORIDADES).optional(),
  responsable_comercial_id: uuidOpc,
  responsable_tecnico_id: uuidOpc,
  project_manager_id: uuidOpc,
  fecha_ingreso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de ingreso inválida").optional(),
  fecha_prometida: z.string().datetime({ offset: true, message: "Fecha prometida inválida" }).optional().nullable().or(z.literal("")),
  monto_vendido: z.coerce.number().min(0).max(1e15).optional(),
  moneda: z.enum(["GS", "USD"]).optional(),
  bloqueado: z.boolean().optional(),
  bloqueo_tipo: z.enum(BLOQUEO_TIPOS).optional().nullable().or(z.literal("")),
  bloqueo_motivo: texto(1000),
  bloqueo_responsable: texto(200),
  bloqueo_proxima_accion: texto(500),
  cancelacion_motivo: texto(1000),
  pausa_motivo: texto(1000),
  archivado: z.boolean().optional(),
});

type Cambio = { campo: string; de: string; a: string };

export const PATCH = withTenant(
  async (ctx, req, input) => {
    const id = idTras(req, "proyectos");
    if (!id) return ERR.notFound("Proyecto");
    const p = await proyectoBase(ctx, id);
    if (!p) return ERR.notFound("Proyecto");
    if (!permisosDe(ctx, p).editar) return sinPermiso();

    const nul = (v: string | null | undefined) => (v ? v : null);
    const patch: Record<string, unknown> = {};
    const cambios: Cambio[] = [];
    const asignaciones: { rol: string; campo: "responsable_comercial_id" | "responsable_tecnico_id" | "project_manager_id"; de: string | null; a: string | null }[] = [];

    const simple = <K extends keyof FilaProyecto>(campo: K, valor: FilaProyecto[K] | undefined, etiqueta: string, fmt: (v: FilaProyecto[K]) => string = (v) => String(v ?? "—")) => {
      if (valor === undefined || valor === p[campo]) return;
      patch[campo] = valor;
      cambios.push({ campo: etiqueta, de: fmt(p[campo]), a: fmt(valor) });
    };

    if (input.titulo !== undefined) simple("titulo", input.titulo, "Título");
    if (input.descripcion !== undefined && nul(input.descripcion) !== p.descripcion) {
      patch.descripcion = nul(input.descripcion);
      cambios.push({ campo: "Descripción", de: p.descripcion ? "…" : "—", a: input.descripcion ? "actualizada" : "—" });
    }
    if (input.prioridad !== undefined) simple("prioridad", input.prioridad, "Prioridad", (v) => PRIORIDAD_LABEL[v as Prioridad] ?? String(v));
    if (input.fecha_ingreso !== undefined) simple("fecha_ingreso", input.fecha_ingreso, "Fecha de ingreso", (v) => fechaCorta(v as string));
    if (input.fecha_prometida !== undefined) {
      const nueva = nul(input.fecha_prometida);
      if ((nueva ? Date.parse(nueva) : null) !== (p.fecha_prometida ? Date.parse(p.fecha_prometida) : null)) {
        patch.fecha_prometida = nueva;
        cambios.push({ campo: "Fecha prometida", de: p.fecha_prometida ? fechaHoraPY(p.fecha_prometida) : "Sin fecha", a: nueva ? fechaHoraPY(nueva) : "Sin fecha" });
      }
    }
    const moneda = input.moneda ?? (p.moneda as "GS" | "USD");
    if (input.moneda !== undefined) simple("moneda", input.moneda, "Moneda");
    if (input.monto_vendido !== undefined) {
      const v = moneda === "USD" ? Math.round(input.monto_vendido * 100) / 100 : Math.round(input.monto_vendido);
      if (v !== Number(p.monto_vendido)) {
        patch.monto_vendido = v;
        cambios.push({ campo: "Monto vendido", de: monto(p.monto_vendido, p.moneda), a: monto(v, moneda) });
      }
    }
    if (input.cancelacion_motivo !== undefined) simple("cancelacion_motivo", nul(input.cancelacion_motivo), "Motivo de cancelación");
    if (input.pausa_motivo !== undefined) simple("pausa_motivo", nul(input.pausa_motivo), "Motivo de la pausa");

    if (input.cliente_id !== undefined) {
      const c = input.cliente_id || null;
      if (c !== p.cliente_id) {
        if (c && !(await clienteValido(ctx, c))) return fail("Cliente inválido", 422);
        const nombres = await nombresClientes(ctx, [p.cliente_id, c]);
        patch.cliente_id = c;
        cambios.push({ campo: "Cliente", de: p.cliente_id ? (nombres.get(p.cliente_id) ?? "—") : "Sin cliente", a: c ? (nombres.get(c) ?? "—") : "Sin cliente" });
      }
    }

    for (const [campo, rol] of [["responsable_comercial_id", "Comercial"], ["responsable_tecnico_id", "Técnico"], ["project_manager_id", "Project Manager"]] as const) {
      const v = input[campo];
      if (v === undefined) continue;
      const nuevo = v || null;
      if (nuevo === p[campo]) continue;
      asignaciones.push({ rol, campo, de: p[campo], a: nuevo });
      patch[campo] = nuevo;
    }
    const nuevosResp = asignaciones.map((a) => a.a).filter((x): x is string => !!x && x !== ctx.usuarioId);
    if (!(await usuariosValidos(ctx, nuevosResp))) return fail("Responsable inválido", 422);

    // Bloqueo: activarlo exige motivo; quitarlo limpia sus datos.
    let eventoBloqueo: { tipo: string; detalle: Record<string, unknown> } | null = null;
    const bloq = input.bloqueado ?? p.bloqueado;
    if (bloq) {
      const motivo = input.bloqueo_motivo !== undefined ? nul(input.bloqueo_motivo) : p.bloqueo_motivo;
      if (!motivo) return fail("Indicá el motivo del bloqueo", 422);
      const datos = {
        bloqueado: true,
        bloqueo_tipo: input.bloqueo_tipo !== undefined ? (input.bloqueo_tipo || null) : p.bloqueo_tipo,
        bloqueo_motivo: motivo,
        bloqueo_responsable: input.bloqueo_responsable !== undefined ? nul(input.bloqueo_responsable) : p.bloqueo_responsable,
        bloqueo_proxima_accion: input.bloqueo_proxima_accion !== undefined ? nul(input.bloqueo_proxima_accion) : p.bloqueo_proxima_accion,
      };
      const distinto = (Object.keys(datos) as (keyof typeof datos)[]).some((k) => datos[k] !== p[k]);
      if (distinto) {
        Object.assign(patch, datos);
        eventoBloqueo = {
          tipo: p.bloqueado ? "bloqueo_editado" : "bloqueo",
          detalle: {
            tipo: datos.bloqueo_tipo ? BLOQUEO_TIPO_LABEL[datos.bloqueo_tipo as BloqueoTipo] : null,
            motivo: datos.bloqueo_motivo,
            responsable: datos.bloqueo_responsable,
            proxima_accion: datos.bloqueo_proxima_accion,
          },
        };
      }
    } else if (p.bloqueado) {
      Object.assign(patch, { bloqueado: false, bloqueo_tipo: null, bloqueo_motivo: null, bloqueo_responsable: null, bloqueo_proxima_accion: null });
      eventoBloqueo = { tipo: "desbloqueo", detalle: { motivo_anterior: p.bloqueo_motivo } };
    }

    let eventoArchivo: string | null = null;
    if (input.archivado !== undefined && input.archivado !== p.archivado) {
      patch.archivado = input.archivado;
      eventoArchivo = input.archivado ? "archivado" : "desarchivado";
    }

    if (!Object.keys(patch).length) return ok(await armarDetalle(ctx, p));
    const ahora = new Date().toISOString();
    patch.updated_at = ahora;
    patch.ultimo_movimiento_at = ahora;

    const { data, error } = await ctx.db.update("proyectos", patch).eq("id", id).select("id");
    if (error) return errorProy(error, "No se pudo guardar el proyecto");
    if (!data?.length) return ERR.notFound("Proyecto");

    const actor = await nombreActor(ctx);
    const nombres = asignaciones.length ? await nombresUsuarios(ctx, asignaciones.flatMap((a) => [a.de, a.a])) : new Map<string, string>();
    const eventos: Promise<void>[] = [];
    if (cambios.length) eventos.push(registrarEvento(ctx, id, "editado", { cambios }, actor));
    for (const a of asignaciones) {
      eventos.push(registrarEvento(ctx, id, "asignacion", { rol: a.rol, de: a.de ? (nombres.get(a.de) ?? "—") : "Sin asignar", a: a.a ? (nombres.get(a.a) ?? "—") : "Sin asignar" }, actor));
    }
    if (eventoBloqueo) eventos.push(registrarEvento(ctx, id, eventoBloqueo.tipo, eventoBloqueo.detalle, actor));
    if (eventoArchivo) eventos.push(registrarEvento(ctx, id, eventoArchivo, {}, actor));
    const titulo = String(patch.titulo ?? p.titulo);
    for (const a of asignaciones) {
      if (a.a && a.campo !== "responsable_comercial_id") {
        eventos.push(avisarUsuarios(ctx, [a.a], { proyectoId: id, titulo: `Te asignaron como ${a.rol === "Técnico" ? "técnico" : a.rol} en ${p.numero}`, cuerpo: `${titulo} · por ${actor}` }));
      }
    }
    await Promise.all(eventos);

    const nuevo = await proyectoBase(ctx, id);
    if (!nuevo) return ERR.notFound("Proyecto");
    return ok(await armarDetalle(ctx, nuevo));
  },
  { body: editar },
);

export const DELETE = withTenant(
  async (ctx, req) => {
    const id = idTras(req, "proyectos");
    if (!id) return ERR.notFound("Proyecto");
    const { data: archivos } = await ctx.db.select("proyecto_archivos", "storage_path").eq("proyecto_id", id);
    const { data, error } = await ctx.db.delete("proyectos").eq("id", id).select("id");
    if (error) return errorProy(error, "No se pudo eliminar el proyecto");
    if (!data?.length) return ERR.notFound("Proyecto");
    await Promise.all(((archivos ?? []) as unknown as { storage_path: string }[]).map((a) => borrarObjeto(a.storage_path)));
    return noContent();
  },
  { roles: ["ADMIN"] },
);
