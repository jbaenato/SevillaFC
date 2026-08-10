# Checklist de mejoras — Captación (app de scouting de porteros)

Última actualización: 2026-08-10

Marca `[x]` cuando se implemente. Añade líneas nuevas donde encajen a medida que surjan ideas.

---

## 🔴 Prioridad alta

- [x] **Auditoría de acciones sensibles** (crear evaluación, editar portero, eliminar evaluación) — tabla `auditoria`, visible solo para coordinador desde la app.
- [x] **Borrado lógico de evaluaciones** (`eliminado_en` / `eliminado_por`) en vez de borrado físico — recuperable en caso de error.
- [ ] **Validación de datos en las Edge Functions** — comprobar en el servidor que las puntuaciones estén en rango 0–5, que `item_id` pertenezca de verdad a la modalidad de la evaluación, etc. (ahora mismo se confía en lo que manda el cliente).
- [ ] **Visibilidad cuando algo falla** — revisar Edge Functions → Logs periódicamente, y valorar integrar algo tipo Sentry (capa gratuita) para errores del cliente.

## 🟡 Prioridad media — mantenibilidad

- [ ] **Separar `index.html` en `app.js` + `styles.css`** — el archivo único ya ronda las 1.600 líneas.
- [ ] **Pruebas automáticas mínimas** del flujo crítico (login → guardar evaluación → aparece en la lista), aunque sea con Playwright.
- [ ] **Entorno de pruebas separado** — un proyecto Supabase de desarrollo (gratis) para probar cambios de esquema/RLS/Edge Functions antes de tocar producción.
- [ ] **Despliegue automatizado** con GitHub Actions al hacer push a `main`, para evitar subir el archivo equivocado o el despliegue a medias.

## 🟢 Funcionalidades nuevas con valor

- [ ] **Evolución de un portero a lo largo del tiempo** — tabla/gráfica con sus medias por categoría a lo largo de varias evaluaciones.
- [ ] **Comparar dos evaluaciones lado a lado** del mismo portero.
- [ ] **Gestión de usuarios desde la propia app** (solo coordinador) — invitar técnicos, asignarles nombre y rol, sin entrar a Supabase a mano.
- [ ] **Caché offline más agresiva** — que el service worker precargue explícitamente el catálogo completo de modalidades/ítems al instalar, para que funcione sin red incluso la primera vez que se abre en un sitio sin cobertura.

## 🔵 A futuro, si el proyecto escala

- [ ] **Paginación en la búsqueda** — mover el filtrado al servidor cuando haya muchas evaluaciones (ahora se filtra todo en el cliente).
- [ ] **Detección/fusión de equipos duplicados** (ej. "Real Betis" vs "R. Betis" vs "Betis") para no fragmentar los informes de Power BI.

---

## 💡 Ideas sueltas / por valorar

_(añadir aquí cualquier cosa que se os ocurra sobre la marcha, aunque no esté madura, para no perderla)_

-
