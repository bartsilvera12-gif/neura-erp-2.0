/**
 * Planes: lo que el comercio cobra todos los meses (cuota, abono, mantenimiento…).
 *   GET  /api/planes            → todos (activos primero, por nombre). ?activos=1 → solo activos
 *                                  Cada plan trae `suscripciones` = cuántas lo usan.
 *   POST /api/planes            → alta (solo administrador)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { created, ok, fail, ERR } from "@/lib/api/responses";
import { errorDb } from "@/modules/clientes/suscripciones/server";

const COLS = "id, nombre, descripcion, precio, moneda, tipo_iva, activo, created_at";

export const GET = withTenant(async (ctx, req) => {
  const soloActivos = new URL(req.url).searchParams.get("activos") === "1";
  let q = ctx.db.select("planes", COLS);
  if (soloActivos) q = q.eq("activo", true);
  const [planes, subs] = await Promise.all([
    q.order("activo", { ascending: false }).order("nombre", { ascending: true }),
    ctx.db.select("suscripciones", "plan_id").neq("estado", "cancelada"),
  ]);
  if (planes.error) return ERR.server();
  const uso = new Map<string, number>();
  for (const s of (subs.data ?? []) as unknown as { plan_id: string | null }[]) {
    if (s.plan_id) uso.set(s.plan_id, (uso.get(s.plan_id) ?? 0) + 1);
  }
  const rows = ((planes.data ?? []) as unknown as { id: string }[]).map((p) => ({ ...p, suscripciones: uso.get(p.id) ?? 0 }));
  return ok(rows);
});

const crearPlan = z.object({
  nombre: z.string().trim().min(1, "El nombre es obligatorio").max(120),
  descripcion: z.string().trim().max(500).optional().nullable(),
  precio: z.coerce.number().min(0, "El precio no puede ser negativo"),
  moneda: z.enum(["GS", "USD"]).default("GS"),
  tipo_iva: z.enum(["10%", "5%", "exenta"]).default("10%"),
  activo: z.boolean().default(true),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.insert("planes", {
      nombre: input.nombre,
      descripcion: input.descripcion?.trim() || null,
      precio: input.moneda === "GS" ? Math.round(input.precio) : Math.round(input.precio * 100) / 100,
      moneda: input.moneda,
      tipo_iva: input.tipo_iva,
      activo: input.activo,
    });
    if (error) {
      if ((error as { code?: string }).code === "23505") return fail(`Ya existe un plan llamado "${input.nombre}"`, 422);
      return errorDb(error, "No se pudo crear el plan");
    }
    return created(data?.[0] ?? null);
  },
  { roles: ["ADMIN"], body: crearPlan },
);
