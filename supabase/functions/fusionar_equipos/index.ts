// supabase/functions/fusionar-equipos/index.ts
//
// Fusiona dos o más equipos duplicados en uno solo: reasigna todas las evaluaciones de
// los equipos "origen" al equipo "destino" y borra los equipos origen. Solo lo puede
// hacer un coordinador. Queda registrado en "auditoria".

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

  const { equipo_destino_id, equipos_origen_ids } = body;
  if (!equipo_destino_id || !Array.isArray(equipos_origen_ids) || equipos_origen_ids.length === 0) {
    return jsonResponse({ error: "Faltan datos obligatorios (equipo_destino_id, equipos_origen_ids)." }, 400);
  }
  const origenes: string[] = equipos_origen_ids.filter((id: string) => id && id !== equipo_destino_id);
  if (origenes.length === 0) {
    return jsonResponse({ error: "No hay equipos de origen distintos del destino." }, 400);
  }

  const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: perfil, error: errPerfil } = await supabase
    .from("perfiles")
    .select("rol, nombre, aprobado, activo")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (errPerfil) return jsonResponse({ error: "No se pudo comprobar tu perfil." }, 500);
  if (!perfil || perfil.rol !== "coordinador" || !perfil.aprobado || !perfil.activo) {
    return jsonResponse({ error: "Solo un coordinador puede fusionar equipos." }, 403);
  }

  try {
    const { data: nombres, error: errNombres } = await supabase
      .from("equipos")
      .select("id, nombre")
      .in("id", [equipo_destino_id, ...origenes]);
    if (errNombres) throw errNombres;

    const nombrePorId: Record<string, string> = {};
    (nombres || []).forEach((eq: any) => { nombrePorId[eq.id] = eq.nombre; });
    if (!nombrePorId[equipo_destino_id]) {
      return jsonResponse({ error: "El equipo destino no existe." }, 404);
    }

    // Reasigna las evaluaciones de cada equipo origen al destino, y borra el origen
    for (const origenId of origenes) {
      const { error: errReasignar } = await supabase
        .from("evaluaciones")
        .update({ equipo_id: equipo_destino_id })
        .eq("equipo_id", origenId);
      if (errReasignar) throw errReasignar;

      const { error: errBorrar } = await supabase.from("equipos").delete().eq("id", origenId);
      if (errBorrar) throw errBorrar;
    }

    const { error: errAuditoria } = await supabase.from("auditoria").insert({
      actor_id: userData.user.id,
      actor_nombre: (perfil && perfil.nombre) ? perfil.nombre : userData.user.email,
      accion: "fusionar_equipos",
      tabla: "equipos",
      registro_id: equipo_destino_id,
      detalle: {
        destino: nombrePorId[equipo_destino_id],
        origenes: origenes.map((id) => nombrePorId[id] || id),
      },
    });
    if (errAuditoria) console.error("No se pudo registrar la auditoría:", errAuditoria);

    return jsonResponse({ success: true });
  } catch (err) {
    console.error(err);
    const mensaje = (err as any)?.message || "Error al fusionar los equipos.";
    return jsonResponse({ error: mensaje }, 500);
  }
});