import './assistant-chat.css';

const sparkles = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M9.5 2.5 11.7 8.3 17.5 10.5 11.7 12.7 9.5 18.5 7.3 12.7 1.5 10.5 7.3 8.3 9.5 2.5Z"/>
  <path d="M19 13.5v8m-4-4h8"/>
</svg>`;

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
      ${sparkles}
      ИИ-помощник
    </button>
    <section class="atlas-assistant__panel" id="atlas-assistant-chat" role="dialog" aria-labelledby="atlas-assistant-title" hidden>
      <header class="atlas-assistant__header">
        <span class="atlas-assistant__avatar">${sparkles}</span>
        <h2 id="atlas-assistant-title">ИИ-помощник</h2>
        <button class="atlas-assistant__close" type="button" aria-label="Свернуть чат">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18"/>
          </svg>
        </button>
      </header>
      <div class="atlas-assistant__messages" role="log" aria-label="Переписка" tabindex="0">
        <p class="atlas-assistant__message">Привет! Помогу узнать больше о местах, истории и традициях Беларуси.</p>
      </div>
      <div class="atlas-assistant__footer">
        <form class="atlas-assistant__composer" hidden>
          <input name="question" type="text" aria-label="Ваш вопрос" placeholder="Напишите вопрос…" maxlength="600" autocomplete="off" required>
          <button class="atlas-assistant__send" type="submit" aria-label="Отправить вопрос" disabled>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 19V5m-5 5 5-5 5 5"/>
            </svg>
          </button>
        </form>
        <p class="atlas-assistant__status" role="status"></p>
        <button class="atlas-assistant__action" type="button" hidden></button>
      </div>
    </section>
  `;

  const launcher = widget.querySelector('.atlas-assistant__launcher');
  const panel = widget.querySelector('.atlas-assistant__panel');
  const closeButton = widget.querySelector('.atlas-assistant__close');
  const log = widget.querySelector('.atlas-assistant__messages');
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
    panel.hidden = !open;
    launcher.hidden = open;
    launcher.setAttribute('aria-expanded', String(open));
    (open ? closeButton : launcher).focus({ preventScroll: true });
    if (open) scrollToLatest();
  }

  function appendMessage(role, text) {
    const message = document.createElement('p');
    message.className = 'atlas-assistant__message';
    message.dataset.role = role;
    message.textContent = text;
    log.append(message);
    scrollToLatest();
    return message;
  }

  async function updateAvailability() {
    if (availability === 'loading') return;
    if (availability === true) {
      form.hidden = signInRequired || !token();
      setStatus(form.hidden ? 'Войдите, чтобы задать вопрос.' : tip, form.hidden ? 'Войти' : '');
      return;
    }

    availability = 'loading';
    setStatus('Проверяем подключение…');
    try {
      const { enabled } = await api('/atlas/assistant');
      if (typeof enabled !== 'boolean') throw new Error('Unexpected assistant status');
      availability = enabled;
      if (enabled) {
        await updateAvailability();
      } else {
        setStatus('ИИ-помощник пока не подключён.');
      }
    } catch {
      availability = undefined;
      setStatus('Не удалось проверить подключение.', 'Повторить');
    }
  }

  function updateSend() {
    input.readOnly = pending;
    send.disabled = pending || !input.value.trim();
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
      setOpen(false);
      openAuthModal();
    } else {
      closeButton.focus();
      void updateAvailability();
    }
  });
  input.addEventListener('input', updateSend);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (pending || !question) return;

    const messages = [...history, { role: 'user', content: question }];
    const bubble = appendMessage('user', question);
    input.value = '';
    input.focus({ preventScroll: true });
    pending = true;
    updateSend();
    setStatus('Готовим ответ…');

    try {
      const { answer } = await api('/atlas/assistant', {
        method: 'POST',
        body: JSON.stringify({ messages, slug }),
      });
      if (typeof answer !== 'string' || !answer.trim()) throw new Error('Помощник не вернул ответ. Попробуйте ещё раз.');
      history = [...messages, { role: 'assistant', content: answer }].slice(-6);
      appendMessage('assistant', answer);
      setStatus(tip);
    } catch (error) {
      bubble.remove();
      input.value = question;
      if (error.status === 401) {
        signInRequired = true;
        form.hidden = true;
        setStatus('Войдите заново, чтобы продолжить.', 'Войти');
        if (!panel.hidden) action.focus();
      } else {
        setStatus(error.message);
      }
    } finally {
      pending = false;
      updateSend();
    }
  });

  document.body.append(widget);
}
