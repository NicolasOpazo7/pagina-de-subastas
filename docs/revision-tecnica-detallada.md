# Revision tecnica detallada

Revision realizada sobre HTML, CSS, JavaScript, servidor local y SQL de Supabase.

## Resumen ejecutivo

El proyecto ya tiene una base funcional: autenticacion, roles, productos, imagenes, pujas, perfil por rol, edicion/eliminacion de productos y acuerdos post-subasta. La prioridad ahora no es agregar pantallas nuevas sin control, sino estabilizar el ciclo completo de subasta: publicar, ofertar, cerrar, conectar comprador/subastador y mantener permisos correctos.

El mayor riesgo esta en Supabase: el modelo esta repartido en varios archivos SQL de correccion. Eso sirvio para avanzar rapido, pero puede provocar instalaciones incompletas si se ejecuta un archivo y falta otro. La segunda prioridad es cerrar subastas automaticamente, porque ahora una subasta vencida puede seguir listada como abierta hasta que algun flujo cree el acuerdo.

## Hallazgos por severidad

### Alta

1. **Migraciones SQL fragmentadas**

   Hay un esquema base y varios scripts de reparacion: `supabase-schema.sql`, `fix-product-publication.sql`, `fix-product-delete.sql`, `storage-setup.sql` y `auction-deals.sql`. Esto aumenta el riesgo de errores como tablas no encontradas, politicas faltantes o cache de esquema desactualizada.

   Impacto: un entorno nuevo puede no quedar funcional si los archivos no se ejecutan en el orden correcto.

   Tarea recomendada: crear una migracion unica ordenada o una carpeta `database/migrations` numerada.

2. **Cierre de subastas no centralizado**

   La funcion `place_bid` bloquea pujas si `ends_at <= now()`, pero la pagina principal lista productos por `status = open`. Si el producto ya vencio pero sigue con status `open`, puede seguir apareciendo hasta que otro flujo lo cierre.

   Impacto: se muestran subastas expiradas como si estuvieran disponibles.

   Tarea recomendada: crear RPC `close_expired_auctions()` y ejecutarla al cargar inicio/perfil, o programarla con cron/Supabase.

3. **Acuerdos post-subasta dependen de entrar al perfil**

   `ensure_auction_deal` se llama desde el perfil de usuario/subastador. Si nadie entra, el acuerdo puede no crearse.

   Impacto: una subasta terminada puede no generar contacto entre ganador y subastador de forma oportuna.

   Tarea recomendada: mover el cierre/creacion de acuerdos a una funcion programada o a un flujo explicito de cierre.

4. **Credenciales y configuracion acopladas al codigo**

   `assets/js/supabaseClient.js` contiene URL y publishable key directas. La publishable key no es secreta, pero la app queda acoplada a un unico proyecto.

   Impacto: dificulta separar desarrollo, pruebas y produccion.

   Tarea recomendada: documentar configuracion por entorno y agregar `.env.example` si se migra a Vite o build tool.

### Media

5. **Categorias duplicadas**

   Las categorias estan repetidas en headers, filtros y formularios. Agregar una categoria exige modificar varias pantallas.

   Impacto: inconsistencias de navegacion y filtros.

   Tarea recomendada: centralizar categorias en un archivo JS compartido o generarlas desde base de datos.

6. **No hay pagina de detalle de producto**

   La card permite ofertar, pero no hay detalle con galeria completa, historial de pujas o condiciones del producto.

   Impacto: experiencia incompleta para productos con varias imagenes y pujas competitivas.

   Tarea recomendada: crear `pages/producto.html?id=...`.

7. **Chat sin tiempo real**

   El chat de acuerdos necesita boton de actualizar. Para una venta, lo natural es recibir mensajes nuevos automaticamente.

   Impacto: coordinacion menos fluida entre comprador y subastador.

   Tarea recomendada: activar Supabase Realtime en `deal_messages`.

8. **Uso amplio de `innerHTML`**

   Muchos renderizados usan `innerHTML`. La mayoria de campos se escapan con `escapeHtml`, pero es una zona sensible.

   Impacto: riesgo de XSS si en el futuro se agrega un campo sin escapar.

   Tarea recomendada: mantener regla estricta de escape o migrar renderizados criticos a DOM APIs.

9. **Falta control de estados de carga**

   Algunos formularios no deshabilitan botones durante operaciones largas o no recuperan estado si hay error.

   Impacto: dobles envios o UX confusa.

   Tarea recomendada: crear helpers compartidos para loading/error/success.

10. **Sin pruebas de flujos**

    `npm run check` valida sintaxis, pero no prueba que los flujos funcionen en navegador.

    Impacto: cambios visuales o de Supabase pueden romperse sin aviso.

    Tarea recomendada: agregar Playwright para smoke tests.

### Baja

11. **HTML repetido entre paginas**

    Header y categorias se repiten en cada HTML.

    Impacto: mantenimiento manual.

    Tarea recomendada: componentizar con JS simple o migrar a un bundler cuando crezca.

12. **Servidor local basico**

    El servidor cumple, pero no tiene fallback SPA ni cache headers. Se corrigio el mensaje de puerto ocupado.

    Impacto: bajo para desarrollo local.

    Tarea recomendada: mantenerlo simple o usar Vite en una etapa posterior.

13. **Accesibilidad mejorable**

    Hay `aria-label` y estructura semantica basica, pero modales no gestionan foco completo ni cierre con Escape.

    Impacto: experiencia limitada para teclado/lectores.

    Tarea recomendada: agregar cierre con Escape y focus trap en modales.

## Tareas recomendadas en orden

### 1. Consolidar base de datos y RLS

- Crear `database/migrations/001_initial_schema.sql`.
- Integrar tablas actuales, storage, politicas y funciones.
- Agregar `notify pgrst, 'reload schema';` al final.
- Documentar el orden exacto para Supabase.

### 2. Cierre automatico de subastas

- Crear RPC `close_expired_auctions()`.
- Cerrar productos vencidos con status `open`.
- Crear acuerdos para productos con puja ganadora.
- Ejecutar al cargar inicio y perfil.

### 3. Vista detalle de producto

- Crear `pages/producto.html`.
- Mostrar galeria completa.
- Mostrar datos de subasta y oferta actual.
- Permitir ofertar desde esa pantalla.

### 4. Mejorar acuerdos post-subasta

- Separar acuerdos activos y completados.
- Activar Realtime para mensajes.
- Mostrar mensajes del sistema para confirmaciones.
- Agregar estados: pendiente comprador, pendiente subastador, completado.

### 5. Centralizar categorias

- Crear `assets/js/config.js`.
- Exportar o exponer `AUCTION_CATEGORIES`.
- Renderizar filtros/header/formularios desde esa fuente.

### 6. Endurecer formularios y estados

- Deshabilitar botones al enviar.
- Evitar doble submit.
- Normalizar mensajes de error.
- Validar fecha futura al publicar/editar producto.

### 7. Pruebas basicas

- Agregar Playwright.
- Probar carga de inicio, filtros, modal de oferta, login visual y perfil.
- Agregar comando `npm test`.

### 8. Preparacion para despliegue

- Definir hosting.
- Documentar redirect URLs local/produccion.
- Revisar OAuth Google.
- Separar configuracion de Supabase si se agrega build tool.

## Checks ejecutados

```bash
npm run check
```

Resultado: correcto.

## Nota sobre GitHub

El repositorio remoto actual es:

```text
https://github.com/NicolasOpazo7/pagina-de-subastas
```
