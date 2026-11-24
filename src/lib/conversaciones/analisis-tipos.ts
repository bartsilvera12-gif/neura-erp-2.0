/** Esquema del informe del análisis de conversaciones (receta 174). Compartido cliente/servidor. */
import { z } from "zod";

export const esquemaInforme = z.object({
  resumen: z.string().describe("3 a 6 líneas: cómo son las conversaciones y qué buscan los clientes"),
  preguntas_frecuentes: z
    .array(z.object({ pregunta: z.string(), como_responde_el_equipo: z.string(), frecuencia: z.enum(["muy seguido", "a veces", "pocas veces"]) }))
    .describe("Las preguntas que más se repiten, de más a menos frecuentes (máximo 10)"),
  objeciones: z.array(z.object({ objecion: z.string(), respuesta_que_funciona: z.string() })).describe("Dudas o frenos del cliente y qué respuesta del equipo los destrabó (máximo 8)"),
  productos_que_piden_y_no_hay: z.array(z.string()).describe("Productos o variantes que los clientes pidieron y el equipo dijo que no hay (máximo 10)"),
  tono: z.object({ descripcion: z.string(), frases_tipicas: z.array(z.string()).describe("Frases cortas que usa el equipo, sin datos personales (máximo 8)") }),
  buenas_practicas: z.array(z.string()).describe("Lo que hace el equipo y funciona para vender (máximo 6)"),
  problemas: z.array(z.string()).describe("Demoras, respuestas que confunden, ventas que se perdieron y por qué (máximo 6)"),
  sugerencias: z
    .array(z.object({
      destino: z.enum(["general", "categoria"]).describe("general = instrucciones de la tienda; categoria = instrucciones del vendedor de esa categoría"),
      categoria: z.string().nullable().describe("Nombre exacto de la categoría si destino es categoria; si no, null"),
      texto: z.string().describe("La instrucción lista para agregar, escrita como se la dirías a un vendedor, 1 a 3 líneas"),
      motivo: z.string().describe("Por qué, basado en las conversaciones"),
    }))
    .describe("Instrucciones nuevas para el bot vendedor (máximo 10), que no repitan lo que ya dicen sus instrucciones"),
});
export type Informe = z.infer<typeof esquemaInforme>;
