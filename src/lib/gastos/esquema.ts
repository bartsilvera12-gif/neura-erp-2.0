/** Validación de los cuerpos de Gastos empresariales (servidor). La base vuelve a validar todo. */
import { z } from "zod";

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");
const texto = (max: number) => z.string().trim().max(max).nullish();
const uuid = z.string().uuid().nullish();
const medio = z.enum(["efectivo", "transferencia", "cheque", "tarjeta", "otro"]).nullish();
const iva = z.enum(["10%", "5%", "exenta"]);

const linea = z.object({
  categoria_id: uuid,
  descripcion: z.string().trim().max(300).default(""),
  monto: z.coerce.number().min(0, "Hay un monto negativo").max(1e13),
  iva_tipo: iva,
  sucursal_id: uuid,
  empleado_id: uuid,
});

export const cuerpoGasto = z.object({
  id: uuid,
  /** true = guardar y confirmar en un paso; false = guardar como borrador */
  confirmar: z.boolean().default(false),
  idempotency_key: uuid,
  proveedor_id: uuid,
  sucursal_id: uuid,
  con_comprobante: z.boolean().default(true),
  descripcion: texto(500),
  tipo_comprobante: texto(60),
  numero_comprobante: texto(40),
  timbrado: texto(20),
  fecha_comprobante: fecha.nullish(),
  tipo_pago: z.enum(["contado", "credito"]).nullish(),
  plazo_dias: z.coerce.number().int().min(0).max(3650).nullish(),
  fecha_vencimiento: fecha.nullish(),
  medio_pago: medio,
  referencia_pago: texto(120),
  cuenta_bancaria_id: uuid,
  moneda: z.enum(["GS", "USD"]).default("GS"),
  tipo_cambio: z.coerce.number().positive().max(100000).nullish(),
  observacion: texto(1000),
  items: z.array(linea).max(100, "Máximo 100 líneas"),
});
export type CuerpoGasto = z.infer<typeof cuerpoGasto>;

export const cuerpoRecurrente = z.object({
  id: uuid,
  nombre: z.string().trim().min(2, "Escribí un nombre").max(120),
  proveedor_id: uuid,
  sucursal_id: uuid,
  con_comprobante: z.boolean().default(true),
  tipo_comprobante: texto(60),
  tipo_pago: z.enum(["contado", "credito"]).default("contado"),
  plazo_dias: z.coerce.number().int().min(0).max(3650).nullish(),
  medio_pago: medio,
  cuenta_bancaria_id: uuid,
  moneda: z.enum(["GS", "USD"]).default("GS"),
  tipo_cambio: z.coerce.number().positive().max(100000).nullish(),
  dia_vencimiento: z.coerce.number().int().min(1).max(31),
  descripcion: texto(500),
  activo: z.boolean().nullish(),
  vigente_desde: fecha.nullish(),
  vigente_hasta: fecha.nullish(),
  items: z.array(linea).min(1, "Cargá al menos una línea").max(50),
});

export const cuerpoCategoria = z.object({
  id: uuid,
  nombre: z.string().trim().min(2, "Escribí el nombre").max(80),
  padre_id: uuid,
  tipo_costo: z.enum(["fijo", "variable"]).default("variable"),
  deducible_iva: z.boolean().nullish(),
  es_personal: z.boolean().nullish(),
  activo: z.boolean().nullish(),
  orden: z.coerce.number().int().min(0).max(9999).nullish(),
});

export const cuerpoEmpleado = z.object({
  id: uuid,
  nombre: z.string().trim().min(2, "Escribí el nombre").max(120),
  ci: texto(20),
  cargo: texto(80),
  sucursal_id: uuid,
  activo: z.boolean().nullish(),
});

export const cuerpoCuentaBancaria = z.object({
  id: uuid,
  banco_id: uuid,
  banco_nombre: texto(80),
  numero: z.string().trim().min(1, "Escribí el número de cuenta").max(40),
  moneda: z.enum(["GS", "USD"]).default("GS"),
  titular: texto(120),
  alias: texto(60),
  activa: z.boolean().nullish(),
});

export const cuerpoPresupuesto = z.object({
  periodo: fecha,
  items: z.array(z.object({ categoria_id: uuid, monto: z.coerce.number().min(0).max(1e13) })).max(500),
});

/** Mensaje de error de la base sin el prefijo técnico. */
export const mensajeDb = (m: string) => m.replace(/^.*?ERROR:\s*/, "");
