// supabase/functions/solicitar-alta/index.ts
//
// Registra una solicitud de acceso sin depender del correo de confirmación de Supabase.
// La autorización real sigue estando en "perfiles.aprobado", que debe activar un coordinador.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

function textoLimpio(valor: unknown) {
  return typeof valor === "string" ? valor.trim() : "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Metodo no permitido." }, 405);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Cuerpo de la peticion no es JSON valido." }, 400);
  }

  const nombre = textoLimpio(body.nombre);
  const email = textoLimpio(body.email).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";

  if (!nombre) return jsonResponse({ error: "Indica tu nombre y apellidos." }, 400);
  if (!email || !password) return jsonResponse({ error: "Introduce tu email y contrasena." }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return jsonResponse({ error: "El email no tiene un formato valido." }, 400);
  if (password.length < 6) return jsonResponse({ error: "La contrasena debe tener al menos 6 caracteres." }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Falta configuracion del servidor." }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { data, error: errCrear } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nombre },
    });

    if (errCrear) {
      const mensaje = errCrear.message || "No se pudo crear la cuenta.";
      const yaExiste = /already|registered|exists|duplicate/i.test(mensaje);
      return jsonResponse({ error: yaExiste ? "Ya existe una cuenta con ese email." : mensaje }, yaExiste ? 409 : 500);
    }

    const usuarioId = data.user?.id;
    if (!usuarioId) return jsonResponse({ error: "No se pudo crear la cuenta." }, 500);

    const { error: errPerfil } = await supabase
      .from("perfiles")
      .upsert({
        id: usuarioId,
        nombre,
        rol: "tecnico",
        aprobado: false,
        activo: true,
      }, { onConflict: "id" });

    if (errPerfil) {
      console.error("No se pudo crear el perfil pendiente:", errPerfil);
      await supabase.auth.admin.deleteUser(usuarioId);
      return jsonResponse({ error: "No se pudo crear la solicitud de acceso." }, 500);
    }

    return jsonResponse({ success: true });
  } catch (err) {
    console.error(err);
    const mensaje = (err as any)?.message || "Error al crear la solicitud de acceso.";
    return jsonResponse({ error: mensaje }, 500);
  }
});
