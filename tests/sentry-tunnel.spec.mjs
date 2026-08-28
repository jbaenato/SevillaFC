import { expect, test } from "@playwright/test";

const supabaseUrl = process.env.TEST_SUPABASE_URL;

test("el túnel de Sentry rechaza destinos ajenos y métodos incorrectos", async ({ request }) => {
  expect(supabaseUrl, "Falta TEST_SUPABASE_URL").toBeTruthy();
  const tunnel = supabaseUrl + "/functions/v1/sentry-tunnel";

  const destinoAjeno = [
    JSON.stringify({ dsn: "https://clave-publica@example.com/123" }),
    JSON.stringify({ type: "event" }),
    JSON.stringify({ message: "No debe reenviarse" })
  ].join("\n");

  const respuestaAjena = await request.post(tunnel, {
    data: destinoAjeno,
    headers: { "Content-Type": "application/x-sentry-envelope" },
    failOnStatusCode: false
  });
  expect(respuestaAjena.status()).toBe(403);

  const metodoIncorrecto = await request.get(tunnel, { failOnStatusCode: false });
  expect(metodoIncorrecto.status()).toBe(405);
});
