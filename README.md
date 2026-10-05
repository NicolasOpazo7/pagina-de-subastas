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

Para una instalacion nueva, ejecuta `database/migrations/001_initial_schema.sql` en el SQL Editor de Supabase. Ese archivo deja listas las tablas, funciones, bucket de imagenes, permisos y politicas RLS.

Los scripts antiguos en `database/` como `fix-product-publication.sql`, `fix-product-delete.sql` y `storage-setup.sql` quedan como referencia de correcciones puntuales. Para trabajar desde cero usa la migracion consolidada.

Mas detalle: `database/README.md`.

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
