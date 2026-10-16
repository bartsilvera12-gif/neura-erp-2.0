"use client";

/**
 * /bienvenida — el invitado (o quien pidió restablecer) elige su contraseña.
 * Llega con:
 *   · ?token_hash=…&type=invite|recovery   (links que copia el admin: verifyOtp acá)
 *   · #access_token=…&refresh_token=…&type=invite|recovery   (email del servidor de auth)
 * Con la sesión del link se pone la contraseña (updateUser) y entra al sistema.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Lock, ShieldAlert } from "lucide-react";
import { browserClient } from "@/lib/supabase/browser";
import { limpiarCache } from "@/lib/api/cache-cliente";
import { clienteConfig } from "@/cliente.config";

const BRAND = clienteConfig.color;
type Paso = "verificando" | "form" | "error" | "listo";

export default function BienvenidaPage() {
  const router = useRouter();
  const [paso, setPaso] = useState<Paso>("verificando");
  const [tipo, setTipo] = useState<"invite" | "recovery">("invite");
  const [email, setEmail] = useState<string | null>(null);
  const [nombre, setNombre] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clave, setClave] = useState("");
  const [repetir, setRepetir] = useState("");
  const [ver, setVer] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const sb = browserClient();
      const qs = new URLSearchParams(window.location.search);
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const t = (qs.get("type") || hash.get("type")) === "recovery" ? "recovery" : "invite";
      if (vivo) setTipo(t);
      try {
        if (hash.get("error_description") || qs.get("error_description")) {
          throw new Error(hash.get("error_description") || qs.get("error_description") || "El link no es válido");
        }
        // Una sesión anterior en este navegador (otro usuario) no se mezcla con la del link.
        const tokenHash = qs.get("token_hash");
        const access = hash.get("access_token");
        const refresh = hash.get("refresh_token");
        if (tokenHash || access) {
          await sb.auth.signOut({ scope: "local" }).catch(() => undefined);
          limpiarCache();
        }
        if (tokenHash) {
          const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: t });
          if (error) throw error;
        } else if (access && refresh) {
          const { error } = await sb.auth.setSession({ access_token: access, refresh_token: refresh });
          if (error) throw error;
        }
        // Se saca el token de la barra de direcciones (no queda en el historial).
        window.history.replaceState(null, "", "/bienvenida");
        const { data } = await sb.auth.getUser();
        if (!data.user) throw new Error("Sin sesión");
        if (!vivo) return;
        setEmail(data.user.email ?? null);
        const n = (data.user.user_metadata as { nombre?: string } | null)?.nombre;
        setNombre(n ? String(n).split(" ")[0] : null);
        setPaso("form");
      } catch {
        if (!vivo) return;
        setError("El link venció o ya se usó. Pedile al administrador uno nuevo.");
        setPaso("error");
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const reglas = [
    { ok: clave.length >= 8, texto: "Al menos 8 caracteres" },
    { ok: /[a-zA-Z]/.test(clave) && /\d/.test(clave), texto: "Letras y números" },
    { ok: clave.length > 0 && clave === repetir, texto: "Las dos coinciden" },
  ];
  const valida = reglas.every((r) => r.ok);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!valida || busy) return;
    setBusy(true);
    setError(null);
    const { error } = await browserClient().auth.updateUser({ password: clave });
    setBusy(false);
    if (error) {
      setError(/same|different/i.test(error.message) ? "Elegí una contraseña distinta a la anterior." : /weak|short/i.test(error.message) ? "La contraseña es muy débil: usá una más larga." : "No se pudo guardar la contraseña. Probá de nuevo.");
      return;
    }
    setPaso("listo");
    setTimeout(() => router.replace("/"), 1400);
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#f6f8fa] px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6">
      <div className="animate-in w-full max-w-sm rounded-2xl bg-white p-5 sm:p-7 shadow-[0_20px_50px_-20px_rgba(2,48,71,0.25)] ring-1 ring-slate-200/70">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl text-base font-black text-white" style={{ backgroundColor: BRAND }}>
            {clienteConfig.nombre.charAt(0)}
          </div>
          <span className="text-sm font-semibold text-slate-700">{clienteConfig.nombre}</span>
        </div>

        {paso === "verificando" ? (
          <div className="flex flex-col items-center gap-3 py-8 text-sm text-slate-500">
            <Loader2 className="h-6 w-6 animate-spin text-slate-300" /> Verificando el link…
          </div>
        ) : paso === "error" ? (
          <div className="py-4 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-amber-50 text-amber-600"><ShieldAlert className="h-6 w-6" /></span>
            <h1 className="mt-4 text-lg font-semibold text-slate-900">No pudimos abrir el link</h1>
            <p className="mt-1.5 text-sm text-slate-500">{error}</p>
            <a href="/login" className="mt-5 inline-block rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Ir a iniciar sesión</a>
          </div>
        ) : paso === "listo" ? (
          <div className="py-6 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-6 w-6" /></span>
            <h1 className="mt-4 text-lg font-semibold text-slate-900">¡Listo!</h1>
            <p className="mt-1.5 text-sm text-slate-500">Tu contraseña quedó guardada. Entrando…</p>
          </div>
        ) : (
          <form onSubmit={guardar}>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              {tipo === "invite" ? `¡Bienvenido${nombre ? `, ${nombre}` : ""}!` : "Elegí una contraseña nueva"}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {tipo === "invite" ? "Elegí tu contraseña para entrar." : "La anterior deja de funcionar."}
              {email ? <> Tu usuario es <span className="font-medium text-slate-700">{email}</span>.</> : null}
            </p>

            <label className="mb-1.5 mt-5 block text-sm font-medium text-slate-700">Contraseña</label>
            <div className="relative mb-3">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input type={ver ? "text" : "password"} autoFocus required value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="new-password"
                className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-10 text-sm outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]" />
              <button type="button" onClick={() => setVer((v) => !v)} aria-label={ver ? "Ocultar" : "Mostrar"} className="absolute right-1 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:text-slate-600">
                {ver ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Repetila</label>
            <div className="relative mb-3">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input type={ver ? "text" : "password"} required value={repetir} onChange={(e) => setRepetir(e.target.value)} autoComplete="new-password"
                className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-3 text-sm outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]" />
            </div>
            <ul className="mb-5 space-y-1">
              {reglas.map((r) => (
                <li key={r.texto} className={`flex items-center gap-1.5 text-xs transition-colors ${r.ok ? "text-emerald-700" : "text-slate-400"}`}>
                  <CheckCircle2 className="h-3.5 w-3.5" /> {r.texto}
                </li>
              ))}
            </ul>
            {error ? <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700">{error}</div> : null}
            <button type="submit" disabled={!valida || busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 active:scale-[0.98] disabled:opacity-50"
              style={{ backgroundColor: BRAND }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {busy ? "Guardando…" : tipo === "invite" ? "Guardar y entrar" : "Guardar contraseña"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
