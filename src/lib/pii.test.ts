import { describe, expect, it } from "vitest";
import { maskEmail, maskPhone } from "./pii";

describe("PII masking", () => {
  it.each([
    ["imports.p@example.test", "im•••••••@example.test"],
    ["ab@x.test", "ab•••@x.test"],
    [null, ""],
  ])("maskEmail(%s) → %s", (email, masked) => expect(maskEmail(email)).toBe(masked));

  it("keeps only the country code and the last two digits of a phone number", () => {
    expect(maskPhone("+91 90000 00001")).toBe("+91 ••••• •••01");
    expect(maskPhone(null)).toBe("");
  });
});
