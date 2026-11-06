import { expect, test } from "@playwright/test";
import { DEMO, issueCard, openShipment, signIn } from "./helpers";

// PLAN M7 verify: SHP-24811's gross-weight mismatch is visible, selectable and traced to its source.
test("SHP-24811: CC-03 card shows the three weights and the delta, and points at the packing list", async ({ page }) => {
  await signIn(page, DEMO.asha);
  await openShipment(page, "SHP-24811");

  const card = issueCard(page, /CC-03 Gross weight/);
  await expect(card).toContainText("3,120.000 kg");
  await expect(card).toContainText("3,165.000 kg");
  await expect(card.getByText("3,165.000 kg", { exact: true })).toHaveCount(2); // PL and B/L rows
  await expect(card).toContainText("Δ 45.000 kg");
  await expect(page.getByText("Recorded sample").first()).toBeVisible();

  await card.click();
  await expect(page.getByRole("tab", { name: "PL" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("source-box")).toBeVisible();
});

test("at 390 px the Document · Fields · Issues tabs switch the view", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, DEMO.asha);
  await openShipment(page, "SHP-24811");

  const tabs = page.getByRole("tablist", { name: "Review sections" });
  await expect(issueCard(page, /CC-03 Gross weight/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Document viewer" })).toBeHidden();

  await tabs.getByRole("tab", { name: "Fields" }).click();
  await expect(page.getByRole("heading", { name: "Invoice", exact: true })).toBeVisible();
  await expect(issueCard(page, /CC-03 Gross weight/)).toBeHidden();

  await tabs.getByRole("tab", { name: "Document" }).click();
  await expect(page.getByRole("region", { name: "Document viewer" })).toBeVisible();
  await expect(page.getByRole("img", { name: /page 1/ })).toBeVisible();
});

test("a loaded sample set opens the review screen, which reads its documents", async ({ page }) => {
  await signIn(page, DEMO.asha);
  await page.goto("/shipments/new");
  await page.getByRole("listitem").filter({ hasText: "Invoice only (draft)" }).getByRole("button", { name: "Load" }).click();
  await expect(page).toHaveURL(/\/shipments\/[0-9a-f-]{36}$/);

  // Extraction starts on open; the recorded sample fills the invoice and the two missing slots stay open issues.
  await expect(page.getByText("Recorded sample")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Packing list: not uploaded" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Bill of lading: not uploaded" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Invoice, page 1" })).toBeVisible(); // the viewer opens on the uploaded slot
});
