import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useUser } from '../contexts/UserContext.jsx';

function isCorrect(question, selected) {
  if (Array.isArray(question.correct)) {
    return question.correct.slice().sort().join(',') === selected.slice().sort().join(',');
  }
  return selected.length === 1 && selected[0] === question.correct;
}

function cleanCode(value) {
  return value.replace(/\D/g, '').slice(0, 6);
}

export default function TeamBattles({ onLoginOpen }) {
  const { user } = useUser();
  const [categories, setCategories] = useState([]);
  const [createCode, setCreateCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [category, setCategory] = useState('');
  const [questionCount, setQuestionCount] = useState(10);
  const [battle, setBattle] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState([]);
  const [answers, setAnswers] = useState([]);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!user) return;
    api.getTeamBattleCategories()
      .then((items) => {
        setCategories(items);
        setCategory((value) => value || items[0]?.category || '');
      })
      .catch((err) => setError(err.message));
  }, [user]);

  const myResult = useMemo(() => (
    battle?.participants?.find((item) => item.username === user?.username)
  ), [battle, user?.username]);

  const sortedParticipants = useMemo(() => (
    [...(battle?.participants || [])].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? -1 : 1;
      return b.score - a.score;
    })
  ), [battle]);

  const question = battle?.questions?.[current];
  const canCreate = createCode.length === 6 && category;
  const canJoin = joinCode.length === 6;
  const isCreator = battle?.creator === user?.username;

  const startLocalQuiz = () => {
    setCurrent(0);
    setSelected([]);
    setAnswers([]);
    setPlaying(true);
    setMessage(null);
  };

  const startBattle = async () => {
    if (!battle?.code || loading) return;
    if (!isCreator) {
      setMessage('Начать командный батл может только создатель комнаты.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const nextBattle = await api.startTeamBattle(battle.code);
      setBattle(nextBattle);
      startLocalQuiz();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const generateFreeCode = async () => {
    setGenerating(true);
    setError(null);
    setMessage(null);

    try {
      for (let attempt = 0; attempt < 25; attempt += 1) {
        const nextCode = String(Math.floor(100000 + Math.random() * 900000));
        const result = await api.checkTeamBattleCode(nextCode);
        if (result.available) {
          setCreateCode(nextCode);
          setMessage(`Свободный код найден: ${nextCode}`);
          return;
        }
      }
      setError('Не удалось подобрать свободный код. Нажми «Сгенерировать» ещё раз.');
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const createBattle = async () => {
    if (!canCreate) return;
    setLoading(true);
    setError(null);
    try {
      const nextBattle = await api.createTeamBattle(createCode, category, questionCount);
      setBattle(nextBattle);
      setJoinCode(createCode);
      setMessage(`Комната ${createCode} создана. Дай код участникам, а когда все подключатся, нажми «Начать».`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const joinBattle = async () => {
    if (!canJoin) return;
    setLoading(true);
    setError(null);
    try {
      const nextBattle = await api.joinTeamBattle(joinCode);
      setBattle(nextBattle);
      setMessage(`Ты вошёл в комнату ${joinCode}. Жди, пока создатель комнаты нажмёт «Начать».`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const refreshBattle = async () => {
    if (!battle?.code) return;
    try {
      setBattle(await api.getTeamBattle(battle.code));
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    if (!battle?.code || playing) return undefined;

    const timer = window.setInterval(() => {
      api.getTeamBattle(battle.code)
        .then(setBattle)
        .catch(() => {});
    }, 3000);

    return () => window.clearInterval(timer);
  }, [battle?.code, playing]);

  useEffect(() => {
    if (battle?.started && !playing && !myResult?.completed) {
      startLocalQuiz();
    }
  }, [battle?.started, myResult?.completed, playing]);

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

  const handleNext = async () => {
    if (!battle || !question || selected.length === 0) return;

    const answer = {
      question_id: question.id,
      selected,
      time_left: 0,
      correct: isCorrect(question, selected),
    };
    const nextAnswers = [...answers, answer];
    setAnswers(nextAnswers);
    setSelected([]);

    if (current + 1 < battle.questions.length) {
      setCurrent((value) => value + 1);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await api.finishTeamBattle(
        battle.code,
        nextAnswers.map(({ question_id, selected: chosen, time_left }) => ({
          question_id,
          selected: chosen,
          time_left,
        })),
      );
      setBattle(result);
      setPlaying(false);
      const score = nextAnswers.filter((item) => item.correct).length * 100;
      setMessage(`Готово: твой результат ${score} из ${battle.questions.length * 100}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <section className="section">
        <div className="container">
          <div className="login-gate">
            <span className="section-kicker">Командный режим</span>
            <h2 className="section-title">Команды доступны после входа</h2>
            <p className="section-subtitle">Войди, чтобы создавать комнаты по коду и соревноваться с группой.</p>
            <button className="btn-primary" onClick={onLoginOpen}>Войти</button>
          </div>
        </div>
      </section>
    );
  }

  if (playing && question) {
    return (
      <section className="section">
        <div className="container duel-play">
          <div className="duel-topbar">
            <button className="btn-ghost" onClick={() => setPlaying(false)}>К комнате</button>
            <span>Комната {battle.code} · {battle.category_label}</span>
            <strong>{current + 1}/{battle.questions.length}</strong>
          </div>

          <div className="quiz-card duel-card">
            <div className="quiz-header">
              <span className="section-kicker">{question.category_label}</span>
              <h2>Командный вопрос</h2>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${((current + 1) / battle.questions.length) * 100}%` }} />
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
              <button className="btn-primary btn-large" onClick={handleNext} disabled={loading || selected.length === 0}>
                {current + 1 === battle.questions.length ? 'Сдать результат' : 'Дальше'}
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="section team-page">
      <div className="container">
        <div className="section-head">
          <div>
            <span className="section-kicker">Командный режим</span>
            <h2 className="section-title">Команды</h2>
            <p className="section-subtitle">Создай комнату с 6-значным кодом, выбери тему и дай код участникам.</p>
          </div>
        </div>

        {message && <div className="alert success">{message}</div>}
        {error && <div className="alert error">Ошибка командного батла: {error}</div>}

        <div className="team-setup-grid">
          <div className="team-setup-card">
            <span className="duel-label">Создать комнату</span>
            <h3>Код и настройки</h3>
            <label className="team-field">
              <span>6-значный код</span>
              <div className="team-code-row">
                <input
                  value={createCode}
                  onChange={(event) => setCreateCode(cleanCode(event.target.value))}
                  placeholder="123456"
                  inputMode="numeric"
                />
                <button className="btn-ghost" type="button" onClick={generateFreeCode} disabled={generating || loading}>
                  {generating ? 'Ищу...' : 'Сгенерировать'}
                </button>
              </div>
            </label>

            <div className="team-filter-panel">
              <div className="team-field">
                <span>Тема вопросов</span>
                <div className="team-topic-options">
                  {categories.map((item) => (
                    <button
                      key={item.category}
                      type="button"
                      className={category === item.category ? 'active' : ''}
                      onClick={() => setCategory(item.category)}
                    >
                      {item.category_label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="team-field">
                <span>Количество вопросов</span>
                <div className="team-count-options">
                  {Array.from({ length: 21 }, (_, index) => index + 10).map((count) => (
                    <button
                      key={count}
                      type="button"
                      className={questionCount === count ? 'active' : ''}
                      onClick={() => setQuestionCount(count)}
                    >
                      {count}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button className="btn-primary btn-full" onClick={createBattle} disabled={!canCreate || loading}>
              Создать
            </button>
          </div>

          <div className="team-setup-card">
            <span className="duel-label">Подключиться</span>
            <h3>Войти по коду</h3>
            <label className="team-field">
              <span>Код комнаты</span>
              <input
                value={joinCode}
                onChange={(event) => setJoinCode(cleanCode(event.target.value))}
                placeholder="123456"
                inputMode="numeric"
              />
            </label>
            <p className="muted">Попроси код у создателя комнаты. После входа ты попадёшь в список участников.</p>
            <button className="btn-secondary btn-full" onClick={joinBattle} disabled={!canJoin || loading}>
              Войти
            </button>
          </div>
        </div>

        {battle && (
          <div className="team-room">
            <div className="team-room-head">
              <div>
                <span className="duel-label">Комната {battle.code}</span>
                <h3>{battle.category_label}</h3>
                <p>Создал: {battle.creator}. Вопросов: {battle.questions.length}. Код можно дать всем участникам.</p>
              </div>
              <div className="team-room-actions">
                <button className="btn-ghost" onClick={refreshBattle}>Обновить результаты</button>
                {!myResult?.completed && (
                  <button
                    className="btn-primary"
                    onClick={startBattle}
                    disabled={!isCreator || loading}
                    title={isCreator ? 'Запустить командный батл для всех' : 'Начать может только создатель комнаты'}
                  >
                    {isCreator ? 'Начать' : 'Ждём создателя'}
                  </button>
                )}
              </div>
            </div>

            <div className="team-table-wrap">
              <table className="team-table">
                <thead>
                  <tr>
                    <th>Место</th>
                    <th>Участник</th>
                    <th>Статус</th>
                    <th>Результат</th>
                    <th>Награда</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedParticipants.map((item, index) => (
                    <tr key={item.username} className={item.username === user.username ? 'me' : ''}>
                      <td><span className="team-place">{index + 1}</span></td>
                      <td>
                        <strong>{item.username}</strong>
                        {item.username === battle.creator && <small>Создатель</small>}
                        {item.username === user.username && <small>Это ты</small>}
                      </td>
                      <td>
                        <span className={`team-status ${item.completed ? 'done' : 'waiting'}`}>
                          {item.completed ? 'Ответил' : 'В комнате'}
                        </span>
                      </td>
                      <td><b>{item.completed ? `${item.score} очков` : 'ждём'}</b></td>
                      <td><b>{item.reward_points > 0 ? `+${item.reward_points}` : '—'}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
