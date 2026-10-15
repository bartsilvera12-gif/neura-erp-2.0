/**
 * "Enviar por WhatsApp": NO manda nada solo. Arma el mensaje y abre WhatsApp (wa.me) con
 * el texto listo; la persona elige/confirma el chat y aprieta enviar.
 */
import { diaCorto, monto, numeroConRevision, type Moneda } from "@/modules/presupuestos/tipos";

/** Teléfono en formato internacional para wa.me (Paraguay por defecto): "0981 123 456" → "595981123456". */
export function telefonoWhatsApp(tel: string | null | undefined): string | null {
  const d = (tel ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("595")) return d.length >= 11 ? d : null;
  if (d.startsWith("00")) return d.slice(2).length >= 8 ? d.slice(2) : null;
  if (d.startsWith("0")) return d.length >= 9 ? `595${d.slice(1)}` : null;
  if (d.length === 9 && d.startsWith("9")) return `595${d}`;
  return d.length >= 10 ? d : null;
}

export function mensajePresupuesto(p: {
  numero: string;
  revision: number;
  cliente: string;
  total: number;
  moneda: Moneda;
  valido_hasta: string;
  link: string;
  empresa: string;
  vendedor?: string | null;
}): string {
  const nombre = p.cliente.trim().split(/\s+/)[0] ?? "";
  const saludo = nombre && nombre.length > 1 && !/^(s\.?a\.?|srl|ltda|eirl)$/i.test(nombre) ? `¡Hola, ${nombre}!` : "¡Hola!";
  return [
    `${saludo} Te comparto el presupuesto *${numeroConRevision(p.numero, p.revision)}* de ${p.empresa}.`,
    "",
    `Total: *${monto(p.total, p.moneda)}* (IVA incluido)`,
    `Válido hasta el ${diaCorto(p.valido_hasta)}.`,
    "",
    "Lo podés ver, descargar en PDF y aceptar acá:",
    p.link,
    "",
    "Cualquier consulta, escribime.",
    ...(p.vendedor ? [p.vendedor] : []),
  ].join("\n");
}

export const urlWhatsApp = (telefono: string | null, texto: string) =>
  `https://wa.me/${telefono ?? ""}?text=${encodeURIComponent(texto)}`;

export const linkPublico = (token: string) =>
  `${typeof window !== "undefined" ? window.location.origin : ""}/p/${token}`;
