/**
 * /t/<token> — Link privado de una compra de sorteo (receta 123). Según el estado: datos para
 * transferir y subir el comprobante, "lo estamos revisando", el TICKET con los números, o por qué se
 * rechazó / venció. Quien tenga el link ve la compra: no se indexa y no muestra la cédula.
 */
import type { Metadata, Viewport } from "next";
import { Ticket } from "lucide-react";
import { clienteConfig } from "@/cliente.config";
import { compraPublica } from "@/modules/sorteos/publico";
import { Compra } from "./Compra";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tu compra", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#ffffff" };

export default async function CompraPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let c = null;
  let error = false;
  try {
    c = await compraPublica(token);
  } catch {
    error = true;
  }
  if (!c) {
    return (
      <div className="grid min-h-dvh place-items-center bg-slate-50 px-4">
        <div className="max-w-sm rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400"><Ticket className="h-6 w-6" /></span>
          <h1 className="mt-4 text-lg font-semibold text-slate-900">{error ? "No pudimos cargar tu compra" : "No encontramos esta compra"}</h1>
          <p className="mt-2 text-sm text-slate-500">{error ? "Probá de nuevo en un momento." : "Revisá que el link esté completo."}</p>
        </div>
      </div>
    );
  }
  return <Compra token={token} inicial={c} color={clienteConfig.color} />;
}
