/**
 * Comedor — funcionarios (padrón).
 *   GET  /api/comedor/funcionarios?q&empresa&estado&limit&offset → { total, rows, periodo }
 *        (comedor_funcionarios_listar: cada uno con empresa, subsidio y saldo del mes)
 *   POST /api/comedor/funcionarios → alta de un funcionario (cliente es_funcionario)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, fail, ERR } from "@/lib/api/responses";
import { documentoRepetido } from "@/modules/clientes/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withTenant(
  async (ctx, req) => {
    const sp = new URL(req.url).searchParams;
    const empresa = sp.get("empresa");
    const estado = sp.get("estado");
    const limit = Math.min(200, Math.max(1, Number(sp.get("limit")) || 50));
    const offset = Math.max(0, Number(sp.get("offset")) || 0);
    const r = await ctx.db.rpc("comedor_funcionarios_listar", {
      p_busqueda: sp.get("q")?.trim().slice(0, 120) || null,
      p_empresa: empresa && UUID_RE.test(empresa) ? empresa : null,
      p_estado: estado === "activos" || estado === "inactivos" ? estado : null,
      p_limit: limit,
      p_offset: offset,
    });
    if (r.error) return ERR.server();
    return ok(r.data);
  },
  { permiso: "comedor_administrar" },
);

const crearFuncionario = z.object({
  nombre: z.string().trim().min(1, "El nombre es obligatorio").max(200),
  documento: z.string().trim().min(1, "La cédula es obligatoria").max(30),
  comedor_empresa_id: z.string().uuid("Elegí la empresa contratante"),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const doc = input.documento.replace(/\D/g, "");
    if (doc) {
      const dup = await documentoRepetido(ctx.db, input.documento);
      if (dup) return fail(`Ya existe un cliente con la cédula ${input.documento} (${dup}).`, 409);
    }
    const { data, error } = await ctx.db.insert("clientes", {
      nombre: input.nombre,
      documento: input.documento,
      tipo_cliente: "persona",
      es_funcionario: true,
      comedor_empresa_id: input.comedor_empresa_id,
      activo: true,
      created_by: ctx.usuarioId,
    });
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) return fail("Ya existe un cliente con esa cédula.", 409);
      return ERR.server();
    }
    return created(data?.[0] ?? null);
  },
  { permiso: "comedor_administrar", body: crearFuncionario },
);
