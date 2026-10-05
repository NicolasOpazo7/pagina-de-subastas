# Base de datos Supabase

## Instalacion recomendada

Para una base nueva o para dejar el modelo completo en un solo paso, ejecuta en Supabase SQL Editor:

```text
database/migrations/001_initial_schema.sql
```

Copia el contenido completo del archivo, pegalo en el SQL Editor y presiona **Run**.

Esta migracion incluye:

- roles `admin`, `usuario`, `subastador`;
- tablas `profiles`, `products`, `bids`, `product_images`, `auction_deals`, `deal_messages`;
- bucket publico `product-images`;
- funciones RPC de login Google, pujas, acuerdos y confirmaciones;
- triggers de `updated_at`;
- indices;
- permisos `grant`;
- politicas RLS;
- recarga de cache de PostgREST.

## Archivos legacy

Los archivos de la carpeta `database/` que empiezan con `fix-` o `storage-setup.sql` se mantienen como referencia historica de correcciones puntuales. Para instalaciones nuevas, usa la migracion consolidada.

## Orden sugerido para Supabase

1. Ejecutar `database/migrations/001_initial_schema.sql`.
2. Crear un usuario admin desde Supabase Auth con email y contrasena.
3. Actualizar su rol en `profiles`:

```sql
update public.profiles
set role = 'admin', full_name = 'Administrador'
where id = 'UUID_DEL_USUARIO_ADMIN';
```

4. Revisar Auth URL Configuration:

```text
http://localhost:5500/pages/perfil.html
```

5. Revisar Google Cloud OAuth redirect:

```text
https://qiiqelydamghbzowgkof.supabase.co/auth/v1/callback
```
