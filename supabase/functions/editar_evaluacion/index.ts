// supabase/functions/editar-evaluacion/index.ts
//
// Reemplaza las puntuaciones (respuestas_evaluacion) de una evaluación existente y
// recalcula las medias por categoría en el servidor a partir de los ítems reales
// (nunca se confía en medias calculadas por el cliente). Solo lo puede hacer un
// coordinador — se comprueba aquí, con permisos elevados. Queda registrado en "auditoria".

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PUBLISHABLE_KEY = "sb_publishable_6B6PMd8eB85OKIS1e74Qgg_YPmTaAdj";

const CATEGORY_COL: Record<string, string> = {
  "Ofensivo / técnico": "media_ofensivo_tecnico",
  "Defensivo / táctico": "media_defensivo_tactico",
  "Físico / condicional": "media_fisico_condicional",
  "Psicológico": "media_psicologico",
};

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

  const { evaluacion_id, respuestas } = body;
  if (!evaluacion_id || !Array.isArray(respuestas)) {
    return jsonResponse({ error: "Faltan datos obligatorios (evaluacion_id, respuestas)." }, 400);
  }

  const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: perfil, error: errPerfil } = await supabase
    .from("perfiles")
    .select("rol, nombre, aprobado, activo")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (errPerfil) return jsonResponse({ error: "No se pudo comprobar tu perfil." }, 500);
  if (!perfil || perfil.rol !== "coordinador" || !perfil.aprobado || !perfil.activo) {
    return jsonResponse({ error: "Solo un coordinador puede editar las puntuaciones." }, 403);
  }

  try {
    // Medias actuales (antes de editar), para el registro de auditoría
    const { data: evaluacionAntes, error: errAntes } = await supabase
      .from("evaluaciones")
      .select("media_ofensivo_tecnico, media_defensivo_tactico, media_fisico_condicional, media_psicologico")
      .eq("id", evaluacion_id)
      .maybeSingle();
    if (errAntes) throw errAntes;
    if (!evaluacionAntes) return jsonResponse({ error: "La evaluación no existe." }, 404);

    // Reemplaza las respuestas: borra todas las actuales y crea las nuevas
    const { error: errDel } = await supabase
      .from("respuestas_evaluacion")
      .delete()
      .eq("evaluacion_id", evaluacion_id);
    if (errDel) throw errDel;

    if (respuestas.length > 0) {
      const { error: errIns } = await supabase.from("respuestas_evaluacion").insert(
        respuestas.map((r: { item_id: string; valor: number }) => ({
          evaluacion_id,
          item_id: r.item_id,
          valor: r.valor,
        }))
      );
      if (errIns) throw errIns;
    }

    // Recalcula las medias por categoría a partir de los ítems reales (no de lo que
    // diga el cliente): se busca a qué categoría pertenece cada ítem puntuado.
    let categoriaPorItem: Record<string, string> = {};
    if (respuestas.length > 0) {
      const itemIds = respuestas.map((r: { item_id: string }) => r.item_id);
      const { data: itemsInfo, error: errItems } = await supabase
        .from("items_evaluacion")
        .select("id, categoria")
        .in("id", itemIds);
      if (errItems) throw errItems;
      (itemsInfo || []).forEach((it: any) => { categoriaPorItem[it.id] = it.categoria; });
    }

    const sumas: Record<string, { suma: number; n: number }> = {};
    respuestas.forEach((r: { item_id: string; valor: number }) => {
      const cat = categoriaPorItem[r.item_id];
      if (!cat) return;
      if (!sumas[cat]) sumas[cat] = { suma: 0, n: 0 };
      sumas[cat].suma += r.valor;
      sumas[cat].n += 1;
    });

    const nuevasMedias: Record<string, number | null> = {};
    Object.entries(CATEGORY_COL).forEach(([cat, col]) => {
      const s = sumas[cat];
      nuevasMedias[col] = s ? Math.round((s.suma / s.n) * 100) / 100 : null;
    });

    const { error: errUpdate } = await supabase
      .from("evaluaciones")
      .update(nuevasMedias)
      .eq("id", evaluacion_id);
    if (errUpdate) throw errUpdate;

    const { error: errAuditoria } = await supabase.from("auditoria").insert({
      actor_id: userData.user.id,
      actor_nombre: (perfil && perfil.nombre) ? perfil.nombre : userData.user.email,
      accion: "editar_evaluacion",
      tabla: "evaluaciones",
      registro_id: evaluacion_id,
      detalle: {
        num_items: respuestas.length,
        medias_antes: evaluacionAntes,
        medias_despues: nuevasMedias,
      },
    });
    if (errAuditoria) console.error("No se pudo registrar la auditoría:", errAuditoria);

    return jsonResponse({ success: true, medias: nuevasMedias });
  } catch (err) {
    console.error(err);
    const mensaje = (err as any)?.message || "Error al actualizar la evaluación.";
    return jsonResponse({ error: mensaje }, 500);
  }
});