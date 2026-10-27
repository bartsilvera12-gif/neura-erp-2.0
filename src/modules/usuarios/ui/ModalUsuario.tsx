"use client";

/**
 * Alta y edición de un usuario.
 *   Alta: datos + perfil + sucursal → "Enviar invitación" (le llega un email para poner su
 *   contraseña) o "Copiar link" (para mandarlo por WhatsApp). Si el email ya tiene cuenta en
 *   el servidor compartido, se avisa y se puede VINCULAR (no se toca su contraseña).
 *   Edición: datos, perfil, sucursal, activo, Soporte, acceso (reenviar / restablecer) e historial.
 */
import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Copy, History, KeyRound, Link2, Loader2, Lock, Mail, MessageCircle, Send, ShieldCheck, UserPlus } from "lucide-react";
import { Select } from "@/components/Select";
import { clienteConfig } from "@/cliente.config";
import { moduloEstaActivo } from "@/modules/registry";
import { nivelLabel } from "@/modules/usuarios/permisos";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, ET, INPUT, ModalDocumento } from "@/modules/inventario/ui";
import { Historial } from "@/modules/usuarios/ui/Historial";
import { VistaPrevia } from "@/modules/usuarios/ui/VistaPrevia";
import { AvisoCupo, BotonSoporte, cupoLleno, RE_LIMITE_USUARIOS } from "@/modules/usuarios/ui/Cupo";
import {
  api, copiar, estadoDe, fechaHora, haceCuanto, Interruptor, invalidarTodo, linkWhatsApp, PillEstado, TEAL,
  type DatosUsuarios, type PerfilCompleto, type UsuarioFila,
} from "@/modules/usuarios/ui/comun";

type Form = {
  nombres: string;
  apellidos: string;
  ci: string;
  telefono: string;
  email: string;
  perfil_id: string;
  sucursal_id: string;
  activo: boolean;
  es_tecnico: boolean;
  es_qa: boolean;
  usa_soporte: boolean;
};

type Resultado =
  | { tipo: "existe"; email: string }
  | { tipo: "link"; link: string; nombre: string; telefono: string; restablecer?: boolean }
  | { tipo: "invitado"; email: string }
  | { tipo: "vinculado" }
  | { tipo: "restablecer_enviado"; email: string };

export function ModalUsuario({
  usuario, datos, perfiles, onClose, onGuardado,
}: {
  usuario: UsuarioFila | null;
  datos: DatosUsuarios;
  perfiles: PerfilCompleto[] | null;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const nuevo = !usuario;
  const porDefecto = datos.perfiles.find((p) => p.codigo === "VENDEDOR") ?? datos.perfiles[0];
  const [f, setF] = useState<Form>({
    nombres: usuario?.nombres ?? "",
    apellidos: usuario?.apellidos ?? "",
    ci: usuario?.ci ?? "",
    telefono: usuario?.telefono ?? "",
    email: usuario?.email ?? "",
    perfil_id: usuario?.perfil_id ?? porDefecto?.id ?? "",
    sucursal_id: usuario?.sucursal_id ?? "",
    activo: usuario?.activo ?? true,
    es_tecnico: usuario?.es_tecnico ?? false,
    es_qa: usuario?.es_qa ?? false,
    usa_soporte: usuario?.usa_soporte ?? false,
  });
  const [busy, setBusy] = useState<null | "email" | "link" | "vincular" | "guardar" | string>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [verHistorial, setVerHistorial] = useState(false);
  const [recargaHist, setRecargaHist] = useState(0);
  const [copiado, setCopiado] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  const soporte = moduloEstaActivo("soporte");
  const perfilElegido = perfiles?.find((p) => p.id === f.perfil_id) ?? null;
  const admins = datos.usuarios.filter((u) => u.activo && u.perfil_codigo === "ADMIN").length;
  const esUltimoAdmin = !!usuario && usuario.activo && usuario.perfil_codigo === "ADMIN" && admins <= 1;
  // Reactivar a un desactivado ocupa un lugar del plan: con el cupo lleno no se puede.
  const sinLugar = !!usuario && !usuario.activo && cupoLleno(datos.cupo);
  const errorLimite = !!error && RE_LIMITE_USUARIOS.test(error);
  const sucursales = datos.sucursales.filter((s) => s.activa || s.id === f.sucursal_id);
  const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim());
  const listo = f.nombres.trim().length > 0 && !!f.perfil_id && (!nuevo || emailValido);

  const cuerpo = () => ({
    nombres: f.nombres.trim(),
    apellidos: f.apellidos.trim() || null,
    ci: f.ci.trim() || null,
    telefono: f.telefono.trim() || null,
    perfil_id: f.perfil_id,
    sucursal_id: f.sucursal_id || null,
    ...(soporte ? { es_tecnico: f.es_tecnico, es_qa: f.es_qa, usa_soporte: f.usa_soporte } : {}),
  });

  async function crear(modo: "email" | "link", vincular = false) {
    if (!listo || busy) return;
    setBusy(vincular ? "vincular" : modo);
    setError(null);
    try {
      const r = await api.crear({ ...cuerpo(), email: f.email.trim().toLowerCase(), modo, vincular });
      invalidarTodo();
      if (r.estado === "existe") setResultado({ tipo: "existe", email: r.email ?? f.email });
      else {
        onGuardado();
        if (r.estado === "link" && r.link) setResultado({ tipo: "link", link: r.link, nombre: f.nombres, telefono: f.telefono });
        else if (r.estado === "invitado") setResultado({ tipo: "invitado", email: f.email.trim() });
        else setResultado({ tipo: "vinculado" });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (nuevo) return crear("email");
    if (!listo || busy || !usuario) return;
    setBusy("guardar");
    setError(null);
    try {
      await api.editar(usuario.id, { ...cuerpo(), activo: f.activo });
      invalidarTodo();
      onGuardado();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

  async function acceso(accion: "enviar_invitacion" | "link_invitacion" | "enviar_restablecer" | "link_restablecer") {
    if (!usuario || busy) return;
    setBusy(accion);
    setError(null);
    try {
      const r = await api.acceso(usuario.id, accion);
      setRecargaHist((k) => k + 1);
      if (r.link) setResultado({ tipo: "link", link: r.link, nombre: usuario.nombres, telefono: usuario.telefono ?? "", restablecer: accion === "link_restablecer" || !usuario.pendiente });
      else if (accion === "enviar_invitacion") setResultado({ tipo: "invitado", email: r.email });
      else setResultado({ tipo: "restablecer_enviado", email: r.email });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // ── Pantallas de resultado ────────────────────────────────────────────────
  if (resultado && resultado.tipo !== "existe") {
    return (
      <ModalDocumento titulo={nuevo ? "Usuario creado" : "Listo"} ancho="max-w-md" onClose={onClose}
        footer={<button type="button" onClick={onClose} className={`${BOTON_PRIMARIO} max-sm:flex-1`} style={{ backgroundColor: TEAL }}>Listo</button>}>
        {resultado.tipo === "link" ? (
          <div className="space-y-4">
            <Aviso icono={<Link2 className="h-5 w-5" />} titulo={resultado.restablecer ? "Link para poner una contraseña nueva" : "Link de invitación"}>
              Mandáselo a <span className="font-semibold">{resultado.nombre}</span>. Al abrirlo elige su contraseña y entra. Es personal y vence: no lo compartas en grupos.
            </Aviso>
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
              <code className="min-w-0 flex-1 truncate px-1 text-xs text-slate-600">{resultado.link}</code>
              <button type="button" onClick={async () => { if (await copiar(resultado.link)) { setCopiado(true); setTimeout(() => setCopiado(false), 1800); } }}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:text-[var(--brand)] active:scale-[0.97] max-sm:min-h-11 max-sm:px-3.5 max-sm:text-sm">
                {copiado ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />} {copiado ? "Copiado" : "Copiar"}
              </button>
            </div>
            <a href={linkWhatsApp(resultado.nombre, resultado.link, resultado.restablecer ? "restablecer" : "invitacion", clienteConfig.nombre, resultado.telefono)}
              target="_blank" rel="noopener noreferrer"
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 active:scale-[0.98]">
              <MessageCircle className="h-4 w-4" /> Mandar por WhatsApp
            </a>
          </div>
        ) : resultado.tipo === "invitado" ? (
          <Aviso icono={<Send className="h-5 w-5" />} titulo="Invitación enviada">
            Le mandamos un email a <span className="font-semibold">{resultado.email}</span> para que elija su contraseña. Si no le llega (revisá spam), desde su ficha podés copiar el link y mandárselo por WhatsApp.
          </Aviso>
        ) : resultado.tipo === "restablecer_enviado" ? (
          <Aviso icono={<Mail className="h-5 w-5" />} titulo="Email enviado">
            Le llegó a <span className="font-semibold">{resultado.email}</span> un link para poner una contraseña nueva. Vos no ves ni elegís su contraseña.
          </Aviso>
        ) : (
          <Aviso icono={<ShieldCheck className="h-5 w-5" />} titulo="Usuario vinculado">
            Ya puede entrar a {clienteConfig.nombre} con el email y la contraseña que usa en el otro sistema. No se cambió nada de su cuenta.
          </Aviso>
        )}
      </ModalDocumento>
    );
  }

  const estado = usuario ? estadoDe(usuario) : null;
  const propia = usuario?.origen === "invitado";

  return (
    <ModalDocumento
      titulo={nuevo ? <><UserPlus className="h-5 w-5 text-[var(--brand)]" /> Nuevo usuario</> : usuario!.nombre}
      subtitulo={nuevo ? "Le llega una invitación para elegir su contraseña. Vos nunca la ves." : usuario!.email ?? undefined}
      extra={estado ? <PillEstado estado={estado} /> : null}
      ancho="max-w-4xl"
      onClose={busy ? undefined : onClose}
      footer={
        resultado?.tipo === "existe" ? (
          <>
            <button type="button" onClick={() => setResultado(null)} disabled={!!busy} className={`${BOTON_SECUNDARIO} max-sm:order-2 max-sm:basis-full`}>Volver</button>
            <button type="button" onClick={() => crear("email", true)} disabled={!!busy} className={`${BOTON_PRIMARIO} max-sm:order-1 max-sm:basis-full`} style={{ backgroundColor: TEAL }}>
              {busy === "vincular" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Vincular a esta empresa
            </button>
          </>
        ) : nuevo ? (
          <>
            <button type="button" onClick={onClose} disabled={!!busy} className={`${BOTON_SECUNDARIO} mr-auto max-sm:order-3 max-sm:mr-0 max-sm:basis-full`}>Cancelar</button>
            <button type="button" onClick={() => crear("link")} disabled={!listo || !!busy} className={`${BOTON_SECUNDARIO} max-sm:order-2 max-sm:basis-full`} title="No manda email: genera el link para que lo mandes por WhatsApp">
              {busy === "link" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Crear y copiar link
            </button>
            <button type="submit" form="form-usuario" disabled={!listo || !!busy} className={`${BOTON_PRIMARIO} max-sm:order-1 max-sm:basis-full`} style={{ backgroundColor: TEAL }}>
              {busy === "email" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Crear y enviar invitación
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={onClose} disabled={!!busy} className={`${BOTON_SECUNDARIO} max-sm:flex-1`}>Cancelar</button>
            <button type="submit" form="form-usuario" disabled={!listo || !!busy} className={`${BOTON_PRIMARIO} max-sm:flex-1`} style={{ backgroundColor: TEAL }}>
              {busy === "guardar" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar cambios
            </button>
          </>
        )
      }
    >
      {resultado?.tipo === "existe" ? (
        <div className="mx-auto max-w-lg space-y-3 py-2">
          <Aviso tono="ambar" icono={<AlertTriangle className="h-5 w-5" />} titulo="Ese email ya tiene una cuenta">
            <span className="font-semibold">{resultado.email}</span> ya se usa para entrar a otro sistema que comparte el mismo acceso. Podés sumarlo a {clienteConfig.nombre}: va a entrar con la contraseña que ya tiene.
          </Aviso>
          <ul className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            <li className="flex gap-2"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" /> No se cambia su contraseña ni sus datos de acceso.</li>
            <li className="flex gap-2"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" /> Acá tiene el perfil <b>{perfilElegido?.nombre}</b> y solo ve los datos de esta empresa.</li>
            <li className="flex gap-2"><Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" /> Si no recuerda la contraseña, se le puede mandar el email para restablecerla.</li>
          </ul>
          {error ? <p className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
        </div>
      ) : (
        <div className="grid min-w-0 gap-6 lg:grid-cols-[1fr_280px]">
          <form id="form-usuario" onSubmit={guardar} className="min-w-0 space-y-5">
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Datos</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className={ET}>Nombre *</span>
                  <input autoFocus value={f.nombres} onChange={(e) => set("nombres", e.target.value)} maxLength={80} placeholder="Ej. María" className={INPUT} />
                </label>
                <label className="block">
                  <span className={ET}>Apellido</span>
                  <input value={f.apellidos} onChange={(e) => set("apellidos", e.target.value)} maxLength={80} placeholder="Ej. González" className={INPUT} />
                </label>
                <label className="block">
                  <span className={ET}>CI <span className="font-normal text-slate-400">(opcional)</span></span>
                  <input inputMode="numeric" value={f.ci} onChange={(e) => set("ci", e.target.value.replace(/[^\d.-]/g, ""))} maxLength={20} placeholder="1.234.567" className={INPUT} />
                </label>
                <label className="block">
                  <span className={ET}>Teléfono <span className="font-normal text-slate-400">(opcional)</span></span>
                  <input type="tel" inputMode="tel" value={f.telefono} onChange={(e) => set("telefono", e.target.value)} maxLength={40} placeholder="0981 123 456" className={INPUT} />
                </label>
                <label className="block sm:col-span-2">
                  <span className={ET}>Email *</span>
                  {nuevo ? (
                    <input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} maxLength={160} placeholder="maria@empresa.com" className={INPUT} autoComplete="off" />
                  ) : (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
                      <Lock className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span className="min-w-0 flex-1 truncate">{f.email || "—"}</span>
                      <span className="shrink-0 text-[11px] text-slate-400 max-sm:basis-full max-sm:pl-[22px]">Es su cuenta de acceso: no se cambia</span>
                    </div>
                  )}
                </label>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Perfil y sucursal</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <span className={ET}>Perfil *</span>
                  <Select value={f.perfil_id} onChange={(v) => set("perfil_id", v)} block etiqueta="Perfil" disabled={!!usuario?.es_yo || esUltimoAdmin}
                    options={datos.perfiles.map((p): [string, string] => [p.id, p.codigo === "ADMIN" || p.nombre.toLowerCase() === nivelLabel(p.nivel_base).toLowerCase() ? p.nombre : `${p.nombre} · ${nivelLabel(p.nivel_base)}`])} />
                  {usuario?.es_yo ? <span className="mt-1 block text-[11px] text-slate-400">Tu propio perfil lo cambia otro administrador.</span>
                    : esUltimoAdmin ? <span className="mt-1 block text-[11px] text-amber-700">Es el único administrador: no se le puede cambiar el perfil.</span> : null}
                </div>
                <div>
                  <span className={ET}>Sucursal</span>
                  <Select value={f.sucursal_id} onChange={(v) => set("sucursal_id", v)} block etiqueta="Sucursal"
                    options={[["", "Sin sucursal fija (usa la principal)"], ...sucursales.map((s): [string, string] => [s.id, s.nombre + (s.es_principal ? " (principal)" : "")])]} />
                  <span className="mt-1 block text-[11px] text-slate-400">Sus ventas, compras y pérdidas usan el depósito de esa sucursal.</span>
                </div>
              </div>
            </section>

            {soporte ? (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Soporte</h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Interruptor checked={f.usa_soporte} onChange={(v) => set("usa_soporte", v)} label="Usa Soporte" detalle="Entra al módulo de tickets" />
                  <Interruptor checked={f.es_tecnico} onChange={(v) => set("es_tecnico", v)} label="Es técnico" detalle="Puede tomar tickets" />
                  <Interruptor checked={f.es_qa} onChange={(v) => set("es_qa", v)} label="Es QA" detalle="Revisa tickets resueltos" />
                </div>
              </section>
            ) : null}

            {usuario ? (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Estado</h3>
                <Interruptor checked={f.activo} disabled={usuario.es_yo || esUltimoAdmin || sinLugar} onChange={(v) => set("activo", v)}
                  label={f.activo ? "Activo: puede entrar" : "Desactivado: no puede entrar"}
                  detalle={usuario.es_yo ? "No podés desactivar tu propio usuario." : esUltimoAdmin ? "Es el único administrador: no se puede desactivar."
                    : sinLugar ? "No hay lugares libres en tu plan para activarlo." : "Desactivarlo le corta el acceso al instante. Su historial queda."} />
                {sinLugar && datos.cupo ? <AvisoCupo cupo={datos.cupo} /> : null}
              </section>
            ) : null}

            {usuario && !usuario.sin_cuenta ? (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Acceso</h3>
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-xs text-slate-600">
                    {usuario.pendiente
                      ? <>Todavía no entró nunca{usuario.invitado_at ? <> · invitado el {fechaHora(usuario.invitado_at)}</> : null}.</>
                      : <>Último ingreso: <span className="font-medium text-slate-800">{haceCuanto(usuario.ultimo_ingreso)}</span> <span className="text-slate-400">({fechaHora(usuario.ultimo_ingreso)})</span></>}
                    {usuario.origen === "vinculado" ? <span className="mt-1 block text-[11px] text-slate-400">Cuenta compartida con otro sistema: la contraseña solo la cambia su dueño (por email).</span> : null}
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-2 max-sm:flex-col">
                    {usuario.pendiente && propia ? (
                      <>
                        <BotonAcceso onClick={() => acceso("enviar_invitacion")} busy={busy === "enviar_invitacion"} disabled={!usuario.activo || !!busy} icono={<Send className="h-3.5 w-3.5" />}>Reenviar invitación</BotonAcceso>
                        <BotonAcceso onClick={() => acceso("link_invitacion")} busy={busy === "link_invitacion"} disabled={!usuario.activo || !!busy} icono={<Link2 className="h-3.5 w-3.5" />}>Copiar link de invitación</BotonAcceso>
                      </>
                    ) : (
                      <>
                        <BotonAcceso onClick={() => acceso("enviar_restablecer")} busy={busy === "enviar_restablecer"} disabled={!usuario.activo || !!busy} icono={<KeyRound className="h-3.5 w-3.5" />}>Enviar email para restablecer contraseña</BotonAcceso>
                        {propia ? (
                          <BotonAcceso onClick={() => acceso("link_restablecer")} busy={busy === "link_restablecer"} disabled={!usuario.activo || !!busy} icono={<Link2 className="h-3.5 w-3.5" />}>Copiar link para restablecer</BotonAcceso>
                        ) : null}
                      </>
                    )}
                  </div>
                  {!usuario.activo ? <p className="mt-2 text-[11px] text-slate-400">Activalo para mandarle links de acceso.</p> : null}
                </div>
              </section>
            ) : null}

            {error ? (
              <div className="flex flex-col gap-2 rounded-lg bg-rose-50 p-2.5 sm:flex-row sm:items-center">
                <p className="min-w-0 flex-1 text-xs text-rose-700">{error}</p>
                {errorLimite ? <BotonSoporte className="sm:shrink-0 max-sm:w-full" /> : null}
              </div>
            ) : null}

            {usuario ? (
              <section>
                <button type="button" onClick={() => setVerHistorial((v) => !v)} aria-expanded={verHistorial} className="flex items-center gap-1.5 text-xs font-semibold max-sm:min-h-11 max-sm:text-[13px] text-slate-500 transition hover:text-slate-800">
                  <History className="h-3.5 w-3.5" /> Historial de cambios
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${verHistorial ? "rotate-180" : ""}`} />
                </button>
                {verHistorial ? <div className="mt-3"><Historial usuarioId={usuario.id} recarga={recargaHist} /></div> : null}
              </section>
            ) : null}
          </form>

          <aside className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 lg:sticky lg:top-0 lg:self-start">
            {perfilElegido ? (
              <>
                <p className="mb-3 text-sm font-semibold text-slate-900">{perfilElegido.nombre}</p>
                <VistaPrevia compacta b={perfilElegido} />
              </>
            ) : (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>
            )}
          </aside>
        </div>
      )}
    </ModalDocumento>
  );
}

function BotonAcceso({ children, icono, onClick, busy, disabled }: { children: React.ReactNode; icono: React.ReactNode; onClick: () => void; busy: boolean; disabled: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left text-xs font-semibold text-slate-700 transition hover:border-[var(--brand)] hover:text-[var(--brand)] active:scale-[0.97] disabled:opacity-40 max-sm:min-h-11 max-sm:px-3 max-sm:text-[13px]">
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icono} {children}
    </button>
  );
}

function Aviso({ icono, titulo, children, tono = "marca" }: { icono: React.ReactNode; titulo: string; children: React.ReactNode; tono?: "marca" | "ambar" }) {
  return (
    <div className={`flex gap-3 rounded-xl p-3.5 ${tono === "ambar" ? "bg-amber-50 text-amber-900" : "bg-[var(--brand-50)] text-slate-700"}`}>
      <span className={`mt-0.5 shrink-0 ${tono === "ambar" ? "text-amber-600" : "text-[var(--brand)]"}`}>{icono}</span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900">{titulo}</p>
        <p className="mt-0.5 text-[13px] leading-relaxed">{children}</p>
      </div>
    </div>
  );
}
