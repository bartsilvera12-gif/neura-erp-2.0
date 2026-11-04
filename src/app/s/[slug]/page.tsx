/**
 * /s/<slug> — Página pública de un sorteo (recetas 123 y 124): premios, combos, compra web con reserva
 * de números, "verificá tu número" y ganadores. Sin cuenta: fuera del layout autenticado.
 * ?v=<código> marca al vendedor que compartió el link (lo agrega /r/<código>).
 */
import type { Metadata, Viewport } from "next";
import { cache } from "react";
import { Ticket } from "lucide-react";
import { clienteConfig } from "@/cliente.config";
import { CODIGO_RE, sorteoPublico } from "@/modules/sorteos/publico";
import { PaginaSorteo } from "./PaginaSorteo";

export const dynamic = "force-dynamic";

const traer = cache(async (slug: string) => {
  try {
    return { s: await sorteoPublico(slug), error: false };
  } catch {
    return { s: null, error: true };
  }
});

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#ffffff" };

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const { s } = await traer(slug);
  if (!s) return { title: `Sorteo · ${clienteConfig.nombre}`, robots: { index: false } };
  return {
    title: `${s.nombre} · ${s.empresa}`,
    description: s.descripcion ?? `Participá del sorteo de ${s.empresa}.`,
    openGraph: { title: s.nombre, description: s.descripcion ?? `Participá del sorteo de ${s.empresa}.`, images: s.imagen_url ? [s.imagen_url] : undefined },
  };
}

export default async function SorteoPublicoPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ v?: string }> }) {
  const { slug } = await params;
  const { v } = await searchParams;
  const { s, error } = await traer(slug);
  if (!s) {
    return (
      <div className="grid min-h-dvh place-items-center bg-slate-50 px-4" style={{ ["--brand" as string]: clienteConfig.color }}>
        <div className="max-w-sm rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400"><Ticket className="h-6 w-6" /></span>
          <h1 className="mt-4 text-lg font-semibold text-slate-900">{error ? "No pudimos cargar el sorteo" : "Este sorteo no existe"}</h1>
          <p className="mt-2 text-sm text-slate-500">{error ? "Probá de nuevo en un momento." : "Revisá el link: puede que el sorteo ya no esté publicado."}</p>
        </div>
      </div>
    );
  }
  return <PaginaSorteo s={s} vendedor={v && CODIGO_RE.test(v) ? v.toUpperCase() : null} color={clienteConfig.color} />;
}
