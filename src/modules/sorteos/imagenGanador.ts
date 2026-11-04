/**
 * Imagen del ganador para publicar en redes (1080×1350, el formato vertical del feed de Instagram y
 * Facebook). Se dibuja en el navegador con el color de la marca del cliente y se descarga como PNG.
 * Lleva el nombre corto del ganador, nunca la cédula ni el teléfono.
 */
export type DatosImagenGanador = {
  empresa: string;
  sorteo: string;
  posicion: number;
  premio: string;
  numero: string;
  ganador: string | null;
  imagenPremio?: string | null;
  color: string;
  fecha?: string | null;
};

const ANCHO = 1080;
const ALTO = 1350;

/** "Juan Pérez" → "Juan P." */
export const nombreCorto = (n: string | null) => {
  const p = (n ?? "").trim().split(/\s+/).filter(Boolean);
  return p.length ? `${p[0]}${p[1] ? ` ${p[1][0]}.` : ""}` : "Participante";
};

function mezclar(hex: string, con: string, peso: number): string {
  const a = hex.replace("#", "");
  const b = con.replace("#", "");
  const x = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  const c = [0, 2, 4].map((i) => Math.round(x(a, i) * (1 - peso) + x(b, i) * peso));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function cargarImagen(src: string): Promise<HTMLImageElement | null> {
  return new Promise((ok) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => ok(img);
    img.onerror = () => ok(null);
    img.src = src;
    setTimeout(() => ok(null), 6000);
  });
}

/** Escribe una línea achicando la letra hasta que entre en el ancho. */
function linea(ctx: CanvasRenderingContext2D, texto: string, y: number, peso: number, tam: number, max: number, color: string) {
  let t = tam;
  do {
    ctx.font = `${peso} ${t}px "Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", sans-serif`;
    t -= 4;
  } while (ctx.measureText(texto).width > max && t > 18);
  ctx.fillStyle = color;
  ctx.fillText(texto, ANCHO / 2, y);
}

function redondeado(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export async function dibujarImagenGanador(d: DatosImagenGanador): Promise<HTMLCanvasElement> {
  const color = /^#[0-9a-f]{6}$/i.test(d.color) ? d.color : "#2f6e71";
  const oscuro = mezclar(color, "#000000", 0.55);
  const claro = mezclar(color, "#ffffff", 0.65);
  const c = document.createElement("canvas");
  c.width = ANCHO;
  c.height = ALTO;
  const ctx = c.getContext("2d")!;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // Fondo: degradé de la marca con un halo claro arriba.
  const fondo = ctx.createLinearGradient(0, 0, 0, ALTO);
  fondo.addColorStop(0, oscuro);
  fondo.addColorStop(1, color);
  ctx.fillStyle = fondo;
  ctx.fillRect(0, 0, ANCHO, ALTO);
  const halo = ctx.createRadialGradient(ANCHO / 2, 260, 40, ANCHO / 2, 260, 620);
  halo.addColorStop(0, "rgba(255,255,255,0.22)");
  halo.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, ANCHO, ALTO);

  // Papelitos fijos (siempre iguales para que la imagen salga prolija).
  let semilla = 7;
  const azar = () => ((semilla = (semilla * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 70; i++) {
    ctx.save();
    ctx.translate(azar() * ANCHO, azar() * ALTO);
    ctx.rotate(azar() * Math.PI);
    ctx.globalAlpha = 0.25 + azar() * 0.35;
    ctx.fillStyle = [claro, "#ffffff", mezclar(color, "#ffffff", 0.35)][i % 3];
    ctx.fillRect(-7, -11, 14, 22);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // Empresa y título.
  linea(ctx, d.empresa.toUpperCase(), 110, 700, 34, 900, "rgba(255,255,255,0.75)");
  linea(ctx, "¡TENEMOS GANADOR!", 205, 900, 92, 980, "#ffffff");
  linea(ctx, `${d.posicion}° premio · ${d.premio}`, 275, 700, 44, 960, claro);

  // Foto del premio (si hay).
  let y = 330;
  const img = d.imagenPremio ? await cargarImagen(d.imagenPremio) : null;
  if (img) {
    const lado = 380;
    const x = (ANCHO - lado) / 2;
    ctx.save();
    redondeado(ctx, x, y, lado, lado, 40);
    ctx.clip();
    const escala = Math.max(lado / img.width, lado / img.height);
    ctx.drawImage(img, x + (lado - img.width * escala) / 2, y + (lado - img.height * escala) / 2, img.width * escala, img.height * escala);
    ctx.restore();
    ctx.lineWidth = 10;
    ctx.strokeStyle = claro;
    redondeado(ctx, x, y, lado, lado, 40);
    ctx.stroke();
    y += lado + 60;
  } else {
    y += 90;
  }

  // El número, una ficha por cifra.
  const cifras = d.numero.split("");
  const ficha = Math.min(190, Math.floor((ANCHO - 160 - (cifras.length - 1) * 24) / cifras.length));
  const altoFicha = Math.round(ficha * 1.32);
  let x = (ANCHO - (cifras.length * ficha + (cifras.length - 1) * 24)) / 2;
  for (const cifra of cifras) {
    const g = ctx.createLinearGradient(0, y, 0, y + altoFicha);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(1, claro);
    ctx.fillStyle = g;
    ctx.shadowColor = "rgba(0,0,0,0.28)";
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 12;
    redondeado(ctx, x, y, ficha, altoFicha, 28);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.font = `900 ${Math.round(ficha * 0.9)}px "Plus Jakarta Sans", system-ui, sans-serif`;
    ctx.fillStyle = oscuro;
    ctx.fillText(cifra, x + ficha / 2, y + altoFicha * 0.73);
    x += ficha + 24;
  }
  y += altoFicha + 110;

  // Ganador.
  linea(ctx, nombreCorto(d.ganador), y, 900, 96, 960, "#ffffff");
  y += 70;
  linea(ctx, d.sorteo, y, 600, 38, 960, "rgba(255,255,255,0.8)");
  if (d.fecha) linea(ctx, d.fecha, y + 52, 500, 30, 960, "rgba(255,255,255,0.65)");
  linea(ctx, "¡Felicitaciones y gracias a todos por participar!", ALTO - 70, 600, 34, 960, "rgba(255,255,255,0.85)");
  return c;
}

export async function descargarImagenGanador(d: DatosImagenGanador) {
  const c = await dibujarImagenGanador(d);
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/png"));
  if (!blob) throw new Error("No se pudo armar la imagen");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ganador-${d.posicion}-premio-${d.numero}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
