const API_ROOT = String(import.meta.env.VITE_API_URL || '').trim().replace(/\/$/, '') + '/api';
const TOKEN_KEY = 'cultcode_token';
const TOKEN = () => localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || '';
const api = async (path, options = {}) => {
  const headers = new Headers(options.headers || {});
  if (options.body) headers.set('Content-Type', 'application/json');
  if (TOKEN()) headers.set('Authorization', `Bearer ${TOKEN()}`);
  const response = await fetch(`${API_ROOT}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Ошибка сервера (${response.status})`);
  return payload;
};

const showMessage = (element, message, isError = false) => {
  if (!element) return;
  element.textContent = message;
  element.style.color = isError ? '#b42318' : '';
};

function installAuth() {
  const form = document.querySelector('#dlg form');
  if (!form) return;
  form.innerHTML = `<h3>Вход</h3><input name="name" placeholder="Ваше имя" autocomplete="name" hidden><input name="email" placeholder="Email" type="email" autocomplete="email" required><input name="password" placeholder="Пароль" type="password" autocomplete="current-password" minlength="6" required><button class="btn" type="submit">Войти</button><button type="button" class="btn o" data-auth-mode>Создать аккаунт</button><p class="meta" role="status"></p>`;
  let registering = false;
  form.querySelector('[data-auth-mode]').onclick = () => {
    registering = !registering;
    form.querySelector('h3').textContent = registering ? 'Регистрация' : 'Вход';
    form.elements.name.hidden = !registering;
    form.elements.name.required = registering;
    form.elements.password.autocomplete = registering ? 'new-password' : 'current-password';
    form.querySelector('[type=submit]').textContent = registering ? 'Создать аккаунт' : 'Войти';
    form.querySelector('[data-auth-mode]').textContent = registering ? 'Уже есть аккаунт? Войти' : 'Создать аккаунт';
    showMessage(form.querySelector('[role=status]'), '');
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type=submit]');
    const status = form.querySelector('[role=status]');
    button.disabled = true;
    try {
      const body = { email: form.elements.email.value, password: form.elements.password.value };
      if (registering) body.name = form.elements.name.value;
      const result = await api(registering ? '/register' : '/login', { method: 'POST', body: JSON.stringify(body) });
      localStorage.setItem(TOKEN_KEY, result.token);
      sessionStorage.setItem(TOKEN_KEY, result.token);
      const pending = JSON.parse(localStorage.getItem('spadchyna_pending_quiz_results') || '[]');
      for (const item of pending) await api('/atlas/results', { method: 'POST', body: JSON.stringify(item) });
      localStorage.removeItem('spadchyna_pending_quiz_results');
      location.reload();
    } catch (error) {
      showMessage(status, error.message, true);
    } finally {
      button.disabled = false;
    }
  };

  const headerButton = document.querySelector('header .btn');
  if (headerButton && TOKEN()) {
    api('/me').then((user) => {
      headerButton.textContent = user.name || user.username || 'Профиль';
      headerButton.onclick = () => { location.href = 'profile.html'; };
    }).catch(() => {
      localStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
    });
  }
}

function installQuizPersistence() {
  const quiz = document.querySelector('#qz');
  if (!quiz) return;
  let correct = 0;
  let lastSaved = false;
  const slug = new URLSearchParams(location.search).get('id') || 'mir';
  const questions = window.DATA?.quizzes?.[slug] || [];
  quiz.addEventListener('click', (event) => {
    const answer = event.target.closest('.ans button');
    if (!answer) return;
    const match = quiz.querySelector('.meta')?.textContent.match(/Вопрос\s+(\d+)/i);
    const index = Number(match?.[1] || 0) - 1;
    if (index >= 0 && Number(answer.dataset.k) === questions[index]?.ok) correct += 1;
  }, true);
  const saveWhenFinished = async () => {
    if (lastSaved || !quiz.querySelector('h3')?.textContent.startsWith('Готово!')) return;
    lastSaved = true;
    const result = { slug, score: correct, max_score: questions.length };
    if (!TOKEN()) {
      const pending = JSON.parse(localStorage.getItem('spadchyna_pending_quiz_results') || '[]');
      localStorage.setItem('spadchyna_pending_quiz_results', JSON.stringify([...pending.filter((item) => item.slug !== slug), result]));
      showMessage(document.querySelector('#sc')?.parentElement, 'Войдите, чтобы сохранить результат и баллы.', true);
      return;
    }
    try {
      await api('/atlas/results', { method: 'POST', body: JSON.stringify(result) });
    } catch (error) {
      lastSaved = false;
      showMessage(document.querySelector('#sc')?.parentElement, `Результат не сохранён: ${error.message}`, true);
    }
  };
  new MutationObserver(saveWhenFinished).observe(quiz, { childList: true, subtree: true });
}

async function installLeaderboard() {
  if (!document.querySelector('#tb') || !document.querySelector('#pod')) return;
  try {
    const ranking = await api('/leaderboard');
    const podium = document.querySelector('#pod');
    const table = document.querySelector('#tb');
    const top = ranking.slice(0, 3);
    const heights = [300, 220, 160];
    podium.innerHTML = top.map((user, index) => `<div><b>${escapeHTML(user.username)}</b><p class="meta">${user.points} баллов</p><div class="b" style="height:${heights[index]}px">${index + 1}</div></div>`).join('');
    table.innerHTML = '<tr><th>#</th><th>Имя</th><th>Пройдено мест</th><th>Баллы</th></tr>' + ranking.map((user, index) => `<tr><td>${index + 1}</td><td>${escapeHTML(user.username)}</td><td>${user.completed_count || 0}</td><td><b>${user.points || 0}</b></td></tr>`).join('');
    if (!ranking.length) table.innerHTML += '<tr><td colspan="4">Пока никто не проходил задания. Зарегистрируйтесь и станьте первым!</td></tr>';
  } catch (error) {
    showMessage(document.querySelector('.ph p'), `Не удалось загрузить рейтинг: ${error.message}`, true);
  }
}

async function installProfile() {
  if (!document.querySelector('#pr')) return;
  if (!TOKEN()) {
    const panel = document.querySelector('.ph');
    if (panel) panel.innerHTML = '<h1>Профиль</h1><p>Войдите или зарегистрируйтесь, чтобы увидеть личный прогресс.</p><button class="btn" onclick="dlg.classList.add(\'on\')">Войти</button>';
    return;
  }
  try {
    const [user, progress, rewards] = await Promise.all([api('/me'), api('/progress'), api('/rewards/my')]);
    const heading = document.querySelector('.ph h1');
    if (heading) heading.textContent = user.name || user.username;
    const subtitle = document.querySelector('.ph p');
    if (subtitle) subtitle.textContent = `${user.email} · ${user.points} баллов · ${user.role === 'admin' ? 'Администратор' : 'Исследователь'}`;
    const stats = document.querySelector('.stats');
    if (stats) stats.innerHTML = `<div><b>${progress.points}</b>баллов</div><div><b>${progress.completed}</b>пройдено мест</div><div><b>${rewards.length}</b>наград</div>`;
    const result = await api('/atlas/progress');
    const place = document.querySelector('#pr');
    place.innerHTML = window.DATA.categories.map((category) => {
      const count = window.DATA.places.filter((item) => item.cat === category.id).length;
      const percent = count ? Math.round(Math.min(100, result.filter((item) => item.category === category.id).length / count * 100)) : 0;
      return `<p style="margin-top:18px">${escapeHTML(category.name)}</p><div class="bar"><i style="width:${percent}%"></i></div>`;
    }).join('');
  } catch (error) {
    showMessage(document.querySelector('.ph p'), `Не удалось загрузить профиль: ${error.message}`, true);
  }
}

async function installShop() {
  const grid = document.querySelector('#g');
  if (!grid) return;
  try {
    const [items, owned] = await Promise.all([api('/rewards'), TOKEN() ? api('/rewards/my') : Promise.resolve([])]);
    const ownedIDs = new Set(owned.map((item) => item.id));
    grid.innerHTML = items.map((item) => `<div class="card"><div style="font-size:64px;text-align:center;background:var(--soft);padding:30px">${item.icon}</div><div><h3>${escapeHTML(item.name)}</h3><p class="meta">${item.cost} баллов</p><button class="btn o" style="margin-top:12px" data-reward-id="${escapeHTML(item.id)}" ${ownedIDs.has(item.id) ? 'disabled' : ''}>${ownedIDs.has(item.id) ? 'Получено' : 'Получить'}</button></div></div>`).join('');
    grid.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-reward-id]');
      if (!button) return;
      if (!TOKEN()) { document.querySelector('#dlg')?.classList.add('on'); return; }
      button.disabled = true;
      try {
        await api('/rewards/redeem', { method: 'POST', body: JSON.stringify({ reward_id: button.dataset.rewardId }) });
        button.textContent = 'Получено';
      } catch (error) {
        button.disabled = false;
        alert(error.message);
      }
    });
  } catch (error) {
    showMessage(document.querySelector('.ph p'), `Не удалось загрузить награды: ${error.message}`, true);
  }
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

async function installBattles() {
  const box = document.querySelector('#bx');
  if (!box) return;
  const create = [...box.querySelectorAll('button')].find((button) => button.textContent.includes('Создать код и начать'));
  if (create) {
    const join = document.createElement('button');
    join.className = 'btn o';
    join.type = 'button';
    join.textContent = 'Войти по коду комнаты';
    join.style.marginLeft = '10px';
    create.insertAdjacentElement('afterend', join);
    join.addEventListener('click', async () => {
      if (!TOKEN()) { document.querySelector('#dlg')?.classList.add('on'); return; }
      const code = prompt('Введите шестизначный код командной комнаты:');
      if (!code) return;
      join.disabled = true;
      try {
        const battle = await api(`/team-battles/${encodeURIComponent(code.trim())}/join`, { method: 'POST' });
        renderOnlineBattle(box, battle, false);
      } catch (error) {
        alert(error.message);
        join.disabled = false;
      }
    });
  }
  box.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button || !button.textContent.includes('Создать код и начать')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!TOKEN()) { document.querySelector('#dlg')?.classList.add('on'); return; }
    button.disabled = true;
    try {
      const category = document.querySelector('#c').value;
      const count = Number(document.querySelector('#n').value);
      let battle;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = String(100000 + Math.floor(Math.random() * 900000));
        try {
          battle = await api('/team-battles', { method: 'POST', body: JSON.stringify({ code, category, question_count: count }) });
          break;
        } catch (error) { if (!error.message.includes('already exists')) throw error; }
      }
      if (!battle) throw new Error('Не удалось подобрать код комнаты');
      renderOnlineBattle(box, battle, true);
    } catch (error) {
      alert(error.message);
      button.disabled = false;
    }
  }, true);
}

function renderOnlineBattle(box, battle, creator) {
  const questions = battle.questions || [];
  const answers = [];
  let index = 0;
  let score = 0;
  if (!battle.started && creator) api(`/team-battles/${battle.code}/start`, { method: 'POST' }).catch(() => {});
  const step = () => {
    if (index >= questions.length) {
      box.innerHTML = `<h3>Готово! ${score} баллов</h3><p class="meta">Результат сохранён в командной комнате ${battle.code}.</p><button class="btn" onclick="location.reload()">Ещё раз</button>`;
      api(`/team-battles/${battle.code}/finish`, { method: 'POST', body: JSON.stringify({ answers }) })
        .then(() => api('/me'))
        .catch((error) => showMessage(box.querySelector('.meta'), `Ошибка сохранения: ${error.message}`, true));
      return;
    }
    const question = questions[index];
    box.innerHTML = `<p class="meta">Комната ${battle.code} · вопрос ${index + 1}/${questions.length} · очки ${score}</p><h3>${escapeHTML(question.question)}</h3><div class="ans">${question.options.map((answer, option) => `<button data-answer="${option}">${escapeHTML(answer)}</button>`).join('')}</div><p class="meta" style="margin-top:14px" id="battleFeedback"></p>`;
    box.querySelectorAll('[data-answer]').forEach((answerButton) => answerButton.addEventListener('click', () => {
      const selected = Number(answerButton.dataset.answer);
      const correct = Number(question.correct);
      box.querySelectorAll('[data-answer]').forEach((item) => { item.disabled = true; });
      box.querySelector(`[data-answer="${correct}"]`)?.classList.add('ok');
      if (selected !== correct) answerButton.classList.add('bad');
      else score += 500;
      answers.push({ question_id: question.id, selected: [selected], time_left: 15 });
      box.querySelector('#battleFeedback').innerHTML = `${escapeHTML(question.explanation || '')}<br><br><button class="btn" id="battleNext">${index + 1 < questions.length ? 'Дальше' : 'Результат'}</button>`;
      box.querySelector('#battleNext').onclick = () => { index += 1; step(); };
    }));
  };
  step();
}

installAuth();
installQuizPersistence();
installLeaderboard();
installProfile();
installShop();
installBattles();
