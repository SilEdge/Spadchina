export const placeURL = (place) => window.SP?.n?.some((item) => item.id === place.id)
  ? `place-${place.id}.html` : `article.html?slug=${encodeURIComponent(place.id)}`;
const categoryLabel = (atlas, place) => atlas.categories.find((item) => item.id === place.cat)?.name || 'История';

export async function installCatalog({ getAtlas, api, esc, status, token }) {
  const main = document.querySelector('main');
  const input = main?.querySelector('input[placeholder="Найти место…"]');
  const grid = main?.querySelector('a[href^="place-"]')?.parentElement;
  if (!input || !grid) return;
  grid.classList.add('catalog-place-grid');
  let atlas;
  try { atlas = await getAtlas(); }
  catch { status(main, 'Не удалось обновить каталог. Перезагрузите страницу.', true); return; }
  grid.innerHTML = atlas.places.map((place) => `<a class="group relative flex min-h-[260px] flex-col bg-card p-7 transition-colors hover:bg-forest hover:text-forest-foreground" data-category="${esc(place.cat)}" data-slug="${esc(place.id)}" href="${placeURL(place)}"><div class="text-xs font-semibold uppercase tracking-widest text-primary group-hover:text-forest-foreground">${esc(categoryLabel(atlas, place))}</div><h2 class="mt-6 text-3xl font-bold leading-tight">${esc(place.name)}</h2><p class="mt-2 text-sm opacity-70">${esc([place.region, place.era].filter(Boolean).join(' · '))}</p><p class="mt-4 line-clamp-2 text-sm opacity-80">${esc(place.lead)}</p><div class="mt-auto flex items-center justify-between pt-6 text-sm font-semibold"><span>${place.tasks} заданий · +${place.pts}</span><span aria-hidden="true">↗</span></div></a>`).join('');
  const cards = [...grid.children];
  const filters = [...main.querySelectorAll('button')].filter((button) => button.textContent.trim());
  let category = '';
  if (token()) {
    try {
      const progress = new Set((await api('/atlas/progress')).map((item) => item.slug));
      cards.forEach((card) => { if (progress.has(card.dataset.slug)) card.insertAdjacentHTML('beforeend', '<span class="backend-completed">Изучено</span>'); });
    } catch { /* Keep browsing available if progress cannot be loaded. */ }
  }
  const count = document.createElement('p'); count.className = 'backend-result-count'; count.setAttribute('aria-live', 'polite');
  input.closest('label')?.insertAdjacentElement('afterend', count);
  const apply = () => {
    const query = input.value.trim().toLocaleLowerCase('ru'); let visible = 0;
    cards.forEach((card) => { card.hidden = !((!category || card.dataset.category === category) && (!query || card.textContent.toLocaleLowerCase('ru').includes(query))); if (!card.hidden) visible += 1; });
    count.textContent = `Найдено мест: ${visible}`;
  };
  input.addEventListener('input', apply);
  filters.forEach((button) => {
    const text = button.textContent.trim().split(/\s+/)[0];
    const item = atlas.categories.find((item) => item.name.toLocaleLowerCase('ru') === text.toLocaleLowerCase('ru'));
    if (item) button.textContent = `${item.name} ${item.count}`;
    button.addEventListener('click', () => {
      category = item?.id || '';
      filters.forEach((filter) => { filter.classList.remove('border-primary', 'bg-primary', 'text-primary-foreground'); filter.classList.add('border-border'); });
      button.classList.add('border-primary', 'bg-primary', 'text-primary-foreground'); apply();
    });
  });
  apply();
}

export async function installHomeAtlas({ getAtlas, esc }) {
  const main = document.querySelector('main'); const target = main?.querySelector('#atlas-map');
  if (!target) return;
  let atlas;
  try { atlas = await getAtlas(); }
  catch { atlas = { categories: [], places: window.SP?.n || [], coords: window.SP?.c || {} }; }
  const list = main.querySelector('#atlas-map')?.closest('section')?.querySelector('ol');
  if (list) {
    list.classList.add('atlas-place-list');
    const featuredIDs = ['mir', 'nesvizh', 'pushcha', 'brest', 'skorina', 'krasny'];
    const featured = featuredIDs.map((id) => atlas.places.find((place) => place.id === id)).filter(Boolean);
    for (const place of atlas.places) {
      if (featured.length >= 6) break;
      if (!featured.includes(place)) featured.push(place);
    }
    list.innerHTML = featured.map((place, index) => `<li><a class="group grid h-full grid-cols-[2rem_1fr_auto] items-center gap-4 border border-border bg-background px-6 py-6 transition-colors hover:bg-primary hover:text-primary-foreground" href="${placeURL(place)}"><span class="font-mono text-[11px] opacity-50">${String(index + 1).padStart(2, '0')}</span><span><span class="block font-display text-lg font-bold">${esc(place.name)}</span><span class="font-mono text-[11px] opacity-60">${esc(categoryLabel(atlas, place))} · ${esc(place.region || '')}</span></span><span>+${place.pts || 0}</span></a></li>`).join('');
  }
  const stats = [...main.querySelectorAll('dl > div')];
  stats[0]?.querySelector('dt')?.replaceChildren(String(atlas.places.length));
  stats[1]?.querySelector('dt')?.replaceChildren(String(atlas.places.reduce((sum, place) => sum + (place.tasks || 0), 0)));
  const categorySection = [...main.querySelectorAll('section')].find((section) => section.textContent.includes('Шесть нитей'));
  const buttons = [...(categorySection?.querySelectorAll('button') || [])];
  const cards = [...main.querySelectorAll('a[href^="place-"],a[href^="article.html"]')];
  cards.forEach((card) => {
    const place = atlas.places.find((item) => placeURL(item) === card.getAttribute('href'));
    if (!place) { card.closest('li') ? card.closest('li').hidden = true : card.hidden = true; return; }
    const title = card.querySelector('h2,h3'); if (title) title.textContent = place.name;
  });
  let active = '';
  buttons.forEach((button, index) => {
    const category = atlas.categories[index]; if (!category) return;
    button.classList.add('atlas-category-filter');
    const label = [...button.querySelectorAll('span')].find((span) => /мест/i.test(span.textContent));
    if (label) label.textContent = `${atlas.places.filter((place) => place.cat === category.id).length} мест`;
    button.onclick = () => {
      active = active === category.id ? '' : category.id;
      buttons.forEach((item) => item.setAttribute('aria-pressed', String(item === button && Boolean(active))));
      cards.forEach((card) => { const place = atlas.places.find((item) => placeURL(item) === card.getAttribute('href')); card.hidden = Boolean(active && place && place.cat !== active); });
    };
  });
}

function renderArticle(place, atlas, esc) {
  const article = document.querySelector('main article'); if (!article) return;
  document.title = `${place.name} — Спадчына`;
  const hero = article.firstElementChild;
  const image = hero.querySelector('img'); image.src = place.image || 'assets/ae0141b95a.jpg'; image.alt = place.name;
  image.hidden = false;
  const heading = hero.querySelector('h1'); heading.textContent = place.name;
  heading.previousElementSibling.textContent = [categoryLabel(atlas, place), place.era].filter(Boolean).join(' · ');
  heading.nextElementSibling.textContent = place.region;
  const body = article.querySelector('.max-w-2xl');
  let blocks = []; try { blocks = JSON.parse(place.content); } catch { blocks = [{ type: 'lead', text: place.lead }]; }
  const credits = blocks.filter((block) => block.type === 'credit' || block.text?.startsWith('Фото:'));
  blocks = blocks.filter((block) => !credits.includes(block));
  body.innerHTML = `<p class="font-display text-2xl leading-relaxed">${esc(blocks[0]?.text || '')}</p><div class="mt-8 space-y-5 text-lg leading-relaxed text-foreground/85">${blocks.slice(1).map((block) => block.type === 'heading' ? `<h2>${esc(block.text)}</h2>` : block.type === 'quote' ? `<blockquote>${esc(block.text)}</blockquote>` : `<p>${esc(block.text)}</p>`).join('')}</div><h2 class="mt-10 text-3xl font-bold">Ключевые факты</h2><dl class="mt-6 grid grid-cols-2 gap-px border border-border bg-border">${[['Эпоха', place.era || '—'], ['Регион', place.region || '—'], ['Направление', categoryLabel(atlas, place)], ['Заданий', place.tasks]].map(([label, value]) => `<div class="bg-card p-5"><dt class="text-xs uppercase tracking-widest text-muted-foreground">${label}</dt><dd class="mt-1 font-display text-xl font-bold">${esc(value)}</dd></div>`).join('')}</dl>`;
  if (credits.length) body.insertAdjacentHTML('afterbegin', `<p class="mb-6 text-xs text-muted-foreground">${credits.map((block) => esc(block.text)).join('<br>')}</p>`);
}

export async function installPlaceQuiz({ getAtlas, api, esc, token, queuePendingResult }) {
  const slug = location.pathname.match(/place-([\w-]+)\.html$/)?.[1] || (location.pathname.endsWith('/article.html') ? new URLSearchParams(location.search).get('slug') : null);
  if (!slug) return;
  const card = document.querySelector('main aside div.shadow-xl'); if (!card) return;
  let atlas;
  try { atlas = await getAtlas(); }
  catch { card.innerHTML = '<p>Не удалось загрузить задания. Перезагрузите страницу.</p>'; return; }
  const place = atlas.places.find((item) => item.id === slug);
  if (!place) { document.querySelector('main').innerHTML = '<section class="mx-auto max-w-7xl px-6 py-16"><h1>Статья недоступна</h1><a href="catalog.html">Вернуться в каталог</a></section>'; return; }
  renderArticle(place, atlas, esc);
  const questions = atlas.quizzes[slug] || [];
  if (!questions.length) { card.textContent = 'Для этой статьи пока нет заданий.'; return; }
  let index = 0; let score = 0; let answers = [];
  const draw = () => {
    if (index >= questions.length) {
      card.innerHTML = `<p class="text-xs font-semibold uppercase tracking-widest text-primary">Маршрут пройден</p><h2 class="mt-3 font-display text-2xl font-bold">Ваш результат: ${score} из ${questions.length}</h2><p class="mt-3" data-save-message>${token() ? 'Сохраняем результат…' : 'Войдите, чтобы сохранить результат и баллы.'}</p><button class="backend-primary-button" type="button">Пройти ещё раз</button>`;
      card.querySelector('button').onclick = () => { index = 0; score = 0; answers = []; draw(); };
      const result = { slug, version: place.quiz_version, answers, score };
      if (!token()) { queuePendingResult(result); return; }
      const message = card.querySelector('[data-save-message]');
      api('/atlas/results', { method: 'POST', body: JSON.stringify(result) }).then((saved) => {
        if (message.isConnected) message.textContent = `Результат сохранён: ${saved.score} из ${saved.max_score}. Баллы в профиле: ${saved.points}.`;
      }).catch((error) => {
        if (!error.status || error.status >= 500 || error.status === 401) queuePendingResult(result);
        if (message.isConnected) message.textContent = error.status === 409 ? error.message : 'Не удалось сохранить результат. Повторите вход и отправку.';
      });
      return;
    }
    const question = questions[index]; const selected = new Set();
    card.innerHTML = `<p class="text-xs font-semibold uppercase tracking-widest text-primary">Задание · ${index + 1} из ${questions.length} · +${place.pts}</p><h2 class="mt-3 font-display text-xl font-bold leading-snug">${esc(question.q)}</h2>${question.multiple ? '<p>Выберите все правильные ответы</p>' : ''}<div class="backend-answer-list">${question.a.map((answer, choice) => `<button type="button" data-choice="${choice}" aria-pressed="false">${esc(answer)}</button>`).join('')}</div><div data-quiz-controls></div><p class="backend-quiz-feedback" role="status"></p>`;
    const controls = card.querySelector('[data-quiz-controls]'); const buttons = [...card.querySelectorAll('[data-choice]')];
    const submit = async (choices) => {
      buttons.forEach((button) => { button.disabled = true; }); controls.querySelector('button')?.setAttribute('disabled', '');
      const feedback = card.querySelector('.backend-quiz-feedback'); feedback.textContent = 'Проверяем ответ…';
      try {
        const answer = { question_id: Number(question.id), selected: choices };
        const checked = await api('/atlas/check', { method: 'POST', body: JSON.stringify({ slug, version: place.quiz_version, ...answer }) });
        answers.push(answer); if (checked.correct) score += 1;
        buttons.forEach((button, choice) => { if (checked.correct_options.includes(choice)) button.classList.add('backend-answer-correct'); else if (choices.includes(choice)) button.classList.add('backend-answer-wrong'); });
        feedback.textContent = `${checked.correct ? 'Верно. ' : 'Неверно. '}${checked.explanation || ''}`;
        controls.innerHTML = `<button class="backend-primary-button" type="button">${index + 1 === questions.length ? 'Завершить маршрут' : 'Следующий вопрос'}</button>`;
        controls.querySelector('button').onclick = () => { index += 1; draw(); };
      } catch (error) {
        feedback.textContent = error.status === 409 ? error.message : 'Не удалось проверить ответ. Попробуйте ещё раз.';
        buttons.forEach((button) => { button.disabled = false; }); controls.querySelector('button')?.removeAttribute('disabled');
      }
    };
    buttons.forEach((button) => button.onclick = () => {
      const choice = Number(button.dataset.choice); if (!question.multiple) { submit([choice]); return; }
      if (selected.has(choice)) selected.delete(choice); else selected.add(choice);
      button.setAttribute('aria-pressed', String(selected.has(choice))); button.classList.toggle('backend-answer-selected', selected.has(choice));
      controls.querySelector('button').disabled = selected.size === 0;
    });
    if (question.multiple) { controls.innerHTML = '<button class="backend-primary-button" type="button" disabled>Проверить ответ</button>'; controls.querySelector('button').onclick = () => submit([...selected]); }
  };
  draw();
}
