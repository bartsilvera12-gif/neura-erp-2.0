/**
 * Tope chico por IP, en memoria del proceso (ventana fija). Es una red extra: el límite real por
 * mesa lo pone la base (mesa_pedido_publico_crear). Se reinicia con el servidor; no es para
 * auditoría, solo para frenar ráfagas de un mismo origen.
 */
const ventanas = new Map<string, { desde: number; n: number }>();
const MAX_CLAVES = 5000;

export function permitirIp(clave: string, max: number, ventanaMs: number): boolean {
  const ahora = Date.now();
  const v = ventanas.get(clave);
  if (!v || ahora - v.desde > ventanaMs) {
    if (ventanas.size >= MAX_CLAVES) {
      for (const [k, x] of ventanas) if (ahora - x.desde > ventanaMs) ventanas.delete(k);
      if (ventanas.size >= MAX_CLAVES) ventanas.delete(ventanas.keys().next().value!);
    }
    ventanas.set(clave, { desde: ahora, n: 1 });
    return true;
  }
  v.n++;
  return v.n <= max;
}
