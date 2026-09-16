import { useState } from 'react';
import { api } from '../api.js';
import { useUser } from '../contexts/UserContext.jsx';

const minMessageLength = 8;

const exampleIdeas = [
  {
    name: 'Алина',
    tag: 'Новое место',
    text: 'Добавьте маршрут по старому Гродно с короткими фактами и вопросами после каждой остановки.',
  },
  {
    name: 'Максим',
    tag: 'Викторины',
    text: 'Было бы классно сделать режим на время, где нужно быстро отвечать на вопросы по замкам Беларуси.',
  },
  {
    name: 'Nikita',
    tag: 'Профиль',
    text: 'Добавьте значки за прохождение всех статей одной категории, чтобы их было видно в профиле.',
  },
];

export default function Suggestions() {
  const { user } = useUser();
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState(null);
  const [sending, setSending] = useState(false);

  const trimmedMessage = message.trim();
  const canSubmit = trimmedMessage.length >= minMessageLength;

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!canSubmit || sending) {
      setStatus({ type: 'error', text: 'Опиши идею чуть подробнее.' });
      return;
    }

    setSending(true);
    setStatus(null);

    try {
      const result = await api.sendSuggestion(trimmedMessage, user || {});
      setStatus({
        type: 'success',
        text: result.delivery === 'telegram'
          ? 'Идея отправлена в Telegram.'
          : 'Идея сохранена на сервере. Telegram пока не подключён.',
      });
      setMessage('');
    } catch (error) {
      const isNotConfigured = error.message.includes('telegram bot is not configured');
      setStatus({
        type: 'error',
        text: isNotConfigured
          ? 'Telegram-бот ещё не подключён на сервере.'
          : 'Не получилось отправить идею. Попробуй позже.',
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="section suggestions-page">
      <div className="container suggestions-layout">
        <div className="suggestions-hero">
          <span className="section-kicker">Идеи</span>
          <h2 className="section-title">Поделись идеей для сайта</h2>
          <p className="section-subtitle">
            Напиши идею, замечание или место, которое стоит добавить. Сейчас форма готовит
            сообщение для будущей отправки в Telegram-бота.
          </p>
        </div>

        <form className="suggestions-card" onSubmit={handleSubmit}>
          <label htmlFor="suggestion-message">Твоё сообщение</label>
          <textarea
            id="suggestion-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Например: добавьте статью про Лидский замок и пару вопросов к ней..."
            rows="7"
          />
          <div className="suggestions-meta">
            <span>{trimmedMessage.length} символов</span>
            <span>Минимум {minMessageLength}</span>
          </div>

          {status && <div className={`alert ${status.type}`}>{status.text}</div>}

          <button className="btn-primary btn-large" type="submit" disabled={!canSubmit || sending}>
            {sending ? 'Отправляем...' : 'Отправить идею'}
          </button>
        </form>

        <div className="suggestions-examples">
          <div className="suggestions-examples-head">
            <span className="section-kicker">Уже писали</span>
            <h3>Примеры идей</h3>
          </div>

          <div className="suggestions-example-grid">
            {exampleIdeas.map((idea) => (
              <article className="suggestions-example" key={idea.name}>
                <div>
                  <strong>{idea.name}</strong>
                  <span>{idea.tag}</span>
                </div>
                <p>{idea.text}</p>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
