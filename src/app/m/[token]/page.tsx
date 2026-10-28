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
import { CABECERA, CHIP_NEUTRO, FONDO, LOGO, SUAVE, TARJETA, TEXTO } from "./estilos";

export const dynamic = "force-dynamic";

const traer = cache(async (token: string) => {
  try {
    return { menu: await menuPorToken(token), error: false };
  } catch {
    return { menu: null, error: true };
  }
});

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#ffffff" };

/**
 * Claro / oscuro antes de pintar (sin parpadeo): lo elegido en este celular o lo del sistema.
 * MenuCliente lo mantiene después (sol / luna de la cabecera).
 */
const SCRIPT_TEMA =
  "(function(){try{var t=localStorage.getItem('neura.qr.tema');var o=t?t==='oscuro':matchMedia('(prefers-color-scheme: dark)').matches;" +
  "document.documentElement.setAttribute('data-tema',o?'oscuro':'claro');var m=document.querySelector('meta[name=theme-color]');if(m)m.setAttribute('content',o?'#0a0c10':'#ffffff')}catch(e){}})()";
const Tema = () => <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />;

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
  if (!menu.activa && menu.sin_qr) {
    return (
      <Aviso logo={menu.logo_url} empresa={menu.empresa} titulo="Este local no está tomando pedidos por QR"
        texto="Por ahora no se reciben pedidos desde el celular. Pedile a quien te atiende." />
    );
  }
  if (!menu.activa) {
    return (
      <Aviso logo={menu.logo_url} empresa={menu.empresa} titulo={`${menu.mesa} no está tomando pedidos por QR`}
        texto="Por ahora esta mesa no recibe pedidos desde el celular. Pedile a quien te atiende." />
    );
  }
  return <><Tema /><MenuCliente token={token} menu={menu} color={clienteConfig.color} logoInstalacion={LOGO_INSTALACION} /></>;
}

function Aviso({ titulo, texto, logo, empresa }: { titulo: string; texto: string; logo?: string | null; empresa?: string }) {
  return (
    <div className={`flex min-h-dvh flex-col ${FONDO}`}>
      <Tema />
      <header className={`${CABECERA} border-b border-slate-200`}>
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo || LOGO_INSTALACION} alt="" className={`h-8 w-auto max-w-[120px] object-contain ${LOGO}`} />
          <p className={`truncate text-sm font-semibold ${TEXTO}`}>{empresa ?? clienteConfig.nombre}</p>
        </div>
      </header>
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
        <div className={`${TARJETA} px-6 py-12 text-center`}>
          <span className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${CHIP_NEUTRO}`}>
            <QrCode className="h-6 w-6" aria-hidden />
          </span>
          <h1 className={`mt-4 text-lg font-semibold ${TEXTO}`}>{titulo}</h1>
          <p className={`mx-auto mt-2 max-w-sm text-sm ${SUAVE}`}>{texto}</p>
        </div>
      </main>
    </div>
  );
}
