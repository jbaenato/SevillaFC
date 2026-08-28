export const SENTRY_HOST = "o4511937683259392.ingest.de.sentry.io";
export const SENTRY_PROJECT_ID = "4511937734246480";
export const SENTRY_PUBLIC_KEY = "97816607d64d3c79d2d51876240b2b4b";
export const SENTRY_ENVELOPE_URL =
  `https://${SENTRY_HOST}/api/${SENTRY_PROJECT_ID}/envelope/`;
export const MAX_ENVELOPE_BYTES = 200_000;

export function excedeLimite(tamano) {
  return Number.isFinite(tamano) && tamano > MAX_ENVELOPE_BYTES;
}

export function dsnAutorizado(valor) {
  if (typeof valor !== "string") return false;
  try {
    const dsn = new URL(valor);
    return dsn.protocol === "https:" &&
      dsn.hostname === SENTRY_HOST &&
      dsn.username === SENTRY_PUBLIC_KEY &&
      dsn.password === "" &&
      dsn.pathname === `/${SENTRY_PROJECT_ID}`;
  } catch {
    return false;
  }
}
