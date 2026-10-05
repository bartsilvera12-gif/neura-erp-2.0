# neura-erp-2.0

Esqueleto base de los ERP de Neura: **seguro por diseño, optimizado y de clon limpio.**
De acá sale el ERP de cada cliente nuevo.

Arquitectura y reglas: **[docs/ARQUITECTURA.md](docs/ARQUITECTURA.md)**.

## Clonar para un cliente nuevo

```bash
# 1. Repo independiente y personalizado (nombre, schema, dominio, módulos)
npm run setup -- --cliente "Cliente X" --schema erp_clientex --dominio clientex.neura.com.py

# 2. Base de datos limpia (crea el schema desde las migraciones canónicas)
npm run provision -- --schema erp_clientex --db "$SUPABASE_DB_URL"

# 3. Listo. El repo y la base quedan 100% independientes del origen.
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
