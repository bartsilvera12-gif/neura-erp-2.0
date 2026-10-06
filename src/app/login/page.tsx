"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase/browser";

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
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#023047] to-[#3F8E91] p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h1 className="text-center text-lg font-semibold text-slate-900">Iniciá sesión</h1>
        <p className="mb-5 text-center text-xs text-slate-500">Neura ERP</p>

        <label className="mb-1 block text-sm font-medium text-slate-700">Correo electrónico</label>
        <input
          type="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#3F8E91] focus:ring-2 focus:ring-[#3F8E91]/20"
          placeholder="vos@empresa.com"
        />

        <label className="mb-1 block text-sm font-medium text-slate-700">Contraseña</label>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#3F8E91] focus:ring-2 focus:ring-[#3F8E91]/20"
          placeholder="••••••••"
        />

        {error ? (
          <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-[#3F8E91] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#357b7e] disabled:opacity-60"
        >
          {busy ? "Entrando…" : "Iniciar sesión"}
        </button>
      </form>
    </main>
  );
}
