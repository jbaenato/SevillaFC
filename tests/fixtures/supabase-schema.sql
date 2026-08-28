


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "private"."crear_perfil_nuevo_usuario"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  insert into public.perfiles (id, nombre, rol)
  values (new.id, new.email, 'tecnico')
  on conflict (id) do nothing;
  return new;
end;
$$;


ALTER FUNCTION "private"."crear_perfil_nuevo_usuario"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."es_aprobado"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1 from public.perfiles p
    where p.id = auth.uid() and p.aprobado = true and p.activo = true
  );
$$;


ALTER FUNCTION "private"."es_aprobado"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."es_coordinador_aprobado"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1 from public.perfiles p
    where p.id = auth.uid() and p.rol = 'coordinador' and p.aprobado = true and p.activo = true
  );
$$;


ALTER FUNCTION "private"."es_coordinador_aprobado"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guardar_evaluacion_atomica"("p_solicitud_id" "uuid", "p_actor_id" "uuid", "p_actor_nombre" "text", "p_nombre_portero" "text", "p_lateralidad" "text", "p_anio_nacimiento" integer, "p_equipo" "text", "p_row" "jsonb", "p_respuestas" "jsonb") RETURNS TABLE("evaluacion_id" "uuid", "duplicada" boolean)
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_tecnico_id uuid;
  v_portero_id uuid;
  v_equipo_id uuid;
  v_evaluacion_id uuid;
begin
  if p_solicitud_id is null then
    raise exception using errcode = '22023', message = 'Falta la clave idempotente.';
  end if;
  if nullif(btrim(p_actor_nombre), '') is null
     or nullif(btrim(p_nombre_portero), '') is null
     or nullif(btrim(p_equipo), '') is null then
    raise exception using errcode = '22023', message = 'Faltan nombres obligatorios.';
  end if;
  if p_row is null or jsonb_typeof(p_row) <> 'object'
     or p_respuestas is null or jsonb_typeof(p_respuestas) <> 'array' then
    raise exception using errcode = '22023', message = 'El contenido de la evaluación no es válido.';
  end if;

  -- Serializa únicamente los reintentos de la misma solicitud. Esto evita una carrera
  -- entre dos conexiones sin bloquear guardados de evaluaciones diferentes.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_solicitud_id::text, 0)
  );

  select e.id
    into v_evaluacion_id
  from public.evaluaciones as e
  where e.solicitud_id = p_solicitud_id;

  if v_evaluacion_id is not null then
    return query select v_evaluacion_id, true;
    return;
  end if;

  select t.id into v_tecnico_id
  from public.tecnicos as t
  where lower(t.nombre) = lower(btrim(p_actor_nombre))
  limit 1;

  if v_tecnico_id is null then
    insert into public.tecnicos (nombre)
    values (btrim(p_actor_nombre))
    on conflict do nothing
    returning id into v_tecnico_id;
    if v_tecnico_id is null then
      select t.id into v_tecnico_id
      from public.tecnicos as t
      where lower(t.nombre) = lower(btrim(p_actor_nombre))
      limit 1;
    end if;
  end if;

  select p.id into v_portero_id
  from public.porteros as p
  where lower(p.nombre) = lower(btrim(p_nombre_portero))
  limit 1;

  if v_portero_id is null then
    insert into public.porteros (nombre, lateralidad, anio_nacimiento)
    values (
      btrim(p_nombre_portero),
      coalesce(nullif(p_lateralidad, ''), 'N/D'),
      p_anio_nacimiento
    )
    on conflict do nothing
    returning id into v_portero_id;
    if v_portero_id is null then
      select p.id into v_portero_id
      from public.porteros as p
      where lower(p.nombre) = lower(btrim(p_nombre_portero))
      limit 1;
    end if;
  else
    update public.porteros
    set lateralidad = case
          when p_lateralidad is not null and p_lateralidad <> 'N/D' then p_lateralidad
          else lateralidad
        end,
        anio_nacimiento = coalesce(p_anio_nacimiento, anio_nacimiento)
    where id = v_portero_id;
  end if;

  select e.id into v_equipo_id
  from public.equipos as e
  where lower(e.nombre) = lower(btrim(p_equipo))
  limit 1;

  if v_equipo_id is null then
    insert into public.equipos (nombre)
    values (btrim(p_equipo))
    on conflict do nothing
    returning id into v_equipo_id;
    if v_equipo_id is null then
      select e.id into v_equipo_id
      from public.equipos as e
      where lower(e.nombre) = lower(btrim(p_equipo))
      limit 1;
    end if;
  end if;

  insert into public.evaluaciones (
    solicitud_id,
    fecha_partido,
    tipo_visionado,
    partido,
    observaciones,
    media_ofensivo_tecnico,
    media_defensivo_tactico,
    media_fisico_condicional,
    media_psicologico,
    evaluacion_final,
    modalidad_id,
    tecnico_id,
    portero_id,
    equipo_id
  ) values (
    p_solicitud_id,
    (p_row->>'fecha_partido')::date,
    p_row->>'tipo_visionado',
    p_row->>'partido',
    nullif(p_row->>'observaciones', ''),
    nullif(p_row->>'media_ofensivo_tecnico', '')::numeric,
    nullif(p_row->>'media_defensivo_tactico', '')::numeric,
    nullif(p_row->>'media_fisico_condicional', '')::numeric,
    nullif(p_row->>'media_psicologico', '')::numeric,
    p_row->>'evaluacion_final',
    (p_row->>'modalidad_id')::uuid,
    v_tecnico_id,
    v_portero_id,
    v_equipo_id
  )
  returning id into v_evaluacion_id;

  insert into public.respuestas_evaluacion (evaluacion_id, item_id, valor)
  select
    v_evaluacion_id,
    (respuesta->>'item_id')::uuid,
    (respuesta->>'valor')::numeric
  from jsonb_array_elements(p_respuestas) as respuesta;

  insert into public.auditoria (
    actor_id,
    actor_nombre,
    accion,
    tabla,
    registro_id,
    detalle
  ) values (
    p_actor_id,
    btrim(p_actor_nombre),
    'crear_evaluacion',
    'evaluaciones',
    v_evaluacion_id,
    jsonb_build_object(
      'portero', btrim(p_nombre_portero),
      'equipo', btrim(p_equipo),
      'fecha_partido', p_row->>'fecha_partido'
    )
  );

  return query select v_evaluacion_id, false;
end;
$$;


ALTER FUNCTION "public"."guardar_evaluacion_atomica"("p_solicitud_id" "uuid", "p_actor_id" "uuid", "p_actor_nombre" "text", "p_nombre_portero" "text", "p_lateralidad" "text", "p_anio_nacimiento" integer, "p_equipo" "text", "p_row" "jsonb", "p_respuestas" "jsonb") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."auditoria" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "actor_id" "uuid",
    "actor_nombre" "text",
    "accion" "text" NOT NULL,
    "tabla" "text" NOT NULL,
    "registro_id" "uuid",
    "detalle" "jsonb",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."auditoria" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."equipos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "nombre" "text" NOT NULL
);


ALTER TABLE "public"."equipos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."evaluaciones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "fecha_partido" "date" NOT NULL,
    "tipo_visionado" "text" NOT NULL,
    "partido" "text" NOT NULL,
    "observaciones" "text",
    "media_ofensivo_tecnico" numeric,
    "media_defensivo_tactico" numeric,
    "media_fisico_condicional" numeric,
    "media_psicologico" numeric,
    "portero_id" "uuid" NOT NULL,
    "equipo_id" "uuid" NOT NULL,
    "evaluacion_final" "text",
    "modalidad_id" "uuid" NOT NULL,
    "tecnico_id" "uuid" NOT NULL,
    "eliminado_en" timestamp with time zone,
    "eliminado_por" "uuid",
    "solicitud_id" "uuid",
    CONSTRAINT "evaluaciones_evaluacion_final_check" CHECK (("evaluacion_final" = ANY (ARRAY['A'::"text", 'B'::"text", 'C'::"text", 'D'::"text"]))),
    CONSTRAINT "evaluaciones_tipo_visionado_check" CHECK (("tipo_visionado" = ANY (ARRAY['Directo'::"text", 'Video'::"text"])))
);


ALTER TABLE "public"."evaluaciones" OWNER TO "postgres";


COMMENT ON COLUMN "public"."evaluaciones"."solicitud_id" IS 'Clave idempotente generada en el dispositivo y reutilizada en cada reintento.';



CREATE TABLE IF NOT EXISTS "public"."items_evaluacion" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "modalidad_id" "uuid" NOT NULL,
    "categoria" "text" NOT NULL,
    "nombre" "text" NOT NULL,
    "orden" integer NOT NULL
);


ALTER TABLE "public"."items_evaluacion" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."modalidades" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "text" NOT NULL
);


ALTER TABLE "public"."modalidades" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."perfiles" (
    "id" "uuid" NOT NULL,
    "nombre" "text",
    "rol" "text" DEFAULT 'tecnico'::"text" NOT NULL,
    "aprobado" boolean DEFAULT false NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    CONSTRAINT "perfiles_rol_check" CHECK (("rol" = ANY (ARRAY['tecnico'::"text", 'coordinador'::"text"])))
);


ALTER TABLE "public"."perfiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."porteros" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "nombre" "text" NOT NULL,
    "lateralidad" "text" DEFAULT 'N/D'::"text",
    "anio_nacimiento" integer,
    CONSTRAINT "porteros_lateralidad_check" CHECK (("lateralidad" = ANY (ARRAY['Derecha'::"text", 'Izquierda'::"text", 'N/D'::"text"])))
);


ALTER TABLE "public"."porteros" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."respuestas_evaluacion" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "evaluacion_id" "uuid" NOT NULL,
    "item_id" "uuid" NOT NULL,
    "valor" numeric NOT NULL
);


ALTER TABLE "public"."respuestas_evaluacion" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tecnicos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "nombre" "text" NOT NULL
);


ALTER TABLE "public"."tecnicos" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vista_evaluaciones" WITH ("security_invoker"='true') AS
 SELECT "e"."id" AS "evaluacion_id",
    "t"."nombre" AS "tecnico",
    "p"."nombre" AS "portero",
    "p"."lateralidad",
    "p"."anio_nacimiento",
    "eq"."nombre" AS "equipo",
    "m"."nombre" AS "modalidad",
    "e"."fecha_partido",
    "e"."tipo_visionado",
    "e"."partido",
    "e"."observaciones",
    "e"."evaluacion_final",
    "e"."media_ofensivo_tecnico",
    "e"."media_defensivo_tactico",
    "e"."media_fisico_condicional",
    "e"."media_psicologico",
    "e"."created_at"
   FROM (((("public"."evaluaciones" "e"
     LEFT JOIN "public"."porteros" "p" ON (("p"."id" = "e"."portero_id")))
     LEFT JOIN "public"."equipos" "eq" ON (("eq"."id" = "e"."equipo_id")))
     LEFT JOIN "public"."modalidades" "m" ON (("m"."id" = "e"."modalidad_id")))
     LEFT JOIN "public"."tecnicos" "t" ON (("t"."id" = "e"."tecnico_id")));


ALTER VIEW "public"."vista_evaluaciones" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vista_respuestas" WITH ("security_invoker"='true') AS
 SELECT "r"."evaluacion_id",
    "i"."categoria",
    "i"."nombre" AS "item",
    "i"."orden",
    "r"."valor"
   FROM ("public"."respuestas_evaluacion" "r"
     JOIN "public"."items_evaluacion" "i" ON (("i"."id" = "r"."item_id")));


ALTER VIEW "public"."vista_respuestas" OWNER TO "postgres";


ALTER TABLE ONLY "public"."auditoria"
    ADD CONSTRAINT "auditoria_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."equipos"
    ADD CONSTRAINT "equipos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."evaluaciones"
    ADD CONSTRAINT "evaluaciones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."items_evaluacion"
    ADD CONSTRAINT "items_evaluacion_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."modalidades"
    ADD CONSTRAINT "modalidades_nombre_key" UNIQUE ("nombre");



ALTER TABLE ONLY "public"."modalidades"
    ADD CONSTRAINT "modalidades_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."perfiles"
    ADD CONSTRAINT "perfiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."porteros"
    ADD CONSTRAINT "porteros_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."respuestas_evaluacion"
    ADD CONSTRAINT "respuestas_evaluacion_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tecnicos"
    ADD CONSTRAINT "tecnicos_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "equipos_nombre_unico" ON "public"."equipos" USING "btree" ("lower"("nombre"));



CREATE UNIQUE INDEX "evaluaciones_solicitud_id_unico" ON "public"."evaluaciones" USING "btree" ("solicitud_id") WHERE ("solicitud_id" IS NOT NULL);



CREATE UNIQUE INDEX "porteros_nombre_unico" ON "public"."porteros" USING "btree" ("lower"("nombre"));



CREATE UNIQUE INDEX "tecnicos_nombre_unico" ON "public"."tecnicos" USING "btree" ("lower"("nombre"));



ALTER TABLE ONLY "public"."auditoria"
    ADD CONSTRAINT "auditoria_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."evaluaciones"
    ADD CONSTRAINT "evaluaciones_eliminado_por_fkey" FOREIGN KEY ("eliminado_por") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."evaluaciones"
    ADD CONSTRAINT "evaluaciones_equipo_id_fkey" FOREIGN KEY ("equipo_id") REFERENCES "public"."equipos"("id");



ALTER TABLE ONLY "public"."evaluaciones"
    ADD CONSTRAINT "evaluaciones_modalidad_id_fkey" FOREIGN KEY ("modalidad_id") REFERENCES "public"."modalidades"("id");



ALTER TABLE ONLY "public"."evaluaciones"
    ADD CONSTRAINT "evaluaciones_portero_id_fkey" FOREIGN KEY ("portero_id") REFERENCES "public"."porteros"("id");



ALTER TABLE ONLY "public"."evaluaciones"
    ADD CONSTRAINT "evaluaciones_tecnico_id_fkey" FOREIGN KEY ("tecnico_id") REFERENCES "public"."tecnicos"("id");



ALTER TABLE ONLY "public"."items_evaluacion"
    ADD CONSTRAINT "items_evaluacion_modalidad_id_fkey" FOREIGN KEY ("modalidad_id") REFERENCES "public"."modalidades"("id");



ALTER TABLE ONLY "public"."perfiles"
    ADD CONSTRAINT "perfiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."respuestas_evaluacion"
    ADD CONSTRAINT "respuestas_evaluacion_evaluacion_id_fkey" FOREIGN KEY ("evaluacion_id") REFERENCES "public"."evaluaciones"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."respuestas_evaluacion"
    ADD CONSTRAINT "respuestas_evaluacion_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items_evaluacion"("id");



CREATE POLICY "Coordinador lee todos los perfiles" ON "public"."perfiles" FOR SELECT TO "authenticated" USING ("private"."es_coordinador_aprobado"());



CREATE POLICY "Lectura solo aprobados" ON "public"."equipos" FOR SELECT TO "authenticated" USING ("private"."es_aprobado"());



CREATE POLICY "Lectura solo aprobados" ON "public"."evaluaciones" FOR SELECT TO "authenticated" USING ("private"."es_aprobado"());



CREATE POLICY "Lectura solo aprobados" ON "public"."items_evaluacion" FOR SELECT TO "authenticated" USING ("private"."es_aprobado"());



CREATE POLICY "Lectura solo aprobados" ON "public"."modalidades" FOR SELECT TO "authenticated" USING ("private"."es_aprobado"());



CREATE POLICY "Lectura solo aprobados" ON "public"."porteros" FOR SELECT TO "authenticated" USING ("private"."es_aprobado"());



CREATE POLICY "Lectura solo aprobados" ON "public"."respuestas_evaluacion" FOR SELECT TO "authenticated" USING ("private"."es_aprobado"());



CREATE POLICY "Lectura solo aprobados" ON "public"."tecnicos" FOR SELECT TO "authenticated" USING ("private"."es_aprobado"());



CREATE POLICY "Leer propio perfil" ON "public"."perfiles" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



CREATE POLICY "Solo coordinador lee auditoria" ON "public"."auditoria" FOR SELECT TO "authenticated" USING (("private"."es_aprobado"() AND (EXISTS ( SELECT 1
   FROM "public"."perfiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."rol" = 'coordinador'::"text"))))));



ALTER TABLE "public"."auditoria" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."equipos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."evaluaciones" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."items_evaluacion" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."modalidades" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."perfiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."porteros" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."respuestas_evaluacion" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tecnicos" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "private" TO "authenticated";
GRANT USAGE ON SCHEMA "private" TO "service_role";
GRANT USAGE ON SCHEMA "private" TO "supabase_auth_admin";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































REVOKE ALL ON FUNCTION "private"."crear_perfil_nuevo_usuario"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."crear_perfil_nuevo_usuario"() TO "service_role";
GRANT ALL ON FUNCTION "private"."crear_perfil_nuevo_usuario"() TO "supabase_auth_admin";



REVOKE ALL ON FUNCTION "private"."es_aprobado"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."es_aprobado"() TO "authenticated";
GRANT ALL ON FUNCTION "private"."es_aprobado"() TO "service_role";



REVOKE ALL ON FUNCTION "private"."es_coordinador_aprobado"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."es_coordinador_aprobado"() TO "authenticated";
GRANT ALL ON FUNCTION "private"."es_coordinador_aprobado"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."guardar_evaluacion_atomica"("p_solicitud_id" "uuid", "p_actor_id" "uuid", "p_actor_nombre" "text", "p_nombre_portero" "text", "p_lateralidad" "text", "p_anio_nacimiento" integer, "p_equipo" "text", "p_row" "jsonb", "p_respuestas" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guardar_evaluacion_atomica"("p_solicitud_id" "uuid", "p_actor_id" "uuid", "p_actor_nombre" "text", "p_nombre_portero" "text", "p_lateralidad" "text", "p_anio_nacimiento" integer, "p_equipo" "text", "p_row" "jsonb", "p_respuestas" "jsonb") TO "service_role";


















GRANT ALL ON TABLE "public"."auditoria" TO "anon";
GRANT ALL ON TABLE "public"."auditoria" TO "authenticated";
GRANT ALL ON TABLE "public"."auditoria" TO "service_role";



GRANT ALL ON TABLE "public"."equipos" TO "anon";
GRANT ALL ON TABLE "public"."equipos" TO "authenticated";
GRANT ALL ON TABLE "public"."equipos" TO "service_role";



GRANT ALL ON TABLE "public"."evaluaciones" TO "anon";
GRANT ALL ON TABLE "public"."evaluaciones" TO "authenticated";
GRANT ALL ON TABLE "public"."evaluaciones" TO "service_role";



GRANT ALL ON TABLE "public"."items_evaluacion" TO "anon";
GRANT ALL ON TABLE "public"."items_evaluacion" TO "authenticated";
GRANT ALL ON TABLE "public"."items_evaluacion" TO "service_role";



GRANT ALL ON TABLE "public"."modalidades" TO "anon";
GRANT ALL ON TABLE "public"."modalidades" TO "authenticated";
GRANT ALL ON TABLE "public"."modalidades" TO "service_role";



GRANT ALL ON TABLE "public"."perfiles" TO "anon";
GRANT ALL ON TABLE "public"."perfiles" TO "authenticated";
GRANT ALL ON TABLE "public"."perfiles" TO "service_role";



GRANT ALL ON TABLE "public"."porteros" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."porteros" TO "authenticated";
GRANT ALL ON TABLE "public"."porteros" TO "service_role";



GRANT ALL ON TABLE "public"."respuestas_evaluacion" TO "anon";
GRANT ALL ON TABLE "public"."respuestas_evaluacion" TO "authenticated";
GRANT ALL ON TABLE "public"."respuestas_evaluacion" TO "service_role";



GRANT ALL ON TABLE "public"."tecnicos" TO "anon";
GRANT ALL ON TABLE "public"."tecnicos" TO "authenticated";
GRANT ALL ON TABLE "public"."tecnicos" TO "service_role";



GRANT ALL ON TABLE "public"."vista_evaluaciones" TO "service_role";
GRANT SELECT ON TABLE "public"."vista_evaluaciones" TO "authenticated";



GRANT ALL ON TABLE "public"."vista_respuestas" TO "anon";
GRANT ALL ON TABLE "public"."vista_respuestas" TO "authenticated";
GRANT ALL ON TABLE "public"."vista_respuestas" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































