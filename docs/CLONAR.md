# Clonar el ERP para un cliente nuevo

Flujo para que un programador clone el esqueleto de forma **100% consistente**: llena el
formulario de abajo y se lo pasa a Claude (o corre los pasos a mano). Cada clon nace
**vacío e independiente** — repo y base de datos propios, sin arrastrar nada de otro cliente.

---

## 1. Formulario (copiá, completá y pasáselo a Claude)

```
CLONAR ERP — datos del cliente nuevo

# Identidad
Nombre del cliente:        (ej. Ferretería República)
Schema de base de datos:   (ej. erp_republica · minúsculas, empieza con letra, sin espacios)
Dominio:                   (ej. republica.neura.com.py)
Dominio propio (opcional): (ej. ferreteriarepublica.com.py — si tiene web propia)

# Primer usuario (admin)
Email del admin:           (ej. admin@republica.neura.com.py)
Nombre del admin:          (ej. Juan Pérez)
Contraseña:                (dejar vacío = Claude genera una segura y te la pasa)

# Empresas
¿Cuántas empresas maneja?  (1 por defecto · poné varias solo si es multi-empresa)
Nombre(s) de la(s) empresa(s): (ej. Ferretería República S.A.)

# Módulos a activar
(marcá los que necesita; el resto no se instala)
[ ] Facturación / SIFEN   [ ] Chat / WhatsApp   [ ] CRM   [ ] Cobranzas
[ ] Sorteos               [ ] Contabilidad      [ ] ... (los que haya)

# Backend (base de datos)
Supabase a usar:           (compartido por defecto · o "dedicado" si tiene VPS propia)

# Branding (opcional)
Color principal:           (ej. #3F8E91)
Logo:                      (adjuntar / link)
```

> Reglas: el **schema** y el **dominio** son únicos por cliente. El schema es el único
> dato que define el aislamiento en la base. Nada de esto se hardcodea: todo va a
> `.env.local` y `cliente.config.ts`.

---

## 2. Qué hace el flujo con esos datos

1. **Repo:** crea `neura-erp-<cliente>` clonando el esqueleto (sin historial de otros).
2. **`setup.mjs`:** escribe `.env.local` (schema, dominio, Supabase) y `cliente.config.ts`
   (nombre, branding, módulos activos). Deja el repo personalizado en **un solo lugar**.
3. **`provision.mjs`:** crea el schema en la base desde `db/canonical/*.sql` — limpio e
   idempotente. Expone el schema en PostgREST.
4. **`seed-admin.mjs`:** crea la(s) empresa(s) y el usuario admin (auth + rol ADMIN).
5. **Deploy + DNS:** publica en Coolify y apunta el dominio.
6. **Verifica:** login del admin + que la RLS aísle (prueba automática).

Resultado: ERP del cliente **funcionando, aislado y vacío**, listo para que el admin cargue sus datos.

---

## 3. Prompt corto para Claude

> "Cloná el esqueleto neura-erp-2.0 para un cliente nuevo con los datos del formulario de
> `docs/CLONAR.md` que te pego abajo. Seguí el flujo: setup → provision → seed-admin →
> deploy → verificar. Avisame la URL y la contraseña del admin al terminar."
>
> (y pegás el formulario completado)

---

## 4. Checklist de "clon correcto"
- [ ] El repo no menciona ningún otro cliente ni schema (grep limpio).
- [ ] `APP_DB_SCHEMA` = el schema del cliente; nada hardcodeado.
- [ ] El schema existe, con RLS en todas las tablas (`npm run db:verify-rls`).
- [ ] El admin entra y ve solo lo de su empresa.
- [ ] Solo los módulos pedidos están activos.
