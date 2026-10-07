/**
 * Piezas comunes de los PDF de reportes (jsPDF, A4 vertical, mm): membrete con logo,
 * título en recuadro, títulos de sección, pie con numeración. Mismo diseño que el
 * arqueo de caja (portado de Ferretería República). Solo servidor.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { jsPDF } from "jspdf";
import { clienteConfig } from "@/cliente.config";
import { TZ_PY } from "@/lib/fecha/paraguay";

export type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const COLOR = {
  teal: hex(clienteConfig.color),
  negro: [17, 17, 17] as RGB,
  gris: [102, 102, 102] as RGB,
  grisClaro: [136, 136, 136] as RGB,
  borde: [226, 231, 239] as RGB,
  verde: [4, 120, 87] as RGB,
  rojo: [185, 28, 28] as RGB,
  ambar: [180, 83, 9] as RGB,
};
export const M = 15; // margen
export const W = 210 - M * 2; // ancho útil

export const gs = (v: number) => Math.round(Number(v) || 0).toLocaleString("es-PY");
export const fechaHoraPY = (iso: string) =>
  new Intl.DateTimeFormat("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
/** Helvetica de jsPDF es WinAnsi: el signo menos tipográfico y similares no existen. */
export const pdfTxt = (s: string) => s.replace(/−/g, "-").replace(/→/g, "->").replace(/ | /g, " ");

let logoCache: { data: string; w: number; h: number } | null | undefined;
async function logoDoc() {
  if (logoCache !== undefined) return logoCache;
  try {
    const buf = await readFile(path.join(process.cwd(), "public", "brand", "logo-doc.png"));
    logoCache = { data: `data:image/png;base64,${buf.toString("base64")}`, w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  } catch {
    logoCache = null;
  }
  return logoCache;
}

export function nuevoDocumento() {
  return new jsPDF({ unit: "mm", format: "a4", compress: true });
}

/** Membrete (logo + empresa) y título en recuadro. Devuelve la Y siguiente. */
export async function encabezado(doc: jsPDF, titulo: string, subtitulo?: string): Promise<number> {
  const der = M + W;
  let y = M;
  const logo = await logoDoc();
  let alto = 12;
  if (logo) {
    const w = Math.min(45, (logo.w / logo.h) * 15);
    const h = (w * logo.h) / logo.w;
    doc.addImage(logo.data, "PNG", M, y, w, h, "logo", "FAST");
    alto = Math.max(alto, h);
  }
  doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(31, 41, 55);
  doc.text(pdfTxt(clienteConfig.nombre), der, y + 4, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(107, 114, 128);
  doc.text(clienteConfig.dominio, der, y + 9, { align: "right" });
  doc.text("Paraguay", der, y + 13, { align: "right" });
  y += alto + 3;
  doc.setDrawColor(...COLOR.teal).setLineWidth(0.6).line(M, y, der, y);
  y += 6;
  doc.setDrawColor(...COLOR.negro).setLineWidth(0.6).rect(M, y, W, 9);
  doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(...COLOR.negro);
  doc.text(pdfTxt(titulo), M + W / 2, y + 6.1, { align: "center", charSpace: 0.4 });
  y += 14;
  if (subtitulo) {
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(85, 85, 85);
    const lineas = doc.splitTextToSize(pdfTxt(subtitulo), W) as string[];
    doc.text(lineas, M + W / 2, y, { align: "center" });
    y += lineas.length * 4.2 + 2;
  }
  return y;
}

/** Título de sección en turquesa con línea debajo (ancho opcional). */
export function tituloSeccion(doc: jsPDF, txt: string, x: number, y: number, ancho = W) {
  doc.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(...COLOR.teal);
  doc.text(pdfTxt(txt), x, y, { charSpace: 0.2 });
  doc.setDrawColor(...COLOR.teal).setLineWidth(0.35).line(x, y + 1.6, x + ancho, y + 1.6);
}

/** Si no entra `alto` mm en la página, salta a una nueva. Devuelve la Y a usar. */
export function asegurarEspacio(doc: jsPDF, y: number, alto: number): number {
  if (y + alto > 297 - 18) {
    doc.addPage();
    return M;
  }
  return y;
}

/** Pie en todas las páginas: leyenda + "Página n de m". */
export function pieDePagina(doc: jsPDF, leyenda: string) {
  const paginas = doc.getNumberOfPages();
  const generado = fechaHoraPY(new Date().toISOString());
  for (let p = 1; p <= paginas; p++) {
    doc.setPage(p);
    doc.setDrawColor(187, 187, 187).setLineWidth(0.2).setLineDashPattern([0.8, 0.8], 0).line(M, 297 - 12, M + W, 297 - 12).setLineDashPattern([], 0);
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...COLOR.gris);
    doc.text(pdfTxt(`${leyenda} · ${clienteConfig.nombre} · ${generado}`), M, 297 - 8);
    doc.text(`Página ${p} de ${paginas}`, M + W, 297 - 8, { align: "right" });
  }
}

export function respuestaPdf(doc: jsPDF, nombre: string) {
  return new Response(doc.output("arraybuffer"), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${nombre}"`,
      "cache-control": "no-store",
    },
  });
}
