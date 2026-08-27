import { expect, test } from "@playwright/test";

const SUPABASE = "https://ramnvcuwyfhepspzzzpn.supabase.co";

test("una evaluación offline sobrevive a un rechazo y solo se elimina tras confirmación", async ({ page, context }) => {
  let respuestaGuardado = "sin-red";
  const solicitudesRecibidas = [];

  const clienteSupabaseSimulado = `
    window.supabase = {
      createClient: function () {
        return {
          auth: {
            onAuthStateChange: function (callback) {
              setTimeout(function () { callback("INITIAL_SESSION", null); }, 0);
              return { data: { subscription: { unsubscribe: function () {} } } };
            },
            getSession: async function () {
              return { data: { session: window.__sesionPrueba || null } };
            },
            signInWithPassword: async function () { return { data: {}, error: null }; },
            signUp: async function () { return { data: {}, error: null }; },
            resetPasswordForEmail: async function () { return { data: {}, error: null }; },
            updateUser: async function () { return { data: {}, error: null }; },
            signOut: async function () { return { error: null }; }
          }
        };
      }
    };
  `;

  await page.route("**/supabase.min.js", (route) => route.fulfill({
    status: 200,
    contentType: "text/javascript",
    body: clienteSupabaseSimulado
  }));

  await page.route(SUPABASE + "/**", async (route) => {
    const url = route.request().url();

    if (url.includes("/functions/v1/guardar-evaluacion")) {
      const payload = route.request().postDataJSON();
      solicitudesRecibidas.push(payload.solicitud_id);
      if (respuestaGuardado === "sin-red") return route.abort("internetdisconnected");
      if (respuestaGuardado === "rechazo") {
        return route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ error: "Prueba: los datos necesitan revisión." })
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, evaluacion_id: "evaluacion-prueba" })
      });
    }

    let body = [];
    if (url.includes("/rest/v1/modalidades")) {
      body = [{ id: "modalidad-prueba", nombre: "F11" }];
    } else if (url.includes("/rest/v1/items_evaluacion")) {
      body = [
        { id: "item-1", categoria: "Ofensivo / técnico", nombre: "Juego de pies", orden: 1 },
        { id: "item-2", categoria: "Defensivo / táctico", nombre: "Posicionamiento", orden: 2 },
        { id: "item-3", categoria: "Físico / condicional", nombre: "Velocidad", orden: 3 },
        { id: "item-4", categoria: "Psicológico", nombre: "Concentración", orden: 4 }
      ];
    } else if (url.includes("/rest/v1/perfiles")) {
      body = [{ nombre: "Técnico de prueba", rol: "tecnico", aprobado: true, activo: true }];
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body)
    });
  });

  await page.goto("/");
  await page.evaluate(() => {
    window.__sesionPrueba = {
      user: { id: "usuario-prueba", email: "tecnico@example.com" },
      access_token: "token-prueba"
    };
    sesionActual = window.__sesionPrueba;
    perfilActual = { nombre: "Técnico de prueba", rol: "tecnico", aprobado: true, activo: true };
    guardarPerfilOffline(perfilActual);
    abrirAppConPerfilValidado();
  });

  await page.locator('input[name="modalidad"]').check();
  await expect(page.locator("#restoFormulario")).toBeVisible();
  await page.fill("#nombre", "Portero prueba navegador");
  await page.fill("#equipo", "Equipo prueba navegador");
  await page.fill("#anioNacimiento", "2012");
  await page.fill("#partido", "Partido de prueba");
  await page.locator('input[name="evalFinal"][value="A"]').check();
  await page.click("#guardar");
  await expect(page.locator("#modalRepaso")).toBeVisible();

  await context.setOffline(true);
  await page.click("#confirmarGuardar");

  await expect.poll(() => page.evaluate(() => obtenerColaPendientes().length)).toBe(1);
  await expect(page.locator("#modalRepaso")).toBeHidden();
  await expect(page.locator("#pendientesTexto")).toContainText("pendiente");

  respuestaGuardado = "rechazo";
  await context.setOffline(false);

  await expect.poll(() => page.evaluate(() => obtenerColaPendientes()[0]?.estadoSync)).toBe("error");
  await expect(page.locator("#pendientesTexto")).toContainText("no se eliminarán");
  await expect.poll(() => page.evaluate(() => obtenerColaPendientes().length)).toBe(1);

  respuestaGuardado = "confirmado";
  await page.click("#reintentarSync");

  await expect.poll(() => page.evaluate(() => obtenerColaPendientes().length)).toBe(0);
  await expect(page.locator("#pendientesBanner")).toBeHidden();
  expect(solicitudesRecibidas.length).toBeGreaterThanOrEqual(3);
  expect(new Set(solicitudesRecibidas).size).toBe(1);
  expect(solicitudesRecibidas[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});
