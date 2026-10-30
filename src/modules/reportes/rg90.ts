/**
 * Registro de comprobantes — RG 90/2021 (recetas 100 y 102). Tipos y armado del archivo de
 * importación de Marangatu según la "Especificación Técnica para Importación" de la SET (jun-2021):
 *   · .TXT delimitado por TABULACIONES, UTF-8, SIN fila de títulos, dentro de un .ZIP con el mismo
 *     nombre: <RUC sin DV>_REG_<MMAAAA>_<id de hasta 5>  (obligación 955, registro mensual).
 *   · máximo 5.000 filas por archivo (si hay más, varias partes).
 *   · ventas = tipo de registro 1, 19 campos en orden (ver lineaVenta).
 *   · compras = tipo de registro 2, 20 campos en orden (ver lineaCompra).
 *   · los dos tipos pueden ir en el mismo archivo.
 * Las filas con `problemas` NO van al archivo: primero se corrigen en el ERP.
 */

export type FilaRg90 = {
  origen: "compra" | "gasto" | "venta" | "nota_credito";
  id: string;
  documento: string;
  fecha: string;
  /** Proveedor en las compras; cliente en las ventas. */
  proveedor: string | null;
  ruc: string | null;
  tipo_comprobante: string;
  codigo: number;
  tipo_ident: number | null;
  ident: string;
  timbrado: string;
  numero: string;
  gravado_10: number;
  gravado_5: number;
  exento: number;
  total: number;
  condicion: 1 | 2;
  moneda_extranjera: boolean;
  iva_credito: number;
  /** Nota de crédito: la factura que corrige. */
  asociado?: string | null;
  timbrado_asociado?: string | null;
  problemas: string[];
};

/** `manual`: no entra al archivo pero hay que registrarlo a mano en Marangatu. */
export type ExcluidoRg90 = { origen: string; id: string; documento: string; fecha: string; proveedor: string | null; tipo_comprobante: string | null; total: number; motivo: string; manual?: boolean };

export type Rg90 = { ruc: string | null; desde: string; hasta: string; filas: FilaRg90[]; excluidos: ExcluidoRg90[] };

/** A qué impuestos se imputan los comprobantes (lo que liquida la empresa). */
export type Imputacion = { iva: boolean; ire: boolean; irp: boolean };

export const MAX_FILAS = 5000;

/** "2026-10" → { desde: "2026-10-01", hasta: "2026-10-31" } (o null si no es un mes válido). */
export function rangoMes(mes: string | null) {
  if (!mes || !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return null;
  const [a, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, "0")}` };
}

const fechaSet = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const sn = (b: boolean) => (b ? "S" : "N");
/** Tabulador / saltos de línea fuera de los textos (romperían las columnas). */
const limpio = (t: string | null | undefined) => (t ?? "").replace(/[\t\r\n]+/g, " ").trim();

export const esVenta = (f: Pick<FilaRg90, "origen">) => f.origen === "venta" || f.origen === "nota_credito";

/** Imputación de UN comprobante: en compras, el IVA solo si tiene IVA crédito; tiene que quedar al menos una. */
export function imputacionFila(f: FilaRg90, imp: Imputacion): Imputacion & { ok: boolean } {
  const r = { iva: imp.iva && (esVenta(f) || f.iva_credito > 0), ire: imp.ire, irp: imp.irp };
  return { ...r, ok: r.iva || r.ire || r.irp };
}

/** Una fila de VENTAS (tipo 1) con los 19 campos de la especificación, separados por tab. */
export function lineaVenta(f: FilaRg90, imp: Imputacion): string {
  const i = imputacionFila(f, imp);
  const campos = [
    "1",                                                   // 1 tipo de registro
    String(f.tipo_ident ?? 15),                            // 2 tipo de identificación del comprador
    f.ident,                                               // 3 número (RUC sin DV)
    f.tipo_ident === 11 || f.tipo_ident === 12 || f.tipo_ident === 15 ? "" : limpio(f.proveedor), // 4 nombre (no va con RUC / CI / sin nombre)
    String(f.codigo),                                      // 5 tipo de comprobante (109 factura, 110 nota de crédito)
    fechaSet(f.fecha),                                     // 6 fecha dd/mm/aaaa
    f.timbrado,                                            // 7 timbrado
    f.numero,                                              // 8 número ###-###-#######
    String(f.gravado_10),                                  // 9 gravado 10 % (IVA incluido)
    String(f.gravado_5),                                   // 10 gravado 5 % (IVA incluido)
    String(f.exento),                                      // 11 exento
    String(f.total),                                       // 12 total
    String(f.condicion),                                   // 13 condición 1 contado / 2 crédito
    sn(f.moneda_extranjera),                               // 14 moneda extranjera
    sn(i.iva),                                             // 15 imputa IVA
    sn(i.ire),                                             // 16 imputa IRE
    sn(i.irp),                                             // 17 imputa IRP-RSP
    f.asociado ?? "",                                      // 18 comprobante asociado (nota de crédito)
    f.timbrado_asociado ?? "",                             // 19 timbrado asociado
  ];
  return campos.join("\t");
}

/** La línea del archivo según el tipo de comprobante. */
export const lineaArchivo = (f: FilaRg90, imp: Imputacion) => (esVenta(f) ? lineaVenta(f, imp) : lineaCompra(f, imp));

/** Una fila de COMPRAS (tipo 2) con los 20 campos de la especificación, separados por tab. */
export function lineaCompra(f: FilaRg90, imp: Imputacion): string {
  const i = imputacionFila(f, imp);
  const campos = [
    "2",                                                   // 1 tipo de registro
    String(f.tipo_ident ?? 11),                            // 2 tipo de identificación del proveedor
    f.ident,                                               // 3 número (RUC sin DV)
    f.tipo_ident === 11 || f.tipo_ident === 12 ? "" : limpio(f.proveedor), // 4 nombre (no va con RUC / CI)
    String(f.codigo),                                      // 5 tipo de comprobante (Tabla 4)
    fechaSet(f.fecha),                                     // 6 fecha dd/mm/aaaa
    f.timbrado,                                            // 7 timbrado
    f.numero,                                              // 8 número ###-###-#######
    String(f.gravado_10),                                  // 9 gravado 10 % (IVA incluido)
    String(f.gravado_5),                                   // 10 gravado 5 % (IVA incluido)
    String(f.exento),                                      // 11 exento
    String(f.total),                                       // 12 total
    String(f.condicion),                                   // 13 condición 1 contado / 2 crédito
    sn(f.moneda_extranjera),                               // 14 moneda extranjera
    sn(i.iva),                                             // 15 imputa IVA
    sn(i.ire),                                             // 16 imputa IRE
    sn(i.irp),                                             // 17 imputa IRP-RSP
    "N",                                                   // 18 no imputa
    "",                                                    // 19 comprobante asociado (NC / ND)
    "",                                                    // 20 timbrado asociado
  ];
  return campos.join("\t");
}

/** Las filas que entran al archivo (sin problemas y con al menos una imputación). */
export function filasParaArchivo(d: Rg90, imp: Imputacion): FilaRg90[] {
  return d.filas.filter((f) => !f.problemas.length && imputacionFila(f, imp).ok);
}

/** "80012345-0" → "80012345". */
export const rucSinDv = (ruc: string | null | undefined) => (ruc ?? "").split("-")[0].replace(/\D/g, "");

/**
 * Nombre del archivo (sin extensión): <RUC>_REG_<MMAAAA>_<id>. El id (hasta 5) cambia en cada
 * descarga: Marangatu pide uno distinto por archivo del mismo período.
 */
export function nombreArchivo(ruc: string, mes: string, parte: number, ahora = new Date()): string {
  const [a, m] = mes.split("-");
  const sello = Math.floor(ahora.getTime() / 1000).toString(36).slice(-3).toUpperCase();
  return `${rucSinDv(ruc)}_REG_${m}${a}_C${sello}${Math.min(parte, 9)}`;
}
