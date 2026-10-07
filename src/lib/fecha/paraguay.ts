/**
 * Hora de Paraguay. El servidor (contenedor) y la base corren en UTC: todo lo que
 * dependa del "día" o se muestre con hora tiene que pasar por America/Asuncion, o
 * de 21:00 a 23:59 queda fechado al día siguiente (UTC va 3 horas adelante).
 * Paraguay está en UTC-3 todo el año desde oct-2024 (tzdata 2024b+).
 */
export const TZ_PY = "America/Asuncion";

/** Fecha de hoy en Paraguay, "YYYY-MM-DD". */
export const hoyPY = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ_PY });
