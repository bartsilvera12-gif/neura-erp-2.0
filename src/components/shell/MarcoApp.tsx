"use client";

/**
 * Marco de la app (shell): menú lateral + cabecera + contenido. Presentacional: los módulos
 * visibles (ya filtrados por rol/perfil, receta 55), el usuario y el contenido llegan por
 * props desde `src/app/(app)/layout.tsx`. Responsive:
 *
 *   · Escritorio (≥ 1024 px): menú lateral fijo, colapsable a 72 px (se recuerda por navegador).
 *   · Tablet y celular (< 1024 px): el menú es un CAJÓN (drawer) que se abre con la hamburguesa
 *     de la cabecera: overlay, se cierra al navegar, con Escape, tocando afuera o deslizando a la
 *     izquierda; bloquea el scroll de fondo y deja el resto `inert` (el foco queda adentro y
 *     vuelve a la hamburguesa al cerrar). En tablet se eligió cajón (no un riel de íconos) para
 *     darle TODO el ancho a las tablas y formularios, que son lo que más se usa.
 *   · Cabecera compacta < 1024 px: hamburguesa · logo · buscar (abre el buscador de pantallas a
 *     pantalla completa) · campana · avatar. Tecla "/" abre el buscador en cualquier tamaño.
 *   · `100dvh` y safe-area (notch / barra de inicio) en la cabecera, el cajón y el contenido.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, LayoutDashboard, LogOut, Menu, Search, X,
} from "lucide-react";
import { coincide, filtrar } from "@/lib/busqueda";
import { MQ_ESCRITORIO, useEsEscritorio } from "@/lib/ui/responsive";
import { ORDEN_FAMILIAS } from "@/modules/registry";
import { iconoModulo } from "@/modules/icons";
import type { Modulo } from "@/modules/types";

const ACCENT = "#7dcfd2";

export type UsuarioMarco = { email?: string | null; nombre?: string | null; rol?: string; perfil?: { nombre?: string | null } | null };

function rolLabel(rol?: string) {
  const r = (rol ?? "").trim().toUpperCase();
  const m: Record<string, string> = { ADMIN: "Admin", CAJERO: "Cajero", VENDEDOR: "Vendedor", SUPERVISOR: "Supervisor" };
  return m[r] ?? (rol ? rol.charAt(0) + rol.slice(1).toLowerCase() : "Usuario");
}

const esCampoDeTexto = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function MarcoApp({
  modulos,
  cargandoMenu,
  usuario,
  pathname,
  onLogout,
  campana,
  children,
}: {
  /** módulos visibles para el perfil (ya filtrados) */
  modulos: Modulo[];
  /** /api/me todavía no llegó: esqueleto en el menú */
  cargandoMenu: boolean;
  usuario: UsuarioMarco;
  pathname: string;
  onLogout: () => void;
  /** la campana de notificaciones (slot: la página de prueba pasa una de mentira) */
  campana?: React.ReactNode;
  children: React.ReactNode;
}) {
  const esEscritorio = useEsEscritorio();
  const [collapsed, setCollapsed] = useState(false);
  const [q, setQ] = useState("");
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});
  const [menuMovil, setMenuMovil] = useState(false);
  const [buscador, setBuscador] = useState(false);
  const botonMenu = useRef<HTMLButtonElement>(null);
  const buscadorLateral = useRef<HTMLInputElement>(null);

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

  // Navegar cierra el cajón y el buscador; pasar a escritorio también.
  useEffect(() => {
    setMenuMovil(false);
    setBuscador(false);
  }, [pathname]);
  useEffect(() => {
    if (esEscritorio) setMenuMovil(false);
  }, [esEscritorio]);

  // El foco vuelve a la hamburguesa al cerrar el cajón (accesibilidad).
  const estabaAbierto = useRef(false);
  useEffect(() => {
    if (estabaAbierto.current && !menuMovil) botonMenu.current?.focus({ preventScroll: true });
    estabaAbierto.current = menuMovil;
  }, [menuMovil]);

  // Escape cierra el cajón / buscador. "/" abre la búsqueda (fuera de un campo de texto).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && (menuMovil || buscador)) {
        setMenuMovil(false);
        setBuscador(false);
        return;
      }
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || esCampoDeTexto(e.target)) return;
      if (document.querySelector("[data-capa-modal]")) return;
      e.preventDefault();
      if (window.matchMedia(MQ_ESCRITORIO).matches) {
        setCollapsed(false);
        window.setTimeout(() => buscadorLateral.current?.focus(), 0);
      } else {
        setBuscador(true);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [menuMovil, buscador]);

  const itemActivo = useMemo(() => {
    const largo = (h: string) => { const base = h.split("?")[0]; return pathname === base || pathname.startsWith(`${base}/`) ? base.length : -1; };
    let mejor: { id: string; n: number } | null = null;
    for (const m of modulos) {
      const n = Math.max(largo(m.href), ...(m.children ?? []).map((c) => largo(c.href)));
      if (n >= 0 && (!mejor || n > mejor.n)) mejor = { id: m.id, n };
    }
    return mejor?.id ?? null;
  }, [modulos, pathname]);

  const familias = useMemo(() => agruparPorFamilia(modulos, q), [modulos, q]);
  const toggle = useCallback((id: string, abierto: boolean) => setAbiertos((p) => ({ ...p, [id]: !abierto })), []);
  const tapado = menuMovil || buscador;

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Menú lateral de escritorio */}
      <aside
        className="hidden h-full shrink-0 flex-col text-slate-300 transition-[width] duration-200 lg:flex"
        style={{ width: collapsed ? 72 : 236, backgroundColor: "var(--zentra-sidebar)" }}
      >
        <div
          className={`relative flex shrink-0 items-center border-b ${collapsed ? "h-16 justify-center gap-1 px-1" : "h-28 justify-center px-3"}`}
          style={{ borderColor: "var(--zentra-sidebar-border)", backgroundColor: "rgba(16,74,78,0.35)" }}
        >
          <Logo collapsed={collapsed} />
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className={`shrink-0 rounded-md text-slate-400 transition-colors hover:bg-white/10 hover:text-white ${collapsed ? "p-1" : "absolute right-3 top-3 p-1.5"}`}
            aria-label={collapsed ? "Expandir menú" : "Colapsar menú"}
          >
            {collapsed ? <ChevronsRight className="h-[18px] w-[18px]" /> : <ChevronsLeft className="h-[18px] w-[18px]" />}
          </button>
        </div>
        {collapsed ? null : <BuscadorMenu q={q} setQ={setQ} inputRef={buscadorLateral} />}
        <NavMenu
          familias={familias} pathname={pathname} itemActivo={itemActivo} collapsed={collapsed} abiertos={abiertos}
          q={q} onToggle={toggle} cargando={cargandoMenu} movil={false}
        />
      </aside>

      {/* Cajón de tablet / celular */}
      {!esEscritorio ? (
        <CajonMenu abierto={menuMovil} onCerrar={() => setMenuMovil(false)}>
          <BuscadorMenu q={q} setQ={setQ} movil />
          <NavMenu
            familias={familias} pathname={pathname} itemActivo={itemActivo} collapsed={false} abiertos={abiertos}
            q={q} onToggle={toggle} cargando={cargandoMenu} movil
          />
        </CajonMenu>
      ) : null}

      {/* Contenido (inerte mientras el cajón o el buscador están abiertos) */}
      <div className="flex min-w-0 flex-1 flex-col" inert={tapado}>
        <Cabecera
          usuario={usuario}
          onLogout={onLogout}
          campana={campana}
          menuAbierto={menuMovil}
          onMenu={() => setMenuMovil(true)}
          onBuscar={() => setBuscador(true)}
          botonMenu={botonMenu}
        />
        <main
          className={`min-w-0 flex-1 overflow-x-hidden overscroll-contain bg-[#f6f8fa] px-3 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-4 sm:pt-5 lg:p-6 ${tapado ? "overflow-y-hidden" : "overflow-y-auto"}`}
        >
          <div className="animate-in mx-auto max-w-[1400px]">{children}</div>
        </main>
      </div>

      {buscador ? <BuscadorPantallas modulos={modulos} onCerrar={() => setBuscador(false)} /> : null}
    </div>
  );
}

function agruparPorFamilia(modulos: Modulo[], q: string) {
  // Búsqueda inteligente: sin tildes, errores de tipeo; también por la familia ("finanzas").
  // Busca en el módulo, su familia y sus sub-pantallas ("arqueo" → Caja › Arqueo / Cierre).
  const visibles = filtrar(modulos, q, (m) => ({ principal: m.label, otros: [m.familia, ...(m.children ?? []).map((c) => c.label)] }));
  const map = new Map<string, Modulo[]>();
  for (const m of visibles) {
    const fam = m.familia ?? "General";
    if (!map.has(fam)) map.set(fam, []);
    map.get(fam)!.push(m);
  }
  return [...map.entries()].sort((a, b) => (ORDEN_FAMILIAS.indexOf(a[0]) + 1 || 99) - (ORDEN_FAMILIAS.indexOf(b[0]) + 1 || 99));
}

function Logo({ collapsed }: { collapsed: boolean }) {
  return (
    <Link href="/" className="flex items-center justify-center" aria-label="Inicio">
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
  );
}

function BuscadorMenu({ q, setQ, movil = false, inputRef }: { q: string; setQ: (v: string) => void; movil?: boolean; inputRef?: React.Ref<HTMLInputElement> }) {
  return (
    <div className="px-3 pt-3">
      <div className="group relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 transition-colors group-focus-within:text-[var(--zentra-accent)]" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar…"
          aria-label="Buscar en el menú"
          enterKeyHint="search"
          className={`w-full rounded-lg border border-white/[0.08] bg-black/20 pl-9 pr-9 text-white outline-none transition placeholder:text-slate-500 focus:border-[var(--zentra-accent)]/40 focus:bg-black/30 ${movil ? "h-11 text-[15px]" : "py-2 text-[13px]"}`}
        />
        {q ? (
          <button type="button" onClick={() => setQ("")} aria-label="Limpiar búsqueda"
            className="absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        ) : movil ? null : (
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-white/10 px-1.5 py-0.5 text-[11px] text-slate-500">/</kbd>
        )}
      </div>
    </div>
  );
}

function NavMenu({
  familias, pathname, itemActivo, collapsed, abiertos, q, onToggle, cargando, movil,
}: {
  familias: [string, Modulo[]][];
  pathname: string;
  itemActivo: string | null;
  collapsed: boolean;
  abiertos: Record<string, boolean>;
  q: string;
  onToggle: (id: string, abierto: boolean) => void;
  cargando: boolean;
  movil: boolean;
}) {
  return (
    <nav aria-label="Menú principal" className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 py-3 ${movil ? "pb-[calc(1rem+env(safe-area-inset-bottom))]" : ""}`}>
      <NavItem href="/" label="Inicio" Icon={LayoutDashboard} active={pathname === "/"} collapsed={collapsed} movil={movil} />
      {cargando ? (
        <div className="mt-4 space-y-2 px-1" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={`h-8 animate-pulse rounded-lg bg-white/[0.05] ${collapsed ? "mx-auto w-8" : ""}`} />
          ))}
        </div>
      ) : null}
      {!cargando && q.trim() && familias.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-slate-400">Nada coincide con “{q.trim()}”.</p>
      ) : null}
      {familias.map(([fam, items]) => (
        <div key={fam} className="mt-4">
          {!collapsed ? (
            <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{fam}</p>
          ) : (
            <div className="mx-auto mb-2 h-px w-6 bg-white/10" />
          )}
          {items.map((m) => {
            // Activo: el ítem cuya ruta (o la de un hijo) es el prefijo MÁS LARGO de la página
            // actual, entre todos los del menú (/clientes/gestion marca "Gestión Clientes",
            // no "Clientes"; /clientes/<id> marca "Clientes").
            const active = m.id === itemActivo;
            // Con panel propio (ej. Configuración, Finanzas) las sub-pantallas son tarjetas del
            // panel; buscando, se despliegan las que coinciden para ir directo a ellas
            // ("nueva venta" → Finanzas › Nueva venta).
            const hijos = !m.children?.length ? [] : !m.panel ? m.children : q.trim() ? m.children.filter((c) => coincide(q, { principal: c.label })) : [];
            const tieneHijos = hijos.length > 0;
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
                  onToggle={() => onToggle(m.id, abierto)}
                  movil={movil}
                />
                {tieneHijos && !collapsed ? (
                  <div
                    className="overflow-hidden transition-[grid-template-rows] duration-200"
                    style={{ display: "grid", gridTemplateRows: abierto ? "1fr" : "0fr" }}
                  >
                    <div className="min-h-0" inert={!abierto}>
                      <div className="relative ml-[30px] mt-1 space-y-1 pl-3">
                        <span className="absolute left-0 top-1 bottom-1 w-px bg-white/10" />
                        {hijos.map((c) => {
                          // Activo: ruta exacta, o la sub-página del hijo con el prefijo más largo
                          // (/reportes/cajas/<id> marca "Cierres de caja", no "Todos los reportes").
                          const coincideRuta = (h: string) => pathname === h || pathname.startsWith(`${h}/`);
                          const mejor = hijos.filter((x) => coincideRuta(x.href)).sort((a, b) => b.href.length - a.href.length)[0];
                          const ca = mejor?.href === c.href;
                          return (
                            <Link
                              key={c.href}
                              href={c.href}
                              aria-current={ca ? "page" : undefined}
                              className={`relative flex items-center rounded-lg px-3 transition-all ${movil ? "min-h-11 text-[14px]" : "py-2 text-[13px]"} ${ca ? "font-medium text-white" : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"}`}
                              style={ca ? { backgroundColor: "rgba(125,207,210,0.14)" } : undefined}
                            >
                              {ca ? (
                                <span className="absolute -left-[13px] top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full" style={{ backgroundColor: ACCENT, boxShadow: `0 0 8px ${ACCENT}` }} />
                              ) : null}
                              <span className="min-w-0 truncate">{c.label}</span>
                              {c.seccion ? <span className="ml-1.5 min-w-0 shrink truncate text-[11px] text-slate-500">· {c.seccion}</span> : null}
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
  );
}

function NavItem({
  href, label, Icon, active, collapsed, badge, hasChildren, abierto, onToggle, movil,
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
  movil: boolean;
}) {
  const rowClass = `group flex items-center rounded-lg transition-colors ${movil ? "min-h-11 text-[15px]" : "text-[14px]"} ${collapsed ? "justify-center px-0 py-2.5" : `gap-3 px-3 ${movil ? "" : "py-2"}`} ${
    active ? "text-white" : "text-slate-300 hover:bg-white/[0.05] hover:text-white"
  }`;
  const rowStyle = active ? { backgroundColor: "rgba(255,255,255,0.07)" } : undefined;
  const icon = <Icon className="h-[18px] w-[18px] shrink-0 transition-colors" style={{ color: active ? ACCENT : "#8aa3a4" }} />;
  const flecha = <ChevronRight className={`h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200 ${abierto ? "rotate-90" : ""}`} />;

  // Cajón (tablet/celular): un ítem con submenú sólo pliega/despliega (su pantalla está entre
  // los hijos); si navegara, el cajón se cerraría antes de ver las sub-pantallas.
  if (hasChildren && !collapsed && movil) {
    return (
      <button type="button" onClick={onToggle} aria-expanded={abierto} className={`${rowClass} w-full text-left`} style={rowStyle}>
        {icon}
        <span className="flex-1 truncate">{label}</span>
        {flecha}
      </button>
    );
  }

  // Escritorio, item con submenú: TODA la fila navega y pliega/despliega (no solo la flecha).
  if (hasChildren && !collapsed) {
    return (
      <Link href={href} title={label} onClick={onToggle} className={`${rowClass} cursor-pointer`} style={rowStyle}>
        {icon}
        <span className="flex-1 truncate">{label}</span>
        {flecha}
      </Link>
    );
  }

  return (
    <Link href={href} title={label} aria-current={active ? "page" : undefined} className={rowClass} style={rowStyle}>
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

/** Cajón lateral (< 1024 px): overlay, deslizar a la izquierda para cerrar, foco adentro. */
function CajonMenu({ abierto, onCerrar, children }: { abierto: boolean; onCerrar: () => void; children: React.ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const cerrarBtn = useRef<HTMLButtonElement>(null);
  const toque = useRef<{ x: number; y: number; horizontal: boolean | null } | null>(null);
  const [arrastre, setArrastre] = useState(0);

  // Al abrir, el foco va al botón de cerrar (lectores de pantalla / teclado).
  useEffect(() => {
    if (!abierto) return;
    const t = window.setTimeout(() => cerrarBtn.current?.focus({ preventScroll: true }), 60);
    return () => window.clearTimeout(t);
  }, [abierto]);

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    toque.current = { x: t.clientX, y: t.clientY, horizontal: null };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const s = toque.current;
    if (!s) return;
    const t = e.touches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    // Decide el eje con los primeros 10 px: vertical = scroll normal del menú.
    if (s.horizontal === null && Math.hypot(dx, dy) > 10) s.horizontal = Math.abs(dx) > Math.abs(dy);
    if (s.horizontal) setArrastre(Math.min(0, dx));
  };
  const onTouchEnd = () => {
    const ancho = panel.current?.offsetWidth ?? 300;
    if (arrastre < -Math.min(80, ancho * 0.3)) onCerrar();
    setArrastre(0);
    toque.current = null;
  };

  return (
    <div className={`fixed inset-0 z-[70] overflow-hidden lg:hidden ${abierto ? "" : "pointer-events-none"}`} aria-hidden={!abierto}>
      <div
        className={`absolute inset-0 bg-slate-900/50 backdrop-blur-[1px] transition-opacity duration-200 ${abierto ? "opacity-100" : "opacity-0"}`}
        style={abierto && arrastre ? { opacity: 1 + arrastre / 400 } : undefined}
        onClick={onCerrar}
      />
      <div
        ref={panel}
        id="menu-movil"
        role="dialog"
        aria-modal="true"
        aria-label="Menú"
        inert={!abierto}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        className={`pt-safe absolute inset-y-0 left-0 flex w-[min(300px,86vw)] flex-col text-slate-300 shadow-2xl ${arrastre ? "" : "transition-transform duration-[250ms] ease-[cubic-bezier(0.16,1,0.3,1)]"}`}
        style={{ backgroundColor: "var(--zentra-sidebar)", transform: abierto ? `translateX(${arrastre}px)` : "translateX(-100%)" }}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b pl-4 pr-2" style={{ borderColor: "var(--zentra-sidebar-border)", backgroundColor: "rgba(16,74,78,0.35)" }}>
          <Link href="/" aria-label="Inicio" className="flex items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/zentra-logo-360.webp" alt="ZENTRA" width={360} height={185} decoding="async" className="h-10 w-auto object-contain" />
          </Link>
          <button ref={cerrarBtn} type="button" onClick={onCerrar} aria-label="Cerrar menú"
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-white/10 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Cabecera({
  usuario, onLogout, campana, menuAbierto, onMenu, onBuscar, botonMenu,
}: {
  usuario: UsuarioMarco;
  onLogout: () => void;
  campana?: React.ReactNode;
  menuAbierto: boolean;
  onMenu: () => void;
  onBuscar: () => void;
  botonMenu: React.Ref<HTMLButtonElement>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inicial = (usuario.email ?? "U").charAt(0).toUpperCase();
  const perfil = usuario.perfil?.nombre ?? rolLabel(usuario.rol);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", esc); };
  }, [open]);

  return (
    <header className="pt-safe z-40 shrink-0 border-b border-slate-200 bg-white">
      <div className="flex h-14 items-center gap-1 px-1.5 sm:px-3 lg:h-16 lg:justify-end lg:gap-2 lg:px-6">
        {/* Tablet / celular: hamburguesa + logo */}
        <button ref={botonMenu} type="button" onClick={onMenu} aria-label="Abrir menú" aria-expanded={menuAbierto} aria-controls="menu-movil"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 lg:hidden">
          <Menu className="h-[22px] w-[22px]" />
        </button>
        <Link href="/" aria-label="Inicio" className="flex h-9 shrink-0 items-center rounded-lg px-2 lg:hidden" style={{ backgroundColor: "var(--zentra-sidebar)" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/zentra-logo-360.webp" alt="ZENTRA" width={360} height={185} decoding="async" className="h-7 w-auto object-contain" />
        </Link>
        <div className="flex-1 lg:hidden" />
        <button type="button" onClick={onBuscar} aria-label="Buscar pantalla"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 lg:hidden">
          <Search className="h-5 w-5" />
        </button>
        {campana}
        <div className="relative" ref={ref}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label="Cuenta"
            className="flex h-11 items-center gap-2 rounded-lg px-1.5 transition-colors hover:bg-slate-100 lg:h-auto lg:border lg:border-slate-200 lg:bg-slate-50 lg:px-3 lg:py-2"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ring-1 ring-sky-400/30" style={{ backgroundColor: "var(--zentra-sidebar)" }}>
              {inicial}
            </span>
            <span className="hidden text-left lg:block">
              <span className="block max-w-[180px] truncate text-sm font-medium text-slate-900">{usuario.email ?? "Usuario"}</span>
              <span className="block text-xs text-slate-500">{perfil}</span>
            </span>
            <ChevronDown className={`hidden h-4 w-4 text-slate-500 transition-transform lg:block ${open ? "rotate-180" : ""}`} />
          </button>
          {open ? (
            <div role="menu" className="absolute right-0 top-full z-50 mt-1 w-60 max-w-[calc(100vw-1rem)] rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
              <div className="border-b border-slate-100 px-4 py-2.5">
                <p className="truncate text-sm font-medium text-slate-900">{usuario.nombre || usuario.email || "Usuario"}</p>
                {usuario.nombre && usuario.email ? <p className="truncate text-xs text-slate-500">{usuario.email}</p> : null}
                <p className="text-xs text-slate-500">Perfil: {perfil}</p>
              </div>
              <button role="menuitem" onClick={onLogout} className="flex min-h-11 w-full items-center gap-2 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50 hover:text-rose-600 lg:min-h-0">
                <LogOut className="h-4 w-4" /> Cerrar sesión
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

/**
 * Buscador de pantallas a pantalla completa (< 1024 px, o tecla "/"): lista plana de módulos
 * y sub-pantallas que coinciden; Enter abre la primera. Sólo muestra lo que el perfil ve.
 */
function BuscadorPantallas({ modulos, onCerrar }: { modulos: Modulo[]; onCerrar: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);

  const resultados = useMemo(() => {
    const lista: { href: string; label: string; contexto: string; icon?: string }[] = [];
    const vistos = new Set<string>();
    const add = (r: (typeof lista)[number]) => { if (!vistos.has(r.href)) { vistos.add(r.href); lista.push(r); } };
    const qq = q.trim();
    if (!qq) add({ href: "/", label: "Inicio", contexto: "General" });
    for (const [fam, items] of agruparPorFamilia(modulos, qq)) {
      for (const m of items) {
        const hijos = m.children ?? [];
        // Con búsqueda: las sub-pantallas que coinciden (o todas, si coincide el módulo).
        const coinciden = qq ? hijos.filter((c) => coincide(qq, { principal: c.label })) : hijos;
        // El panel (ej. Finanzas) va primero solo si lo buscado es él (o no coincide ninguna
        // pantalla): "nueva venta" + Enter abre Nueva venta, no el panel de Finanzas.
        if (!hijos.length || (m.panel && (!qq || !coinciden.length || coincide(qq, { principal: m.label })))) add({ href: m.href, label: m.label, contexto: fam, icon: m.icon });
        if (!hijos.length) continue;
        for (const c of coinciden.length ? coinciden : hijos) {
          const contexto = c.label === m.label ? fam : c.seccion ? `${m.label} › ${c.seccion}` : m.label;
          add({ href: c.href, label: c.label, contexto, icon: m.icon });
        }
      }
    }
    return lista;
  }, [modulos, q]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Buscar pantalla" className="pt-safe fixed inset-0 z-[80] flex flex-col bg-white" style={{ animation: "modal-backdrop 0.15s ease-out" }}>
      <form
        className="flex shrink-0 items-center gap-1 border-b border-slate-200 px-1.5 py-1.5"
        onSubmit={(e) => { e.preventDefault(); if (resultados[0]) { router.push(resultados[0].href); onCerrar(); } }}
      >
        <button type="button" onClick={onCerrar} aria-label="Cerrar búsqueda" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <input
          ref={input}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar pantalla (ej. arqueo, clientes)…"
          aria-label="Buscar pantalla"
          enterKeyHint="go"
          className="h-11 min-w-0 flex-1 rounded-lg bg-slate-100 px-3 text-base text-slate-900 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-[var(--brand-100)]"
        />
      </form>
      <ul className="pb-safe min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
        {resultados.length === 0 ? (
          <li className="px-6 py-10 text-center text-sm text-slate-500">Nada coincide con “{q.trim()}”.</li>
        ) : resultados.map((r) => {
          const Icono = r.icon ? iconoModulo(r.icon) : LayoutDashboard;
          return (
            <li key={r.href}>
              <Link href={r.href} onClick={onCerrar} className="flex min-h-14 items-center gap-3 px-4 py-2 active:bg-slate-50">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-50)] text-[var(--brand)]">
                  <Icono className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-slate-900">{r.label}</span>
                  <span className="block truncate text-xs text-slate-500">{r.contexto}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
