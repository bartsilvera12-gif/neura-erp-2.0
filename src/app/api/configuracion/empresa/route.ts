/**
 * Configuración › Datos de la empresa (nivel ADMIN + "Configuración del sistema").
 *   GET /api/configuracion/empresa → datos_empresa() (+ sucursal principal y si puede editar)
 *   PUT /api/configuracion/empresa { razon_social, nombre_fantasia?, ruc?, actividad_economica?,
 *       direccion?, ciudad?, departamento?, telefono?, email?, web? } → datos_empresa()
 * La única vía de escritura es guardar_datos_empresa (SECURITY DEFINER): `empresas` no se
 * escribe directo. La base vuelve a validar todo, incluido el DV del RUC (módulo 11).
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ERR, ok } from "@/lib/api/responses";
import { falloRpc } from "@/modules/usuarios/server";
import { DEPARTAMENTOS_PY, normalizarRuc, validarRuc, type DatosEmpresa } from "@/modules/empresa/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const texto = (max: number, nombre: string) => z.string().trim().max(max, `${nombre}: máximo ${max} caracteres`);
const opcional = (max: number, nombre: string) => texto(max, nombre).nullish().transform((v) => (v ? v : null));

const esquema = z.object({
  razon_social: texto(160, "Razón social").min(2, "Escribí la razón social"),
  nombre_fantasia: opcional(120, "Nombre de fantasía"),
  ruc: opcional(20, "RUC")
    .transform((v) => (v ? normalizarRuc(v) : null))
    .superRefine((v, c) => {
      if (!v) return;
      const r = validarRuc(v);
      if (r.estado === "incompleto" || r.estado === "dv") c.addIssue({ code: z.ZodIssueCode.custom, message: `RUC: ${r.mensaje}` });
    }),
  actividad_economica: opcional(200, "Actividad económica"),
  direccion: opcional(200, "Dirección"),
  ciudad: opcional(80, "Ciudad"),
  departamento: opcional(40, "Departamento").refine((v) => !v || (DEPARTAMENTOS_PY as readonly string[]).includes(v), "Elegí un departamento de la lista"),
  telefono: opcional(40, "Teléfono").refine((v) => !v || /^[0-9 +()/-]{6,40}$/.test(v), "Teléfono inválido: solo números, espacios y + ( ) - /"),
  email: opcional(160, "Email").transform((v) => (v ? v.toLowerCase() : null)).refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s.]{2,}$/.test(v), "Email inválido"),
  web: opcional(160, "Sitio web"),
});

export const GET = withTenant(
  async (ctx) => {
    const { data, error } = await ctx.db.rpc<DatosEmpresa>("datos_empresa");
    if (error) return falloRpc(error);
    if (!data) return ERR.notFound("empresa");
    return ok(data);
  },
  { permiso: "configuracion" },
);

export const PUT = withTenant(
  async (ctx, _req, input) => {
    if (ctx.rol !== "ADMIN") return ERR.forbidden();
    const { data, error } = await ctx.db.rpc<DatosEmpresa>("guardar_datos_empresa", { p: input });
    if (error) return falloRpc(error);
    return ok(data);
  },
  { permiso: "configuracion", body: esquema },
);
