'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');

let server;
let base;

// Для каждого теста — новый сервер с чистым хранилищем
beforeEach(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const call = (method, path, body, token) =>
  fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const newUser = (n, overrides = {}) => ({
  name: `Пользователь ${n}`,
  email: `user${n}@example.com`,
  password: 'password123',
  age: 25,
  gender: n % 2 ? 'male' : 'female',
  city: 'Новосибирск',
  bio: 'Привет!',
  ...overrides,
});

async function register(n, overrides) {
  const res = await call('POST', '/api/register', newUser(n, overrides));
  assert.equal(res.status, 201);
  return res.json(); // { token, user }
}

test('GET /health возвращает ok', async () => {
  const res = await call('GET', '/health');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('главная страница сайта отдаётся как HTML', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /HeartLink/);
});

test('выход за пределы public/ запрещён', async () => {
  const res = await fetch(base + '/..%2Fserver.js');
  assert.equal(res.status, 404);
});

test('регистрация возвращает токен и профиль без пароля', async () => {
  const { token, user } = await register(1);
  assert.ok(token);
  assert.equal(user.email, 'user1@example.com');
  assert.equal(user.passwordHash, undefined);
  assert.equal(user.password, undefined);
});

test('регистрация младше 18 лет запрещена', async () => {
  const res = await call('POST', '/api/register', newUser(1, { age: 17 }));
  assert.equal(res.status, 400);
});

test('регистрация с некорректным email → 400', async () => {
  const res = await call('POST', '/api/register', newUser(1, { email: 'не-почта' }));
  assert.equal(res.status, 400);
});

test('короткий пароль → 400', async () => {
  const res = await call('POST', '/api/register', newUser(1, { password: '123' }));
  assert.equal(res.status, 400);
});

test('повторная регистрация с тем же email → 409', async () => {
  await register(1);
  const res = await call('POST', '/api/register', newUser(1));
  assert.equal(res.status, 409);
});

test('вход с верным и неверным паролем', async () => {
  await register(1);
  const ok = await call('POST', '/api/login', { email: 'USER1@example.com', password: 'password123' });
  assert.equal(ok.status, 200);
  assert.ok((await ok.json()).token);
  const bad = await call('POST', '/api/login', { email: 'user1@example.com', password: 'wrong-password' });
  assert.equal(bad.status, 401);
});

test('без токена API анкет недоступно → 401', async () => {
  assert.equal((await call('GET', '/api/profiles')).status, 401);
  assert.equal((await call('GET', '/api/matches')).status, 401);
});

test('в ленте нет своей анкеты и нет чужих email', async () => {
  const a = await register(1);
  await register(2);
  const list = await (await call('GET', '/api/profiles', undefined, a.token)).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Пользователь 2');
  assert.equal(list[0].email, undefined);
});

test('фильтр по городу', async () => {
  const a = await register(1);
  await register(2, { city: 'Москва' });
  await register(3, { city: 'Новосибирск' });
  const res = await call('GET', '/api/profiles?city=' + encodeURIComponent('москва'), undefined, a.token);
  const list = await res.json();
  assert.equal(list.length, 1);
  assert.equal(list[0].city, 'Москва');
});

test('односторонний лайк не создаёт пару, взаимный — создаёт', async () => {
  const a = await register(1);
  const b = await register(2);

  const first = await (await call('POST', `/api/likes/${b.user.id}`, undefined, a.token)).json();
  assert.equal(first.match, false);
  assert.deepEqual(await (await call('GET', '/api/matches', undefined, a.token)).json(), []);

  const second = await (await call('POST', `/api/likes/${a.user.id}`, undefined, b.token)).json();
  assert.equal(second.match, true);

  const matchesA = await (await call('GET', '/api/matches', undefined, a.token)).json();
  const matchesB = await (await call('GET', '/api/matches', undefined, b.token)).json();
  assert.equal(matchesA.length, 1);
  assert.equal(matchesA[0].id, b.user.id);
  assert.equal(matchesB[0].id, a.user.id);
});

test('оценённая анкета пропадает из ленты', async () => {
  const a = await register(1);
  const b = await register(2);
  await call('POST', `/api/passes/${b.user.id}`, undefined, a.token);
  const list = await (await call('GET', '/api/profiles', undefined, a.token)).json();
  assert.equal(list.length, 0);
});

test('нельзя лайкнуть себя и несуществующего пользователя', async () => {
  const a = await register(1);
  assert.equal((await call('POST', `/api/likes/${a.user.id}`, undefined, a.token)).status, 400);
  assert.equal((await call('POST', '/api/likes/999', undefined, a.token)).status, 404);
});
