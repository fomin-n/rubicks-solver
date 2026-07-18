import { expect, test } from "@playwright/test";

test("demo scramble reaches the solved screen through the real API", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try demo without camera" }).click();
  await expect(page.getByRole("heading", { name: "Check every facelet" })).toBeVisible();
  await page.getByRole("button", { name: "Validate and solve" }).click();
  await expect(page.getByText(/Move 1 of/)).toBeVisible();

  const total = Number((await page.getByText(/Move 1 of/).textContent())?.match(/of (\d+)/)?.[1]);
  expect(total).toBeGreaterThan(0);
  for (let index = 0; index < total; index += 1) await page.getByRole("button", { name: "Done / Next" }).click();
  await expect(page.getByRole("heading", { name: "Cube solved" })).toBeVisible();
  await expect(page.getByText(`${total} optimal HTM moves. Nice work.`)).toBeVisible();
});

