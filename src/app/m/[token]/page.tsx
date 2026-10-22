/**
 * Menú público de una mesa: /m/<token> (lo abre el cliente escaneando el QR de la mesa, sin
 * cuenta). Muestra SOLO lo que devuelve mesa_menu_publico (receta 68): la mesa, la empresa y los
 * productos "En el menú QR". El pedido y su estado van por /api/publico/mesas/<token>.
 * Fuera del layout autenticado (no pasa por el guard de (app)).
 */
import type { Metadata, Viewport } from "next";
import { cache } from "react";
import { QrCode } from "lucide-react";
import { clienteConfig } from "@/cliente.config";
import { LOGO_INSTALACION } from "@/modules/empresa/tipos";
import { menuPorToken } from "@/modules/mesas/publico";
import { MenuCliente } from "./MenuCliente";

export const dynamic = "force-dynamic";

const traer = cache(async (token: string) => {
  try {
    return { menu: await menuPorToken(token), error: false };
  } catch {
    return { menu: null, error: true };
  }
});

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#ffffff" };

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const { menu } = await traer(token);
  return {
    title: menu ? `${menu.mesa} · Menú de ${menu.empresa}` : `Menú · ${clienteConfig.nombre}`,
    robots: { index: false, follow: false },
  };
}

export default async function MenuMesaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { menu, error } = await traer(token);

  if (error) {
    return <Aviso titulo="No pudimos cargar el menú" texto="Probá de nuevo en un momento. Si sigue sin andar, pedile a quien te atiende." />;
  }
  if (!menu) {
    return <Aviso titulo="Este QR no es válido" texto="El código no corresponde a ninguna mesa o ya fue reemplazado. Pedile a quien te atiende el QR actualizado de tu mesa." />;
  }
  if (!menu.activa) {
    return (
      <Aviso logo={menu.logo_url} empresa={menu.empresa} titulo={`${menu.mesa} no está tomando pedidos por QR`}
        texto="Por ahora esta mesa no recibe pedidos desde el celular. Pedile a quien te atiende." />
    );
  }
  return <MenuCliente token={token} menu={menu} color={clienteConfig.color} logoInstalacion={LOGO_INSTALACION} />;
}

function Aviso({ titulo, texto, logo, empresa }: { titulo: string; texto: string; logo?: string | null; empresa?: string }) {
  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <header className="pt-safe border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo || LOGO_INSTALACION} alt="" className="h-8 w-auto max-w-[120px] object-contain" />
          <p className="truncate text-sm font-semibold text-slate-900">{empresa ?? clienteConfig.nombre}</p>
        </div>
      </header>
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <QrCode className="h-6 w-6" aria-hidden />
          </span>
          <h1 className="mt-4 text-lg font-semibold text-slate-900">{titulo}</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">{texto}</p>
        </div>
      </main>
    </div>
  );
}
