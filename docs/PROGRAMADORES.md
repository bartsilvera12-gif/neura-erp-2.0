# Clonar el ERP 2.0 para un cliente — guía para programadores

Esta hoja alcanza para hacer un clon de principio a fin **sin saber nada de antes**.
Seguí los pasos en orden. La guía larga, con cada paso a mano y el detalle del servidor, está en
[CLONAR.md](CLONAR.md).

> **La idea en una frase:** cada cliente tiene **su propio repo** (código) y **su propio schema**
> (datos) dentro del mismo Supabase de producción (`https://api.neura.com.py`). El código del 2.0 no
> conoce a ningún cliente: lo único que cambia en cada clon son dos archivos (`src/cliente.config.ts`
> y `.env.local`), y esos los escribe el formulario solo. Vos no editás código para clonar.

---

## Parte 1 — Preparar tu computadora (una sola vez)

Lo hacés **una vez** por computadora. Después, cada clon es solo la Parte 2.

### Lo que tenés que pedirle al administrador antes de empezar

1. El archivo **`.env.local` de la flota** (tiene las claves de Supabase).
2. La **IP del servidor**.

### La forma fácil (recomendada)

1. **Instalá** [Node 22 o más nuevo](https://nodejs.org) y [git](https://git-scm.com). En Windows,
   instalá también el **Cliente OpenSSH** (Configuración › Aplicaciones › Características opcionales).

2. **Bajá el 2.0:**
   ```bash
   git clone https://github.com/bartsilvera12-gif/neura-erp-2.0.git
   ```

3. **Poné el `.env.local`** que te pasó el administrador dentro de esa carpeta, al lado de
   `package.json`. **Nunca lo subas a git ni lo mandes por chat/correo.**

4. **Instalá las dependencias** y **corré el preparador**, desde dentro de la carpeta:
   ```bash
   cd neura-erp-2.0
   npm ci
   npm run preparar -- --ip <la IP del servidor>
   ```

5. La **primera vez** te va a mostrar una línea que empieza con `ssh-ed25519 ...`: esa es **tu llave
   pública** (no es secreta). Copiála entera y mandásela al administrador.

6. Cuando te avise que la agregó, volvé a correr:
   ```bash
   npm run preparar
   ```
   Tiene que terminar diciendo **"Listo: ya podés clonar"**.

Podés correr `npm run preparar` las veces que quieras: cada vez hace solo lo que falta (crear la llave,
armar `~/.ssh/config`, probar la conexión) y te dice el próximo paso. **Nunca muestra ni copia tu llave
privada.**

### A mano (si preferís entender cada paso)

Es exactamente lo que hace `npm run preparar`:

**a.** Instalá Node 22 y git (y OpenSSH en Windows).

**b.** `git clone https://github.com/bartsilvera12-gif/neura-erp-2.0.git` y entrá a la carpeta.

**c.** Poné el `.env.local` de la flota en la raíz, al lado de `package.json`.

**d.** Creá tu llave SSH (poné tu nombre sin espacios al final, ej. `juan.perez`):
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/neura_zentra -C "tu.nombre"
   ```
   Mandale al administrador **solo** `~/.ssh/neura_zentra.pub` (el que termina en `.pub`). El otro,
   sin extensión, es privado y **no sale de tu computadora**.

**e.** Cuando te confirme que la agregó, sumá esto a `~/.ssh/config` (en Windows:
   `C:\Users\<vos>\.ssh\config`). La IP te la da él:
   ```
   Host neura-erp
       HostName <IP del servidor>
       User clonador
       IdentityFile ~/.ssh/neura_zentra
       IdentitiesOnly yes
       ServerAliveInterval 60
   ```

**f.** Probá la conexión. Tiene que responder `ok`:
   ```bash
   echo "select 'ok';" | ssh neura-erp /usr/local/bin/erp-psql postgres At
   ```
   Cualquier otro comando (`ssh neura-erp`, `ssh neura-erp ls`…) va a decir "pedido no permitido": **eso
   está bien**. Tu llave es restringida: entra como el usuario `clonador`, que **solo** puede trabajar
   en la base (crear el schema, cargar la empresa, correr las pruebas). No abre consola, no ve archivos
   del servidor y no reinicia nada.

---

## Parte 2 — Clonar un cliente

### a. Pedí estos datos del cliente

| Dato | Ejemplo | Regla |
|---|---|---|
| Nombre del negocio | Ferretería República | como se ve en la app |
| Razón social | Ferretería República S.A. | para la empresa |
| Dominio | `republica.neura.com.py` | único por cliente |
| Admin: nombre y correo | Juan Pérez, `admin@republica.com.py` | el primer usuario |
| Rubro | Comercio | define qué funciones arrancan prendidas (ver abajo) |
| Color y logo | `#1F6F8B`, `logo.webp` | opcionales; sin logo va el de Zentra |

**El schema (`erp_...`) y la carpeta se completan solos** a partir del nombre. Igual revisalos.

**Rubros disponibles** (todos los clones tienen *todos* los módulos; el rubro define qué arranca
prendido y se puede cambiar después en Configuración › Rubro y funciones):

- **Comercio** (ferretería, almacén, tienda): caja, ventas, stock, compras, clientes y pedidos de
  mostrador. Sin cocina.
- **Gastronomía** (restaurante, bar): lo de Comercio + Mesas y QR, Cocina y Recetas.
- **Sorteos** (rifas): venta por web/WhatsApp/vendedores, revisión de comprobantes, cupones y sorteo
  del ganador. Sin cocina ni pedidos de mostrador.
- **Inmobiliaria**: venta y alquiler de propiedades, cuotas, planes, alquileres y liquidación.
- **Gimnasio / academia**: clases con cupo, asistencias, membresías y recepción.
- **Comedor empresarial**: menú enfocado (Comedor, Inventario, Reportes). Caso especial; confirmalo
  con quien mantiene el 2.0 antes de usarlo para un cliente nuevo.

### b. Abrí el formulario

Desde la carpeta del 2.0:
```bash
git pull
npm run clonar
```

`git pull` trae lo último del 2.0. **Importante:** el formulario copia lo que está **guardado en git**;
lo que tengas modificado sin commit **no va** al clon. El formulario se abre solo en tu navegador en
`http://localhost:4545` (solo en tu computadora).

### c. Completá el formulario y elegí las opciones

Al escribir el nombre se completan solos el schema, el dominio y la carpeta: **revisalos**.

| Opción | Qué hacer |
|---|---|
| **Publicar el cliente** | Dejala **tildada**. Crea el repo privado en GitHub, el dominio en Cloudflare y la app en Coolify, y espera a que el link responda. Destildala solo para un clon de práctica. |
| **Compilar también en esta computadora** | **No hace falta** tildarla: Coolify compila al publicar. |

### d. Tocá **Clonar** y no cierres la pestaña

Cada paso se va poniendo en verde. Si el dominio es uno **propio del cliente** (no
`<nombre>.neura.com.py`), el paso de habilitar lo hace el administrador: el resumen te dice qué pedirle.

### e. Al terminar, el resumen muestra

- **El link del cliente** (`https://<dominio>`), ya funcionando.
- **La contraseña del administrador:** si la dejaste vacía, se muestra **una sola vez**. Copiala y
  pasásela al cliente por un canal seguro, y que la cambie.
- **El repo del cliente:** de ahí publica Coolify. Cada push a `main` vuelve a publicar solo.

No necesitás tokens de GitHub, Cloudflare ni Coolify: los tiene el servidor y vos nunca los ves.

### f. Cerrá el formulario con **Ctrl+C** en la terminal.

---

## Qué hace el formulario por dentro (para que sepas qué mirar si se frena)

En orden, frenando en el primer error:

1. **Revisar** — datos, carpeta, SSH y claves de la flota.
2. **Copiar** — clona el código a una carpeta nueva (el 2.0 queda como remoto `base`).
3. **Personalizar** — `setup.mjs`: escribe `src/cliente.config.ts` y `.env.local`.
4. **Base** — `provision.mjs`: arma el schema desde `db/canonical`.
5. **Admin** — `seed-admin.mjs`: empresa, usuario ADMIN y rubro.
6. **Seguridad** — `verify-rls.mjs`: tiene que dar **0 problemas**.
7. **Pruebas** — `pruebas-db.mjs`: tiene que dar **0 fallaron** (corre en una transacción que se
   deshace, no deja datos).
8. **Servidor** — habilita el schema y el dominio en Supabase (solo si pasaron las pruebas).
9. **Git / Compilar / Publicar** — commit en el repo del cliente y, si está tildado, repo + DNS + app.

Todo es **idempotente**: si algo falla, corregís y tocás **Clonar** otra vez con los **mismos datos**;
retoma la misma carpeta sin repetir lo hecho ni duplicar nada.

---

## Si algo falla

| Dice | Qué hacer |
|---|---|
| "El schema … ya existe" | Ese cliente ya tiene base. Elegí otro nombre; o, si es el mismo cliente, usá la carpeta donde lo clonaste para retomarlo. |
| "La carpeta … ya existe" | Elegí otra carpeta, o la del clon de ese mismo schema para retomarlo. |
| "Falta … en el .env.local del 2.0" | No está el `.env.local` de la flota en la carpeta del 2.0 (Parte 1, paso 3). |
| "no acepta tu llave SSH" | El administrador todavía no la agregó, o `~/.ssh/config` apunta a otro archivo (Parte 1, paso e). |
| "No llego a neura-erp" | Revisá el `HostName` en `~/.ssh/config`. |
| "falta erp-psql" / "falta erp-habilitar" | El servidor no tiene la puerta al día: avisale al administrador. |
| Falla **"Servidor" (habilitar)** | Pasale el mensaje al administrador. La base ya quedó armada: cuando lo resuelva, tocá Clonar otra vez. |
| Falla **"Publicar"** | Si dice "el despliegue terminó en failed", mirá los logs de la app en Coolify (suele ser un panic transitorio del build: volvé a tocar Clonar). Si no, pasale el mensaje al administrador. Repetir no duplica repo, dominio ni app. |
| "…ya existe en Cloudflare y apunta a otro lado" | Ese dominio lo usa otra cosa: elegí otro. |
| Falla una **receta** en "Base" | Copiá el detalle ("Ver el detalle") y mandáselo a quien mantiene el 2.0. **No la arregles en el clon.** |

---

## Verificación final (checklist)

- [ ] El resumen del formulario muestra el link y (si correspondía) la contraseña del admin.
- [ ] Entrás con el admin en `https://<dominio>` y ves la empresa del cliente.
- [ ] Configuración › Rubro y funciones muestra el rubro elegido (o está oculta, si se pidió).
- [ ] "Seguridad" dio **0 problemas** y "Pruebas" dio **0 fallaron**.

Si querés revisarlo a mano después, desde la carpeta del clon:
```bash
npm run db:verify-rls -- --schema <schema del cliente> --ssh neura-erp
PRUEBAS_SCHEMA=<schema del cliente> npm run test:db
```

---

## Parte 3 — Trabajar en un clon después de clonarlo

- **Un arreglo que sirve para todos los clientes** se hace en el **2.0**, nunca en el clon.
- **Para traer los arreglos del 2.0 al clon**, desde la carpeta del clon:
  ```bash
  git fetch base
  git merge base/main
  npm run provision -- --schema <schema del cliente> --ssh neura-erp
  ```
  `provision` aplica **solo las recetas nuevas**. Si `src/cliente.config.ts` da conflicto, quedate con
  la versión del cliente.
- **Las recetas ya aplicadas** (`db/canonical/*.sql`) **no se editan nunca.** Un cambio de base es una
  receta **nueva**, con el número siguiente, idempotente (`create or replace`, `if not exists`).
- **Cada función SQL nueva** lleva `revoke execute … from public, anon` (y `grant` a `authenticated`
  si la llama la app). Si no, `npm run db:verify-rls` falla.
- **Nunca uses `erp_demo`** para un cliente, ni lo toques desde un clon.

---

## Para quien administra el servidor

Los programadores entran con el usuario restringido `clonador`. **Nunca** agregues su llave a `ubuntu`
ni a `root`: esas dan acceso a toda la máquina.

- **Instalar / actualizar la puerta** (idempotente), desde la carpeta del 2.0 **con Git Bash** (no
  PowerShell: le mete caracteres que rompen el script):
  ```bash
  ssh neura-erp "sudo bash -s" < scripts/servidor/instalar-clonador.sh
  ```
- **Agregar la llave de un programador** (pegá su `.pub` completo):
  ```bash
  ssh neura-erp 'sudo erp-clonador-llave agregar "ssh-ed25519 AAAA... juan.perez"'
  ```
- **Quitar una llave:** `ssh neura-erp 'sudo erp-clonador-llave quitar juan.perez'`
  (`lista` muestra quiénes tienen llave).
- **Quién clonó qué:** `ssh neura-erp 'sudo erp-clientes lista'` (fecha, quién, schema, dominio);
  `erp-clientes activos` lista los schemas que hoy sirve la API.
- **Qué puede la llave restringida:** correr `psql` (`postgres` o `supabase_admin`) y habilitar/publicar
  un clon con `erp-habilitar` / `erp-publicar` (dominios `<nombre>.neura.com.py`). **No puede** abrir
  consola, leer archivos del servidor, usar docker, reiniciar servicios por su cuenta ni quitar
  clientes.
- **Dominio propio del cliente** (ej. `sistema.ferreteria.com.py`): lo habilitás vos con
  `ssh neura-erp 'erp-habilitar erp_ferreteria sistema.ferreteria.com.py'`. DNS y dominio en Coolify,
  a mano.
- **Tokens de publicar** en `/etc/erp-clonar/tokens.env` (solo root).
- **Borrar un clon:** `ssh neura-erp 'erp-habilitar --quitar <schema> <dominio>'` y después el schema
  (ver [CLONAR.md](CLONAR.md), "Borrar un clon").
- **Después de actualizar el 2.0**, volvé a correr el instalador para poner al día `erp-habilitar` y la
  puerta.
