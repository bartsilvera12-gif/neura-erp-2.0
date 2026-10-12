"use client";

/**
 * Sonido de aviso de la campanita. Igual que el actual (lib/notificaciones/sonido), pero sin
 * archivo de audio: un tono corto con Web Audio. Se puede silenciar (se recuerda por
 * navegador) y se "desbloquea" con el primer gesto de la persona, porque los navegadores no
 * dejan sonar audio sin una interacción previa.
 */
const STORAGE_KEY = "zentra:notificaciones:sonido";

export function leerSonidoActivado(): boolean {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

export function escribirSonidoActivado(activado: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, activado ? "1" : "0");
  } catch {
    /* sin storage: queda en memoria */
  }
}

let ctx: AudioContext | null = null;
let armado = false;

function contexto(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    return ctx;
  } catch {
    return null;
  }
}

/** Desbloquea el audio con el primer pointerdown/keydown (si se espera al primer aviso, ya es tarde). */
export function prepararSonidos(): void {
  if (typeof window === "undefined" || armado) return;
  armado = true;
  const desbloquear = () => {
    const c = contexto();
    if (!c) return;
    void c.resume().then(() => {
      if (c.state === "running") {
        window.removeEventListener("pointerdown", desbloquear);
        window.removeEventListener("keydown", desbloquear);
      }
    }).catch(() => {});
  };
  window.addEventListener("pointerdown", desbloquear, { passive: true });
  window.addEventListener("keydown", desbloquear);
}

/** Dos notas cortas ascendentes (≈ 0,35 s). `forzar` suena aunque esté silenciado (prueba). */
export function reproducirSonidoNotificacion(forzar = false): void {
  if (!forzar && !leerSonidoActivado()) return;
  const c = contexto();
  if (!c) return;
  try {
    if (c.state === "suspended") void c.resume().catch(() => {});
    const t0 = c.currentTime + 0.01;
    for (const [i, freq] of [880, 1320].entries()) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const ini = t0 + i * 0.14;
      gain.gain.setValueAtTime(0.0001, ini);
      gain.gain.exponentialRampToValueAtTime(0.25, ini + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, ini + 0.2);
      osc.connect(gain).connect(c.destination);
      osc.start(ini);
      osc.stop(ini + 0.22);
    }
  } catch (e) {
    console.warn("[sonido] no se pudo reproducir el aviso", e);
  }
}
