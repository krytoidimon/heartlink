'use strict';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const GENDER_LABEL = { male: 'Мужчина', female: 'Женщина', other: 'Другое' };
let token = null;
try { token = localStorage.getItem('token'); } catch { /* хранилище недоступно */ }

// Создание DOM-элементов. Пользовательский текст вставляется через textContent,
// а не innerHTML — так анкеты не смогут внедрить вредоносный HTML (защита от XSS).
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...options, headers });
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) {
    const error = new Error((data && data.error) || 'Ошибка запроса');
    error.status = res.status;
    throw error;
  }
  return data;
}

function show(view) {
  ['auth', 'discover', 'matches'].forEach((id) => $('#' + id).classList.toggle('hidden', id !== view));
  $('#about').classList.toggle('hidden', view !== 'auth');
  $('#nav').classList.toggle('hidden', view === 'auth');
  if (view === 'auth') selectTab('login-form');
  $$('.nav-btn[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'discover') loadProfiles();
  if (view === 'matches') loadMatches();
}

function setSession(newToken) {
  token = newToken;
  try {
    if (newToken) localStorage.setItem('token', newToken);
    else localStorage.removeItem('token');
  } catch { /* ignore */ }
}

// ---------- Авторизация ----------
function selectTab(formId) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.form === formId));
  ['login-form', 'register-form'].forEach((id) => $('#' + id).classList.toggle('hidden', id !== formId));
  $('#auth-error').textContent = '';
}
$$('.tab').forEach((tab) => tab.addEventListener('click', () => selectTab(tab.dataset.form)));

async function submitAuth(event, path, transform = (d) => d) {
  event.preventDefault();
  const data = transform(Object.fromEntries(new FormData(event.target)));
  try {
    const result = await api(path, { method: 'POST', body: JSON.stringify(data) });
    setSession(result.token);
    show('discover');
  } catch (err) {
    $('#auth-error').textContent = err.message;
  }
}

$('#login-form').addEventListener('submit', (e) => submitAuth(e, '/api/login'));
$('#register-form').addEventListener('submit', (e) =>
  submitAuth(e, '/api/register', (d) => ({ ...d, age: Number(d.age) })),
);

$('#logout').addEventListener('click', () => {
  setSession(null);
  show('auth');
});
$$('.nav-btn[data-view]').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));

// ---------- Лента анкет ----------
let queue = [];

async function loadProfiles() {
  $('#match-banner').classList.add('hidden');
  const params = new URLSearchParams();
  if ($('#filter-city').value.trim()) params.set('city', $('#filter-city').value.trim());
  if ($('#filter-gender').value) params.set('gender', $('#filter-gender').value);
  try {
    queue = await api('/api/profiles?' + params);
    renderCard();
  } catch (err) {
    handleAuthError(err);
  }
}

function renderCard() {
  const area = $('#card-area');
  area.replaceChildren();
  const profile = queue[0];
  if (!profile) {
    area.append(el('p', 'muted', 'Анкеты закончились. Загляните позже или измените фильтры.'));
    return;
  }
  const card = el('div', 'card');
  card.append(
    el('div', 'avatar', profile.name.charAt(0).toUpperCase()),
    el('h3', '', `${profile.name}, ${profile.age}`),
    el('div', 'muted', [GENDER_LABEL[profile.gender], profile.city].filter(Boolean).join(' · ')),
    el('p', 'bio', profile.bio || 'Пока ничего о себе не рассказал(а)'),
  );
  const actions = el('div', 'actions');
  const skip = el('button', 'round', '✕');
  skip.title = 'Пропустить';
  skip.addEventListener('click', () => rate(profile, 'passes'));
  const like = el('button', 'round like', '♥');
  like.title = 'Нравится';
  like.addEventListener('click', () => rate(profile, 'likes'));
  actions.append(skip, like);
  card.append(actions);
  area.append(card);
}

async function rate(profile, kind) {
  try {
    const result = await api(`/api/${kind}/${profile.id}`, { method: 'POST' });
    const banner = $('#match-banner');
    if (result.match) {
      banner.textContent = `Это пара! Вы и ${profile.name} понравились друг другу ♥`;
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
    queue.shift();
    renderCard();
  } catch (err) {
    handleAuthError(err);
  }
}

$('#apply-filters').addEventListener('click', loadProfiles);

// ---------- Пары ----------
async function loadMatches() {
  try {
    const list = await api('/api/matches');
    const ul = $('#match-list');
    ul.replaceChildren();
    $('#no-matches').classList.toggle('hidden', list.length > 0);
    list.forEach((p) => {
      const li = el('li');
      const info = el('div');
      info.append(el('strong', '', `${p.name}, ${p.age}`), el('div', 'muted', p.city || '—'));
      li.append(el('div', 'avatar', p.name.charAt(0).toUpperCase()), info);
      ul.append(li);
    });
  } catch (err) {
    handleAuthError(err);
  }
}

function handleAuthError(err) {
  if (err.status === 401) {
    setSession(null);
    show('auth');
  } else {
    alert(err.message);
  }
}

// ---------- Старт ----------
if (token) show('discover');
else show('auth');
