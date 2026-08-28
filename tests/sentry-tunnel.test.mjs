import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_ENVELOPE_BYTES,
  dsnAutorizado,
  excedeLimite
} from "../supabase/functions/sentry-tunnel/validacion.mjs";

const DSN_VALIDO =
  "https://97816607d64d3c79d2d51876240b2b4b@o4511937683259392.ingest.de.sentry.io/4511937734246480";

test("el túnel solo autoriza el DSN exacto del proyecto", () => {
  assert.equal(dsnAutorizado(DSN_VALIDO), true);
  assert.equal(dsnAutorizado("https://otra@example.com/123"), false);
  assert.equal(
    dsnAutorizado("https://otra@o4511937683259392.ingest.de.sentry.io/4511937734246480"),
    false
  );
  assert.equal(
    dsnAutorizado("http://97816607d64d3c79d2d51876240b2b4b@o4511937683259392.ingest.de.sentry.io/4511937734246480"),
    false
  );
});

test("el túnel limita los envelopes a 200 KB", () => {
  assert.equal(excedeLimite(MAX_ENVELOPE_BYTES), false);
  assert.equal(excedeLimite(MAX_ENVELOPE_BYTES + 1), true);
});
