/** Validación de un extra de la lista común (receta 73). Solo servidor. */
import { z } from "zod";

export const extraSchema = z.object({
  nombre: z.string().trim().min(1, "Escribí el nombre del extra").max(60, "Hasta 60 letras"),
  insumo_id: z.string().uuid("Elegí el ingrediente del extra"),
  cantidad: z.coerce.number().positive("Cargá la cantidad del extra").max(100000),
  unidad: z.enum(["Unidad", "kg", "g", "l", "ml"]),
  precio: z.coerce.number().min(0).max(100000000).default(0),
  activo: z.boolean().default(true),
});
