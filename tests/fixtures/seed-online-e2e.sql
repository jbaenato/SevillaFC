BEGIN;

INSERT INTO public.modalidades (id, nombre)
VALUES ('11111111-1111-4111-8111-111111111111', 'F11 E2E');

INSERT INTO public.items_evaluacion (id, modalidad_id, categoria, nombre, orden)
VALUES
  ('21111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'Ofensivo / técnico', 'Juego con el pie E2E', 1),
  ('31111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'Defensivo / táctico', 'Colocación E2E', 2),
  ('41111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'Físico / condicional', 'Explosividad E2E', 3),
  ('51111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'Psicológico', 'Concentración E2E', 4);

COMMIT;
