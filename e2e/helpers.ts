import { expect, type Page } from "@playwright/test";

export const DEMO = { asha: "asha@demo.test", vikram: "vikram@demo.test", meera: "meera@demo.test" } as const;

export async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(process.env.SEED_DEMO_PASSWORD ?? "");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/shipments/);
}

/** Opens a seeded sample shipment from the list (S2 → S4). */
export async function openShipment(page: Page, ref: string) {
  await page.goto(`/shipments?q=${encodeURIComponent(ref)}`);
  await page.getByRole("link", { name: ref }).filter({ visible: true }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: ref })).toBeVisible();
}

/** An issue card in S4's "Open issues" list (the "All checks" list repeats check names). */
export const issueCard = (page: Page, name: RegExp | string) => page.getByRole("list", { name: "Open issues" }).getByRole("button", { name });
