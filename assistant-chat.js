import { faArrowRight, faChevronDown, faCommentDots } from '@fortawesome/free-solid-svg-icons';
import { placeURL } from './public-atlas.js';
import './assistant-chat.css';

function renderIcon({ iconName, icon: [width, height, , , path] }) {
  const paths = [].concat(path).map((value) => `<path d="${value}"/>`).join('');
  return `<svg data-icon="${iconName}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="currentColor" aria-hidden="true">${paths}</svg>`;
}

function currentPlace() {
  const page = location.pathname.split('/').pop();
  const slug = page === 'article.html'
    ? new URLSearchParams(location.search).get('slug')
    : /^place-([a-z0-9-]+)\.html$/.exec(page)?.[1];
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || '') && slug.length <= 80 ? slug : '';
}

const ignoredWords = new Set([
  'что', 'это', 'как', 'кто', 'где', 'когда', 'какие', 'какой', 'какая', 'чем', 'почему',
  'про', 'расскажи', 'расскажите', 'можно', 'найди', 'узнать', 'больше', 'беларуси',
  'што', 'хто', 'дзе', 'калі', 'пра', 'раскажы', 'беларусь',
]);

function searchWords(text) {
  return String(text || '').toLocaleLowerCase('ru').replaceAll('ё', 'е').match(/[\p{L}\p{N}]{3,}/gu) || [];
}

function findAtlasPlaces(atlas, question) {
  const terms = [...new Set(searchWords(question).filter((word) => !ignoredWords.has(word)))];
  const matches = (word, term) => word === term || (term.length > 4 && word.startsWith(term.slice(0, -2)));
  return atlas.places.map((place) => {
    const title = searchWords(place.name);
    const context = searchWords([place.region, place.lead, atlas.categories?.find((category) => category.id === place.cat)?.name].join(' '));
    const score = terms.reduce((total, term) => total + (title.some((word) => matches(word, term)) ? 4 :
      Number(context.some((word) => matches(word, term)))), 0);
    return { place, score };
  }).filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ place }) => place);
}

export function installAssistantChat({ api, getAtlas, token, openAuthModal }) {
  const widget = document.createElement('div');
  widget.className = 'atlas-assistant';
  widget.innerHTML = `
    <button class="atlas-assistant__launcher" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="atlas-assistant-chat">
      ${renderIcon(faCommentDots)}
      <span lang="en">Spadchin</span>
    </button>
    <section class="atlas-assistant__panel" id="atlas-assistant-chat" role="dialog" aria-labelledby="atlas-assistant-title" inert>
      <div class="atlas-assistant__hero">
        <span class="atlas-assistant__avatar"><img src="${import.meta.env.BASE_URL}assets/b29a1d34f6.png" width="40" height="40" alt=""></span>
        <div class="atlas-assistant__title">
          <h2 id="atlas-assistant-title" lang="en">Spadchin</h2>
          <p>Помощник по атласу Беларуси</p>
        </div>
        <button class="atlas-assistant__close" type="button" aria-label="Свернуть чат">
          ${renderIcon(faChevronDown)}
        </button>
      </div>
      <div class="atlas-assistant__messages" role="log" aria-label="Переписка" tabindex="0">
        <div class="atlas-assistant__greeting">
          <div>
            <p class="atlas-assistant__message">Привет! Куда отправимся? Спроси про озёра, замки или традиции Беларуси.</p>
          </div>
        </div>
        <div class="atlas-assistant__typing" hidden>
          <span class="atlas-assistant__sr-only">Spadchin печатает…</span>
          <span class="atlas-assistant__dots" aria-hidden="true"><i></i><i></i><i></i></span>
        </div>
      </div>
      <div class="atlas-assistant__footer">
        <form class="atlas-assistant__composer">
          <textarea name="question" aria-label="Ваш вопрос" placeholder="Напишите вопрос…" rows="2" maxlength="600" required></textarea>
          <button class="atlas-assistant__send" type="submit" aria-label="Отправить вопрос" disabled>
            ${renderIcon(faArrowRight)}
          </button>
        </form>
        <div class="atlas-assistant__feedback">
          <p class="atlas-assistant__status" role="status"></p>
          <button class="atlas-assistant__action" type="button" hidden></button>
        </div>
      </div>
    </section>
  `;

  const launcher = widget.querySelector('.atlas-assistant__launcher');
  const panel = widget.querySelector('.atlas-assistant__panel');
  const closeButton = widget.querySelector('.atlas-assistant__close');
  const log = widget.querySelector('.atlas-assistant__messages');
  const greeting = widget.querySelector('.atlas-assistant__greeting');
  const typing = widget.querySelector('.atlas-assistant__typing');
  const form = widget.querySelector('form');
  const input = form.elements.question;
  const send = widget.querySelector('.atlas-assistant__send');
  const status = widget.querySelector('[role="status"]');
  const action = widget.querySelector('.atlas-assistant__action');
  const tip = 'ИИ может ошибаться. Не вводите личные данные.';
  const slug = currentPlace();
  let history = [];
  let availabilityCheck;
  let pending = false;

  function setStatus(message, buttonLabel = '') {
    status.textContent = message;
    action.hidden = !buttonLabel;
    action.textContent = buttonLabel;
  }

  function scrollToLatest() {
    log.scrollTop = log.scrollHeight;
  }

  function setOpen(open) {
    if (open) widget.classList.add('has-opened');
    launcher.inert = open;
    panel.inert = !open;
    widget.classList.toggle('is-open', open);
    launcher.setAttribute('aria-expanded', String(open));
    (open ? closeButton : launcher).focus({ preventScroll: true });
    if (open) scrollToLatest();
  }

  function appendMessage(role, text, details) {
    const message = document.createElement(details ? 'div' : 'p');
    message.className = 'atlas-assistant__message';
    message.dataset.role = role;
    message.textContent = text;
    if (details) message.append(details);
    log.insertBefore(message, typing);
    scrollToLatest();
    return message;
  }

  function updateComposer() {
    input.readOnly = pending;
    send.disabled = pending || !input.value.trim();
  }

  function checkAvailability() {
    availabilityCheck ??= api('/atlas/assistant').then(
      ({ enabled }) => enabled === true,
      () => false,
    ).then((enabled) => {
      if (!enabled) availabilityCheck = undefined;
      return enabled;
    });
    return availabilityCheck;
  }

  function dismissGreeting() {
    greeting.classList.add('is-dismissed');
    greeting.setAttribute('aria-hidden', 'true');
  }

  function askToSignIn() {
    setOpen(false);
    openAuthModal();
  }

  launcher.addEventListener('click', () => {
    setOpen(true);
    void checkAvailability().then((enabled) => {
      if (!pending) setStatus(enabled ? tip : '');
    });
  });
  closeButton.addEventListener('click', () => setOpen(false));
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  });
  action.addEventListener('click', askToSignIn);
  input.addEventListener('input', () => {
    if (input.value.trim()) dismissGreeting();
    updateComposer();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    if (!send.disabled) form.requestSubmit();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (pending || !question) return;

    dismissGreeting();
    const messages = [...history, { role: 'user', content: question }];
    const bubble = appendMessage('user', question);
    input.value = '';
    input.focus({ preventScroll: true });
    pending = true;
    updateComposer();
    setStatus('');
    typing.firstElementChild.textContent = 'Готовим ответ…';
    typing.hidden = false;
    scrollToLatest();

    try {
      const useAI = await checkAvailability();
      typing.firstElementChild.textContent = useAI ? 'Spadchin печатает…' : 'Поиск по атласу…';
      setStatus(useAI ? tip : '');
      if (useAI) {
        const { answer } = await api('/atlas/assistant', {
          method: 'POST',
          body: JSON.stringify({ messages, slug }),
        });
        if (typeof answer !== 'string' || !answer.trim()) throw new Error('Помощник не вернул ответ. Попробуйте ещё раз.');
        history = [...messages, { role: 'assistant', content: answer }].slice(-6);
        typing.hidden = true;
        appendMessage('assistant', answer);
      } else {
        const places = findAtlasPlaces(await getAtlas(), question);
        typing.hidden = true;
        const list = document.createElement('ul');
        list.className = 'atlas-assistant__results';
        for (const place of places.length ? places : [{ name: 'Открыть каталог' }]) {
          const item = document.createElement('li');
          const link = document.createElement('a');
          link.href = place.id ? placeURL(place) : 'catalog.html';
          link.textContent = place.name;
          item.append(link);
          if (place.lead) {
            const description = document.createElement('small');
            description.textContent = place.lead;
            item.append(description);
          }
          list.append(item);
        }
        appendMessage('assistant', places.length
          ? 'Вот что нашлось в атласе.'
          : 'По этому вопросу ничего не нашлось. Попробуйте указать название места.', list);
      }
    } catch (error) {
      bubble.remove();
      input.value = question;
      if (error.status === 401 || (error.status === 429 && !token())) {
        setStatus(error.status === 401 ? 'Войдите заново, чтобы продолжить.' : error.message, 'Войти');
        if (!panel.inert) action.focus();
      } else {
        setStatus(error.message);
      }
    } finally {
      typing.hidden = true;
      pending = false;
      updateComposer();
    }
  });

  document.body.append(widget);
}
