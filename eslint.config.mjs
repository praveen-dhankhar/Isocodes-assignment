import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Layering (ARCHITECTURE §3): app → components / server/actions → server/services → domain + server/db.
// Each pattern matches "@/<layer>" and relative paths that climb into <layer>.
const layer = (name) => `^(@|\\.{1,2})/(.*/)?${name}(/|$)`;
const restrict = (...patterns) => ({
  "no-restricted-imports": ["error", { patterns }],
});
const DB = { group: ["drizzle-orm", "drizzle-orm/*", "postgres"], message: "Database access belongs in src/server." };

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "coverage/**", "next-env.d.ts"]),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "e2e/**"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
  {
    files: ["src/components/**/*.{ts,tsx}", "src/app/**/*.tsx"],
    rules: { "max-lines": ["error", 250] },
  },
  {
    // Pure: same input → same output.
    files: ["src/domain/**"],
    rules: {
      ...restrict(
        { regex: layer("(app|components|server|lib)"), message: "src/domain imports only from src/domain." },
        { group: ["react", "react/*", "react-dom", "react-dom/*", "next", "next/*", "server-only"], message: "src/domain is framework-free." },
        DB,
      ),
      "import/no-nodejs-modules": "error",
      "no-restricted-globals": ["error", { name: "fetch", message: "src/domain does no I/O." }],
      "no-restricted-properties": [
        "error",
        { object: "Date", property: "now", message: "src/domain is deterministic; pass the time in." },
        { object: "Math", property: "random", message: "src/domain is deterministic." },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: "src/domain is deterministic; pass the time in." },
      ],
    },
  },
  {
    // Tests may read files (fields.test.ts compares the registry with the PRD); domain code may not.
    files: ["src/domain/**/*.test.ts"],
    rules: { "import/no-nodejs-modules": "off" },
  },
  {
    files: ["src/lib/**"],
    rules: restrict({ regex: layer("(app|components|server)"), message: "src/lib is shared; it cannot depend on app layers." }),
  },
  {
    files: ["src/components/**"],
    rules: restrict(
      { regex: layer("app"), message: "Components cannot import from src/app." },
      { regex: `${layer("server")}(?!actions(/|$))`, allowTypeImports: true, message: "Components reach the server only through src/server/actions." },
      DB,
    ),
  },
  {
    files: ["src/app/**"],
    rules: restrict({ regex: layer("server/db"), message: "Pages and routes go through services or queries, not src/server/db." }, DB),
  },
  {
    files: ["src/server/actions/**"],
    rules: restrict(
      { regex: layer("(app|components|server/db)"), message: "Actions validate, authorise and call one service." },
      DB,
    ),
  },
  {
    files: ["src/server/**"],
    ignores: ["src/server/actions/**"],
    rules: restrict({ regex: layer("(app|components|server/actions)"), message: "Server code cannot depend on UI or actions." }),
  },
]);

export default eslintConfig;
