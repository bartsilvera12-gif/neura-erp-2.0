/** Lo que acepta guardar una propiedad (la base valida las reglas: precios según la gestión, dueño, etc.). */
import { z } from "zod";

const texto = (max: number) => z.string().trim().max(max).nullish();
const numero = z.number().nonnegative().max(1e13).nullish();

export const esquemaPropiedad = z.object({
  titulo: z.string().trim().min(3, "Poné un título a la propiedad").max(160),
  descripcion: texto(4000),
  imagen_url: texto(1000),
  tipo_id: z.string().uuid().nullish(),
  gestion: z.enum(["venta", "alquiler", "venta_alquiler"]),
  ciudad: texto(80),
  barrio: texto(120),
  direccion: texto(240),
  superficie_terreno: numero,
  superficie_construida: numero,
  cuenta_catastral: texto(60),
  finca: texto(60),
  manzana: texto(30),
  lote: texto(30),
  documentacion: z.enum(["al_dia", "en_tramite", "con_observaciones", "sin_titulo"]),
  documentacion_nota: texto(500),
  precio_venta: numero,
  precio_alquiler: numero,
  tipo_iva: z.enum(["EXENTA", "5%", "10%"]),
  propia: z.boolean(),
  propietario_id: z.string().uuid().nullish(),
  comision_venta_pct: z.number().min(0).max(100).nullish(),
  comision_alquiler_pct: z.number().min(0).max(100).nullish(),
  notas: texto(2000),
}).strict();
