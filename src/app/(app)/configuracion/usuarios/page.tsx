"use client";

/**
 * /configuracion/usuarios — Configuración › Usuarios (nivel ADMIN + "Administrar usuarios").
 * Dos vistas (pestañas, ?vista=perfiles):
 *   · Usuarios: listado con búsqueda y filtros; alta por invitación (email o link para
 *     WhatsApp), edición, activar / desactivar, reenviar invitación / restablecer contraseña.
 *   · Perfiles y permisos: perfiles con sus pantallas del menú y sus permisos.
 * El admin nunca escribe ni ve contraseñas. Todo cambio queda en el historial.
 */
import { Suspense, useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { apiFetchSWR } from "@/lib/api/cache-cliente";
import { Cabecera, Pestanas } from "@/modules/inventario/ui";
import { VistaUsuarios } from "@/modules/usuarios/ui/VistaUsuarios";
import { VistaPerfiles } from "@/modules/usuarios/ui/VistaPerfiles";
import { URL_PERFILES, URL_USUARIOS, type DatosUsuarios, type PerfilCompleto } from "@/modules/usuarios/ui/comun";

export default function UsuariosPage() {
  return (
    <Suspense fallback={null}>
      <Usuarios />
    </Suspense>
  );
}

function Usuarios() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const vista = sp.get("vista") === "perfiles" ? "perfiles" : "usuarios";

  const [datos, setDatos] = useState<DatosUsuarios | null>(null);
  const [perfiles, setPerfiles] = useState<PerfilCompleto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [recarga, setRecarga] = useState(0);
  const [fresco, setFresco] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    setCargando(true);
    Promise.all([
      apiFetchSWR<DatosUsuarios>(URL_USUARIOS, (d) => setDatos(d), { signal: ctrl.signal, fresco }),
      apiFetchSWR<PerfilCompleto[]>(URL_PERFILES, (d) => setPerfiles(d), { signal: ctrl.signal, fresco }),
    ])
      .then(() => setError(null))
      .catch((e: Error) => setError(e.message))
      .finally(() => !ctrl.signal.aborted && setCargando(false));
    return () => ctrl.abort();
  }, [recarga, fresco]);

  const refrescar = useCallback(() => {
    setFresco(true);
    setRecarga((k) => k + 1);
  }, []);

  const cambiarVista = (id: string) => {
    const q = new URLSearchParams(sp.toString());
    if (id === "perfiles") q.set("vista", "perfiles");
    else q.delete("vista");
    router.replace(`${pathname}${q.size ? `?${q.toString()}` : ""}`, { scroll: false });
  };

  const pendientes = datos?.usuarios.filter((u) => u.activo && u.pendiente).length ?? 0;

  return (
    <div className="space-y-5 pb-10">
      <Cabecera kicker="Configuración" titulo="Usuarios" subtitulo="Quién entra al sistema y qué puede ver y hacer cada uno" />
      <Pestanas
        valor={vista}
        onChange={cambiarVista}
        opciones={[
          { id: "usuarios", label: "Usuarios", badge: pendientes || undefined },
          { id: "perfiles", label: "Perfiles y permisos" },
        ]}
      />
      {vista === "usuarios" ? (
        <VistaUsuarios datos={datos} perfiles={perfiles} cargando={cargando} error={error} onCambio={refrescar} />
      ) : (
        <VistaPerfiles perfiles={perfiles} cargando={cargando} error={error} onCambio={refrescar} />
      )}
    </div>
  );
}
