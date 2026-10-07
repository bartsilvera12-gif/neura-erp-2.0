import type { NextConfig } from "next";
// output standalone + sin telemetría (heredado de la infra probada de ARG).
// devIndicators:false oculta el botón flotante de Next en desarrollo.
const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: false,
  // jsPDF se usa en rutas del servidor (PDF de arqueo): se carga de node_modules sin empaquetar.
  serverExternalPackages: ["jspdf", "jspdf-autotable"],
};
export default nextConfig;
