"use client";

/**
 * Error que rompe hasta el layout raíz. Reemplaza al genérico de Next (en inglés) y, de paso,
 * evita que en desarrollo Turbopack reescriba sin parar el chunk del layout raíz alternando
 * con el del error genérico (pantallas en blanco / recargas en bucle).
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="es">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f8fafc", color: "#0f172a" }}>
        <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ maxWidth: 380, textAlign: "center" }}>
            <p style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Algo salió mal</p>
            <p style={{ fontSize: 14, color: "#64748b", margin: "8px 0 20px" }}>
              Ocurrió un error inesperado. Probá de nuevo; si sigue pasando, recargá la página.
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <button type="button" onClick={() => reset()}
                style={{ minHeight: 44, padding: "0 18px", borderRadius: 12, border: 0, background: "#0b3a3d", color: "#fff", fontWeight: 600, cursor: "pointer" }}>
                Reintentar
              </button>
              <button type="button" onClick={() => window.location.reload()}
                style={{ minHeight: 44, padding: "0 18px", borderRadius: 12, border: "1px solid #e2e8f0", background: "#fff", color: "#334155", fontWeight: 600, cursor: "pointer" }}>
                Recargar
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
