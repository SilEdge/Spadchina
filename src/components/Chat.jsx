import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useUser } from '../contexts/UserContext.jsx';

export default function Chat({ initialPeer, onLoginOpen }) {
  const { user } = useUser();
  const [conversations, setConversations] = useState([]);
  const [activePeer, setActivePeer] = useState(initialPeer || '');
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [peerSearch, setPeerSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [error, setError] = useState(null);
  const [voiceLanguage, setVoiceLanguage] = useState('ru-RU');
  const listRef = useRef(null);
  const transcriptBaseRef = useRef('');
  const recognitionRef = useRef(null);
  const [listening, setListening] = useState(false);
  const browserSupportsSpeechRecognition = typeof window !== 'undefined'
    && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

  const activeConversation = useMemo(
    () => conversations.find((item) => item.username === activePeer),
    [activePeer, conversations],
  );

  const filteredConversations = useMemo(() => {
    const query = peerSearch.trim().toLowerCase();
    if (!query) return conversations;
    return conversations.filter((item) => item.username.toLowerCase().includes(query));
  }, [conversations, peerSearch]);

  const loadConversations = useCallback(() => {
    if (!user) return Promise.resolve();
    return api.getConversations()
      .then((data) => {
        setConversations(data);
        if (!activePeer && data.length > 0) setActivePeer(data[0].username);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [activePeer, user]);

  const markPeerAsRead = useCallback((peer) => {
    let unreadCount = 0;

    setConversations((current) => {
      const next = current.map((item) => (
        item.username === peer ? { ...item, unread_count: 0 } : item
      ));
      unreadCount = next.reduce((sum, item) => sum + (item.unread_count || 0), 0);
      return next;
    });

    window.dispatchEvent(new CustomEvent('cultcode-chat-read', {
      detail: { unreadCount },
    }));
  }, []);

  const loadMessages = useCallback((peer) => {
    if (!peer || !user) return Promise.resolve();
    setMessagesLoading(true);
    return api.getMessages(peer)
      .then((data) => {
        setMessages(data);
        markPeerAsRead(peer);
      })
      .catch((err) => setError(err.message))
      .finally(() => setMessagesLoading(false));
  }, [markPeerAsRead, user]);

  useEffect(() => {
    setActivePeer(initialPeer || '');
  }, [initialPeer]);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return undefined;
    }

    loadConversations();
    const timer = window.setInterval(loadConversations, 8000);
    return () => window.clearInterval(timer);
  }, [loadConversations, user]);

  useEffect(() => {
    if (!activePeer || !user) return undefined;

    loadMessages(activePeer);
    const timer = window.setInterval(() => loadMessages(activePeer), 5000);
    return () => window.clearInterval(timer);
  }, [activePeer, loadMessages, user]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  useEffect(() => () => {
    recognitionRef.current?.stop();
  }, []);

  const toggleVoiceInput = () => {
    if (!browserSupportsSpeechRecognition) {
      setError('Браузер не поддерживает голосовой ввод. Попробуй Chrome или Edge.');
      return;
    }

    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    if (!window.isSecureContext && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
      setError('Голосовой ввод работает только на HTTPS или localhost.');
      return;
    }

    setError(null);
    transcriptBaseRef.current = draft.trim();
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognitionAPI();
    recognition.lang = voiceLanguage;
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => setListening(true);
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    recognition.onerror = (event) => {
      setListening(false);
      recognitionRef.current = null;
      const messages = {
        'not-allowed': 'Разреши доступ к микрофону в браузере.',
        'service-not-allowed': 'Браузер заблокировал сервис распознавания речи.',
        'no-speech': 'Голос не распознан. Попробуй сказать чуть громче.',
        network: 'Не удалось подключиться к сервису распознавания речи.',
        'audio-capture': 'Микрофон не найден или занят другим приложением.',
      };
      setError(messages[event.error] || 'Не удалось запустить голосовой ввод.');
    };
    recognition.onresult = (event) => {
      let finalText = '';
      let interimText = '';

      Array.from(event.results).forEach((result) => {
        const text = result[0]?.transcript || '';
        if (result.isFinal) finalText += text;
        else interimText += text;
      });

      setDraft(`${transcriptBaseRef.current} ${finalText} ${interimText}`.trim());
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setListening(false);
      setError('Голосовой ввод уже запускается. Попробуй ещё раз.');
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !activePeer) return;

    recognitionRef.current?.stop();
    setDraft('');
    try {
      await api.sendMessage(activePeer, text);
      await Promise.all([loadMessages(activePeer), loadConversations()]);
    } catch (err) {
      setError(err.message);
      setDraft(text);
    }
  };

  if (!user) {
    return (
      <section className="section">
        <div className="container">
          <div className="login-gate">
            <span className="section-kicker">Чат</span>
            <h2 className="section-title">Сообщения доступны после входа</h2>
            <p className="section-subtitle">Войди, чтобы писать другим участникам и отвечать на новые сообщения.</p>
            <button className="btn-primary" onClick={onLoginOpen}>Войти</button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="section">
      <div className="container">
        <div className="section-head">
          <div>
            <span className="section-kicker">Сообщения</span>
            <h2 className="section-title">Чат участников</h2>
            <p className="section-subtitle">Обсуждай задания, договаривайся о батлах и поддерживай других игроков.</p>
          </div>
        </div>

        {error && <div className="alert error">Ошибка чата: {error}</div>}

        <div className="chat-shell">
          <aside className="chat-sidebar">
            <div className="chat-sidebar-head">
              <strong>Диалоги</strong>
              {loading && <span>обновление</span>}
            </div>
            <div className="chat-search">
              <span aria-hidden="true">⌕</span>
              <input
                value={peerSearch}
                onChange={(event) => setPeerSearch(event.target.value)}
                placeholder="Найти пользователя"
              />
              {peerSearch && (
                <button type="button" onClick={() => setPeerSearch('')} aria-label="Очистить поиск">
                  ×
                </button>
              )}
            </div>
            <div className="chat-peers">
              {filteredConversations.map((item) => (
                <button
                  key={item.username}
                  className={`chat-peer ${activePeer === item.username ? 'active' : ''}`}
                  onClick={() => setActivePeer(item.username)}
                >
                  <span className="chat-peer-avatar">{item.username.slice(0, 1).toUpperCase()}</span>
                  <span className="chat-peer-main">
                    <strong>{item.username}</strong>
                    <small>{item.last_message || `${item.points} баллов`}</small>
                  </span>
                  {item.unread_count > 0 && <span className="chat-unread">{item.unread_count}</span>}
                </button>
              ))}
              {!conversations.length && !loading && (
                <p className="chat-empty">Пока нет других участников для диалога.</p>
              )}
              {conversations.length > 0 && !filteredConversations.length && (
                <p className="chat-empty">Пользователь не найден.</p>
              )}
            </div>
          </aside>

          <div className="chat-panel">
            {activePeer ? (
              <>
                <div className="chat-panel-head">
                  <span className="chat-peer-avatar">{activePeer.slice(0, 1).toUpperCase()}</span>
                  <div>
                    <strong>{activePeer}</strong>
                    <small>{activeConversation ? `${activeConversation.points} баллов` : 'Новый диалог'}</small>
                  </div>
                </div>

                <div className="chat-messages" ref={listRef}>
                  {messagesLoading && !messages.length ? (
                    <div className="loading-state compact">
                      <span className="spinner" />
                      Загрузка сообщений
                    </div>
                  ) : (
                    messages.map((message) => {
                      const mine = message.sender === user.username;
                      return (
                        <div key={message.id} className={`chat-message ${mine ? 'mine' : 'theirs'}`}>
                          <p>{message.text}</p>
                          <span>{mine ? 'Вы' : message.sender}</span>
                        </div>
                      );
                    })
                  )}
                  {!messages.length && !messagesLoading && (
                    <div className="chat-empty-state">
                      <strong>Начни диалог</strong>
                      <span>Напиши первое сообщение, чтобы договориться о совместном прогрессе или батле.</span>
                    </div>
                  )}
                </div>

                <form className="chat-compose" onSubmit={handleSubmit}>
                  <input
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder={`Сообщение для ${activePeer}`}
                    maxLength={1000}
                  />
                  <div className="chat-language-switch" aria-label="Язык голосового ввода">
                    {[
                      ['ru-RU', 'RU'],
                      ['be-BY', 'BY'],
                      ['en-US', 'EN'],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        className={voiceLanguage === value ? 'active' : ''}
                        type="button"
                        onClick={() => setVoiceLanguage(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <button
                    className={`chat-voice-btn ${listening ? 'recording' : ''}`}
                    type="button"
                    onClick={toggleVoiceInput}
                    title={browserSupportsSpeechRecognition ? 'Голосовой ввод' : 'Голосовой ввод не поддерживается'}
                    aria-label={listening ? 'Остановить голосовой ввод' : 'Начать голосовой ввод'}
                  >
                    <span />
                  </button>
                  <button className="btn-primary" type="submit" disabled={!draft.trim()}>
                    Отправить
                  </button>
                </form>
              </>
            ) : (
              <div className="chat-empty-state">
                <strong>Выбери участника</strong>
                <span>Открой профиль в лидерах или выбери диалог слева.</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
