DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM public.evaluaciones e
    JOIN public.porteros p ON p.id = e.portero_id
    WHERE p.nombre = 'Portero prueba online E2E'
  ) <> 1 THEN
    RAISE EXCEPTION 'Se esperaba exactamente una evaluación E2E';
  END IF;

  IF (
    SELECT count(*)
    FROM public.respuestas_evaluacion r
    JOIN public.evaluaciones e ON e.id = r.evaluacion_id
    JOIN public.porteros p ON p.id = e.portero_id
    WHERE p.nombre = 'Portero prueba online E2E'
  ) <> 4 THEN
    RAISE EXCEPTION 'Se esperaban cuatro respuestas E2E';
  END IF;

  IF (
    SELECT count(*)
    FROM public.auditoria a
    WHERE a.accion = 'crear_evaluacion'
      AND a.actor_nombre = 'Técnico E2E'
      AND a.detalle->>'portero' = 'Portero prueba online E2E'
  ) <> 1 THEN
    RAISE EXCEPTION 'No se encontró la auditoría de creación E2E';
  END IF;
END
$$;
