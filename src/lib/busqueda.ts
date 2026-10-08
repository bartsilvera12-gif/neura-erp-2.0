/**
 * Búsqueda INTELIGENTE en el navegador (regla de oro del 2.0), para listas que ya están
 * cargadas en pantalla. Mismas reglas que la búsqueda de la base (db/canonical/19_busqueda.sql):
 *   · ignora tildes y mayúsculas ("cafe" → "Café")
 *   · palabras en cualquier orden y partes de palabra ("coca 2" → "Coca-Cola 2L")
 *   · tolera errores de tipeo ("yerva" → "Yerba", "galeta" → "Galleta")
 *   · ignora separadores en códigos ("coccol2l" → "COC-COL-2L", RUC con o sin puntos)
 *   · relevancia: código exacto > nombre igual > empieza con > contiene > parecido
 *
 * Rendimiento: normalizar es lo caro. Cada elemento se normaliza UNA vez (cache por objeto
 * en buscar/filtrar, o un índice armado con `indexar` para listas grandes como el catálogo
 * de la caja) y cada consulta se compila UNA vez (palabras + regex), no por elemento.
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

// Filas de trabajo de `distancia`, reusadas entre llamadas (se llama miles de veces por tecla).
let filaA = new Int32Array(64);
let filaB = new Int32Array(64);
let filaC = new Int32Array(64);

/** Distancia de edición (Damerau-Levenshtein simplificada) con corte temprano. */
function distancia(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = b.length;
  if (filaA.length <= n) {
    filaA = new Int32Array(n + 1);
    filaB = new Int32Array(n + 1);
    filaC = new Int32Array(n + 1);
  }
  let prev2 = filaA;
  let prev = filaB;
  let cur = filaC;
  for (let j = 0; j <= n; j++) {
    prev2[j] = 0;
    prev[j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    const ai = a.charCodeAt(i - 1);
    cur[0] = i;
    let minFila = i;
    for (let j = 1; j <= n; j++) {
      const costo = ai === b.charCodeAt(j - 1) ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + costo);
      if (i > 1 && j > 1 && ai === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < minFila) minFila = v;
    }
    if (minFila > max) return max + 1;
    // la fila de hace dos pasa a ser la de trabajo; las otras corren un lugar
    const libre = prev2;
    prev2 = prev;
    prev = cur;
    cur = libre;
  }
  return prev[n];
}

/** Trigramas como los de Postgres (pg_trgm): "  y", " ye", "yer", … */
function trigramas(p: string): Set<string> {
  const t = `  ${p} `;
  const r = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) r.add(t.slice(i, i + 3));
  return r;
}

// Los trigramas de las palabras del texto se repiten entre consultas: se recuerdan.
const trigramasPalabra = new Map<string, Set<string>>();
function trigramasDe(p: string): Set<string> {
  let r = trigramasPalabra.get(p);
  if (!r) {
    if (trigramasPalabra.size >= 50_000) trigramasPalabra.clear();
    trigramasPalabra.set(p, (r = trigramas(p)));
  }
  return r;
}

/** Qué parte de los trigramas de la palabra escrita (a) aparecen en otra (b) (≈ word_similarity). */
function parecidoTrigramas(a: Set<string>, b: Set<string>): number {
  let comunes = 0;
  for (const x of a) if (b.has(x)) comunes++;
  return comunes / a.size;
}

/** Errores de tipeo tolerados según el largo de la palabra. */
const tolerancia = (n: number) => (n >= 8 ? 2 : n >= 4 ? 1 : 0);

export type CamposBusqueda = {
  /** Lo que más importa (el nombre): define "igual" y "empieza con". */
  principal?: string | null;
  /** Otros campos donde buscar (SKU, categoría, RUC, teléfono…). */
  otros?: (string | number | null | undefined)[];
  /** Códigos que, si se escriben exactos (con o sin separadores), van primero. */
  codigos?: (string | null | undefined)[];
};

// ── Pre-cálculo ──────────────────────────────────────────────────────────────

/** Un elemento ya normalizado, listo para puntuar contra cualquier consulta. */
type Preparado = {
  principal: string;
  texto: string;
  /** Palabras del texto sin repetir (la repetida daría lo mismo que la primera). */
  palabras: string[];
  /** Códigos compactados (para "código exacto va primero"). */
  codigos: string[];
};

function preparar(c: CamposBusqueda): Preparado {
  const principal = normalizar(c.principal);
  const partes = [c.principal, ...(c.otros ?? []), ...(c.codigos ?? [])].map((x) => (x == null ? "" : String(x)));
  const texto = partes.map((p) => `${normalizar(p)} ${compactar(p)}`).join(" ");
  const palabras = [...new Set(texto.split(/[^a-z0-9]+/).filter(Boolean))];
  const codigos: string[] = [];
  for (const cod of c.codigos ?? []) if (cod) codigos.push(compactar(cod));
  return { principal, texto, palabras, codigos };
}

type Token = {
  t: string;
  /** Errores de tipeo tolerados (0 = tiene que estar tal cual). */
  max: number;
  trig: Set<string> | null;
  /** Parecido ya calculado contra cada palabra: en un catálogo las palabras se repiten
   *  mucho entre elementos, así cada una se compara una sola vez por consulta. */
  memo: Map<string, number>;
  entera: RegExp;
  inicio: RegExp;
};

/** Lo escrito, compilado una vez: palabras (con sus regex), frase y código. */
type Consulta = { tokens: Token[]; qn: string; qc: string };

function compilar(q: string): Consulta {
  const tokens = tokensBusqueda(q).map((t): Token => {
    // Los números (RUC, CI, teléfono, montos) no se "corrigen": tienen que coincidir.
    const max = /[a-z]/.test(t) ? tolerancia(t.length) : 0;
    return {
      t,
      max,
      trig: max ? trigramas(t) : null,
      memo: new Map(),
      // t solo tiene [a-z0-9] (sale de tokensBusqueda): es seguro dentro de la regex.
      entera: new RegExp(`(^|[^a-z0-9])${t}($|[^a-z0-9])`),
      inicio: new RegExp(`(^|[^a-z0-9])${t}`),
    };
  });
  return { tokens, qn: normalizar(q).trim(), qc: compactar(q) };
}

/**
 * Qué tan bien coincide una palabra con el texto: 1 = contenida, 0.6 = parecida
 * (error de tipeo contra alguna palabra o el comienzo de una palabra), 0 = no.
 */
function coincidePalabra(tok: Token, e: Preparado): number {
  if (e.texto.includes(tok.t)) return 1;
  if (!tok.max) return 0;
  for (const p of e.palabras) {
    let v = tok.memo.get(p);
    if (v === undefined) tok.memo.set(p, (v = parecida(tok, p)));
    if (v) return v;
  }
  return 0;
}

/** Parecido de la palabra escrita con UNA palabra del texto: 0.6, 0.5 o 0. */
function parecida(tok: Token, p: string): number {
  const { t, max } = tok;
  if (distancia(t, p, max) <= max) return 0.6;
  // mismo criterio que la base: la mitad de los trigramas en común ("galeta" → "galletitas")
  if (parecidoTrigramas(tok.trig!, trigramasDe(p)) >= 0.5) return 0.5;
  // la palabra escrita puede ser el comienzo (con error) de una más larga: "galet" → "galletas"
  if (p.length > t.length && (distancia(t, p.slice(0, t.length), max) <= max || distancia(t, p.slice(0, t.length + 1), max) <= max)) return 0.5;
  return 0;
}

/** Puntaje de un elemento preparado contra una consulta compilada (0 = no coincide). */
function puntaje(cq: Consulta, e: Preparado): number {
  if (!cq.tokens.length) return 1;
  if (cq.qc && e.codigos.includes(cq.qc)) return 1000;

  let suma = 0;
  for (const tok of cq.tokens) {
    const m = coincidePalabra(tok, e);
    if (!m) return 0; // todas las palabras tienen que aparecer (o parecerse)
    // palabra entera en el nombre > comienzo de una palabra > contenida > parecida
    suma += m === 1 ? (tok.entera.test(e.principal) ? 40 : tok.inicio.test(e.principal) ? 30 : 20) : 10;
  }
  const { qn } = cq;
  const frase = e.principal === qn ? 400 : e.principal.startsWith(qn) ? 300 : e.principal.includes(qn) ? 200 : 0;
  return frase + suma;
}

// Cache por objeto para buscar/filtrar: el mismo elemento no se re-normaliza en cada tecla.
// La clave son los textos crudos: si el objeto cambió (o se busca con otros campos) se
// vuelve a preparar, así el resultado es siempre idéntico al de sin cache.
const SEP = "\u0001";
const cache = new WeakMap<object, { clave: string; e: Preparado }>();

function claveDe(c: CamposBusqueda): string {
  const s = (x: unknown) => (x == null ? "" : String(x));
  return [s(c.principal), (c.otros ?? []).map(s).join(SEP), (c.codigos ?? []).map(s).join(SEP)].join(`${SEP}${SEP}`);
}

function preparado<T>(it: T, campos: (it: T) => CamposBusqueda): Preparado {
  const c = campos(it);
  if (typeof it !== "object" || it === null) return preparar(c);
  const clave = claveDe(c);
  const hit = cache.get(it);
  if (hit && hit.clave === clave) return hit.e;
  const e = preparar(c);
  cache.set(it, { clave, e });
  return e;
}

function ordenar<T>(items: T[], cq: Consulta, prep: (it: T, i: number) => Preparado, limite?: number): T[] {
  const r: { it: T; i: number; p: number }[] = [];
  for (let i = 0; i < items.length; i++) {
    const p = puntaje(cq, prep(items[i], i));
    if (p > 0) r.push({ it: items[i], i, p });
  }
  r.sort((a, b) => b.p - a.p || a.i - b.i);
  const out = r.map((x) => x.it);
  return limite != null ? out.slice(0, limite) : out;
}

/** Puntaje de un elemento para la búsqueda (0 = no coincide). */
export function puntajeBusqueda(q: string, c: CamposBusqueda): number {
  const cq = compilar(q);
  if (!cq.tokens.length) return 1;
  return puntaje(cq, preparar(c));
}

/** Filtra y ORDENA por relevancia (para buscadores donde lo más parecido va primero). */
export function buscar<T>(items: T[], q: string, campos: (it: T) => CamposBusqueda): T[] {
  const cq = compilar(q);
  if (!cq.tokens.length) return items;
  return ordenar(items, cq, (it) => preparado(it, campos));
}

/** Solo filtra, sin cambiar el orden (para tablas con su propio orden elegido). */
export function filtrar<T>(items: T[], q: string, campos: (it: T) => CamposBusqueda): T[] {
  const cq = compilar(q);
  if (!cq.tokens.length) return items;
  return items.filter((it) => puntaje(cq, preparado(it, campos)) > 0);
}

/** ¿Coincide? (para resaltar o mostrar/ocultar algo puntual). */
export function coincide(q: string, campos: CamposBusqueda): boolean {
  return puntajeBusqueda(q, campos) > 0;
}

// ── Índice: listas grandes que se buscan en cada tecla (ej. el catálogo de la caja) ──

/** Lista normalizada una sola vez. Armala con useMemo (se rehace solo si cambia la lista). */
export type IndiceBusqueda<T> = { items: T[]; preparados: Preparado[] };

export function indexar<T>(items: T[], campos: (it: T) => CamposBusqueda): IndiceBusqueda<T> {
  return { items, preparados: items.map((it) => preparar(campos(it))) };
}

/** Igual que `buscar` (mismos resultados, mismo orden) pero sobre un índice; `limite` recorta. */
export function buscarEnIndice<T>(indice: IndiceBusqueda<T>, q: string, limite?: number): T[] {
  const cq = compilar(q);
  if (!cq.tokens.length) return limite != null ? indice.items.slice(0, limite) : indice.items;
  return ordenar(indice.items, cq, (_it, i) => indice.preparados[i], limite);
}
