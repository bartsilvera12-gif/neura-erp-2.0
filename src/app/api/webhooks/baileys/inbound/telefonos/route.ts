/**
 * Equivalencias código interno (@lid) → teléfono que aprende el puente:
 * POST /api/webhooks/baileys/inbound/telefonos { empresaId, pares: [{ lid, telefono }] } (hasta 500).
 * Solo corrige el número de contactos que ya existen.
 */
import { type NextRequest, NextResponse } from "next/server";
import { canalDelPuente, corregirTelefonos } from "@/lib/conversaciones/baileys";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => null)) as { empresaId?: unknown; pares?: unknown } | null;
  if (!b) return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  const canal = await canalDelPuente(req.headers, { empresaId: b.empresaId });
  if (!canal) return NextResponse.json({ ok: false, error: "Empresa o secreto incorrecto" }, { status: 401 });
  const pares = (Array.isArray(b.pares) ? b.pares : [])
    .slice(0, 500)
    .map((p) => ({ lid: String((p as { lid?: unknown })?.lid ?? "").replace(/\D/g, ""), telefono: String((p as { telefono?: unknown })?.telefono ?? "").replace(/\D/g, "") }))
    .filter((p) => p.lid.length >= 5 && p.telefono.length >= 8 && p.lid !== p.telefono);
  if (!pares.length) return NextResponse.json({ ok: true, corregidos: 0 });
  try {
    return NextResponse.json({ ok: true, corregidos: await corregirTelefonos(canal.empresa_id, pares) });
  } catch (e) {
    console.error("[chat/baileys] telefonos", (e as Error).message);
    return NextResponse.json({ ok: false, error: "No se pudieron corregir los teléfonos" }, { status: 503 });
  }
}
