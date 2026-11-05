/**
 * /a/<token> — El alumno con SU link (receta 155): reserva, cancela y marca su asistencia sin cuenta del ERP.
 * El link viejo de la empresa (receta 153, el QR impreso) ya no marca: lleva al link guardado en el
 * celular o pide el suyo en recepción. No se indexa.
 */
import type { Metadata, Viewport } from "next";
import { CalendarCheck } from "lucide-react";
import { clienteConfig } from "@/cliente.config";
import { clientePublico } from "@/lib/supabase/publico";
import { TOKEN_RE } from "@/modules/sorteos/publico";
import { MiAsistencia } from "./MiAsistencia";
import { LinkGuardado } from "./LinkGuardado";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Mi asistencia", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#ffffff" };

function Aviso({ titulo, texto, children }: { titulo: string; texto: string; children?: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-slate-50 px-4">
      <div className="max-w-sm rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400"><CalendarCheck className="h-6 w-6" /></span>
        <h1 className="mt-4 text-lg font-semibold text-slate-900">{titulo}</h1>
        <p className="mt-2 text-sm text-slate-500">{texto}</p>
        {children}
      </div>
    </div>
  );
}

export default async function MiAsistenciaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invalido = <Aviso titulo="Este link no es válido" texto="Pedí en recepción tu link para reservar y marcar tu asistencia." />;
  if (!TOKEN_RE.test(token)) return invalido;
  const { data } = await clientePublico().rpc("gim_publico_info", { p_token: token });
  const info = data as { tipo: "alumno" | "empresa"; empresa: string } | null;
  if (!info) return invalido;
  if (info.tipo === "empresa") {
    return (
      <Aviso titulo="Ahora cada alumno tiene su link" texto="Con tu link reservás tus clases y marcás tu asistencia desde donde estés. Pedíselo a recepción y te lo mandan por WhatsApp.">
        <LinkGuardado />
      </Aviso>
    );
  }
  return <MiAsistencia token={token} empresa={info.empresa || clienteConfig.nombre} color={clienteConfig.color} />;
}
