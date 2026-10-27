/**
 * Código de barras Code 128 (juego B) como SVG, sin dependencias. Puro: sirve en el servidor y en
 * el navegador. Lo usa el comprobante del pedido de mostrador (receta 77) para que la caja lo
 * escanee con el lector (el lector "tipea" el texto y Enter en el buscador de la caja).
 */

// Anchos barra/espacio de cada símbolo (0–105) y el de parada (106). Cada símbolo suma 11 módulos.
const PATRONES = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];
const START_B = 104;
const STOP = 106;
const QUIET = 10;

/** Símbolos del texto en Code 128 B (ASCII 32–126), con inicio, dígito verificador y parada. */
export function simbolosCode128(texto: string): number[] {
  const valores = [...texto].map((c) => {
    const n = c.charCodeAt(0);
    if (n < 32 || n > 126) throw new Error(`Carácter no soportado en Code 128 B: ${JSON.stringify(c)}`);
    return n - 32;
  });
  const check = valores.reduce((s, v, i) => s + v * (i + 1), START_B) % 103;
  return [START_B, ...valores, check, STOP];
}

/**
 * SVG del código (barras negras sobre fondo blanco, con zona de silencio). `alto` en módulos.
 * El SVG escala al ancho del contenedor (width 100%) manteniendo las proporciones.
 */
export function svgCode128(texto: string, { alto = 50, titulo }: { alto?: number; titulo?: string } = {}): string {
  const simbolos = simbolosCode128(texto);
  let x = QUIET;
  const barras: string[] = [];
  for (const s of simbolos) {
    const p = PATRONES[s];
    for (let i = 0; i < p.length; i++) {
      const w = Number(p[i]);
      if (i % 2 === 0) barras.push(`<rect x="${x}" y="0" width="${w}" height="${alto}"/>`);
      x += w;
    }
  }
  const ancho = x + QUIET;
  const t = (titulo ?? texto).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ancho} ${alto}" width="100%" preserveAspectRatio="none" shape-rendering="crispEdges" role="img" aria-label="${t}" style="display:block;height:auto;aspect-ratio:${ancho}/${alto}"><rect width="${ancho}" height="${alto}" fill="#fff"/><g fill="#000">${barras.join("")}</g></svg>`;
}
