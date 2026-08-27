import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const edgeFunction = await readFile(
  new URL("../supabase/functions/guardar-evaluacion/guardar-evaluacion.ts", import.meta.url),
  "utf8"
);
const migration = await readFile(
  new URL("../supabase/migrations/20260827133746_proteger_evaluaciones_duplicadas.sql", import.meta.url),
  "utf8"
);

test("la Edge Function entrega la misma solicitud a la operación atómica", () => {
  assert.match(edgeFunction, /solicitud_id/);
  assert.match(edgeFunction, /p_solicitud_id:\s*solicitudId/);
  assert.match(edgeFunction, /rpc\("guardar_evaluacion_atomica"/);
  assert.match(edgeFunction, /@supabase\/supabase-js@2\.112\.4/);
});

test("la base de datos impide duplicados y limita el RPC a service_role", () => {
  assert.match(migration, /unique index[\s\S]*evaluaciones_solicitud_id_unico/i);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /security invoker/i);
  assert.match(migration, /from public, anon, authenticated/i);
  assert.match(migration, /to service_role/i);
});
