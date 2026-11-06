-- Persona responsable: de campos sueltos a varias filas (web y teléfono por separado)
UPDATE "project_sheet"
SET "data" = "data" || jsonb_build_object('responsibles', jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
  'role', "data"->>'responsibleRole',
  'name', "data"->>'responsibleName',
  'address', nullif("data"->>'responsibleAddress', ''),
  'country', nullif("data"->>'responsibleCountry', ''),
  'web', CASE WHEN "data"->>'responsibleContact' ~ '^[+0-9 ().-]+$' THEN NULL ELSE "data"->>'responsibleContact' END,
  'phone', CASE WHEN "data"->>'responsibleContact' ~ '^[+0-9 ().-]+$' THEN "data"->>'responsibleContact' ELSE NULL END
))))
WHERE "section" = 'regulatorio' AND NOT ("data" ? 'responsibles')
  AND coalesce("data"->>'responsibleName', "data"->>'responsibleAddress', "data"->>'responsibleContact', '') <> '';
--> statement-breakpoint
-- Obligatorios de Calidad: el lote pasa a opcional; alérgenos y CPNP desaparecen; el responsable es la lista
UPDATE "dept_substates"
SET "required_fields" = array_remove(array_remove(array_remove(array_remove(array_remove("required_fields",
      'regulatorio.lot'), 'regulatorio.allergens'), 'regulatorio.cpnp'), 'regulatorio.responsibleName'), 'regulatorio.responsibleAddress')
    || CASE WHEN 'regulatorio.responsibleName' = ANY("required_fields") OR 'regulatorio.responsibleAddress' = ANY("required_fields") THEN ARRAY['regulatorio.responsibles']::text[] ELSE '{}'::text[] END,
    "prompt_fields" = array_remove(array_remove(array_remove(array_remove(array_remove(array_remove("prompt_fields",
      'regulatorio.allergens'), 'regulatorio.cpnp'), 'regulatorio.responsibleName'), 'regulatorio.responsibleAddress'), 'regulatorio.responsibleContact'), 'regulatorio.responsibleRole')
WHERE EXISTS (SELECT 1 FROM unnest("required_fields" || "prompt_fields") f WHERE f LIKE 'regulatorio.%');
