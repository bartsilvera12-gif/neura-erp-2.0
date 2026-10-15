/** Compras, Órdenes de compra y Pagos a proveedores viven en Gastos empresariales (mismas URLs). */
import { PestanasGastos } from "@/modules/gastos/Pestanas";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PestanasGastos />
      {children}
    </>
  );
}
