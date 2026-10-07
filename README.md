# Aurum Subastas

Plataforma local de subastas en espanol y pesos chilenos. Frontend HTML/CSS/JavaScript, backend Node, SQLite y Socket.IO. Ya no requiere Supabase para funcionar. Se conservaron los archivos anteriores como referencia; el servidor utiliza `frontend/`.

## Ejecutar

Requiere Node 22.8 o superior. SQLite es experimental en Node 22.8.

```sh
npm install
npm start
```

Abre http://localhost:5500. Para otro puerto en PowerShell: `$env:PORT='5502'`, seguido de `npm start`. Tambien puedes ejecutar la tarea npm start desde VS Code. No uses Live Server: la aplicacion necesita la API y las cookies del servidor Node.

La base `data/aurum.sqlite` y el directorio `data/uploads` se crean automaticamente. No se requieren comandos SQL manuales. El servidor procesa cierres al arrancar, cada segundo y antes de operaciones. Con el servidor apagado, los cierres se recuperan al reiniciarlo.

## Cuentas y administracion

El registro publico solo permite cliente o subastador. Cada cuenta accede a su panel. El administrador se crea desde una terminal privada:

```powershell
$env:ADMIN_EMAIL='tu-correo@example.com'
$env:ADMIN_PASSWORD='UnaContrasenaLarga123!'
npm run admin:create
```

Usa tu propia contrasena. El comando no imprime ni guarda la contrasena en texto plano. Despues elimina la variable de esa sesion de terminal: `Remove-Item Env:ADMIN_PASSWORD`.

## Demostracion separada

```sh
npm run seed
npm run dev:demo
```

El seed crea `data-demo/aurum.sqlite` con un administrador, tres subastadores, cinco clientes y diez publicaciones de prueba, ademas de ofertas, resultados y notificaciones. Descarga imagenes de demostracion de Unsplash y las almacena localmente. Requiere conexion solo para ese paso.

Las credenciales aleatorias estan en `data-demo/credentials.json`, excluido de Git. Todas las publicaciones se identifican como Demo. `dev:demo` utiliza solo esa base; `npm start` utiliza la base normal. El seed no sobrescribe datos ni se ejecuta en produccion.

## Configuracion

El servidor lee `.env` si existe. Las variables disponibles se describen en `.env.example`:

- `PORT`: puerto; predeterminado 5500.
- `AURUM_DATA_DIR`: directorio de persistencia.
- `NODE_ENV`: development o production. En production las cookies requieren HTTPS.
- `APP_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: OAuth opcional.

Google solo aparece si esta configurado. Registra en Google Cloud exactamente `APP_URL/api/auth/google/callback` como URI de redireccion autorizada. Es un flujo local de codigo de autorizacion con PKCE y estado de un solo uso; no usa el callback de Supabase. Las cuentas con contrasena no se vinculan automaticamente por coincidencia de correo.

La recuperacion de contrasena funciona en desarrollo: el correo de prueba se guarda en `data/outbox/<id-usuario>.json` con un enlace relativo. Abre ese enlace sobre tu URL local. Los tokens caducan en 30 minutos, son de un solo uso y su cambio invalida sesiones. El buzon nunca se sirve por HTTP. El envio SMTP esta implementado: configura `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` y `APP_URL` para utilizar tu proveedor. No se ha enviado correo real sin esas credenciales.

## Pruebas

```sh
npm run check
npm test
npm run test:local
npm run test:e2e
npm run test:restart
```

Las pruebas utilizan bases temporales. E2E utiliza Microsoft Edge instalado, dos sesiones independientes y un viewport movil. Para Chrome: define `BROWSER_CHANNEL=chrome`. Las capturas se guardan en `docs/screenshots/`.

Se comprueban registro, permisos, archivos, borradores, filtros, pujas concurrentes e idempotentes, reserva, cierre, acuerdos/chat, moderacion, recuperacion, persistencia, publicacion en navegador y diseno movil sin scroll horizontal.

## Estructura

- `frontend/`: pagina, componentes compartidos, rutas, formularios y estilos.
- `backend/`: API, SQLite, migraciones, seguridad, imagenes, Google y seed.
- `tests/`: smoke, integracion y E2E.
- `scripts/`: comprobacion de sintaxis.
- `docs/`: arquitectura, API, decisiones y capturas.
- `database/`, `pages/`, `assets/`, `index.html`: version anterior de Supabase, conservada como referencia y no servida por la aplicacion local. Las URL antiguas de pages redirigen al nuevo flujo.

## Limites antes de publicar

Esta es una aplicacion de desarrollo local, no un servicio desplegado. No procesa pagos. Ganador y vendedor coordinan la entrega y confirman el acuerdo. Google requiere credenciales propias; el correo real, contacto del operador y redes oficiales no estan configurados. Los textos legales son reglas iniciales y deben completarse antes del lanzamiento.

SQLite admite un servidor de escritura local; Argon2id y la verificacion de imagenes usan bibliotecas JavaScript. Para escalar, mueve esas tareas a workers y prepara PostgreSQL y almacenamiento externo. El rate limiting vive en memoria. Haz respaldos con SQLite Backup API o deteniendo el servidor; con WAL activo, no copies solamente el archivo principal mientras hay escrituras.

Los datos de Supabase no se han importado ni eliminado. La nueva base comienza vacia. Una importacion requerira un export autorizado de usuarios/publicaciones, remapeo de identificadores, descarga de imagenes y nuevos accesos; nunca se pueden obtener las contrasenas originales desde Supabase.

Mas detalle en `docs/plan-maestro.md` y `docs/openapi.yaml`.
