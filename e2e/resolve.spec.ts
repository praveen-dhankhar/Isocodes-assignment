import { expect, test } from "@playwright/test";
import { DEMO, issueCard, signIn } from "./helpers";

// PLAN M8 verify: SHP-24811 from issues to submitted — accept CC-03 declaring 3,165 kg, confirm the amber field with
// J then Enter, unresolved reaches 0, submit with Ctrl+Enter. Runs on a fresh copy so the seeded one stays as it is.
test("resolve SHP-24811 by keyboard and submit it", async ({ page }) => {
  await signIn(page, DEMO.asha);
  await page.goto("/shipments/new");
  await page.getByRole("listitem").filter({ hasText: "Weight mismatch (from brief)" }).getByRole("button", { name: "Load" }).click();
  await expect(page).toHaveURL(/\/shipments\/[0-9a-f-]{36}$/);
  const card = issueCard(page, /CC-03 Gross weight/);
  await expect(card).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Accept discrepancy" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Value to file")).toHaveValue("3,165.000");
  await expect(dialog).toContainText("Prefilled with the bill of lading value");
  await dialog.getByLabel("Value to file").fill("3,165 kg");
  await dialog.getByLabel("Reason").fill("Carrier re-weighed the container at Ningbo; the B/L weight is final.");
  await dialog.getByRole("button", { name: "Accept discrepancy" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Discrepancy accepted · filing 3,165.000")).toBeVisible();

  // The remaining issue is the low-confidence packing-list net weight.
  await expect(page.getByText("1 issue left")).toBeVisible();
  await page.keyboard.press("j");
  await expect(page.locator("[data-field-id]:focus")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page.getByText("No issues left.")).toBeVisible();
  await expect(page.getByText("0 unresolved")).toBeVisible();

  await page.keyboard.press("Control+Enter");
  await expect(page.getByText("Submitted. A manager approves next.")).toBeVisible();
  await expect(page.getByText("Ready for approval").first()).toBeVisible();
});

test("a misread value is refused with a readable message", async ({ page }) => {
  await signIn(page, DEMO.asha);
  await page.goto("/shipments/new");
  await page.getByRole("listitem").filter({ hasText: "Weight mismatch (from brief)" }).getByRole("button", { name: "Load" }).click();
  await expect(issueCard(page, /CC-03 Gross weight/)).toBeVisible({ timeout: 30_000 });

  await issueCard(page, /PL · Net weight/).click();
  await page.keyboard.press("e");
  const input = page.getByLabel("Net weight (kg), as printed on the document");
  await input.fill("2.880,0O");
  await input.press("Enter");
  await expect(page.getByText("Couldn't read '2.880,0O' as a weight")).toBeVisible();
});
