const http = require('http');
const fs = require('fs');
const path = require('path');
if (fs.existsSync(path.join(__dirname, '.env'))) process.loadEnvFile(path.join(__dirname, '.env'));
const localBackend = require('./backend/api');
const { uploads } = require('./backend/images');
if (localBackend) {
  localBackend.closeExpiredAuctions();
  setInterval(() => {
    try {
      if (localBackend.closeExpiredAuctions()) localBackend.events.emit('changed');
    } catch (error) {
      console.error('No se pudo procesar el cierre de subastas.');
    }
  }, 1000).unref();
}

const root = __dirname;
const port = Number(process.env.PORT || 5500);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.sql': 'text/plain; charset=utf-8',
};

function getFilePath(url) {
  const requestPath = decodeURIComponent(new URL(url, `http://localhost:${port}`).pathname);
  const normalizedPath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(root, normalizedPath === path.sep ? 'index.html' : normalizedPath);

  if (!filePath.startsWith(root)) {
    return path.join(root, 'index.html');
  }

  return filePath;
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob: https://images.unsplash.com; connect-src 'self' ws: wss:; font-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  );
  if (localBackend && (await localBackend.api(req, res))) return;
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const redirects = {
    '/pages/login.html': 'login',
    '/pages/registro.html': 'register',
    '/pages/perfil.html': 'dashboard',
    '/pages/subir-producto.html': 'sell',
    '/pages/producto.html': 'auction',
  };
  if (redirects[pathname]) {
    const query = new URL(req.url, 'http://localhost').search;
    res.writeHead(302, { Location: `/#/${redirects[pathname]}${query}` });
    res.end();
    return;
  }
  if (pathname === '/' || pathname === '/index.html') req.url = '/frontend/index.html';
  if (pathname === '/vendor/lucide.js') req.url = '/node_modules/lucide/dist/umd/lucide.js';
  if (pathname.startsWith('/uploads/')) {
    if (!/^\/uploads\/[0-9a-f-]+\.(png|jpg)$/.test(pathname)) {
      res.writeHead(404);
      res.end();
      return;
    }
    fs.readFile(path.join(uploads, path.basename(pathname)), (error, content) => {
      res.writeHead(error ? 404 : 200, {
        'Content-Type': pathname.endsWith('.png') ? 'image/png' : 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      });
      res.end(error ? 'Imagen no encontrada' : content);
    });
    return;
  }
  let filePath;
  try {
    filePath = getFilePath(req.url);
  } catch {
    res.writeHead(400);
    res.end('Ruta invalida');
    return;
  }
  const relative = path.relative(root, filePath);
  if (!relative.startsWith(`frontend${path.sep}`) && !(pathname === '/vendor/lucide.js')) {
    res.writeHead(404);
    res.end('Archivo no encontrado');
    return;
  }
  if (
    relative.startsWith('..') ||
    path.isAbsolute(relative) ||
    relative.split(path.sep).some((part) => part.startsWith('.')) ||
    /^(data|backend|database|tests)(\\|\/|$)/.test(relative)
  ) {
    res.writeHead(404);
    res.end('Archivo no encontrado');
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Archivo no encontrado');
      return;
    }

    const contentType =
      mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
});
const { Server } = require('socket.io');
const io = new Server(server, {
  maxHttpBufferSize: 65536,
  serveClient: true,
  allowRequest: (request, callback) => {
    const origin = request.headers.origin;
    callback(
      null,
      !origin ||
        origin === `http://${request.headers.host}` ||
        origin === `https://${request.headers.host}`,
    );
  },
});
io.on('connection', (socket) => {
  const user = localBackend.currentUser(socket.request);
  if (user) socket.join(`user:${user.id}`);
  socket.emit('sync', { server_time: new Date().toISOString() });
});
localBackend.events.on('changed', () =>
  io.emit('refresh', { server_time: new Date().toISOString() }),
);
server.shutdown = () => new Promise((resolve) => io.close(resolve));

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`El puerto ${port} ya esta en uso. Prueba con: $env:PORT=5501; npm start`);
    process.exit(1);
  }

  throw error;
});

server.listen(port, () => {
  console.log(`Aurum Subastas listo en http://localhost:${port}`);
});
module.exports = server;
