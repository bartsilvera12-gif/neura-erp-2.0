"use client";

/** Tipos, llamadas y piezas chicas de Configuración › Usuarios. */
import { Check, Minus } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { invalidar } from "@/lib/api/cache-cliente";
import { TEAL } from "@/modules/inventario/ui";

export { TEAL };

export type UsuarioFila = {
  id: string;
  nombre: string;
  nombres: string;
  apellidos: string | null;
  ci: string | null;
  telefono: string | null;
  email: string | null;
  rol: string;
  perfil_id: string | null;
  perfil_nombre: string | null;
  perfil_codigo: string | null;
  sucursal_id: string | null;
  sucursal_nombre: string | null;
  activo: boolean;
  es_tecnico: boolean;
  es_qa: boolean;
  usa_soporte: boolean;
  origen: "invitado" | "vinculado" | "existente";
  creado_at: string;
  invitado_at: string | null;
  updated_at: string | null;
  ultimo_ingreso: string | null;
  email_confirmado: boolean;
  pendiente: boolean;
  sin_cuenta: boolean;
  es_yo: boolean;
};

export type PerfilMin = { id: string; nombre: string; codigo: string | null; sistema: boolean; nivel_base: string; alcance_sucursal: "propia" | "todas" };
export type SucursalMin = { id: string; nombre: string; activa: boolean; es_principal: boolean };

/** Cupo de usuarios del plan (receta 76): activos (incluye invitaciones pendientes) vs. límite. */
export type CupoUsuarios = { limite: number; usados: number; disponibles: number; excedido: boolean };

export type DatosUsuarios = {
  mi_usuario_id: string;
  cupo?: CupoUsuarios;
  usuarios: UsuarioFila[];
  perfiles: PerfilMin[];
  sucursales: SucursalMin[];
};

export type PerfilCompleto = {
  id: string;
  nombre: string;
  descripcion: string | null;
  codigo: string | null;
  sistema: boolean;
  nivel_base: "ADMIN" | "SUPERVISOR" | "CAJERO" | "VENDEDOR";
  alcance_sucursal: "propia" | "todas";
  tope_descuento_pct: number | null;
  todo: boolean;
  pantallas: string[];
  permisos: string[];
  usuarios: number;
  usuarios_inactivos: number;
  updated_at: string;
};

export type EventoHistorial = {
  id: string;
  objeto: "usuario" | "perfil";
  usuario_id: string | null;
  perfil_id: string | null;
  nombre: string | null;
  accion: string;
  detalle: Record<string, unknown>;
  actor_nombre: string | null;
  created_at: string;
};

export const URL_USUARIOS = "/api/configuracion/usuarios";
export const URL_PERFILES = "/api/configuracion/perfiles";

/** Después de un cambio: listas frescas y el /api/me propio (por si cambió mi perfil). */
export function invalidarTodo() {
  invalidar(URL_USUARIOS);
  invalidar(URL_PERFILES);
  invalidar("/api/me");
  invalidar("/api/usuarios");
}

export const api = {
  crear: (body: unknown) =>
    apiFetch<{ estado: "invitado" | "link" | "existe" | "vinculado"; id?: string; link?: string | null; email?: string }>(URL_USUARIOS, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  editar: (id: string, body: unknown) => apiFetch<{ id: string; cambios: number }>(`${URL_USUARIOS}/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  acceso: (id: string, accion: "enviar_invitacion" | "link_invitacion" | "enviar_restablecer" | "link_restablecer") =>
    apiFetch<{ accion: string; link: string | null; email: string }>(`${URL_USUARIOS}/${id}/acceso`, { method: "POST", body: JSON.stringify({ accion }) }),
  guardarPerfil: (body: unknown) => apiFetch<{ id: string; cambios: number }>(URL_PERFILES, { method: "POST", body: JSON.stringify(body) }),
  eliminarPerfil: (id: string) => apiFetch<{ id: string }>(`${URL_PERFILES}/${id}`, { method: "DELETE" }),
};

// ── Fechas ───────────────────────────────────────────────────────────────────
const TZ = "America/Asuncion";
export function fechaHora(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-PY", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** "hace 5 min", "ayer", "hace 3 días", o la fecha. */
export function haceCuanto(iso: string | null | undefined): string {
  if (!iso) return "Nunca";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return "Recién";
  if (min < 60) return `Hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `Hace ${h} h`;
  const d = Math.round(h / 24);
  if (d === 1) return "Ayer";
  if (d < 30) return `Hace ${d} días`;
  return new Date(iso).toLocaleDateString("es-PY", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric" });
}

// ── Estado del usuario ──────────────────────────────────────────────────────
export type Estado = "activo" | "pendiente" | "inactivo";
export const estadoDe = (u: Pick<UsuarioFila, "activo" | "pendiente">): Estado => (!u.activo ? "inactivo" : u.pendiente ? "pendiente" : "activo");

export const ESTADOS: Record<Estado, { label: string; clase: string; punto: string }> = {
  activo: { label: "Activo", clase: "bg-emerald-50 text-emerald-700 ring-emerald-200", punto: "bg-emerald-500" },
  pendiente: { label: "Invitación pendiente", clase: "bg-amber-50 text-amber-700 ring-amber-200", punto: "bg-amber-500" },
  inactivo: { label: "Inactivo", clase: "bg-slate-100 text-slate-500 ring-slate-200", punto: "bg-slate-400" },
};

export function PillEstado({ estado }: { estado: Estado }) {
  const e = ESTADOS[estado];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${e.clase}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${e.punto}`} />
      {e.label}
    </span>
  );
}

const COLORES_AVATAR = ["#3F8E91", "#4FAEB2", "#2B6467", "#0E7490", "#7C3AED", "#B45309", "#BE185D", "#15803D"];
export function Avatar({ nombre, tenue = false, size = 36 }: { nombre: string; tenue?: boolean; size?: number }) {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  const ini = ((partes[0]?.[0] ?? "?") + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase();
  let h = 0;
  for (const c of nombre) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${tenue ? "opacity-50 grayscale" : ""}`}
      style={{ width: size, height: size, fontSize: size * 0.36, backgroundColor: COLORES_AVATAR[h % COLORES_AVATAR.length] }}
    >
      {ini}
    </span>
  );
}

/** Insignia del perfil (Administrador azul; los sembrados que conservan su código, color de marca; el resto, violeta). */
export function InsigniaPerfil({ nombre, codigo }: { nombre: string | null; codigo: string | null }) {
  const color =
    codigo === "ADMIN" ? "bg-[#023047]/[0.08] text-[#023047] ring-[#023047]/15"
    : codigo ? "bg-[var(--brand-50)] text-[var(--brand-700)] ring-[var(--brand-100)]"
    : "bg-violet-50 text-violet-700 ring-violet-200";
  return <span className={`inline-flex max-w-[180px] items-center truncate rounded-md max-md:max-w-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${color}`}>{nombre ?? "Sin perfil"}</span>;
}

/** Casilla con estado intermedio (para "seleccionar todo" de una familia). */
export function Casilla({ estado, disabled, onClick, etiqueta }: { estado: boolean | "algunos"; disabled?: boolean; onClick?: () => void; etiqueta: string }) {
  const marcado = estado === true;
  const parcial = estado === "algunos";
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={parcial ? "mixed" : marcado}
      aria-label={etiqueta}
      disabled={disabled}
      onClick={onClick}
      // En celular la casilla mide 22 px y su zona de toque se agranda a 44 × 44 (pseudo-elemento).
      className={`relative flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 max-sm:h-[22px] max-sm:w-[22px] max-sm:before:absolute max-sm:before:-inset-[11px] max-sm:before:content-[''] ${
        marcado || parcial ? "border-transparent text-white" : "border-slate-300 bg-white hover:border-[var(--brand)]"
      }`}
      style={marcado || parcial ? { backgroundColor: TEAL } : undefined}
    >
      {marcado ? <Check className="h-3 w-3 max-sm:h-3.5 max-sm:w-3.5" strokeWidth={3} /> : parcial ? <Minus className="h-3 w-3 max-sm:h-3.5 max-sm:w-3.5" strokeWidth={3} /> : null}
    </button>
  );
}

/** Interruptor con título y detalle (mismo estilo que Depósitos). */
export function Interruptor({ checked, disabled, onChange, label, detalle }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string; detalle?: React.ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
      className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-left transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {detalle ? <span className="block text-[11px] text-slate-500">{detalle}</span> : null}
      </span>
      <span className="relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200" style={{ backgroundColor: checked ? TEAL : "#cbd5e1" }}>
        <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left] duration-200" style={{ left: checked ? 18 : 2 }} />
      </span>
    </button>
  );
}

/** Copia al portapapeles (con alternativa para navegadores sin permiso). */
export async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = texto;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Mensaje de WhatsApp con el link (sin número: lo elige quien lo manda). */
export function linkWhatsApp(nombre: string, link: string, tipo: "invitacion" | "restablecer", empresa: string, telefono?: string | null): string {
  const texto =
    tipo === "invitacion"
      ? `Hola ${nombre.split(" ")[0]}! Te creé un usuario en ${empresa}. Entrá a este link para elegir tu contraseña: ${link}`
      : `Hola ${nombre.split(" ")[0]}! Para poner una contraseña nueva en ${empresa}, entrá a este link: ${link}`;
  const tel = (telefono ?? "").replace(/\D/g, "");
  const numero = tel.startsWith("09") ? `595${tel.slice(1)}` : tel.startsWith("595") ? tel : "";
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}
