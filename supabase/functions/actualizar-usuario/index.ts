// supabase/functions/actualizar-usuario/index.ts
//
// Permite a un coordinador cambiar el rol de un usuario ya aprobado (tecnico/coordinador)
// y/o activar o desactivar su cuenta (revocar/restaurar el acceso sin borrar nada). No
// permite tocar la propia cuenta, para evitar quedarse bloqueado por error. Queda auditado.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PUBLISHABLE_KEY = "sb_publishable_6B6PMd8eB85OKIS1e74Qgg_YPmTaAdj";
const ROLES_VALIDOS = ["tecnico", "coordinador"];

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

  const { usuario_id, rol, activo } = body;
  if (!usuario_id) {
    return jsonResponse({ error: "Falta usuario_id." }, 400);
  }
  if (usuario_id === userData.user.id) {
    return jsonResponse({ error: "No puedes modificar tu propia cuenta desde aquí." }, 400);
  }
  if (rol === undefined && activo === undefined) {
    return jsonResponse({ error: "No hay ningún cambio que aplicar." }, 400);
  }
  if (rol !== undefined && !ROLES_VALIDOS.includes(rol)) {
    return jsonResponse({ error: "Rol no válido." }, 400);
  }
  if (activo !== undefined && typeof activo !== "boolean") {
    return jsonResponse({ error: "El valor de activo debe ser verdadero o falso." }, 400);
  }

  const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: perfilSolicitante, error: errPerfilSolicitante } = await supabase
    .from("perfiles")
    .select("rol, nombre, aprobado, activo")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (errPerfilSolicitante) return jsonResponse({ error: "No se pudo comprobar tu perfil." }, 500);
  if (!perfilSolicitante || perfilSolicitante.rol !== "coordinador" || !perfilSolicitante.aprobado || !perfilSolicitante.activo) {
    return jsonResponse({ error: "Solo un coordinador puede gestionar usuarios." }, 403);
  }

  try {
    const { data: antes, error: errAntes } = await supabase
      .from("perfiles")
      .select("nombre, rol, activo, aprobado")
      .eq("id", usuario_id)
      .maybeSingle();
    if (errAntes) throw errAntes;
    if (!antes) return jsonResponse({ error: "Ese usuario no existe." }, 404);
    if (!antes.aprobado) {
      return jsonResponse({ error: "Esa cuenta todavía no está aprobada; gestiónala desde \"Solicitudes\"." }, 400);
    }

    const cambios: Record<string, unknown> = {};
    if (rol !== undefined) cambios.rol = rol;
    if (activo !== undefined) cambios.activo = activo;

    const { error: errUpdate } = await supabase
      .from("perfiles")
      .update(cambios)
      .eq("id", usuario_id);
    if (errUpdate) throw errUpdate;

    const { error: errAuditoria } = await supabase.from("auditoria").insert({
      actor_id: userData.user.id,
      actor_nombre: perfilSolicitante.nombre,
      accion: "actualizar_usuario",
      tabla: "perfiles",
      registro_id: usuario_id,
      detalle: {
        nombre: antes.nombre,
        antes: { rol: antes.rol, activo: antes.activo },
        despues: { rol: cambios.rol ?? antes.rol, activo: cambios.activo ?? antes.activo },
      },
    });
    if (errAuditoria) console.error("No se pudo registrar la auditoría:", errAuditoria);

    return jsonResponse({ success: true });
  } catch (err) {
    console.error(err);
    const mensaje = (err as any)?.message || "Error al actualizar el usuario.";
    return jsonResponse({ error: mensaje }, 500);
  }
});