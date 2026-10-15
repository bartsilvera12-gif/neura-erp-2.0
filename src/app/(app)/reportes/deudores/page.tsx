import { redirect } from "next/navigation";

/** "Deudores" quedó unificado en Cuentas por cobrar (mismo dato, más completo). */
export default function Page() {
  redirect("/reportes/cuentas-cobrar");
}
