import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Neura ERP",
  description: "ERP de Neura",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
