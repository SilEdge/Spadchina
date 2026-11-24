import { faArrowUp, faRobot, faWandMagicSparkles, faXmark } from '@fortawesome/free-solid-svg-icons';
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

export function installAssistantChat({ api, token, openAuthModal }) {
  const widget = document.createElement('div');
  widget.className = 'atlas-assistant';
  widget.innerHTML = `
    <button class="atlas-assistant__launcher" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="atlas-assistant-chat">
      ${renderIcon(faWandMagicSparkles)}
      <span lang="en">Spadchin</span>
    </button>
    <section class="atlas-assistant__panel" id="atlas-assistant-chat" role="dialog" aria-labelledby="atlas-assistant-title" inert>
      <div class="atlas-assistant__hero">
        <span class="atlas-assistant__avatar">${renderIcon(faRobot)}</span>
        <div class="atlas-assistant__title">
          <h2 id="atlas-assistant-title" lang="en">Spadchin</h2>
          <p>Помощник по атласу Беларуси</p>
        </div>
        <button class="atlas-assistant__close" type="button" aria-label="Свернуть чат">
          ${renderIcon(faXmark)}
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
          <input name="question" type="text" aria-label="Ваш вопрос" placeholder="Напишите вопрос…" maxlength="600" autocomplete="off" required>
          <button class="atlas-assistant__send" type="submit" aria-label="Отправить вопрос" disabled>
            ${renderIcon(faArrowUp)}
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
  let availability;
  let pending = false;
  let signInRequired = false;

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

  function appendMessage(role, text) {
    const message = document.createElement('p');
    message.className = 'atlas-assistant__message';
    message.dataset.role = role;
    message.textContent = text;
    log.insertBefore(message, typing);
    scrollToLatest();
    return message;
  }

  function updateComposer() {
    input.readOnly = pending;
    send.disabled = pending || availability !== true || !input.value.trim();
  }

  function showAvailability() {
    if (availability === true) {
      const needsLogin = signInRequired || !token();
      setStatus(needsLogin ? 'Войдите, чтобы отправить вопрос.' : tip, needsLogin ? 'Войти' : '');
    } else if (availability === false) {
      setStatus('Можно набрать вопрос. Отправка станет доступна после подключения ИИ.');
    } else {
      setStatus('Не удалось проверить подключение.', 'Повторить');
    }
    updateComposer();
  }

  async function updateAvailability() {
    if (availability === 'loading') return;
    if (availability === true) {
      showAvailability();
      return;
    }

    availability = 'loading';
    setStatus('Проверяем подключение…');
    try {
      const { enabled } = await api('/atlas/assistant');
      availability = typeof enabled === 'boolean' ? enabled : undefined;
    } catch {
      availability = undefined;
    }
    showAvailability();
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
    if (!pending) void updateAvailability();
  });
  closeButton.addEventListener('click', () => setOpen(false));
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  });
  action.addEventListener('click', () => {
    if (availability === true) {
      askToSignIn();
    } else {
      closeButton.focus();
      void updateAvailability();
    }
  });
  input.addEventListener('input', () => {
    if (input.value.trim()) dismissGreeting();
    updateComposer();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (pending || availability !== true || !question) return;
    if (signInRequired || !token()) {
      askToSignIn();
      return;
    }

    dismissGreeting();
    const messages = [...history, { role: 'user', content: question }];
    const bubble = appendMessage('user', question);
    input.value = '';
    input.focus({ preventScroll: true });
    pending = true;
    updateComposer();
    setStatus(tip);
    typing.hidden = false;
    scrollToLatest();

    try {
      const { answer } = await api('/atlas/assistant', {
        method: 'POST',
        body: JSON.stringify({ messages, slug }),
      });
      if (typeof answer !== 'string' || !answer.trim()) throw new Error('Помощник не вернул ответ. Попробуйте ещё раз.');
      history = [...messages, { role: 'assistant', content: answer }].slice(-6);
      typing.hidden = true;
      appendMessage('assistant', answer);
    } catch (error) {
      bubble.remove();
      input.value = question;
      if (error.status === 401) {
        signInRequired = true;
        setStatus('Войдите заново, чтобы продолжить.', 'Войти');
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
