// ESLint 9 (flat config). Reemplaza al .eslintrc.json, que ESLint 9 ya no lee y que Next 16
// dejó sin `next lint`: el lint no corría y las reglas de abajo no se cumplían.
import nextVitals from "eslint-config-next/core-web-vitals";

const sinClienteSuelto = {
  name: "@supabase/supabase-js",
  importNames: ["createClient"],
  message:
    "No crees clientes de Supabase sueltos en páginas/rutas. Usá los helpers de @/lib/supabase/* (browser) o el ctx de withTenant (server).",
};

const sinServiceRole = {
  group: ["**/supabase/clients", "**/lib/supabase/clients"],
  importNames: ["systemClient", "scopedServiceClient"],
  message:
    "Las rutas no usan service-role directo. Accedé a datos por ctx.db (withTenant); para casos excepcionales, ctx.db.unsafeRaw() revisado.",
};

export default [
  { ignores: [".next/**", "node_modules/**", "public/**", "next-env.d.ts"] },
  ...nextVitals,
  {
    // Reglas nuevas del React Compiler (react-hooks v7, vino con Next 16). El código es anterior a
    // ellas: quedan como aviso para ir corrigiéndolas, sin trabar el lint de lo que sí importa.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/use-memo": "warn",
      "react/no-unescaped-entities": "warn",
    },
  },
  {
    files: ["src/app/**/*.ts", "src/app/**/*.tsx"],
    rules: { "no-restricted-imports": ["error", { paths: [sinClienteSuelto] }] },
  },
  {
    // En las rutas /api valen las dos reglas (en flat config un bloque posterior reemplaza la regla,
    // así que van juntas).
    files: ["src/app/api/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { paths: [sinClienteSuelto], patterns: [sinServiceRole] }] },
  },
];
