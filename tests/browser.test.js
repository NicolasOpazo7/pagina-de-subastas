const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const { chromium } = require('playwright');
const { expect } = require('@playwright/test');
const { PNG } = require('pngjs');
process.env.PORT = '5619';
process.env.AURUM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aurum-browser-'));
const server = require('../server');
const base = 'http://localhost:5619';
const errors = [];
async function register(email, role) {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      first_name: 'Prueba',
      last_name: 'Navegador',
      email,
      role,
      password: 'Testing123!',
      confirm_password: 'Testing123!',
      accept_terms: true,
    }),
  });
  assert.equal(response.status, 201);
}
async function login(page, email) {
  await page.goto(`${base}/#/login`);
  await page.locator('[name=email]').fill(email);
  await page.locator('[name=password]').fill('Testing123!');
  await page.getByRole('button', { name: 'Iniciar sesion', exact: true }).click();
  await page.waitForURL('**/#/dashboard');
  try {
    await page
      .getByRole('heading', { name: 'Mis subastas' })
      .or(page.getByRole('heading', { name: 'Mis pujas' }))
      .waitFor({ timeout: 10000 });
  } catch (error) {
    console.error(await page.locator('body').innerText());
    console.error(errors);
    throw error;
  }
}
async function main() {
  let browser;
  try {
    await register('seller@browser.test', 'subastador');
    await register('client@browser.test', 'usuario');
    browser = await chromium.launch({
      channel: process.env.BROWSER_CHANNEL || 'msedge',
      headless: true,
    });
    const sellerContext = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const seller = await sellerContext.newPage();
    seller.on('pageerror', (error) => errors.push(error.message));
    await login(seller, 'seller@browser.test');
    await seller.getByRole('link', { name: 'Crear subasta', exact: true }).click();
    await seller.locator('[name=title]').fill('Lote de prueba navegador');
    await seller
      .locator('textarea[name=description]')
      .fill('Producto de prueba para validar el flujo de publicacion.');
    await seller.locator('[name=category]').selectOption('hogar');
    await seller.locator('[name=location]').fill('Santiago');
    await seller.locator('[name=starting_price]').fill('10000');
    await seller.locator('[name=minimum_increment]').fill('1000');
    const ending = new Date(Date.now() + 3600000);
    ending.setMinutes(ending.getMinutes() - ending.getTimezoneOffset());
    await seller.locator('[name=ends_at]').fill(ending.toISOString().slice(0, 16));
    await seller.locator('[name=delivery_terms]').fill('Retiro coordinado entre las partes.');
    const png = new PNG({ width: 8, height: 8 });
    png.data.fill(180);
    const buffer = PNG.sync.write(png);
    await seller.locator('#auction-images').setInputFiles([
      { name: 'foto-uno.png', mimeType: 'image/png', buffer },
      { name: 'foto-dos.png', mimeType: 'image/png', buffer },
    ]);
    await seller.locator('.image-tile').nth(1).waitFor();
    await seller.getByRole('button', { name: 'Vista previa', exact: true }).click();
    await seller.getByRole('heading', { name: 'Vista previa', exact: true }).waitFor();
    await seller.getByRole('button', { name: 'Cerrar vista previa', exact: true }).click();
    await seller.getByRole('button', { name: 'Publicar subasta', exact: true }).click();
    await seller.waitForURL('**/#/dashboard?tab=auctions');
    await seller.getByRole('link', { name: 'Lote de prueba navegador', exact: true }).waitFor();
    await seller.getByRole('button', { name: 'Editar', exact: true }).click();
    await seller.getByRole('heading', { name: 'Editar publicacion', exact: true }).waitFor();
    await seller.getByRole('button', { name: 'Vista previa', exact: true }).click();
    await seller.getByRole('button', { name: 'Cerrar vista previa', exact: true }).click();
    await seller.getByRole('link', { name: 'Cancelar', exact: true }).click();
    await expect(seller.locator('#modal')).not.toBeVisible();
    const clientContext = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const client = await clientContext.newPage();
    client.on('pageerror', (error) => errors.push(error.message));
    await login(client, 'client@browser.test');
    await client.goto(`${base}/#/explore`);
    await client.locator('[name=category]').selectOption('tecnologia');
    await client.getByText('Ninguna subasta coincide con tu busqueda.').waitFor();
    await client.locator('[name=category]').selectOption('hogar');
    await client.getByRole('link', { name: 'Ver subasta', exact: true }).click();
    await client.getByRole('heading', { name: 'Lote de prueba navegador', exact: true }).waitFor();
    await client.getByRole('button', { name: 'Realizar puja', exact: true }).click();
    await client.locator('[name=amount]').fill('11000');
    await client.getByRole('button', { name: 'Confirmar puja', exact: true }).click();
    await client.locator('#detail-price').filter({ hasText: '11.000' }).waitFor();
    await seller.getByRole('link', { name: 'Mis subastas', exact: true }).click();
    await seller.getByRole('link', { name: 'Lote de prueba navegador', exact: true }).waitFor();
    await expect(seller.getByRole('button', { name: 'Editar', exact: true })).toBeDisabled();
    const database = require('../backend/database').database;
    const product = database
      .prepare('SELECT id FROM products WHERE title=?')
      .get('Lote de prueba navegador');
    database
      .prepare('UPDATE products SET ends_at=? WHERE id=?')
      .run(new Date(Date.now() - 1000).toISOString(), product.id);
    require('../backend/database').closeExpiredAuctions();
    require('../backend/database').events.emit('changed');
    await client.goto(`${base}/#/dashboard?tab=deals`);
    await client.getByRole('button', { name: 'Abrir acuerdo', exact: true }).click();
    await client.getByLabel('Mensaje', { exact: true }).fill('Mensaje de coordinacion de prueba');
    await client.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
    await client.getByText('Mensaje de coordinacion de prueba', { exact: true }).waitFor();
    await seller.goto(`${base}/#/dashboard?tab=deals`);
    await seller.getByRole('button', { name: 'Abrir acuerdo', exact: true }).click();
    await seller.getByText('Mensaje de coordinacion de prueba', { exact: true }).waitFor();
    await client.getByRole('button', { name: 'Cerrar ventana' }).click();
    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const mobilePage = await mobile.newPage();
    mobilePage.on('pageerror', (error) => errors.push(error.message));
    await mobilePage.goto(`${base}/#/explore`);
    await mobilePage.getByRole('heading', { name: 'Explorar subastas', exact: true }).waitFor();
    await mobilePage.getByRole('button', { name: 'Abrir menu', exact: true }).click();
    await mobilePage.getByRole('link', { name: 'Inicio', exact: true }).waitFor();
    const dimensions = await mobilePage.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      viewport: innerWidth,
    }));
    assert(
      dimensions.page <= dimensions.viewport,
      'La interfaz movil no debe tener scroll horizontal.',
    );
    fs.mkdirSync(path.join(__dirname, '../docs/screenshots'), { recursive: true });
    await mobilePage.screenshot({
      path: path.join(__dirname, '../docs/screenshots/mobile.png'),
      fullPage: true,
    });
    await client.goto(`${base}/#/dashboard`);
    await client.getByRole('heading', { name: 'Mis pujas' }).waitFor();
    await client.screenshot({
      path: path.join(__dirname, '../docs/screenshots/dashboard.png'),
      fullPage: true,
    });
    assert.deepEqual(errors, [], 'No deben existir errores de JavaScript en navegador.');
    console.log(
      'E2E OK: publicacion con dos imagenes, filtro, puja, bloqueo de edicion, acuerdo/chat en dos sesiones y menu movil sin desbordamiento.',
    );
  } finally {
    if (browser) await browser.close();
    await server.shutdown();
    require('../backend/database').database.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
