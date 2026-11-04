"use client";

/**
 * /s/<slug>/verificar — Cualquiera comprueba el sorteo digital (recetas 123 y 124), en su propio
 * navegador: que la semilla revelada coincide con la huella publicada al activar, que la lista de
 * vendidos coincide con su huella publicada al cerrar, y que cada ganador digital sale de
 * sha256(semilla:huella_lista:posición:intento) sobre esa lista.
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, ShieldCheck, XCircle } from "lucide-react";
import type { SorteoPublico } from "@/modules/sorteos/publico";

async function sha256(t: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

type Resultado = { titulo: string; ok: boolean | null; detalle: string };

export default function VerificarSorteoPage() {
  const { slug } = useParams<{ slug: string }>();
  const [s, setS] = useState<SorteoPublico | null>(null);
  const [res, setRes] = useState<Resultado[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const a = await fetch(`/api/publico/sorteos/${slug}`, { cache: "no-store" }).then((x) => x.json());
        if (!a.ok) throw new Error(a.error ?? "No existe ese sorteo");
        const sorteo = a.data as SorteoPublico;
        setS(sorteo);
        const out: Resultado[] = [];
        const v = sorteo.verificacion;
        if (!v.semilla_hash) { setRes([{ titulo: "El sorteo todavía no se activó", ok: null, detalle: "La huella se publica al activarlo." }]); return; }
        if (v.semilla) {
          const h = await sha256(v.semilla);
          out.push({ titulo: "La semilla coincide con la huella publicada al activar", ok: h === v.semilla_hash, detalle: `sha256(semilla) = ${h}` });
        } else {
          out.push({ titulo: "La semilla se revela cuando terminan todos los premios", ok: null, detalle: `Huella publicada al activar: ${v.semilla_hash}` });
        }
        if (!v.lista_hash) { out.push({ titulo: "La lista de vendidos se publica al cerrar la venta", ok: null, detalle: "" }); setRes(out); return; }
        const l = await fetch(`/api/publico/sorteos/${slug}/numeros?lista=1`, { cache: "no-store" }).then((x) => x.json());
        const lista: number[] = l.ok ? l.data.numeros : [];
        const hl = await sha256(lista.join(","));
        out.push({ titulo: `La lista de ${lista.length.toLocaleString("es-PY")} números vendidos coincide con su huella`, ok: hl === v.lista_hash, detalle: `sha256(lista) = ${hl}` });
        if (v.semilla) {
          for (const p of sorteo.premios.filter((x) => x.metodo === "digital" && x.numero_ganador && x.intento != null)) {
            const h = await sha256(`${v.semilla}:${v.lista_hash}:${p.posicion}:${p.intento}`);
            const idx = Number(BigInt(`0x${h.slice(0, 15)}`) % BigInt(lista.length));
            const calculado = lista[idx];
            out.push({
              titulo: `${p.posicion}° premio (${p.nombre}): el cálculo da el ${String(calculado).padStart(sorteo.digitos, "0")}`,
              ok: calculado === Number(p.numero_ganador),
              detalle: `posición ${idx + 1} de ${lista.length}${p.intento ? ` · intento ${p.intento} (los anteriores ya habían ganado)` : ""}`,
            });
          }
        }
        setRes(out);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [slug]);

  return (
    <div className="min-h-dvh bg-slate-50 px-4 py-6">
      <main className="mx-auto max-w-xl space-y-4">
        <Link href={`/s/${slug}`} className="text-sm font-medium text-slate-500 no-underline">← Volver al sorteo</Link>
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900"><ShieldCheck className="h-6 w-6 text-emerald-600" /> Sorteo verificable</h1>
          {s ? <p className="mt-1 text-sm text-slate-500">{s.nombre} · {s.empresa}</p> : null}
          <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-slate-600">
            <li>Al activar el sorteo se fijó una semilla secreta y se publicó su huella. Nadie sabía todavía quién iba a comprar.</li>
            <li>Al cerrar la venta se publicó la huella de la lista de números vendidos.</li>
            <li>Cada ganador digital sale de mezclar la semilla, esa lista y el número de premio. Esta página lo recalcula en tu propio navegador.</li>
          </ol>
        </section>
        {error ? <p className="rounded-2xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
        {!res && !error ? <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Calculando…</p> : null}
        {res ? (
          <ul className="space-y-2">
            {res.map((r, i) => (
              <li key={i} className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                {r.ok === true ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" /> : r.ok === false ? <XCircle className="h-5 w-5 shrink-0 text-rose-600" /> : <ShieldCheck className="h-5 w-5 shrink-0 text-slate-400" />}
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-900">{r.titulo}</span>
                  {r.detalle ? <span className="block break-all font-mono text-[11px] text-slate-500">{r.detalle}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </main>
    </div>
  );
}
