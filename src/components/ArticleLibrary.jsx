import { useCallback, useState, useEffect } from 'react';
import { api } from '../api.js';
import { useUser } from '../contexts/UserContext.jsx';
import { articles as localArticles } from '../data/articles.js';
import ArticleCard from './ArticleCard.jsx';
import Icon from './Icon.jsx';

const localArticleByTitle = new Map(localArticles.map((article) => [article.title, article]));

const isPublicArticle = (article) => !article.title?.startsWith('Командные вопросы:');

export default function ArticleLibrary({ onSelect }) {
  const { user } = useUser();
  const [articles, setArticles] = useState([]);
  const [results, setResults] = useState([]);
  const [filter, setFilter] = useState('all');
  const [difficultyFilter, setDifficultyFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortMode, setSortMode] = useState('default');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fallback, setFallback] = useState(false);
  const [visibleCount, setVisibleCount] = useState(10);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setFallback(false);

    try {
      const requests = [api.getArticles()];
      if (user) {
        requests.push(api.getMyResults());
      }

      const [articlesData, resultsData = []] = await Promise.all(requests);

      if (!Array.isArray(articlesData)) {
        throw new Error('Некорректный ответ от сервера');
      }

      const parsed = articlesData
        .filter(isPublicArticle)
        .map((a) => {
          const localArticle = localArticleByTitle.get(a.title);
          return {
            ...a,
            content: typeof a.content === 'string' ? JSON.parse(a.content || '[]') : a.content,
            questions: localArticle?.questions || (typeof a.questions === 'string' ? JSON.parse(a.questions || '[]') : a.questions),
            questionSets: localArticle?.questionSets,
            image: localArticle?.image || a.image,
          };
        });

      if (parsed.length) {
        setArticles(parsed);
        setFallback(false);
      } else {
        setArticles(localArticles);
      }
      setResults(resultsData);
    } catch (err) {
      console.error('[Articles] error:', err);
      setError(err.message);
      setArticles(localArticles);
      setFallback(true);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setVisibleCount(10);
  }, [filter, difficultyFilter, statusFilter, sortMode, query]);

  const categories = [
    { id: 'all', label: 'Все', icon: 'all' },
    { id: 'history', label: 'История', icon: 'history' },
    { id: 'culture', label: 'Культура', icon: 'culture' },
    { id: 'nature', label: 'Природа', icon: 'nature' },
    { id: 'traditions', label: 'Традиции', icon: 'traditions' },
    { id: 'architecture', label: 'Архитектура', icon: 'architecture' },
    { id: 'memorial', label: 'Память', icon: 'memorial' },
  ];

  const difficulties = [
    { id: 'all', label: 'Любая' },
    { id: 'easy', label: 'Лёгкий' },
    { id: 'medium', label: 'Средний' },
    { id: 'hard', label: 'Сложный' },
  ];

  const statusOptions = [
    { id: 'all', label: 'Все' },
    { id: 'new', label: 'Не пройдено' },
    { id: 'done', label: 'Пройдено' },
  ];

  const sortOptions = [
    { id: 'default', label: 'По порядку' },
    { id: 'title', label: 'По названию' },
    { id: 'time', label: 'По времени' },
    { id: 'difficulty', label: 'По сложности' },
  ];

  const hasActiveFilters = filter !== 'all' || difficultyFilter !== 'all' || statusFilter !== 'all' || sortMode !== 'default' || query.trim() !== '';

  const normalizedQuery = query.trim().toLowerCase();

  const filtered = articles
    .filter((a) => filter === 'all' || a.category === filter)
    .filter((a) => difficultyFilter === 'all' || a.difficulty === difficultyFilter)
    .filter((a) => {
      const completed = (results || []).some((r) => r.article_id === a.id);
      if (statusFilter === 'done') return completed;
      if (statusFilter === 'new') return !completed;
      return true;
    })
    .filter((a) => {
      if (!normalizedQuery) return true;
      const searchable = [
        a.title,
        a.categoryLabel,
        a.difficultyLabel,
        String(a.readTime),
        ...(a.content || []).map((block) => `${block.title || ''} ${block.text || ''}`),
      ].join(' ').toLowerCase();
      return searchable.includes(normalizedQuery);
    })
    .sort((a, b) => {
      if (sortMode === 'title') return a.title.localeCompare(b.title, 'ru');
      if (sortMode === 'time') return a.readTime - b.readTime;
      if (sortMode === 'difficulty') {
        const order = { easy: 1, medium: 2, hard: 3 };
        return order[a.difficulty] - order[b.difficulty];
      }
      return a.id - b.id;
    });

  if (loading) {
    return (
      <div className="container section">
        <div className="loading-state">
          <span className="spinner" />
          Загрузка достопримечательностей
        </div>
      </div>
    );
  }

  return (
    <section className="section">
      <div className="container">
        <div className="section-head">
          <div>
            <span className="section-kicker">Каталог</span>
            <h2 className="section-title">Достопримечательности Беларуси</h2>
            <p className="section-subtitle">
              Ищи по названию, теме или описанию, фильтруй маршрут и проходи задания по каждому месту.
            </p>
          </div>
          <div className="catalog-count">
            <strong>{filtered.length}</strong>
            <span>из {articles.length} мест</span>
          </div>
        </div>

        {fallback && (
          <div className="alert warning">
            Показана локальная база из {localArticles.length} достопримечательностей ({error}).
          </div>
        )}

        {error && !fallback && (
          <div className="alert error">
            Ошибка загрузки: {error}
            <button className="btn-primary" onClick={load} style={{ marginLeft: '1rem' }}>
              Повторить
            </button>
          </div>
        )}

        <div className="catalog-filter-panel">
          <div className="catalog-filter-top">
            <label className="search-field">
              <Icon name="search" size={18} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Найти место, тему или факт..."
              />
            </label>

            <div className="catalog-selects">
              <label>
                <span>Сложность</span>
                <select value={difficultyFilter} onChange={(e) => setDifficultyFilter(e.target.value)}>
                  {difficulties.map((difficulty) => (
                    <option key={difficulty.id} value={difficulty.id}>{difficulty.label}</option>
                  ))}
                </select>
              </label>

              <label>
                <span>Статус</span>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  {statusOptions.map((status) => (
                    <option key={status.id} value={status.id}>{status.label}</option>
                  ))}
                </select>
              </label>

              <label>
                <span>Сортировка</span>
                <select value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
                  {sortOptions.map((sort) => (
                    <option key={sort.id} value={sort.id}>{sort.label}</option>
                  ))}
                </select>
              </label>

              {hasActiveFilters && (
                <button
                  className="btn-ghost catalog-reset"
                  onClick={() => {
                    setFilter('all');
                    setDifficultyFilter('all');
                    setStatusFilter('all');
                    setSortMode('default');
                    setQuery('');
                  }}
                >
                  Сбросить
                </button>
              )}
            </div>
          </div>

          <div className="filter-bar">
            {categories.map((cat) => (
              <button
                key={cat.id}
                className={`filter-btn ${filter === cat.id ? 'active' : ''}`}
                onClick={() => setFilter(cat.id)}
              >
                <Icon name={cat.icon} size={18} />
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        <div className="card-grid">
          {filtered.slice(0, visibleCount).map((article) => (
            <ArticleCard key={article.id} article={article} results={results} onSelect={onSelect} />
          ))}
        </div>

        {visibleCount < filtered.length && (
          <div className="load-more">
            <button
              className="btn-secondary btn-large"
              onClick={() => setVisibleCount((prev) => prev + 10)}
            >
              Показать ещё {Math.min(filtered.length - visibleCount, 10)} из {filtered.length - visibleCount}
            </button>
          </div>
        )}

        {filtered.length === 0 && (
          <div className="empty-state">По таким фильтрам достопримечательности не найдены.</div>
        )}
      </div>
    </section>
  );
}
