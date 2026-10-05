# Aurum Subastas

Proyecto web de subastas con HTML, CSS, JavaScript y Supabase.

## Estructura

- `index.html`: pagina principal y listado de productos.
- `pages/`: pantallas de login, registro, perfil y publicacion de productos.
- `assets/css/`: estilos del sitio.
- `assets/js/`: logica de autenticacion, productos, pujas y Supabase.
- `database/`: SQL para crear tablas, politicas y funciones en Supabase.
- `docs/`: analisis tecnico y tareas priorizadas.
- `server.js`: servidor local sin dependencias.

## Ejecutar en VS Code

1. Abre esta carpeta en VS Code.
2. Abre una terminal integrada.
3. Ejecuta:

```bash
npm start
```

4. Abre:

```text
http://localhost:5500
```

## Supabase

Ejecuta `database/supabase-schema.sql` en el SQL Editor de Supabase cuando cambie el modelo de datos.

Si hay errores de Storage al subir imagenes, ejecuta tambien `database/storage-setup.sql`.

Si aparece `Could not find the table 'public.product_images' in the schema cache`, ejecuta `database/fix-product-publication.sql`.

Si el subastador no puede eliminar productos por RLS, ejecuta `database/fix-product-delete.sql`.

Para activar los acuerdos de venta y el chat despues de finalizar una subasta, ejecuta `database/auction-deals.sql`.

Para Google OAuth, agrega en Supabase como redirect permitido:

```text
http://localhost:5500/pages/perfil.html
```

En Google Cloud, el redirect URI autorizado debe ser:

```text
https://qiiqelydamghbzowgkof.supabase.co/auth/v1/callback
```

## Analisis tecnico

- `docs/analisis-y-tareas.md`: resumen inicial de mejoras.
- `docs/revision-tecnica-detallada.md`: hallazgos por severidad y plan de trabajo recomendado.
