import "server-only";
import { z } from "zod";

// API_SPECS §8. Empty strings count as unset, so a copied .env.example parses as "missing".
const EnvSchema = z
  .object({
    DATABASE_URL: z.string(),
    DATABASE_URL_TEST: z.string().optional(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    STORAGE_DRIVER: z.enum(["local", "supabase"]),
    LOCAL_STORAGE_DIR: z.string().default("./.data"),
    SUPABASE_URL: z.url().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
    SUPABASE_STORAGE_BUCKET: z.string().default("documents"),
    NVIDIA_API_KEY: z.string().optional(),
    NVIDIA_BASE_URL: z.url().default("https://integrate.api.nvidia.com/v1"),
    NVIDIA_VLM_MODEL: z.string().default("nvidia/nemotron-3.5-super-vl-120b-a12b"),
    NVIDIA_VLM_FALLBACK_MODEL: z.string().default("nvidia/nemotron-nano-12b-v2-vl"),
    EXTRACTION_MODE: z.enum(["auto", "live", "sample"]).default("auto"),
    SEED_DEMO_PASSWORD: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER !== "supabase") return;
    for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
      if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: "required for supabase storage" });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

/** Throws an error that names the bad variables — never their values. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const set = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ""));
  const result = EnvSchema.safeParse(set);
  if (result.success) return result.data;
  const names = [...new Set(result.error.issues.map((i) => String(i.path[0])))];
  throw new Error(`Missing or invalid environment variables: ${names.join(", ")}`);
}

let cached: Env | undefined;

/** Validated on first server use, not at import, so `next build` and unit tests run without secrets. */
export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
