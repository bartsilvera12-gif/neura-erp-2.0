"use client";

/** "Este perfil ve…": el menú que va a tener y lo que puede (y no) hacer. */
import { Building2, Check, Eye, Percent, X } from "lucide-react";
import { ORDEN_FAMILIAS, pantallasCatalogo, perfilVePantalla, type Pantalla } from "@/modules/registry";
import { GRUPOS_PERMISOS, permisoAplica, type PerfilSesion } from "@/modules/usuarios/permisos";
import { iconoModulo } from "@/modules/icons";

export type PerfilBorrador = {
  nivel_base: string;
  alcance_sucursal: "propia" | "todas";
  tope_descuento_pct: number | null;
  pantallas: string[];
  permisos: string[];
  todo: boolean;
};

/** Menú (familia → módulo → pantallas) que vería el perfil. */
export function menuDelPerfil(b: PerfilBorrador, catalogo: Pantalla[] = pantallasCatalogo()) {
  const sesion: PerfilSesion = {
    id: null, nombre: null, codigo: b.todo ? "ADMIN" : null, todo: b.todo, alcance: b.alcance_sucursal,
    tope_descuento_pct: b.tope_descuento_pct, pantallas: b.pantallas, permisos: b.permisos,
  };
  const visibles = catalogo.filter((p) => perfilVePantalla(p, b.nivel_base, sesion));
  const familias = new Map<string, Map<string, { label: string; icon?: string; pantallas: Pantalla[] }>>();
  for (const p of visibles) {
    if (!familias.has(p.familia)) familias.set(p.familia, new Map());
    const mods = familias.get(p.familia)!;
    if (!mods.has(p.moduloId)) mods.set(p.moduloId, { label: p.moduloLabel, icon: p.icon, pantallas: [] });
    mods.get(p.moduloId)!.pantallas.push(p);
  }
  return [...familias.entries()]
    .sort((a, z) => (ORDEN_FAMILIAS.indexOf(a[0]) + 1 || 99) - (ORDEN_FAMILIAS.indexOf(z[0]) + 1 || 99))
    .map(([familia, mods]) => ({ familia, modulos: [...mods.values()] }));
}

export function VistaPrevia({ b, compacta = false }: { b: PerfilBorrador; compacta?: boolean }) {
  const menu = menuDelPerfil(b);
  const total = menu.reduce((n, f) => n + f.modulos.reduce((m, x) => m + x.pantallas.length, 0), 0);
  const permisos = GRUPOS_PERMISOS.flatMap((g) => g.permisos).filter((p) => permisoAplica(p, b.nivel_base));
  const si = permisos.filter((p) => b.todo || b.permisos.includes(p.id));
  const no = permisos.filter((p) => !(b.todo || b.permisos.includes(p.id)) && p.sensible);

  return (
    <div className="space-y-4 text-[13px]">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
        <Eye className="h-3.5 w-3.5" /> Este perfil ve…
      </div>

      <div className="rounded-xl border border-slate-200 bg-[var(--zentra-sidebar,#0f3e41)] p-3 text-slate-300">
        {total === 0 ? (
          <p className="py-2 text-center text-xs text-slate-400">Solo el Inicio. Marcá pantallas para armar su menú.</p>
        ) : (
          <div className={`space-y-2.5 ${compacta ? "max-h-56" : "max-h-[340px]"} overflow-y-auto pr-1`}>
            {menu.map((f) => (
              <div key={f.familia}>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{f.familia}</p>
                {f.modulos.map((m) => {
                  const Icono = iconoModulo(m.icon);
                  const sub = m.pantallas.length > 1 || m.pantallas[0]?.label !== m.label;
                  return (
                    <div key={m.label} className="mb-1">
                      <p className="flex items-center gap-2 text-[12.5px] text-slate-200">
                        <Icono className="h-3.5 w-3.5 text-[#7dcfd2]" /> {m.label}
                      </p>
                      {sub ? <p className="ml-[22px] text-[11px] leading-snug text-slate-400">{m.pantallas.map((p) => p.label).join(" · ")}</p> : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
          <p className="flex items-center gap-1.5 text-[11px] text-slate-500"><Building2 className="h-3.5 w-3.5" /> Sucursales</p>
          <p className="font-semibold text-slate-800">{b.alcance_sucursal === "todas" || b.nivel_base === "ADMIN" ? "Todas" : "Solo la suya"}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
          <p className="flex items-center gap-1.5 text-[11px] text-slate-500"><Percent className="h-3.5 w-3.5" /> Descuento máx.</p>
          <p className="font-semibold text-slate-800">
            {!(b.todo || b.permisos.includes("descuentos_precio")) ? "No puede" : b.tope_descuento_pct == null ? "Sin tope" : `${b.tope_descuento_pct} %`}
          </p>
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-[11px] font-semibold text-slate-500">Puede ({si.length})</p>
        {si.length ? (
          <ul className="space-y-1">
            {si.map((p) => (
              <li key={p.id} className="flex items-start gap-1.5 text-slate-700"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /> {p.label}</li>
            ))}
          </ul>
        ) : <p className="text-xs text-slate-400">Ninguna acción sensible: solo mirar lo que tiene en su menú.</p>}
      </div>
      {no.length && !b.todo ? (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold text-slate-500">No puede</p>
          <ul className="space-y-1">
            {no.map((p) => (
              <li key={p.id} className="flex items-start gap-1.5 text-slate-500"><X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" /> {p.label}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
