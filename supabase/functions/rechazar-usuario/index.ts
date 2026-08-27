// supabase/functions/rechazar-usuario/index.ts
//
// Rechaza una solicitud de acceso: elimina por completo la cuenta de Auth (y, en cascada,
// su fila en "perfiles"). Solo lo puede hacer un coordinador aprobado. Queda registrado en
// "auditoria" ANTES de borrar la cuenta, para no perder el rastro de la decisión.

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

  const { usuario_id } = body;
  if (!usuario_id) {
    return jsonResponse({ error: "Falta usuario_id." }, 400);
  }
  if (usuario_id === userData.user.id) {
    return jsonResponse({ error: "No puedes rechazar tu propia cuenta." }, 400);
  }

  const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: perfilSolicitante, error: errPerfilSolicitante } = await supabase
    .from("perfiles")
    .select("rol, nombre, aprobado, activo")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (errPerfilSolicitante) return jsonResponse({ error: "No se pudo comprobar tu perfil." }, 500);
  if (!perfilSolicitante || perfilSolicitante.rol !== "coordinador" || !perfilSolicitante.aprobado || !perfilSolicitante.activo) {
    return jsonResponse({ error: "Solo un coordinador puede rechazar solicitudes." }, 403);
  }

  try {
    const { data: perfilRechazado, error: errLeer } = await supabase
      .from("perfiles")
      .select("nombre, aprobado")
      .eq("id", usuario_id)
      .maybeSingle();
    if (errLeer) throw errLeer;
    if (!perfilRechazado) return jsonResponse({ error: "Ese usuario no existe." }, 404);
    if (perfilRechazado.aprobado) {
      return jsonResponse({ error: "Esa cuenta ya está aprobada; no se puede rechazar desde aquí." }, 400);
    }

    // Se audita ANTES de borrar, para no perder el rastro de qué cuenta se rechazó.
    const { error: errAuditoria } = await supabase.from("auditoria").insert({
      actor_id: userData.user.id,
      actor_nombre: perfilSolicitante.nombre,
      accion: "rechazar_usuario",
      tabla: "perfiles",
      registro_id: usuario_id,
      detalle: { nombre: perfilRechazado.nombre },
    });
    if (errAuditoria) console.error("No se pudo registrar la auditoría:", errAuditoria);

    // Al borrar el usuario de Auth, la fila de "perfiles" se elimina en cascada (FK ON DELETE CASCADE).
    const { error: errBorrar } = await supabase.auth.admin.deleteUser(usuario_id);
    if (errBorrar) throw errBorrar;

    return jsonResponse({ success: true });
  } catch (err) {
    console.error(err);
    const mensaje = (err as any)?.message || "Error al rechazar la solicitud.";
    return jsonResponse({ error: mensaje }, 500);
  }
});