/** Número en letras para recibos: 1.250.000 → "un millón doscientos cincuenta mil". */
const UNIDADES = ["", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece",
  "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós", "veintitrés",
  "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"];
const DECENAS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const CENTENAS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];

function hasta999(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cien";
  const c = Math.floor(n / 100);
  const r = n % 100;
  let txt = CENTENAS[c];
  if (r) {
    const dec = r < 30 ? UNIDADES[r] : `${DECENAS[Math.floor(r / 10)]}${r % 10 ? ` y ${UNIDADES[r % 10]}` : ""}`;
    txt = `${txt} ${dec}`.trim();
  }
  return txt;
}

export function numeroEnLetras(valor: number): string {
  let n = Math.round(Math.abs(valor));
  if (n === 0) return "cero";
  const partes: string[] = [];
  const millones = Math.floor(n / 1_000_000);
  n %= 1_000_000;
  const miles = Math.floor(n / 1000);
  const resto = n % 1000;
  if (millones) partes.push(millones === 1 ? "un millón" : `${hasta999(millones).replace(/veintiuno$/, "veintiún").replace(/uno$/, "un")} millones`);
  if (miles) partes.push(miles === 1 ? "mil" : `${hasta999(miles).replace(/veintiuno$/, "veintiún").replace(/uno$/, "un")} mil`);
  if (resto) partes.push(hasta999(resto));
  return partes.join(" ");
}
