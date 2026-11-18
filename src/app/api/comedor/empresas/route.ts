/**
 * Comedor — empresa(s) contratante(s).
 *   GET  /api/comedor/empresas → lista (comedor_empresas_listar)
 *   POST /api/comedor/empresas → alta/edición (comedor_empresa_guardar)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";

export const GET = withTenant(
  async (ctx) => {
    const r = await ctx.db.rpc("comedor_empresas_listar", {});
    if (r.error) return ERR.server();
    return ok(r.data ?? []);
  },
  { permiso: "comedor_administrar" },
);

const guardarEmpresa = z.object({
  id: z.string().uuid().optional(),
  nombre: z.string().trim().min(1, "El nombre es obligatorio").max(160),
  ruc: z.string().trim().max(30).optional().nullable(),
  subsidio_mensual: z.coerce.number().min(0).default(350000),
  cierre_dia: z.coerce.number().int().min(0).max(6).optional().nullable(),
  cierre_hora: z.string().regex(/^\d{2}:\d{2}$/, "Hora inválida").optional().nullable(),
  activa: z.boolean().default(true),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const r = await ctx.db.rpc<{ id: string }>("comedor_empresa_guardar", {
      p: {
        id: input.id ?? null,
        nombre: input.nombre,
        ruc: input.ruc ?? null,
        subsidio_mensual: input.subsidio_mensual,
        cierre_dia: input.cierre_dia ?? null,
        cierre_hora: input.cierre_hora ?? null,
        activa: input.activa,
      },
    });
    if (r.error) return ERR.server();
    return ok(r.data);
  },
  { permiso: "comedor_administrar", body: guardarEmpresa },
);
