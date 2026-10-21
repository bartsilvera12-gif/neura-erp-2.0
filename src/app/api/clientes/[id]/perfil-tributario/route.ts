/**
 * Perfil tributario del cliente (opcional; solo con "Activar gestión tributaria de clientes"
 * encendido en Configuración › Facturación). Receta 61.
 *   GET /api/clientes/[id]/perfil-tributario → { gestion_tributaria_clientes, puede_editar, catalogo, perfil }
 *   PUT /api/clientes/[id]/perfil-tributario { perfil_activo, dv?, razon_social_fiscal?,
 *       dia_vencimiento_tributario?, honorario_mensual?, honorario_anual?, notas_tributarias?,
 *       obligaciones[], obligacion_otro_detalle?, clave_tributaria? (null = borrar) }
 * La clave tributaria se cifra ACÁ (AES-256-GCM, SIFEN_SECRETS_KEY) y nunca se devuelve: solo
 * "configurada". La base (guardar_perfil_tributario) valida empresa, rol y que la opción esté activa.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ERR, fail, ok } from "@/lib/api/responses";
import { falloRpc } from "@/modules/usuarios/server";
import { idDeRuta } from "@/modules/clientes/suscripciones/server";
import { cifrar, FaltaClaveSecretos } from "@/lib/sifen/secretos";
import type { PerfilTributarioLectura } from "@/modules/facturacion/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const txt = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const monto = z.union([z.number(), z.string()]).nullish()
  .transform((v) => (v === null || v === undefined || v === "" ? null : Number(v)))
  .refine((v) => v === null || (Number.isFinite(v) && v >= 0), "Los honorarios no pueden ser negativos");

const cuerpo = z.object({
  perfil_activo: z.boolean(),
  dv: txt(2),
  razon_social_fiscal: txt(160),
  dia_vencimiento_tributario: z.union([z.number(), z.string()]).nullish()
    .transform((v) => (v === null || v === undefined || v === "" ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 31), "Indicá un día del 1 al 31, o dejalo vacío"),
  honorario_mensual: monto,
  honorario_anual: monto,
  notas_tributarias: txt(2000),
  obligaciones: z.array(z.string().max(40)).max(20).default([]),
  obligacion_otro_detalle: txt(300),
  clave_tributaria: z.string().max(200).nullish(),
});

export const GET = withTenant(async (ctx, req) => {
  const id = idDeRuta(req, "clientes");
  if (!id) return ERR.invalid("Falta el id del cliente");
  const { data, error } = await ctx.db.rpc<PerfilTributarioLectura>("perfil_tributario_cliente", { p_cliente: id });
  if (error) return falloRpc(error);
  return ok(data);
});

export const PUT = withTenant(
  async (ctx, req, input) => {
    const id = idDeRuta(req, "clientes");
    if (!id) return ERR.invalid("Falta el id del cliente");
    const { clave_tributaria, ...resto } = input;
    try {
      const p: Record<string, unknown> = { ...resto };
      if (clave_tributaria === null) p.limpiar_clave = true;
      else if (clave_tributaria && clave_tributaria.trim()) p.clave_cifrada = cifrar(clave_tributaria.trim());
      const { data, error } = await ctx.db.rpc<PerfilTributarioLectura>("guardar_perfil_tributario", { p_cliente: id, p });
      if (error) return falloRpc(error);
      return ok(data);
    } catch (e) {
      if (e instanceof FaltaClaveSecretos) return fail(e.message, 500, "sin_clave");
      throw e;
    }
  },
  { roles: ["ADMIN", "VENDEDOR"], body: cuerpo },
);
