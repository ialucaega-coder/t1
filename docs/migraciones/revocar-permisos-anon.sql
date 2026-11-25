-- =====================================================================
-- Cierra la exposición de las tablas del esquema public a los roles anon y
-- authenticated (avisos 0026/0027 del linter de Supabase: 32 tablas visibles en
-- el esquema GraphQL). La app solo usa Prisma con el rol postgres, así que no
-- depende de estos permisos. NO APLICADO: lo corre el DUEÑO en el SQL Editor.
--
-- Revertir (si algo dependiera de ellos):
--   GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;
-- =====================================================================

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

-- Que las tablas futuras tampoco hereden permisos para estos roles.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- Verificación: debe dar 0.
SELECT count(*) AS grants_restantes
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated');
