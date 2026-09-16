export default function ArticleCard({ article, results, onSelect }) {
  const completedResult = (results || []).find((r) => r.article_id === article.id);
  const completed = !!completedResult;
  const score = completedResult?.score ?? 0;
  const maxScore = article.questions.length;

  const preview = article.content?.[0]?.text?.slice(0, 100) ?? '';

  return (
    <article className="article-card">
      <div className="article-image" style={{ backgroundImage: `url("${article.image}")` }}>
        <span className={`badge badge-${article.category}`}>{article.categoryLabel}</span>
        {completed && <span className="article-done">✓ Прочитано</span>}
      </div>
      <div className="article-body">
        <div className="article-meta">
          <span className={`badge badge-${article.difficulty}`}>{article.difficultyLabel}</span>
          <span className="article-time">{article.readTime} мин чтения</span>
        </div>
        <h3>{article.title}</h3>
        <p>{preview}{preview ? '...' : ''}</p>
        {completed && (
          <div className="article-score">
            Результат: {score}/{maxScore}
          </div>
        )}
        <button className="btn-primary btn-full" onClick={() => onSelect(article)}>
          {completed ? 'Пройти снова' : 'Изучить и ответить'}
        </button>
      </div>
    </article>
  );
}
