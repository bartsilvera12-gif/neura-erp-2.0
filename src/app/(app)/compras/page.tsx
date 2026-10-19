/**
 * /compras — ruta vieja de la lista de compras. Las compras y los gastos ahora viven en UNA
 * lista ("Compras y gastos", receta 59): redirige ahí con el filtro de mercadería (incluye las
 * mixtas). /compras?ver=<id> (kardex, órdenes de compra, reportes, pagos) abre esa compra.
 * /compras/nueva, /compras/ordenes y /compras/pagos siguen siendo las mismas páginas.
 */
import { redirect } from "next/navigation";

export default async function ComprasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const uno = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const p = new URLSearchParams();
  const ver = uno("ver");
  if (/^[0-9a-f-]{36}$/i.test(ver)) {
    p.set("ver", ver);
    p.set("desde", "");
    p.set("hasta", "");
  } else {
    p.set("tipo", "con_mercaderia");
  }
  if (/^[0-9a-f-]{36}$/i.test(uno("proveedor"))) p.set("proveedor", uno("proveedor"));
  redirect(`/gastos-empresariales/compras-gastos?${p}`);
}
