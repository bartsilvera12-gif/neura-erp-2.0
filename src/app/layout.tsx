import type { Metadata, Viewport } from "next";
import type { CSSProperties } from "react";
import localFont from "next/font/local";
import { clienteConfig } from "@/cliente.config";
import "./globals.css";

/**
 * Fuente local, no `next/font/google`: con Google, `next build` descarga la fuente en medio del
 * build y en Coolify (varios builds a la vez) falla ("Failed to fetch `Plus Jakarta Sans`"). Es el
 * mismo archivo que sirve Google (latin, variable 300–800), igual que en sistemas-propio.
 */
const jakarta = localFont({
  src: "./fonts/plus-jakarta-sans-latin.woff2",
  variable: "--font-jakarta",
  weight: "300 800",
  display: "swap",
});

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
    // --brand = color del cliente (cliente.config): de acá lo heredan todas las pantallas del app.
    // El sidebar usa sus propias variables --zentra-* (identidad fija de Zentra), no --brand.
    <html lang="es" className={jakarta.variable} suppressHydrationWarning style={{ "--brand": clienteConfig.color } as CSSProperties}>
      <body>{children}</body>
    </html>
  );
}
