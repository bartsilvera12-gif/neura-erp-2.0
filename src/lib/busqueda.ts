/**
 * Búsqueda INTELIGENTE en el navegador (regla de oro del 2.0), para listas que ya están
 * cargadas en pantalla. Mismas reglas que la búsqueda de la base (db/canonical/19_busqueda.sql):
 *   · ignora tildes y mayúsculas ("cafe" → "Café")
 *   · palabras en cualquier orden y partes de palabra ("coca 2" → "Coca-Cola 2L")
 *   · tolera errores de tipeo ("yerva" → "Yerba", "galeta" → "Galleta")
 *   · ignora separadores en códigos ("coccol2l" → "COC-COL-2L", RUC con o sin puntos)
 *   · relevancia: código exacto > nombre igual > empieza con > contiene > parecido
 */

/** Sin tildes y en minúsculas. */
export function normalizar(t: string | null | undefined): string {
  return (t ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Sin separadores: "COC-COL-2L" → "coccol2l". */
export function compactar(t: string | null | undefined): string {
  return normalizar(t).replace(/[^a-z0-9]+/g, "");
}

/** Palabras de lo que se escribió (máx. 8). */
export function tokensBusqueda(q: string): string[] {
  return normalizar(q).split(/[^a-z0-9]+/).filter(Boolean).slice(0, 8);
}

/** Distancia de edición (Damerau-Levenshtein simplificada) con corte temprano. */
function distancia(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2 = new Array(b.length + 1).fill(0);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let minFila = i;
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + costo);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < minFila) minFila = v;
    }
    if (minFila > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j];
    prev = cur;
  }
  return prev[b.length];
}

/** Trigramas como los de Postgres (pg_trgm): "  y", " ye", "yer", … */
function trigramas(p: string): Set<string> {
  const t = `  ${p} `;
  const r = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) r.add(t.slice(i, i + 3));
  return r;
}

/** Qué parte de los trigramas de la palabra escrita aparecen en otra (≈ word_similarity). */
function parecidoTrigramas(tok: string, palabra: string): number {
  const a = trigramas(tok);
  const b = trigramas(palabra);
  let comunes = 0;
  for (const x of a) if (b.has(x)) comunes++;
  return comunes / a.size;
}

/** Errores de tipeo tolerados según el largo de la palabra. */
const tolerancia = (n: number) => (n >= 8 ? 2 : n >= 4 ? 1 : 0);

/**
 * Qué tan bien coincide una palabra con el texto: 1 = contenida, 0.6 = parecida
 * (error de tipeo contra alguna palabra o el comienzo de una palabra), 0 = no.
 */
function coincidePalabra(tok: string, texto: string, palabras: string[]): number {
  if (texto.includes(tok)) return 1;
  // Los números (RUC, CI, teléfono, montos) no se "corrigen": tienen que coincidir.
  if (!/[a-z]/.test(tok)) return 0;
  const max = tolerancia(tok.length);
  if (!max) return 0;
  for (const p of palabras) {
    if (distancia(tok, p, max) <= max) return 0.6;
    // mismo criterio que la base: la mitad de los trigramas en común ("galeta" → "galletitas")
    if (parecidoTrigramas(tok, p) >= 0.5) return 0.5;
    // la palabra escrita puede ser el comienzo (con error) de una más larga: "galet" → "galletas"
    if (p.length > tok.length && [0, 1].some((extra) => distancia(tok, p.slice(0, tok.length + extra), max) <= max)) return 0.5;
  }
  return 0;
}

export type CamposBusqueda = {
  /** Lo que más importa (el nombre): define "igual" y "empieza con". */
  principal?: string | null;
  /** Otros campos donde buscar (SKU, categoría, RUC, teléfono…). */
  otros?: (string | number | null | undefined)[];
  /** Códigos que, si se escriben exactos (con o sin separadores), van primero. */
  codigos?: (string | null | undefined)[];
};

/** Puntaje de un elemento para la búsqueda (0 = no coincide). */
export function puntajeBusqueda(q: string, c: CamposBusqueda): number {
  const tokens = tokensBusqueda(q);
  if (!tokens.length) return 1;
  const qn = normalizar(q).trim();
  const qc = compactar(q);
  const principal = normalizar(c.principal);
  const partes = [c.principal, ...(c.otros ?? []), ...(c.codigos ?? [])].map((x) => (x == null ? "" : String(x)));
  const texto = partes.map((p) => `${normalizar(p)} ${compactar(p)}`).join(" ");
  if (qc && (c.codigos ?? []).some((cod) => cod && compactar(cod) === qc)) return 1000;

  const palabras = texto.split(/[^a-z0-9]+/).filter(Boolean);
  let suma = 0;
  for (const t of tokens) {
    const m = coincidePalabra(t, texto, palabras);
    if (!m) return 0; // todas las palabras tienen que aparecer (o parecerse)
    // palabra entera en el nombre > comienzo de una palabra > contenida > parecida
    suma += m === 1
      ? new RegExp(`(^|[^a-z0-9])${t}($|[^a-z0-9])`).test(principal) ? 40 : new RegExp(`(^|[^a-z0-9])${t}`).test(principal) ? 30 : 20
      : 10;
  }
  const frase = principal === qn ? 400 : principal.startsWith(qn) ? 300 : principal.includes(qn) ? 200 : 0;
  return frase + suma;
}

/** Filtra y ORDENA por relevancia (para buscadores donde lo más parecido va primero). */
export function buscar<T>(items: T[], q: string, campos: (it: T) => CamposBusqueda): T[] {
  if (!tokensBusqueda(q).length) return items;
  return items
    .map((it, i) => ({ it, i, p: puntajeBusqueda(q, campos(it)) }))
    .filter((x) => x.p > 0)
    .sort((a, b) => b.p - a.p || a.i - b.i)
    .map((x) => x.it);
}

/** Solo filtra, sin cambiar el orden (para tablas con su propio orden elegido). */
export function filtrar<T>(items: T[], q: string, campos: (it: T) => CamposBusqueda): T[] {
  if (!tokensBusqueda(q).length) return items;
  return items.filter((it) => puntajeBusqueda(q, campos(it)) > 0);
}

/** ¿Coincide? (para resaltar o mostrar/ocultar algo puntual). */
export function coincide(q: string, campos: CamposBusqueda): boolean {
  return puntajeBusqueda(q, campos) > 0;
}
