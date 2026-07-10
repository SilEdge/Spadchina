import { useState } from 'react';

let mountCount = 0;
export default function Quiz({ article, onFinish, onBack }) {
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState([]);
  const [answers, setAnswers] = useState([]);
  mountCount += 1;
  console.log('[Quiz] mount/render #', mountCount, 'current=', current, 'selected=', selected, 'qlen=', article.questions.length);

  const question = article.questions[current];
  const isLast = current === article.questions.length - 1;

  const handleToggle = (index) => {
    if (question.type === 'multiple') {
      setSelected((prev) =>
        prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]
      );
    } else {
      setSelected([index]);
    }
  };

  const handleNext = () => {
    console.log('[Quiz] handleNext called, current=', current, 'isLast=', isLast, 'selected=', selected);
    let isCorrect = false;

    if (question.type === 'multiple') {
      const correct = question.correct.slice().sort().join(',');
      const chosen = selected.slice().sort().join(',');
      isCorrect = correct === chosen;
    } else {
      isCorrect = selected[0] === question.correct;
    }

    const newAnswers = [...answers, { questionId: question.id, isCorrect }];
    setAnswers(newAnswers);

    if (isLast) {
      const score = newAnswers.filter((a) => a.isCorrect).length;
      console.log('[Quiz] isLast, calling onFinish, score=', score);
      onFinish(score);
    } else {
      console.log('[Quiz] advancing current from', current);
      setCurrent((prev) => prev + 1);
      setSelected([]);
    }
  };

  return (
    <section className="section">
      <div className="container quiz-container">
        <button className="btn-ghost btn-back" onClick={onBack}>
          ← Вернуться к описанию
        </button>

        <div className="quiz-card">
          <div className="quiz-header">
            <span className="quiz-progress">
              Вопрос {current + 1} из {article.questions.length}
            </span>
            <h2>{article.title}</h2>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${((current + 1) / article.questions.length) * 100}%` }}
              />
            </div>
          </div>

          <div className="quiz-question">
            <h3>{question.question}</h3>
            {question.type === 'multiple' && (
              <p className="quiz-hint">Выберите один или несколько вариантов</p>
            )}

            <div className="quiz-options">
              {question.options.map((option, index) => {
                const isSelected = selected.includes(index);
                return (
                  <button
                    key={index}
                    className={`quiz-option ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleToggle(index)}
                  >
                    <span className="option-letter">
                      {String.fromCharCode(65 + index)}
                    </span>
                    <span className="option-text">{option}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="quiz-actions">
            <button
              className="btn-primary btn-large"
              disabled={selected.length === 0}
              onClick={handleNext}
            >
              {isLast ? 'Завершить' : 'Дальше'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
