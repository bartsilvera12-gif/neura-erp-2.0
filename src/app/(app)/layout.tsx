"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { filtrar } from "@/lib/busqueda";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Bell,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  LayoutDashboard,
  LogOut,
  Search,
} from "lucide-react";
import { browserClient } from "@/lib/supabase/browser";
import { apiFetch } from "@/lib/api/client-fetch";
import { modulosActivos } from "@/modules/registry";
import { iconoModulo } from "@/modules/icons";
import type { Modulo } from "@/modules/types";

type Me = { rol: string; email: string | null };
const ACCENT = "#7dcfd2";

function rolLabel(rol?: string) {
  const r = (rol ?? "").trim().toUpperCase();
  const m: Record<string, string> = { ADMIN: "Admin", CAJERO: "Cajero", VENDEDOR: "Vendedor", SUPERVISOR: "Supervisor" };
  return m[r] ?? (rol ? rol.charAt(0) + rol.slice(1).toLowerCase() : "Usuario");
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [q, setQ] = useState("");
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});

  // Preferencias de UI del sidebar: se recuerdan por navegador (localStorage).
  useEffect(() => {
    try {
      const a = localStorage.getItem("zentra:sidebar:abiertos");
      if (a) setAbiertos(JSON.parse(a));
      setCollapsed(localStorage.getItem("zentra:sidebar:collapsed") === "1");
    } catch {
      /* navegador sin storage: se usan los valores por defecto */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("zentra:sidebar:abiertos", JSON.stringify(abiertos));
    } catch {}
  }, [abiertos]);
  useEffect(() => {
    try {
      localStorage.setItem("zentra:sidebar:collapsed", collapsed ? "1" : "0");
    } catch {}
  }, [collapsed]);

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
        setMe({ rol: "", email: data.session.user.email ?? null });
      }
      setReady(true);
    })();
  }, [router]);

  const modulos = modulosActivos(me?.rol);

  const familias = useMemo(() => {
    // Búsqueda inteligente: sin tildes, errores de tipeo; también por la familia ("finanzas").
    // Busca en el módulo, su familia y sus sub-pantallas ("arqueo" → Caja › Arqueo / Cierre).
    const visibles = filtrar(modulos, q, (m) => ({ principal: m.label, otros: [m.familia, ...(m.children ?? []).map((c) => c.label)] }));
    const orden = ["Comercial", "Finanzas", "Operaciones", "Reportes", "Administración", "General"];
    const map = new Map<string, Modulo[]>();
    for (const m of visibles) {
      const fam = m.familia ?? "General";
      if (!map.has(fam)) map.set(fam, []);
      map.get(fam)!.push(m);
    }
    return [...map.entries()].sort((a, b) => (orden.indexOf(a[0]) + 1 || 99) - (orden.indexOf(b[0]) + 1 || 99));
  }, [modulos, q]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200" style={{ borderTopColor: ACCENT }} />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar estilo 21st.dev, en turquesa Zentra */}
      <aside
        className="flex h-full shrink-0 flex-col text-slate-300 transition-[width] duration-200"
        style={{ width: collapsed ? 72 : 236, backgroundColor: "var(--zentra-sidebar)" }}
      >
        {/* Logo oficial ZENTRA (grande y centrado, como JM) + botón colapsar/expandir */}
        <div
          className={`relative flex shrink-0 items-center border-b ${collapsed ? "h-16 justify-center gap-1 px-1" : "h-28 justify-center px-3"}`}
          style={{ borderColor: "var(--zentra-sidebar-border)", backgroundColor: "rgba(16,74,78,0.35)" }}
        >
          <Link href="/" className="flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/zentra-logo-official.png"
              alt="ZENTRA"
              className={`object-contain ${collapsed ? "h-8 w-8" : "h-16 w-full max-w-[180px]"}`}
            />
          </Link>
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className={`shrink-0 rounded-md text-slate-400 transition-colors hover:bg-white/10 hover:text-white ${collapsed ? "p-1" : "absolute right-3 top-3 p-1.5"}`}
            aria-label={collapsed ? "Expandir menú" : "Colapsar menú"}
          >
            {collapsed ? <ChevronsRight className="h-[18px] w-[18px]" /> : <ChevronsLeft className="h-[18px] w-[18px]" />}
          </button>
        </div>

        {collapsed ? null : (
          <div className="px-3 pt-3">
            <div className="group relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 transition-colors group-focus-within:text-[var(--zentra-accent)]" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar…"
                className="w-full rounded-lg border border-white/[0.08] bg-black/20 py-2 pl-9 pr-9 text-[13px] text-white outline-none transition placeholder:text-slate-500 focus:border-[var(--zentra-accent)]/40 focus:bg-black/30"
              />
              <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-white/10 px-1.5 py-0.5 text-[11px] text-slate-500">/</kbd>
            </div>
          </div>
        )}

        {/* Navegación con etiquetas de sección */}
        <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3">
          <NavItem href="/" label="Inicio" Icon={LayoutDashboard} active={pathname === "/"} collapsed={collapsed} />
          {familias.map(([fam, items]) => (
            <div key={fam} className="mt-4">
              {!collapsed ? (
                <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{fam}</p>
              ) : (
                <div className="mx-auto mb-2 h-px w-6 bg-white/10" />
              )}
              {items.map((m) => {
                // Activo también si se está en una sub-pantalla con otra ruta (Compras › Proveedores).
                const enRuta = (h: string) => { const base = h.split("?")[0]; return pathname === base || pathname.startsWith(`${base}/`); };
                const active = enRuta(m.href) || (m.children ?? []).some((c) => enRuta(c.href));
                const tieneHijos = !!m.children?.length;
                // Buscando, se despliegan solos para que se vea la sub-pantalla encontrada.
                const abierto = (q.trim() ? true : (abiertos[m.id] ?? active)) && !collapsed;
                return (
                  <div key={m.id}>
                    <NavItem
                      href={m.href}
                      label={m.label}
                      Icon={iconoModulo(m.icon)}
                      active={active}
                      collapsed={collapsed}
                      badge={m.badge}
                      hasChildren={tieneHijos}
                      abierto={abierto}
                      onToggle={() => setAbiertos((p) => ({ ...p, [m.id]: !abierto }))}
                    />
                    {tieneHijos && !collapsed ? (
                      <div
                        className="overflow-hidden transition-[grid-template-rows] duration-200"
                        style={{ display: "grid", gridTemplateRows: abierto ? "1fr" : "0fr" }}
                      >
                        <div className="min-h-0">
                          <div className="relative ml-[30px] mt-1 space-y-1 pl-3">
                            <span className="absolute left-0 top-1 bottom-1 w-px bg-white/10" />
                            {m.children!.map((c) => {
                              // Activo: ruta exacta, o la sub-página del hijo con el prefijo más largo
                              // (/reportes/cajas/<id> marca "Cierres de caja", no "Todos los reportes").
                              const coincide = (h: string) => pathname === h || pathname.startsWith(`${h}/`);
                              const mejor = m.children!.filter((x) => coincide(x.href)).sort((a, b) => b.href.length - a.href.length)[0];
                              const ca = mejor?.href === c.href;
                              return (
                                <Link
                                  key={c.href}
                                  href={c.href}
                                  className={`relative block rounded-lg px-3 py-2 text-[13px] transition-all ${ca ? "font-medium text-white" : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"}`}
                                  style={ca ? { backgroundColor: "rgba(125,207,210,0.14)" } : undefined}
                                >
                                  {ca ? (
                                    <span className="absolute -left-[13px] top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full" style={{ backgroundColor: ACCENT, boxShadow: `0 0 8px ${ACCENT}` }} />
                                  ) : null}
                                  {c.label}
                                </Link>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      {/* Contenido */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Header me={me} onLogout={async () => { await browserClient().auth.signOut(); router.replace("/login"); }} />
        <main className="min-w-0 flex-1 overflow-y-auto bg-[#f6f8fa] p-6">
          <div className="animate-in mx-auto max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

function NavItem({
  href,
  label,
  Icon,
  active,
  collapsed,
  badge,
  hasChildren,
  abierto,
  onToggle,
}: {
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  collapsed: boolean;
  badge?: string;
  hasChildren?: boolean;
  abierto?: boolean;
  onToggle?: () => void;
}) {
  const rowClass = `group flex items-center rounded-lg text-[14px] transition-colors ${collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2"} ${
    active ? "text-white" : "text-slate-300 hover:bg-white/[0.05] hover:text-white"
  }`;
  const rowStyle = active ? { backgroundColor: "rgba(255,255,255,0.07)" } : undefined;
  const icon = <Icon className="h-[18px] w-[18px] shrink-0 transition-colors" style={{ color: active ? ACCENT : "#8aa3a4" }} />;

  // Item con submenú: TODA la fila navega y pliega/despliega (no solo la flecha).
  if (hasChildren && !collapsed) {
    return (
      <Link href={href} title={label} onClick={onToggle} className={`${rowClass} cursor-pointer`} style={rowStyle}>
        {icon}
        <span className="flex-1 truncate">{label}</span>
        <ChevronRight className={`h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200 ${abierto ? "rotate-90" : ""}`} />
      </Link>
    );
  }

  return (
    <Link href={href} title={label} className={rowClass} style={rowStyle}>
      {icon}
      {!collapsed ? (
        <>
          <span className="flex-1 truncate">{label}</span>
          {badge ? (
            <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: "rgba(125,207,210,0.18)", color: ACCENT }}>{badge}</span>
          ) : null}
        </>
      ) : null}
    </Link>
  );
}

function Header({ me, onLogout }: { me: Me | null; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inicial = (me?.email ?? "U").charAt(0).toUpperCase();

  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <header className="z-40 flex h-16 shrink-0 items-center justify-end gap-2 border-b border-slate-200 bg-white px-4 sm:px-6">
      <button className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700" aria-label="Notificaciones">
        <Bell className="h-5 w-5" />
      </button>
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 transition-colors hover:bg-slate-100"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ring-1 ring-sky-400/30" style={{ backgroundColor: "var(--zentra-sidebar)" }}>
            {inicial}
          </span>
          <span className="hidden text-left sm:block">
            <span className="block max-w-[180px] truncate text-sm font-medium text-slate-900">{me?.email ?? "Usuario"}</span>
            <span className="block text-xs text-slate-500">{rolLabel(me?.rol)}</span>
          </span>
          <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open ? (
          <div className="absolute right-0 top-full mt-1 w-48 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            <div className="border-b border-slate-100 px-4 py-2 text-sm font-medium text-slate-900">{rolLabel(me?.rol)}</div>
            <button onClick={onLogout} className="flex w-full items-center gap-2 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50 hover:text-rose-600">
              <LogOut className="h-4 w-4" /> Cerrar sesión
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
