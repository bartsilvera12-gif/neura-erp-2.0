/** Validación del alta/edición de proveedores (compartida por las rutas). Solo servidor. */
import { z } from "zod";

const texto = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);

export const cuerpoProveedor = z.object({
  nombre: z.string().trim().min(1, "La razón social es obligatoria.").max(200),
  nombre_comercial: texto(200),
  ruc: texto(30),
  telefono: texto(40),
  email: z.string().trim().toLowerCase().email("Email inválido").max(120).nullish().or(z.literal("")).transform((v) => v || null),
  direccion: texto(200),
  ciudad: texto(80),
  contacto: texto(120),
  contacto_telefono: texto(40),
  condicion_pago: z.enum(["contado", "credito"]).default("contado"),
  plazo_pago_dias: z.coerce.number().int().min(0).max(3650).nullish(),
  moneda: z.enum(["GS", "USD"]).default("GS"),
  observaciones: texto(1000),
  activo: z.boolean().optional(),
  categoria_ids: z.array(z.string().uuid()).max(50).default([]),
  categorias_nuevas: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
});
