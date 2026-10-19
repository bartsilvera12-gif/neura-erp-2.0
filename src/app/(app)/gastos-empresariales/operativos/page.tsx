/**
 * /gastos-empresariales/operativos — ruta vieja de "Gastos operativos". Ahora los gastos y las
 * compras viven en UNA lista ("Compras y gastos", receta 59): redirige ahí con el filtro de
 * gastos (incluye las compras mixtas) y los mismos filtros que traía la URL (los usan el
 * Resumen y los recurrentes). ?ver=<gasto> abre ese gasto; ?nuevo=1 abre la carga de un gasto.
 */
import { redirect } from "next/navigation";

const PASAN = ["desde", "hasta", "sucursal", "categoria", "proveedor", "nombre", "tipo_costo", "deducible", "origen"];

export default async function OperativosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const uno = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);
  if (uno("nuevo") === "1") redirect("/compras/nueva?tipo=gasto");
  const p = new URLSearchParams();
  const ver = uno("ver");
  if (ver && /^[0-9a-f-]{36}$/i.test(ver)) {
    p.set("gasto", ver);
    p.set("desde", "");
    p.set("hasta", "");
  } else {
    p.set("tipo", "con_gasto");
    for (const k of PASAN) {
      const v = uno(k);
      if (v !== null) p.set(k, v);
    }
    const estado = uno("estado");
    if (estado) p.set("estado", estado === "confirmado" ? "vigente" : estado);
  }
  redirect(`/gastos-empresariales/compras-gastos?${p}`);
}
