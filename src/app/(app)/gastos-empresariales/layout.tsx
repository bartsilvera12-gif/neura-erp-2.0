import { PestanasGastos } from "@/modules/gastos/Pestanas";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PestanasGastos />
      {children}
    </>
  );
}
