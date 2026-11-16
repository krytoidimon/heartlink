# HeartLink — сайт знакомств (Практическое занятие №15: Docker + GitHub Actions)

Учебный проект: сайт знакомств на **Node.js** (без внешних зависимостей: встроенные `node:http`,
`node:crypto`, `node:test`). Бэкенд-API и фронтенд (HTML/CSS/JS) работают в одном контейнере.
Демонстрирует контейнеризацию (Docker) и CI/CD (GitHub Actions → GHCR).

**Возможности**
- регистрация только для совершеннолетних (18+), вход по токену;
- лента анкет с фильтром по городу и полу, кнопки «пропустить» и «нравится»;
- взаимный лайк = пара, раздел «Пары»;
- пароли хранятся в виде хэша (scrypt + соль), другим пользователям email не показывается.

> Это стартовый продукт для практики. Если у вас уже есть свой проект знакомств — скопируйте в него
> `Dockerfile`, `.dockerignore`, `.gitignore` и `.github/workflows/build.yml` и адаптируйте (раздел 9).

## 1. Структура

```
.
├── .github/workflows/build.yml   # workflow: тесты → сборка → публикация в GHCR
├── public/                       # фронтенд сайта
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   ├── robots.txt, sitemap.xml   # для поисковых роботов (SEO)
│   └── favicon.svg, og-image.png
├── tests/api.test.js             # тесты API и SEO (node:test), 24 штуки
├── server.js                     # сервер: API + раздача public/
├── package.json                  # скрипты start / start:demo / test
├── package-lock.json             # нужен для npm ci
├── Dockerfile                    # инструкция сборки образа
├── .dockerignore                 # что не попадает в образ
└── .gitignore                    # что не попадает в Git
```

## 2. API

| Метод | URL | Доступ | Описание |
|---|---|---|---|
| GET  | `/health` | все | проверка работы |
| POST | `/api/register` | все | регистрация: `name, email, password (≥8), age (18–99), gender (male/female/other), city, bio` |
| POST | `/api/login` | все | вход: `email, password` → `{ token, user }` |
| GET  | `/api/me` | токен | свой профиль |
| GET  | `/api/profiles?city=&gender=` | токен | анкеты, которые ещё не оценены |
| POST | `/api/likes/<id>` | токен | лайк; в ответе `match: true`, если симпатия взаимная |
| POST | `/api/passes/<id>` | токен | пропустить анкету |
| GET  | `/api/matches` | токен | список пар |

Токен передаётся в заголовке `Authorization: Bearer <token>`.

## 3. Локальный запуск и тесты (без Docker)

Нужен Node.js 20+ (`node --version`).

```bash
npm ci               # установка зависимостей по package-lock.json
npm test             # все 24 теста должны пройти
npm start            # сайт: http://localhost:3000
```

Для демонстрации и скриншотов можно запустить с готовыми анкетами:

```bash
# Linux / macOS
npm run start:demo
# Windows PowerShell
$env:SEED_DEMO="true"; npm start
```

Демо-аккаунты: `demo1@example.com` … `demo5@example.com`, пароль `demo12345`.

## 4. Docker

```bash
docker build -t heartlink .                                         # сборка образа
docker run -d -p 3000:3000 --name heartlink heartlink               # запуск в фоне
docker run -d -p 3000:3000 -e SEED_DEMO=true --name heartlink heartlink   # то же, с демо-анкетами
docker ps                                                           # список контейнеров (STATUS: healthy)
docker logs heartlink                                               # логи
docker stop heartlink                                               # остановка
docker rm heartlink                                                 # удаление контейнера
```

Откройте http://localhost:3000. Если порт занят: `-p 8080:3000` и адрес http://localhost:8080
(слева — порт компьютера, справа — порт внутри контейнера).

| Инструкция Dockerfile | Назначение |
|---|---|
| `FROM node:22-alpine` | базовый образ (облегчённый Node.js) |
| `ENV NODE_ENV=production` | режим production |
| `WORKDIR /app` | рабочая папка внутри контейнера |
| `COPY package*.json ./` + `RUN npm ci --omit=dev` | установка зависимостей отдельным слоем (кэшируется) |
| `COPY . .` | копирование сервера и фронтенда `public/` (с учётом `.dockerignore`) |
| `ENV PORT=3000`, `EXPOSE 3000` | порт приложения (EXPOSE только документирует его) |
| `HEALTHCHECK` | Docker сам проверяет `/health` и показывает healthy/unhealthy |
| `USER node` | запуск не от root — безопаснее |
| `CMD ["node", "server.js"]` | команда запуска при старте контейнера |

Зачем `.dockerignore`: `node_modules/` исключён, потому что зависимости ставятся внутри образа;
`.env` и ключи — чтобы секреты не попали в образ; `tests/` и `*.md` в рабочем образе не нужны.

## 5. GitHub: репозиторий и первый push

1. На github.com → **New repository** → имя `heartlink`, **Public** (для отчёта нужна публичная ссылка), без README/.gitignore/license.
2. В терминале, в папке проекта:

```bash
git init
git add .
git commit -m "Prepare GitHub Actions build"
git branch -M main
git remote add origin https://github.com/<ваш_логин>/heartlink.git
git push -u origin main
```

3. Откройте вкладку **Actions** — запустится workflow *Test and Build Docker Image*.
   Должны пройти оба задания: `test` и `build`.
4. На главной странице репозитория справа появится раздел **Packages** с образом.
   Забрать образ: `docker pull ghcr.io/<ваш_логин>/heartlink:latest`

Если `build` упал с ошибкой доступа (`403`/`denied`): **Settings → Actions → General →
Workflow permissions → Read and write permissions**.

## 6. Как устроен workflow (`.github/workflows/build.yml`)

- **Триггеры** (`on`): `push` в `main` и любой `pull_request`.
- **Задание `test`**: checkout → установка Node.js 22 (с кэшем npm) → `npm ci` → `npm test`.
- **Задание `build`**: запускается только если `test` успешно прошёл (`needs: test`) **и** это push в `main`
  (условие `if`). Права: `contents: read`, `packages: write`.
  Шаги: checkout → вход в `ghcr.io` через встроенный `GITHUB_TOKEN` → формирование тегов
  (`docker/metadata-action`) → сборка и публикация (`docker/build-push-action`).
- Образ публикуется под двумя тегами: `latest` и полный SHA коммита.
- `metadata-action` приводит имя образа к нижнему регистру — GHCR не принимает заглавные буквы.

## 7. Анализ ошибок в логах

1. **Actions** → нужный запуск → задание с красным крестиком.
2. Раскройте шаг, помеченный ❌ (например, *Run tests*) и прочитайте последние строки лога.
3. Типовые ошибки:
   - `npm ci` падает: «`package.json` and `package-lock.json` are not in sync» — выполните локально
     `npm install`, закоммитьте обновлённый `package-lock.json`;
   - `Cannot find module '...'` — зависимость не прописана в `package.json`;
   - тесты зависят от переменных окружения — передайте их через Secrets/Variables (раздел 8).
4. Исправьте, сделайте новый commit и push — workflow перезапустится.

Чтобы получить ошибку нарочно (для скриншота): в `tests/api.test.js` в тесте «регистрация младше 18 лет запрещена»
поменяйте `400` на `200`, запушьте — задание `test` упадёт, `build` не запустится.

## 8. Secrets и Variables (безопасное хранение ключей)

**Settings → Secrets and variables → Actions → New repository secret.**
Секрет шифруется; после сохранения его значение прочитать нельзя, только заменить.

```yaml
- name: Run tests
  run: npm test
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}      # секрет
    APP_MODE: ${{ vars.APP_MODE }}                 # обычная переменная (Variables)
```

В коде значение читается как `process.env.DATABASE_URL`.
Правила: ключи (`.env`, `serviceAccountKey.json`) — только в `.gitignore` и `.dockerignore`;
в Secrets — пароли/токены/ключи; в Variables — несекретные настройки.

## 9. Адаптация под свой проект и развитие

- **Express вместо встроенного `http`:** `npm install express`, закоммитьте `package.json` и
  `package-lock.json` — Dockerfile и workflow менять не нужно. Для тестов добавьте `supertest`.
- **Фронтенд на React/Vite** отдельно от бэкенда: свой Dockerfile в каждой папке и отдельный шаг сборки
  на каждый (`context: ./backend`, `context: ./frontend`).
- **Что добавить дальше (идеи для индивидуального проекта):** база данных вместо хранилища в памяти
  (PostgreSQL/MongoDB; строку подключения — в Secrets), загрузка фото, чат между парами,
  JWT-токены с истечением срока, ограничение частоты запросов, жалобы и блокировка пользователей.

Важно для сервисов знакомств: хранение и обработка персональных данных требуют согласия пользователя
и политики конфиденциальности; возрастное ограничение 18+ нужно проверять на сервере (как сделано здесь),
а не только в форме; пароли хранить только в виде хэша.

## 10. Задание по Pull Request

Pull Request (PR) — запрос на слияние изменений из рабочей ветки в `main` с проверкой кода и запуском тестов.

```bash
git checkout -b feature/age-filter           # 1. новая ветка
# ... внесите изменение, например фильтр по возрасту в GET /api/profiles (minAge, maxAge) + тест
git add .
git commit -m "Add age filter to profiles"   # 2. коммит
git push -u origin feature/age-filter        # 3. отправка ветки
```

4. На GitHub появится плашка **Compare & pull request** (или вкладка **Pull requests → New pull request**):
   base: `main`, compare: `feature/age-filter` → заголовок и описание → **Create pull request**.
   То же из консоли (GitHub CLI): `gh pr create --base main --title "Add age filter" --body "Описание"`.
5. Внизу PR появятся проверки Actions — сработает только задание `test`
   (публикация образа не выполняется: условие `if` требует push в `main`).
6. Дождитесь зелёной галочки → **Merge pull request** → **Confirm merge**.
   После слияния push в `main` запустит и `test`, и `build` — в Packages появится новая версия образа.
7. Локально: `git checkout main && git pull && git branch -d feature/age-filter`.

Для отчёта сделайте скриншоты: созданный PR, проверки в PR, момент слияния, Actions после слияния.

## 11. Сравнение с GitLab CI/CD (для теории)

| | GitHub Actions | GitLab CI/CD |
|---|---|---|
| Файл конфигурации | `.github/workflows/*.yml` | `.gitlab-ci.yml` в корне |
| Единица работы | workflow → jobs → steps | pipeline → stages → jobs |
| Готовые блоки | `uses:` (Marketplace) | `include:` / шаблоны |
| Команды | `run:` | `script:` |
| Исполнитель | runner (`runs-on`) | GitLab Runner |
| Реестр образов | GHCR (`ghcr.io`) | встроенный Container Registry |
| Секреты | Secrets and variables | CI/CD Variables (Masked, Protected) |
| Запрос на слияние | Pull Request | Merge Request |

Эквивалент нашего workflow для GitLab:

```yaml
stages: [test, build]

test:
  stage: test
  image: node:22-alpine
  script:
    - npm ci
    - npm test

build:
  stage: build
  image: docker:27
  services: [docker:27-dind]
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
  script:
    - docker login -u $CI_REGISTRY_USER -p $CI_REGISTRY_PASSWORD $CI_REGISTRY
    - docker build -t $CI_REGISTRY_IMAGE:latest -t $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA .
    - docker push --all-tags $CI_REGISTRY_IMAGE
```

## 12. Чек-лист для отчёта

Отчёт: номер и название занятия; фамилия, группа, вариант; выполненные задания.

- [ ] Ссылка на **публичный** репозиторий
- [ ] Скриншот `Dockerfile` и `.dockerignore`
- [ ] Скриншот `docker build` (успешная сборка)
- [ ] Скриншот `docker run` + `docker ps` + Docker Desktop (контейнер и образ)
- [ ] Скриншоты сайта в браузере: регистрация, лента анкет, сообщение «Это пара!», раздел «Пары»
- [ ] Скриншот `build.yml`
- [ ] Скриншот репозитория после push
- [ ] Скриншот Actions: успешный запуск, оба задания `test` и `build`
- [ ] Скриншот упавшего задания с логом ошибки и описание, как исправили
- [ ] Скриншот Packages с опубликованным образом в GHCR
- [ ] Скриншот Settings → Secrets and variables → Actions (значения не показывать)
- [ ] Pull Request: описание процесса, команды и скриншоты (раздел 10)
- [ ] Краткий вывод: чему научились (Docker, CI/CD, GHCR, Secrets, различие GitHub Actions и GitLab CI/CD)


## 14. Деплой (практическое занятие №18)

Конфигурация локального production-деплоя находится в папке [`deploy/`](deploy/README.md): Docker Compose, nginx, HTTPS для `heartlink.localhost`, список проверок и требования к скриншотам. Сначала выполните инструкции из `deploy/README.md`.

## 13. SEO

Метатеги, структура заголовков, `robots.txt`, `sitemap.xml`, сжатие и кэширование — см. [docs/seo/README.md](docs/seo/README.md).
На проде задайте адрес сайта: `SITE_URL=https://example.com` (используется в canonical, Open Graph и sitemap).
