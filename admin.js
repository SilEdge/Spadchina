import { requestJSON } from './request-json.js';

const root = document.getElementById('admin-root');
const token = localStorage.getItem('cultcode_token') || sessionStorage.getItem('cultcode_token');
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const categories = [['history', 'История'], ['culture', 'Культура'], ['nature', 'Природа'], ['traditions', 'Традиции'], ['architecture', 'Архитектура'], ['memory', 'Память']];
const categoryOptions = (selected) => categories.map(([id, label]) => `<option value="${id}" ${selected === id ? 'selected' : ''}>${label}</option>`).join('');
let section = 'questions';
let editing = null;
let items = [];
let loadVersion = 0;
const userLabel = (user) => user.name?.trim() || user.username?.trim() || `Пользователь #${user.id}`;

async function api(path, options = {}) {
  return requestJSON(`/api${path}`, {
    ...options,
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}` },
  });
}

function flash(message, isError = false) {
  const target = root.querySelector('.admin-feedback');
  if (!target) return;
  target.textContent = message;
  target.classList.toggle('is-error', isError);
}

function questionForm() {
  return `<form class="admin-editor" id="editor"><h2>${editing ? 'Изменить вопрос' : 'Добавить вопрос'}</h2>
    <label>Для каких баттлов<select name="mode"><option value="both">Обычные и командные</option><option value="duel">Обычные</option><option value="team">Командные</option></select></label>
    <label>Тема<select name="category">${categoryOptions('history')}</select></label>
    <label>Вопрос<input name="question" maxlength="500" required></label>
    <label>Варианты ответов, по одному в строке<textarea name="options" rows="6" required></textarea></label>
    <label>Номер правильного ответа (первый — 1)<input name="correct" type="number" min="1" max="6" value="1" required></label>
    <p class="admin-help">От 2 до 6 вариантов. Новый вопрос попадёт в каждый новый баттл подходящего типа и темы.</p>
    <div class="admin-actions"><button type="submit">${editing ? 'Сохранить' : 'Добавить'}</button>${editing ? '<button type="button" data-cancel>Отмена</button>' : ''}</div>
  </form>`;
}

function rewardForm() {
  return `<form class="admin-editor" id="editor"><h2>${editing ? 'Изменить награду' : 'Добавить награду'}</h2>
    <label>Код (латиница, цифры, дефис)<input name="id" pattern="[a-z0-9-]+" maxlength="80" ${editing ? 'disabled' : ''} required></label>
    <label>Значок<input name="icon" maxlength="20" value="🏆" required></label>
    <label>Название<input name="name" maxlength="120" required></label>
    <label>Стоимость, баллов<input name="cost" type="number" min="0" max="1000000" value="100" required></label>
    <p class="admin-help">Полученные пользователями награды нельзя удалить или переоценить.</p>
    <div class="admin-actions"><button type="submit">${editing ? 'Сохранить' : 'Добавить'}</button>${editing ? '<button type="button" data-cancel>Отмена</button>' : ''}</div>
  </form>`;
}

function articleForm() {
  return `<form class="admin-editor" id="editor"><h2>${editing ? 'Изменить статью' : 'Добавить статью'}</h2>
    <label>Название<input name="title" required></label>
    <label>Тема<select name="category">${categoryOptions('history')}</select></label>
    <label>Сложность<select name="difficulty"><option value="easy">Лёгкий</option><option value="medium">Средний</option><option value="hard">Сложный</option></select></label>
    <label>Время чтения, минут<input name="readTime" type="number" min="1" max="120" value="5" required></label>
    <label>Ссылка на изображение<input name="image" placeholder="https://… или /images/…"></label>
    <label class="admin-checkbox"><input name="published" type="checkbox" checked> Опубликовать в каталоге</label>
    <label>Код статьи<input name="slug" pattern="[a-z0-9]+(-[a-z0-9]+)*" maxlength="80" placeholder="Создастся автоматически" ${editing?.slug ? 'readonly' : ''}></label>
    <label>Регион<input name="region" maxlength="150" placeholder="Минская обл."></label>
    <label>Эпоха<input name="era" maxlength="120" placeholder="XVI век"></label>
    <label>Баллы за все правильные ответы<input name="points" type="number" min="0" max="10000" value="120" required></label>
    <label>Широта<input name="latitude" type="number" min="-90" max="90" step="any" placeholder="53.451"></label>
    <label>Долгота<input name="longitude" type="number" min="-180" max="180" step="any" placeholder="26.473"></label>
    <label>Описание метки на карте<input name="map_label" maxlength="200" placeholder="Для традиции укажите место её проведения"></label>
    <label>Текст статьи (абзацы разделяйте пустой строкой)<textarea name="content" rows="8" required></textarea></label>
    <label>Вопросы к статье<textarea name="questions" rows="9" placeholder="Вопрос: Где находится Мирский замок?&#10;Варианты: В Бресте; В Мире; В Минске&#10;Правильный ответ: В Мире" required></textarea></label>
    <p class="admin-help">Укажите все варианты в нужном порядке и впишите правильный ответ точно так же, как он написан среди вариантов. Отделяйте вопросы пустой строкой.</p>
    <div class="admin-actions"><button type="submit">${editing ? 'Сохранить' : 'Добавить'}</button>${editing ? '<button type="button" data-cancel>Отмена</button>' : ''}</div>
  </form>`;
}

function articleText(raw) {
  try { return JSON.parse(raw).map((block) => block.text || '').filter(Boolean).join('\n\n'); } catch { return raw || ''; }
}
function questionText(raw) {
  try {
    return JSON.parse(raw).map((q) => {
      const correct = Array.isArray(q.correct) ? q.correct : [q.correct];
      return `Вопрос: ${q.question}\nВарианты: ${q.options.join('; ')}\nПравильный ответ: ${correct.map((index) => q.options[index]).join('; ')}${q.explanation ? `\nПояснение: ${q.explanation}` : ''}`;
    }).join('\n\n');
  } catch { return raw || ''; }
}
function encodeArticle(form) {
  const contentText = form.elements.content.value.trim();
  const questionsText = form.elements.questions.value.trim();
  let hasLead = false;
  const content = contentText.split(/\n\s*\n/).filter(Boolean).map((text) => {
    const credit = /^(Фото:|Иллюстрация создана с помощью ИИ)/.test(text.trim());
    const type = credit ? 'credit' : hasLead ? 'paragraph' : 'lead';
    if (!credit) hasLead = true;
    return { type, text: text.trim() };
  });
  let previousQuestions = [];
  try { previousQuestions = editing?.questions ? JSON.parse(editing.questions) : []; } catch { previousQuestions = []; }
  const questions = questionsText.split(/\n\s*\n/).map((block, index) => {
    const lines = block.split('\n').map((line) => line.trim());
    const findLine = (...labels) => lines.find((line) => labels.some((label) => line.toLowerCase().startsWith(label))) || '';
    const value = (...labels) => findLine(...labels).split(':').slice(1).join(':').trim();
    const question = value('вопрос:');
    const answer = value('правильный ответ:', 'ответ:');
    const options = value('варианты:').split(';').map((item) => item.trim()).filter(Boolean);
    const legacyWrong = value('неправильные ответы:').split(';').map((item) => item.trim()).filter(Boolean);
    const legacyFormat = /^ответ:/i.test(findLine('ответ:')) || legacyWrong.length > 0;
    const choices = legacyWrong.length ? [answer, ...legacyWrong] : legacyFormat ? [answer, ...options] : options;
    const correct = legacyFormat ? [0] : answer.split(';').map((text) => choices.findIndex((option) => option === text.trim()));
    if (!question || !answer || choices.length < 2 || correct.some((index) => index < 0)) throw new Error(`В блоке ${index + 1} укажите вопрос, минимум два варианта и правильный ответ из списка`);
    return { id: previousQuestions[index]?.id || Date.now() * 100 + index,
      type: correct.length > 1 ? 'multiple' : 'single', question, options: choices, correct: correct.length > 1 ? correct : correct[0], explanation: value('пояснение:') };
  });
  const category = form.elements.category.value;
  const difficulty = form.elements.difficulty.value;
  return { title: form.elements.title.value.trim(), category, categoryLabel: categories.find(([id]) => id === category)[1],
    published: form.elements.published.checked, slug: form.elements.slug.value.trim(), region: form.elements.region.value.trim(), era: form.elements.era.value.trim(),
    points: Number(form.elements.points.value), latitude: form.elements.latitude.value === '' ? null : Number(form.elements.latitude.value),
    longitude: form.elements.longitude.value === '' ? null : Number(form.elements.longitude.value), map_label: form.elements.map_label.value.trim(),
    difficulty, difficultyLabel: { easy: 'Лёгкий', medium: 'Средний', hard: 'Сложный' }[difficulty],
    readTime: Number(form.elements.readTime.value), image: form.elements.image.value.trim(),
    content: editing && articleText(editing.content) === contentText ? editing.content : JSON.stringify(content),
    questions: editing && questionText(editing.questions) === questionsText ? editing.questions : JSON.stringify(questions) };
}

function renderList() {
  const list = root.querySelector('.admin-items');
  list.hidden = false;
  if (!items.length) { list.innerHTML = '<p class="admin-help">Пока ничего нет.</p>'; return; }
  if (section === 'ideas') {
    list.innerHTML = items.map((item) => `<article class="admin-item admin-idea"><div><strong>${esc(item.name || 'Гость')}</strong><small>${esc(item.email || '')} · ${esc(new Date(item.created_at + 'Z').toLocaleString('ru-RU'))}</small><p>${esc(item.message)}</p></div></article>`).join('');
    return;
  }
  list.innerHTML = items.map((item) => {
    const title = section === 'questions' ? item.question : section === 'rewards' ? `${item.icon || '🏆'} ${item.name || 'Без названия'}` : section === 'users' ? userLabel(item) : item.title;
    const meta = section === 'questions' ? `${item.category_label || 'Без темы'} · ${item.mode === 'both' ? 'обычные и командные' : item.mode === 'team' ? 'командные' : 'обычные'} · правильный ответ: ${item.options?.[item.correct] || 'не указан'}`
      : section === 'rewards' ? `${Number(item.cost) || 0} баллов · ${item.id}` : section === 'users' ? `@${item.username || `user-${item.id}`} · ${item.email || 'почта не указана'} · ${item.role === 'admin' ? 'администратор' : 'пользователь'} · ${Number(item.points) || 0} баллов` : `${item.categoryLabel || 'Без темы'} · ${item.difficultyLabel || 'сложность не указана'}`;
    return `<article class="admin-item"><div><strong>${esc(title)}</strong><small>${esc(meta)}</small></div><div class="admin-actions">
      ${section === 'users' ? `<button type="button" data-profile="${esc(item.id)}">Открыть профиль</button>` : `<button type="button" data-edit="${esc(item.id)}">Изменить</button>`}
      ${section !== 'users' || item.role !== 'admin' ? `<button type="button" data-delete="${esc(item.id)}" class="danger">Удалить</button>` : ''}</div></article>`;
  }).join('');
  list.querySelectorAll('[data-edit]').forEach((button) => button.onclick = () => edit(button.dataset.edit));
  list.querySelectorAll('[data-delete]').forEach((button) => button.onclick = () => remove(button.dataset.delete));
  list.querySelectorAll('[data-profile]').forEach((button) => button.onclick = () => openUserProfile(button.dataset.profile));
}

async function load() {
  const version = ++loadVersion;
  const requestedSection = section;
  if (section === 'settings') { root.querySelector('.admin-items').innerHTML = ''; return; }
  const path = { questions: '/admin/questions', rewards: '/admin/rewards', articles: '/admin/articles', users: '/admin/users', ideas: '/admin/suggestions' }[section];
  const loaded = await api(path);
  if (version !== loadVersion || section !== requestedSection) return;
  items = loaded;
  if (section === 'articles') items = items.filter((item) => !item.title?.startsWith('Командные вопросы:'));
  renderList();
}

function renderSection() {
  const editor = root.querySelector('.admin-editor-wrap');
  editor.innerHTML = section === 'questions' ? questionForm() : section === 'rewards' ? rewardForm() : section === 'articles' ? articleForm() : '';
  if (section === 'settings') editor.innerHTML = '<form class="admin-editor" id="password-editor"><h2>Сменить пароль</h2><label>Текущий пароль<input name="current" type="password" autocomplete="current-password" required></label><label>Новый пароль<input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="72" required></label><button type="submit">Сохранить пароль</button></form>';
  editor.querySelector('#password-editor')?.addEventListener('submit', async (event) => {
    event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button'); button.disabled = true;
    try { await api('/admin/password', { method: 'POST', body: JSON.stringify({ current_password: form.elements.current.value, password: form.elements.password.value }) }); form.reset(); flash('Пароль изменён'); }
    catch (error) { flash(error.message, true); } finally { button.disabled = false; }
  });
  root.querySelectorAll('[data-section]').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.section === section)));
  const form = root.querySelector('#editor');
  if (form) form.onsubmit = save;
  form?.querySelector('[data-cancel]')?.addEventListener('click', () => { editing = null; renderSection(); });
  flash('');
  load().catch((error) => flash(error.message, true));
}

async function openUserProfile(id) {
  const editor = root.querySelector('.admin-editor-wrap');
  const list = root.querySelector('.admin-items');
  list.hidden = true;
  editor.innerHTML = '<section class="admin-user-profile"><p class="admin-help">Загружаем профиль…</p></section>';
  try {
    const profile = await api(`/admin/users/${encodeURIComponent(id)}`);
    const user = profile.user || {};
    const stats = profile.stats || {};
    const name = userLabel(user);
    const when = user.created_at ? new Date(user.created_at).toLocaleDateString('ru-RU') : '—';
    editor.innerHTML = `<section class="admin-user-profile"><button type="button" class="admin-profile-back" data-back>← К списку пользователей</button>
      <p class="admin-eyebrow">Профиль пользователя</p><h2>${esc(name)}</h2>
      <p class="admin-profile-handle">@${esc(user.username || `user-${user.id}`)}</p>
      <div class="admin-profile-facts"><span>${esc(user.email || 'Почта не указана')}</span><span>В проекте с ${esc(when)}</span><span>${Number(user.points) || 0} баллов</span></div>
      <h3>Статистика</h3><div class="admin-user-stats">
        <article><strong>${Number(stats.articles_completed) || 0}</strong><span>статей пройдено</span></article>
        <article><strong>${Number(stats.correct_answers) || 0} / ${Number(stats.available_answers) || 0}</strong><span>верных ответов</span></article>
        <article><strong>${Number(stats.duels_played) || 0}</strong><span>дуэлей</span></article>
        <article><strong>${Number(stats.duels_won) || 0}</strong><span>побед в дуэлях</span></article>
        <article><strong>${Number(stats.team_battles_played) || 0}</strong><span>командных баттлов</span></article>
        <article><strong>${Number(stats.rewards_owned) || 0}</strong><span>полученных наград</span></article>
      </div></section>`;
    editor.querySelector('[data-back]').onclick = () => { editor.innerHTML = ''; list.hidden = false; };
  } catch (error) {
    editor.innerHTML = `<section class="admin-user-profile"><button type="button" class="admin-profile-back" data-back>← К списку пользователей</button><p class="admin-feedback is-error">${esc(error.message)}</p></section>`;
    editor.querySelector('[data-back]').onclick = () => { editor.innerHTML = ''; list.hidden = false; };
  }
}

function edit(id) {
  editing = items.find((item) => String(item.id) === String(id));
  renderSection();
  const form = root.querySelector('#editor');
  if (section === 'questions') {
    form.elements.mode.value = editing.mode; form.elements.category.value = editing.category;
    form.elements.question.value = editing.question; form.elements.options.value = editing.options.join('\n');
    form.elements.correct.value = Number(editing.correct) + 1;
  } else if (section === 'rewards') {
    for (const name of ['id', 'icon', 'name', 'cost']) form.elements[name].value = editing[name];
  } else {
    for (const name of ['title', 'category', 'difficulty', 'readTime', 'image', 'slug', 'region', 'era', 'points', 'latitude', 'longitude', 'map_label']) form.elements[name].value = editing[name] ?? '';
    if (editing.category === 'memorial') form.elements.category.value = 'memory';
    form.elements.published.checked = Boolean(editing.published);
    form.elements.content.value = articleText(editing.content);
    form.elements.questions.value = questionText(editing.questions);
  }
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function save(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type=submit]'); button.disabled = true;
  try {
    let body;
    if (section === 'questions') {
      const options = form.elements.options.value.split('\n').map((text) => text.trim()).filter(Boolean);
      const correct = Number(form.elements.correct.value) - 1;
      if (options.length < 2 || options.length > 6 || correct < 0 || correct >= options.length) throw new Error('Нужно 2–6 вариантов и верный номер ответа');
      const category = form.elements.category.value;
      body = { mode: form.elements.mode.value, category, category_label: categories.find(([id]) => id === category)[1],
        question: form.elements.question.value.trim(), options, correct };
    } else if (section === 'rewards') {
      body = { id: editing?.id || form.elements.id.value.trim(), icon: form.elements.icon.value.trim(),
        name: form.elements.name.value.trim(), cost: Number(form.elements.cost.value) };
    } else body = encodeArticle(form);
    const base = section === 'articles' ? '/admin/articles' : `/admin/${section}`;
    await api(editing ? `${base}/${encodeURIComponent(editing.id)}` : base,
      { method: editing ? 'PUT' : 'POST', body: JSON.stringify(body) });
    editing = null; renderSection(); flash('Сохранено');
  } catch (error) { flash(error.message, true); }
  finally { button.disabled = false; }
}

async function remove(id) {
  const item = items.find((row) => String(row.id) === String(id));
  if (!confirm(`Удалить «${item?.question || item?.name || item?.title || item?.username}»?`)) return;
  try {
    const base = section === 'articles' ? '/admin/articles' : `/admin/${section}`;
    await api(`${base}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await load(); flash('Удалено');
  } catch (error) { flash(error.message, true); }
}

async function start() {
  if (!token) { root.innerHTML = '<h1>Панель администратора</h1><p>Войдите в аккаунт администратора.</p><a class="admin-primary" href="login.html?next=admin.html">Войти</a>'; return; }
  try {
    const user = await api('/me');
    if (user.role !== 'admin') { root.innerHTML = '<h1>Доступ закрыт</h1><p>Панель доступна только администратору.</p>'; return; }
    root.innerHTML = `<p class="admin-eyebrow">Управление проектом</p><h1>Админ-панель</h1>
      <nav class="admin-nav" aria-label="Разделы панели"><button data-section="questions">Вопросы баттлов</button><button data-section="rewards">Награды</button><button data-section="articles">Статьи</button><button data-section="users">Пользователи</button><button data-section="ideas">Идеи</button><button data-section="settings">Настройки</button></nav>
      <p class="admin-feedback" role="status" aria-live="polite"></p><div class="admin-editor-wrap"></div><div class="admin-items"></div>`;
    root.querySelectorAll('[data-section]').forEach((button) => button.onclick = () => { section = button.dataset.section; editing = null; renderSection(); });
    renderSection();
  } catch (error) { root.innerHTML = `<h1>Не удалось открыть панель</h1><p>${esc(error.message)}</p><a href="login.html?next=admin.html">Войти снова</a>`; }
}

start();
