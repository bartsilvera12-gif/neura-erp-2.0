import type { NextConfig } from "next";
// output standalone + sin telemetría (heredado de la infra probada de ARG).
// devIndicators:false oculta el botón flotante de Next en desarrollo.
const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: false,
  // En desarrollo, abrir el sistema desde el celular por la red local (p. ej. el menú QR de las mesas).
  allowedDevOrigins: ["192.168.*.*"],
  // jsPDF se usa en rutas del servidor (PDF de arqueo): se carga de node_modules sin empaquetar.
  serverExternalPackages: ["jspdf", "jspdf-autotable"],
  // Cierres de caja se mudó a la familia Reportes: los enlaces viejos siguen andando.
  async redirects() {
    return [
      { source: "/caja/cierres", destination: "/reportes/cajas", permanent: true },
      // Caja salió del panel de Finanzas: ahora es un ítem del menú con sus pantallas como submenú.
      { source: "/caja/panel", destination: "/caja/nueva", permanent: false },
      { source: "/caja/cierres/:id", destination: "/reportes/cajas/:id", permanent: true },
      // Gastos y Servicios ahora es Gastos empresariales › Gastos operativos (se conserva ?ver=<id>).
      { source: "/gastos", destination: "/gastos-empresariales/operativos", permanent: false },
    ];
  },
};
export default nextConfig;
