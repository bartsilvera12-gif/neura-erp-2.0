/**
 * NEURA QA CENTER — endpoint de verificación de entorno para `neura-erp-2.0`.
 *
 * Es el único endpoint que agrega esta rama. Lo usa el runner de QA Center
 * ANTES de abrir Playwright: si la respuesta no es `200 { prod_safe: true }`,
 * el runner aborta sin tocar nada.
 *
 * Diseño:
 *   - Aditivo: archivo nuevo, no modifica ningún otro archivo del ERP.
 *   - Sin dependencias: no importa nada del resto del repo. Sólo lee env vars.
 *   - Sin side effects: no escribe en BD, no llama a terceros, no autentica.
 *   - Nunca expone secretos. Devuelve nombres de host y refs, nunca keys.
 *
 * Reglas de aislamiento — TODAS deben cumplirse para `prod_safe = true`.
 * `QA_ENV=staging` por sí solo NO alcanza:
 *   1. `QA_ENV` en {"staging","preview","local"} — nunca "production".
 *   2. `QA_ALLOWED_SUPABASE_HOSTS` declarada y contiene el host actual de
 *      NEXT_PUBLIC_SUPABASE_URL.
 *   3. `QA_ALLOWED_APP_SCHEMAS` declarada y contiene APP_DB_SCHEMA. Y
 *      APP_DB_SCHEMA NO está en la lista hard-coded de schemas productivos.
 *   4. El host del request (Host header) NO corresponde a un dominio
 *      productivo conocido (sistemas.*).
 *   5. Ninguna integración productiva está armada: no deben existir
 *      BAILEYS_BRIDGE_SECRET, FIREBASE_SERVICE_ACCOUNT_JSON_BASE64,
 *      ANTHROPIC_API_KEY, WHATSAPP_ACCESS_TOKEN, YCLOUD_API_KEY,
 *      META_MSG_ACCESS_TOKEN.
 *   6. Ninguna credencial con alcance multi-schema debe existir:
 *      SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL, SUPABASE_DIRECT_URL,
 *      DATABASE_URL, POSTGRES_URL*. Todas bypassean RLS y pueden tocar
 *      cualquier schema; aún con APP_DB_SCHEMA acotado, son blocker.
 *   7. Si SIFEN_SECRETS_KEY está seteado, exige SIFEN_MODE explícito en
 *      {test, disabled, sandbox}.
 *
 * Si `QA_ENV=production` o ausente → 403 sin detalle.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Hosts productivos conocidos del app (dominios de clientes de Neura). */
const PROD_APP_HOSTS: ReadonlyArray<string> = [
  "sistemas.neura.com.py",
  "sistemas-new.neura.com.py",
  "www.sistemas-new.neura.com.py",
];

/**
 * Schemas conocidos como productivos. No es exhaustivo (hay 180+ clientes).
 * El check real es por allowlist positiva (QA_ALLOWED_APP_SCHEMAS). Esto es
 * una red de seguridad extra: aún con allowlist mal configurada, estos
 * nombres específicos nunca pueden pasar el gate.
 */
const PROD_APP_SCHEMAS_BLOCKLIST: ReadonlyArray<string> = [
  "neura",
  "zentra",
  "zentra_erp",
  "aigonerp",
  "mevoerp",
  "mevovendedores",
];

/** Integraciones productivas: si está presente la env var, el entorno no es QA. */
const LIVE_INTEGRATION_ENVS: ReadonlyArray<string> = [
  "BAILEYS_BRIDGE_SECRET",
  "FIREBASE_SERVICE_ACCOUNT_JSON_BASE64",
  "FIREBASE_SECUNDARIO_SERVICE_ACCOUNT_JSON_BASE64",
  "ANTHROPIC_API_KEY",
  "WHATSAPP_ACCESS_TOKEN",
  "YCLOUD_API_KEY",
  "META_MSG_ACCESS_TOKEN",
  "VAPID_PRIVATE_KEY",
];

/**
 * Credenciales con alcance MULTI-SCHEMA: aún con APP_DB_SCHEMA acotado, estas
 * bypassean RLS y pueden tocar cualquier schema del clúster. Su sola presencia
 * invalida la declaración de aislamiento. Para considerar QA un deploy, estas
 * NO pueden estar seteadas — hay que removerlas del env.
 */
const MULTI_SCHEMA_CREDENTIAL_ENVS: ReadonlyArray<string> = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_DB_URL",
  "SUPABASE_DIRECT_URL",
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
];

/**
 * SIFEN permite modo test. La clave sola no basta: exigimos que SIFEN_MODE
 * esté explícitamente en {test, disabled, sandbox}. Cualquier otro valor (o
 * ausente) con la clave presente se considera live.
 */
const SIFEN_SAFE_MODES: ReadonlyArray<string> = ["test", "disabled", "sandbox"];

type QaTargetEnv = "staging" | "preview" | "local";

type QaEnvAssertResponse = {
  env: QaTargetEnv;
  supabase_host: string;
  supabase_ref: string | null;
  app_schema: string;
  server_time: string;
  commit_sha: string | null;
  prod_safe: boolean;
  reasons: string[];
};

type QaEnvAssertError = {
  error: string;
  code: "forbidden_production";
};

export async function GET(request: Request): Promise<NextResponse> {
  const rawEnv = (process.env.QA_ENV ?? "").trim().toLowerCase();

  // 1) Modo producción: nunca exponer detalle. 403.
  if (rawEnv === "production" || rawEnv === "") {
    const body: QaEnvAssertError = {
      error: "QA Center is not available in production.",
      code: "forbidden_production",
    };
    return NextResponse.json(body, {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (!["staging", "preview", "local"].includes(rawEnv)) {
    const body: QaEnvAssertError = {
      error: "QA Center is not available in production.",
      code: "forbidden_production",
    };
    return NextResponse.json(body, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const env = rawEnv as QaTargetEnv;

  const reasons: string[] = [`QA_ENV=${env}`];

  // 2) Supabase host debe estar en allowlist explícita.
  const supabaseHost = extractHost(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  const allowedSupabase = splitCsv(process.env.QA_ALLOWED_SUPABASE_HOSTS ?? "");
  let supabaseOk = false;
  if (!supabaseHost) {
    reasons.push("NEXT_PUBLIC_SUPABASE_URL no está configurada o no parsea");
  } else if (allowedSupabase.length === 0) {
    reasons.push("QA_ALLOWED_SUPABASE_HOSTS no está configurada");
  } else if (!allowedSupabase.includes(supabaseHost.toLowerCase())) {
    reasons.push(`supabase_host=${supabaseHost} no está en QA_ALLOWED_SUPABASE_HOSTS`);
  } else {
    supabaseOk = true;
  }

  // 3) APP_DB_SCHEMA con doble chequeo: allowlist positiva + blocklist negativa.
  const appSchema = (process.env.APP_DB_SCHEMA ?? "").trim();
  const allowedSchemas = splitCsv(process.env.QA_ALLOWED_APP_SCHEMAS ?? "");
  let schemaOk = false;
  if (!appSchema) {
    reasons.push("APP_DB_SCHEMA no está configurada");
  } else if (PROD_APP_SCHEMAS_BLOCKLIST.includes(appSchema.toLowerCase())) {
    reasons.push(`APP_DB_SCHEMA=${appSchema} está en la lista de schemas productivos`);
  } else if (allowedSchemas.length === 0) {
    reasons.push("QA_ALLOWED_APP_SCHEMAS no está configurada");
  } else if (!allowedSchemas.includes(appSchema.toLowerCase())) {
    reasons.push(`APP_DB_SCHEMA=${appSchema} no está en QA_ALLOWED_APP_SCHEMAS`);
  } else {
    schemaOk = true;
  }

  // 4) Host del request (donde aterrizó esta petición) no debe ser productivo.
  const requestHost = extractRequestHost(request);
  let hostOk = true;
  if (requestHost && PROD_APP_HOSTS.includes(requestHost.toLowerCase())) {
    reasons.push(`request_host=${requestHost} está en PROD_APP_HOSTS`);
    hostOk = false;
  }

  // 5) Integraciones productivas: ninguna debe estar seteada.
  let integrationsOk = true;
  for (const key of LIVE_INTEGRATION_ENVS) {
    if ((process.env[key] ?? "").trim() !== "") {
      reasons.push(`integración viva detectada: ${key}`);
      integrationsOk = false;
    }
  }

  // 6) Credenciales de alcance multi-schema: BLOCKING aún si APP_DB_SCHEMA está
  //    acotado. Protege contra escenarios donde código del propio ERP (o un
  //    attacker) ejecute queries cross-schema bypaseando RLS.
  let credentialsOk = true;
  for (const key of MULTI_SCHEMA_CREDENTIAL_ENVS) {
    if ((process.env[key] ?? "").trim() !== "") {
      reasons.push(
        `credencial de alcance multi-schema presente: ${key} — remover del env para habilitar QA`
      );
      credentialsOk = false;
    }
  }

  // 7) SIFEN: si la clave está seteada, requerimos SIFEN_MODE explícito en
  //    la lista blanca (test/disabled/sandbox). Cualquier otro caso = live.
  let sifenOk = true;
  if ((process.env.SIFEN_SECRETS_KEY ?? "").trim() !== "") {
    const sifenMode = (process.env.SIFEN_MODE ?? "").trim().toLowerCase();
    if (!SIFEN_SAFE_MODES.includes(sifenMode)) {
      reasons.push(
        `SIFEN_SECRETS_KEY presente con SIFEN_MODE="${sifenMode || "ausente"}" (requerido: test|disabled|sandbox)`
      );
      sifenOk = false;
    }
  }

  const prod_safe =
    supabaseOk && schemaOk && hostOk && integrationsOk && credentialsOk && sifenOk;

  const payload: QaEnvAssertResponse = {
    env,
    supabase_host: supabaseHost ?? "(sin configurar)",
    supabase_ref: extractSupabaseRef(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""),
    app_schema: appSchema || "(sin configurar)",
    server_time: new Date().toISOString(),
    commit_sha:
      (process.env.SOURCE_COMMIT ??
        process.env.VERCEL_GIT_COMMIT_SHA ??
        null) || null,
    prod_safe,
    reasons,
  };

  return NextResponse.json(payload, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}

/** Extrae el hostname del NEXT_PUBLIC_SUPABASE_URL sin credenciales. */
function extractHost(url: string): string | null {
  const t = url.trim();
  if (!t) return null;
  try {
    return new URL(t).hostname || null;
  } catch {
    return null;
  }
}

/** Host del propio request (desde Host header). */
function extractRequestHost(request: Request): string | null {
  try {
    return new URL(request.url).hostname || null;
  } catch {
    return null;
  }
}

/** Lista separada por coma, normalizada a lowercase. */
function splitCsv(raw: string): ReadonlyArray<string> {
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Deriva un "ref" corto del JWT del Supabase ANON KEY, sin exponer la key.
 * Devuelve `iss:iat` para self-hosted. Si no parsea, null.
 */
function extractSupabaseRef(key: string): string | null {
  const t = key.trim();
  if (!t) return null;
  const parts = t.split(".");
  if (parts.length !== 3) return null;
  try {
    const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payloadB64 + "=".repeat((4 - (payloadB64.length % 4)) % 4);
    const json = Buffer.from(padded, "base64").toString("utf8");
    const payload = JSON.parse(json) as Record<string, unknown>;
    const iss = typeof payload.iss === "string" ? payload.iss : "";
    const ref = typeof payload.ref === "string" ? payload.ref : "";
    const iat = typeof payload.iat === "number" ? payload.iat : 0;
    return ref || (iss ? `${iss}:${iat}` : null);
  } catch {
    return null;
  }
}
