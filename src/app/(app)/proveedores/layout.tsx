/** Proveedores vive en Gastos empresariales (misma URL). */
import { PestanasGastos } from "@/modules/gastos/Pestanas";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PestanasGastos />
      {children}
    </>
  );
}
