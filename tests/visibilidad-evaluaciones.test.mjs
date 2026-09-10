import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const migration = await readFile(
  new URL("../supabase/migrations/20260910220443_limitar_lectura_evaluaciones_por_autor.sql", import.meta.url),
  "utf8"
);

test("el filtro por año se muestra, se rellena y participa en la búsqueda", () => {
  assert.match(html, /id="filtroAnioNacimiento"/);
  assert.match(app, /actualizarFiltroAnios\(\)/);
  assert.match(app, /porteroCampo\(ev, "anio_nacimiento"\)/);
  assert.match(app, /String\(porteroCampo\(ev, "anio_nacimiento"\)\) === anioFiltro/);
});

test("la migración conserva acceso global al coordinador y limita al técnico por autor", () => {
  assert.match(migration, /creado_por = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /or private\.es_coordinador_aprobado\(\)/i);
  assert.match(migration, /Respuestas de evaluaciones visibles/i);
  assert.match(migration, /alter column creado_por set not null/i);
  assert.match(migration, /p_actor_id is null or not exists/i);
});
