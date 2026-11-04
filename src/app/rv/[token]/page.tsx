/**
 * /rv/<token> — Punto de venta del vendedor de sorteos (receta 123). Sin cuenta del ERP: el link que le
 * da el administrador (Sorteos → Vendedores) + su PIN. Vende en efectivo (queda confirmada y la rinde
 * después) o por transferencia (queda para revisar). No se indexa.
 */
import type { Metadata, Viewport } from "next";
import { Ticket } from "lucide-react";
import { clienteConfig } from "@/cliente.config";
import { TOKEN_RE } from "@/modules/sorteos/publico";
import { PuntoVenta } from "./PuntoVenta";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Punto de venta", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#ffffff" };

export default async function PuntoVentaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) {
    return (
      <div className="grid min-h-dvh place-items-center bg-slate-50 px-4">
        <div className="max-w-sm rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400"><Ticket className="h-6 w-6" /></span>
          <h1 className="mt-4 text-lg font-semibold text-slate-900">Este link no es válido</h1>
          <p className="mt-2 text-sm text-slate-500">Pedile el link del punto de venta a quien administra los sorteos.</p>
        </div>
      </div>
    );
  }
  return <PuntoVenta token={token} color={clienteConfig.color} empresa={clienteConfig.nombre} />;
}
