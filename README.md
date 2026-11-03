# neura-erp-2.0

Esqueleto base de los ERP de Neura: **seguro por diseño, optimizado y de clon limpio.**
De acá sale el ERP de cada cliente nuevo.

Arquitectura y reglas: **[docs/ARQUITECTURA.md](docs/ARQUITECTURA.md)**.

## Clonar para un cliente nuevo

Paso a paso probado (repo, base, servidor, admin, verificación y publicación): **[docs/CLONAR.md](docs/CLONAR.md)**.

Lo más rápido: `npm run clonar` abre un formulario que hace todo con los datos del cliente. Cómo
preparar la computadora y usarlo, en una hoja: **[docs/PROGRAMADORES.md](docs/PROGRAMADORES.md)**. A mano:

```bash
npm run setup -- --cliente "Cliente X" --schema erp_clientex --dominio clientex.neura.com.py
npm run provision -- --schema erp_clientex --ssh neura-erp
npm run seed-admin -- --schema erp_clientex --ssh neura-erp --empresa "Cliente X S.A." --email admin@clientex.com --nombre "Nombre"
npm run db:verify-rls -- --schema erp_clientex --ssh neura-erp
```
## Reglas de oro (no negociables)

1. **Toda ruta de `/api` usa `withTenant`.** No hay otra forma. El portón hace auth, resuelve empresa/rol desde la base y entrega `ctx.db` ya atado a la empresa.
2. **Ninguna ruta usa service-role directo.** Se accede a datos por `ctx.db`. (El lint lo bloquea.)
3. **Ningún nombre de schema o cliente se hardcodea.** Todo sale de `APP_DB_SCHEMA`.
4. **RLS en el 100% de las tablas**, deny by default.
5. Cada módulo entra sólo si cumple la **definición de hecho** (ver arquitectura).

## Ejemplo de ruta

```ts
export const GET = withTenant(async (ctx) => ok(await ctx.db.select("clientes")));
```
Sin chequear auth, ni empresa, ni schema: el portón ya lo hizo, y `ctx.db` no puede salir de la empresa.
