import type { NextConfig } from "next";
// output standalone + sin telemetría (heredado de la infra probada de ARG).
// devIndicators:false oculta el botón flotante de Next en desarrollo.
const nextConfig: NextConfig = { output: "standalone", devIndicators: false };
export default nextConfig;
