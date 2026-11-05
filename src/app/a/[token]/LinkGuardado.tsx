"use client";

/** Si este celular ya abrió el link de un alumno, el QR viejo de la entrada (receta 153) lo lleva ahí. */
import { useEffect, useState } from "react";
import { CLAVE_LINK } from "./clave";

export function LinkGuardado() {
  const [tok, setTok] = useState<string | null>(null);
  useEffect(() => { try { setTok(localStorage.getItem(CLAVE_LINK)); } catch { /* sin almacenamiento */ } }, []);
  if (!tok || !/^[0-9a-f]{48}$/.test(tok)) return null;
  return (
    <a href={`/a/${tok}`} className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-slate-900 px-5 text-base font-semibold text-white no-underline">
      Ir a mi asistencia
    </a>
  );
}
