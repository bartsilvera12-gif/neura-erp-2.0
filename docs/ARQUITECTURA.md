# neura-erp-2.0 — Arquitectura del esqueleto

Base de la que salen los ERP de cada cliente. Objetivos, en orden de prioridad:

1. **Clon limpio e independiente.** Un cliente nuevo nace vacío; repo y base de datos quedan 100% autónomos, sin arrastrar nada del origen.
2. **Seguro por diseño, no por disciplina.** Es imposible (no "está prohibido") consultar fuera de la empresa o saltear la auth.
3. **Liviano y modular.** El core es chico; cada módulo (facturación, chat, CRM, sorteos…) se enciende o apaga.
4. **Optimizado.** Los fixes que ya sufrimos vienen de fábrica (sin fuga de memoria, sin URLs gigantes, caché de schema, apagado graceful).

---

## 1. Clon limpio (el problema #1)

**Hoy:** al clonar se copia un schema vivo (`zentra_erp`) y se arrastran pedazos de otros clientes.

**En el 2.0:** el schema se **construye desde cero** a partir de migraciones **canónicas** parametrizadas por nombre. Nada de copiar un schema existente.

### Nombre del schema = un solo parámetro
- `APP_DB_SCHEMA` (variable de entorno) es la **única fuente de verdad**. Ningún nombre de schema se hardcodea en el código.
- Todo acceso a datos resuelve el schema desde ahí (ver §3).

### Aprovisionar un cliente nuevo
```bash
# crea el schema <nombre> desde las migraciones canónicas, idempotente y limpio
npm run provision -- --schema erp_clientex --db "$SUPABASE_DB_URL"
```
`scripts/provision.mjs` corre `db/canonical/*.sql` sustituyendo `:schema` por el nombre elegido. Cada clon queda **idéntico y vacío**. Re-ejecutable sin romper (idempotente).

### Clonar el repo
```bash
npm run setup -- --cliente "Cliente X" --schema erp_clientex --dominio clientex.neura.com.py
```
`scripts/setup.mjs` deja el repo personalizado en **un solo lugar** (`.env.local` + `cliente.config.ts`): nombre, schema, dominio, branding, módulos activos. **Cero** datos o referencias del origen en el código.

> Regla de oro: **ningún archivo de código menciona un cliente concreto ni un schema concreto.** Si aparece, es un bug de "clon sucio".

---

## 2. El portón único: `withTenant`

**Toda** ruta de `/api` pasa por `withTenant`. No hay otra forma de escribir una ruta. El portón:

1. Verifica la sesión (rechaza sin auth → 401).
2. Resuelve **de la sesión** (nunca del request): `empresaId`, `usuarioId`, `rol`, `schema`.
3. Chequea el rol si la ruta lo pide.
4. Valida el input con el esquema (zod) de la ruta.
5. Entrega un **contexto con un cliente atado a la empresa** (`ctx.db`) que:
   - usa el schema del tenant automáticamente,
   - **inyecta `empresa_id` en todo** (lecturas filtran, inserts setean),
   - no puede salir de la empresa aunque el programador se olvide.

```ts
export const GET = withTenant(async (ctx, req) => {
  // ctx.db ya está atado a la empresa y al schema. Imposible leer de otra.
  const clientes = await ctx.db.from("clientes").select("id,nombre");
  return ok(clientes);
});

export const POST = withTenant(
  async (ctx, req, input) => {
    // input ya validado por zod; empresa_id se inyecta solo al insertar
    const row = await ctx.db.from("clientes").insert(input);
    return created(row);
  },
  { roles: ["ADMIN", "VENDEDOR"], body: crearClienteSchema }
);
```

- **Prohibido** importar el cliente service-role directo en una ruta (regla de lint). El service-role vive detrás de un wrapper que fuerza `empresa_id`, en una lista chica y revisada.

---

## 3. Tenancy (schema por cliente)

- Un schema de Postgres por empresa (modelo actual, probado). RLS **en el 100%** de las tablas, "deny by default".
- `APP_DB_SCHEMA` fija el schema del deploy. El código nunca lo hardcodea.
- La capa de datos arma `"schema"."tabla"` con allowlist + sanitización (sin inyección).
- Doble red: RLS en la base + inyección de `empresa_id` en el portón. Para romper el aislamiento habría que fallar las dos.

---

## 4. Estructura

```
src/
  app/api/            rutas finas: parsean, llaman al módulo, responden (siempre con withTenant)
  lib/
    api/              withTenant, respuestas estándar, errores
    tenant/           resolución de schema/empresa (fuente única)
    supabase/         clientes (user-RLS, service scoped), pool, helpers
    validation/       helpers zod comunes
  modules/            la lógica de negocio por módulo (core + opcionales)
db/
  canonical/          SQL del schema del tenant, parametrizado por :schema
scripts/
  provision.mjs       crea/actualiza el schema de un cliente (limpio)
  setup.mjs           personaliza un repo recién clonado
docs/
```

Un **módulo** = carpeta en `src/modules/<x>/` con: sus tablas canónicas (`db/canonical/`), su lógica, sus rutas, su esquema de permisos y su prueba mínima. Se enciende en `cliente.config.ts`.

---

## 5. Definición de "hecho" (por módulo)

Un módulo no entra al esqueleto hasta cumplir **todo**:
- [ ] Todas sus rutas pasan por `withTenant` (sin service-role suelto).
- [ ] RLS activa en todas sus tablas; `npm run db:verify-rls` pasa.
- [ ] Input validado con zod.
- [ ] Nombre de schema/cliente NO hardcodeado.
- [ ] Prueba mínima (al menos: aísla entre dos empresas).
- [ ] Sin `next/font/google`, sin URLs gigantes (`inPorTandas`), sin `createClient` con auto-refresh.

---

## 6. Fixes de fábrica (heredados de lo que ya sufrimos)
- `createClient` del servidor siempre sin auto-refresh (fuga de memoria).
- `inPorTandas` para listas de ids (evita 414/URL gigante).
- Caché de schema por empresa (TTL corto).
- Apagado graceful del server.
- Fuentes locales (`next/font/local`) + Dockerfile + `output: standalone`.
