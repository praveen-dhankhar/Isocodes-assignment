import { expect, test, type Page } from "@playwright/test";
import { DEMO, issueCard, signIn } from "./helpers";

// PLAN M8 verify: accept CC-03 declaring 3,165 kg, confirm uncertain values with J then Enter, unresolved reaches 0,
// submit. Each test loads a fresh copy of a sample set so the seeded shipments stay as they are.
async function loadSample(page: Page, title: string) {
  await signIn(page, DEMO.asha);
  await page.goto("/shipments/new");
  await page.getByRole("listitem").filter({ hasText: title }).getByRole("button", { name: "Load" }).click();
  await expect(page).toHaveURL(/\/shipments\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Recorded sample").first()).toBeVisible({ timeout: 30_000 });
}

test("SHP-24811: accept the CC-03 discrepancy at 3,165 kg and submit with Ctrl+Enter", async ({ page }) => {
  await loadSample(page, "Weight mismatch (from brief)");
  await issueCard(page, /CC-03 Gross weight/).waitFor();

  await page.getByRole("button", { name: "Accept discrepancy" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Value to file")).toHaveValue("3,165.000");
  await expect(dialog).toContainText("Prefilled with the bill of lading value");
  await dialog.getByLabel("Value to file").fill("3,165 kg");
  await dialog.getByLabel("Reason").fill("Carrier re-weighed the container at Ningbo; the B/L weight is final.");
  await dialog.getByRole("button", { name: "Accept discrepancy" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Discrepancy accepted · filing 3,165.000")).toBeVisible();

  await expect(page.getByText("No issues left.")).toBeVisible();
  await page.keyboard.press("Control+Enter");
  await expect(page.getByText("Submitted. A manager approves next.")).toBeVisible();
  await expect(page.getByText("Ready for approval").first()).toBeVisible();
});

test("J moves through the issues and Enter confirms an uncertain value", async ({ page }) => {
  await loadSample(page, "Phone-scanned B/L, bad container check digit");
  const left = page.getByText(/^\d+ issues? left$/);
  await expect(left).toBeVisible();
  const before = Number((await left.textContent())?.split(" ")[0]);

  // Mismatches come first; keep pressing J until a field row (not a check card) has the focus, then confirm it.
  for (let i = 0; i < 5 && (await page.locator("[data-field-id]:focus").count()) === 0; i++) await page.keyboard.press("j");
  await expect(page.locator("[data-field-id]:focus")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page.getByText(before - 1 === 0 ? "No issues left." : `${before - 1} issue${before - 1 === 1 ? "" : "s"} left`)).toBeVisible();
});

test("a misread value is refused with a readable message", async ({ page }) => {
  await loadSample(page, "Weight mismatch (from brief)");
  const row = page.locator("[data-field-id]").filter({ hasText: "3,120.000" }).first();
  await row.getByRole("button", { name: "Gross weight (kg)", exact: true }).click();
  await page.keyboard.press("e");
  const input = page.getByLabel("Gross weight (kg), as printed on the document");
  await input.fill("3.120,0O");
  await input.press("Enter");
  await expect(page.getByText("Couldn't read '3.120,0O' as a weight")).toBeVisible();
});
