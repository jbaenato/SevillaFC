(function (global) {
  "use strict";

  const DEFAULT_DSN =
    "https://97816607d64d3c79d2d51876240b2b4b@o4511937683259392.ingest.de.sentry.io/4511937734246480";
  const DEFAULT_TUNNEL =
    "https://ramnvcuwyfhepspzzzpn.supabase.co/functions/v1/sentry-tunnel";
  const config = global.__SEVILLAFC_CONFIG__ || {};

  const dsn = config.sentryDsn || DEFAULT_DSN;
  const tunnel = config.sentryTunnel || DEFAULT_TUNNEL;
  const environment = config.sentryEnvironment || "produccion";
  const habilitado = config.sentryEnabled !== false && Boolean(global.Sentry);

  const CLAVE_SENSIBLE =
    /(^|_)(authorization|cookie|token|password|contrasena|correo|email|user_id|usuario_id|portero_id|evaluacion_id|registro_id|solicitud_id|actor_id|id)$/i;
  const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
  const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
  const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

  function limpiarTexto(valor) {
    return String(valor)
      .replace(EMAIL, "[correo eliminado]")
      .replace(UUID, "[id eliminado]")
      .replace(JWT, "[token eliminado]");
  }

  function limpiarUrl(valor) {
    try {
      const url = new URL(String(valor), global.location && global.location.origin);
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return limpiarTexto(valor).split("?")[0].split("#")[0];
    }
  }

  function sanitizar(valor, clave, profundidad, vistos) {
    if (CLAVE_SENSIBLE.test(clave || "")) return "[eliminado]";
    if (valor === null || valor === undefined) return valor;
    if (clave === "url" || clave.endsWith("_url")) return limpiarUrl(valor);
    if (typeof valor === "string") return limpiarTexto(valor);
    if (typeof valor === "number" || typeof valor === "boolean") return valor;
    if (typeof valor !== "object") return String(valor);
    if (profundidad >= 4) return "[contenido truncado]";
    if (vistos.has(valor)) return "[referencia circular]";
    vistos.add(valor);

    if (Array.isArray(valor)) {
      return valor.slice(0, 20).map((item) =>
        sanitizar(item, "", profundidad + 1, vistos)
      );
    }

    const limpio = {};
    Object.entries(valor).slice(0, 30).forEach(([nombre, contenido]) => {
      limpio[nombre] = sanitizar(
        contenido,
        nombre,
        profundidad + 1,
        vistos
      );
    });
    return limpio;
  }

  function sanitizarDatos(valor) {
    return sanitizar(valor, "", 0, new WeakSet());
  }

  function prepararEvento(event) {
    delete event.user;

    if (event.message) event.message = limpiarTexto(event.message);
    const excepciones = event.exception && event.exception.values;
    if (Array.isArray(excepciones)) {
      excepciones.forEach((excepcion) => {
        if (excepcion.value) excepcion.value = limpiarTexto(excepcion.value);
      });
    }

    if (event.request) {
      if (event.request.url) event.request.url = limpiarUrl(event.request.url);
      delete event.request.cookies;
      delete event.request.data;
      delete event.request.headers;
    }

    if (event.extra) event.extra = sanitizarDatos(event.extra);
    if (Array.isArray(event.breadcrumbs)) {
      event.breadcrumbs = event.breadcrumbs.map(prepararBreadcrumb);
    }
    return event;
  }

  function prepararBreadcrumb(breadcrumb) {
    const limpio = Object.assign({}, breadcrumb);
    if (limpio.message) limpio.message = limpiarTexto(limpio.message);
    if (limpio.data) limpio.data = sanitizarDatos(limpio.data);
    return limpio;
  }

  function esIncidenciaEsperada(error, contexto) {
    const motivo = contexto && contexto.motivo;
    if (motivo === "rechazo_servidor" || motivo === "sesion") return true;

    const status = Number(error && error.status);
    if (status >= 400 && status < 500 && ![408, 429].includes(status)) return true;

    const mensaje = String((error && error.message) || error || "");
    const pareceRed = /failed to fetch|networkerror|load failed|internet.*disconnect/i.test(mensaje);
    return pareceRed && global.navigator && global.navigator.onLine === false;
  }

  if (habilitado) {
    const opciones = {
      dsn,
      tunnel,
      environment,
      sampleRate: 1,
      sendDefaultPii: false,
      autoSessionTracking: false,
      maxBreadcrumbs: 50,
      beforeSend: prepararEvento,
      beforeBreadcrumb: prepararBreadcrumb
    };
    if (config.sentryRelease) opciones.release = config.sentryRelease;
    global.Sentry.init(opciones);
  }

  function registrarError(error, contexto) {
    try {
      if (!habilitado) {
        console.error("[reportarError]", error, contexto || {});
        return;
      }

      if (esIncidenciaEsperada(error, contexto)) {
        global.Sentry.addBreadcrumb({
          category: "app",
          level: "warning",
          message: "Incidencia controlada",
          data: sanitizarDatos(contexto || {})
        });
        return;
      }

      const tags = { aplicacion: "captacion-porteros" };
      if (contexto && contexto.contexto) tags.contexto = contexto.contexto;
      if (contexto && contexto.motivo) tags.motivo = contexto.motivo;

      global.Sentry.captureException(error, {
        tags,
        extra: sanitizarDatos(contexto || {})
      });
    } catch (falloSentry) {
      console.error("[Sentry no pudo registrar el error]", falloSentry);
    }
  }

  global.AppSentry = {
    estaHabilitado: function () { return habilitado; },
    capturarExcepcion: registrarError,
    sanitizarDatos
  };
})(globalThis);
