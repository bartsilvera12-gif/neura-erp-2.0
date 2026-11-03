# Hoja para programadores: clonar el ERP 2.0 para un cliente

La guía larga, con cada paso a mano, está en [CLONAR.md](CLONAR.md). Esta hoja alcanza para el día a día.

---

## 1. Preparar tu computadora (una sola vez)

**a. Instalá** [Node 22](https://nodejs.org) y [git](https://git-scm.com).

**b. Traé el 2.0:**

```bash
git clone https://github.com/bartsilvera12-gif/neura-erp-2.0.git
cd neura-erp-2.0
```

**c. Pedí el `.env.local` de la flota** y ponelo en la raíz de esa carpeta (al lado de `package.json`).
Tiene las claves maestras de Supabase:
- Nunca lo subas a git: `.gitignore` ya lo excluye, no lo fuerces.
- No lo mandes por chat abierto ni por correo.
- No lo copies a otro lado.

**d. Creá tu llave SSH** para entrar al servidor:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/neura_zentra -C "tu-nombre"
```

Mandale a quien administra el servidor **solo** el archivo `~/.ssh/neura_zentra.pub`, el que termina
en `.pub`. El otro (`neura_zentra`, sin extensión) es privado y no sale de tu computadora.

**e. Cuando te confirme que la agregó**, sumá esto a `~/.ssh/config` (en Windows:
`C:\Users\<vos>\.ssh\config`). La IP te la pasa él.

```
Host zentra-app
    HostName <IP del servidor>
    User ubuntu
    IdentityFile ~/.ssh/neura_zentra
    IdentitiesOnly yes
    ServerAliveInterval 60
```

**f. Probá la conexión.** Tiene que responder `ok`:

```bash
ssh zentra-app echo ok
```

---

## 2. Clonar un cliente

**a. Pedí los datos:**
- nombre del negocio y razón social;
- dominio;
- nombre y correo del administrador;
- módulos que va a usar;
- color y logo (opcionales).

**b. Abrí el formulario** desde la carpeta del 2.0:

```bash
git pull
npm run clonar
```

`git pull` trae la última versión del 2.0: el formulario copia lo que está guardado en git. Lo que
tengas modificado sin commit no va al clon.

**c. Completá el formulario.** Se abre solo en tu navegador (http://localhost:4545). Al escribir el
nombre se completan solos el schema, el dominio y la carpeta: revisalos.

**d. Elegí las opciones:**

| Opción | Qué hacer |
|---|---|
| Configurar el servidor de Supabase | **Solo con permiso** de quien administra el servidor: corta unos segundos la conexión a todos los clientes. Si no, dejala sin tildar y pedile ese paso a él. |
| Instalar y compilar | Dejala tildada: confirma que el clon arranca. Tarda unos minutos. |
| Subir al repo del cliente | Solo si ya creaste el repo vacío en GitHub y pegaste su dirección. |

**e. Tocá Clonar y no cierres la pestaña.** Cada paso se pone en verde.

**f. Al final:**
- **Contraseña del administrador:** si la dejaste vacía, se muestra una sola vez. Copiala y pasásela
  al cliente por un canal seguro.
- **Lo que falta:** el resumen lo dice. Casi siempre es Coolify (app nueva desde el repo del cliente,
  con las variables del `.env.local` de la carpeta del clon) y el dominio en Cloudflare.

**g. Cerrá el formulario** con Ctrl+C en la terminal.

### Si algo falla

El formulario se frena y dice qué pasó. Corregí y tocá **Clonar** otra vez con los **mismos datos**:
retoma la misma carpeta sin repetir lo hecho ni duplicar nada.

| Dice | Qué hacer |
|---|---|
| "El schema … ya existe" | Ese cliente ya tiene base. Elegí otro nombre o, si es el mismo cliente, usá la carpeta donde lo clonaste. |
| "La carpeta … ya existe" | Elegí otra carpeta, o la del clon de ese mismo schema para retomarlo. |
| "Falta … en el .env.local del 2.0" | No está el `.env.local` de la flota en la carpeta del 2.0 (paso 1c). |
| Error de SSH | Probá `ssh zentra-app echo ok` (paso 1f). |
| Falla una receta en "Armar la base" | Mandá el detalle ("Ver el detalle") a quien mantiene el 2.0. No la arregles en el clon. |

---

## 3. Trabajar en un clon

- **Un arreglo que sirve para todos** se hace en el 2.0, no en el clon.
- **Para traer los arreglos del 2.0** al clon, desde la carpeta del clon:

  ```bash
  git fetch base
  git merge base/main
  npm run provision -- --schema <schema del cliente> --ssh zentra-app
  ```

  `provision` aplica solo las recetas nuevas. Si `src/cliente.config.ts` da conflicto, quedate con la
  versión del cliente.
- **Las recetas que ya se aplicaron** (`db/canonical`) no se editan nunca. Un cambio de base es una
  receta nueva con el número siguiente.
- **Cada función nueva** de la base lleva `revoke execute … from public, anon`. Si no,
  `npm run db:verify-rls` falla.
- **Nunca uses `erp_demo`** para un cliente, ni lo toques desde un clon.

---

## Para quien administra el servidor

- **Agregar la llave de un programador** (con su `.pub`), en el servidor:

  ```bash
  echo "<contenido del .pub>" >> ~/.ssh/authorized_keys
  ```

- **Si alguien deja el equipo**, borrá su línea de `~/.ssh/authorized_keys`.
- **El paso del servidor de cada clon** (schema y dominio) está en [CLONAR.md](CLONAR.md), paso 4. El
  formulario lo puede hacer solo, con respaldo, si se tilda la opción.
