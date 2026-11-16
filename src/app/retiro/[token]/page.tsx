import type { Metadata } from "next";
import { RetiroKiosco } from "./RetiroKiosco";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Retiro de almuerzo", robots: { index: false, follow: false } };

export default async function RetiroPublicoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <RetiroKiosco token={token} />;
}
