import { expect, test } from "@playwright/test";

const MOBILE_WIDTHS = [320, 360, 390, 430];

for (const width of MOBILE_WIDTHS) {
  test(`la cabecera no desborda en un móvil de ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/index.html");

    await page.evaluate(() => {
      document.getElementById("loginScreen").style.display = "none";
      document.getElementById("appContainer").style.display = "block";
      for (const id of ["btnEquipos", "btnSolicitudes", "btnUsuarios", "btnAuditoria"]) {
        document.getElementById(id).style.display = "inline-block";
      }
    });

    const layout = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      pageWidth: document.documentElement.scrollWidth,
      buttons: [...document.querySelectorAll(".header-action")].map((button) => {
        const rect = button.getBoundingClientRect();
        return { left: rect.left, right: rect.right, height: rect.height };
      }),
    }));

    expect(layout.pageWidth).toBe(layout.viewport);
    for (const button of layout.buttons) {
      expect(button.left).toBeGreaterThanOrEqual(0);
      expect(button.right).toBeLessThanOrEqual(layout.viewport);
      expect(button.height).toBeGreaterThanOrEqual(44);
    }
  });
}

test("la instalación conserva zoom accesible y modo aplicación", async ({ page, request }) => {
  await page.goto("/index.html");

  const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(viewport).toContain("width=device-width");
  expect(viewport).toContain("viewport-fit=cover");
  expect(viewport).not.toContain("user-scalable=no");

  const manifestResponse = await request.get("/manifest.json");
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = await manifestResponse.json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.id).toBe("./index.html");
  expect(manifest.start_url).toBe("./");
});
