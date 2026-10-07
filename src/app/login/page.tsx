"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock, Mail } from "lucide-react";
import { browserClient } from "@/lib/supabase/browser";
import { clienteConfig } from "@/cliente.config";

const BRAND = clienteConfig.color;

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await browserClient().auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      setError("Credenciales incorrectas. Verificá tu email y contraseña.");
      return;
    }
    router.replace("/");
  }

  return (
    <main className="flex min-h-screen bg-white">
      {/* Panel de marca (turquesa) — se oculta en móvil */}
      <aside
        className="relative hidden w-[46%] flex-col justify-between overflow-hidden p-12 text-white lg:flex"
        style={{ background: `linear-gradient(150deg, ${BRAND} 0%, var(--brand-dark) 100%)` }}
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 text-lg font-black backdrop-blur">
            {clienteConfig.nombre.charAt(0)}
          </div>
          <span className="text-sm font-semibold tracking-wide">{clienteConfig.nombre}</span>
        </div>

        <div className="relative z-10">
          <h2 className="max-w-sm text-3xl font-bold leading-tight">
            Tu negocio, ordenado y en tiempo real.
          </h2>
          <p className="mt-3 max-w-sm text-sm text-white/70">
            Caja, ventas, stock y clientes en un solo lugar. Rápido, seguro y pensado para el día a día.
          </p>
        </div>

        <p className="relative z-10 text-xs text-white/50">Neura ERP · Zentra</p>

        {/* Formas decorativas suaves */}
        <div className="pointer-events-none absolute -right-20 -top-16 h-72 w-72 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-10 h-80 w-80 rounded-full bg-white/10 blur-3xl" />
      </aside>

      {/* Formulario */}
      <div className="flex flex-1 items-center justify-center p-6">
        <form onSubmit={onSubmit} className="animate-in w-full max-w-sm">
          <div className="mb-8">
            <div
              className="mb-5 flex h-11 w-11 items-center justify-center rounded-2xl text-lg font-black text-white lg:hidden"
              style={{ backgroundColor: BRAND }}
            >
              {clienteConfig.nombre.charAt(0)}
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Iniciá sesión</h1>
            <p className="mt-1 text-sm text-slate-500">Ingresá a {clienteConfig.nombre}.</p>
          </div>

          <label className="mb-1.5 block text-sm font-medium text-slate-700">Correo electrónico</label>
          <div className="relative mb-4">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-3 text-sm outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]"
              placeholder="vos@empresa.com"
            />
          </div>

          <label className="mb-1.5 block text-sm font-medium text-slate-700">Contraseña</label>
          <div className="relative mb-5">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-3 text-sm outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]"
              placeholder="••••••••"
            />
          </div>

          {error ? (
            <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700">{error}</div>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:opacity-60"
            style={{ backgroundColor: BRAND }}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {busy ? "Entrando…" : "Iniciar sesión"}
          </button>
        </form>
      </div>
    </main>
  );
}
