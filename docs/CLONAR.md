# Clonar el ERP 2.0 para un cliente nuevo

Cada cliente tiene **su propio repo y su propio schema** en el Supabase compartido. El código no
conoce a ningún cliente: lo único que cambia es `src/cliente.config.ts` y `.env.local`, y los dos
los escribe `npm run setup`.

Probado de punta a punta el 3-nov-2026 con un schema descartable (`erp_clon_prueba`): las recetas
arman la base desde cero, el resultado es idéntico a `erp_demo`, pasan las 178 pruebas de plata y
stock y la revisión de seguridad da 0 problemas.

## La forma rápida: el formulario

Versión corta para el equipo, con cómo preparar la computadora y la llave SSH:
[PROGRAMADORES.md](PROGRAMADORES.md).

```bash
npm run clonar
```

Abre `http://localhost:4545` (solo en tu computadora). Completás el cliente, el administrador, los
módulos y los datos técnicos (el schema, el dominio y la carpeta se completan solos a partir del
nombre) y tocás **Clonar**. Hace los pasos 1, 2, 3, 5 y 6 de abajo, en orden, mostrando el avance, y
frena en el primer error. Si algo falla, corregís y volvés a tocar Clonar con los mismos datos: retoma
la misma carpeta sin repetir lo hecho.

Opcionales del formulario:
- **Configurar el servidor de Supabase** (paso 4): suma el schema y el dominio con respaldo del `.env`
  y reinicia `rest` y `auth` (unos segundos sin API para todos los clientes). Tildalo solo con
  autorización de quien administra el servidor; si no, queda como pendiente en el resumen.
- **Instalar y compilar**: `npm ci` y `npm run build` en el clon.
- **Subir al repo del cliente**: push a `main` del repo que indiques (tiene que existir y estar vacío).

Al final muestra la contraseña inicial del admin (una sola vez) y lo que falta: Coolify y Cloudflare.
Antes de usarlo necesitás lo del punto 0 (SSH y el `.env.local` de la flota en la raíz del 2.0).
Copia lo último commiteado del 2.0: si tenés cambios sin commit, no van.

Abajo está lo mismo a mano, paso por paso.

---

## 0. Antes de empezar

- Node 22 y git.
- Acceso por SSH al servidor de Supabase (`zentra-app` en `~/.ssh/config`). Con eso no hace falta
  `psql` en tu máquina: los scripts lo usan del servidor.
- El `.env.local` de la flota (URL de Supabase, anon key y service role key). Pedíselo a quien
  administra el servidor. **Nunca se sube al repo.**
- Los datos del cliente:

| Dato | Ejemplo | Regla |
|---|---|---|
| Nombre | Ferretería República | como se muestra en la app |
| Schema | `erp_republica` | minúsculas, empieza con letra, único, nunca `erp_demo` |
| Dominio | `republica.neura.com.py` | único por cliente |
| Admin | `admin@republica.com.py`, Juan Pérez | el primer usuario |
| Empresa | Ferretería República S.A. | razón social |
| Módulos | `caja,inventario,clientes,reportes` | opcional; sin esto, todos |
| Color y logo | `#1F6F8B`, `logo.webp` | opcional; sin logo, el de Zentra |

Módulos que existen: `caja`, `inventario`, `gastos-empresariales`, `clientes`, `crm`, `presupuestos`,
`gestion-clientes`, `comisiones`, `planes`, `agenda`, `cobranzas`, `conciliacion`, `pagos`,
`conversaciones`, `soporte`, `reportes`, `rrhh`, `proyectos`, `configuracion` (siempre va).

---

## 1. El repo del cliente

```bash
git clone https://github.com/bartsilvera12-gif/neura-erp-2.0.git neura-erp-republica
cd neura-erp-republica
git remote rename origin base          # el 2.0: de acá llegan los arreglos
git remote add origin https://github.com/<org>/neura-erp-republica.git
npm ci
```

Copiá el `.env.local` de la flota a la raíz del repo.

## 2. Personalizarlo

```bash
npm run setup -- --cliente "Ferretería República" --schema erp_republica \
  --dominio republica.neura.com.py --color "#1F6F8B" --logo ./logo.webp \
  --modulos caja,inventario,clientes,reportes
```

Escribe `src/cliente.config.ts` (nombre, dominio, color, módulos, logo) y `.env.local` (schema,
`APP_URL` y `MENU_PUBLIC_URL` con https, y una `SIFEN_SECRETS_KEY` nueva solo de este cliente).
Rechaza `erp_demo` y los módulos que no existen.

## 3. Armar la base

```bash
npm run provision -- --schema erp_republica --ssh zentra-app
```

Corre las recetas de `db/canonical` **por número** (00, 10, … 100, 120) y anota cada una en la tabla
`_recetas` del schema. Volver a correrlo aplica **solo las que faltan**: si una falla, corregís y lo
corrés de nuevo; y para traer recetas nuevas del 2.0 alcanza con correrlo otra vez.

No se vuelven a correr recetas viejas sobre un schema con datos: alguna choca con reglas que agregó
una receta posterior (pasa con la 48 una vez cargada la empresa). Un schema armado antes de existir
`_recetas` se niega a seguir: pasale `--desde <primera receta que le falta>` una vez y las anteriores
quedan anotadas.

## 4. Servidor (lo hace quien administra Supabase)

Es la única parte que toca configuración compartida. En `/home/ubuntu/supabase/docker/.env`:

1. Hacé un respaldo: `cp .env .env.bak-$(date +%Y%m%d)`.
2. En `PGRST_DB_SCHEMAS` sumá el schema: `…,erp_demo,erp_republica`.
3. En `ADDITIONAL_REDIRECT_URLS` sumá el dominio: `…,https://republica.neura.com.py/**`.
4. Recreá solo esos dos servicios:
   ```bash
   docker compose up -d --no-deps rest auth
   ```

Sin el paso 2 la app da error al leer datos; sin el 3, los links de invitación y de cambio de
contraseña no vuelven al dominio del cliente.

## 5. Empresa y administrador

```bash
npm run seed-admin -- --schema erp_republica --ssh zentra-app \
  --empresa "Ferretería República S.A." --email admin@republica.com.py --nombre "Juan Pérez"
```

Crea la cuenta de acceso y, en el schema, la empresa y el usuario ADMIN. La primera sucursal, el
depósito, la caja, los perfiles y el catálogo de gastos los crea la base sola. Si no pasás
`--password`, genera una y la muestra una sola vez: pasásela al cliente por un canal seguro.
Si el email ya tiene cuenta en la flota, la usa sin cambiarle la contraseña. Correrlo dos veces no
duplica nada.

## 6. Verificar

```bash
npm run db:verify-rls -- --schema erp_republica --ssh zentra-app
PRUEBAS_SCHEMA=erp_republica npm run test:db
npm run build
npm run dev     # entrá con el admin en http://localhost:3000
```

- `db:verify-rls`: todas las tablas con RLS y nada abierto a usuarios sin sesión, salvo las 12
  funciones públicas a propósito (menú QR de las mesas y link del presupuesto). Tiene que decir
  **0 problema(s)**.
- `test:db`: tiene que decir **178 pasaron, 0 fallaron**. Corre en una transacción que se deshace:
  no deja datos.

## 7. Publicar (Coolify)

- App nueva desde el repo del cliente, build pack **Dockerfile**, healthcheck `/`.
- Variables: todas las de `.env.local`. Las `NEXT_PUBLIC_*` también como variables de build.
- Dominio del cliente en la app y en Cloudflare (proxy https) apuntando al servidor de Coolify.
- Después de publicar: entrá con el admin en `https://<dominio>`.

---

## Trabajar en el clon sin perder los arreglos del 2.0

- **Recetas:** nunca edites una receta que ya se aplicó en algún cliente. Un cambio de base es una
  receta nueva con el número siguiente, idempotente (`create or replace`, `if not exists`), y se
  aplica con `npm run provision -- --schema <schema> --ssh zentra-app` (corre solo las nuevas).
- **Funciones nuevas:** `revoke execute … from public, anon` y `grant` a `authenticated` si la app
  la llama. Sin eso, `db:verify-rls` falla.
- **Algo que sirve para todos los clientes:** hacelo en el 2.0, no en el clon.
- **Traer arreglos del 2.0 al clon:**
  ```bash
  git fetch base && git merge base/main
  npm run provision -- --schema erp_republica --ssh zentra-app
  ```
  `src/cliente.config.ts` va a tener conflicto si el 2.0 lo cambió: quedate con el del cliente.

## Borrar un clon (por ejemplo, uno de prueba)

Además del schema, hay que sacar las tres cosas que quedan afuera. Con `psql -U supabase_admin`:

```sql
select cron.unschedule(jobid) from cron.job where jobname = 'chat_sla_erp_republica';
drop policy if exists chat_topicos_erp_republica on realtime.messages;
drop schema if exists erp_republica cascade;
```

Y quitarlo de `PGRST_DB_SCHEMAS` y `ADDITIONAL_REDIRECT_URLS` (paso 4).

---

## Lista final

- [ ] `src/cliente.config.ts` tiene el nombre, dominio, módulos y logo del cliente.
- [ ] `.env.local` tiene `APP_DB_SCHEMA=<schema del cliente>` y su propia `SIFEN_SECRETS_KEY`.
- [ ] `provision` terminó en "Listo".
- [ ] El schema está en `PGRST_DB_SCHEMAS` y el dominio en `ADDITIONAL_REDIRECT_URLS`.
- [ ] `db:verify-rls`: 0 problema(s). `test:db`: 178 pasaron.
- [ ] El admin entra en `https://<dominio>` y ve su empresa.
- [ ] El repo no menciona otro cliente: `git grep -n "erp_demo" -- src` no devuelve nada.
