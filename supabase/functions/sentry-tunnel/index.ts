// supabase/functions/sentry-tunnel/index.ts
//
// "Tunnel" recomendado por la propia documentación de Sentry para esquivar bloqueadores
// (adblockers, antivirus, DNS con filtrado, etc.) que interceptan las peticiones directas
// hacia sentry.io. El navegador manda el error aquí, a nuestro propio dominio de Supabase
// (que ya usamos sin problemas para todo lo demás), y esta función lo reenvía a Sentry.
// No requiere sesión: solo retransmite telemetría, no toca ninguna tabla ni dato sensible.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Método no permitido." }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const envelopeText = await req.text();
    // El "envelope" de Sentry empieza con una línea de cabecera en JSON que incluye el DSN.
    const primeraLinea = envelopeText.split("\n")[0];
    const cabecera = JSON.parse(primeraLinea);
    const dsn = new URL(cabecera.dsn);
    const projectId = dsn.pathname.replace("/", "");
    const sentryUrl = `https://${dsn.host}/api/${projectId}/envelope/`;

    const respuesta = await fetch(sentryUrl, {
      method: "POST",
      body: envelopeText,
      headers: { "Content-Type": "application/x-sentry-envelope" },
    });

    const cuerpo = await respuesta.text();
    return new Response(cuerpo, {
      status: respuesta.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});