const root = document.getElementById('admin-root');
const token = localStorage.getItem('cultcode_token') || sessionStorage.getItem('cultcode_token');
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const categories = [['history', 'История'], ['culture', 'Культура'], ['nature', 'Природа'], ['traditions', 'Традиции'], ['architecture', 'Архитектура'], ['memorial', 'Память']];
const categoryOptions = (selected) => categories.map(([id, label]) => `<option value="${id}" ${selected === id ? 'selected' : ''}>${label}</option>`).join('');
let section = 'questions';
let editing = null;
let items = [];

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Ошибка ${response.status}`);
  return data;
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
    <label>Текст статьи (абзацы разделяйте пустой строкой)<textarea name="content" rows="8" required></textarea></label>
    <label>Вопросы: Вопрос / Ответ / Варианты, блоки через пустую строку<textarea name="questions" rows="9" placeholder="Вопрос: Где находится Мирский замок?&#10;Ответ: В Мире&#10;Варианты: В Бресте; В Минске" required></textarea></label>
    <div class="admin-actions"><button type="submit">${editing ? 'Сохранить' : 'Добавить'}</button>${editing ? '<button type="button" data-cancel>Отмена</button>' : ''}</div>
  </form>`;
}

function articleText(raw) {
  try { return JSON.parse(raw).map((block) => block.text || '').filter(Boolean).join('\n\n'); } catch { return raw || ''; }
}
function questionText(raw) {
  try {
    return JSON.parse(raw).map((q) => {
      const correct = Array.isArray(q.correct) ? q.correct[0] : q.correct;
      return `Вопрос: ${q.question}\nОтвет: ${q.options[correct]}\nВарианты: ${q.options.filter((_, index) => index !== correct).join('; ')}`;
    }).join('\n\n');
  } catch { return raw || ''; }
}
function encodeArticle(form) {
  const contentText = form.elements.content.value.trim();
  const questionsText = form.elements.questions.value.trim();
  const content = contentText.split(/\n\s*\n/).filter(Boolean).map((text, index) => ({ type: index ? 'paragraph' : 'lead', text: text.trim() }));
  const questions = questionsText.split(/\n\s*\n/).map((block, index) => {
    const lines = block.split('\n').map((line) => line.trim());
    const value = (label) => lines.find((line) => line.toLowerCase().startsWith(label))?.split(':').slice(1).join(':').trim() || '';
    const question = value('вопрос:'); const answer = value('ответ:');
    const wrong = value('варианты:').split(';').map((item) => item.trim()).filter(Boolean);
    if (!question || !answer || !wrong.length) throw new Error(`Заполните вопрос, ответ и варианты в блоке ${index + 1}`);
    return { id: Date.now() * 100 + index, type: 'single', question, options: [answer, ...wrong], correct: 0 };
  });
  const category = form.elements.category.value;
  const difficulty = form.elements.difficulty.value;
  return { title: form.elements.title.value.trim(), category, categoryLabel: categories.find(([id]) => id === category)[1],
    difficulty, difficultyLabel: { easy: 'Лёгкий', medium: 'Средний', hard: 'Сложный' }[difficulty],
    readTime: Number(form.elements.readTime.value), image: form.elements.image.value.trim(),
    content: editing && articleText(editing.content) === contentText ? editing.content : JSON.stringify(content),
    questions: editing && questionText(editing.questions) === questionsText ? editing.questions : JSON.stringify(questions) };
}

function renderList() {
  const list = root.querySelector('.admin-items');
  if (!items.length) { list.innerHTML = '<p class="admin-help">Пока ничего нет.</p>'; return; }
  list.innerHTML = items.map((item) => {
    const title = section === 'questions' ? item.question : section === 'rewards' ? `${item.icon} ${item.name}` : section === 'users' ? `${item.name || item.username} · ${item.email}` : item.title;
    const meta = section === 'questions' ? `${item.category_label} · ${item.mode === 'both' ? 'оба типа' : item.mode === 'team' ? 'командные' : 'обычные'} · ответ: ${item.options[item.correct]}`
      : section === 'rewards' ? `${item.cost} баллов · ${item.id}` : section === 'users' ? `${item.role} · ${item.points} баллов` : `${item.categoryLabel} · ${item.difficultyLabel}`;
    return `<article class="admin-item"><div><strong>${esc(title)}</strong><small>${esc(meta)}</small></div><div class="admin-actions">
      ${section !== 'users' ? `<button type="button" data-edit="${esc(item.id)}">Изменить</button>` : ''}
      ${section !== 'users' || item.role !== 'admin' ? `<button type="button" data-delete="${esc(item.id)}" class="danger">Удалить</button>` : ''}</div></article>`;
  }).join('');
  list.querySelectorAll('[data-edit]').forEach((button) => button.onclick = () => edit(button.dataset.edit));
  list.querySelectorAll('[data-delete]').forEach((button) => button.onclick = () => remove(button.dataset.delete));
}

async function load() {
  const path = { questions: '/admin/questions', rewards: '/admin/rewards', articles: '/articles', users: '/admin/users' }[section];
  items = await api(path);
  if (section === 'articles') items = items.filter((item) => !item.title?.startsWith('Командные вопросы:'));
  renderList();
}

function renderSection() {
  const editor = root.querySelector('.admin-editor-wrap');
  editor.innerHTML = section === 'questions' ? questionForm() : section === 'rewards' ? rewardForm() : section === 'articles' ? articleForm() : '';
  root.querySelectorAll('[data-section]').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.section === section)));
  const form = root.querySelector('#editor');
  if (form) form.onsubmit = save;
  form?.querySelector('[data-cancel]')?.addEventListener('click', () => { editing = null; renderSection(); });
  flash('');
  load().catch((error) => flash(error.message, true));
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
    for (const name of ['title', 'category', 'difficulty', 'readTime', 'image']) form.elements[name].value = editing[name] || '';
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
    root.innerHTML = `<p class="admin-eyebrow">Управление проектом</p><h1>Админ-панель</h1><p class="admin-subtitle">${esc(user.email)} · статьи, вопросы баттлов, награды и пользователи</p>
      <nav class="admin-nav" aria-label="Разделы панели"><button data-section="questions">Вопросы баттлов</button><button data-section="rewards">Награды</button><button data-section="articles">Статьи</button><button data-section="users">Пользователи</button></nav>
      <p class="admin-feedback" role="status" aria-live="polite"></p><div class="admin-editor-wrap"></div><div class="admin-items"></div>`;
    root.querySelectorAll('[data-section]').forEach((button) => button.onclick = () => { section = button.dataset.section; editing = null; renderSection(); });
    renderSection();
  } catch (error) { root.innerHTML = `<h1>Не удалось открыть панель</h1><p>${esc(error.message)}</p><a href="login.html?next=admin.html">Войти снова</a>`; }
}

start();
