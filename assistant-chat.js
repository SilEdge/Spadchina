import './assistant-chat.css';

const sparkles = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M9.5 2.5 11.7 8.3 17.5 10.5 11.7 12.7 9.5 18.5 7.3 12.7 1.5 10.5 7.3 8.3 9.5 2.5Z"/>
  <path d="M19 13.5v8m-4-4h8"/>
</svg>`;

export function installAssistantChat() {
  const widget = document.createElement('div');
  widget.className = 'atlas-assistant';
  widget.innerHTML = `
    <button class="atlas-assistant__launcher" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="atlas-assistant-chat">
      ${sparkles}
      ИИ-помощник
    </button>
    <section class="atlas-assistant__panel" id="atlas-assistant-chat" role="dialog" aria-labelledby="atlas-assistant-title" aria-describedby="atlas-assistant-status" hidden>
      <div class="atlas-assistant__header">
        <span class="atlas-assistant__avatar">${sparkles}</span>
        <h2 id="atlas-assistant-title">ИИ-помощник</h2>
        <button class="atlas-assistant__close" type="button" aria-label="Свернуть чат">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18"/>
          </svg>
        </button>
      </div>
      <div class="atlas-assistant__messages">
        <p class="atlas-assistant__message">Привет! Здесь можно будет задать вопрос о местах, истории и традициях Беларуси.</p>
      </div>
      <div class="atlas-assistant__footer">
        <div class="atlas-assistant__composer">
          <input type="text" aria-label="Ваш вопрос" placeholder="Ваш вопрос…" disabled>
          <button class="atlas-assistant__send" type="button" aria-label="Отправить вопрос" disabled>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 19V5m-5 5 5-5 5 5"/>
            </svg>
          </button>
        </div>
        <p class="atlas-assistant__status" id="atlas-assistant-status">ИИ пока не подключён.</p>
      </div>
    </section>
  `;

  const launcher = widget.querySelector('.atlas-assistant__launcher');
  const panel = widget.querySelector('.atlas-assistant__panel');
  const closeButton = widget.querySelector('.atlas-assistant__close');

  function setOpen(open) {
    panel.hidden = !open;
    launcher.hidden = open;
    launcher.setAttribute('aria-expanded', String(open));
    (open ? closeButton : launcher).focus({ preventScroll: true });
  }

  launcher.addEventListener('click', () => setOpen(true));
  closeButton.addEventListener('click', () => setOpen(false));
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  });

  document.body.append(widget);
}
