import { expect, test, type Page } from "@playwright/test";
import { DEMO, openShipment, signIn } from "./helpers";

// PRD §12 responsive: at 390 px S2, S5, S6 and S7 are fully usable — no sideways page scroll, main content visible.
test.use({ viewport: { width: 390, height: 844 } });

const noSidewaysScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

test("S2, S5, S6 and S7 at 390 px", async ({ page }) => {
  await signIn(page, DEMO.meera);
  await expect(page.getByRole("heading", { name: "Shipments", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "SHP-24817" }).filter({ visible: true })).toBeVisible();
  await noSidewaysScroll(page);

  await openShipment(page, "SHP-24817");
  await page.getByRole("navigation", { name: "Shipment" }).getByRole("link", { name: "Approval" }).click();
  await expect(page.getByText("Submitted by Vikram Shah")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();
  await noSidewaysScroll(page);

  await page.getByRole("navigation", { name: "Shipment" }).getByRole("link", { name: "Export" }).click();
  await expect(page.getByRole("heading", { name: "Export is blocked" })).toBeVisible();
  await noSidewaysScroll(page); // the CF-1 table scrolls inside its own box

  await page.goto("/reports/accuracy?samples=1");
  await expect(page.getByRole("heading", { name: "Accuracy and edit history" })).toBeVisible();
  await expect(page.getByText("Field accuracy")).toBeVisible();
});

test("pages carry a nonce CSP and the security headers", async ({ page }) => {
  const response = await page.goto("/login");
  const headers = response?.headers() ?? {};
  expect(headers["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-frame-options"]).toBe("DENY");
  await expect(page.getByRole("button", { name: /sign in/i })).toBeEnabled(); // scripts ran under the CSP
});
