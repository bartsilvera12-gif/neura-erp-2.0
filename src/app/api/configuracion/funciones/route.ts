/**
 * Configuración › Rubro y funciones (receta 75).
 *   GET /api/configuracion/funciones → funciones_empresa(): rubro, mesas, cocina, recetas, ocultas,
 *       puede_editar y (Administrador) cuentas_abiertas / pedidos_sin_cerrar / productos_recetas.
 *   PUT /api/configuracion/funciones { rubro?, mesas?, cocina?, recetas?, pedidos?, confirmar_recetas? }
 *       → funciones_empresa(). Solo ADMIN con "Configuración del sistema"; la base vuelve a validar
 *       (y rechaza si Neura ocultó la sección). Apagar Recetas con productos Menú/Materia prima
 *       activos sin confirmar → 409 { code: "confirmar_recetas", cantidad }.
 */
import { z } from "zod";
import { NextResponse } from "next/server";
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloRpc, soloAdmin } from "@/modules/usuarios/server";
import { invalidarFunciones } from "@/lib/api/funciones-servidor";
import type { FuncionesEmpresa } from "@/modules/configuracion/funciones";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const esquema = z
  .object({
    rubro: z.enum(["comercio", "gastronomia"], { message: "Rubro inválido" }),
    mesas: z.boolean(),
    cocina: z.boolean(),
    recetas: z.boolean(),
    pedidos: z.boolean(),
    confirmar_recetas: z.boolean(),
  })
  .strict()
  .partial()
  .refine((o) => Object.keys(o).length > 0, "No se envió ningún cambio");

export const GET = withTenant(async (ctx) => {
  const { data, error } = await ctx.db.rpc<FuncionesEmpresa>("funciones_empresa");
  if (error) return falloRpc(error);
  return ok(data, { headers: { "Cache-Control": "no-store" } });
});

export const PUT = withTenant(
  async (ctx, _req, input) => {
    const corte = soloAdmin(ctx);
    if (corte) return corte;
    const { data, error } = await ctx.db.rpc<FuncionesEmpresa>("guardar_funciones_empresa", { p: input });
    if (error) {
      const hint = (error as { hint?: string }).hint ?? "";
      const m = /^confirmar_recetas:(\d+)$/.exec(hint);
      if (m) {
        return NextResponse.json(
          { ok: false, error: { message: error.message.replace(/^.*?ERROR:\s*/, ""), code: "confirmar_recetas", cantidad: Number(m[1]) } },
          { status: 409 },
        );
      }
      return falloRpc(error);
    }
    invalidarFunciones(ctx.empresaId);
    return ok(data);
  },
  { permiso: "configuracion", body: esquema },
);
