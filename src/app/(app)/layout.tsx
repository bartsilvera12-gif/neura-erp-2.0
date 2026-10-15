"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { filtrar } from "@/lib/busqueda";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  LayoutDashboard,
  LogOut,
  Search,
  ShieldAlert,
} from "lucide-react";
import { browserClient } from "@/lib/supabase/browser";
import { apiFetchCache, limpiarCache } from "@/lib/api/cache-cliente";
import { ProveedorUsuario, type Usuario } from "@/lib/sesion/ContextoUsuario";
import { modulosDelPerfil, ORDEN_FAMILIAS, pantallaDeRuta, perfilVePantalla } from "@/modules/registry";
import { iconoModulo } from "@/modules/icons";
import type { Modulo } from "@/modules/types";
import { NotificacionesBell } from "@/modules/notificaciones/NotificacionesBell";

type Me = Usuario;
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
  // Sesión conocida (getSession es local, sin red). Con eso ya se montan las páginas:
  // /api/me llega en paralelo y se reparte por contexto (useUsuario).
  const [ready, setReady] = useState(false);
  const [emailSesion, setEmailSesion] = useState<string | null>(null);
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

  const itemActivo = useMemo(() => {
    const largo = (h: string) => { const base = h.split("?")[0]; return pathname === base || pathname.startsWith(`${base}/`) ? base.length : -1; };
    let mejor: { id: string; n: number } | null = null;
    for (const m of modulos) {
      const n = Math.max(largo(m.href), ...(m.children ?? []).map((c) => largo(c.href)));
      if (n >= 0 && (!mejor || n > mejor.n)) mejor = { id: m.id, n };
    }
    return mejor?.id ?? null;
  }, [modulos, pathname]);

  const familias = useMemo(() => {
    // Búsqueda inteligente: sin tildes, errores de tipeo; también por la familia ("finanzas").
    // Busca en el módulo, su familia y sus sub-pantallas ("arqueo" → Caja › Arqueo / Cierre).
    const visibles = filtrar(modulos, q, (m) => ({ principal: m.label, otros: [m.familia, ...(m.children ?? []).map((c) => c.label)] }));
    const orden = ORDEN_FAMILIAS;
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
              src="/brand/zentra-logo-360.webp"
              alt="ZENTRA"
              width={360}
              height={185}
              decoding="async"
              fetchPriority="high"
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
          {me === null ? (
            <div className="mt-4 space-y-2 px-1" aria-hidden>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className={`h-8 animate-pulse rounded-lg bg-white/[0.05] ${collapsed ? "mx-auto w-8" : ""}`} />
              ))}
            </div>
          ) : null}
          {familias.map(([fam, items]) => (
            <div key={fam} className="mt-4">
              {!collapsed ? (
                <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{fam}</p>
              ) : (
                <div className="mx-auto mb-2 h-px w-6 bg-white/10" />
              )}
              {items.map((m) => {
                // Activo también si se está en una sub-pantalla con otra ruta (Compras › Proveedores).
                // Activo: el ítem cuya ruta (o la de un hijo) es el prefijo MÁS LARGO de la página
                // actual, entre todos los del menú (/clientes/gestion marca "Gestión Clientes",
                // no "Clientes"; /clientes/<id> marca "Clientes").
                const active = m.id === itemActivo;
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
        <Header
          me={me ?? { rol: "", email: emailSesion }}
          onLogout={async () => { await browserClient().auth.signOut(); limpiarCache(); router.replace("/login"); }}
        />
        <main className="min-w-0 flex-1 overflow-y-auto bg-[#f6f8fa] p-6">
          <ProveedorUsuario value={me}>
            <div className="animate-in mx-auto max-w-[1400px]">
              {pantallaBloqueada ? <SinAcceso pantalla={`${pantallaBloqueada.moduloLabel}${pantallaBloqueada.label !== pantallaBloqueada.moduloLabel ? ` › ${pantallaBloqueada.label}` : ""}`} perfil={perfil?.nombre ?? null} /> : children}
            </div>
          </ProveedorUsuario>
        </main>
      </div>
    </div>
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
      <Link href="/" className="mt-5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 no-underline hover:bg-slate-50">
        Volver al inicio
      </Link>
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
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
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
      <NotificacionesBell />
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
            <span className="block text-xs text-slate-500">{me?.perfil?.nombre ?? rolLabel(me?.rol)}</span>
          </span>
          <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open ? (
          <div className="absolute right-0 top-full mt-1 w-48 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            <div className="border-b border-slate-100 px-4 py-2">
              <p className="truncate text-sm font-medium text-slate-900">{me?.nombre || me?.email || "Usuario"}</p>
              <p className="text-xs text-slate-500">Perfil: {me?.perfil?.nombre ?? rolLabel(me?.rol)}</p>
            </div>
            <button onClick={onLogout} className="flex w-full items-center gap-2 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50 hover:text-rose-600">
              <LogOut className="h-4 w-4" /> Cerrar sesión
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
