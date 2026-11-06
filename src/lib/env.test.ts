import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const SECRET = "x".repeat(32);
const base = {
  DATABASE_URL: "postgres://u:p@localhost:5432/customs",
  BETTER_AUTH_SECRET: SECRET,
  BETTER_AUTH_URL: "http://localhost:3000",
  STORAGE_DRIVER: "local",
};

describe("parseEnv", () => {
  it("applies API_SPECS §8 defaults", () => {
    expect(parseEnv(base)).toMatchObject({
      LOCAL_STORAGE_DIR: "./.data",
      SUPABASE_STORAGE_BUCKET: "documents",
      NVIDIA_BASE_URL: "https://integrate.api.nvidia.com/v1",
      NVIDIA_VLM_MODEL: "nvidia/nemotron-3.5-super-vl-120b-a12b",
      NVIDIA_VLM_FALLBACK_MODEL: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
      EXTRACTION_MODE: "auto",
    });
  });

  it("accepts supabase storage when its URL and key are set", () => {
    const env = parseEnv({ ...base, STORAGE_DRIVER: "supabase", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" });
    expect(env.STORAGE_DRIVER).toBe("supabase");
  });

  it.each([
    ["nothing set", {}, ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "STORAGE_DRIVER"]],
    ["empty strings count as unset", { ...base, DATABASE_URL: "", BETTER_AUTH_URL: "" }, ["DATABASE_URL", "BETTER_AUTH_URL"]],
    ["supabase without URL and key", { ...base, STORAGE_DRIVER: "supabase" }, ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]],
    ["short auth secret", { ...base, BETTER_AUTH_SECRET: "too-short-secret" }, ["BETTER_AUTH_SECRET"]],
    ["unknown extraction mode", { ...base, EXTRACTION_MODE: "turbo" }, ["EXTRACTION_MODE"]],
    ["unknown storage driver", { ...base, STORAGE_DRIVER: "s3" }, ["STORAGE_DRIVER"]],
  ])("rejects %s, naming each variable", (_, source, names) => {
    expect(() => parseEnv(source)).toThrow(new RegExp(names.join(".*")));
  });

  it("never puts a value in the error message", () => {
    const source = { ...base, BETTER_AUTH_SECRET: "too-short-secret", NVIDIA_API_KEY: "nvapi-do-not-print", EXTRACTION_MODE: "turbo" };
    let message = "";
    try {
      parseEnv(source);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toContain("BETTER_AUTH_SECRET");
    for (const value of Object.values(source)) expect(message).not.toContain(value);
  });
});
