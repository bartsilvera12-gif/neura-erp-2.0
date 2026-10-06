"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { browserClient } from "@/lib/supabase/browser";
import { apiFetch } from "@/lib/api/client-fetch";
import { modulosActivos } from "@/modules/registry";
import { clienteConfig } from "@/cliente.config";

type Me = { rol: string; email: string | null };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await browserClient().auth.getSession();
      if (!data.session) {
        router.replace("/login");
        return;
      }
      try {
        setMe(await apiFetch<Me>("/api/me"));
      } catch {
        // sesión válida pero el usuario no está en el catálogo del tenant
        setMe({ rol: "", email: data.session.user.email ?? null });
      }
      setReady(true);
    })();
  }, [router]);

  async function logout() {
    await browserClient().auth.signOut();
    router.replace("/login");
  }

  if (!ready) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Cargando…</div>;
  }

  const modulos = modulosActivos(me?.rol);

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-4">
          <div className="text-sm font-semibold text-[#023047]">{clienteConfig.nombre}</div>
          <div className="text-[11px] text-slate-400">Neura ERP</div>
        </div>
        <nav className="flex-1 space-y-1 p-2">
          <NavLink href="/" label="Inicio" active={pathname === "/"} />
          {modulos.map((m) => (
            <NavLink key={m.id} href={m.href} label={m.label} active={pathname.startsWith(m.href)} />
          ))}
        </nav>
      </aside>

      {/* Contenido */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-end gap-3 border-b border-slate-200 bg-white px-6 py-3 text-sm text-slate-600">
          <span>{me?.email}</span>
          <button onClick={logout} className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:border-[#3F8E91] hover:text-[#3F8E91]">
            Salir
          </button>
        </header>
        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}

function NavLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active ? "bg-[#3F8E91]/10 text-[#3F8E91]" : "text-slate-600 hover:bg-slate-50"
      }`}
    >
      {label}
    </Link>
  );
}
