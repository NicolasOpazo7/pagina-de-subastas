# Analisis y tareas pendientes

Este documento resume los puntos encontrados al revisar el proyecto completo de Aurum Subastas. La prioridad esta pensada para avanzar por partes sin romper lo que ya funciona.

## Estado actual

- Proyecto HTML, CSS y JavaScript puro con servidor local en Node.
- Autenticacion con Supabase por correo/contrasena y Google OAuth.
- Roles principales: administrador, usuario y subastador.
- Publicacion de productos con imagenes en Supabase Storage.
- Pujas mediante funcion RPC `place_bid`.
- Perfil diferenciado por rol.
- Gestion de productos para subastador.
- Acuerdos post-subasta con chat y confirmacion de ambas partes.

## Hallazgos principales

1. La base de datos depende de ejecutar varios archivos SQL manualmente.
   Esto puede provocar errores como tablas no encontradas, cache de esquema desactualizada o politicas RLS incompletas si se ejecutan en orden incorrecto.

2. El cierre automatico de subastas depende de que usuario o subastador abra el perfil.
   Si nadie entra al perfil, una subasta vencida puede seguir apareciendo como abierta en la pagina principal hasta que se cree el acuerdo o se cierre manualmente.

3. No existe una vista de detalle de producto.
   Las cards permiten ofertar, pero falta una pagina donde ver galeria completa, historial de pujas, estado de la subasta y datos extendidos.

4. El chat de acuerdos funciona como base, pero no tiene tiempo real.
   Ahora se actualiza manualmente desde el boton de actualizar chat. Puede mejorarse con Supabase Realtime.

5. Las categorias estan duplicadas en varios HTML.
   Estan repetidas en header, filtros y formularios. Esto aumenta el riesgo de inconsistencias cuando se agreguen nuevas categorias.

6. El proyecto usa `innerHTML` en varios renderizados.
   La mayoria de datos se escapan con `escapeHtml`, pero conviene mantener esa regla estricta o migrar componentes sensibles a creacion con DOM APIs.

7. La clave publica de Supabase esta hardcodeada.
   No es una clave secreta, pero conviene documentarlo claramente y separar configuracion por entorno cuando el proyecto crezca.

8. No hay pruebas automatizadas.
   Hay validacion de sintaxis con `node --check`, pero no pruebas de flujos como login, publicar, pujar o editar producto.

9. El servidor local no tenia manejo amable para puerto ocupado.
   Se corrigio para mostrar una instruccion cuando `5500` ya esta en uso.

10. No hay repositorio Git inicializado ni flujo de despliegue.
    El proyecto puede versionarse localmente, pero subirlo a GitHub requiere una cuenta autenticada con GitHub CLI, Git remoto o plugin de GitHub.

## Tareas priorizadas

### Prioridad 1: estabilizar base de datos y permisos

1. Unificar los SQL en una migracion principal ordenada.
2. Crear una guia de ejecucion exacta para Supabase desde cero.
3. Verificar politicas RLS para:
   - productos abiertos,
   - productos cerrados donde el usuario pujo,
   - productos propios del subastador,
   - imagenes de productos,
   - acuerdos y mensajes.
4. Agregar una funcion RPC para cerrar subastas vencidas en lote.

### Prioridad 2: cierre real de subastas

1. Crear funcion `close_expired_auctions()` en Supabase.
2. Ejecutarla al cargar la pagina principal y perfiles.
3. Evaluar Supabase Scheduled Functions o cron externo para cierre automatico.
4. Ocultar o marcar productos vencidos en la pagina principal sin depender de recargar datos manuales.

### Prioridad 3: detalle de producto e historial de pujas

1. Crear `pages/producto.html?id=...`.
2. Mostrar galeria completa, descripcion, precio inicial, oferta actual y fecha de cierre.
3. Mostrar historial publico o parcial de pujas.
4. Mover la oferta desde modal simple a una experiencia mas completa cuando se abre un producto.

### Prioridad 4: mejoras del perfil

1. Separar perfil en secciones mas claras: datos, pujas, productos, acuerdos.
2. Mostrar acuerdos completados y activos por separado.
3. Agregar estados visuales para subastas ganadas, perdidas, activas y cerradas.
4. Permitir editar datos basicos del perfil.

### Prioridad 5: chat post-subasta en tiempo real

1. Activar Supabase Realtime para `deal_messages`.
2. Escuchar mensajes nuevos sin boton de actualizar.
3. Agregar indicador de confirmacion de comprador/subastador en vivo.
4. Agregar mensajes del sistema cuando se confirma la venta.

### Prioridad 6: organizacion de frontend

1. Extraer categorias a un unico archivo JavaScript de configuracion.
2. Crear funciones compartidas para header, categorias y render de cards.
3. Reducir HTML repetido entre paginas.
4. Considerar migrar a Vite si el proyecto sigue creciendo.

### Prioridad 7: validacion y pruebas

1. Agregar un script `npm run check` que valide todos los JS.
2. Agregar Playwright para probar:
   - carga de inicio,
   - login,
   - filtro por categoria,
   - modal de oferta,
   - publicacion de producto,
   - perfil de subastador.
3. Probar casos de error de Supabase con mensajes claros para el usuario.

### Prioridad 8: preparacion para produccion

1. Crear `.env.example` con variables necesarias.
2. Documentar URLs de redirect para local y produccion.
3. Definir hosting objetivo.
4. Revisar reglas de seguridad de Supabase antes de publicar.
5. Configurar dominio y OAuth final.

## Comandos utiles

```bash
npm start
```

Si el puerto 5500 esta ocupado:

```powershell
$env:PORT=5501; npm start
```

Validar JavaScript:

```bash
node --check assets/js/supabaseClient.js
node --check assets/js/auth.js
node --check assets/js/main.js
node --check assets/js/perfil.js
node --check assets/js/subir-producto.js
node --check server.js
```
