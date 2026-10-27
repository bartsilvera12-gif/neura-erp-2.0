"use client";

/** Vista 1 — listado de usuarios con búsqueda, filtros y alta / edición. */
import { useMemo, useState } from "react";
import { Building2, KeyRound, Link2, Loader2, MoreHorizontal, Pencil, Plus, Power, Search, Send, UserRoundCheck, Users } from "lucide-react";
import { MenuAcciones, type ItemMenu } from "@/components/MenuAcciones";
import { Select } from "@/components/Select";
import { ScrollHorizontal } from "@/components/ScrollHorizontal";
import { BarraFiltros } from "@/components/EncabezadoPagina";
import { TablaTarjetas, type ColumnaTabla } from "@/components/TablaResponsive";
import { filtrar } from "@/lib/busqueda";
import { BOTON_PRIMARIO, INPUT_FILTRO } from "@/modules/inventario/ui";
import { ModalUsuario } from "@/modules/usuarios/ui/ModalUsuario";
import { AvisoCupo, cupoLleno, IndicadorCupo, ModalCupoLleno, RE_LIMITE_USUARIOS } from "@/modules/usuarios/ui/Cupo";
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
  const [verCupo, setVerCupo] = useState(false);
  const cupo = datos?.cupo;
  const lleno = cupoLleno(cupo);

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
    // Reactivar con el cupo lleno: el aviso del plan (la base igual lo rechazaría).
    if (activo && lleno) { setVerCupo(true); return; }
    setTrabajando(u.id);
    setAviso(null);
    try {
      await api.editar(u.id, { activo });
      invalidarTodo();
      onCambio();
      setAviso({ tono: "ok", texto: `${u.nombre} quedó ${activo ? "activo" : "desactivado"}.` });
    } catch (e) {
      const msg = (e as Error).message;
      if (RE_LIMITE_USUARIOS.test(msg) && cupo) { onCambio(); setVerCupo(true); }
      else setAviso({ tono: "error", texto: msg });
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
  // Lista: en celular cada usuario es una tarjeta (nombre + email, estado y perfil como chips,
  // sucursal y último ingreso a la vista, menú ⋯ al pie); desde tablet, la tabla.
  const columnas: ColumnaTabla<UsuarioFila>[] = [
    {
      key: "usuario", titulo: "Usuario", movil: "titulo", claseTh: "!pl-5", claseTd: "!pl-5",
      celda: (u) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar nombre={u.nombre} tenue={!u.activo} />
          <div className="min-w-0">
            <p className={`flex items-center gap-1.5 font-medium md:truncate ${u.activo ? "text-slate-900" : "text-slate-500"}`}>
              <span className="min-w-0 md:truncate">{u.nombre}</span>
              {u.es_yo ? <span className="shrink-0 rounded bg-slate-100 px-1.5 py-px text-[10px] font-semibold text-slate-500">Vos</span> : null}
            </p>
            <p className="text-xs font-normal text-slate-500 [overflow-wrap:anywhere] md:truncate">{u.email ?? "—"}</p>
          </div>
        </div>
      ),
    },
    { key: "perfil", titulo: "Perfil", movil: "chip", celda: (u) => <InsigniaPerfil nombre={u.perfil_nombre} codigo={u.perfil_codigo} /> },
    {
      key: "sucursal", titulo: "Sucursal", movil: "dato", claseTd: "text-xs text-slate-600",
      celda: (u) => (u.sucursal_nombre ? <span className="inline-flex items-center gap-1"><Building2 className="h-3.5 w-3.5 shrink-0 text-slate-400" /> {u.sucursal_nombre}</span> : <span className="text-slate-400">Principal</span>),
    },
    { key: "estado", titulo: "Estado", movil: "chip", celda: (u) => <PillEstado estado={estadoDe(u)} /> },
    {
      key: "ingreso", titulo: "Último ingreso", movil: "dato", claseTd: "text-xs",
      celda: (u) => (u.pendiente ? (
        <span className="inline-flex items-center gap-1 text-amber-700" title={u.invitado_at ? `Invitado el ${fechaHora(u.invitado_at)}` : undefined}>
          <Link2 className="h-3.5 w-3.5 shrink-0" /> Nunca entró
        </span>
      ) : (
        <span title={fechaHora(u.ultimo_ingreso)} className="tabular-nums text-slate-600">{haceCuanto(u.ultimo_ingreso)}</span>
      )),
    },
    {
      key: "acciones", titulo: "", movil: "acciones", claseTh: "w-12", claseTd: "text-right",
      celda: (u) => (
        <div className="inline-flex justify-end" onClick={(e) => e.stopPropagation()}>
          {trabajando === u.id ? <Loader2 className="m-3 h-4 w-4 animate-spin text-slate-400 md:m-0" /> : (
            <MenuAcciones items={acciones(u)} etiqueta={`Acciones de ${u.nombre}`} className="inline-flex items-center justify-center rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
              <MoreHorizontal className="h-4 w-4 max-md:h-5 max-md:w-5" />
            </MenuAcciones>
          )}
        </div>
      ),
    },
  ];
  const filtrosActivos = (perfil ? 1 : 0) + (sucursal ? 1 : 0);

  return (
    <div className="space-y-4">
      {/* Resumen por estado (fila con scroll interno en celular) + Nuevo usuario */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <ScrollHorizontal className="min-w-0 sm:flex-1" claseFila="gap-2 items-center" dependencias={[estado]}>
        {([["", "Todos", usuarios.length], ["activo", "Activos", conteo.activo], ["pendiente", "Invitación pendiente", conteo.pendiente], ["inactivo", "Inactivos", conteo.inactivo]] as const).map(([id, label, n]) => {
          const sel = estado === id;
          return (
            <button key={id || "todos"} type="button" onClick={() => setEstado(id)} aria-pressed={sel} data-activo={sel ? "true" : undefined}
              className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition-colors duration-150 max-sm:min-h-10 max-sm:text-[13px] ${sel ? "text-white ring-transparent" : "bg-white text-slate-600 ring-slate-200 hover:ring-slate-300"}`}
              style={sel ? { backgroundColor: TEAL } : undefined}>
              {label}
              <span className={`tabular-nums ${sel ? "text-white/80" : "text-slate-400"}`}>{n}</span>
            </button>
          );
        })}
        </ScrollHorizontal>
        <div className="flex items-center gap-2 max-sm:order-first max-sm:flex-col max-sm:items-stretch sm:shrink-0">
          {cupo ? <span className="max-sm:order-2 max-sm:self-start"><IndicadorCupo cupo={cupo} /></span> : null}
          <button type="button" onClick={() => setModal({ abierto: true, u: null })} disabled={!datos || lleno}
            title={lleno ? "Llegaste al máximo de usuarios de tu plan" : undefined}
            className={`${BOTON_PRIMARIO} max-sm:order-1 max-sm:min-h-11 max-sm:w-full disabled:cursor-not-allowed`} style={{ backgroundColor: TEAL }}>
            <Plus className="h-4 w-4" /> Nuevo usuario
          </button>
        </div>
      </div>

      {cupo && lleno ? <AvisoCupo cupo={cupo} /> : null}

      <BarraFiltros
        activos={filtrosActivos}
        onLimpiar={() => { setQ(""); setPerfil(""); setSucursal(""); setEstado(""); }}
        busqueda={
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input type="search" enterKeyHint="search" aria-label="Buscar usuarios" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, email, CI o teléfono…" className={`${INPUT_FILTRO} w-full pl-9 max-md:h-11`} />
          </div>
        }
      >
        <Select value={perfil} onChange={setPerfil} minWidth={190} etiqueta="Perfil"
          options={[["", "Todos los perfiles"], ...(datos?.perfiles ?? []).map((p): [string, string] => [p.id, p.nombre])]} />
        {sucursales.length > 1 ? (
          <Select value={sucursal} onChange={setSucursal} minWidth={190} etiqueta="Sucursal"
            options={[["", "Todas las sucursales"], ["-", "Sin sucursal fija"], ...sucursales.map((s): [string, string] => [s.id, s.nombre])]} />
        ) : null}
      </BarraFiltros>

      {aviso ? (
        <p className={`rounded-xl px-3 py-2 text-xs ${aviso.tono === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{aviso.texto}</p>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {cargando && !datos ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-300" /></div>
        ) : error && !datos ? (
          <p className="p-6 text-sm text-rose-700">{error}</p>
        ) : (
          <TablaTarjetas
            filas={visibles}
            columnas={columnas}
            claveFila={(u) => u.id}
            onFila={(u) => setModal({ abierto: true, u })}
            minAncho={820}
            claseTabla="w-full text-sm"
            claseThead="border-b border-slate-100 bg-slate-50/70"
            thBase="whitespace-nowrap px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500"
            tdBase="px-3 py-3"
            claseFila={(u) => `hover:!bg-slate-50/80 ${u.activo ? "" : "text-slate-400"}`}
            vacio={
              <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-slate-400"><Users className="h-5 w-5" /></span>
                <p className="text-sm font-medium text-slate-700">{hayFiltros ? "Ningún usuario coincide con el filtro" : "Todavía no hay usuarios"}</p>
                {hayFiltros ? <p className="text-xs text-slate-400">Probá con otra búsqueda o limpiá los filtros.</p> : null}
                {hayFiltros ? (
                  <button type="button" onClick={() => { setQ(""); setPerfil(""); setSucursal(""); setEstado(""); }} className="mt-1 inline-flex min-h-11 items-center px-3 text-xs font-semibold text-[var(--brand)] sm:min-h-0">Limpiar filtros</button>
                ) : null}
              </div>
            }
          />
        )}
      </section>
      <p className="text-[11px] text-slate-400">
        Los usuarios entran con su email y una contraseña que eligen ellos (nunca la ve el administrador). Un usuario desactivado no puede entrar, pero su historial queda.
      </p>

      {modal.abierto && datos ? (
        <ModalUsuario usuario={modal.u} datos={datos} perfiles={perfiles}
          onClose={() => setModal({ abierto: false, u: null })} onGuardado={onCambio} />
      ) : null}
      {verCupo && cupo ? <ModalCupoLleno cupo={cupo} onClose={() => setVerCupo(false)} /> : null}
    </div>
  );
}
