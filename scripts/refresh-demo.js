// Only the explicitly separated demonstration database is adjusted here.
const path = require('node:path');
process.env.AURUM_DATA_DIR = path.resolve(__dirname, '../data-demo');
const { database } = require('../backend/database');
const { prepareImages, writeImages } = require('../backend/images');
async function update() {
  for (const [previous, next] of [
    ['Collar con zafiro (Demo)', 'Collar de perlas (Demo)'],
    ['Camara mirrorless (Demo)', 'Camara Canon (Demo)'],
    ['Guitarra de estudio (Demo)', 'Instrumentos de estudio (Demo)'],
  ])
    database.prepare('UPDATE products SET title=? WHERE title=?').run(next, previous);
  const response = await fetch(
    'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?auto=format&fit=crop&w=900&q=80',
    { signal: AbortSignal.timeout(20000) },
  );
  if (!response.ok) throw new Error('No se pudo obtener la imagen demo del notebook.');
  const bytes = Buffer.from(await response.arrayBuffer());
  const image = prepareImages([
    {
      data: `data:${response.headers.get('content-type').split(';')[0]};base64,${bytes.toString('base64')}`,
    },
  ])[0];
  writeImages([image]);
  database
    .prepare(
      "UPDATE product_images SET image_url=? WHERE product_id IN (SELECT id FROM products WHERE category='tecnologia' AND title LIKE '%(Demo)')",
    )
    .run(image.image_url);
  console.log('Imagenes demo coherentes con sus productos.');
}
update()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => database.close());
