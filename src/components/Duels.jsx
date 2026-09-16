import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useUser } from '../contexts/UserContext.jsx';

const QUESTION_SECONDS = 15;
const DUEL_REWARD_ID = 'duel-champion-frame';

function isCorrect(question, selected) {
  if (Array.isArray(question.correct)) {
    return question.correct.slice().sort().join(',') === selected.slice().sort().join(',');
  }
  return selected.length === 1 && selected[0] === question.correct;
}

function sameUserByName(left, right) {
  return String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();
}

export default function Duels({ initialOpponent, onLoginOpen }) {
  const { user } = useUser();
  const [duels, setDuels] = useState([]);
  const [opponent, setOpponent] = useState(initialOpponent || '');
  const [activeDuel, setActiveDuel] = useState(null);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState([]);
  const [answers, setAnswers] = useState([]);
  const [timeLeft, setTimeLeft] = useState(QUESTION_SECONDS);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const autoStartedDuelIds = useRef(new Set());

  const loadDuels = useCallback(() => {
    if (!user) return Promise.resolve();
    return api.getDuels()
      .then(setDuels)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [user]);

  useEffect(() => {
    setOpponent(initialOpponent || '');
  }, [initialOpponent]);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return undefined;
    }
    loadDuels();
    const timer = window.setInterval(loadDuels, 5000);
    return () => window.clearInterval(timer);
  }, [loadDuels, user]);

  useEffect(() => {
    if (!activeDuel || activeDuel.status !== 'active') return undefined;
    setTimeLeft(QUESTION_SECONDS);
    const timer = window.setInterval(() => {
      setTimeLeft((value) => Math.max(value - 1, 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeDuel, current]);

  const isMeAsChallenger = useCallback((duel) => {
    if (duel.challenger_id && user?.id) return duel.challenger_id === user.id;
    return sameUserByName(duel.challenger, user?.username) || sameUserByName(duel.challenger, user?.name);
  }, [user?.id, user?.name, user?.username]);
  const isMeAsOpponent = useCallback((duel) => {
    if (duel.opponent_id && user?.id) return duel.opponent_id === user.id;
    return sameUserByName(duel.opponent, user?.username) || sameUserByName(duel.opponent, user?.name);
  }, [user?.id, user?.name, user?.username]);

  const incoming = duels.filter((duel) => duel.status === 'pending' && isMeAsOpponent(duel));
  const active = duels.filter((duel) => duel.status === 'active');
  const history = duels.filter((duel) => duel.status === 'completed');
  const getRivalName = (duel) => (
    isMeAsChallenger(duel) ? duel.opponent : duel.challenger
  );
  const getMyDuelScore = (duel) => (
    isMeAsChallenger(duel) ? duel.challenger_score : duel.opponent_score
  );
  const getRivalDuelScore = (duel) => (
    isMeAsChallenger(duel) ? duel.opponent_score : duel.challenger_score
  );
  const getDuelResultLabel = (duel) => {
    if (!duel.winner) return 'Ничья';
    return duel.winner_id === user?.id ? 'Ты победил' : `Победил ${duel.winner}`;
  };

  const question = activeDuel?.questions[current];
  const mySubmittedScore = activeDuel && isMeAsChallenger(activeDuel)
    ? activeDuel?.challenger_score
    : activeDuel?.opponent_score;
  const iHaveSubmitted = activeDuel?.status === 'active' && Number(mySubmittedScore) >= 0;
  const myScore = useMemo(() => (
    answers.reduce((sum, answer) => sum + (answer.correct ? 100 + answer.time_left * 5 : 0), 0)
  ), [answers]);

  const createDuel = async () => {
    const target = opponent.trim();
    if (!target) return;
    setError(null);
    try {
      await api.createDuel(target);
      setMessage(`Вызов отправлен пользователю ${target}.`);
      setOpponent('');
      await loadDuels();
    } catch (err) {
      setError(err.message);
    }
  };

  const acceptDuel = async (duel) => {
    await api.acceptDuel(duel.id);
    const fresh = await api.getDuel(duel.id);
    startDuel(fresh);
    await loadDuels();
  };

  const startDuel = useCallback((duel) => {
    setActiveDuel(duel);
    setCurrent(0);
    setSelected([]);
    setAnswers([]);
    setTimeLeft(QUESTION_SECONDS);
    setSubmitting(false);
    setMessage(null);
  }, []);

  useEffect(() => {
    if (!user || activeDuel) return;

    const acceptedDuel = duels.find((duel) => (
      duel.status === 'active' &&
      isMeAsChallenger(duel) &&
      Number(duel.challenger_score) < 0 &&
      !autoStartedDuelIds.current.has(duel.id)
    ));

    if (!acceptedDuel) return;

    autoStartedDuelIds.current.add(acceptedDuel.id);
    startDuel(acceptedDuel);
  }, [activeDuel, duels, isMeAsChallenger, startDuel, user]);

  const toggleAnswer = (index) => {
    if (!question) return;
    if (question.type === 'multiple') {
      setSelected((prev) => (
        prev.includes(index) ? prev.filter((item) => item !== index) : [...prev, index]
      ));
    } else {
      setSelected([index]);
    }
  };

  const handleNext = useCallback(async () => {
    if (!activeDuel || !question || submitting || iHaveSubmitted) return;
    const answer = {
      question_id: question.id,
      selected,
      time_left: timeLeft,
      correct: isCorrect(question, selected),
    };
    const nextAnswers = [...answers, answer];
    setAnswers(nextAnswers);
    setSelected([]);

    if (current + 1 < activeDuel.questions.length) {
      setCurrent((value) => value + 1);
      return;
    }

    setSubmitting(true);
    try {
      const result = await api.finishDuel(
        activeDuel.id,
        nextAnswers.map(({ question_id, selected: chosen, time_left }) => ({
          question_id,
          selected: chosen,
          time_left,
        })),
      );
      setActiveDuel(result);
      await loadDuels();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }, [activeDuel, answers, current, iHaveSubmitted, loadDuels, question, selected, submitting, timeLeft]);

  useEffect(() => {
    if (activeDuel && timeLeft === 0) {
      handleNext();
    }
  }, [activeDuel, handleNext, timeLeft]);

  useEffect(() => {
    if (!activeDuel || activeDuel.status !== 'active' || !iHaveSubmitted) return undefined;

    const timer = window.setInterval(async () => {
      try {
        const fresh = await api.getDuel(activeDuel.id);
        setActiveDuel(fresh);
        if (fresh.status === 'completed') {
          await loadDuels();
        }
      } catch (err) {
        setError(err.message);
      }
    }, 3000);

    return () => window.clearInterval(timer);
  }, [activeDuel, iHaveSubmitted, loadDuels]);

  useEffect(() => {
    if (activeDuel?.status !== 'completed' || activeDuel.winner_id !== user?.id) return;

    const key = `cultcode_shop_${user.username}`;
    const parsed = JSON.parse(localStorage.getItem(key) || '{}');
    const owned = Array.isArray(parsed.owned) ? parsed.owned : [];
    if (owned.includes(DUEL_REWARD_ID)) return;

    localStorage.setItem(key, JSON.stringify({
      ...parsed,
      owned: [...owned, DUEL_REWARD_ID],
      active: DUEL_REWARD_ID,
    }));
    window.dispatchEvent(new CustomEvent('cultcode-decoration-change'));
  }, [activeDuel, user?.id, user?.username]);

  if (!user) {
    return (
      <section className="section">
        <div className="container">
          <div className="login-gate">
            <span className="section-kicker">Культурная дуэль</span>
            <h2 className="section-title">Батлы доступны после входа</h2>
            <p className="section-subtitle">Войди, чтобы бросать вызовы другим участникам и получать редкие награды.</p>
            <button className="btn-primary" onClick={onLoginOpen}>Войти</button>
          </div>
        </div>
      </section>
    );
  }

  if (activeDuel?.status === 'active' && iHaveSubmitted) {
    return (
      <section className="section">
        <div className="container">
          <div className="duel-result">
            <span className="section-kicker">Дуэль отправлена</span>
            <h2>Ожидаем соперника</h2>
            <p>
              Твой результат сохранён: {mySubmittedScore} очков.
              Финальный экран появится автоматически, когда второй участник завершит дуэль.
            </p>
            <div className="loading-state compact">
              <span className="spinner" />
              Проверяем результат
            </div>
            <button className="btn-ghost" onClick={() => setActiveDuel(null)}>К списку батлов</button>
          </div>
        </div>
      </section>
    );
  }

  if (activeDuel?.status === 'active' && question) {
    return (
      <section className="section">
        <div className="container duel-play">
          <div className="duel-topbar">
            <button className="btn-ghost" onClick={() => setActiveDuel(null)}>К батлам</button>
            <span>{activeDuel.challenger} против {activeDuel.opponent}</span>
            <span className="duel-set-badge">10 случайных вопросов</span>
            <strong>{timeLeft} сек</strong>
          </div>
          <div className="quiz-card duel-card">
            <div className="quiz-header">
              <span className="section-kicker">{question.category_label}</span>
              <h2>Вопрос {current + 1} из {activeDuel.questions.length}</h2>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${(timeLeft / QUESTION_SECONDS) * 100}%` }} />
              </div>
            </div>
            <div className="quiz-question">
              <h3>{question.question}</h3>
              {question.type === 'multiple' && <p className="quiz-hint">Можно выбрать несколько вариантов</p>}
              <div className="quiz-options">
                {question.options.map((option, index) => (
                  <button
                    key={option}
                    className={`quiz-option ${selected.includes(index) ? 'selected' : ''}`}
                    onClick={() => toggleAnswer(index)}
                  >
                    <span className="option-letter">{String.fromCharCode(65 + index)}</span>
                    <span className="option-text">{option}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="quiz-actions">
              <button className="btn-primary btn-large" onClick={handleNext} disabled={submitting}>
                {submitting
                  ? 'Сохраняем...'
                  : current + 1 === activeDuel.questions.length ? 'Завершить дуэль' : 'Дальше'}
              </button>
              <span className="duel-live-score">Твои очки: {myScore}</span>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (activeDuel?.status === 'completed') {
    const isWinner = activeDuel.winner_id === user.id;
    return (
      <section className="section">
        <div className="container">
          <div className={`duel-result ${isWinner ? 'win' : ''}`}>
            <span className="section-kicker">Итог дуэли</span>
            <h2>{activeDuel.winner ? `Победил ${activeDuel.winner}` : 'Ничья'}</h2>
            <div className="duel-score-grid">
              <div><span>{activeDuel.challenger}</span><strong>{activeDuel.challenger_score}</strong></div>
              <div><span>{activeDuel.opponent}</span><strong>{activeDuel.opponent_score}</strong></div>
            </div>
            <p>{isWinner ? 'Получено +40 рейтинга и редкая рамка дуэлянта в коллекцию браузера.' : 'Реванш можно бросить из таблицы лидеров.'}</p>
            <button className="btn-primary" onClick={() => setActiveDuel(null)}>Вернуться к батлам</button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="section duels-page">
      <div className="container">
        <div className="section-head">
          <div>
            <span className="section-kicker">Культурная дуэль</span>
            <h2 className="section-title">Батлы за рейтинг</h2>
            <p className="section-subtitle">Выбери соперника, ответь на 10 случайных вопросов быстрее и точнее. Победитель получает +40 рейтинга.</p>
          </div>
        </div>

        {message && <div className="alert success">{message}</div>}
        {error && <div className="alert error">Ошибка батла: {error}</div>}

        <div className="duel-create">
          <div>
            <span className="duel-label">Новый батл</span>
            <strong>Брось вызов по имени пользователя</strong>
          </div>
          <div className="duel-create-controls">
            <input
              value={opponent}
              onChange={(event) => setOpponent(event.target.value)}
              placeholder="Например: Nikita"
            />
            <button className="btn-primary" onClick={createDuel} disabled={!opponent.trim()}>
              Бросить вызов
            </button>
          </div>
        </div>

        <div className="duel-grid">
          <div className="duel-panel">
            <div className="duel-panel-head">
              <h3>Входящие вызовы</h3>
              <span>{incoming.length}</span>
            </div>
            {incoming.map((duel) => (
              <div key={duel.id} className="duel-row duel-card-row duel-incoming-row">
                <div className="duel-row-main">
                  <div className="duel-challenge-title">
                    <span className="duel-label">Тебя вызвал</span>
                    <strong>{duel.challenger}</strong>
                  </div>
                  <small>10 случайных вопросов. Победитель получает +40 рейтинга.</small>
                </div>
                <div className="duel-row-actions incoming-actions">
                  <button className="btn-primary" onClick={() => acceptDuel(duel)}>Принять</button>
                  <button className="btn-ghost" onClick={() => api.declineDuel(duel.id).then(loadDuels)}>Отклонить</button>
                </div>
              </div>
            ))}
            {!incoming.length && <p className="muted">Новых вызовов пока нет.</p>}
          </div>

          <div className="duel-panel">
            <div className="duel-panel-head">
              <h3>Активные батлы</h3>
              <span>{active.length}</span>
            </div>
            {active.map((duel) => (
              <button key={duel.id} className="duel-row action duel-card-row" onClick={() => startDuel(duel)}>
                <div>
                  <span className="duel-label">Соперник</span>
                  <strong>{getRivalName(duel)}</strong>
                  <small>{duel.challenger} против {duel.opponent}</small>
                </div>
                <strong className="duel-status-pill">Играть</strong>
              </button>
            ))}
            {!active.length && !loading && <p className="muted">Активных дуэлей нет.</p>}
          </div>

          <div className="duel-panel">
            <div className="duel-panel-head">
              <h3>История</h3>
              <span>{history.length}</span>
            </div>
            {history.slice(0, 5).map((duel) => (
              <article key={duel.id} className="duel-history-card">
                <div className="duel-history-header">
                  <span className="duel-label">Завершённый батл</span>
                  <strong>{getDuelResultLabel(duel)}</strong>
                </div>
                <div className="duel-history-versus">
                  <div>
                    <span>Ты</span>
                    <strong>{user.username}</strong>
                    <em>{getMyDuelScore(duel)} очков</em>
                  </div>
                  <b>против</b>
                  <div>
                    <span>Соперник</span>
                    <strong>{getRivalName(duel)}</strong>
                    <em>{getRivalDuelScore(duel)} очков</em>
                  </div>
                </div>
                <button className="btn-ghost duel-history-open" onClick={() => setActiveDuel(duel)}>
                  Смотреть итог
                </button>
              </article>
            ))}
            {!history.length && <p className="muted">История появится после первой дуэли.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
