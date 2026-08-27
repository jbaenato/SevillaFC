// supabase/functions/eliminar-evaluacion/index.ts
//
// Elimina una evaluación y sus respuestas asociadas. Solo lo puede hacer un usuario cuyo
// perfil tenga rol "coordinador" — se comprueba aquí mismo, en el servidor, con permisos
// elevados, así que ningún técnico puede saltarse esta restricción desde el navegador.

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

  const { evaluacion_id } = body;
  if (!evaluacion_id) {
    return jsonResponse({ error: "Falta evaluacion_id." }, 400);
  }

  const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: perfil, error: errPerfil } = await supabase
    .from("perfiles")
    .select("rol, nombre, aprobado, activo")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (errPerfil) return jsonResponse({ error: "No se pudo comprobar tu perfil." }, 500);
  if (!perfil || perfil.rol !== "coordinador" || !perfil.aprobado || !perfil.activo) {
    return jsonResponse({ error: "Solo un coordinador puede eliminar evaluaciones." }, 403);
  }

  try {
    // Datos para el registro de auditoría (antes de ocultar la evaluación)
    const { data: evaluacionActual, error: errLeer } = await supabase
      .from("evaluaciones")
      .select("id, fecha_partido, portero_id, equipo_id, porteros(nombre)")
      .eq("id", evaluacion_id)
      .maybeSingle();
    if (errLeer) throw errLeer;
    if (!evaluacionActual) return jsonResponse({ error: "La evaluación no existe o ya fue eliminada." }, 404);

    const { error: errEvaluacion } = await supabase
      .from("evaluaciones")
      .update({ eliminado_en: new Date().toISOString(), eliminado_por: userData.user.id })
      .eq("id", evaluacion_id);
    if (errEvaluacion) throw errEvaluacion;

    const porteroInfo: any = Array.isArray(evaluacionActual.porteros) ? evaluacionActual.porteros[0] : evaluacionActual.porteros;
    const { error: errAuditoria } = await supabase.from("auditoria").insert({
      actor_id: userData.user.id,
      actor_nombre: (perfil && perfil.nombre) ? perfil.nombre : userData.user.email,
      accion: "eliminar_evaluacion",
      tabla: "evaluaciones",
      registro_id: evaluacion_id,
      detalle: { portero: porteroInfo ? porteroInfo.nombre : null, fecha_partido: evaluacionActual.fecha_partido || null },
    });
    if (errAuditoria) console.error("No se pudo registrar la auditoría:", errAuditoria);

    return jsonResponse({ success: true });
  } catch (err) {
    console.error(err);
    const mensaje = (err as any)?.message || "Error al eliminar la evaluación.";
    return jsonResponse({ error: mensaje }, 500);
  }
});