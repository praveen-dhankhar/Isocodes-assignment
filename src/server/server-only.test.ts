import { expect, it } from "vitest";

it("loads server-only modules under Vitest (aliased to a stub)", async () => {
  await expect(import("server-only")).resolves.toBeDefined();
});
