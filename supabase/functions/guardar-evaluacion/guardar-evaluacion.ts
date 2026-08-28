// supabase/functions/guardar-evaluacion/index.ts
//
// Recibe los datos de una evaluación ya rellenada en la app, resuelve (o crea) los IDs
// de técnico/portero/equipo, y crea la fila en "evaluaciones" junto con sus filas en
// "respuestas_evaluacion". Se ejecuta en el servidor con la service_role key, así que
// omite las políticas RLS — por eso el propio código valida que quien llama tiene una
// sesión válida (Supabase ya exige un JWT válido antes de dejar entrar la petición aquí,
// salvo que la función se despliegue con --no-verify-jwt, que no es el caso).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.4";

// En local, Supabase inyecta su propia clave anon. En producción conservamos la clave
// pública actual como alternativa; ninguna de las dos concede permisos privilegiados.
const PUBLISHABLE_KEY = Deno.env.get("SUPABASE_ANON_KEY") ||
  "sb_publishable_6B6PMd8eB85OKIS1e74Qgg_YPmTaAdj";

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

  // Verificación de sesión propia: no dependemos del interruptor "Verify JWT" de la
  // plataforma (con la clave pública sola bastaría para pasarlo, lo cual no sirve aquí).
  // Comprobamos directamente contra el servidor de Auth que el token es de un usuario
  // con sesión iniciada de verdad.
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

  const { solicitud_id, nombre, lateralidad, anioNacimiento, equipo, row, respuestas } = body;

  if (!nombre || !equipo || !row || typeof row !== "object" || !Array.isArray(respuestas)) {
    return jsonResponse({ error: "Faltan datos obligatorios (nombre, equipo, row, respuestas)." }, 400);
  }

  // Las versiones anteriores de la app no enviaban esta clave. Generarla en el servidor
  // mantiene la compatibilidad durante el despliegue; las versiones nuevas reutilizan
  // siempre la misma UUID en todos los reintentos.
  const solicitudId = solicitud_id || crypto.randomUUID();
  const UUID_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (typeof solicitudId !== "string" || !UUID_VALIDO.test(solicitudId)) {
    return jsonResponse({ error: "El identificador de la evaluación no es válido." }, 400);
  }

  // --- Validación de datos (nunca nos fiamos de lo que calcule/valide el cliente) ---
  const EVAL_FINAL_VALIDAS = ["A", "B", "C", "D"];
  if (!EVAL_FINAL_VALIDAS.includes(row.evaluacion_final)) {
    return jsonResponse({ error: "La evaluación final debe ser A, B, C o D." }, 400);
  }
  if (row.evaluacion_final === "D" && !(row.observaciones || "").trim()) {
    return jsonResponse({ error: "Las observaciones son obligatorias cuando la evaluación final es D." }, 400);
  }
  const LATERALIDADES_VALIDAS = ["Derecha", "Izquierda", "N/D"];
  if (lateralidad && !LATERALIDADES_VALIDAS.includes(lateralidad)) {
    return jsonResponse({ error: "Lateralidad no válida." }, 400);
  }
  const VISIONADOS_VALIDOS = ["Directo", "Video"];
  if (!VISIONADOS_VALIDOS.includes(row.tipo_visionado)) {
    return jsonResponse({ error: "Tipo de visionado no válido." }, 400);
  }
  if (!row.modalidad_id) {
    return jsonResponse({ error: "Falta la modalidad." }, 400);
  }
  for (const r of respuestas) {
    if (!r || typeof r.item_id !== "string" || typeof r.valor !== "number" || !isFinite(r.valor) || r.valor < 0 || r.valor > 5) {
      return jsonResponse({ error: "Hay una puntuación fuera de rango (debe estar entre 0 y 5)." }, 400);
    }
  }

  const supabase = createClient(
    supabaseUrl,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Comprueba que todos los ítems puntuados pertenecen de verdad a la modalidad de esta
  // evaluación (evita que, por un bug o manipulación, se cuelen ítems de otra modalidad).
  if (respuestas.length > 0) {
    const itemIds = respuestas.map((r: { item_id: string }) => r.item_id);
    const { data: itemsInfo, error: errItems } = await supabase
      .from("items_evaluacion")
      .select("id, modalidad_id")
      .in("id", itemIds);
    if (errItems) return jsonResponse({ error: "No se pudieron comprobar los ítems." }, 500);
    const idsEncontrados = new Set((itemsInfo || []).map((it: any) => it.id));
    const todosPertenecen = (itemsInfo || []).every((it: any) => it.modalidad_id === row.modalidad_id);
    if (idsEncontrados.size !== itemIds.length || !todosPertenecen) {
      return jsonResponse({ error: "Algún ítem no pertenece a la modalidad seleccionada." }, 400);
    }
  }

  // El nombre del técnico NUNCA se toma de lo que mande el navegador: se busca el perfil
  // vinculado a la sesión ya verificada, para que nadie pueda firmar una evaluación con
  // el nombre de otro técnico.
  const { data: perfil, error: errPerfil } = await supabase
    .from("perfiles")
    .select("nombre, aprobado, activo")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (errPerfil) return jsonResponse({ error: "No se pudo comprobar tu perfil de técnico." }, 500);
  if (!perfil || !perfil.aprobado || !perfil.activo) {
    return jsonResponse({ error: "Tu cuenta todavía no ha sido aprobada por un coordinador." }, 403);
  }
  const evaluador = perfil.nombre || userData.user.email;
  if (!evaluador) return jsonResponse({ error: "Tu perfil no tiene nombre de técnico configurado." }, 400);

  try {
    // Una función Postgres realiza todo el guardado dentro de una única transacción. La
    // service_role es la única autorizada a ejecutarla; el navegador nunca puede llamar
    // directamente a esta operación privilegiada.
    const { data: resultado, error: errGuardar } = await supabase
      .rpc("guardar_evaluacion_atomica", {
        p_solicitud_id: solicitudId,
        p_actor_id: userData.user.id,
        p_actor_nombre: evaluador,
        p_nombre_portero: nombre,
        p_lateralidad: lateralidad || "N/D",
        p_anio_nacimiento: anioNacimiento || null,
        p_equipo: equipo,
        p_row: row,
        p_respuestas: respuestas,
      })
      .single();
    if (errGuardar) throw errGuardar;

    return jsonResponse({
      success: true,
      evaluacion_id: resultado.evaluacion_id,
      duplicada: resultado.duplicada,
    });
  } catch (err) {
    console.error(err);
    const mensaje = (err as any)?.message || "Error al guardar la evaluación.";
    return jsonResponse({ error: mensaje }, 500);
  }
});
