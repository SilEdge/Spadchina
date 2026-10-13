import './data.js';
import './app.js';

const API_ORIGIN = window.location.hostname.endsWith('.vercel.app') ? '' : String(import.meta.env.VITE_API_URL || '').trim().replace(/\/$/, '');
const API_ROOT = `${API_ORIGIN}/api`;
const TOKEN_KEY = 'cultcode_token';
const PENDING_KEY = 'spadchyna_pending_quiz_results';
const token = () => localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || '';
const cache = { atlas: null, user: null };
const FALLBACK_CATEGORIES = [
  ['История', 'history'], ['Культура', 'culture'], ['Природа', 'nature'],
  ['Традиции', 'traditions'], ['Архитектура', 'architecture'], ['Память', 'memory'],
].map(([name, id]) => ({ name, id }));

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');
  if (options.body) headers.set('Content-Type', 'application/json');
  if (token()) headers.set('Authorization', `Bearer ${token()}`);
  const response = await fetch(`${API_ROOT}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Ошибка сервера (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const status = (target, message, error = false) => {
  if (!target) return;
  let line = target.querySelector(':scope > .backend-status');
  if (!line) {
    line = document.createElement('p');
    line.className = 'backend-status';
    line.setAttribute('role', 'status');
    target.append(line);
  }
  line.textContent = message;
  line.dataset.error = String(error);
};
const getAtlas = () => cache.atlas || (cache.atlas = api('/atlas').catch((error) => { cache.atlas = null; throw error; }));
const safeNextPage = () => {
  const next = new URLSearchParams(location.search).get('next');
  return next && /^[a-z0-9-]+\.html$/i.test(next) ? next : 'profile.html';
};

function makeAuthForm(mode = 'login') {
  const registering = mode === 'register';
  return `<form class="backend-auth-form" style="display:grid;gap:12px">
    <h2 style="font-family:inherit;font-size:24px;font-weight:800;margin:0 0 4px">${registering ? 'Регистрация' : 'Вход'}</h2>
    <div class="backend-auth-tabs" role="tablist" aria-label="Вход или регистрация">
      <button type="button" role="tab" data-auth-mode="login" aria-selected="${!registering}">Войти</button>
      <button type="button" role="tab" data-auth-mode="register" aria-selected="${registering}">Зарегистрироваться</button>
    </div>
    ${registering ? '<label>Имя<input name="name" autocomplete="name" minlength="2" required></label>' : ''}
    <label>Email<input name="email" type="email" autocomplete="email" required></label>
    <label>Пароль<input name="password" type="password" autocomplete="${registering ? 'new-password' : 'current-password'}" minlength="6" required></label>
    <button class="backend-auth-submit" type="submit">${registering ? 'Зарегистрироваться' : 'Войти'}</button>
    <p class="backend-status" role="status" aria-live="polite"></p>
  </form>`;
}

function openAuthModal(initialMode = 'login') {
  document.querySelector('.backend-auth-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'backend-auth-overlay';
  overlay.innerHTML = `<section class="backend-auth-card" role="dialog" aria-modal="true" aria-label="Вход или регистрация">
    <button type="button" class="backend-auth-close" aria-label="Закрыть">×</button>
    ${makeAuthForm(initialMode)}
  </section>`;
  document.body.append(overlay);
  const form = overlay.querySelector('form');
  bindAuthForm(form, initialMode);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (event) => { if (event.target === overlay || event.target.closest('.backend-auth-close')) close(); });
  overlay.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
  overlay.querySelector('input:not([hidden])')?.focus();
}

function bindAuthForm(form, initialMode = 'login') {
  if (!form) return;
  let mode = initialMode;
  form.querySelectorAll('[data-auth-mode]').forEach((tab) => tab.addEventListener('click', () => {
    const nextMode = tab.dataset.authMode;
    if (nextMode === mode) return;
    const replacement = document.createElement('div');
    replacement.innerHTML = makeAuthForm(nextMode);
    const nextForm = replacement.firstElementChild;
    form.replaceWith(nextForm);
    bindAuthForm(nextForm, nextMode);
    nextForm.querySelector('input:not([hidden])')?.focus();
  }));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    try {
      const body = { email: form.elements.email.value.trim(), password: form.elements.password.value };
      if (mode === 'register') body.name = form.elements.name.value.trim();
      const result = await api(mode === 'register' ? '/register' : '/login', { method: 'POST', body: JSON.stringify(body) });
      localStorage.setItem(TOKEN_KEY, result.token);
      sessionStorage.setItem(TOKEN_KEY, result.token);
      cache.user = result.user;
      await syncPendingResults();
      if (location.pathname.endsWith('/login.html')) {
        location.href = safeNextPage();
      } else location.reload();
    } catch (error) {
      status(form, error.message, true);
      button.disabled = false;
    }
  });
}

async function syncPendingResults() {
  let pending = [];
  try { pending = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); } catch { pending = []; }
  const failed = [];
  for (const result of pending) {
    if (result.account && result.account !== cache.user?.username) { failed.push(result); continue; }
    try { await api('/atlas/results', { method: 'POST', body: JSON.stringify({ slug: result.slug, score: result.score, max_score: result.max_score }) }); }
    catch { failed.push(result); }
  }
  if (failed.length) localStorage.setItem(PENDING_KEY, JSON.stringify(failed));
  else localStorage.removeItem(PENDING_KEY);
}

function queuePendingResult(result) {
  const entry = { ...result, account: cache.user?.username || null };
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
    const previous = pending.find((item) => item.slug === entry.slug && item.account === entry.account);
    if (previous && previous.score > entry.score) entry.score = previous.score;
    localStorage.setItem(PENDING_KEY, JSON.stringify([...pending.filter((item) => item.slug !== entry.slug || item.account !== entry.account), entry]));
  } catch {
    localStorage.setItem(PENDING_KEY, JSON.stringify([entry]));
  }
}

async function installAuth() {
  document.querySelectorAll('header .mobile-header-actions > button:not(.mobile-menu-toggle), header > div > button').forEach((button) => {
    if (button.textContent.trim() !== 'Войти') return;
    button.onclick = null;
    button.addEventListener('click', () => {
      if (token()) location.href = 'profile.html';
      else openAuthModal();
    });
  });
  const pageForm = document.querySelector('main form');
  if (location.pathname.endsWith('/login.html') && pageForm) {
    let mode = 'login';
    const tabs = [...document.querySelectorAll('main button[role="tab"]')];
    tabs.forEach((tab) => {
      tab.dataset.authMode = /Регистрац|Зарегистр/i.test(tab.textContent) ? 'register' : 'login';
      if (tab.dataset.authMode === 'register') tab.textContent = 'Зарегистрироваться';
    });
    const syncMode = (nextMode) => {
      mode = nextMode;
      const name = pageForm.querySelector('[name=name]');
      if (mode === 'register' && !name) {
        const label = document.createElement('label');
        label.className = 'block text-sm font-medium';
        label.innerHTML = 'Имя<input name="name" autocomplete="name" minlength="2" required class="mt-2 h-11 w-full rounded-md border border-input bg-background px-3 text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-ring">';
        pageForm.prepend(label);
      } else if (mode === 'login' && name) name.closest('label')?.remove();
      const submit = pageForm.querySelector('[type=submit]');
      const password = pageForm.elements.password;
      if (password) password.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
      if (submit) submit.textContent = mode === 'register' ? 'Зарегистрироваться' : 'Войти';
      tabs.forEach((tab) => {
        const active = tab.dataset.authMode === mode;
        tab.setAttribute('aria-selected', String(active));
        tab.classList.toggle('text-primary', active);
        tab.classList.toggle('border-primary', active);
      });
    };
    tabs.forEach((tab) => tab.addEventListener('click', () => syncMode(tab.dataset.authMode)));
    pageForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = pageForm.querySelector('[type=submit]'); submit.disabled = true;
      try {
        const body = { email: pageForm.elements.email.value.trim(), password: pageForm.elements.password.value };
        if (mode === 'register') body.name = pageForm.elements.name.value.trim();
        const result = await api(mode === 'register' ? '/register' : '/login', { method: 'POST', body: JSON.stringify(body) });
        localStorage.setItem(TOKEN_KEY, result.token); sessionStorage.setItem(TOKEN_KEY, result.token);
        cache.user = result.user;
        await syncPendingResults();
        location.href = safeNextPage();
      } catch (error) { status(pageForm, error.message, true); submit.disabled = false; }
    });
    if (token()) location.href = 'profile.html';
  }
  if (token()) {
    try {
      const user = cache.user || await api('/me'); cache.user = user;
      document.querySelectorAll('header button').forEach((button) => {
        if (button.textContent.trim() === 'Войти') {
          button.textContent = 'Профиль'; button.title = `${user.name} · ${user.points} баллов`;
          if (!button.parentElement.querySelector('[data-header-logout]')) {
            const logout = document.createElement('button');
            logout.type = 'button'; logout.dataset.headerLogout = 'true'; logout.className = button.className;
            logout.textContent = 'Выйти'; logout.setAttribute('aria-label', 'Выйти из аккаунта');
            logout.addEventListener('click', () => {
              localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY); cache.user = null;
              location.href = 'index.html';
            });
            button.insertAdjacentElement('afterend', logout);
          }
        }
      });
      if (user.role === 'admin') {
        document.querySelectorAll('header nav').forEach((nav) => {
          if (nav.querySelector('[data-admin-link]')) return;
          const link = document.createElement('a');
          link.href = 'admin.html'; link.dataset.adminLink = 'true'; link.textContent = 'Админка';
          link.className = nav.classList.contains('site-primary-nav') ? 'hover:text-primary' : 'whitespace-nowrap';
          if (location.pathname.endsWith('/admin.html')) {
            link.classList.add('text-primary');
            link.setAttribute('aria-current', 'page');
          }
          nav.append(link);
        });
      }
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY);
      }
    }
  }
}

async function installCatalog() {
  const main = document.querySelector('main');
  if (!main?.querySelector('input[placeholder="Найти место…"]')) return;
  const input = main.querySelector('input[placeholder="Найти место…"]');
  const cards = [...main.querySelectorAll('a[href^="place-"]')];
  const filters = [...main.querySelectorAll('button')].filter((button) => button.textContent.trim());
  let category = '';
  let atlas;
  try { atlas = await getAtlas(); }
  catch (error) { status(main, `Каталог загружен из сохранённой версии: ${error.message}`, true); }
  const placeIndex = new Map((atlas?.places || window.SP?.n || []).map((place) => [place.id, place]));
  const categories = atlas?.categories || FALLBACK_CATEGORIES;
  const progress = new Set();
  if (token()) {
    try { (await api('/atlas/progress')).forEach((item) => progress.add(item.slug)); } catch { /* Keep browsing available during a temporary API outage. */ }
  }
  cards.forEach((card) => {
    const slug = card.getAttribute('href').replace(/^place-/, '').replace(/\.html$/, '');
    const place = placeIndex.get(slug);
    if (place) card.dataset.category = place.cat;
    if (progress.has(slug) && !card.querySelector('.backend-completed')) {
      const badge = document.createElement('span'); badge.className = 'backend-completed'; badge.textContent = 'Изучено'; card.append(badge);
    }
  });
  const apply = () => {
    const query = input.value.trim().toLocaleLowerCase('ru');
    let visible = 0;
    cards.forEach((card) => {
      const matches = (!category || card.dataset.category === category) && (!query || card.textContent.toLocaleLowerCase('ru').includes(query));
      card.hidden = !matches; if (matches) visible += 1;
    });
    if (!main.querySelector('.backend-result-count')) {
      const count = document.createElement('p'); count.className = 'backend-result-count'; count.setAttribute('aria-live', 'polite'); input.closest('label')?.insertAdjacentElement('afterend', count);
    }
    main.querySelector('.backend-result-count').textContent = `Найдено мест: ${visible}`;
  };
  input.addEventListener('input', apply);
  filters.forEach((button) => button.addEventListener('click', () => {
    const text = button.textContent.trim().split(/\s+/)[0];
    category = text === 'Все' ? '' : categories.find((item) => item.name.toLocaleLowerCase('ru') === text.toLocaleLowerCase('ru'))?.id || '';
    filters.forEach((item) => { item.classList.remove('border-primary', 'bg-primary', 'text-primary-foreground'); item.classList.add('border-border'); });
    button.classList.add('border-primary', 'bg-primary', 'text-primary-foreground');
    apply();
  }));
  apply();
}

async function installHomeAtlas() {
  const main = document.querySelector('main');
  if (!main?.querySelector('#atlas-map')) return;
  main.querySelector('#atlas-map')?.closest('section')?.querySelector('ol')?.classList.add('atlas-place-list');
  let atlas;
  try {
    atlas = await getAtlas();
  } catch {
    atlas = { categories: FALLBACK_CATEGORIES, places: window.SP?.n || [], quizzes: window.SP?.q || {} };
  }
  if (atlas.places.length) {
    const categoryCounts = new Map(atlas.categories.map((category) => [category.id, atlas.places.filter((place) => place.cat === category.id).length]));
    const taskCount = Object.values(atlas.quizzes || {}).reduce((sum, questions) => sum + questions.length, 0);
    const stats = [...main.querySelectorAll('dl > div')];
    if (stats[0]) stats[0].querySelector('dt')?.replaceChildren(String(atlas.places.length));
    if (stats[1]) stats[1].querySelector('dt')?.replaceChildren(String(taskCount));
    const categorySection = [...main.querySelectorAll('section')].find((section) => section.textContent.includes('Шесть нитей'));
    if (categorySection) {
      const categoryButtons = [...categorySection.querySelectorAll('button')];
      categoryButtons.forEach((button, index) => {
        button.classList.add('atlas-category-filter');
        const category = atlas.categories[index]; if (!category) return;
        const countLabel = [...button.querySelectorAll('span')].find((span) => /мест/i.test(span.textContent));
        if (countLabel) countLabel.textContent = `${categoryCounts.get(category.id) || 0} мест`;
      });
      const cards = [...main.querySelectorAll('a[href^="place-"]')];
      let active = '';
      categoryButtons.forEach((button, index) => button.addEventListener('click', () => {
        const selected = atlas.categories[index];
        active = active === selected?.id ? '' : selected?.id;
        categoryButtons.forEach((item) => item.setAttribute('aria-pressed', String(item === button && Boolean(active))));
        cards.forEach((card) => {
          const slug = card.getAttribute('href').replace(/^place-/, '').replace(/\.html$/, '');
          const place = atlas.places.find((item) => item.id === slug);
          card.hidden = Boolean(active && place && place.cat !== active);
        });
      }));
    }
  }
}

async function installPlaceQuiz() {
  const slug = location.pathname.match(/place-([\w-]+)\.html$/)?.[1];
  if (!slug) return;
  const card = [...document.querySelectorAll('main div.shadow-xl')].find((item) => item.textContent.includes('Задание'));
  if (!card) return;
  let questions;
  try { questions = (await getAtlas()).quizzes?.[slug]; }
  catch {
    // The archive ships with the same quiz bank, so a temporary API outage must not block the task.
    questions = window.SP?.q?.[slug];
  }
  if (!questions?.length) questions = window.SP?.q?.[slug];
  if (!questions?.length) { status(card, 'Для этого места пока нет заданий.', true); return; }
  let index = 0; let score = 0;
  const draw = (feedback = '') => {
    if (index >= questions.length) {
      card.innerHTML = `<p class="text-xs font-semibold uppercase tracking-widest text-primary">Маршрут пройден</p><h2 class="mt-3 font-display text-2xl font-bold">Ваш результат: ${score} из ${questions.length}</h2><p class="mt-3" data-save-message>${token() ? 'Сохраняем результат в профиль…' : 'Войдите, чтобы сохранить результат и баллы.'}</p><button class="backend-primary-button" type="button">Пройти ещё раз</button>`;
      card.querySelector('button').onclick = () => { index = 0; score = 0; draw(); };
      const result = { slug, score, max_score: questions.length };
      if (!token()) {
        queuePendingResult(result);
        return;
      }
      const message = card.querySelector('[data-save-message]');
      api('/atlas/results', { method: 'POST', body: JSON.stringify(result) })
        .then(() => { if (message.isConnected) message.textContent = 'Результат сохранён в базе данных. Баллы добавлены в профиль.'; })
        .catch(() => {
          queuePendingResult(result);
          if (message.isConnected) message.textContent = 'Сервер временно недоступен. Результат сохранён на устройстве и будет отправлен при следующем входе.';
        });
      return;
    }
    const question = questions[index];
    card.innerHTML = `<p class="text-xs font-semibold uppercase tracking-widest text-primary">Задание · ${index + 1} из ${questions.length}</p><h2 class="mt-3 font-display text-xl font-bold leading-snug">${esc(question.q)}</h2><div class="backend-answer-list">${question.a.map((answer, choice) => `<button type="button" data-choice="${choice}">${esc(answer)}</button>`).join('')}</div><p class="backend-quiz-feedback" role="status">${feedback}</p>`;
    card.querySelectorAll('[data-choice]').forEach((button) => button.addEventListener('click', () => {
      const selected = Number(button.dataset.choice); const correct = selected === Number(question.ok);
      if (correct) score += 1;
      card.querySelectorAll('[data-choice]').forEach((item, choice) => { item.disabled = true; if (choice === Number(question.ok)) item.classList.add('backend-answer-correct'); else if (choice === selected) item.classList.add('backend-answer-wrong'); });
      const feedbackNode = card.querySelector('.backend-quiz-feedback');
      feedbackNode.textContent = `${correct ? 'Верно. ' : 'Неверно. '}${question.explanation || ''}`;
      const next = document.createElement('button'); next.className = 'backend-primary-button'; next.type = 'button'; next.textContent = index + 1 === questions.length ? 'Завершить маршрут' : 'Следующий вопрос';
      next.addEventListener('click', () => { index += 1; draw(); }); feedbackNode.after(next);
    }));
  };
  draw();
}

async function installLeaderboard() {
  const main = document.querySelector('main');
  if (!main?.querySelector('h1') || !main.querySelector('button') || !location.pathname.endsWith('/rating.html')) return;
  const labels = { Неделя: 'week', Месяц: 'month', 'Всё время': 'all' };
  const filterRow = [...main.querySelectorAll('div')].find((div) => [...div.children].filter((child) => child.tagName === 'BUTTON').length === 3 && Object.keys(labels).every((name) => div.textContent.includes(name)));
  if (!filterRow) return;
  const content = filterRow.parentElement;
  const podium = content.querySelector('.mt-10.grid');
  const oldList = content.querySelector('ol');
  if (!podium || !oldList) return;
  podium.classList.add('backend-podium');
  const demoRanking = (period) => {
    const multiplier = period === 'all' ? 3 : period === 'month' ? 2 : 1;
    return [
      { name: 'Алеся К.', points: 1040 * multiplier, completed_count: 18 * multiplier },
      { name: 'Микола Д.', points: 930 * multiplier, completed_count: 16 * multiplier },
      { name: 'Дарья С.', points: 870 * multiplier, completed_count: 15 * multiplier },
      { name: 'Ян Б.', points: 790 * multiplier, completed_count: 13 * multiplier },
      { name: 'Вера М.', points: 720 * multiplier, completed_count: 12 * multiplier },
      { name: 'Павел Л.', points: 650 * multiplier, completed_count: 11 * multiplier },
      { name: 'Надежда Р.', points: 590 * multiplier, completed_count: 10 * multiplier },
      { name: 'Тимур В.', points: 510 * multiplier, completed_count: 9 * multiplier },
    ];
  };
  const paintRanking = (ranking, demo = false) => {
    podium.innerHTML = ranking.slice(0, 3).map((person, index) => `<article class="backend-podium-card${demo ? ' is-demo' : ''}"><span>${['🥇', '🥈', '🥉'][index]}</span><b>${esc(person.name || person.username)}</b><strong>${person.points} баллов</strong></article>`).join('');
    oldList.innerHTML = ranking.slice(3).map((person, index) => `<li class="backend-rank-row${demo ? ' is-demo' : ''}"><span>${index + 4}</span><b>${esc(person.name || person.username)}</b><span>${person.completed_count} мест</span><strong>${person.points}</strong></li>`).join('');
    oldList.setAttribute('aria-label', demo ? 'Демонстрационный рейтинг, имена вымышлены' : 'Рейтинг пользователей из базы данных');
    status(content, demo ? 'Демонстрационный рейтинг · имена и результаты вымышлены. Реальные участники появятся после сохранения результатов.' : '');
  };
  let requestId = 0;
  const render = async (period = 'week') => {
    const current = ++requestId;
    try {
      const ranking = await api(`/leaderboard?period=${period}`);
      if (current !== requestId) return;
      if (ranking.length) paintRanking(ranking);
      else paintRanking(demoRanking(period), true);
    } catch {
      if (current === requestId) paintRanking(demoRanking(period), true);
    }
  };
  filterRow.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => {
    const period = labels[button.textContent.trim()]; if (!period) return;
    filterRow.querySelectorAll('button').forEach((item) => { item.classList.remove('border-foreground', 'bg-foreground', 'text-background'); item.classList.add('border-border', 'bg-background'); });
    button.classList.add('border-foreground', 'bg-foreground', 'text-background');
    render(period);
  }));
  await render('week');
}

async function installProfile() {
  const main = document.querySelector('main'); if (!main || !location.pathname.endsWith('/profile.html')) return;
  const hero = main.querySelector('section'); if (!hero) return;
  if (!token()) {
    hero.innerHTML = '<div class="backend-game-panel"><h1 class="font-display text-4xl font-bold">Ваш профиль</h1><p>Войдите или зарегистрируйтесь, чтобы видеть личный прогресс и награды.</p><button class="backend-primary-button">Войти или зарегистрироваться</button></div>';
    hero.querySelector('button').onclick = () => openAuthModal();
    [...main.querySelectorAll('section')].filter((section) => section !== hero).forEach((section) => { section.hidden = true; });
    main.dataset.ready = 'true';
    return;
  }
  try {
    const [user, progress, atlasProgress, rewards] = await Promise.all([api('/me'), api('/progress'), api('/atlas/progress'), api('/rewards/my')]);
    cache.user = user;
    const h1 = hero.querySelector('h1'); if (h1) h1.textContent = user.name || user.username;
    const description = h1?.parentElement?.querySelector('p'); if (description) description.textContent = `${user.email} · ${user.role === 'admin' ? 'Администратор' : 'Исследователь'}`;
    const avatar = hero.querySelector('span.font-display.text-5xl');
    if (avatar) avatar.textContent = (user.name || user.username).slice(0, 1).toLocaleUpperCase('ru');
    const editButton = document.createElement('button');
    editButton.className = 'backend-outline-button'; editButton.type = 'button'; editButton.textContent = 'Изменить имя';
    const editForm = document.createElement('form');
    editForm.className = 'backend-profile-form'; editForm.hidden = true;
    editForm.innerHTML = `<label>Имя в профиле<input name="name" autocomplete="name" minlength="2" maxlength="80" required value="${esc(user.name || user.username)}"></label><p class="backend-profile-email">Email аккаунта: ${esc(user.email)}</p><div class="backend-profile-actions"><button class="backend-primary-button" type="submit">Сохранить</button><button class="backend-outline-button" type="button" data-cancel-edit>Отмена</button></div><p class="backend-status" role="status" aria-live="polite"></p>`;
    const ideaLink = document.createElement('a');
    ideaLink.href = 'ideas.html'; ideaLink.className = 'backend-outline-button';
    ideaLink.textContent = 'Предложить идею';
    const profileActions = document.createElement('div'); profileActions.className = 'backend-profile-actions';
    profileActions.append(editButton, ideaLink);
    description?.after(profileActions, editForm);
    editButton.onclick = () => { editForm.hidden = !editForm.hidden; if (!editForm.hidden) editForm.elements.name.focus(); };
    editForm.querySelector('[data-cancel-edit]').onclick = () => { editForm.hidden = true; editForm.elements.name.value = user.name || user.username; };
    editForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const save = editForm.querySelector('[type="submit"]'); save.disabled = true;
      try {
        const updated = await api('/me', { method: 'PATCH', body: JSON.stringify({ name: editForm.elements.name.value.trim() }) });
        cache.user = updated;
        if (h1) h1.textContent = updated.name || updated.username;
        if (description) description.textContent = `${updated.email} · ${updated.role === 'admin' ? 'Администратор' : 'Исследователь'}`;
        if (avatar) avatar.textContent = (updated.name || updated.username).slice(0, 1).toLocaleUpperCase('ru');
        editForm.hidden = true;
        status(hero, 'Имя профиля сохранено в базе данных.');
      } catch (error) { status(editForm, error.message, true); }
      finally { save.disabled = false; }
    });
    const metricGrid = [...hero.querySelectorAll('div')].find((div) => div.className.includes('grid-cols-3') && div.className.includes('border-t'));
    const metrics = metricGrid ? [...metricGrid.children] : [];
    if (metrics[0]?.querySelector('p.font-display')) metrics[0].querySelector('p.font-display').textContent = String(progress.points);
    if (metrics[1]?.querySelector('p.font-display')) metrics[1].querySelector('p.font-display').textContent = String(rewards.length);
    if (metrics[2]?.querySelector('p.font-display')) {
      const ranking = await api('/leaderboard?period=all');
      const place = ranking.findIndex((item) => item.username === user.username);
      metrics[2].querySelector('p.font-display').textContent = place >= 0 ? `#${place + 1}` : '—';
    }
    const levelLabel = [...hero.querySelectorAll('span')].find((item) => item.textContent.trim().startsWith('До уровня'));
    const levelPanel = levelLabel?.closest('.relative.mt-8');
    if (levelPanel) levelPanel.hidden = true;
    const streakTitle = [...hero.querySelectorAll('p')].find((item) => item.textContent.trim() === 'Серия');
    if (streakTitle?.parentElement) streakTitle.parentElement.hidden = true;
    const recently = [...main.querySelectorAll('a[href^="place-"]')];
    const studied = new Set(atlasProgress.map((item) => item.slug));
    recently.forEach((link) => { const slug = link.getAttribute('href').replace(/^place-/, '').replace(/\.html$/, ''); link.hidden = !studied.has(slug); });
    const recentSection = [...main.querySelectorAll('section')].find((section) => section.textContent.includes('Недавно изучено'));
    if (recentSection && !recently.some((link) => !link.hidden)) recentSection.hidden = true;
    const progressSection = [...main.querySelectorAll('section')].find((section) => section.textContent.includes('Прогресс по направлениям'));
    const completedByCategory = new Map();
    atlasProgress.forEach((item) => completedByCategory.set(item.category, (completedByCategory.get(item.category) || 0) + 1));
    const atlas = await getAtlas();
    if (progressSection) {
      for (const item of atlas.categories) {
        const line = [...progressSection.querySelectorAll('.bg-card')].find((card) => [...card.querySelectorAll('p')].some((label) => label.textContent.trim() === item.name));
        if (!line) continue;
        const percent = item.count ? Math.min(100, Math.round((completedByCategory.get(item.id) || 0) / item.count * 100)) : 0;
        const bar = line.querySelector('[style*="width"], .mt-3 > div'); if (bar) bar.style.width = `${percent}%`;
        const label = [...line.querySelectorAll('span')].find((span) => /%/.test(span.textContent)); if (label) label.textContent = `${percent} %`;
      }
    }
    const rewardsSection = [...main.querySelectorAll('section')].find((section) => section.textContent.includes('Мои награды'));
    if (rewardsSection) {
      const heading = rewardsSection.querySelector('h2');
      const grid = [...rewardsSection.querySelectorAll('div')].find((div) => div.className.includes('grid'));
      if (grid) grid.innerHTML = rewards.length ? rewards.map((item) => `<article class="backend-game-panel"><span>${esc(item.icon)}</span><b>${esc(item.name)}</b><small>${item.cost} баллов</small></article>`).join('') : '<p>Наград пока нет. Их можно получить в магазине за баллы.</p>';
      if (heading && !rewards.length) heading.title = 'Покупки из базы данных';
    }
    const achievements = [...main.querySelectorAll('section')].find((section) => section.textContent.includes('Достижения'));
    if (achievements) {
      const completed = new Set(atlasProgress.map((item) => item.slug));
      const perfect = new Set(atlasProgress.filter((item) => Number(item.score) === Number(item.max_score)).map((item) => item.slug));
      const done = [
        ['Летописец', 'Пройти 10 маршрутов', atlasProgress.length >= 10],
        ['Следопыт', 'Изучить все направления', new Set(atlasProgress.map((item) => item.category)).size >= atlas.categories.length],
        ['Знаток замков', 'Пройти пять замков без ошибок', ['mir', 'nesvizh', 'lida', 'novogrudok', 'kossovo', 'grodno'].filter((slug) => perfect.has(slug)).length >= 5],
        ['Хранитель', 'Изучить все места памяти', ['brest', 'khatyn', 'kurgan', 'trostenets'].every((slug) => completed.has(slug))],
      ];
      const grid = [...achievements.querySelectorAll('div')].find((div) => div.className.includes('grid'));
      if (grid) grid.innerHTML = done.map(([name, description, unlocked]) => `<article class="backend-game-panel"><b>${unlocked ? '✓' : '◇'} ${name}</b><span>${description}</span><small>${unlocked ? 'Получено' : 'В процессе'}</small></article>`).join('');
    }
    main.dataset.ready = 'true';
  } catch (error) {
    hero.innerHTML = `<div class="backend-game-panel"><h1 class="font-display text-2xl font-bold">Не удалось загрузить профиль</h1><p>${esc(error.message)}</p><button class="backend-primary-button" type="button">Повторить</button></div>`;
    hero.querySelector('button').onclick = () => location.reload();
    [...main.querySelectorAll('section')].filter((section) => section !== hero).forEach((section) => { section.hidden = true; });
    main.dataset.ready = 'true';
  }
}

async function installIdeas() {
  const form = document.querySelector('#idea-form');
  if (!form) return;
  if (token()) {
    try {
      const user = cache.user || await api('/me');
      form.elements.name.value = user.name || user.username || '';
      form.elements.email.value = user.email?.endsWith('@local.test') ? '' : user.email || '';
    } catch { /* Guests may also submit ideas. */ }
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]'); button.disabled = true;
    const body = {
      name: form.elements.name.value.trim(),
      email: form.elements.email.value.trim(),
      message: form.elements.message.value.trim(),
    };
    try {
      const result = await api('/suggestions', { method: 'POST', body: JSON.stringify(body) });
      form.elements.message.value = '';
      status(form, result.delivery === 'telegram' ? 'Идея отправлена через Telegram и сохранена. Спасибо!' : 'Идея сохранена. Спасибо! Мы прочитаем её после подключения Telegram-бота.');
    } catch (error) { status(form, `Не удалось отправить идею: ${error.message}`, true); }
    finally { button.disabled = false; }
  });
}

async function installShop() {
  const main = document.querySelector('main'); if (!main || !location.pathname.endsWith('/shop.html')) return;
  try {
    const [items, owned] = await Promise.all([api('/rewards'), token() ? api('/rewards/my') : Promise.resolve([])]);
    const firstCard = [...main.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Получить')?.closest('.group.border');
    const grid = firstCard?.parentElement;
    if (!grid) throw new Error('Не найден каталог наград');
    grid.innerHTML = items.map((item) => `<article class="group border border-border bg-card">
      <div class="grid aspect-[4/3] place-items-center bg-secondary text-6xl" aria-hidden="true">${esc(item.icon)}</div>
      <div class="p-6"><p class="text-xs font-semibold uppercase tracking-widest text-primary">Награда</p>
      <h3 class="mt-1 min-h-14 font-display text-xl font-bold leading-snug">${esc(item.name)}</h3>
      <div class="mt-5 flex items-center justify-between gap-3"><strong>${esc(item.cost)} баллов</strong>
      <button type="button" class="backend-primary-button" data-reward-id="${esc(item.id)}">Получить</button></div></div></article>`).join('');
    const buttons = [...grid.querySelectorAll('[data-reward-id]')];
    const ownedIDs = new Set(owned.map((item) => item.id));
    const points = [...main.querySelectorAll('span,p')].find((item) => /У вас .*баллов/.test(item.textContent));
    const user = token() ? await api('/me') : null;
    if (points) points.textContent = user ? `У вас ${user.points} баллов` : 'Войдите, чтобы увидеть баланс баллов';
    items.forEach((item, index) => {
      const button = buttons[index]; if (!button) return;
      button.dataset.rewardId = item.id;
      const card = button.closest('.group.border');
      if (ownedIDs.has(item.id)) { button.textContent = 'Получено'; button.disabled = true; }
      button.onclick = async () => {
        if (!token()) { openAuthModal(); return; }
        button.disabled = true;
        try {
          const result = await api('/rewards/redeem', { method: 'POST', body: JSON.stringify({ reward_id: item.id }) });
          button.textContent = 'Получено'; ownedIDs.add(item.id);
          if (points) points.textContent = `У вас ${result.points} баллов`;
          if (cache.user) cache.user.points = result.points;
          status(card, `Награда добавлена в профиль. Осталось ${result.points} баллов.`);
        }
        catch (error) { status(card, error.message, true); button.disabled = false; }
      };
    });
  } catch (error) { status(main, `Не удалось загрузить награды: ${error.message}`, true); }
}

async function installChat() {
  const main = document.querySelector('main'); if (!main || !location.pathname.endsWith('/chat.html')) return;
  const aside = main.querySelector('aside'); const view = main.querySelector('section'); if (!aside || !view) return;
  aside.classList.remove('hidden', 'md:block'); aside.classList.add('block', 'overflow-y-auto');
  if (!token()) {
    aside.innerHTML = '<p class="font-display text-xl font-bold">Диалоги</p><p class="mt-4 text-sm">Войдите, чтобы писать участникам.</p><button class="backend-primary-button mt-4">Войти</button>';
    aside.querySelector('button').onclick = () => openAuthModal();
    view.innerHTML = '<div class="grid min-h-full place-items-center p-8 text-center"><div><h1 class="font-display text-2xl font-bold">Личные сообщения</h1><p class="mt-3">Переписка хранится в базе данных и доступна после входа.</p><button class="backend-primary-button mt-5">Войти</button></div></div>';
    view.querySelector('button').onclick = () => openAuthModal(); return;
  }
  let people = []; let peer = '';
  aside.innerHTML = '<p class="font-display text-xl font-bold">Участники</p><div class="backend-chat-people mt-5"></div>';
  view.innerHTML = '<header class="border-b border-border p-5"><h1 class="font-display text-xl font-bold">Выберите собеседника</h1></header><div class="backend-chat-messages flex-1 overflow-y-auto p-5" aria-live="polite"></div><form class="flex gap-2 border-t border-border p-4"><input class="flex-1 border border-border bg-background px-4 py-3 text-sm" maxlength="1000" placeholder="Написать сообщение…" required><button class="bg-primary px-5 text-primary-foreground" type="submit">Отправить</button></form>';
  const list = aside.querySelector('.backend-chat-people'); const messages = view.querySelector('.backend-chat-messages');
  const loadMessages = async () => {
    if (!peer) return;
    const requestedPeer = peer;
    try {
      const items = await api(`/chat/messages?peer=${encodeURIComponent(requestedPeer)}`);
      if (requestedPeer !== peer) return;
      const nearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;
      messages.innerHTML = items.map((item) => `<p class="backend-chat-message ${item.sender === cache.user?.username ? 'backend-chat-mine' : ''}"><b>${esc(item.sender_name || item.sender)}</b><span>${esc(item.text)}</span><time>${esc(item.created_at)}</time></p>`).join('') || '<p>Начните беседу первым сообщением.</p>';
      if (nearBottom) messages.scrollTop = messages.scrollHeight;
    } catch (error) { if (requestedPeer === peer) status(messages, error.message, true); }
  };
  const selectPeer = async (username) => {
    peer = username;
    list.querySelectorAll('button').forEach((button) => button.classList.toggle('bg-primary', button.dataset.username === peer));
    view.querySelector('header h1').textContent = people.find((person) => person.username === peer)?.name || peer;
    await loadMessages();
  };
  try {
    cache.user = cache.user || await api('/me');
    people = await api('/chat/conversations');
    list.innerHTML = people.map((person) => `<button type="button" class="backend-person-button" data-username="${esc(person.username)}"><b>${esc(person.name || person.username)}</b><span>${esc(person.last_message || `${person.points} баллов`)}</span>${person.unread_count ? `<i>${person.unread_count}</i>` : ''}</button>`).join('') || '<p>Пока нет других участников. Пригласите друзей зарегистрироваться.</p>';
    list.querySelectorAll('[data-username]').forEach((button) => button.addEventListener('click', () => selectPeer(button.dataset.username)));
    if (people.length) await selectPeer(people[0].username);
    view.querySelector('form').addEventListener('submit', async (event) => {
      event.preventDefault(); if (!peer) return;
      const input = event.currentTarget.querySelector('input'); const send = event.currentTarget.querySelector('button');
      const message = input.value.trim();
      if (!message) return;
      send.disabled = true;
      try { await api('/chat/messages', { method: 'POST', body: JSON.stringify({ to: peer, text: message }) }); input.value = ''; await loadMessages(); }
      catch (error) { status(view, error.message, true); }
      finally { send.disabled = false; }
    });
    window.setInterval(loadMessages, 7000);
  } catch (error) { status(aside, `Не удалось загрузить диалоги: ${error.message}`, true); }
}

async function installDuelPage() {
  const main = document.querySelector('main'); if (!main || !location.pathname.endsWith('/duels.html')) return;
  const root = main.firstElementChild; const intro = root?.querySelector('section'); if (!root || !intro) return;
  const existing = [...root.children].find((item) => item !== intro && item.classList.contains('mx-auto'));
  const panel = document.createElement('section'); panel.className = 'mx-auto max-w-7xl px-6 py-12'; panel.innerHTML = '<div class="backend-game-panel"><h2>Дуэли с участниками</h2><p>Вызовите игрока и сохраните результат в своём профиле.</p><div class="backend-duel-create"></div><div class="backend-duel-list"></div></div>';
  intro.after(panel); if (existing) existing.hidden = true;
  const create = panel.querySelector('.backend-duel-create'); const duelList = panel.querySelector('.backend-duel-list');
  if (!token()) { create.innerHTML = '<button class="backend-primary-button">Войти, чтобы начать дуэль</button>'; create.querySelector('button').onclick = () => openAuthModal(); return; }
  const refresh = async () => {
    const [people, duels] = await Promise.all([api('/people'), api('/duels')]);
    create.innerHTML = `<label>Найти соперника<input class="backend-select" id="duel-search" type="search" placeholder="Имя участника"></label><label>Соперник<select class="backend-select" id="duel-opponent"><option value="">Выберите участника</option>${people.map((person) => `<option value="${esc(person.username)}">${esc(person.name)} · ${person.points} баллов</option>`).join('')}</select></label><button class="backend-primary-button" data-create-duel ${people.length ? '' : 'disabled'}>Бросить вызов</button><button class="backend-outline-button" type="button" data-refresh-duels>Обновить</button>`;
    create.querySelector('#duel-search').addEventListener('input', (event) => {
      const query = event.target.value.trim().toLocaleLowerCase('ru');
      create.querySelectorAll('#duel-opponent option').forEach((option) => {
        if (option.value) option.hidden = !option.textContent.toLocaleLowerCase('ru').includes(query);
      });
      const selected = create.querySelector('#duel-opponent').selectedOptions[0];
      if (selected?.hidden) create.querySelector('#duel-opponent').value = '';
    });
    create.querySelector('[data-refresh-duels]').onclick = refresh;
    create.querySelector('[data-create-duel]').onclick = async () => {
      const opponent = create.querySelector('select').value; if (!opponent) return status(create, 'Выберите соперника.');
      try { await api('/duels', { method: 'POST', body: JSON.stringify({ opponent }) }); await refresh(); }
      catch (error) { status(create, error.message, true); }
    };
    duelList.innerHTML = duels.length ? duels.map((duel) => {
      const incoming = duel.opponent === cache.user?.username;
      const other = incoming ? (duel.challenger_name || duel.challenger) : (duel.opponent_name || duel.opponent);
      const played = incoming ? duel.opponent_score >= 0 : duel.challenger_score >= 0;
      const action = duel.status === 'pending' && incoming ? `<button data-accept="${duel.id}">Принять</button><button data-decline="${duel.id}">Отклонить</button>` : duel.status === 'active' && !played ? `<button data-play-duel="${duel.id}">Играть</button>` : duel.status === 'active' ? '<span>Ожидаем соперника</span>' : '';
      return `<article class="backend-duel-item"><b>Дуэль с ${esc(other)}</b><span>Статус: ${esc(duel.status)}</span><span>Счёт ${duel.challenger_score < 0 ? '—' : duel.challenger_score} : ${duel.opponent_score < 0 ? '—' : duel.opponent_score}</span>${action}</article>`;
    }).join('') : '<p>Пока дуэлей нет. Выберите соперника выше.</p>';
    duelList.querySelectorAll('[data-accept]').forEach((button) => button.onclick = async () => { try { await api(`/duels/${button.dataset.accept}/accept`, { method: 'POST' }); await refresh(); } catch (error) { status(duelList, error.message, true); } });
    duelList.querySelectorAll('[data-decline]').forEach((button) => button.onclick = async () => { try { await api(`/duels/${button.dataset.decline}/decline`, { method: 'POST' }); await refresh(); } catch (error) { status(duelList, error.message, true); } });
    duelList.querySelectorAll('[data-play-duel]').forEach((button) => button.onclick = async () => {
      try { await renderDuel(button.dataset.playDuel, duelList); } catch (error) { status(duelList, error.message, true); }
    });
  };
  try { cache.user = cache.user || await api('/me'); await refresh(); }
  catch (error) { status(create, `Не удалось загрузить дуэли: ${error.message}`, true); }
}

async function renderDuel(id, target) {
  const duel = await api(`/duels/${id}`);
  runQuestionGame(duel.questions || [], target, 15, async (answers) => {
    const result = await api(`/duels/${id}/finish`, { method: 'POST', body: JSON.stringify({ answers }) });
    target.innerHTML = `<div class="backend-game-panel"><h3>Ответы отправлены</h3><p>${result.status === 'completed' ? 'Дуэль завершена.' : 'Ожидаем ответ соперника.'}</p><button class="backend-outline-button" type="button">К списку дуэлей</button></div>`;
    target.querySelector('button').onclick = () => location.reload();
  });
}

function runQuestionGame(questions, target, seconds, finish) {
  if (!questions.length) { status(target, 'Вопросы не найдены.', true); return; }
  const answers = [];
  let index = 0; let interval;
  const draw = () => {
    clearInterval(interval);
    if (index >= questions.length) {
      target.innerHTML = '<div class="backend-game-panel"><h3>Сохраняем результат…</h3></div>';
      finish(answers).catch((error) => {
        target.innerHTML = '<div class="backend-game-panel"><h3>Не удалось сохранить результат</h3><button class="backend-primary-button" type="button">Повторить отправку</button></div>';
        status(target.firstElementChild, error.message, true);
        target.querySelector('button').onclick = () => { target.innerHTML = '<div class="backend-game-panel"><h3>Сохраняем результат…</h3></div>'; finish(answers).catch((retryError) => status(target.firstElementChild, retryError.message, true)); };
      });
      return;
    }
    const q = questions[index];
    const multiple = Array.isArray(q.correct);
    const selected = new Set();
    let remaining = seconds; let answered = false;
    target.innerHTML = `<div class="backend-game-panel"><div class="flex justify-between gap-3"><p>Вопрос ${index + 1} из ${questions.length}${multiple ? ' · выберите все правильные ответы' : ''}</p><p class="backend-timer" aria-live="off">${remaining} с</p></div><h3>${esc(q.question)}</h3><div class="backend-answer-list">${q.options.map((option, i) => `<button type="button" data-game-answer="${i}" aria-pressed="false">${esc(option)}</button>`).join('')}</div><div class="backend-game-controls"></div><p class="backend-quiz-feedback" role="status"></p></div>`;
    const panel = target.firstElementChild;
    const controls = panel.querySelector('.backend-game-controls');
    const submit = (choices) => {
      if (answered) return;
      answered = true; clearInterval(interval);
      answers.push({ question_id: q.id, selected: choices, time_left: remaining });
      const correct = Array.isArray(q.correct) ? q.correct.map(Number) : [Number(q.correct)];
      const right = choices.length === correct.length && choices.every((choice) => correct.includes(choice));
      panel.querySelectorAll('[data-game-answer]').forEach((button) => {
        button.disabled = true;
        const value = Number(button.dataset.gameAnswer);
        if (correct.includes(value)) button.classList.add('backend-answer-correct');
        else if (choices.includes(value)) button.classList.add('backend-answer-wrong');
      });
      panel.querySelector('.backend-quiz-feedback').textContent = `${choices.length ? right ? 'Верно. ' : 'Неверно. ' : 'Время вышло. '}${q.explanation || ''}`;
      controls.innerHTML = `<button class="backend-primary-button" type="button">${index + 1 === questions.length ? 'Завершить' : 'Следующий вопрос'}</button>`;
      controls.querySelector('button').onclick = () => { index += 1; draw(); };
    };
    panel.querySelectorAll('[data-game-answer]').forEach((button) => button.onclick = () => {
      const choice = Number(button.dataset.gameAnswer);
      if (!multiple) { submit([choice]); return; }
      if (selected.has(choice)) selected.delete(choice); else selected.add(choice);
      button.setAttribute('aria-pressed', String(selected.has(choice)));
      button.classList.toggle('backend-answer-selected', selected.has(choice));
      controls.querySelector('button').disabled = selected.size === 0;
    });
    if (multiple) {
      controls.innerHTML = '<button class="backend-primary-button" type="button" disabled>Подтвердить ответы</button>';
      controls.querySelector('button').onclick = () => submit([...selected]);
    }
    interval = window.setInterval(() => {
      remaining -= 1;
      panel.querySelector('.backend-timer').textContent = `${remaining} с`;
      if (remaining <= 0) submit([...selected]);
    }, 1000);
  };
  draw();
}

async function installTeamBattles() {
  const main = document.querySelector('main'); if (!main || !location.pathname.endsWith('/battles.html')) return;
  const form = main.querySelector('form'); if (!form) return;
  const buttons = [...main.querySelectorAll('button')];
  const joinTab = buttons.find((button) => button.textContent.trim() === 'Ввести код');
  const joinForm = document.createElement('form'); joinForm.className = 'backend-join-form'; joinForm.hidden = true; joinForm.innerHTML = '<label>Код комнаты<input inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" required placeholder="Например, 123456"></label><button class="backend-primary-button" type="submit">Подключиться</button>';
  form.after(joinForm);
  if (joinTab) joinTab.addEventListener('click', () => { form.hidden = true; joinForm.hidden = false; });
  buttons.find((button) => button.textContent.trim() === 'Создать код')?.addEventListener('click', () => { form.hidden = false; joinForm.hidden = true; });
  const game = document.createElement('section'); game.className = 'backend-game-area'; joinForm.after(game);
  const battleStorageKey = cache.user?.username ? `spadchyna_battle_${cache.user.username}` : '';
  const partyName = form.querySelector('#party-name');
  if (partyName && cache.user) {
    partyName.value = cache.user.name || cache.user.username;
    partyName.readOnly = true;
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); if (!token()) { openAuthModal(); return; }
    const submit = form.querySelector('button'); submit.disabled = true;
    try {
      const category = form.querySelector('#party-category').value;
      const count = Math.min(20, Math.max(5, Number(form.querySelector('#party-count').value) || 5));
      form.querySelector('#party-count').value = String(count);
      let battle;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = String(100000 + Math.floor(Math.random() * 900000));
        try { battle = await api('/team-battles', { method: 'POST', body: JSON.stringify({ code, category, question_count: count, time_seconds: Number(form.querySelector('#party-time').value) }) }); break; }
        catch (error) { if (!error.message.includes('already exists')) throw error; }
      }
      if (!battle) throw new Error('Не удалось создать комнату');
      if (battleStorageKey) localStorage.setItem(battleStorageKey, battle.code);
      showBattleRoom(battle, game);
    } catch (error) { status(form, error.message, true); }
    finally { submit.disabled = false; }
  });
  joinForm.addEventListener('submit', async (event) => {
    event.preventDefault(); if (!token()) { openAuthModal(); return; }
    const code = joinForm.querySelector('input').value.trim();
    try {
      const battle = await api(`/team-battles/${encodeURIComponent(code)}/join`, { method: 'POST' });
      if (battleStorageKey) localStorage.setItem(battleStorageKey, battle.code);
      showBattleRoom(battle, game);
    }
    catch (error) { status(joinForm, error.message, true); }
  });
  if (battleStorageKey && localStorage.getItem(battleStorageKey)) {
    try { showBattleRoom(await api(`/team-battles/${encodeURIComponent(localStorage.getItem(battleStorageKey))}`), game); }
    catch { localStorage.removeItem(battleStorageKey); }
  }
}

function showBattleRoom(battle, target) {
  const myResult = battle.participants?.find((person) => person.username === cache.user?.username);
  if (battle.started && myResult?.completed) {
    target.innerHTML = `<div class="backend-game-panel"><h2>Результат сохранён: ${myResult.score} очков</h2><p>Комната ${esc(battle.code)}</p><button class="backend-outline-button" type="button">Обновить участников</button><div class="backend-battle-players"></div></div>`;
    showBattlePlayers(battle, target);
    target.querySelector('button').onclick = async () => { try { showBattleRoom(await api(`/team-battles/${battle.code}`), target); } catch (error) { status(target, error.message, true); } };
    return;
  }
  if (battle.started) { playTeamBattle(battle, target); return; }
  const creator = battle.creator === cache.user?.username;
  target.innerHTML = `<div class="backend-game-panel"><h2>Комната ${esc(battle.code)}</h2><p>Пригласите друзей по коду. ${creator ? 'Начните, когда все подключатся.' : 'Ждём начала от создателя.'}</p><p>${esc(battle.category_label)} · ${battle.questions.length} вопросов · ${battle.time_seconds || 20} с на ответ</p><div class="backend-battle-players"></div>${creator ? '<button class="backend-primary-button" type="button" data-start-battle>Начать батл</button>' : ''}<button class="backend-outline-button" type="button" data-refresh-battle>Обновить комнату</button></div>`;
  showBattlePlayers(battle, target);
  target.querySelector('[data-refresh-battle]').onclick = async () => { try { showBattleRoom(await api(`/team-battles/${battle.code}`), target); } catch (error) { status(target, error.message, true); } };
  target.querySelector('[data-start-battle]')?.addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    try { showBattleRoom(await api(`/team-battles/${battle.code}/start`, { method: 'POST' }), target); }
    catch (error) { status(target.firstElementChild, error.message, true); event.currentTarget.disabled = false; }
  });
}

function playTeamBattle(battle, target) {
  runQuestionGame(battle.questions || [], target, battle.time_seconds || 20, async (answers) => {
    const updated = await api(`/team-battles/${battle.code}/finish`, { method: 'POST', body: JSON.stringify({ answers }) });
    showBattleRoom(updated, target);
  });
}

function showBattlePlayers(battle, target) {
  const panel = target.querySelector('.backend-game-panel'); if (!panel) return;
  const list = target.querySelector('.backend-battle-players');
  if (list) list.innerHTML = `<h3>Участники комнаты</h3>${(battle.participants || []).map((person) => `<p>${esc(person.name || person.username)} · ${person.completed ? `${person.score} очков` : 'ещё отвечает'}</p>`).join('')}`;
}

async function initialize() {
  await installAuth();
  await Promise.allSettled([installHomeAtlas(), installCatalog(), installPlaceQuiz(), installLeaderboard(), installProfile(), installIdeas(), installShop(), installChat(), installDuelPage(), installTeamBattles()]);
}

initialize();
