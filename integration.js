const API_ROOT = `${String(import.meta.env.VITE_API_URL || '').trim().replace(/\/$/, '')}/api`;
const TOKEN_KEY = 'cultcode_token';
const PENDING_KEY = 'spadchyna_pending_quiz_results';
const token = () => localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || '';
const cache = { atlas: null, user: null };

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');
  if (options.body) headers.set('Content-Type', 'application/json');
  if (token()) headers.set('Authorization', `Bearer ${token()}`);
  const response = await fetch(`${API_ROOT}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Ошибка сервера (${response.status})`);
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
const getAtlas = () => cache.atlas || (cache.atlas = api('/atlas'));

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
        const next = new URLSearchParams(location.search).get('next');
        location.href = next || 'profile.html';
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
    try { await api('/atlas/results', { method: 'POST', body: JSON.stringify(result) }); }
    catch { failed.push(result); }
  }
  if (failed.length) localStorage.setItem(PENDING_KEY, JSON.stringify(failed));
  else localStorage.removeItem(PENDING_KEY);
}

function queuePendingResult(result) {
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
    localStorage.setItem(PENDING_KEY, JSON.stringify([...pending.filter((item) => item.slug !== result.slug), result]));
  } catch {
    localStorage.setItem(PENDING_KEY, JSON.stringify([result]));
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
        await syncPendingResults();
        location.href = new URLSearchParams(location.search).get('next') || 'profile.html';
      } catch (error) { status(pageForm, error.message, true); submit.disabled = false; }
    });
    if (token()) location.href = 'profile.html';
  }
  if (token()) {
    try {
      const user = cache.user || await api('/me'); cache.user = user;
      document.querySelectorAll('header button').forEach((button) => {
        if (button.textContent.trim() === 'Войти') { button.textContent = 'Профиль'; button.title = `${user.name} · ${user.points} баллов`; }
      });
    } catch {
      localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY);
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
    category = text === 'Все' ? '' : (atlas?.categories || []).find((item) => item.name.toLocaleLowerCase('ru') === text.toLocaleLowerCase('ru'))?.id || '';
    filters.forEach((item) => { item.classList.remove('border-primary', 'bg-primary', 'text-primary-foreground'); item.classList.add('border-border'); });
    button.classList.add('border-primary', 'bg-primary', 'text-primary-foreground');
    apply();
  }));
  apply();
}

async function installHomeAtlas() {
  const main = document.querySelector('main');
  if (!main?.querySelector('#atlas-map')) return;
  try {
    const atlas = await getAtlas();
    const categoryCounts = new Map(atlas.categories.map((category) => [category.id, atlas.places.filter((place) => place.cat === category.id).length]));
    const taskCount = Object.values(atlas.quizzes || {}).reduce((sum, questions) => sum + questions.length, 0);
    const stats = [...main.querySelectorAll('dl > div')];
    if (stats[0]) stats[0].querySelector('dt')?.replaceChildren(String(atlas.places.length));
    if (stats[1]) stats[1].querySelector('dt')?.replaceChildren(String(taskCount));
    const categorySection = [...main.querySelectorAll('section')].find((section) => section.textContent.includes('Шесть нитей'));
    if (categorySection) {
      const categoryButtons = [...categorySection.querySelectorAll('button')];
      categoryButtons.forEach((button, index) => {
        const category = atlas.categories[index]; if (!category) return;
        const countLabel = [...button.querySelectorAll('span')].find((span) => /мест/i.test(span.textContent));
        if (countLabel) countLabel.textContent = `${categoryCounts.get(category.id) || 0} мест`;
      });
      const cards = [...main.querySelectorAll('a[href^="place-"]')];
      categoryButtons.forEach((button, index) => button.addEventListener('click', () => {
        const selected = atlas.categories[index];
        cards.forEach((card) => {
          const slug = card.getAttribute('href').replace(/^place-/, '').replace(/\.html$/, '');
          const place = atlas.places.find((item) => item.id === slug);
          card.hidden = Boolean(place && place.cat !== selected?.id);
        });
      }));
    }
  } catch (error) { status(main, `Карта использует сохранённые данные: ${error.message}`, true); }
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
      card.innerHTML = `<p class="text-xs font-semibold uppercase tracking-widest text-primary">Маршрут пройден</p><h2 class="mt-3 font-display text-2xl font-bold">Ваш результат: ${score} из ${questions.length}</h2><p class="mt-3">${token() ? 'Сохраняем результат в профиль…' : 'Войдите, чтобы сохранить результат и баллы.'}</p><button class="backend-primary-button" type="button">Пройти ещё раз</button>`;
      card.querySelector('button').onclick = () => { index = 0; score = 0; draw(); };
      const result = { slug, score, max_score: questions.length };
      if (!token()) {
        queuePendingResult(result);
        return;
      }
      api('/atlas/results', { method: 'POST', body: JSON.stringify(result) })
        .then(() => { card.querySelector('p:nth-of-type(2)').textContent = 'Результат сохранён в базе данных. Баллы добавлены в профиль.'; })
        .catch(() => {
          queuePendingResult(result);
          card.querySelector('p:nth-of-type(2)').textContent = 'Сервер временно недоступен. Результат сохранён на устройстве и будет отправлен при следующем входе.';
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
  const render = async (period = 'week') => {
    try {
      const ranking = await api(`/leaderboard?period=${period}`);
      const top = ranking.slice(0, 3);
      podium.innerHTML = top.length ? top.map((person, index) => `<article class="backend-podium-card"><span>${['🥇', '🥈', '🥉'][index]}</span><b>${esc(person.name || person.username)}</b><strong>${person.points} баллов</strong></article>`).join('') : '<p>Пока нет результатов за этот период.</p>';
      oldList.innerHTML = ranking.length ? ranking.slice(3).map((person, index) => `<li class="backend-rank-row"><span>${index + 4}</span><b>${esc(person.name || person.username)}</b><span>${person.completed_count} мест</span><strong>${person.points}</strong></li>`).join('') : '';
      oldList.setAttribute('aria-label', 'Рейтинг пользователей из базы данных');
      if (!ranking.length) status(content, 'Пройдите задания, чтобы первым появиться в рейтинге.');
    } catch (error) { status(content, `Не удалось загрузить рейтинг: ${error.message}`, true); }
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
    description?.after(editButton, editForm);
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
    const levelPanel = [...hero.querySelectorAll('div')].find((div) => div.classList.contains('relative') && div.textContent.includes('До уровня'));
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
        ['Летописец', 'Пройти 10 заданий', atlasProgress.length >= 10],
        ['Следопыт', 'Изучить все направления', new Set(atlasProgress.map((item) => item.category)).size >= atlas.categories.length],
        ['Знаток замков', 'Пройти пять замков без ошибок', ['mir', 'nesvizh', 'lida', 'novogrudok', 'kossovo', 'grodno'].filter((slug) => perfect.has(slug)).length >= 5],
        ['Хранитель', 'Изучить все места памяти', ['brest', 'khatyn', 'kurgan', 'trostenets'].every((slug) => completed.has(slug))],
      ];
      const grid = [...achievements.querySelectorAll('div')].find((div) => div.className.includes('grid'));
      if (grid) grid.innerHTML = done.map(([name, description, unlocked]) => `<article class="backend-game-panel"><b>${unlocked ? '✓' : '◇'} ${name}</b><span>${description}</span><small>${unlocked ? 'Получено' : 'В процессе'}</small></article>`).join('');
    }
    const logout = document.createElement('button'); logout.className = 'backend-outline-button'; logout.textContent = 'Выйти'; logout.onclick = () => { localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY); location.href = 'index.html'; }; h1?.after(logout);
  } catch (error) { status(hero, `Не удалось загрузить профиль: ${error.message}`, true); }
}

async function installShop() {
  const main = document.querySelector('main'); if (!main || !location.pathname.endsWith('/shop.html')) return;
  try {
    const [items, owned] = await Promise.all([api('/rewards'), token() ? api('/rewards/my') : Promise.resolve([])]);
    const buttons = [...main.querySelectorAll('button')].filter((button) => button.textContent.trim() === 'Получить');
    const ownedIDs = new Set(owned.map((item) => item.id));
    items.forEach((item, index) => {
      const button = buttons[index]; if (!button) return;
      button.dataset.rewardId = item.id;
      const card = button.closest('.group.border') || button.parentElement.parentElement;
      const title = card.querySelector('h3, .font-display.text-xl') || [...card.querySelectorAll('p')].find((node) => node.className.includes('font-display'));
      if (title) title.textContent = item.name;
      const cost = [...card.querySelectorAll('span')].find((node) => /^\s*\d+\s*$/.test(node.textContent));
      if (cost) cost.textContent = String(item.cost);
      const icon = [...card.querySelectorAll('svg')].find((node) => node.getAttribute('class')?.includes('lucide-star'));
      if (icon) icon.setAttribute('aria-label', `${item.cost} баллов`);
      if (ownedIDs.has(item.id)) { button.textContent = 'Получено'; button.disabled = true; }
      button.onclick = async () => {
        if (!token()) { openAuthModal(); return; }
        button.disabled = true;
        try { await api('/rewards/redeem', { method: 'POST', body: JSON.stringify({ reward_id: item.id }) }); button.textContent = 'Получено'; const me = await api('/me'); cache.user = me; status(card, `Награда добавлена в профиль. Осталось ${me.points} баллов.`); }
        catch (error) { status(card, error.message, true); button.disabled = false; }
      };
    });
    const points = [...main.querySelectorAll('span,p')].find((item) => /У вас .*баллов/.test(item.textContent));
    if (points) {
      if (token()) { const me = await api('/me'); points.textContent = `У вас ${me.points} баллов`; }
      else points.innerHTML = 'Войдите, чтобы увидеть баланс баллов';
    }
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
    try {
      const items = await api(`/chat/messages?peer=${encodeURIComponent(peer)}`);
      messages.innerHTML = items.map((item) => `<p class="backend-chat-message ${item.sender === cache.user?.username ? 'backend-chat-mine' : ''}"><b>${esc(item.sender_name || item.sender)}</b><span>${esc(item.text)}</span><time>${esc(item.created_at)}</time></p>`).join('') || '<p>Начните беседу первым сообщением.</p>';
      messages.scrollTop = messages.scrollHeight;
    } catch (error) { status(messages, error.message, true); }
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
      send.disabled = true;
      try { await api('/chat/messages', { method: 'POST', body: JSON.stringify({ to: peer, text: input.value.trim() }) }); input.value = ''; await loadMessages(); }
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
    create.innerHTML = `<label>Соперник<select class="backend-select" id="duel-opponent"><option value="">Выберите участника</option>${people.map((person) => `<option value="${esc(person.username)}">${esc(person.name)} · ${person.points} баллов</option>`).join('')}</select></label><button class="backend-primary-button" data-create-duel ${people.length ? '' : 'disabled'}>Бросить вызов</button>`;
    create.querySelector('[data-create-duel]').onclick = async () => {
      const opponent = create.querySelector('select').value; if (!opponent) return status(create, 'Выберите соперника.');
      try { await api('/duels', { method: 'POST', body: JSON.stringify({ opponent }) }); await refresh(); }
      catch (error) { status(create, error.message, true); }
    };
    duelList.innerHTML = duels.length ? duels.map((duel) => {
      const incoming = duel.opponent === cache.user?.username;
      const other = incoming ? (duel.challenger_name || duel.challenger) : (duel.opponent_name || duel.opponent);
      const action = duel.status === 'pending' && incoming ? `<button data-accept="${duel.id}">Принять</button><button data-decline="${duel.id}">Отклонить</button>` : duel.status === 'active' ? `<button data-play-duel="${duel.id}">Играть</button>` : '';
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
  const duel = await api(`/duels/${id}`); const questions = duel.questions || []; const answers = []; let index = 0;
  const draw = () => {
    if (index >= questions.length) {
      target.innerHTML = '<h3>Сохраняем результат дуэли…</h3>';
      api(`/duels/${id}/finish`, { method: 'POST', body: JSON.stringify({ answers }) }).then((result) => { target.innerHTML = `<h3>Ответы отправлены</h3><p>Текущий статус: ${esc(result.status || 'ожидаем соперника')}</p><button class="backend-outline-button" onclick="location.reload()">Обновить дуэли</button>`; }).catch((error) => status(target, error.message, true)); return;
    }
    const q = questions[index]; target.innerHTML = `<div class="backend-game-panel"><p>Вопрос ${index + 1} из ${questions.length}</p><h3>${esc(q.question)}</h3><div class="backend-answer-list">${q.options.map((option, i) => `<button data-duel-answer="${i}">${esc(option)}</button>`).join('')}</div></div>`;
    target.querySelectorAll('[data-duel-answer]').forEach((button) => button.onclick = () => { const selected = Number(button.dataset.duelAnswer); answers.push({ question_id: q.id, selected: [selected], time_left: 15 }); index += 1; draw(); });
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
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); if (!token()) { openAuthModal(); return; }
    const submit = form.querySelector('[type=submit]'); submit.disabled = true;
    try {
      const category = form.querySelector('#party-category').value;
      const count = Math.min(30, Math.max(5, Number(form.querySelector('#party-count').value) || 5));
      form.querySelector('#party-count').value = String(count);
      let battle;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = String(100000 + Math.floor(Math.random() * 900000));
        try { battle = await api('/team-battles', { method: 'POST', body: JSON.stringify({ code, category, question_count: count }) }); break; }
        catch (error) { if (!error.message.includes('already exists')) throw error; }
      }
      if (!battle) throw new Error('Не удалось создать комнату');
      if (!battle.started) battle = await api(`/team-battles/${battle.code}/start`, { method: 'POST' });
      playTeamBattle(battle, game);
    } catch (error) { status(form, error.message, true); }
    finally { submit.disabled = false; }
  });
  joinForm.addEventListener('submit', async (event) => {
    event.preventDefault(); if (!token()) { openAuthModal(); return; }
    const code = joinForm.querySelector('input').value.trim();
    try { const battle = await api(`/team-battles/${encodeURIComponent(code)}/join`, { method: 'POST' }); playTeamBattle(battle, game); }
    catch (error) { status(joinForm, error.message, true); }
  });
}

function playTeamBattle(battle, target) {
  const questions = battle.questions || []; const answers = []; let index = 0; let score = 0;
  const draw = () => {
    if (index >= questions.length) {
      target.innerHTML = `<div class="backend-game-panel"><h2>Готово! ${score} баллов</h2><p>Код комнаты <b>${esc(battle.code)}</b>. Результат сохраняется в базе.</p><button class="backend-outline-button" data-refresh-battle>Обновить участников</button><div class="backend-battle-players"></div></div>`;
      api(`/team-battles/${battle.code}/finish`, { method: 'POST', body: JSON.stringify({ answers }) }).then((updated) => showBattlePlayers(updated, target)).catch((error) => status(target, error.message, true));
      target.querySelector('[data-refresh-battle]').onclick = async () => { try { showBattlePlayers(await api(`/team-battles/${battle.code}`), target); } catch (error) { status(target, error.message, true); } };
      return;
    }
    const q = questions[index]; target.innerHTML = `<div class="backend-game-panel"><p>Комната ${esc(battle.code)} · вопрос ${index + 1}/${questions.length}</p><h2>${esc(q.question)}</h2><div class="backend-answer-list">${q.options.map((answer, choice) => `<button data-battle-answer="${choice}">${esc(answer)}</button>`).join('')}</div><p class="backend-quiz-feedback" role="status"></p></div>`;
    target.querySelectorAll('[data-battle-answer]').forEach((button) => button.onclick = () => {
      const selected = Number(button.dataset.battleAnswer); const correct = Number(q.correct); if (selected === correct) score += 500;
      target.querySelectorAll('[data-battle-answer]').forEach((item, choice) => { item.disabled = true; if (choice === correct) item.classList.add('backend-answer-correct'); else if (choice === selected) item.classList.add('backend-answer-wrong'); });
      answers.push({ question_id: q.id, selected: [selected], time_left: 15 });
      const feedback = target.querySelector('.backend-quiz-feedback'); feedback.textContent = q.explanation || (selected === correct ? 'Верно!' : 'Попробуйте следующий вопрос.');
      const next = document.createElement('button'); next.className = 'backend-primary-button'; next.textContent = index + 1 === questions.length ? 'Завершить' : 'Далее'; next.onclick = () => { index += 1; draw(); }; feedback.after(next);
    });
  };
  draw();
}

function showBattlePlayers(battle, target) {
  const panel = target.querySelector('.backend-game-panel'); if (!panel) return;
  const list = target.querySelector('.backend-battle-players');
  if (list) list.innerHTML = `<h3>Участники комнаты</h3>${(battle.participants || []).map((person) => `<p>${esc(person.name || person.username)} · ${person.completed ? `${person.score} очков` : 'ещё отвечает'}</p>`).join('')}`;
}

async function initialize() {
  await installAuth();
  await Promise.allSettled([installHomeAtlas(), installCatalog(), installPlaceQuiz(), installLeaderboard(), installProfile(), installShop(), installChat(), installDuelPage(), installTeamBattles()]);
}

initialize();
