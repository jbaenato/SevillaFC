import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const core = appSource.match(/\/\/ BEGIN OFFLINE_QUEUE_CORE\n([\s\S]*?)\/\/ END OFFLINE_QUEUE_CORE/);
assert.ok(core, "No se encontró el núcleo de la cola offline en app.js");
vm.runInThisContext(core[1]);

const Queue = globalThis.OfflineQueue;

class Memoria {
  constructor() {
    this.datos = new Map();
    this.fallarEscritura = false;
    this.ignorarEscritura = false;
  }

  getItem(clave) {
    return this.datos.has(clave) ? this.datos.get(clave) : null;
  }

  setItem(clave, valor) {
    if (this.fallarEscritura) throw new Error("Cuota agotada");
    if (!this.ignorarEscritura) this.datos.set(clave, String(valor));
  }
}

test("confirma el guardado antes de aceptar una evaluación offline", () => {
  const storage = new Memoria();
  const entrada = Queue.encolar(
    storage,
    "pendientes",
    { nombre: "Portero prueba", respuestas: [{ item_id: "1", valor: 4 }] },
    new Date("2026-08-27T10:00:00.000Z")
  );

  const cola = Queue.leer(storage, "pendientes");
  assert.equal(cola.length, 1);
  assert.equal(cola[0].idLocal, entrada.idLocal);
  assert.equal(cola[0].estadoSync, Queue.ESTADO_PENDIENTE);
  assert.equal(cola[0].guardadoEn, "2026-08-27T10:00:00.000Z");
});

test("lanza un error si el dispositivo no puede escribir", () => {
  const storage = new Memoria();
  storage.fallarEscritura = true;

  assert.throws(
    () => Queue.encolar(storage, "pendientes", { nombre: "No debe perderse" }),
    /Cuota agotada/
  );
  assert.equal(storage.getItem("pendientes"), null);
});

test("lanza un error si el dispositivo no confirma lo escrito", () => {
  const storage = new Memoria();
  storage.ignorarEscritura = true;

  assert.throws(
    () => Queue.encolar(storage, "pendientes", { nombre: "No debe cerrarse" }),
    /no ha confirmado/
  );
});

test("migra las evaluaciones antiguas sin eliminar sus datos", () => {
  const storage = new Memoria();
  storage.setItem("pendientes", JSON.stringify([{
    nombre: "Evaluación anterior",
    equipo: "Equipo anterior",
    guardadoEn: "2026-08-26T10:00:00.000Z"
  }]));

  const cola = Queue.leer(storage, "pendientes");
  assert.equal(cola.length, 1);
  assert.equal(cola[0].nombre, "Evaluación anterior");
  assert.equal(cola[0].equipo, "Equipo anterior");
  assert.equal(cola[0].estadoSync, Queue.ESTADO_PENDIENTE);
  assert.ok(cola[0].idLocal);
});

test("un rechazo queda guardado como necesita revisión", () => {
  const storage = new Memoria();
  const entrada = Queue.normalizarEntrada({ nombre: "Con incidencia" });
  const conError = Queue.marcarFallo(
    entrada,
    Queue.ESTADO_ERROR,
    "Algún ítem ya no es válido.",
    400
  );
  Queue.guardar(storage, "pendientes", [conError]);

  const cola = Queue.leer(storage, "pendientes");
  const resumen = Queue.resumir(cola);
  assert.equal(cola.length, 1);
  assert.equal(cola[0].errorSync, "Algún ítem ya no es válido.");
  assert.equal(resumen.error, 1);
  assert.equal(resumen.total, 1);
});

test("una sesión caducada permanece guardada hasta el siguiente inicio de sesión", () => {
  const entrada = Queue.marcarFallo(
    Queue.normalizarEntrada({ nombre: "Sesión caducada" }),
    Queue.ESTADO_SESION,
    "Vuelve a iniciar sesión.",
    401
  );

  const sinReintentar = Queue.prepararReintento([entrada], {});
  assert.equal(sinReintentar[0].estadoSync, Queue.ESTADO_SESION);

  const trasLogin = Queue.prepararReintento([entrada], { incluirSesion: true });
  assert.equal(trasLogin[0].estadoSync, Queue.ESTADO_PENDIENTE);
  assert.equal(trasLogin[0].errorSync, null);
});

test("clasifica correctamente respuestas temporales, de sesión y de validación", () => {
  assert.equal(Queue.clasificarHttp(401), Queue.ESTADO_SESION);
  assert.equal(Queue.clasificarHttp(400), Queue.ESTADO_ERROR);
  assert.equal(Queue.clasificarHttp(403), Queue.ESTADO_ERROR);
  assert.equal(Queue.clasificarHttp(429), "transitorio");
  assert.equal(Queue.clasificarHttp(503), "transitorio");
});
