-- Vincula cada evaluación con la cuenta autenticada que la creó. El técnico solo
-- puede leer las suyas; un coordinador aprobado y activo conserva acceso global.
alter table public.evaluaciones
  add column creado_por uuid references auth.users(id);

update public.evaluaciones as e
set creado_por = p.id
from public.tecnicos as t
join public.perfiles as p
  on lower(btrim(p.nombre)) = lower(btrim(t.nombre))
where t.id = e.tecnico_id
  and p.aprobado = true
  and p.activo = true;

do $$
begin
  if exists (select 1 from public.evaluaciones where creado_por is null) then
    raise exception 'No se ha podido identificar al autor de todas las evaluaciones existentes.';
  end if;
end;
$$;

-- La operación atómica se ejecuta con service_role. El wrapper guarda el actor en
-- una variable local de la transacción y el valor por defecto lo aplica al INSERT.
alter table public.evaluaciones
  alter column creado_por set default
    nullif(pg_catalog.current_setting('app.evaluation_actor_id', true), '')::uuid,
  alter column creado_por set not null;

create index evaluaciones_creado_por_idx
  on public.evaluaciones (creado_por);

create index respuestas_evaluacion_evaluacion_id_idx
  on public.respuestas_evaluacion (evaluacion_id);

comment on column public.evaluaciones.creado_por is
  'Cuenta autenticada que creó la evaluación; se usa para autorizar su lectura.';

alter function public.guardar_evaluacion_atomica(
  uuid, uuid, text, text, text, integer, text, jsonb, jsonb
) rename to guardar_evaluacion_atomica_interna;

revoke execute on function public.guardar_evaluacion_atomica_interna(
  uuid, uuid, text, text, text, integer, text, jsonb, jsonb
) from public, anon, authenticated;

grant execute on function public.guardar_evaluacion_atomica_interna(
  uuid, uuid, text, text, text, integer, text, jsonb, jsonb
) to service_role;

create function public.guardar_evaluacion_atomica(
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
begin
  if p_actor_id is null or not exists (
    select 1
    from public.perfiles as p
    where p.id = p_actor_id
      and p.aprobado = true
      and p.activo = true
  ) then
    raise exception using errcode = '42501', message = 'La cuenta no está autorizada para guardar evaluaciones.';
  end if;

  perform pg_catalog.set_config('app.evaluation_actor_id', p_actor_id::text, true);

  return query
  select r.evaluacion_id, r.duplicada
  from public.guardar_evaluacion_atomica_interna(
    p_solicitud_id,
    p_actor_id,
    p_actor_nombre,
    p_nombre_portero,
    p_lateralidad,
    p_anio_nacimiento,
    p_equipo,
    p_row,
    p_respuestas
  ) as r;
end;
$$;

revoke execute on function public.guardar_evaluacion_atomica(
  uuid, uuid, text, text, text, integer, text, jsonb, jsonb
) from public, anon, authenticated;

grant execute on function public.guardar_evaluacion_atomica(
  uuid, uuid, text, text, text, integer, text, jsonb, jsonb
) to service_role;

drop policy "Lectura solo aprobados" on public.evaluaciones;
create policy "Tecnico lee propias o coordinador lee todas"
  on public.evaluaciones
  for select
  to authenticated
  using (
    private.es_aprobado()
    and (
      creado_por = (select auth.uid())
      or private.es_coordinador_aprobado()
    )
  );

drop policy "Lectura solo aprobados" on public.respuestas_evaluacion;
create policy "Respuestas de evaluaciones visibles"
  on public.respuestas_evaluacion
  for select
  to authenticated
  using (
    private.es_aprobado()
    and exists (
      select 1
      from public.evaluaciones as e
      where e.id = respuestas_evaluacion.evaluacion_id
        and (
          e.creado_por = (select auth.uid())
          or private.es_coordinador_aprobado()
        )
    )
  );
