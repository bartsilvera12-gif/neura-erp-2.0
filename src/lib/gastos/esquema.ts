/** Validación del cuerpo de Gastos y Servicios (servidor). La base vuelve a validar todo. */
import { z } from "zod";

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");
const texto = (max: number) => z.string().trim().max(max).nullish();

export const cuerpoGasto = z.object({
  id: z.string().uuid().nullish(),
  /** true = guardar y confirmar en un paso; false = guardar como borrador */
  confirmar: z.boolean().default(false),
  idempotency_key: z.string().uuid().nullish(),
  proveedor_id: z.string().uuid().nullish(),
  descripcion: texto(500),
  tipo_comprobante: texto(60),
  numero_comprobante: texto(40),
  timbrado: texto(20),
  fecha_comprobante: fecha.nullish(),
  tipo_pago: z.enum(["contado", "credito"]).nullish(),
  plazo_dias: z.coerce.number().int().min(0).max(3650).nullish(),
  fecha_vencimiento: fecha.nullish(),
  medio_pago: z.enum(["efectivo", "transferencia", "cheque", "tarjeta", "otro"]).nullish(),
  referencia_pago: texto(120),
  observacion: texto(1000),
  items: z
    .array(z.object({
      categoria_id: z.string().uuid().nullish(),
      descripcion: z.string().trim().max(300).default(""),
      monto: z.coerce.number().min(0, "Hay un monto negativo").max(1e13),
      iva_tipo: z.enum(["10%", "5%", "exenta"]),
    }))
    .max(100, "Máximo 100 líneas"),
});

export type CuerpoGasto = z.infer<typeof cuerpoGasto>;
