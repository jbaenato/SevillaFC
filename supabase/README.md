# Funciones de Supabase

Este directorio conserva en GitHub el código de las funciones que están activas en el proyecto de Supabase de la aplicación.

## Importante

- Fusionar estos archivos en `main` **no despliega nada automáticamente** en Supabase.
- No se deben guardar aquí `SUPABASE_SERVICE_ROLE_KEY`, contraseñas ni otros secretos.
- La configuración `verify_jwt = false` reproduce el estado actual del despliegue. Las funciones que manejan datos validan la sesión dentro de su propio código. `sentry-tunnel` es público de forma intencionada porque recibe telemetría del navegador.
- Los nombres con guion bajo (`editar_evaluacion` y `fusionar_equipos`) se conservan porque son los nombres reales desplegados y los que utiliza la aplicación.

## Funciones versionadas

- `guardar-evaluacion`
- `eliminar-evaluacion`
- `editar-portero`
- `editar_evaluacion`
- `fusionar_equipos`
- `sentry-tunnel`
- `aprobar-usuario`
- `rechazar-usuario`
- `actualizar-usuario`

Antes de un futuro despliegue hay que revisar el cambio, probarlo y desplegar expresamente la función afectada.
