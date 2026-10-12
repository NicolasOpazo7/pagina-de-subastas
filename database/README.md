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

## Actualizaciones incrementales

Si ya ejecutaste la migracion inicial antes de que existiera el cierre automatico de subastas, ejecuta:

```text
database/migrations/002_close_expired_auctions.sql
```

Esta actualizacion crea la funcion `close_expired_auctions()`, que:

- cierra productos con `status = 'open'` cuya fecha `ends_at` ya paso;
- busca la puja ganadora;
- crea o actualiza el acuerdo post-subasta en `auction_deals`;
- devuelve cuantas subastas cerro y cuantos acuerdos preparo.

Si ya tienes la base creada y necesitas activar el historial anonimo de pujas para la pagina de detalle, ejecuta:

```text
database/migrations/003_product_bid_history.sql
```

Esta actualizacion crea la funcion `get_product_bid_history(product_id)`, que devuelve montos y fechas de pujas sin exponer datos personales del usuario que oferta.

Si necesitas que el chat de acuerdos se actualice en vivo, ejecuta:

```text
database/migrations/004_deal_messages_realtime.sql
```

Esta actualizacion agrega `public.deal_messages` a la publicacion `supabase_realtime`, necesaria para que Supabase envie eventos nuevos al navegador.

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
