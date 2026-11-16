'use strict';
/**
 * HeartLink — учебный бэкенд сайта знакомств (Node.js, без внешних зависимостей).
 *  - регистрация (только 18+) и вход по токену;
 *  - анкеты других пользователей, лайки и пропуски;
 *  - взаимный лайк = пара (match);
 *  - раздача фронтенда из папки public/.
 * Данные хранятся в памяти процесса — для учебной демонстрации Docker и CI/CD.
 * В реальном проекте замените хранилище на БД.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

// --- SEO и скорость ---
// В этих файлах {{SITE_URL}} подставляется на лету: canonical, Open Graph, robots.txt, sitemap.xml
const TEMPLATED = new Set(['.html', '.txt', '.xml']);
// Текстовые файлы сжимаются (Brotli / gzip), картинки уже сжаты
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.svg', '.txt', '.xml']);
const ASSET_CACHE = 'public, max-age=3600'; // CSS/JS/картинки: браузер кэширует на 1 час
const compressedCache = new Map(); // `${etag}:${encoding}` -> Buffer

function compress(data, etag, encoding) {
  const key = `${etag}:${encoding}`;
  if (!compressedCache.has(key)) {
    if (compressedCache.size > 200) compressedCache.clear();
    compressedCache.set(
      key,
      encoding === 'br'
        ? zlib.brotliCompressSync(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } })
        : zlib.gzipSync(data, { level: 9 }),
    );
  }
  return compressedCache.get(key);
}

// Адрес сайта: переменная SITE_URL (рекомендуется на проде) или заголовок Host запроса
function siteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, '');
  const host = /^[a-z0-9.-]+(:\d+)?$/i.test(req.headers.host || '') ? req.headers.host : 'localhost';
  const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  return `${proto}://${host}`;
}
const MIN_AGE = 18;
const MAX_AGE = 99;
const GENDERS = ['male', 'female', 'other'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// --- пароли: scrypt + соль (встроенный crypto, ничего ставить не нужно) ---
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Данные, которые видят другие пользователи (без email и пароля)
const publicProfile = (u) => ({
  id: u.id,
  name: u.name,
  age: u.age,
  gender: u.gender,
  city: u.city,
  bio: u.bio,
});

const ownProfile = (u) => ({ ...publicProfile(u), email: u.email });

// Возвращает текст ошибки или null
function validateRegistration(d) {
  if (d === null || typeof d !== 'object' || Array.isArray(d)) {
    return 'Тело запроса должно быть JSON-объектом';
  }
  if (typeof d.name !== 'string' || !d.name.trim() || d.name.trim().length > 50) {
    return 'Имя обязательно (до 50 символов)';
  }
  if (typeof d.email !== 'string' || !EMAIL_RE.test(d.email.trim())) {
    return 'Некорректный email';
  }
  if (typeof d.password !== 'string' || d.password.length < 8) {
    return 'Пароль должен содержать не менее 8 символов';
  }
  if (!Number.isInteger(d.age) || d.age > MAX_AGE) {
    return 'Укажите возраст числом';
  }
  if (d.age < MIN_AGE) {
    return `Регистрация доступна только с ${MIN_AGE} лет`;
  }
  if (!GENDERS.includes(d.gender)) {
    return `Пол должен быть одним из: ${GENDERS.join(', ')}`;
  }
  if (d.city !== undefined && (typeof d.city !== 'string' || d.city.length > 60)) {
    return 'Город — строка до 60 символов';
  }
  if (d.bio !== undefined && (typeof d.bio !== 'string' || d.bio.length > 500)) {
    return 'О себе — строка до 500 символов';
  }
  return null;
}

function createServer({ seedDemo = false } = {}) {
  const users = new Map(); // id -> user
  const emailIndex = new Map(); // email -> id
  const sessions = new Map(); // token -> id
  let nextId = 1;

  function addUser(d) {
    const user = {
      id: nextId++,
      name: d.name.trim(),
      email: d.email.trim().toLowerCase(),
      passwordHash: hashPassword(d.password),
      age: d.age,
      gender: d.gender,
      city: (d.city || '').trim(),
      bio: (d.bio || '').trim(),
      likes: new Set(),
      passes: new Set(),
    };
    users.set(user.id, user);
    emailIndex.set(user.email, user.id);
    return user;
  }

  function login(user) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, user.id);
    return token;
  }

  if (seedDemo) {
    const demo = [
      ['Анна', 'female', 25, 'Новосибирск', 'Люблю путешествия и кофе'],
      ['Мария', 'female', 28, 'Москва', 'Фотографирую и катаюсь на велосипеде'],
      ['Дмитрий', 'male', 27, 'Новосибирск', 'Играю на гитаре, ищу компанию для походов'],
      ['Алексей', 'male', 30, 'Санкт-Петербург', 'Программист, люблю настолки'],
      ['Ольга', 'female', 24, 'Казань', 'Учусь, рисую, обожаю котов'],
    ];
    demo.forEach(([name, gender, age, city, bio], i) =>
      addUser({ name, gender, age, city, bio, email: `demo${i + 1}@example.com`, password: 'demo12345' }),
    );
  }

  // --- вспомогательные функции HTTP ---
  function send(res, status, body) {
    if (body === undefined) {
      res.writeHead(status);
      return res.end();
    }
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow', // API и служебные ответы не должны попадать в поиск
    });
    res.end(payload);
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > 1e6) {
          reject(new Error('too large'));
          req.destroy();
        }
      });
      req.on('end', () => {
        try {
          resolve(raw ? JSON.parse(raw) : null);
        } catch {
          reject(new Error('invalid json'));
        }
      });
      req.on('error', reject);
    });
  }

  function authUser(req) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const id = sessions.get(token);
    return id ? users.get(id) : null;
  }

  const isMatch = (a, b) => a.likes.has(b.id) && b.likes.has(a.id);

  function serveStatic(req, pathname, res) {
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
    const file = path.resolve(PUBLIC_DIR, rel);
    // защита от выхода за пределы public/ (../)
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, { error: 'Не найдено' });
    fs.readFile(file, (err, raw) => {
      if (err) return send(res, 404, { error: 'Не найдено' });
      const ext = path.extname(file);
      let data = raw;
      if (TEMPLATED.has(ext)) {
        data = Buffer.from(raw.toString('utf8').replaceAll('{{SITE_URL}}', siteUrl(req)));
      }
      const etag = `"${crypto.createHash('sha1').update(data).digest('base64url')}"`;
      const headers = {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        ETag: etag,
        // HTML всегда проверяется заново (через ETag), остальное кэшируется
        'Cache-Control': ext === '.html' ? 'no-cache' : ASSET_CACHE,
        Vary: 'Accept-Encoding',
      };
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, headers);
        return res.end();
      }
      let body = data;
      if (COMPRESSIBLE.has(ext) && data.length >= 256) {
        const accept = req.headers['accept-encoding'] || '';
        const encoding = /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null;
        if (encoding) {
          body = compress(data, etag, encoding);
          headers['Content-Encoding'] = encoding;
        }
      }
      headers['Content-Length'] = body.length;
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : body);
    });
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;
    const method = req.method;

    try {
      if (pathname === '/health' && method === 'GET') return send(res, 200, { status: 'ok' });

      if (!pathname.startsWith('/api/')) {
        if (method !== 'GET' && method !== 'HEAD') return send(res, 405, { error: 'Метод не поддерживается' });
        return serveStatic(req, pathname, res);
      }

      // ----- открытые маршруты -----
      if (pathname === '/api/register' && method === 'POST') {
        const data = await readJson(req);
        const error = validateRegistration(data);
        if (error) return send(res, 400, { error });
        if (emailIndex.has(data.email.trim().toLowerCase())) {
          return send(res, 409, { error: 'Пользователь с таким email уже существует' });
        }
        const user = addUser(data);
        return send(res, 201, { token: login(user), user: ownProfile(user) });
      }

      if (pathname === '/api/login' && method === 'POST') {
        const data = await readJson(req);
        const user =
          data && typeof data.email === 'string' && typeof data.password === 'string'
            ? users.get(emailIndex.get(data.email.trim().toLowerCase()))
            : null;
        if (!user || !verifyPassword(data.password, user.passwordHash)) {
          return send(res, 401, { error: 'Неверный email или пароль' });
        }
        return send(res, 200, { token: login(user), user: ownProfile(user) });
      }

      // ----- маршруты только для авторизованных -----
      const me = authUser(req);
      if (!me) return send(res, 401, { error: 'Требуется авторизация' });

      if (pathname === '/api/me' && method === 'GET') return send(res, 200, ownProfile(me));

      if (pathname === '/api/profiles' && method === 'GET') {
        const city = (url.searchParams.get('city') || '').trim().toLowerCase();
        const gender = url.searchParams.get('gender');
        const list = [...users.values()].filter(
          (u) =>
            u.id !== me.id &&
            !me.likes.has(u.id) &&
            !me.passes.has(u.id) &&
            (!city || u.city.toLowerCase() === city) &&
            (!gender || u.gender === gender),
        );
        return send(res, 200, list.map(publicProfile));
      }

      if (pathname === '/api/matches' && method === 'GET') {
        const list = [...users.values()].filter((u) => u.id !== me.id && isMatch(me, u));
        return send(res, 200, list.map(publicProfile));
      }

      const action = pathname.match(/^\/api\/(likes|passes)\/(\d+)$/);
      if (action && method === 'POST') {
        const target = users.get(Number(action[2]));
        if (!target) return send(res, 404, { error: 'Пользователь не найден' });
        if (target.id === me.id) return send(res, 400, { error: 'Нельзя оценить свою анкету' });

        if (action[1] === 'passes') {
          me.likes.delete(target.id);
          me.passes.add(target.id);
          return send(res, 200, { passed: true });
        }
        me.passes.delete(target.id);
        me.likes.add(target.id);
        return send(res, 200, { liked: true, match: isMatch(me, target), profile: publicProfile(target) });
      }

      return send(res, 404, { error: 'Маршрут не найден' });
    } catch (err) {
      if (err.message === 'invalid json') return send(res, 400, { error: 'Некорректный JSON' });
      return send(res, 500, { error: 'Внутренняя ошибка сервера' });
    }
  });
}

module.exports = { createServer };

// Запуск, только если файл вызван напрямую: node server.js
if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const seedDemo = process.env.SEED_DEMO === 'true';
  createServer({ seedDemo }).listen(port, () =>
    console.log(`HeartLink listening on port ${port}${seedDemo ? ' (demo data)' : ''}`),
  );
}
