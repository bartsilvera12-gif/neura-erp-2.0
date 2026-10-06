"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase/browser";
import { apiFetch } from "@/lib/api/client-fetch";

type Cliente = { id: string; nombre: string; documento?: string | null };

export default function HomePage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setClientes(await apiFetch<Cliente[]>("/api/_ejemplo"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await browserClient().auth.getSession();
      if (!data.session) {
        router.replace("/login");
        return;
      }
      setEmail(data.session.user.email ?? null);
      await cargar();
    })();
  }, [router, cargar]);

  async function logout() {
    await browserClient().auth.signOut();
    router.replace("/login");
  }

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div className="font-semibold text-[#023047]">Neura ERP</div>
        <div className="flex items-center gap-3 text-sm text-slate-600">
          <span>{email}</span>
          <button onClick={logout} className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:border-[#3F8E91] hover:text-[#3F8E91]">
            Salir
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-slate-900">Clientes</h1>
          <button onClick={cargar} className="rounded-lg bg-[#3F8E91] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#357b7e]">
            Actualizar
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">Cargando…</p>
        ) : error ? (
          <p className="text-sm text-rose-600">{error}</p>
        ) : clientes.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
            Sin clientes todavía.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
            {clientes.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="font-medium text-slate-800">{c.nombre}</span>
                <span className="text-xs text-slate-500">{c.documento ?? "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
