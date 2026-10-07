# Aplicacion del prompt maestro

## Arquitectura

Se conserva HTML/CSS/JavaScript porque la base existente ya utiliza estas tecnologias. La interfaz compartida vive en frontend y reutiliza componentes de tarjetas, formularios, galeria, estados, tablas, confirmaciones y paneles. Un controlador de rutas por hash mantiene compatibilidad con las URL antiguas sin necesitar un build.

El backend utiliza Node HTTP, SQLite nativo y consultas parametrizadas. No se agrega Express/Prisma/React solo por cambiar de stack. Socket.IO gestiona eventos de invalidacion y reconexion; la API vuelve a consultar el estado autorizado. Las sesiones usan cookies HttpOnly SameSite Strict y Secure en produccion. OAuth utiliza una cookie Lax independiente de corta duracion para el retorno del proveedor.

## Funcionalidades implementadas

- Diseno carbon/grafito/dorado con responsive, iconos Lucide, estados vacios, loaders, foco visible y movimiento reducido.
- Portada con imagen de una publicacion existente, estadisticas reales, productos activos, categorias con cantidades y pasos de participacion.
- Registro con nombre, apellido, correo unico, tipo de cuenta, contrasena confirmada y terminos. No permite seleccionar admin.
- Login, logout confirmado, mostrar/ocultar contrasena, sesiones y limites de intentos.
- Recuperacion local con buzon de pruebas, tokens hash de un uso y caducidad; cambio de contrasena con cierre de sesiones.
- Google OAuth con codigo de autorizacion/PKCE, cookie de estado y almacenamiento de identidad, activado mediante configuracion. Integracion externa pendiente de credenciales.
- Publicacion, borradores, programacion, edicion, eliminacion sin pujas y bloqueo de cambios cuando existen ofertas.
- Hasta diez imagenes locales JPG/PNG con validacion real, reencodificacion, limites, optimizacion en cliente, preview, reordenamiento e imagen principal. Rotacion de tarjetas cada diez segundos.
- Nombre, descripcion, categoria, marca, modelo, estado, ubicacion, caracteristicas, inicio/cierre, reserva, incremento y entrega.
- Busqueda/filtrado real en backend, ordenamiento, debounce y paginacion.
- Detalle con galeria/zoom, condiciones, contador de segundos basado en reloj del servidor e historial anonimizado.
- Pujas con permisos, incremento, montos enteros, transaccion BEGIN IMMEDIATE, plazo del servidor y clave de idempotencia.
- Socket.IO actualiza sesiones conectadas y resincroniza al reconectar. Corrige la carrera entre login y respuestas anteriores de sincronizacion.
- Cierre autonomo mientras el proceso esta activo, recuperacion al reiniciar, reserva, resultado unico y acuerdo con ganador.
- Cliente: pujas, liderazgo, ganadas/perdidas, favoritos, perfil, notificaciones y acuerdos.
- Subastador: publicaciones, estadisticas, grafico de estados, ofertas recibidas y acuerdos.
- Notificaciones persistidas: oferta aceptada, superada, nueva puja, proximo cierre, ganador, cierre y mensajes.
- Coordinacion por chat privado de participantes, confirmacion doble e incidencias reportadas. No hay cobros reales.
- Administrador: estadisticas, busqueda/roles de usuarios, suspension/reactivacion, moderacion justificada, reportes y auditoria.
- Seed de desarrollo separado, credenciales aleatorias fuera de Git, SQL automatico y documentacion de ejecucion/API.

## Integridad y privacidad

Los montos son enteros CLP. Se usan claves foraneas, indices y restricciones unicas para email, favoritos, idempotencia y resultado. Triggers bloquean cambios/eliminacion de pujas y validan categoria y montos. SQL parametrizado y autorizacion por recurso protegen las operaciones. El servidor solo publica frontend, iconos, cliente Socket.IO e imagenes; datos, backend, .env y buzon son privados.

Las imagenes se decodifican y vuelven a codificar. No se permiten SVG ejecutables ni rutas de archivos arbitrarias. Cada archivo tiene nombre UUID. La creacion y edicion descartan archivos nuevos si falla la transaccion. Las publicaciones con ofertas o reportes no pueden eliminarse desde el perfil.

## Verificacion

- Sintaxis de backend/frontend/pruebas/scripts.
- Smoke: recursos, redirecciones antiguas, rutas inexistentes y bloqueo de archivos privados.
- Integracion: cuentas, restricciones de roles, fotos falsas/exceso, borrador/publicacion, ofertas simultaneas e idempotencia, bloqueo de edicion, reserva no alcanzada, sin ofertas, cierre duplicado, chat privado, confirmacion doble, administracion, reset de un uso y datos persistentes.
- E2E Playwright: dos usuarios, publicacion con dos fotos, filtros, puja, actualizacion del vendedor, bloqueo de edicion, cierre, acuerdo/chat y menu movil sin desbordamiento. Capturas en docs/screenshots.
- Reinicio real: dos procesos de servidor sucesivos sobre la misma base recuperan el cierre sin duplicar resultados ni acuerdos.

## Dependencias externas y limites

Google necesita Client ID/Secret y un callback coincidente con APP_URL. No se ha probado contra una cuenta Google real porque no se han proporcionado esas credenciales. Referencia: https://developers.google.com/identity/openid-connect/openid-connect

El envio de correo funciona como buzon de desarrollo y cuenta con integracion SMTP; falta configurar/probar un proveedor con credenciales reales. No existen redes sociales o direccion de soporte verificadas. No se inventan esas cuentas. Los textos legales son iniciales; falta completar el operador y revisarlos antes de publicar.

No se importaron datos de Supabase, no se implementaron pagos ni las extensiones futuras de identidad/reputacion/comisiones/envios. SQLite y los limites de solicitudes en memoria estan orientados al servidor local. Argon2id y decodificacion de imagenes bloquean temporalmente el proceso; un despliegue de alto trafico requerira workers y revision de capacidad. No se declara produccion terminada.
