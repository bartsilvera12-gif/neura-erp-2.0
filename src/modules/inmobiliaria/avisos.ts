/**
 * Receta 140: el WhatsApp al interesado. NO se manda solo: se abre WhatsApp (wa.me) con el texto
 * listo y el vendedor lo envía (como los presupuestos).
 */
import { telefonoWhatsApp, urlWhatsApp } from "@/modules/presupuestos/whatsapp";
import type { AvisoInteresado } from "@/modules/inmobiliaria/tipos";

const gs = (n: number | null | undefined) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;

export function mensajeAviso(a: AvisoInteresado): string {
  const nombre = a.cliente.trim().split(/\s+/)[0] ?? "";
  const saludo = nombre.length > 1 && !/^(s\.?a\.?|srl|ltda|eirl|prueba)$/i.test(nombre) ? `¡Hola, ${nombre}!` : "¡Hola!";
  const lugar = [a.barrio, a.ciudad].filter(Boolean).join(", ");
  const precio = a.gestion === "alquiler"
    ? (a.precio_alquiler ? `Alquiler: *${gs(a.precio_alquiler)}* por mes` : null)
    : (a.precio_venta ? `Precio: *${gs(a.precio_venta)}*` : null);
  return [
    `${saludo} ${a.empresa ? `Te escribo de ${a.empresa}. ` : ""}Entró una propiedad que coincide con lo que estás buscando:`,
    "",
    `*${a.titulo}* (${a.codigo})`,
    ...(lugar ? [lugar] : []),
    ...(precio ? [precio] : []),
    "",
    a.gestion === "alquiler" ? "¿Te paso más datos o coordinamos para que la veas?" : "¿Te paso más datos o coordinamos una visita?",
  ].join("\n");
}

/** El link de WhatsApp, o null si el cliente no tiene un celular válido. */
export function linkAviso(a: AvisoInteresado): string | null {
  const tel = telefonoWhatsApp(a.telefono);
  return tel ? urlWhatsApp(tel, mensajeAviso(a)) : null;
}
