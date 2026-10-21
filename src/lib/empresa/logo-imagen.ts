/**
 * Procesamiento de la imagen del logo (solo servidor, sharp + píxeles en crudo). Sin imports
 * del proyecto a propósito: se prueba suelto con Node.
 *
 *   prepararOriginal(entrada) → el ORIGINAL normalizado (enderezado, lado mayor ≤ 1200 px,
 *                               PNG si tiene transparencia o vino sin pérdida / si no JPEG). Se
 *                               guarda en el bucket para volver atrás o volver a quitar el fondo.
 *   logoDesdeOriginal(orig, quitarFondo) → el logo que usan los PDF (lado mayor ≤ 600 px). El
 *                               cálculo se hace siempre sobre el original guardado (≤ 1200 px):
 *                               al subir y al alternar da exactamente lo mismo.
 *
 * ── Quitado de fondo (quitarFondoRgba) ───────────────────────────────────────────────────
 * Pensado para logos sobre un fondo LISO (blanco, gris o de color; JPG con ruido incluido).
 * Sin modelos de IA ni servicios externos: relleno desde los bordes.
 *   1. Si ya trae transparencia (> 2 % de píxeles con alfa < 250, o > 30 % del borde) → "transparente".
 *   2. Fondo = mediana (en Lab) de la franja de 2 px del borde. Si el borde no es uniforme
 *      (< 60 % del borde a ΔE ≤ 10 de la mediana, o algún lado con < 20 %) → "no_detectado".
 *      El ruido del borde (p95 del ΔE) fija la tolerancia: tLo = clamp(3 + 1.6·ruido, 8, 22).
 *   3. Flood fill (4-vecinos) desde los píxeles del borde con ΔE ≤ tLo. Lo que no toca el
 *      borde no se borra, salvo los "huecos" (regiones cerradas del color del fondo) que se
 *      ven como el ojo de una letra (O, A, R, e): chicos frente al logo (≤ 4 % de su rectángulo)
 *      o claramente más chicos que la figura que los encierra (≤ 80 % de alto y ancho, área ≤ 1,5 ×
 *      la del trazo). Un círculo blanco grande dentro de un contorno (o el relleno blanco de un
 *      escudo) se conserva.
 *   4. Borde suave: en la franja alrededor de lo borrado (hasta 12 px, mientras el píxel siga
 *      siendo "mezcla"), alfa = proyección del color sobre la recta fondo → color del trazo
 *      vecino (el más distinto del fondo en una ventana de 11×11), con el ruido (tLo) recortado;
 *      se descontamina el color: c = (c − (1 − a)·fondo) / a (sin halo claro sobre fondo oscuro).
 *   5. Se borran motas sueltas (componentes con poca "masa" de alfa o alfa máx. < 0,35:
 *      ruido de JPG) y se recortan los márgenes dejando un padding del 3 %.
 *   6. Si lo que queda es casi todo blanco (> 80 % con L > 92: logo blanco sobre un color), al
 *      subir NO se le quita el fondo (no se vería en el papel blanco); se puede pedir igual.
 */
import type { Sharp } from "sharp";

export type FondoLogo = "quitado" | "no_detectado" | "transparente";
export type LogoNormalizado = { datos: Buffer; mime: "image/png" | "image/jpeg"; ext: "png" | "jpg"; ancho: number; alto: number };

const LADO_MAX = 600; // logo de los PDF
const LADO_ORIGINAL = 1200; // original guardado y lado de trabajo del quitado de fondo
const SALIDA_MAX_BYTES = 1024 * 1024; // límite del bucket
const LIMITE_PX = 40_000_000;

// ── Color ────────────────────────────────────────────────────────────────────────────────
const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
const fLab = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
function aLab(r: number, g: number, b: number, out: Float32Array, o: number) {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  const fx = fLab((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047);
  const fy = fLab(0.2126729 * R + 0.7151522 * G + 0.072175 * B);
  const fz = fLab((0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883);
  out[o] = 116 * fy - 16;
  out[o + 1] = 500 * (fx - fy);
  out[o + 2] = 200 * (fy - fz);
}
const mediana = (v: Float32Array | number[]) => {
  const s = Float32Array.from(v).sort();
  return s.length ? s[s.length >> 1] : 0;
};
const percentil = (v: Float32Array, p: number) => {
  const s = Float32Array.from(v).sort();
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0;
};

export type ResultadoFondo =
  | { estado: "quitado"; datos: Buffer; ancho: number; alto: number; fondo: [number, number, number]; claro: boolean }
  | { estado: "no_detectado" | "transparente"; motivo: string };

/** Quita el fondo liso de una imagen RGBA (en crudo). Devuelve la imagen recortada o por qué no. */
export function quitarFondoRgba(px: Uint8Array, w: number, h: number): ResultadoFondo {
  const N = w * h;
  if (w < 8 || h < 8) return { estado: "no_detectado", motivo: "imagen muy chica" };

  // 1. ¿Ya viene sin fondo?
  const banda = Math.min(2, Math.floor(Math.min(w, h) / 8)) || 1;
  const esBorde = (x: number, y: number) => x < banda || y < banda || x >= w - banda || y >= h - banda;
  let transp = 0, bordeN = 0, bordeTransp = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = px[(y * w + x) * 4 + 3];
    if (a < 250) transp++;
    if (esBorde(x, y)) { bordeN++; if (a < 250) bordeTransp++; }
  }
  if (transp > N * 0.02 || bordeTransp > bordeN * 0.3) return { estado: "transparente", motivo: "ya tiene transparencia" };

  // 2. Color del fondo desde el borde (mediana en Lab) y uniformidad.
  const lab = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) aLab(px[i * 4], px[i * 4 + 1], px[i * 4 + 2], lab, i * 3);
  const bi: number[] = [];
  const lado: number[] = []; // 0 arriba, 1 abajo, 2 izq, 3 der
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!esBorde(x, y)) continue;
    bi.push(y * w + x);
    lado.push(y < banda ? 0 : y >= h - banda ? 1 : x < banda ? 2 : 3);
  }
  const bL = mediana(bi.map((i) => lab[i * 3])), bA = mediana(bi.map((i) => lab[i * 3 + 1])), bB = mediana(bi.map((i) => lab[i * 3 + 2]));
  const dBorde = new Float32Array(bi.length);
  const porLado = [[0, 0], [0, 0], [0, 0], [0, 0]];
  let cerca = 0;
  for (let k = 0; k < bi.length; k++) {
    const i = bi[k] * 3;
    const d = Math.hypot(lab[i] - bL, lab[i + 1] - bA, lab[i + 2] - bB);
    dBorde[k] = d;
    porLado[lado[k]][1]++;
    if (d <= 10) { cerca++; porLado[lado[k]][0]++; }
  }
  if (cerca < bi.length * 0.6 || porLado.some(([c, t]) => t > 0 && c < t * 0.2)) {
    return { estado: "no_detectado", motivo: "el borde no es de un solo color" };
  }
  const ruido = percentil(dBorde.filter((d) => d <= 10), 0.95);
  const tLo = Math.min(22, Math.max(8, 3 + 1.6 * ruido));
  // Fondo en RGB (para descontaminar): mediana de los píxeles del borde que son fondo.
  const bgIdx = bi.filter((_, k) => dBorde[k] <= tLo);
  const bg: [number, number, number] = [0, 1, 2].map((c) => mediana(bgIdx.map((i) => px[i * 4 + c]))) as [number, number, number];

  const d = new Float32Array(N);
  for (let i = 0; i < N; i++) d[i] = Math.hypot(lab[i * 3] - bL, lab[i * 3 + 1] - bA, lab[i * 3 + 2] - bB);

  // 3. Flood fill desde el borde. estado: 0 = primer plano, 1 = fondo borrado, 2 = hueco conservado.
  const est = new Uint8Array(N);
  const cola = new Int32Array(N);
  let qi = 0, qn = 0;
  for (const i of bi) if (d[i] <= tLo && est[i] === 0) { est[i] = 1; cola[qn++] = i; }
  const vecinos4 = (i: number, f: (j: number) => void) => {
    const x = i % w;
    if (x > 0) f(i - 1);
    if (x < w - 1) f(i + 1);
    if (i >= w) f(i - w);
    if (i < N - w) f(i + w);
  };
  while (qi < qn) {
    vecinos4(cola[qi++], (j) => { if (est[j] === 0 && d[j] <= tLo) { est[j] = 1; cola[qn++] = j; } });
  }
  let borrados = qn;

  // 3b. Huecos (regiones del color del fondo que no tocan el borde): ojos de letras.
  const etiquetaFg = new Int32Array(N).fill(-1);
  const figuras: { area: number; x0: number; y0: number; x1: number; y1: number }[] = [];
  const figuraDe = (semilla: number) => {
    if (etiquetaFg[semilla] >= 0) return figuras[etiquetaFg[semilla]];
    const id = figuras.length;
    const fig = { area: 0, x0: w, y0: h, x1: -1, y1: -1 };
    figuras.push(fig);
    let a = 0, b = 0;
    cola[b++] = semilla;
    etiquetaFg[semilla] = id;
    while (a < b) {
      const i = cola[a++];
      const x = i % w, y = (i / w) | 0;
      fig.area++;
      if (x < fig.x0) fig.x0 = x; if (x > fig.x1) fig.x1 = x;
      if (y < fig.y0) fig.y0 = y; if (y > fig.y1) fig.y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if ((dx || dy) && xx >= 0 && yy >= 0 && xx < w && yy < h) {
          const j = yy * w + xx;
          if (etiquetaFg[j] < 0 && est[j] === 0 && d[j] > tLo) { etiquetaFg[j] = id; cola[b++] = j; }
        }
      }
    }
    return fig;
  };
  const hueco = new Int32Array(N); // reutilizable para listar los píxeles de cada hueco
  // Área del rectángulo que ocupa el logo (lo que no es fondo del borde).
  let lx0 = w, ly0 = h, lx1 = -1, ly1 = -1;
  for (let i = 0; i < N; i++) if (est[i] === 0) {
    const x = i % w, y = (i / w) | 0;
    if (x < lx0) lx0 = x; if (x > lx1) lx1 = x; if (y < ly0) ly0 = y; if (y > ly1) ly1 = y;
  }
  const areaLogo = lx1 < 0 ? 0 : (lx1 - lx0 + 1) * (ly1 - ly0 + 1);
  for (let s = 0; s < N; s++) {
    if (est[s] !== 0 || d[s] > tLo) continue;
    // s es el píxel más alto (y más a la izquierda) del hueco: el de arriba es la figura que lo encierra.
    let a = 0, b = 0;
    hueco[b++] = s;
    est[s] = 2;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    while (a < b) {
      const i = hueco[a++];
      const x = i % w, y = (i / w) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      vecinos4(i, (j) => { if (est[j] === 0 && d[j] <= tLo) { est[j] = 2; hueco[b++] = j; } });
    }
    const fig = s >= w ? figuraDe(s - w) : null;
    const hw = x1 - x0 + 1, hh = y1 - y0 + 1;
    const fw = fig ? fig.x1 - fig.x0 + 1 : 0, fh = fig ? fig.y1 - fig.y0 + 1 : 0;
    // Ojo de letra: chico frente al logo entero (≤ 4 %), o claramente más chico que la figura
    // que lo encierra (≤ 80 % de alto y ancho) y con área ≤ 1,5 × la del trazo.
    const ojo = !!fig && (
      (b <= areaLogo * 0.04 && hw <= 0.95 * fw && hh <= 0.95 * fh) ||
      (hw <= 0.8 * fw && hh <= 0.8 * fh && b <= 1.5 * fig.area));
    if (ojo) {
      for (let k = 0; k < b; k++) est[hueco[k]] = 1;
      borrados += b;
    }
  }
  if (borrados < N * 0.005) return { estado: "no_detectado", motivo: "casi no hay fondo para quitar" };
  if (N - borrados < N * 0.002) return { estado: "no_detectado", motivo: "la imagen es solo fondo" };

  // 4. Alfa: 0 en lo borrado; borde suave en una franja alrededor; 1 en el resto.
  const alfa = new Float32Array(N);
  for (let i = 0; i < N; i++) alfa[i] = est[i] === 1 ? 0 : 1;
  const F = 12, R = 5; // franja: hasta 12 px mientras siga siendo "mezcla"; ventana del trazo 11×11
  const dist = new Uint8Array(N); // 0 = no visitado
  qi = 0; qn = 0;
  for (let i = 0; i < N; i++) if (est[i] === 1) {
    let toca = false;
    vecinos4(i, (j) => { if (est[j] !== 1) toca = true; });
    if (toca) cola[qn++] = i;
  }
  const res = Buffer.from(px.subarray(0, N * 4));
  const procesarFranja = (i: number): number => {
    // Color del trazo: el píxel más distinto del fondo en la ventana.
    const x = i % w, y = (i / w) | 0;
    let jm = i, dm = d[i];
    for (let yy = Math.max(0, y - R); yy <= Math.min(h - 1, y + R); yy++) {
      for (let xx = Math.max(0, x - R); xx <= Math.min(w - 1, x + R); xx++) {
        const j = yy * w + xx;
        if (est[j] !== 1 && d[j] > dm) { dm = d[j]; jm = j; }
      }
    }
    const o = i * 4, of = jm * 4;
    const vr = px[o] - bg[0], vg = px[o + 1] - bg[1], vb = px[o + 2] - bg[2];
    const ur = px[of] - bg[0], ug = px[of + 1] - bg[1], ub = px[of + 2] - bg[2];
    const uu = ur * ur + ug * ug + ub * ub;
    let a = uu > 625 ? (vr * ur + vg * ug + vb * ub) / uu : dm > 0 ? d[i] / dm : 1;
    const lo = Math.min(0.5, Math.max(0.05, tLo / Math.max(dm, 1e-3)));
    a = Math.min(1, Math.max(0, (a - lo) / (0.95 - lo)));
    return a;
  };
  while (qi < qn) {
    const i = cola[qi++];
    const di = est[i] === 1 ? 0 : dist[i];
    if (di >= F) continue;
    vecinos4(i, (j) => {
      if (est[j] !== 0 || dist[j]) return;
      dist[j] = di + 1;
      const a = procesarFranja(j);
      alfa[j] = a;
      if (a < 0.9) cola[qn++] = j; // sigue solo mientras el píxel sea "mezcla"
    });
  }

  // 5. Motas sueltas (8-vecinos sobre alfa > 0).
  const visto = new Uint8Array(N);
  const minMasa = Math.max(4, N * 5e-6);
  for (let s = 0; s < N; s++) {
    if (visto[s] || alfa[s] <= 0) continue;
    let a = 0, b = 0, masa = 0, max = 0;
    cola[b++] = s;
    visto[s] = 1;
    while (a < b) {
      const i = cola[a++];
      masa += alfa[i];
      if (alfa[i] > max) max = alfa[i];
      const x = i % w, y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if ((dx || dy) && xx >= 0 && yy >= 0 && xx < w && yy < h) {
          const j = yy * w + xx;
          if (!visto[j] && alfa[j] > 0) { visto[j] = 1; cola[b++] = j; }
        }
      }
    }
    if (masa < minMasa || max < 0.35) for (let k = 0; k < b; k++) alfa[cola[k]] = 0;
  }

  // Descontaminar y armar RGBA; recorte.
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  let masa = 0, masaClara = 0;
  for (let i = 0; i < N; i++) {
    const a = alfa[i] * (px[i * 4 + 3] / 255);
    const o = i * 4;
    if (a <= 0.004) { res[o] = res[o + 1] = res[o + 2] = res[o + 3] = 0; continue; }
    if (alfa[i] >= 0.9) { masa++; if (lab[i * 3] > 92) masaClara++; }
    if (a < 0.999 && alfa[i] < 1) {
      for (let c = 0; c < 3; c++) res[o + c] = Math.max(0, Math.min(255, Math.round((px[o + c] - (1 - alfa[i]) * bg[c]) / alfa[i])));
    }
    res[o + 3] = Math.round(a * 255);
    if (res[o + 3] > 10) {
      const x = i % w, y = (i / w) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { estado: "no_detectado", motivo: "no quedó nada del logo" };
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.03) + 2;
  const cx0 = Math.max(0, x0 - pad), cy0 = Math.max(0, y0 - pad);
  const cw = Math.min(w, x1 + pad + 1) - cx0, ch = Math.min(h, y1 + pad + 1) - cy0;
  const rec = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) res.copy(rec, y * cw * 4, ((cy0 + y) * w + cx0) * 4, ((cy0 + y) * w + cx0 + cw) * 4);
  // Logo casi todo blanco (p. ej. blanco sobre verde): sin su fondo no se vería en un papel blanco.
  const claro = masa > 0 && masaClara > masa * 0.8;
  return { estado: "quitado", datos: rec, ancho: cw, alto: ch, fondo: bg, claro };
}

// ── sharp ────────────────────────────────────────────────────────────────────────────────
async function sh(): Promise<(input?: Buffer, opts?: object) => Sharp> {
  const m = await import("sharp");
  return (m.default ?? m) as unknown as (input?: Buffer, opts?: object) => Sharp;
}

/** PNG o JPEG del logo final, dentro del límite del bucket. */
async function codificar(img: () => Sharp, opaco: boolean): Promise<LogoNormalizado | { error: string }> {
  let out = opaco
    ? await img().flatten({ background: "#ffffff" }).jpeg({ quality: 88, mozjpeg: true }).toBuffer({ resolveWithObject: true })
    : await img().png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer({ resolveWithObject: true });
  if (!opaco && out.data.length > SALIDA_MAX_BYTES) out = await img().png({ palette: true, compressionLevel: 9 }).toBuffer({ resolveWithObject: true });
  if (out.data.length > SALIDA_MAX_BYTES) return { error: "El logo es demasiado pesado aun achicado: probá con una imagen más simple." };
  return { datos: out.data, mime: opaco ? "image/jpeg" : "image/png", ext: opaco ? "jpg" : "png", ancho: out.info.width, alto: out.info.height };
}

/**
 * Valida lo que subió el usuario y arma el ORIGINAL normalizado (enderezado, lado mayor ≤ 1200
 * px; PNG si tiene transparencia o si vino sin pérdida y entra en 1 MB, si no JPEG). Devuelve
 * { error } con un mensaje si no sirve.
 */
export async function prepararOriginal(entrada: Buffer, maxBytes: number): Promise<LogoNormalizado | { error: string }> {
  if (entrada.length < 1) return { error: "El archivo está vacío." };
  if (entrada.length > maxBytes) return { error: `El logo no puede superar ${Math.round(maxBytes / 1024 / 1024)} MB.` };
  const sharp = await sh();
  let meta;
  try {
    meta = await sharp(entrada, { limitInputPixels: LIMITE_PX }).metadata();
  } catch {
    return { error: "No se pudo leer la imagen: subí un PNG, JPG o WEBP válido." };
  }
  if (!meta.format || !["png", "jpeg", "webp"].includes(meta.format)) return { error: "Formato no aceptado: subí un PNG, JPG o WEBP (SVG no)." };
  if ((meta.pages ?? 1) > 1) return { error: "El logo no puede ser animado." };
  try {
    for (const lado of [LADO_ORIGINAL, 900, LADO_MAX]) {
      const base = () => sharp(entrada, { limitInputPixels: LIMITE_PX }).rotate().resize({ width: lado, height: lado, fit: "inside", withoutEnlargement: true });
      const { isOpaque } = await base().stats();
      const opaco = isOpaque || !meta.hasAlpha;
      // Sin pérdida si se puede (PNG / WEBP de entrada): el quitado de fondo trabaja mejor sin ruido de JPEG.
      if (!opaco || meta.format !== "jpeg") {
        const png = await (opaco ? base().flatten({ background: "#ffffff" }) : base()).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer({ resolveWithObject: true });
        if (png.data.length <= SALIDA_MAX_BYTES) return { datos: png.data, mime: "image/png", ext: "png", ancho: png.info.width, alto: png.info.height };
        if (!opaco) continue;
      }
      const jpg = await base().flatten({ background: "#ffffff" }).jpeg({ quality: 92, mozjpeg: true }).toBuffer({ resolveWithObject: true });
      if (jpg.data.length <= SALIDA_MAX_BYTES) return { datos: jpg.data, mime: "image/jpeg", ext: "jpg", ancho: jpg.info.width, alto: jpg.info.height };
    }
    return { error: "El logo es demasiado pesado aun achicado: probá con una imagen más simple." };
  } catch {
    return { error: "No se pudo procesar la imagen: probá con otro archivo." };
  }
}

/**
 * Logo de los PDF a partir del original guardado. Modo:
 *   "auto"     → al subir: le quita el fondo salvo que el logo quede casi todo blanco (no se
 *                vería en el papel); en ese caso lo deja con su fondo (`claro: true`).
 *   "quitar"   → se lo quita igual (lo pidió el usuario).
 *   "original" → tal cual (PNG con transparencia o JPEG).
 * `sinFondo` dice si el resultado quedó recortado (siempre PNG).
 */
export async function logoDesdeOriginal(original: Buffer, modo: "auto" | "quitar" | "original"): Promise<{ logo: LogoNormalizado; fondo: FondoLogo; sinFondo: boolean; claro: boolean } | { error: string }> {
  const sharp = await sh();
  try {
    const { data, info } = await sharp(original, { limitInputPixels: LIMITE_PX })
      .resize({ width: LADO_ORIGINAL, height: LADO_ORIGINAL, fit: "inside", withoutEnlargement: true })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const r = quitarFondoRgba(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), info.width, info.height);
    const fondo: FondoLogo = r.estado;
    const claro = r.estado === "quitado" && r.claro;
    if (r.estado === "quitado" && (modo === "quitar" || (modo === "auto" && !r.claro))) {
      const logo = await codificar(
        () => sharp(r.datos, { raw: { width: r.ancho, height: r.alto, channels: 4 } }).resize({ width: LADO_MAX, height: LADO_MAX, fit: "inside", withoutEnlargement: true }),
        false,
      );
      return "error" in logo ? logo : { logo, fondo, sinFondo: true, claro };
    }
    const base = () => sharp(original, { limitInputPixels: LIMITE_PX }).resize({ width: LADO_MAX, height: LADO_MAX, fit: "inside", withoutEnlargement: true });
    const { isOpaque } = await base().stats();
    const logo = await codificar(base, isOpaque);
    return "error" in logo ? logo : { logo, fondo, sinFondo: false, claro };
  } catch {
    return { error: "No se pudo procesar la imagen: probá con otro archivo." };
  }
}
