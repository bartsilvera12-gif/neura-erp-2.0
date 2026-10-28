import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta" });

export const metadata: Metadata = {
  title: "Neura ERP",
  description: "ERP de Neura",
};

// Viewport móvil: ancho del dispositivo, SIN bloquear el zoom (accesibilidad), `viewport-fit=cover`
// para que las barras fijas usen env(safe-area-inset-*) en iPhone con notch, y el teclado en
// pantalla achica el viewport en Chrome Android (interactive-widget), así los pies de los modales
// quedan a la vista. En iOS (que lo ignora) lo resuelve CapaModal con visualViewport.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#0b3a3d",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: el menú QR (/m/<token>) pone data-tema="oscuro" en <html> antes de hidratar.
    <html lang="es" className={jakarta.variable} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
