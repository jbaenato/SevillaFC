import { expect, test } from "@playwright/test";

test("Sentry desactivado no envía telemetría", async ({ page }) => {
  let envios = 0;
  await page.route("**/__sentry-test", async (route) => {
    envios += 1;
    await route.fulfill({ status: 200, body: "" });
  });
  await page.addInitScript(() => {
    globalThis.__SEVILLAFC_CONFIG__ = {
      sentryEnabled: false,
      sentryTunnel: "/__sentry-test"
    };
  });

  await page.goto("/tests/fixtures/sentry-browser.html");
  const habilitado = await page.evaluate(() => AppSentry.estaHabilitado());
  expect(habilitado).toBe(false);

  await page.evaluate(() => {
    AppSentry.capturarExcepcion(new Error("Error que no debe salir"), {
      contexto: "prueba-desactivada"
    });
  });
  await page.waitForTimeout(250);
  expect(envios).toBe(0);
});

test("Sentry captura errores controlados y elimina datos personales", async ({ page }) => {
  const envios = [];
  await page.route("**/__sentry-test", async (route) => {
    envios.push(route.request().postData() || "");
    await route.fulfill({ status: 200, body: "" });
  });
  await page.addInitScript(() => {
    globalThis.__SEVILLAFC_CONFIG__ = {
      sentryEnabled: true,
      sentryTunnel: "/__sentry-test",
      sentryEnvironment: "pruebas",
      sentryRelease: "sevillafc-test"
    };
  });

  await page.goto("/tests/fixtures/sentry-browser.html");
  expect(await page.evaluate(() => AppSentry.estaHabilitado())).toBe(true);

  await page.evaluate(() => {
    AppSentry.capturarExcepcion(
      new Error("Fallo del técnico tecnico@example.com en 11111111-1111-4111-8111-111111111111"),
      {
        contexto: "prueba-sentry",
        usuario_id: "11111111-1111-4111-8111-111111111111",
        correo: "tecnico@example.com"
      }
    );
  });

  await expect.poll(() => envios.length).toBeGreaterThan(0);
  const envelope = envios.join("\n");
  expect(envelope).toContain("prueba-sentry");
  expect(envelope).toContain("[correo eliminado]");
  expect(envelope).toContain("[id eliminado]");
  expect(envelope).not.toContain("tecnico@example.com");
  expect(envelope).not.toContain("11111111-1111-4111-8111-111111111111");
});
