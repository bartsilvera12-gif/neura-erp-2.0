# Clonar el ERP para un cliente nuevo

Cada clon nace **vacío e independiente** (repo y schema propios, sin arrastrar nada de otro
cliente). Todo usa el **Supabase compartido de la flota** por defecto — no hay que pasar
datos de base.

---

## 1. Prompt para Claude (copiá, editá los valores entre `<>`, enviá)

```
Cloná el ERP Zentra 2.0 para un cliente nuevo. Datos:

- Nombre del cliente: <Ferretería República>
- Schema:             <erp_republica>            (minúsculas, empieza con letra, sin espacios)
- Dominio:            <republica.neura.com.py>
- Admin:              email=<admin@republica.neura.com.py>  nombre=<Juan Pérez>
- Empresa(s):         <Ferretería República S.A.>   (una sola, salvo que ponga varias)
- Módulos:            <facturación, chat, cobranzas>  (solo los que necesita)
- Contraseña admin:   <dejar vacío = generala vos>

Hacé el flujo completo: setup → provisioná el schema → seed-admin → deploy → verificá que el
admin entre y que la RLS aísle. Pasame al final: URL, usuario y contraseña del admin.
```

Eso es todo. Claude arma el repo, crea el schema, siembra el admin, deploya y te confirma.

---

## 2. Qué significa cada dato

| Dato | Qué es | Ejemplo |
|---|---|---|
| Nombre del cliente | Cómo se llama (se muestra en la app) | Ferretería República |
| **Schema** | Nombre único del schema en la base (define el aislamiento) | `erp_republica` |
| Dominio | Dónde va a vivir el ERP | `republica.neura.com.py` |
| Admin | El primer usuario (queda como ADMIN) | `admin@…` / Juan Pérez |
| Empresa(s) | Normalmente una; varias solo si es multi-empresa | Ferretería República S.A. |
| Módulos | Qué funciones activar (el resto no se instala) | facturación, chat |
| Contraseña admin | Vacío = Claude genera una segura y te la pasa | — |

> El **schema** y el **dominio** son únicos por cliente. Nada se hardcodea: todo va a
> `.env.local` y `cliente.config.ts`.

---

## 3. Qué hace Claude con esos datos

1. **Repo:** crea `neura-erp-<cliente>` clonando el esqueleto (sin historial de otros).
2. **`setup.mjs`:** escribe `.env.local` (schema, dominio, Supabase compartido) y
   `cliente.config.ts` (nombre, branding, módulos activos). Repo personalizado en un solo lugar.
3. **`provision.mjs`:** crea el schema en la base desde `db/canonical/*.sql` — limpio e
   idempotente — y lo expone en la API.
4. **`seed-admin.mjs`:** crea la(s) empresa(s) y el usuario admin (rol ADMIN).
5. **Deploy + DNS:** publica en Coolify y apunta el dominio.
6. **Verifica:** login del admin + que la RLS aísle.

---

## 4. Solo crear/actualizar el schema (sin clonar todo)

Si ya existe el repo y solo querés crear o re-aplicar el schema:

```
Provisioná el schema <erp_republica> en el Supabase compartido.
```
Equivale a `npm run provision -- --schema <erp_republica>`. Es idempotente: se puede correr de nuevo sin romper ni borrar datos.

---

## 5. Checklist de "clon correcto"
- [ ] El repo no menciona ningún otro cliente ni schema (grep limpio).
- [ ] `APP_DB_SCHEMA` = el schema del cliente; nada hardcodeado.
- [ ] El schema existe, con RLS en todas las tablas (`npm run db:verify-rls`).
- [ ] El admin entra y ve solo lo de su empresa.
- [ ] Solo los módulos pedidos están activos.

---

## 6. Prompt para VERIFICAR que el clon es correcto (copiá y enviá a Claude)

```
Verificá que el clon de <Ferretería República> (schema <erp_republica>) esté 100% correcto.
Chequeá y reportame un OK (o qué falta) por cada punto:

1. Que NINGÚN archivo del código mencione otro cliente ni otro schema (grep en src/).
2. Que APP_DB_SCHEMA sea <erp_republica> y que no haya schemas hardcodeados.
3. Que el schema exista y que TODAS sus tablas tengan RLS activa (db:verify-rls).
4. Aislamiento real: logueá al admin, pedí sus datos y confirmá que ve SOLO los de su
   empresa (y que con otra empresa no ve nada).
5. Que estén activos SOLO los módulos pedidos (<facturación, chat, cobranzas>).
6. Que el login del admin funcione contra el dominio <republica.neura.com.py>.

Dame el resultado en una tabla: punto | OK/FALLA | detalle.
```

---

## Apéndice — Supabase dedicado (caso raro)

Si un cliente tiene su **propia VPS de Supabase** (no el compartido), en el prompt agregá:
`Backend dedicado: URL=<…>  ANON_KEY=<…>  SERVICE_ROLE_KEY=<…>  conexión=<postgres://…>`
(esos 4 datos salen del `~/supabase/SECRETS.txt` de esa VPS). Hoy no se usa: todo va al compartido.
