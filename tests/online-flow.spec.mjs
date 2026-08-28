import { test, expect } from "@playwright/test";

const supabaseUrl = process.env.TEST_SUPABASE_URL;
const supabaseKey = process.env.TEST_SUPABASE_ANON_KEY;
const email = process.env.TEST_USER_EMAIL;
const password = process.env.TEST_USER_PASSWORD;

test("flujo online completo: login, evaluación, guardado y consulta", async ({ page }) => {
  expect(supabaseUrl, "Falta TEST_SUPABASE_URL").toBeTruthy();
  expect(supabaseKey, "Falta TEST_SUPABASE_ANON_KEY").toBeTruthy();
  expect(email, "Falta TEST_USER_EMAIL").toBeTruthy();
  expect(password, "Falta TEST_USER_PASSWORD").toBeTruthy();

  await page.addInitScript(
    ({ url, key }) => {
      globalThis.__SEVILLAFC_CONFIG__ = { supabaseUrl: url, supabaseKey: key, sentryEnabled: false };
    },
    { url: supabaseUrl, key: supabaseKey }
  );

  await page.goto("/");

  await page.locator("#loginEmail").fill(email);
  await page.locator("#loginPassword").fill(password);
  await page.locator("#btnLogin").click();

  await expect(page.locator("#appContainer")).toBeVisible();
  await expect(page.locator("#evaluador")).toHaveValue("Técnico E2E");

  await page.getByLabel("F11 E2E").check();
  await expect(page.locator("#restoFormulario")).toBeVisible();
  await expect(page.locator("details.section")).toHaveCount(4);

  await page.locator("#nombre").fill("Portero prueba online E2E");
  await page.locator("#equipo").fill("Equipo prueba online E2E");
  await page.getByLabel("Derecha").check();
  await page.locator("#anioNacimiento").fill("2006");
  await page.locator("#fecha").fill("2026-08-28");
  await page.getByLabel("Directo").check();
  await page.locator("#partido").fill("Equipo E2E A vs Equipo E2E B");
  await page.locator("#observaciones").fill("Evaluación creada por la prueba online automática.");

  await page.locator("details.section").evaluateAll((sections) => {
    sections.forEach((section) => { section.open = true; });
  });
  for (let index = 0; index < 4; index += 1) {
    await page.locator(".nd-btn").nth(index).click();
  }
  await expect(page.locator(".slider:not([disabled])")).toHaveCount(4);

  await page.getByLabel("B", { exact: true }).check();
  await page.locator("#guardar").click();

  await expect(page.locator("#modalRepaso")).toBeVisible();
  await expect(page.locator("#resumenRepaso")).toContainText("Portero prueba online E2E");
  await expect(page.locator("#resumenRepaso")).toContainText("4 de 4");

  const guardado = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    response.url().endsWith("/functions/v1/guardar-evaluacion")
  );
  await page.locator("#confirmarGuardar").click();

  const respuesta = await guardado;
  expect(respuesta.status()).toBe(200);
  const resultado = await respuesta.json();
  expect(resultado.success).toBe(true);
  expect(resultado.duplicada).toBe(false);

  await expect(page.locator("#status")).toHaveText("Evaluación guardada correctamente.");
  await page.locator("#buscarGuardadas").fill("Portero prueba online E2E");

  const fila = page.locator("#savedList .saved-row");
  await expect(fila).toHaveCount(1);
  await expect(fila).toContainText("Portero prueba online E2E");
  await expect(fila).toContainText("Equipo prueba online E2E");
  await expect(fila).toContainText("Técnico E2E");

  await fila.click();
  await expect(page.locator("#modalDetalle")).toBeVisible();
  await expect(page.locator("#detalleContenido")).toContainText("Equipo E2E A vs Equipo E2E B");
  await expect(page.locator("#detalleItemsContenido")).toContainText("Juego con el pie E2E");
  await expect(page.locator("#detalleItemsContenido")).toContainText("Concentración E2E");
  await expect(page.locator("#detalleItemsContenido")).toContainText("2,50");
});
