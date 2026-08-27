-- Evita que la vista ejecute consultas con los privilegios de su propietario.
alter view public.vista_evaluaciones
  set (security_invoker = true);

-- La aplicación solo necesita leer esta vista y únicamente tras autenticarse.
revoke all privileges on table public.vista_evaluaciones
  from public, anon, authenticated;
grant select on table public.vista_evaluaciones
  to authenticated, service_role;

-- Las funciones SECURITY DEFINER usadas por RLS no deben exponerse a través
-- del esquema public (API). Sus consultas ya utilizan nombres cualificados.
create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
grant usage on schema private
  to authenticated, service_role, supabase_auth_admin;

alter function public.es_aprobado()
  set schema private;
alter function private.es_aprobado()
  set search_path = '';

alter function public.es_coordinador_aprobado()
  set schema private;
alter function private.es_coordinador_aprobado()
  set search_path = '';

alter function public.crear_perfil_nuevo_usuario()
  set schema private;
alter function private.crear_perfil_nuevo_usuario()
  set search_path = '';

-- PostgreSQL concede EXECUTE a PUBLIC por defecto. Se revoca expresamente y
-- se concede a cada función únicamente el acceso que necesita.
revoke all on function private.es_aprobado()
  from public, anon;
revoke all on function private.es_coordinador_aprobado()
  from public, anon;
revoke all on function private.crear_perfil_nuevo_usuario()
  from public, anon, authenticated;

grant execute on function private.es_aprobado()
  to authenticated, service_role;
grant execute on function private.es_coordinador_aprobado()
  to authenticated, service_role;
grant execute on function private.crear_perfil_nuevo_usuario()
  to supabase_auth_admin, service_role;
