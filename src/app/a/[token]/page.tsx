/**
 * /a/<token> — El alumno marca su asistencia solo (receta 153). Sin cuenta del ERP: el link (o el QR
 * impreso en la entrada) + su CI + el PIN que le dio la recepción. No se indexa.
 */
import type { Metadata, Viewport } from "next";
import { CalendarCheck } from "lucide-react";
import { clienteConfig } from "@/cliente.config";
import { clientePublico } from "@/lib/supabase/publico";
import { TOKEN_RE } from "@/modules/sorteos/publico";
import { MarcarAsistencia } from "./MarcarAsistencia";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Marcar asistencia", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#ffffff" };

function Invalido() {
  return (
    <div className="grid min-h-dvh place-items-center bg-slate-50 px-4">
      <div className="max-w-sm rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400"><CalendarCheck className="h-6 w-6" /></span>
        <h1 className="mt-4 text-lg font-semibold text-slate-900">Este link no es válido</h1>
        <p className="mt-2 text-sm text-slate-500">Pedí el link o el QR para marcar tu asistencia en recepción.</p>
      </div>
    </div>
  );
}

export default async function MarcarAsistenciaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) return <Invalido />;
  const { data } = await clientePublico().rpc("gim_publico_info", { p_token: token });
  const info = data as { empresa: string } | null;
  if (!info) return <Invalido />;
  return <MarcarAsistencia token={token} empresa={info.empresa || clienteConfig.nombre} color={clienteConfig.color} />;
}