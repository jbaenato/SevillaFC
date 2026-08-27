// supabase/functions/editar-portero/index.ts
//
// Actualiza el nombre y la lateralidad de un portero. Cualquier técnico con sesión puede
// hacerlo, pero queda registrado en "auditoria" (quién, qué valores había antes y después),
// y solo se pueden tocar estas dos columnas — nunca el año de nacimiento ni ninguna otra.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PUBLISHABLE_KEY = "sb_publishable_6B6PMd8eB85OKIS1e74Qgg_YPmTaAdj";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const LATERALIDADES_VALIDAS = ["Derecha", "Izquierda", "N/D"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Método no permitido." }, 405);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return jsonResponse({ error: "Falta la sesión. Vuelve a iniciar sesión." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAuth = createClient(supabaseUrl, PUBLISHABLE_KEY);
  const { data: userData, error: userError } = await supabaseAuth.auth.getUser(token);
  if (userError || !userData?.user) {
    return jsonResponse({ error: "Sesión no válida o caducada. Vuelve a iniciar sesión." }, 401);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Cuerpo de la petición no es JSON válido." }, 400);
  }

  const { portero_id, nombre, lateralidad } = body;
  const nombreLimpio = (nombre || "").trim();
  if (!portero_id || !nombreLimpio) {
    return jsonResponse({ error: "Faltan datos obligatorios (portero_id, nombre)." }, 400);
  }
  const lateralidadFinal = LATERALIDADES_VALIDAS.includes(lateralidad) ? lateralidad : "N/D";

  const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: perfilSolicitante, error: errPerfilSolicitante } = await supabase
    .from("perfiles")
    .select("aprobado, activo")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (errPerfilSolicitante) return jsonResponse({ error: "No se pudo comprobar tu perfil." }, 500);
  if (!perfilSolicitante || !perfilSolicitante.aprobado || !perfilSolicitante.activo) {
    return jsonResponse({ error: "Tu cuenta todavía no ha sido aprobada por un coordinador." }, 403);
  }

  try {
    const { data: anterior, error: errLeer } = await supabase
      .from("porteros")
      .select("nombre, lateralidad")
      .eq("id", portero_id)
      .maybeSingle();
    if (errLeer) throw errLeer;
    if (!anterior) return jsonResponse({ error: "El portero no existe." }, 404);

    const { error: errUpdate } = await supabase
      .from("porteros")
      .update({ nombre: nombreLimpio, lateralidad: lateralidadFinal })
      .eq("id", portero_id);
    if (errUpdate) throw errUpdate;

    const { data: perfil } = await supabase
      .from("perfiles")
      .select("nombre")
      .eq("id", userData.user.id)
      .maybeSingle();

    const { error: errAuditoria } = await supabase.from("auditoria").insert({
      actor_id: userData.user.id,
      actor_nombre: (perfil && perfil.nombre) ? perfil.nombre : userData.user.email,
      accion: "editar_portero",
      tabla: "porteros",
      registro_id: portero_id,
      detalle: {
        antes: { nombre: anterior.nombre, lateralidad: anterior.lateralidad },
        despues: { nombre: nombreLimpio, lateralidad: lateralidadFinal },
      },
    });
    if (errAuditoria) console.error("No se pudo registrar la auditoría:", errAuditoria);

    return jsonResponse({ success: true });
  } catch (err) {
    console.error(err);
    const mensaje = (err as any)?.message || "Error al actualizar el portero.";
    return jsonResponse({ error: mensaje }, 500);
  }
});