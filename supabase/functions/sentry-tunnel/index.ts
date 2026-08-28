// supabase/functions/sentry-tunnel/index.ts
//
// Recibe envelopes del SDK del navegador y los reenvía únicamente al proyecto Sentry
// autorizado. El destino es fijo para impedir que la función se convierta en un proxy
// abierto y el tamaño se limita para reducir abuso y consumo accidental de cuota.

import {
  SENTRY_ENVELOPE_URL,
  dsnAutorizado,
  excedeLimite,
} from "./validacion.mjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, sentry-trace, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Método no permitido." }, 405);
  }

  const longitudDeclarada = Number(req.headers.get("content-length") || "0");
  if (excedeLimite(longitudDeclarada)) {
    return jsonResponse({ error: "Evento demasiado grande." }, 413);
  }

  try {
    const envelopeText = await req.text();
    const tamanoReal = new TextEncoder().encode(envelopeText).byteLength;
    if (excedeLimite(tamanoReal)) {
      return jsonResponse({ error: "Evento demasiado grande." }, 413);
    }

    const primeraLinea = envelopeText.split("\n", 1)[0];
    if (!primeraLinea) {
      return jsonResponse({ error: "Envelope vacío." }, 400);
    }

    let cabecera: { dsn?: unknown };
    try {
      cabecera = JSON.parse(primeraLinea);
    } catch {
      return jsonResponse({ error: "Cabecera de envelope no válida." }, 400);
    }

    if (!dsnAutorizado(cabecera.dsn)) {
      return jsonResponse({ error: "Destino Sentry no autorizado." }, 403);
    }

    const respuesta = await fetch(SENTRY_ENVELOPE_URL, {
      method: "POST",
      body: envelopeText,
      headers: { "Content-Type": "application/x-sentry-envelope" },
    });

    const cuerpo = await respuesta.text();
    return new Response(cuerpo, {
      status: respuesta.status,
      headers: {
        ...corsHeaders,
        "Content-Type":
          respuesta.headers.get("content-type") || "application/json",
      },
    });
  } catch (err) {
    console.error("Fallo al reenviar un evento Sentry", err);
    return jsonResponse({ error: "No se pudo reenviar el evento." }, 502);
  }
});
