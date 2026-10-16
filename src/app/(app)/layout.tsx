"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { browserClient } from "@/lib/supabase/browser";
import { apiFetchCache, limpiarCache } from "@/lib/api/cache-cliente";
import { ProveedorUsuario, type Usuario } from "@/lib/sesion/ContextoUsuario";
import { modulosDelPerfil, pantallaDeRuta, perfilVePantalla } from "@/modules/registry";
import { NotificacionesBell } from "@/modules/notificaciones/NotificacionesBell";
import { MarcoApp } from "@/components/shell/MarcoApp";

type Me = Usuario;
const ACCENT = "#7dcfd2";

/**
 * Layout de la app autenticada: sesión, /api/me (perfil y pantallas) y guard de página.
 * Lo visual (menú lateral / cajón móvil, cabecera, buscador de pantallas) vive en
 * `MarcoApp` (src/components/shell/MarcoApp.tsx), que es responsive.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  // Sesión conocida (getSession es local, sin red). Con eso ya se montan las páginas:
  // /api/me llega en paralelo y se reparte por contexto (useUsuario).
  const [ready, setReady] = useState(false);
  const [emailSesion, setEmailSesion] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data } = await browserClient().auth.getSession();
      if (!vivo) return;
      if (!data.session) {
        router.replace("/login");
        return;
      }
      setEmailSesion(data.session.user.email ?? null);
      setReady(true);
      try {
        const m = await apiFetchCache<Me>("/api/me");
        if (vivo) setMe(m);
      } catch {
        if (vivo) setMe({ rol: "", email: data.session.user.email ?? null });
      }
    })();
    return () => {
      vivo = false;
    };
  }, [router]);

  // Los módulos visibles dependen del rol y del PERFIL (sus pantallas): hasta que llega
  // /api/me no se lista ninguno (si no, aparecerían módulos que no ve y después desaparecerían).
  const rol = me?.rol;
  const perfil = me?.perfil;
  const modulos = useMemo(() => (rol === undefined ? [] : modulosDelPerfil(rol, perfil)), [rol, perfil]);

  // Guard de página: entrar por URL a una pantalla que el perfil no tiene → "Sin acceso".
  // (Las APIs y la base lo vuelven a validar; esto es para no mostrar una pantalla rota.)
  const pantallaBloqueada = useMemo(() => {
    if (!me || !perfil) return null;
    const p = pantallaDeRuta(pathname);
    if (!p || p.accesoPropio) return null;
    return perfilVePantalla(p, rol, perfil) ? null : p;
  }, [me, perfil, rol, pathname]);

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200" style={{ borderTopColor: ACCENT }} />
      </div>
    );
  }

  return (
    <MarcoApp
      modulos={modulos}
      cargandoMenu={me === null}
      usuario={me ?? { rol: "", email: emailSesion }}
      pathname={pathname}
      onLogout={async () => { await browserClient().auth.signOut(); limpiarCache(); router.replace("/login"); }}
      campana={<NotificacionesBell />}
    >
      <ProveedorUsuario value={me}>
        {pantallaBloqueada ? <SinAcceso pantalla={`${pantallaBloqueada.moduloLabel}${pantallaBloqueada.label !== pantallaBloqueada.moduloLabel ? ` › ${pantallaBloqueada.label}` : ""}`} perfil={perfil?.nombre ?? null} /> : children}
      </ProveedorUsuario>
    </MarcoApp>
  );
}

function SinAcceso({ pantalla, perfil }: { pantalla: string; perfil: string | null }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-20 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-500">
        <ShieldAlert className="h-6 w-6" aria-hidden />
      </span>
      <h1 className="mt-4 text-lg font-semibold text-slate-900">Sin acceso</h1>
      <p className="mt-1.5 text-sm text-slate-500">
        Tu perfil{perfil ? <> (<span className="font-medium text-slate-700">{perfil}</span>)</> : null} no tiene habilitada la pantalla{" "}
        <span className="font-medium text-slate-700">{pantalla}</span>. Si la necesitás, pedíselo a un administrador.
      </p>
      <Link href="/" className="mt-5 inline-flex min-h-11 items-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 no-underline hover:bg-slate-50 lg:min-h-0">
        Volver al inicio
      </Link>
    </div>
  );
}
