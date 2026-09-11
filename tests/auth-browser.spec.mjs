import { expect, test } from "@playwright/test";

function clienteSupabaseSimulado(){
  return `
    window.__authCallbacks = [];
    window.__authCalls = { signUp: [], reset: [], verify: [], update: [] };
    window.supabase = {
      createClient: function () {
        return { auth: {
          onAuthStateChange: function (callback) {
            window.__authCallbacks.push(callback);
            return { data: { subscription: { unsubscribe: function () {} } } };
          },
          getSession: async function () { return { data: { session: null } }; },
          signInWithPassword: async function () { return { data: {}, error: null }; },
          signUp: async function (payload) { window.__authCalls.signUp.push(payload); return { data: { session: null }, error: null }; },
          resetPasswordForEmail: async function (email, options) { window.__authCalls.reset.push({ email, options }); return { data: {}, error: null }; },
          verifyOtp: async function (payload) {
            window.__authCalls.verify.push(payload);
            return { data: { session: { user: { id: "usuario-prueba", email: payload.email }, access_token: "token" } }, error: null };
          },
          updateUser: async function (payload) { window.__authCalls.update.push(payload); return { data: {}, error: null }; },
          signOut: async function () { return { error: null }; }
        }};
      }
    };
  `;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { globalThis.__SEVILLAFC_CONFIG__ = { sentryEnabled: false }; });
  await page.route("**/supabase.min.js", route => route.fulfill({
    status: 200,
    contentType: "text/javascript",
    body: clienteSupabaseSimulado()
  }));
});

test("el alta y la recuperación vuelven a la raíz real de la app", async ({ page }) => {
  await page.goto("/index.html");

  await page.click("#irARegistro");
  await page.fill("#registroNombre", "Técnico prueba");
  await page.fill("#registroEmail", "tecnico@example.com");
  await page.fill("#registroPassword", "password-segura");
  await page.click("#btnRegistro");
  await expect(page.locator("#registroError")).toContainText("Revisa tu correo");

  await page.click("#irALogin");
  await page.click("#irAOlvide");
  await page.fill("#olvideEmail", "tecnico@example.com");
  await page.click("#btnOlvide");
  await expect(page.locator("#codigoRecuperacionScreen")).toBeVisible();
  await expect(page.locator("#codigoRecuperacion")).toBeVisible();

  const calls = await page.evaluate(() => window.__authCalls);
  expect(calls.signUp[0].options.emailRedirectTo).toBe("http://127.0.0.1:4173/");
  expect(calls.reset[0]).toEqual({
    email: "tecnico@example.com",
    options: { redirectTo: "http://127.0.0.1:4173/?auth=recovery" }
  });
});

test("el enlace de recuperación abre el formulario y permite guardar la contraseña", async ({ page }) => {
  await page.goto("/?auth=recovery");
  const session = { user: { id: "usuario-prueba", email: "tecnico@example.com" }, access_token: "token" };
  await page.evaluate((currentSession) => window.__authCallbacks[0]("PASSWORD_RECOVERY", currentSession), session);

  await expect(page.locator("#codigoRecuperacionScreen")).toBeVisible();
  await expect(page.locator("#codigoRecuperacion")).toBeHidden();
  await page.fill("#nuevaPassword1", "password-nueva");
  await page.fill("#nuevaPassword2", "password-nueva");
  await page.click("#btnGuardarNuevaPassword");

  const updates = await page.evaluate(() => window.__authCalls.update);
  expect(updates).toEqual([{ password: "password-nueva" }]);
  await expect(page).toHaveURL("http://127.0.0.1:4173/");
});

test("el código recibido por correo permite verificar y cambiar la contraseña", async ({ page }) => {
  await page.goto("/");
  await page.click("#irAOlvide");
  await page.fill("#olvideEmail", "tecnico@example.com");
  await page.click("#btnOlvide");

  await page.fill("#codigoRecuperacion", "123456");
  await page.fill("#nuevaPassword1", "password-nueva");
  await page.fill("#nuevaPassword2", "password-nueva");
  await page.click("#btnGuardarNuevaPassword");

  const calls = await page.evaluate(() => window.__authCalls);
  expect(calls.verify).toEqual([{ email: "tecnico@example.com", token: "123456", type: "recovery" }]);
  expect(calls.update).toEqual([{ password: "password-nueva" }]);
});
