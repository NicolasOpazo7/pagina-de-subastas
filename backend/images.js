const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');
const { directory } = require('./database');
const { fail } = require('./security');
const uploads = path.join(directory, 'uploads');
fs.mkdirSync(uploads, { recursive: true });

function decodeImage(input) {
  if (!input || typeof input.data !== 'string' || input.data.length > 7 * 1024 * 1024)
    fail(400, 'Cada imagen debe pesar hasta 5 MB.');
  const match = input.data.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) fail(400, 'Solo se permiten imagenes JPG o PNG.');
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 5 * 1024 * 1024) fail(400, 'Cada imagen debe pesar hasta 5 MB.');
  let image;
  try {
    if (match[1] === 'png') {
      if (buffer.length < 24 || buffer.readUInt32BE(16) * buffer.readUInt32BE(20) > 12000000)
        fail(400, 'La imagen supera 12 megapixeles.');
      image = PNG.sync.read(buffer, { checkCRC: true });
    } else
      image = jpeg.decode(buffer, {
        useTArray: true,
        maxResolutionInMP: 12,
        maxMemoryUsageInMB: 128,
      });
  } catch {
    fail(400, 'La imagen no es valida o supera 12 megapixeles.');
  }
  if (!image.width || !image.height || image.width * image.height > 12000000)
    fail(400, 'Imagen demasiado grande.');
  // Re-encode pixels so uploaded metadata and trailing content are discarded.
  const encoded = match[1] === 'png' ? PNG.sync.write(image) : jpeg.encode(image, 85).data;
  return { filename: `${randomUUID()}.${match[1] === 'png' ? 'png' : 'jpg'}`, buffer: encoded };
}
function prepareImages(input, existing = []) {
  if (!Array.isArray(input) || input.length > 10) fail(400, 'Sube hasta 10 imagenes.');
  return input.map((image) => {
    if (image.id) {
      const found = existing.find((item) => item.id === image.id);
      if (!found) fail(400, 'Imagen no disponible.');
      return found;
    }
    const decoded = decodeImage(image);
    return { id: randomUUID(), image_url: `/uploads/${decoded.filename}`, file: decoded };
  });
}
function writeImages(images) {
  const written = [];
  try {
    for (const image of images)
      if (image.file) {
        const target = path.join(uploads, image.file.filename);
        fs.writeFileSync(target, image.file.buffer, { flag: 'wx' });
        written.push(target);
      }
  } catch (error) {
    for (const target of written) fs.unlinkSync(target);
    throw error;
  }
}
function removeImage(image) {
  if (!/^\/uploads\/[0-9a-f-]+\.(png|jpg)$/.test(image.image_url)) return;
  const target = path.join(uploads, path.basename(image.image_url));
  if (fs.existsSync(target)) fs.unlinkSync(target);
}
module.exports = { uploads, prepareImages, writeImages, removeImage };
