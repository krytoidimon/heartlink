'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { createServer } = require('../server');

let server;
let base;

beforeEach(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

// fetch сам распаковывает gzip/br, поэтому для проверки сжатия читаем «сырые» байты через http
const rawGet = (path, headers = {}) =>
  new Promise((resolve, reject) => {
    require('node:http')
      .get(base + path, { headers }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ res, body: Buffer.concat(chunks) }));
      })
      .on('error', reject);
  });

test('главная страница: title, description, canonical, Open Graph', async () => {
  const html = await (await fetch(base + '/')).text();
  assert.match(html, /<title>[^<]{10,60}<\/title>/);
  assert.match(html, /<meta name="description" content="[^"]{50,160}">/);
  assert.match(html, /<meta name="robots" content="index, follow">/);
  assert.ok(html.includes(`<link rel="canonical" href="${base}/">`), 'canonical с адресом сайта');
  assert.ok(html.includes('property="og:title"') && html.includes('property="og:image"'));
  assert.ok(!html.includes('{{SITE_URL}}'), 'шаблон адреса должен быть подставлен');
});

test('структура заголовков: ровно один h1, нет пропусков уровней', async () => {
  const html = await (await fetch(base + '/')).text();
  const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
  assert.equal(levels.filter((l) => l === 1).length, 1, 'на странице один <h1>');
  assert.equal(levels[0], 1, 'первый заголовок — h1');
  levels.reduce((prev, cur) => {
    assert.ok(cur <= prev + 1, `пропущен уровень заголовка: h${prev} -> h${cur}`);
    return Math.max(prev, cur);
  }, 1);
});

test('JSON-LD на странице — корректный JSON', async () => {
  const html = await (await fetch(base + '/')).text();
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(m, 'блок JSON-LD найден');
  const data = JSON.parse(m[1].replaceAll('{{SITE_URL}}', base));
  assert.equal(data['@type'], 'WebApplication');
});

test('robots.txt закрывает /api/ и указывает на sitemap', async () => {
  const res = await fetch(base + '/robots.txt');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/plain/);
  const text = await res.text();
  assert.match(text, /^User-agent: \*/m);
  assert.match(text, /^Disallow: \/api\//m);
  assert.ok(text.includes(`Sitemap: ${base}/sitemap.xml`));
});

test('sitemap.xml: валидный urlset с главной страницей', async () => {
  const res = await fetch(base + '/sitemap.xml');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /xml/);
  const xml = await res.text();
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.ok(xml.includes(`<loc>${base}/</loc>`));
});

test('ответы API помечены X-Robots-Tag: noindex', async () => {
  const res = await fetch(base + '/health');
  assert.match(res.headers.get('x-robots-tag'), /noindex/);
});

test('сжатие: gzip и Brotli уменьшают размер, содержимое совпадает', async () => {
  const plain = (await rawGet('/app.js')).body;
  const gz = await rawGet('/app.js', { 'Accept-Encoding': 'gzip' });
  assert.equal(gz.res.headers['content-encoding'], 'gzip');
  assert.ok(gz.body.length < plain.length / 2);
  assert.deepEqual(zlib.gunzipSync(gz.body), plain);

  const br = await rawGet('/app.js', { 'Accept-Encoding': 'br, gzip' });
  assert.equal(br.res.headers['content-encoding'], 'br');
  assert.ok(br.body.length <= gz.body.length);
  assert.deepEqual(zlib.brotliDecompressSync(br.body), plain);
});

test('кэширование: ETag и ответ 304; у CSS есть max-age, у HTML — no-cache', async () => {
  const css = await fetch(base + '/style.css');
  assert.match(css.headers.get('cache-control'), /max-age=\d+/);
  const etag = css.headers.get('etag');
  assert.ok(etag);
  const again = await fetch(base + '/style.css', { headers: { 'If-None-Match': etag } });
  assert.equal(again.status, 304);
  const html = await fetch(base + '/');
  assert.equal(html.headers.get('cache-control'), 'no-cache');
});

test('favicon и OG-картинка отдаются (нет 404 в консоли браузера)', async () => {
  for (const p of ['/favicon.svg', '/og-image.png']) {
    const res = await fetch(base + p);
    assert.equal(res.status, 200, p);
  }
});
