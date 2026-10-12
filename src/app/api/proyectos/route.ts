/**
 * Proyectos.
 *   GET  /api/proyectos?q=&responsable=&cliente=&prioridad=&archivados=1|todos&estado=&desde=&hasta=&cursor_at=&cursor_id=&limite=30&conteo=1&horario=1
 *        → { items: Tarjeta[], total, horario? } (vista Lista y pestaña "Proyectos" de la ficha del cliente;
 *          por último movimiento desc, paginado con cursor)
 *   POST /api/proyectos { titulo, descripcion?, cliente_id?, prioridad?, responsable_comercial_id?,
 *                         responsable_tecnico_id?, project_manager_id?, fecha_ingreso?, fecha_prometida?,
 *                         monto_vendido?, moneda? } → la tarjeta creada
 *        El número PRY-00001, el primer tramo del historial y el evento "creado" los pone la base.
 *        Avisa al técnico y al PM asignados.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { created, ok, fail } from "@/lib/api/responses";
import {
  COLS_TARJETA, avisarUsuarios, clienteValido, enriquecerTarjetas, errorProy, listarProyectos, usuariosValidos,
} from "@/modules/proyectos/server";
import { PRIORIDADES } from "@/modules/proyectos/tipos";
import { leerHorario } from "@/modules/agenda/server";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  const [r, horario] = await Promise.all([listarProyectos(ctx, sp), sp.get("horario") === "1" ? leerHorario(ctx.db) : Promise.resolve(null)]);
  if ("error" in r) return errorProy(r.error, "No se pudieron cargar los proyectos");
  return ok({ items: r.data, total: r.total, ...(horario ? { horario } : {}) });
});

const texto = (max: number) => z.string().trim().max(max).optional().nullable();
const uuidOpc = z.string().uuid().optional().nullable().or(z.literal(""));

const crear = z.object({
  titulo: z.string().trim().min(1, "El título es obligatorio").max(200),
  descripcion: texto(8000),
  cliente_id: uuidOpc,
  prioridad: z.enum(PRIORIDADES).default("normal"),
  responsable_comercial_id: uuidOpc,
  responsable_tecnico_id: uuidOpc,
  project_manager_id: uuidOpc,
  fecha_ingreso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de ingreso inválida").optional().nullable().or(z.literal("")),
  fecha_prometida: z.string().datetime({ offset: true, message: "Fecha prometida inválida" }).optional().nullable().or(z.literal("")),
  monto_vendido: z.coerce.number().min(0).max(1e15).default(0),
  moneda: z.enum(["GS", "USD"]).default("GS"),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data: est } = await ctx.db
      .select("proyecto_estados", "id")
      .eq("activo", true)
      .eq("es_final", false)
      .order("es_inicial", { ascending: false })
      .order("orden", { ascending: true })
      .limit(1);
    const estadoId = (est?.[0] as unknown as { id?: string } | undefined)?.id;
    if (!estadoId) return fail("No hay un estado inicial activo. Revisá la configuración de estados.", 422);

    const comercial = input.responsable_comercial_id || ctx.usuarioId;
    const tecnico = input.responsable_tecnico_id || null;
    const pm = input.project_manager_id || null;
    if (!(await usuariosValidos(ctx, [comercial, tecnico, pm].filter((x): x is string => !!x && x !== ctx.usuarioId)))) {
      return fail("Responsable inválido", 422);
    }
    if (input.cliente_id && !(await clienteValido(ctx, input.cliente_id))) return fail("Cliente inválido", 422);

    const { data, error } = await ctx.db.insert("proyectos", {
      titulo: input.titulo,
      descripcion: input.descripcion || null,
      cliente_id: input.cliente_id || null,
      estado_id: estadoId,
      prioridad: input.prioridad,
      responsable_comercial_id: comercial,
      responsable_tecnico_id: tecnico,
      project_manager_id: pm,
      ...(input.fecha_ingreso ? { fecha_ingreso: input.fecha_ingreso } : {}),
      fecha_prometida: input.fecha_prometida || null,
      monto_vendido: input.moneda === "USD" ? Math.round((input.monto_vendido ?? 0) * 100) / 100 : Math.round(input.monto_vendido ?? 0),
      moneda: input.moneda,
      created_by: ctx.usuarioId,
    });
    if (error) return errorProy(error, "No se pudo crear el proyecto");
    const fila = (data?.[0] ?? null) as Record<string, unknown> | null;
    if (!fila) return errorProy(null, "No se pudo crear el proyecto");
    const soloTarjeta = Object.fromEntries(COLS_TARJETA.split(",").map((c) => c.trim()).map((c) => [c, fila[c]]));
    const [t] = await enriquecerTarjetas(ctx, [soloTarjeta]);

    const numero = String(fila.numero ?? "");
    await Promise.all([
      avisarUsuarios(ctx, [tecnico], { proyectoId: t.id, titulo: `Te asignaron como técnico en ${numero}`, cuerpo: input.titulo }),
      avisarUsuarios(ctx, [pm !== tecnico ? pm : null], { proyectoId: t.id, titulo: `Te asignaron como Project Manager en ${numero}`, cuerpo: input.titulo }),
    ]);
    return created(t);
  },
  { body: crear },
);
