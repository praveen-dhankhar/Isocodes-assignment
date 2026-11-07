import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers";

// PLAN M9 verify: an executive submits, a different user (the manager) approves, and the export downloads CF-1.
test("Asha submits a clean sample, Meera approves and exports it", async ({ browser }) => {
  const asha = await browser.newPage();
  await signIn(asha, DEMO.asha);
  await asha.goto("/shipments/new");
  await asha.getByRole("listitem").filter({ hasText: "European number format" }).getByRole("button", { name: "Load" }).click();
  await expect(asha).toHaveURL(/\/shipments\/[0-9a-f-]{36}$/);
  await expect(asha.getByText("No issues left.")).toBeVisible({ timeout: 30_000 });
  const url = asha.url();

  // Export is blocked before approval, and the screen says why.
  await asha.goto(`${url}/export`);
  await expect(asha.getByRole("heading", { name: "Export is blocked" })).toBeVisible();
  await expect(asha.getByText("A manager has not approved it.")).toBeVisible();

  await asha.goto(url);
  await asha.getByRole("button", { name: "Submit for approval" }).click();
  await expect(asha.getByText("Submitted. A manager approves next.")).toBeVisible();

  // An executive sees the approval screen read-only.
  await asha.goto(`${url}/approval`);
  await expect(asha.getByRole("button", { name: "Approve" })).toBeDisabled();

  const meera = await browser.newPage();
  await signIn(meera, DEMO.meera);
  await meera.goto(`${url}/approval`);
  await expect(meera.getByText("Submitted by Asha Rao")).toBeVisible();
  await meera.getByRole("button", { name: "Approve" }).click();
  await expect(meera.getByText("Approved by Meera Iyer")).toBeVisible();

  await meera.goto(`${url}/export`);
  await expect(meera.getByRole("columnheader", { name: /GROSS_WT_KG/ })).toBeVisible();
  const [download] = await Promise.all([meera.waitForEvent("download"), meera.getByRole("button", { name: "Export as Excel" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^SHP-\d+_CC-2026-0412_CF1_\d{8}-\d{4}\.xlsx$/);
  // The same export is kept in both formats.
  const [csv] = await Promise.all([meera.waitForEvent("download"), meera.getByRole("link", { name: "CSV", exact: true }).click()]);
  expect(csv.suggestedFilename()).toMatch(/\.csv$/);
  await expect(meera.getByText("Exported").first()).toBeVisible();
});
