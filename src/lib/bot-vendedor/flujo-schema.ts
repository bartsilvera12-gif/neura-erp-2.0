/** Validación de un flujo que manda la pantalla (receta 173). Solo servidor. */
import { z } from "zod";
import { TIPOS_PASO, type TipoPaso } from "@/lib/bot-vendedor/flujo";

const TIPOS = Object.keys(TIPOS_PASO) as [TipoPaso, ...TipoPaso[]];
const id = z.string().trim().min(1).max(60).regex(/^[\w-]+$/, "Id de paso inválido");
const coord = z.number().finite().min(-20000).max(20000).transform((n) => Math.round(n));

export const esquemaFlujo = z
  .object({
    nombre: z.string().trim().min(1, "Poné un nombre al flujo").max(80),
    estilo: z.enum(["menus", "charla"]),
    nodos: z
      .array(z.object({
        id, tipo: z.enum(TIPOS), titulo: z.string().trim().max(60), instruccion: z.string().trim().max(1500), activo: z.boolean(), x: coord, y: coord,
      }))
      .min(1, "El flujo no tiene pasos")
      .max(40, "Máximo 40 pasos"),
    conexiones: z.array(z.object({ id: z.string().trim().min(1).max(130), de: id, a: id })).max(120),
  })
  .superRefine((f, ctx) => {
    const ids = new Set<string>();
    for (const n of f.nodos) {
      if (ids.has(n.id)) ctx.addIssue({ code: "custom", message: "Hay dos pasos con el mismo id" });
      ids.add(n.id);
    }
    // Flechas a pasos que ya no existen o de un paso a sí mismo: se descartan en silencio (no ayudan al guion).
    f.conexiones = f.conexiones.filter((c) => ids.has(c.de) && ids.has(c.a) && c.de !== c.a);
  });
