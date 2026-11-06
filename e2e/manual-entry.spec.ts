import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers";

// CLAUDE.md product rule 7 / PRD F2.3: an unknown file with no live model fails honestly, and the values can be typed in.
const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");

test("an unknown upload fails without invented values; Enter manually records typed values", async ({ page }) => {
  await signIn(page, DEMO.asha);
  await page.goto("/shipments/new");
  await page.getByLabel("Importer").click();
  await page.getByRole("option", { name: "Company P" }).click();
  await page.getByLabel("Supplier").click();
  await page.getByRole("option", { name: "Company B" }).click();
  await page.getByLabel("Upload commercial invoice").setInputFiles({ name: "scan.png", mimeType: "image/png", buffer: PNG_1PX });
  await page.getByRole("button", { name: "Create shipment and upload" }).click();
  await expect(page).toHaveURL(/\/shipments\/[0-9a-f-]{36}$/);

  const enter = page.getByRole("button", { name: "Enter manually" });
  await expect(enter).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("No live model or recorded sample for this file")).toBeVisible();
  await expect(page.getByText("Recorded sample", { exact: true })).toHaveCount(0); // no mode badge: nothing was made up
  await enter.click();
  await expect(enter).toBeHidden();

  await page.getByRole("list", { name: "Open issues" }).getByRole("button", { name: /INV · Invoice no\./ }).click();
  await page.keyboard.press("e");
  await page.getByLabel("Invoice no., as printed on the document").fill("CB-2026-9001");
  await page.getByLabel("Invoice no., as printed on the document").press("Enter");
  await expect(page.locator("[data-field-id]").filter({ hasText: "CB-2026-9001" }).getByText("Entered")).toBeVisible();

  // A missing slot can be filled from here.
  await page.getByRole("tab", { name: "PL" }).click();
  await expect(page.getByText("No packing list uploaded")).toBeVisible();
  await expect(page.getByLabel("Upload packing list")).toBeAttached();
});
