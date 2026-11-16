/** Comedor — editar / dar de baja un funcionario. PATCH /api/comedor/funcionarios/[id] */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail, ERR } from "@/lib/api/responses";
import { documentoRepetido } from "@/modules/clientes/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const editarFuncionario = z.object({
  nombre: z.string().trim().min(1).max(200).optional(),
  documento: z.string().trim().min(1).max(30).optional(),
  comedor_empresa_id: z.string().uuid().nullable().optional(),
  activo: z.boolean().optional(),
});

export const PATCH = withTenant(
  async (ctx, req, input) => {
    const id = req.url.split("/").pop()?.split("?")[0] ?? "";
    if (!UUID_RE.test(id)) return fail("Id inválido.", 400);
    if (input.documento) {
      const dup = await documentoRepetido(ctx.db, input.documento, id);
      if (dup) return fail(`Ya existe un cliente con la cédula ${input.documento} (${dup}).`, 409);
    }
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.nombre !== undefined) patch.nombre = input.nombre;
    if (input.documento !== undefined) patch.documento = input.documento;
    if (input.comedor_empresa_id !== undefined) patch.comedor_empresa_id = input.comedor_empresa_id;
    if (input.activo !== undefined) patch.activo = input.activo;

    const { data, error } = await ctx.db.update("clientes", patch).eq("id", id).eq("es_funcionario", true).select("id, nombre, documento, activo, comedor_empresa_id");
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) return fail("Ya existe un cliente con esa cédula.", 409);
      return ERR.server();
    }
    if (!data?.length) return fail("Funcionario no encontrado.", 404);
    return ok(data[0]);
  },
  { permiso: "comedor_administrar", body: editarFuncionario },
);
