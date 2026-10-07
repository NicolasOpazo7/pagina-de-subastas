const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aurum-api-'));
  process.env.PORT = '5618';
  process.env.AURUM_DATA_DIR = directory;
  process.env.AURUM_BACKEND = 'local';
  const server = require('../server');
  const request = async (route, method = 'GET', data, cookie) => {
    const response = await fetch(`http://localhost:5618${route}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    return {
      status: response.status,
      cookie: response.headers.get('set-cookie')?.split(';')[0],
      body: await response.json(),
    };
  };
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) {
      try {
        ready = (await request('/api/health')).status === 200;
      } catch {}
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert(ready, 'Servidor local disponible');
    const registration = (email, role) => ({
      first_name: 'Persona',
      last_name: 'Prueba',
      email,
      password: 'Testing123!',
      confirm_password: 'Testing123!',
      accept_terms: true,
      role,
    });
    const seller = await request(
      '/api/auth/register',
      'POST',
      registration('seller@example.com', 'subastador'),
    );
    assert.equal(seller.status, 201);
    const client = await request(
      '/api/auth/register',
      'POST',
      registration('client@example.com', 'usuario'),
    );
    assert.equal(client.status, 201);
    assert.equal(
      (await request('/api/auth/register', 'POST', registration('admin@example.com', 'admin')))
        .status,
      400,
    );
    assert.equal(
      (
        await request(
          '/api/auth/register',
          'POST',
          registration('seller@example.com', 'subastador'),
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await request('/api/auth/login', 'POST', {
          email: 'client@example.com',
          password: 'Incorrecta123',
        })
      ).status,
      401,
    );
    const { PNG } = require('pngjs');
    const sample = new PNG({ width: 2, height: 2 });
    sample.data.fill(255);
    const photo = { data: `data:image/png;base64,${PNG.sync.write(sample).toString('base64')}` };
    const auctionInput = {
      title: 'Producto de prueba',
      description: 'Descripcion de prueba',
      category: 'hogar',
      starting_price: 10000,
      ends_at: new Date(Date.now() + 60000).toISOString(),
      images: [photo],
      location: 'Santiago',
      delivery_terms: 'Retiro coordinado',
    };
    const auction = await request('/api/auctions', 'POST', auctionInput, seller.cookie);
    assert.equal(auction.status, 201);
    const disposable = await request('/api/auctions', 'POST', auctionInput, seller.cookie);
    const imagePath = disposable.body.data.product_images[0].image_url;
    assert.equal(
      (
        await request(
          `/api/auctions/${disposable.body.data.id}`,
          'PATCH',
          { title: 'Producto editado sin pujas' },
          seller.cookie,
        )
      ).status,
      200,
    );
    assert.equal(
      (await request(`/api/auctions/${disposable.body.data.id}`, 'DELETE', {}, seller.cookie))
        .status,
      200,
    );
    assert.equal(fs.existsSync(path.join(directory, imagePath.slice(1))), false);
    const route = `/api/auctions/${auction.body.data.id}/bids`;
    assert.equal(
      (await request(route, 'POST', { amount: 11000, idempotency_key: 'sin-sesion-1' })).status,
      401,
    );
    assert.equal(
      (
        await request(
          route,
          'POST',
          { amount: 11000, idempotency_key: 'seller-bid-1' },
          seller.cookie,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          route,
          'POST',
          { amount: 10001, idempotency_key: 'invalid-bid-1' },
          client.cookie,
        )
      ).status,
      409,
    );
    const bid = { amount: 11000, idempotency_key: 'valid-bid-1' };
    assert.equal((await request(route, 'POST', bid, client.cookie)).status, 201);
    assert.equal((await request(route, 'POST', bid, client.cookie)).status, 201);
    assert.equal((await request(route)).body.data.length, 1);
    const concurrent = await Promise.all(
      ['concurrent-1', 'concurrent-2'].map((idempotency_key) =>
        request(route, 'POST', { amount: 12000, idempotency_key }, client.cookie),
      ),
    );
    assert.deepEqual(concurrent.map((result) => result.status).sort(), [201, 409]);
    assert.equal((await request('/api/auctions?min=12000')).body.data.total, 1);
    assert.equal((await request('/api/auctions?min=13000')).body.data.total, 0);
    const productId = auction.body.data.id;
    assert.equal(
      (
        await request(
          `/api/auctions/${productId}`,
          'PATCH',
          { title: 'Cambio no permitido' },
          seller.cookie,
        )
      ).status,
      409,
    );
    assert.equal(
      (await request(`/api/auctions/${productId}`, 'DELETE', {}, seller.cookie)).status,
      409,
    );
    const second = await request(
      '/api/auth/register',
      'POST',
      registration('second@example.com', 'usuario'),
    );
    assert.equal((await request('/api/auctions', 'POST', auctionInput, second.cookie)).status, 403);
    assert.equal(
      (
        await request(
          '/api/auctions',
          'POST',
          { ...auctionInput, starting_price: 1.5 },
          seller.cookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await request(
          '/api/auctions',
          'POST',
          { ...auctionInput, images: [{ data: 'data:image/png;base64,AAAA' }] },
          seller.cookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await request(
          '/api/auctions',
          'POST',
          { ...auctionInput, images: Array(11).fill(photo) },
          seller.cookie,
        )
      ).status,
      400,
    );
    await request(`/api/favorites/${productId}`, 'POST', {}, client.cookie);
    await request(`/api/favorites/${productId}`, 'POST', {}, client.cookie);
    assert.equal((await request('/api/favorites', 'GET', null, client.cookie)).body.data.length, 1);
    assert((await request('/api/notifications', 'GET', null, client.cookie)).body.data.length > 0);
    assert.equal(
      (await request('/api/users/me/bids', 'GET', null, client.cookie)).body.data.length,
      1,
    );
    const draft = await request(
      '/api/auctions',
      'POST',
      { ...auctionInput, images: [], draft: true },
      seller.cookie,
    );
    assert.equal(draft.status, 201);
    assert.equal((await request(`/api/auctions/${draft.body.data.id}`)).status, 404);
    assert.equal(
      (await request(`/api/auctions/${draft.body.data.id}/publish`, 'POST', {}, seller.cookie))
        .status,
      400,
    );
    assert.equal(
      (
        await request(
          `/api/auctions/${draft.body.data.id}`,
          'PATCH',
          { images: [photo] },
          seller.cookie,
        )
      ).status,
      200,
    );
    assert.equal(
      (await request(`/api/auctions/${draft.body.data.id}/publish`, 'POST', {}, seller.cookie))
        .status,
      200,
    );
    const database = require('../backend/database').database;
    database
      .prepare('UPDATE products SET ends_at=? WHERE id=?')
      .run(new Date(Date.now() - 1000).toISOString(), productId);
    const { closeExpiredAuctions } = require('../backend/database');
    closeExpiredAuctions();
    closeExpiredAuctions();
    assert.equal(
      database
        .prepare('SELECT count(*) AS n FROM auction_results WHERE product_id=?')
        .get(productId).n,
      1,
    );
    assert.equal(
      (
        await request(
          route,
          'POST',
          { amount: 13000, idempotency_key: 'expired-bid-1' },
          client.cookie,
        )
      ).status,
      409,
    );
    const deals = (await request('/api/deals', 'GET', null, client.cookie)).body.data;
    assert.equal(deals.length, 1);
    const dealId = deals[0].id;
    assert.equal(
      (await request(`/api/deals/${dealId}/messages`, 'GET', null, second.cookie)).status,
      404,
    );
    assert.equal(
      (
        await request(
          `/api/deals/${dealId}/messages`,
          'POST',
          { message: 'Coordinemos la entrega' },
          client.cookie,
        )
      ).status,
      201,
    );
    assert.equal(
      (await request(`/api/deals/${dealId}/messages`, 'GET', null, seller.cookie)).body.data.length,
      1,
    );
    await request(`/api/deals/${dealId}/confirm`, 'POST', {}, client.cookie);
    const completed = await request(`/api/deals/${dealId}/confirm`, 'POST', {}, seller.cookie);
    assert.equal(completed.body.data.status, 'completed');
    const reserve = await request(
      '/api/auctions',
      'POST',
      { ...auctionInput, reserve_price: 50000 },
      seller.cookie,
    );
    await request(
      `/api/auctions/${reserve.body.data.id}/bids`,
      'POST',
      { amount: 11000, idempotency_key: 'reserve-bid-1' },
      client.cookie,
    );
    database
      .prepare('UPDATE products SET ends_at=? WHERE id=?')
      .run(new Date(Date.now() - 1000).toISOString(), reserve.body.data.id);
    closeExpiredAuctions();
    assert.equal(
      database
        .prepare('SELECT winner_id FROM auction_results WHERE product_id=?')
        .get(reserve.body.data.id).winner_id,
      null,
    );
    const noBids = await request('/api/auctions', 'POST', auctionInput, seller.cookie);
    database
      .prepare('UPDATE products SET ends_at=? WHERE id=?')
      .run(new Date(Date.now() - 1000).toISOString(), noBids.body.data.id);
    closeExpiredAuctions();
    assert.equal(
      database
        .prepare('SELECT winner_id FROM auction_results WHERE product_id=?')
        .get(noBids.body.data.id).winner_id,
      null,
    );
    assert.equal((await request('/api/admin/stats', 'GET', null, client.cookie)).status, 403);
    database.prepare("UPDATE users SET role='admin' WHERE id=?").run(second.body.data.id);
    assert.equal((await request('/api/admin/stats', 'GET', null, second.cookie)).status, 200);
    assert.equal(
      (
        await request(
          `/api/admin/users/${seller.body.data.id}/status`,
          'PATCH',
          { status: 'suspended', reason: 'Prueba de moderacion' },
          second.cookie,
        )
      ).status,
      200,
    );
    assert.equal((await request('/api/auctions/mine', 'GET', null, seller.cookie)).status, 401);
    await request('/api/auth/forgot-password', 'POST', { email: 'client@example.com' });
    const resetEmail = JSON.parse(
      fs.readFileSync(path.join(directory, 'outbox', `${client.body.data.id}.json`), 'utf8'),
    );
    const token = resetEmail.reset_path.split('token=')[1];
    assert.equal(
      (
        await request('/api/auth/reset-password', 'POST', {
          token,
          password: 'Updated123!',
          confirm_password: 'Updated123!',
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request('/api/auth/reset-password', 'POST', {
          token,
          password: 'Updated123!',
          confirm_password: 'Updated123!',
        })
      ).status,
      400,
    );
    assert.equal((await request('/api/auth/me', 'GET', null, client.cookie)).body.data, null);
    const login = await request('/api/auth/login', 'POST', {
      email: 'client@example.com',
      password: 'Updated123!',
    });
    client.cookie = login.cookie;
    assert.equal(
      (await request('/api/auth/me', 'GET', null, client.cookie)).body.data.role,
      'usuario',
    );
    await request('/api/auth/logout', 'POST', {}, client.cookie);
    assert.equal((await request('/api/auth/me', 'GET', null, client.cookie)).body.data, null);
    const { DatabaseSync } = require('node:sqlite');
    const persisted = new DatabaseSync(path.join(directory, 'aurum.sqlite'));
    assert.equal(persisted.prepare('SELECT count(*) AS n FROM deals').get().n, 1);
    persisted.close();
    console.log(
      'API local OK: autenticacion, archivos, roles, borradores, pujas, concurrencia, reserva, cierre idempotente, acuerdos, chat, moderacion, recuperacion y persistencia.',
    );
  } finally {
    await server.shutdown();
    require('../backend/database').database.close();
    // Temporary database is retained for diagnostics; the OS owns its directory.
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
