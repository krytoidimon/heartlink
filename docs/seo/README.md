# SEO-оптимизация HeartLink

Тема: основы SEO — метатеги, структура заголовков, sitemap, robots.txt, оптимизация скорости.

## Что сделано

| Что | Где | Результат |
|---|---|---|
| Метатеги | `public/index.html` | `title` (до 60 символов), `description` (50–160), `robots`, `canonical`, `theme-color`, Open Graph и Twitter Card, JSON-LD (schema.org `WebApplication`) |
| Структура заголовков | `public/index.html`, `public/app.js` | один `<h1>`, дальше `h2` → `h3` без пропусков уровней; логотип стал ссылкой `<a href="/">`; добавлен блок «Как работает HeartLink» с текстом для поисковиков |
| robots.txt | `public/robots.txt` | закрыты `/api/` и `/health`, указан адрес sitemap |
| sitemap.xml | `public/sitemap.xml` | карта сайта с главной страницей (`loc`, `lastmod`, `changefreq`, `priority`) |
| Адрес сайта | `server.js` | `{{SITE_URL}}` подставляется на лету из переменной `SITE_URL` (или из заголовка `Host`) |
| Закрытие API от индексации | `server.js` | заголовок `X-Robots-Tag: noindex, nofollow` в JSON-ответах |
| Сжатие | `server.js` | Brotli / gzip для HTML, CSS, JS, SVG, TXT, XML |
| Кэширование | `server.js` | `ETag` + ответ `304 Not Modified`; CSS/JS/картинки — `max-age=3600`; HTML — `no-cache` |
| Загрузка скриптов | `public/index.html` | `<script defer>` в `<head>` — не блокирует отрисовку |
| Иконки | `public/favicon.svg`, `public/og-image.png` | нет 404 на favicon, есть картинка для превью ссылки |

## Замеры (curl, передано по сети)

| Файл | До, Б | После (gzip), Б | После (Brotli), Б |
|---|---:|---:|---:|
| `/` (index.html) | 3505 | 2453 | 1815 |
| `/style.css` | 3645 | 1254 | 1022 |
| `/app.js` | 5953 | 2361 | 1953 |
| **Итого** | **13103** | **6068** | **4790** |

HTML вырос с 3505 до 6822 байт (добавлены метатеги и текстовый блок), но по сети передаётся
на ~63 % меньше. При повторном визите CSS/JS берутся из кэша браузера, HTML — ответом 304 без тела.

## Как проверить

```bash
npm test                        # 24 теста, из них 9 — про SEO (tests/seo.test.js)
SITE_URL=http://localhost:3000 npm start
```

- http://localhost:3000/robots.txt и http://localhost:3000/sitemap.xml
- Lighthouse: Chrome → F12 → вкладка **Lighthouse** → категории *SEO*, *Performance* → **Analyze page load**.
  Скриншоты сохраните как `docs/seo/before.png` (на исходной версии проекта) и `docs/seo/after.png` (после правок).
