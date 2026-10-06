export default function ArticleReader({ article, onStartQuiz, onBack }) {
  const questionCount = article.questionSets?.length
    ? article.questionSets.flat().length
    : article.questions.length;
  const attemptCount = Math.min(10, questionCount);

  return (
    <section className="section">
      <div className="container">
        <button className="btn-ghost btn-back" onClick={onBack}>
          ← Назад к достопримечательностям
        </button>

        <article className="reader-card">
          <div
            className="reader-cover"
            style={{ backgroundImage: `url("${article.image}")` }}
          >
            <span className={`badge badge-${article.category}`}>{article.categoryLabel}</span>
          </div>

          <div className="reader-content">
            <div className="reader-meta">
              <span className={`badge badge-${article.difficulty}`}>{article.difficultyLabel}</span>
              <span className="article-time">{article.readTime} мин чтения</span>
            </div>

            <h1>{article.title}</h1>

            {article.content.map((block, index) => {
              if (block.type === 'lead') {
                return <p key={index} className="reader-lead">{block.text}</p>;
              }
              if (block.type === 'paragraph') {
                return <p key={index}>{block.text}</p>;
              }
              if (block.type === 'fact') {
                return (
                  <div key={index} className="fact-box">
                    <strong>{block.title}</strong>
                    <p>{block.text}</p>
                  </div>
                );
              }
              return null;
            })}

            <div className="reader-actions">
              <button className="btn-primary btn-large" onClick={onStartQuiz}>
                Перейти к заданиям
              </button>
              <span className="muted">
                {questionCount > attemptCount
                  ? `${attemptCount} вопросов за попытку · ${questionCount} заданий в базе`
                  : `${questionCount} заданий по материалу`}
              </span>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
