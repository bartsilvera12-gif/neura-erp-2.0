/**
 * Prospectos del CRM.
 *   GET  /api/crm?q=&responsable=&mios=1&hoy=1&etapa=&cursor_at=&cursor_id=&limite=25
 *        → Tarjeta[] (vista Lista, por actualización desc, paginado con cursor)
 *   POST /api/crm { contacto, empresa?, telefono?, email?, servicio?, valor_estimado?, etapa?,
 *                   proxima_accion?, fecha_proxima_accion?, origen_creacion?, origen_detalle?,
 *                   responsable_usuario_id?, observaciones? } → la tarjeta creada
 *        El número CRM-000001 y el texto de búsqueda los pone la base (trigger).
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { created, ok, fail } from "@/lib/api/responses";
import { COLS_TARJETA, enriquecerTarjetas, errorCrm, etapaActiva, listarProspectos, usuarioValido } from "@/modules/crm/server";
import { ORIGENES } from "@/modules/crm/tipos";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx, req) => {
  const r = await listarProspectos(ctx, new URL(req.url).searchParams);
  if ("error" in r) return errorCrm(r.error, "No se pudieron cargar los prospectos");
  return ok(r.data);
});

const texto = (max: number) => z.string().trim().max(max).optional().nullable();

const crear = z.object({
  contacto: z.string().trim().min(1, "El contacto es obligatorio").max(200),
  empresa: texto(200),
  telefono: texto(40),
  email: z.string().trim().max(200).email("Email inválido").optional().nullable().or(z.literal("")),
  servicio: texto(500),
  valor_estimado: z.coerce.number().min(0).max(1e15).default(0),
  etapa: texto(40),
  proxima_accion: texto(500),
  fecha_proxima_accion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida").optional().nullable().or(z.literal("")),
  origen_creacion: z.enum(ORIGENES).default("manual"),
  origen_detalle: texto(200),
  responsable_usuario_id: z.string().uuid().optional().nullable().or(z.literal("")),
  observaciones: texto(4000),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    let etapa = input.etapa || null;
    if (etapa) {
      if (!(await etapaActiva(ctx, etapa))) return fail("Etapa inválida", 422);
    } else {
      const { data } = await ctx.db.select("crm_etapas", "codigo").eq("activo", true).eq("es_ganado", false).eq("es_perdido", false).order("orden").limit(1);
      etapa = (data?.[0] as unknown as { codigo?: string } | undefined)?.codigo ?? "LEAD";
    }
    const responsable = input.responsable_usuario_id || ctx.usuarioId;
    if (responsable !== ctx.usuarioId && !(await usuarioValido(ctx, responsable))) return fail("Responsable inválido", 422);

    const { data, error } = await ctx.db.insert("crm_prospectos", {
      contacto: input.contacto,
      empresa: input.empresa || null,
      telefono: input.telefono || null,
      email: input.email ? input.email.toLowerCase() : null,
      servicio: input.servicio || null,
      valor_estimado: Math.round(input.valor_estimado ?? 0),
      etapa,
      proxima_accion: input.proxima_accion || null,
      fecha_proxima_accion: input.fecha_proxima_accion || null,
      origen_creacion: input.origen_creacion,
      origen_detalle: input.origen_detalle || null,
      responsable_usuario_id: responsable,
      observaciones: input.observaciones || null,
      created_by: ctx.usuarioId,
    });
    if (error) return errorCrm(error, "No se pudo crear el prospecto");
    const fila = (data?.[0] ?? null) as Record<string, unknown> | null;
    if (!fila) return errorCrm(null, "No se pudo crear el prospecto");
    const soloTarjeta = Object.fromEntries(COLS_TARJETA.split(",").map((c) => c.trim()).map((c) => [c, fila[c]]));
    const [t] = await enriquecerTarjetas(ctx, [soloTarjeta]);
    return created(t);
  },
  { body: crear },
);
