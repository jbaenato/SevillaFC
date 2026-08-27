-- Cada envío nuevo lleva una UUID estable. La restricción garantiza que un reintento
-- nunca pueda crear una segunda evaluación con la misma solicitud.
alter table public.evaluaciones
  add column if not exists solicitud_id uuid;

create unique index if not exists evaluaciones_solicitud_id_unico
  on public.evaluaciones (solicitud_id)
  where solicitud_id is not null;

comment on column public.evaluaciones.solicitud_id is
  'Clave idempotente generada en el dispositivo y reutilizada en cada reintento.';

-- La Edge Function llama a esta operación con service_role. Una función Postgres se
-- ejecuta dentro de una única transacción: evaluación, respuestas y auditoría se guardan
-- juntas, o se revierten juntas si aparece cualquier error.
create or replace function public.guardar_evaluacion_atomica(
  p_solicitud_id uuid,
  p_actor_id uuid,
  p_actor_nombre text,
  p_nombre_portero text,
  p_lateralidad text,
  p_anio_nacimiento integer,
  p_equipo text,
  p_row jsonb,
  p_respuestas jsonb
)
returns table (evaluacion_id uuid, duplicada boolean)
language plpgsql
security invoker
set search_path = ''
as $$
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

-- La función está en public para que PostgREST pueda resolverla, pero solo la Edge
-- Function con service_role puede ejecutarla. Los usuarios no pueden saltarse sus
-- validaciones llamando al RPC desde el navegador.
revoke execute on function public.guardar_evaluacion_atomica(
  uuid, uuid, text, text, text, integer, text, jsonb, jsonb
) from public, anon, authenticated;

grant execute on function public.guardar_evaluacion_atomica(
  uuid, uuid, text, text, text, integer, text, jsonb, jsonb
) to service_role;
