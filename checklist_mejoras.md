# Checklist de mejoras — Captación (app de scouting de porteros)

Última actualización: 2026-08-28

Marca `[x]` cuando se implemente. Añade líneas nuevas donde encajen a medida que surjan ideas.

---

## 🔴 Prioridad alta

- [x] **Auditoría de acciones sensibles** (crear evaluación, editar portero, eliminar evaluación) — tabla `auditoria`, visible solo para coordinador desde la app.
- [x] **Borrado lógico de evaluaciones** (`eliminado_en` / `eliminado_por`) en vez de borrado físico — recuperable en caso de error.
- [x] **Validación de datos en las Edge Functions** — `guardar-evaluacion` y `editar-evaluacion` ya validan en servidor: evaluación final A-D, observaciones obligatorias si D, lateralidad/visionado válidos, puntuaciones en rango 0–5, e ítems pertenecientes a la modalidad correcta.
- [x] **Visibilidad cuando algo falla** — Sentry activo con configuración única, privacidad reforzada y túnel restringido al proyecto autorizado. Las pruebas automáticas no envían telemetría a producción y los rechazos esperados no generan ruido.

## 🟡 Prioridad media — mantenibilidad

- [x] **Separar `index.html` en `app.js` + `styles.css`** — hecho: `index.html` ahora solo contiene estructura.
- [x] **Prueba automática del flujo crítico online** — Playwright inicia sesión, crea una evaluación completa mediante la Edge Function, comprueba su búsqueda y detalle, y valida la persistencia y auditoría en PostgreSQL.
- [x] **Entorno de pruebas aislado** — GitHub Actions levanta un Supabase local temporal con PostgreSQL 17 y datos sintéticos; producción no se utiliza ni se modifica.
- [ ] **Despliegue automatizado** con GitHub Actions al hacer push a `main`, para evitar subir el archivo equivocado o el despliegue a medias.

## 🟢 Funcionalidades nuevas con valor

- [ ] **Evolución de un portero a lo largo del tiempo** — tabla/gráfica con sus medias por categoría a lo largo de varias evaluaciones.
- [ ] **Comparar dos evaluaciones lado a lado** del mismo portero.
- [ ] **Gestión de usuarios desde la propia app** (solo coordinador) — invitar técnicos, asignarles nombre y rol, sin entrar a Supabase a mano.
- [ ] **Caché offline más agresiva** — que el service worker precargue explícitamente el catálogo completo de modalidades/ítems al instalar, para que funcione sin red incluso la primera vez que se abre en un sitio sin cobertura.

## 🔵 A futuro, si el proyecto escala

- [ ] **Paginación en la búsqueda** — mover el filtrado al servidor cuando haya muchas evaluaciones (ahora se filtra todo en el cliente).
- [x] **Detección/fusión de equipos duplicados** (ej. "Real Betis" vs "R. Betis" vs "Betis") — panel "Equipos" (solo coordinador) para fusionarlos manualmente.

---

## 💡 Ideas sueltas / por valorar

_(añadir aquí cualquier cosa que se os ocurra sobre la marcha, aunque no esté madura, para no perderla)_

-
