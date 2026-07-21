import { expect, test } from "@playwright/test";

test("demo scramble reaches the solved screen through the real API", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try demo without camera" }).click();
  await expect(page.getByRole("heading", { name: "Check every facelet" })).toBeVisible();
  await page.getByRole("button", { name: "Validate and solve" }).click();
  await expect(page.getByText(/Move 1 of/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Auto advance" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Manual advance" }).click();
  await expect(page.getByText("Manual advance · use Done / Next", { exact: true })).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(async () => await page.locator(".turn-arrow-highlight").evaluate((element) => getComputedStyle(element).animationName)).toBe("none");

  const total = Number((await page.getByText(/Move 1 of/).textContent())?.match(/of (\d+)/)?.[1]);
  expect(total).toBeGreaterThan(0);
  for (let index = 0; index < total; index += 1) await page.getByRole("button", { name: "Done / Next" }).click();
  await expect(page.getByRole("heading", { name: "Cube solved! 🎉" })).toBeVisible();
  await expect(page.getByText(`${total} optimal HTM moves`)).toBeVisible();
  await expect(page.locator(".guidance-overlay")).toHaveCount(0);
  await expect(page.locator(".confetti")).toHaveCount(0);
});

test("automatic guidance advances once after three seconds and manual mode stops the next timer", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try demo without camera" }).click();
  await page.getByRole("button", { name: "Validate and solve" }).click();
  await expect(page.getByText("Next move in 3", { exact: true })).toBeVisible();
  await expect(page.getByText(/Move 2 of/)).toBeVisible({ timeout: 4_500 });
  await page.getByRole("button", { name: "Manual advance" }).click();
  const currentMove = await page.locator(".move-card .eyebrow").filter({ hasText: /Move \d+ of/ }).textContent();
  await page.waitForTimeout(3_300);
  await expect(page.locator(".move-card .eyebrow").filter({ hasText: /Move \d+ of/ })).toHaveText(currentMove ?? "");
});
