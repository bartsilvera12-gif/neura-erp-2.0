#!/usr/bin/env node
/**
 * Pruebas de plata y stock: junta db/pruebas/*.sql y las corre en la base del servidor por SSH, en una
 * transacción que termina en ROLLBACK. Sale con error si alguna falla, para poder frenar un despliegue.
 *
 *   npm run test:db            solo el resumen y lo que falló
 *   npm run test:db -- -v      además cada prueba que pasó
 *
 * PRUEBAS_SSH (zentra-app) y PRUEBAS_SCHEMA (erp_demo) cambian dónde corre.
 */
import { errorRemoto, psqlRemoto } from "./remoto.mjs";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const carpeta = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "pruebas");
const ssh = process.env.PRUEBAS_SSH || "zentra-app";
const schema = process.env.PRUEBAS_SCHEMA || "erp_demo";
const detallado = process.argv.includes("-v");

const archivos = readdirSync(carpeta).filter((f) => f.endsWith(".sql")).sort();
const sql = archivos.map((f) => readFileSync(join(carpeta, f), "utf8")).join("\n");

// La garantía de que no queda nada: una sola transacción y sin commit en ningún lado.
if (/^\s*commit\b/im.test(sql)) {
  console.error("Hay un commit en db/pruebas: las pruebas no pueden guardar nada.");
  process.exit(2);
}
if (!/rollback;\s*$/i.test(sql.trim())) {
  console.error("Las pruebas tienen que terminar en rollback.");
  process.exit(2);
}

const r = psqlRemoto(ssh, sql, { salida: "q", schema });
if (r.error || (r.status !== 0 && !/PRUEBA\|/.test(`${r.stdout}${r.stderr}`))) {
  console.error(`No se pudo correr en ${ssh}: ${errorRemoto(r, ssh)}`);
  process.exit(2);
}

const salida = `${r.stdout}\n${r.stderr}`;
const resultados = [...salida.matchAll(/PRUEBA\|(OK|FALLA)\|([^|\r\n]*)\|(.*)/g)].map((m) => ({ estado: m[1], nombre: m[2], detalle: m[3] }));
const fallas = resultados.filter((x) => x.estado === "FALLA");
const oks = resultados.length - fallas.length;

if (detallado) for (const x of resultados) if (x.estado === "OK") console.log(`  ok    ${x.nombre}`);
for (const x of fallas) console.log(`  FALLA ${x.nombre}\n        ${x.detalle}`);

if (r.status !== 0) {
  console.error(`\nLas pruebas se cortaron antes de terminar (nada quedó guardado):\n${r.stderr.split("\n").filter((l) => !l.includes("PRUEBA|")).join("\n")}`);
  process.exit(2);
}
if (!resultados.length) {
  console.error("No corrió ninguna prueba.");
  process.exit(2);
}
console.log(`\n${oks} pasaron, ${fallas.length} fallaron (${schema}, sin dejar datos).`);
process.exit(fallas.length ? 1 : 0);
