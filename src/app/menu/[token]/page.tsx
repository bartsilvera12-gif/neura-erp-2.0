import type { Metadata } from "next";
import { ReservaCliente } from "./ReservaCliente";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Menú del comedor", robots: { index: false, follow: false } };

export default async function MenuPublicoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ReservaCliente token={token} />;
}
