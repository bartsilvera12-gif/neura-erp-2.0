import { redirect } from "next/navigation";

/**
 * /gastos-empresariales — el Resumen de gastos pasó a Reportes (/reportes/gastos). Esta ruta
 * queda para los links viejos: redirige con los mismos filtros (?desde&hasta).
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const k of ["desde", "hasta"]) {
    const v = sp[k];
    if (typeof v === "string" && v) q.set(k, v);
  }
  redirect(`/reportes/gastos${q.size ? `?${q}` : ""}`);
}
