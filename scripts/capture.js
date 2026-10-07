const { chromium } = require('playwright');
const fs = require('node:fs');
async function capture() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    const target = process.env.CAPTURE_URL || 'http://localhost:5503/';
    fs.mkdirSync('docs/screenshots', { recursive: true });
    for (const [label, viewport] of [
      ['desktop', { width: 1440, height: 950 }],
      ['mobile', { width: 390, height: 844 }],
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(target);
      await page.getByRole('heading', { name: 'En subasta ahora', exact: true }).waitFor();
      await page.locator('.card-media img').first().waitFor();
      await page.locator('.auction-card').last().scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll('.card-media img')).every(
          (image) => image.complete && image.naturalWidth > 0,
        ),
      );
      const width = await page.evaluate(() => ({
        viewport: innerWidth,
        page: document.documentElement.scrollWidth,
      }));
      if (width.page > width.viewport) throw new Error(`Desbordamiento ${label}`);
      await page.screenshot({ path: `docs/screenshots/home-${label}.png`, fullPage: false });
    }
    console.log('Capturas desktop/mobile guardadas.');
  } finally {
    await browser.close();
  }
}
capture().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
