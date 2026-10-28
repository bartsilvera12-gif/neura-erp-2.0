"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import { browserClient } from "@/lib/supabase/browser";
import { clienteConfig } from "@/cliente.config";

const BRAND = clienteConfig.color;

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verClave, setVerClave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expirada, setExpirada] = useState(false);
  // Llegó acá porque la sesión se cerró en el servidor (ver apiFetch): se avisa.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("sesion") === "expirada") setExpirada(true);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await browserClient().auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      // Sin conexión no es "credenciales incorrectas": que no haga dudar de la contraseña.
      const red = /fetch|network|timeout/i.test(error.message ?? "");
      setError(red ? "No pudimos conectar con el servidor. Revisá tu internet y probá de nuevo." : "Credenciales incorrectas. Verificá tu email y contraseña.");
      return;
    }
    router.replace("/");
  }

  return (
    <main className="flex min-h-dvh bg-white">
      {/* Panel de marca (turquesa) — se oculta en móvil */}
      <aside
        className="relative hidden w-[46%] flex-col justify-between overflow-hidden p-12 text-white lg:flex"
        style={{ background: `linear-gradient(150deg, ${BRAND} 0%, var(--brand-dark) 100%)` }}
      >
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/zentra-logo-360.webp" alt="ZENTRA" width={360} height={185} decoding="async" className="h-10 w-auto rounded-lg object-contain" />
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
      <div className="flex flex-1 items-center justify-center px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:p-6">
        <form onSubmit={onSubmit} className="animate-in w-full max-w-sm">
          <div className="mb-8">
            {/* El mismo logo que el menú del sistema (en escritorio va en el panel de marca). */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {/* El logo es blanco: va sobre la placa oscura, igual que en la cabecera del celular. */}
            <div className="mb-5 inline-flex h-12 items-center rounded-xl px-3 lg:hidden" style={{ backgroundColor: "var(--zentra-sidebar)" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/zentra-logo-360.webp" alt="ZENTRA" width={360} height={185} decoding="async" fetchPriority="high" className="h-9 w-auto object-contain" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Iniciá sesión</h1>
            <p className="mt-1 text-sm text-slate-500">Ingresá a {clienteConfig.nombre}.</p>
          </div>

          <label className="mb-1.5 block text-sm font-medium text-slate-700">Correo electrónico</label>
          <div className="relative mb-4">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="email"
              autoComplete="email"
              inputMode="email"
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
              type={verClave ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-12 text-sm outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]"
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setVerClave((v) => !v)}
              aria-label={verClave ? "Ocultar contraseña" : "Mostrar contraseña"}
              aria-pressed={verClave}
              className="absolute right-1 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            >
              {verClave ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          {expirada && !error ? (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">Tu sesión se cerró. Volvé a ingresar para seguir.</div>
          ) : null}
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
