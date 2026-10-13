import { useState, useEffect } from 'react';
import { api } from '../api.js';
import AdminContentManager from './AdminContentManager.jsx';

const emptyArticle = {
  title: '',
  category: 'history',
  categoryLabel: 'История',
  difficulty: 'easy',
  difficultyLabel: 'Лёгкий',
  readTime: 4,
  image: '',
  content: '',
  questions: '',
};

const categoryLabels = {
  history: 'История',
  culture: 'Культура',
  nature: 'Природа',
  traditions: 'Традиции',
  architecture: 'Архитектура',
  memorial: 'Память',
};

const difficultyLabels = {
  easy: 'Лёгкий',
  medium: 'Средний',
  hard: 'Сложный',
};

const categoryOptions = [
  { id: 'history', label: 'История' },
  { id: 'culture', label: 'Культура' },
  { id: 'nature', label: 'Природа' },
  { id: 'traditions', label: 'Традиции' },
  { id: 'architecture', label: 'Архитектура' },
  { id: 'memorial', label: 'Память' },
];

const difficultyOptions = [
  { id: 'easy', label: 'Лёгкий' },
  { id: 'medium', label: 'Средний' },
  { id: 'hard', label: 'Сложный' },
];

const isPublicArticle = (article) => !article.title?.startsWith('Командные вопросы:');

function normalizeContent(value) {
  if (!value) return '';
  const blocks = typeof value === 'string' ? JSON.parse(value || '[]') : value;
  if (!Array.isArray(blocks)) return '';

  return blocks
    .map((block) => {
      if (block.type === 'fact') {
        return [block.title, block.text].filter(Boolean).join('\n');
      }
      return block.text || '';
    })
    .filter(Boolean)
    .join('\n\n');
}

function buildContentPayload(text) {
  const blocks = text
    .split(/\n\s*\n/)
    .map((item) => item.trim())
    .filter(Boolean);

  return JSON.stringify(
    blocks.map((item, index) => ({
      type: index === 0 ? 'lead' : 'paragraph',
      text: item.replace(/\n+/g, ' '),
    }))
  );
}

function normalizeQuestions(value) {
  if (!value) return '';
  const questions = typeof value === 'string' ? JSON.parse(value || '[]') : value;
  if (!Array.isArray(questions)) return '';

  return questions
    .map((item) => {
      const correctIndexes = Array.isArray(item.correct) ? item.correct : [item.correct];
      const correctAnswers = correctIndexes
        .map((index) => item.options?.[index])
        .filter(Boolean);
      const wrongAnswers = (item.options || []).filter((option) => !correctAnswers.includes(option));

      return [
        `Вопрос: ${item.question || ''}`,
        `Ответ: ${correctAnswers.join('; ')}`,
        `Варианты: ${wrongAnswers.join('; ')}`,
      ].join('\n');
    })
    .join('\n\n');
}

function parseQuestionBlock(block, index) {
  const lines = block
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const byLabel = (label) => {
    const line = lines.find((item) => item.toLowerCase().startsWith(label));
    return line ? line.slice(line.indexOf(':') + 1).trim() : '';
  };

  const question = byLabel('вопрос:') || lines[0] || '';
  const correct = byLabel('ответ:') || lines[1] || '';
  const variantsText = byLabel('варианты:') || lines.slice(2).join('; ');
  const variants = variantsText
    .split(/[;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (!question || !correct) {
    throw new Error(`Заполни вопрос и правильный ответ в блоке ${index + 1}`);
  }

  const options = [correct, ...variants].filter((item, itemIndex, list) => list.indexOf(item) === itemIndex);
  if (options.length < 2) {
    throw new Error(`Добавь хотя бы один неправильный вариант в блоке ${index + 1}`);
  }

  const shift = index % options.length;
  const orderedOptions = [...options.slice(shift), ...options.slice(0, shift)];

  return {
    id: index + 1,
    type: 'single',
    question: question.replace(/^вопрос:\s*/i, ''),
    options: orderedOptions,
    correct: orderedOptions.indexOf(correct),
  };
}

function buildQuestionsPayload(text) {
  const blocks = text
    .split(/\n\s*\n/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (!blocks.length) {
    throw new Error('Добавь хотя бы один вопрос');
  }

  return JSON.stringify(blocks.map(parseQuestionBlock));
}

export default function AdminPanel() {
  const [articles, setArticles] = useState([]);
  const [users, setUsers] = useState([]);
  const [activeTab, setActiveTab] = useState('articles');
  const [form, setForm] = useState({ ...emptyArticle });
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [articleQuery, setArticleQuery] = useState('');

  const filteredArticles = articles.filter((article) =>
    article.title.toLowerCase().includes(articleQuery.trim().toLowerCase())
  );

  useEffect(() => {
    loadData();
  }, []);

  const loadData = () => {
    api.getArticles()
      .then((arts) => {
        setArticles(arts.filter(isPublicArticle));
      })
      .catch((err) => setError(err.message));

    api.getUsers()
      .then((usrs) => {
        setUsers(usrs);
      })
      .catch((err) => {
        if (err.message !== 'admin only') {
          setError(err.message);
        }
      });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage(null);
    setError(null);

    try {
      const articlePayload = {
        ...form,
        readTime: Number(form.readTime),
        content: buildContentPayload(form.content),
        questions: buildQuestionsPayload(form.questions),
      };

      if (editingId) {
        await api.updateArticle(editingId, articlePayload);
        setMessage('Статья обновлена');
      } else {
        await api.createArticle(articlePayload);
        setMessage('Статья создана');
      }
      setForm({ ...emptyArticle });
      setEditingId(null);
      loadData();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleEdit = (article) => {
    setForm({
      title: article.title,
      category: article.category,
      categoryLabel: article.categoryLabel,
      difficulty: article.difficulty,
      difficultyLabel: article.difficultyLabel,
      readTime: article.readTime,
      image: article.image,
      content: normalizeContent(article.content),
      questions: normalizeQuestions(article.questions),
    });
    setEditingId(article.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteArticle = async (id) => {
    if (!confirm('Удалить статью?')) return;
    try {
      await api.deleteArticle(id);
      loadData();
      setMessage('Статья удалена');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteUser = async (id) => {
    if (!confirm('Удалить пользователя?')) return;
    try {
      await api.deleteUser(id);
      loadData();
      setMessage('Пользователь удалён');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => {
      if (name === 'category') {
        return { ...prev, category: value, categoryLabel: categoryLabels[value] || prev.categoryLabel };
      }
      if (name === 'difficulty') {
        return { ...prev, difficulty: value, difficultyLabel: difficultyLabels[value] || prev.difficultyLabel };
      }
      return { ...prev, [name]: value };
    });
  };

  const setCategory = (value) => {
    setForm((prev) => ({
      ...prev,
      category: value,
      categoryLabel: categoryLabels[value] || prev.categoryLabel,
    }));
  };

  const setDifficulty = (value) => {
    setForm((prev) => ({
      ...prev,
      difficulty: value,
      difficultyLabel: difficultyLabels[value] || prev.difficultyLabel,
    }));
  };

  return (
    <section className="section">
      <div className="container">
        <div className="section-head">
          <div>
            <span className="section-kicker">Управление</span>
            <h2 className="section-title">Панель администратора</h2>
            <p className="section-subtitle">Управление статьями, вопросами баттлов, наградами и пользователями.</p>
          </div>
        </div>

        {message && <div className="alert success">{message}</div>}
        {error && <div className="alert error">{error}</div>}

        <div className="admin-tabs">
          <button
            className={activeTab === 'articles' ? 'active' : ''}
            onClick={() => setActiveTab('articles')}
          >
            Статьи
          </button>
          <button
            className={activeTab === 'users' ? 'active' : ''}
            onClick={() => setActiveTab('users')}
          >
            Пользователи
          </button>
          <button className={activeTab === 'questions' ? 'active' : ''} onClick={() => setActiveTab('questions')}>Вопросы баттлов</button>
          <button className={activeTab === 'rewards' ? 'active' : ''} onClick={() => setActiveTab('rewards')}>Награды</button>
        </div>

        {(activeTab === 'questions' || activeTab === 'rewards') && <AdminContentManager kind={activeTab} />}

        {activeTab === 'articles' && (
          <>
            <div className="admin-form-card">
              <div className="admin-form-head">
                <div>
                  <span className="section-kicker">Материал</span>
                  <h3>{editingId ? 'Редактировать статью' : 'Добавить статью'}</h3>
                </div>
                <span className="admin-form-pill">{editingId ? 'Редактирование' : 'Новая статья'}</span>
              </div>
              <form onSubmit={handleSubmit} className="admin-form">
                <div className="admin-form-section">
                  <h4>Основное</h4>
                  <label className="form-row">
                    <span className="muted">Заголовок</span>
                    <input name="title" value={form.title} onChange={handleChange} placeholder="Например: Национальная библиотека Беларуси" required />
                  </label>
                  <div className="form-row grid-2">
                    <div className="form-row">
                      <span className="muted">Категория</span>
                      <div className="admin-choice-grid">
                        {categoryOptions.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            className={`admin-choice admin-choice-${option.id} ${form.category === option.id ? 'active' : ''}`}
                            onClick={() => setCategory(option.id)}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="form-row">
                      <span className="muted">Сложность</span>
                      <div className="admin-choice-grid compact">
                        {difficultyOptions.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            className={`admin-choice admin-choice-${option.id} ${form.difficulty === option.id ? 'active' : ''}`}
                            onClick={() => setDifficulty(option.id)}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="form-row grid-2">
                    <label className="form-row">
                      <span className="muted">Время чтения, мин</span>
                      <input name="readTime" type="number" min="1" value={form.readTime} onChange={handleChange} placeholder="Время чтения" required />
                    </label>
                    <label className="form-row">
                      <span className="muted">URL изображения</span>
                      <input name="image" value={form.image} onChange={handleChange} placeholder="https://..." required />
                    </label>
                  </div>
                </div>

                <div className="admin-form-section">
                  <h4>Текст статьи</h4>
                  <label className="form-row">
                    <span className="muted">Контент</span>
                    <textarea
                      name="content"
                      value={form.content}
                      onChange={handleChange}
                      rows="8"
                      placeholder={'Напиши обычный текст статьи. Каждый новый абзац отделяй пустой строкой.'}
                      required
                    />
                    <small>Первый абзац станет вводным, остальные будут обычными абзацами статьи.</small>
                  </label>
                </div>

                <div className="admin-form-section">
                  <h4>Вопросы</h4>
                  <label className="form-row">
                    <span className="muted">Вопросы для викторины</span>
                    <textarea
                      name="questions"
                      value={form.questions}
                      onChange={handleChange}
                      rows="10"
                      placeholder={'Вопрос: Чем известна Национальная библиотека Беларуси?\nОтвет: Формой ромбокубооктаэдра\nВарианты: Деревянной башней; Подземным дворцом; Морским маяком\n\nВопрос: Где находится объект?\nОтвет: В Минске\nВарианты: В Гродно; В Бресте; В Витебске'}
                      required
                    />
                    <small>Один блок = один вопрос. Разделяй вопросы пустой строкой. JSON писать не нужно.</small>
                  </label>
                </div>

                <div className="form-actions">
                  <button type="submit" className="btn-primary">
                    {editingId ? 'Сохранить' : 'Создать'}
                  </button>
                  {editingId && (
                    <button type="button" className="btn-ghost" onClick={() => { setEditingId(null); setForm({ ...emptyArticle }); }}>
                      Отмена
                    </button>
                  )}
                </div>
              </form>
            </div>

            <div className="admin-list-head">
              <div>
                <h3>Список статей</h3>
                <span className="muted">
                  Показано {filteredArticles.length} из {articles.length}
                </span>
              </div>
            </div>
            <div className="admin-search">
              <span className="muted">Поиск по названию</span>
              <div className="admin-search-field">
                <span aria-hidden="true">⌕</span>
                <input
                  value={articleQuery}
                  onChange={(event) => setArticleQuery(event.target.value)}
                  placeholder="Например: Мирский замок"
                />
                {articleQuery && (
                  <button type="button" onClick={() => setArticleQuery('')}>
                    Очистить
                  </button>
                )}
              </div>
            </div>
            <div className="admin-list">
              {filteredArticles.map((article) => (
                <div key={article.id} className="admin-list-item">
                  <div>
                    <strong>{article.title}</strong>
                    <span className="admin-list-meta">{article.categoryLabel} • {article.difficultyLabel}</span>
                  </div>
                  <div className="admin-list-actions">
                    <button className="btn-ghost" onClick={() => handleEdit(article)}>Редактировать</button>
                    <button className="btn-danger" onClick={() => handleDeleteArticle(article.id)}>Удалить</button>
                  </div>
                </div>
              ))}
              {!filteredArticles.length && (
                <div className="admin-empty">Статьи с таким названием не найдены.</div>
              )}
            </div>
          </>
        )}

        {activeTab === 'users' && (
          <div className="admin-list">
            {users.map((user) => (
              <div key={user.id} className="admin-list-item">
                <div>
                  <strong>{user.username}</strong>
                  <span className="admin-list-meta">{user.role} • {user.points} баллов</span>
                </div>
                {user.role !== 'admin' && (
                  <button className="btn-danger" onClick={() => handleDeleteUser(user.id)}>
                    Удалить
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
