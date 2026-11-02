/** Validación de los cuerpos de RR HH (servidor). La base vuelve a validar todo. */
import { z } from "zod";

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");
const fechaOpcional = z.union([fecha, z.literal(""), z.null()]).optional();
const texto = (max: number) => z.string().trim().max(max).nullable().optional();
const hora = z.union([z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/), z.literal(""), z.null()]).optional();
export const mesValido = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mes inválido");

export const guardarLegajo = z.object({
  nombres: z.string().trim().min(1, "Escribí el nombre").max(120),
  apellidos: texto(120),
  ci: texto(20),
  telefono: texto(40),
  fecha_nacimiento: fechaOpcional,
  direccion: texto(200),
  barrio: texto(100),
  ciudad: texto(100),
  emergencia_nombre: texto(120),
  emergencia_telefono: texto(40),
  fecha_ingreso: fecha,
  fecha_egreso: fechaOpcional,
  tipo_salario: z.enum(["mensualero", "jornalero"]),
  salario: z.number().min(0).max(1e12),
  aporta_ips: z.boolean(),
  comisiona: z.boolean(),
  area: texto(80),
  horario_dias: z.array(z.number().int().min(1).max(7)).max(7),
  horario_entrada: hora,
  horario_salida: hora,
  horario_nota: texto(200),
  motivo_salario: texto(300),
});

export const accionFicha = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("ausencia"), fecha, dias: z.number().positive().max(31), tipo: z.enum(["injustificada", "permiso_sin_goce", "permiso_con_goce", "reposo"]), descuenta: z.boolean(), motivo: texto(300) }),
  z.object({ accion: z.literal("anular_ausencia"), id: z.string().uuid(), motivo: z.string().trim().min(3, "El motivo es obligatorio").max(300) }),
  z.object({ accion: z.literal("vacacion"), desde: fecha, hasta: fecha, dias: z.number().positive().max(60), nota: texto(300) }),
  z.object({ accion: z.literal("anular_vacacion"), id: z.string().uuid(), motivo: z.string().trim().min(3, "El motivo es obligatorio").max(300) }),
  z.object({ accion: z.literal("nota"), tipo: z.string(), texto: z.string().trim().min(3, "Escribí qué pasó").max(500) }),
]);

const ajuste = z.object({ concepto: z.string().trim().min(1, "Escribí el concepto").max(100), monto: z.number().positive().max(1e12), tipo: z.enum(["extra", "descuento"]), imponible: z.boolean() });

export const accionLiquidacion = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("ajustar"), mes: mesValido, usuario_id: z.string().uuid(), dias_trabajados: z.number().min(0).max(31).nullable(), ajustes: z.array(ajuste).max(30) }),
  z.object({ accion: z.literal("cerrar"), mes: mesValido, usuarios: z.array(z.string().uuid()).min(1) }),
  z.object({ accion: z.literal("reabrir"), mes: mesValido, usuario_id: z.string().uuid(), motivo: z.string().trim().min(3, "El motivo es obligatorio").max(300) }),
]);
