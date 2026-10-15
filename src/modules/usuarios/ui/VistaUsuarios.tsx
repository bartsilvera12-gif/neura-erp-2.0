"use client";

/** Vista 1 — listado de usuarios con búsqueda, filtros y alta / edición. */
import { useMemo, useState } from "react";
import { Building2, KeyRound, Link2, Loader2, MoreHorizontal, Pencil, Plus, Power, Search, Send, UserRoundCheck, Users } from "lucide-react";
import { MenuAcciones, type ItemMenu } from "@/components/MenuAcciones";
import { Select } from "@/components/Select";
import { filtrar } from "@/lib/busqueda";
import { BOTON_PRIMARIO, INPUT_FILTRO } from "@/modules/inventario/ui";
import { ModalUsuario } from "@/modules/usuarios/ui/ModalUsuario";
import {
  api, Avatar, estadoDe, fechaHora, haceCuanto, InsigniaPerfil, invalidarTodo, PillEstado, TEAL,
  type DatosUsuarios, type Estado, type PerfilCompleto, type UsuarioFila,
} from "@/modules/usuarios/ui/comun";

export function VistaUsuarios({ datos, perfiles, cargando, error, onCambio }: {
  datos: DatosUsuarios | null;
  perfiles: PerfilCompleto[] | null;
  cargando: boolean;
  error: string | null;
  onCambio: () => void;
}) {
  const [q, setQ] = useState("");
  const [perfil, setPerfil] = useState("");
  const [sucursal, setSucursal] = useState("");
  const [estado, setEstado] = useState<"" | Estado>("");
  const [modal, setModal] = useState<{ abierto: boolean; u: UsuarioFila | null }>({ abierto: false, u: null });
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tono: "ok" | "error"; texto: string } | null>(null);

  const usuarios = useMemo(() => datos?.usuarios ?? [], [datos]);
  const conteo = useMemo(() => {
    const c = { activo: 0, pendiente: 0, inactivo: 0 } as Record<Estado, number>;
    for (const u of usuarios) c[estadoDe(u)]++;
    return c;
  }, [usuarios]);

  const visibles = useMemo(() => {
    let l = usuarios;
    if (perfil) l = l.filter((u) => u.perfil_id === perfil);
    if (sucursal) l = l.filter((u) => (sucursal === "-" ? !u.sucursal_id : u.sucursal_id === sucursal));
    if (estado) l = l.filter((u) => estadoDe(u) === estado);
    return filtrar(l, q, (u) => ({ principal: u.nombre, otros: [u.email, u.perfil_nombre, u.sucursal_nombre, u.telefono], codigos: [u.ci] }));
  }, [usuarios, perfil, sucursal, estado, q]);

  const hayFiltros = !!(q || perfil || sucursal || estado);
  const admins = usuarios.filter((u) => u.activo && u.perfil_codigo === "ADMIN").length;

  async function activar(u: UsuarioFila, activo: boolean) {
    setTrabajando(u.id);
    setAviso(null);
    try {
      await api.editar(u.id, { activo });
      invalidarTodo();
      onCambio();
      setAviso({ tono: "ok", texto: `${u.nombre} quedó ${activo ? "activo" : "desactivado"}.` });
    } catch (e) {
      setAviso({ tono: "error", texto: (e as Error).message });
    } finally {
      setTrabajando(null);
    }
  }

  function acciones(u: UsuarioFila): ItemMenu[] {
    const items: ItemMenu[] = [{ etiqueta: "Editar", icono: <Pencil className="h-4 w-4" />, onClick: () => setModal({ abierto: true, u }) }];
    if (!u.sin_cuenta && u.activo) {
      if (u.pendiente && u.origen === "invitado") items.push({ etiqueta: "Reenviar invitación", icono: <Send className="h-4 w-4" />, onClick: () => setModal({ abierto: true, u }) });
      else items.push({ etiqueta: "Restablecer contraseña", icono: <KeyRound className="h-4 w-4" />, onClick: () => setModal({ abierto: true, u }) });
    }
    const ultimoAdmin = u.activo && u.perfil_codigo === "ADMIN" && admins <= 1;
    if (!u.es_yo && !ultimoAdmin) {
      items.push(u.activo
        ? { etiqueta: "Desactivar", icono: <Power className="h-4 w-4" />, tono: "peligro", onClick: () => activar(u, false) }
        : { etiqueta: "Activar", icono: <UserRoundCheck className="h-4 w-4" />, tono: "exito", onClick: () => activar(u, true) });
    }
    return items;
  }

  const sucursales = datos?.sucursales ?? [];
  return (
    <div className="space-y-4">
      {/* Resumen + filtros */}
      <div className="flex flex-wrap items-center gap-2">
        {([["", "Todos", usuarios.length], ["activo", "Activos", conteo.activo], ["pendiente", "Invitación pendiente", conteo.pendiente], ["inactivo", "Inactivos", conteo.inactivo]] as const).map(([id, label, n]) => {
          const sel = estado === id;
          return (
            <button key={id || "todos"} type="button" onClick={() => setEstado(id)}
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition-colors duration-150 ${sel ? "text-white ring-transparent" : "bg-white text-slate-600 ring-slate-200 hover:ring-slate-300"}`}
              style={sel ? { backgroundColor: TEAL } : undefined}>
              {label}
              <span className={`tabular-nums ${sel ? "text-white/80" : "text-slate-400"}`}>{n}</span>
            </button>
          );
        })}
        <button type="button" onClick={() => setModal({ abierto: true, u: null })} disabled={!datos} className={`${BOTON_PRIMARIO} ml-auto`} style={{ backgroundColor: TEAL }}>
          <Plus className="h-4 w-4" /> Nuevo usuario
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, email, CI o teléfono…" className={`${INPUT_FILTRO} w-full pl-9`} />
        </div>
        <Select value={perfil} onChange={setPerfil} minWidth={190}
          options={[["", "Todos los perfiles"], ...(datos?.perfiles ?? []).map((p): [string, string] => [p.id, p.nombre])]} />
        {sucursales.length > 1 ? (
          <Select value={sucursal} onChange={setSucursal} minWidth={190}
            options={[["", "Todas las sucursales"], ["-", "Sin sucursal fija"], ...sucursales.map((s): [string, string] => [s.id, s.nombre])]} />
        ) : null}
        {hayFiltros ? (
          <button type="button" onClick={() => { setQ(""); setPerfil(""); setSucursal(""); setEstado(""); }} className="px-2 text-xs font-semibold text-slate-500 hover:text-slate-800">Limpiar</button>
        ) : null}
      </div>

      {aviso ? (
        <p className={`rounded-xl px-3 py-2 text-xs ${aviso.tono === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{aviso.texto}</p>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {cargando && !datos ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-300" /></div>
        ) : error && !datos ? (
          <p className="p-6 text-sm text-rose-700">{error}</p>
        ) : !visibles.length ? (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-slate-400"><Users className="h-5 w-5" /></span>
            <p className="text-sm font-medium text-slate-700">{hayFiltros ? "Ningún usuario coincide con el filtro" : "Todavía no hay usuarios"}</p>
            {hayFiltros ? <p className="text-xs text-slate-400">Probá con otra búsqueda o limpiá los filtros.</p> : null}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-3">Usuario</th>
                  <th className="px-3 py-3">Perfil</th>
                  <th className="px-3 py-3">Sucursal</th>
                  <th className="px-3 py-3">Estado</th>
                  <th className="px-3 py-3">Último ingreso</th>
                  <th className="w-12 px-3 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibles.map((u) => {
                  const est = estadoDe(u);
                  return (
                    <tr key={u.id} onClick={() => setModal({ abierto: true, u })} className={`cursor-pointer transition-colors hover:bg-slate-50/80 ${u.activo ? "" : "text-slate-400"}`}>
                      <td className="px-5 py-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar nombre={u.nombre} tenue={!u.activo} />
                          <div className="min-w-0">
                            <p className={`flex items-center gap-1.5 truncate font-medium ${u.activo ? "text-slate-900" : "text-slate-500"}`}>
                              {u.nombre}
                              {u.es_yo ? <span className="rounded bg-slate-100 px-1.5 py-px text-[10px] font-semibold text-slate-500">Vos</span> : null}
                            </p>
                            <p className="truncate text-xs text-slate-500">{u.email ?? "—"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3"><InsigniaPerfil nombre={u.perfil_nombre} codigo={u.perfil_codigo} /></td>
                      <td className="px-3 py-3 text-xs text-slate-600">
                        {u.sucursal_nombre ? <span className="inline-flex items-center gap-1"><Building2 className="h-3.5 w-3.5 text-slate-400" /> {u.sucursal_nombre}</span> : <span className="text-slate-400">Principal</span>}
                      </td>
                      <td className="px-3 py-3"><PillEstado estado={est} /></td>
                      <td className="px-3 py-3 text-xs">
                        {u.pendiente ? (
                          <span className="inline-flex items-center gap-1 text-amber-700" title={u.invitado_at ? `Invitado el ${fechaHora(u.invitado_at)}` : undefined}>
                            <Link2 className="h-3.5 w-3.5" /> Nunca entró
                          </span>
                        ) : (
                          <span title={fechaHora(u.ultimo_ingreso)} className="tabular-nums text-slate-600">{haceCuanto(u.ultimo_ingreso)}</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        {trabajando === u.id ? <Loader2 className="ml-auto h-4 w-4 animate-spin text-slate-400" /> : (
                          <MenuAcciones items={acciones(u)} etiqueta={`Acciones de ${u.nombre}`} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
                            <MoreHorizontal className="h-4 w-4" />
                          </MenuAcciones>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="text-[11px] text-slate-400">
        Los usuarios entran con su email y una contraseña que eligen ellos (nunca la ve el administrador). Un usuario desactivado no puede entrar, pero su historial queda.
      </p>

      {modal.abierto && datos ? (
        <ModalUsuario usuario={modal.u} datos={datos} perfiles={perfiles}
          onClose={() => setModal({ abierto: false, u: null })} onGuardado={onCambio} />
      ) : null}
    </div>
  );
}
