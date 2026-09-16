import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { articles as localArticles } from '../data/articles.js';
import { useUser } from '../contexts/UserContext.jsx';

import Icon from './Icon.jsx';

const categoryMeta = {
  history: { label: 'История', icon: 'history' },
  culture: { label: 'Культура', icon: 'culture' },
  nature: { label: 'Природа', icon: 'nature' },
  traditions: { label: 'Традиции', icon: 'traditions' },
  architecture: { label: 'Архитектура', icon: 'architecture' },
  memorial: { label: 'Память', icon: 'memorial' },
};

const steps = [
  { title: 'Выбери тему', text: 'Фильтруй материалы по интересам.' },
  { title: 'Читай и изучай', text: 'Короткие статьи с ключевыми фактами.' },
  { title: 'Проходи челленджи', text: 'Отвечай на вопросы и зарабатывай баллы.' },
];

const localArticleByTitle = new Map(localArticles.map((article) => [article.title, article]));

const isPublicArticle = (article) => !article.title?.startsWith('Командные вопросы:');

function parseArticle(article) {
  const localArticle = localArticleByTitle.get(article.title);

  return {
    ...article,
    content: typeof article.content === 'string' ? JSON.parse(article.content || '[]') : article.content,
    questions: localArticle?.questions || (
      typeof article.questions === 'string' ? JSON.parse(article.questions || '[]') : article.questions
    ),
    questionSets: localArticle?.questionSets,
    image: localArticle?.image || article.image,
  };
}

export default function Hero({ onStart, onSelectArticle }) {
  const { user } = useUser();
  const [articles, setArticles] = useState(localArticles);
  const totalQuestions = articles.reduce((sum, article) => sum + (article.questions?.length || 0), 0);
  const featuredPlaces = useMemo(() => articles.slice(-3).reverse(), [articles]);
  const placeOfDay = useMemo(
    () => articles[new Date().getDate() % articles.length] || articles[0],
    [articles]
  );

  useEffect(() => {
    let ignore = false;

    api.getArticles()
      .then((data) => {
        if (!ignore && Array.isArray(data) && data.length) {
          const parsed = data.filter(isPublicArticle).map(parseArticle);
          setArticles(parsed.length ? parsed : localArticles);
        }
      })
      .catch(() => {
        if (!ignore) setArticles(localArticles);
      });

    return () => {
      ignore = true;
    };
  }, []);

  return (
    <>
      <section className="hero">
        <div className="container hero-content">
          <div className="hero-text">
            {user && <span className="hero-welcome">Привет,{' '}{user.name || user.username}</span>}
            <span className="hero-label">Интерактивный гид по Беларуси</span>
            <h1>Узнай свою страну не&nbsp;по&nbsp;учебнику</h1>
            <p className="hero-subtitle">
              Замки, древние храмы, национальные парки и городские легенды.
              Изучай Беларусь через короткие материалы и мини-викторины.
            </p>
            <div className="hero-actions">
              <button className="btn-primary btn-large" onClick={onStart}>
                Начать исследование
              </button>
              <button className="btn-ghost btn-large" onClick={onStart}>
                Смотреть каталог
              </button>
            </div>
          </div>

          <div className="hero-spotlight">
            <span className="spotlight-label">Место дня</span>
            <article
              className="spotlight-card"
              style={{ backgroundImage: `url("${placeOfDay.image}")` }}
            >
              <div>
                <span className={`badge badge-${placeOfDay.category}`}>{placeOfDay.categoryLabel}</span>
                <h3>{placeOfDay.title}</h3>
                <p>{placeOfDay.region}</p>
              </div>
            </article>
          </div>
        </div>

        <div className="hero-metrics">
          <div className="container metrics-inner">
            <div className="metric">
              <strong>{articles.length}</strong>
              <span>достопримечательностей</span>
            </div>
            <div className="metric">
              <strong>{totalQuestions}</strong>
              <span>вопросов</span>
            </div>
            <div className="metric">
              <strong>6</strong>
              <span>направлений</span>
            </div>
          </div>
        </div>
      </section>

      <section className="home-section categories-section">
        <div className="container">
          <div className="section-head section-head-center">
            <span className="section-kicker">Категории</span>
            <h2 className="section-title">Выбери направление</h2>
          </div>
          <div className="categories-grid clean">
            {Object.entries(categoryMeta).map(([key, meta]) => (
              <button
                key={key}
                className="category-card clean"
                onClick={onStart}
              >
                <span className="category-emoji"><Icon name={meta.icon} size={22} /></span>
                <div>
                  <strong>{meta.label}</strong>
                  <span>{articles.filter((a) => a.category === key).length} мест</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="home-section featured-section">
        <div className="container">
          <div className="section-head">
            <div>
              <span className="section-kicker">Популярное</span>
              <h2 className="section-title">С чего начать</h2>
            </div>
          </div>

          <div className="featured-grid">
            {featuredPlaces.map((place) => (
              <article
                className="featured-card"
                key={place.id}
                style={{ backgroundImage: `url("${place.image}")` }}
                onClick={() => onSelectArticle?.(place)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelectArticle?.(place);
                  }
                }}
              >
                <div>
                  <span className={`badge badge-${place.category}`}>{place.categoryLabel}</span>
                  <h3>{place.title}</h3>
                  <p>{place.region} · {place.questions.length} заданий</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="home-section steps-section">
        <div className="container">
          <div className="section-head section-head-center">
            <span className="section-kicker">Как это работает</span>
            <h2 className="section-title">Три шага к знанию</h2>
          </div>
          <div className="steps-grid clean">
            {steps.map((step, index) => (
              <div key={index} className="step-card clean">
                <span className="step-number">0{index + 1}</span>
                <strong>{step.title}</strong>
                <p>{step.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="home-section about-section">
        <div className="container">
          <div className="section-head section-head-center">
            <span className="section-kicker">О проекте</span>
            <h2 className="section-title">Спадчына — это живая история рядом</h2>
          </div>
          <div className="about-grid">
            <div className="about-card">
              <span className="about-icon"><Icon name="pin" size={32} /></span>
              <strong>Более {articles.length} мест</strong>
              <p>
                Замки, храмы, памятники, заповедники и музеи — каждая статья
                рассказывает историю конкретного места с ключевыми фактами.
              </p>
            </div>
            <div className="about-card">
              <span className="about-icon"><Icon name="puzzle" size={32} /></span>
              <strong>Интерактивные задания</strong>
              <p>
                После прочтения статьи проходи викторину, проверяй знания и
                получай баллы за правильные ответы.
              </p>
            </div>
            <div className="about-card">
              <span className="about-icon"><Icon name="trophy" size={32} /></span>
              <strong>Рейтинг и достижения</strong>
              <p>
                Соревнуйся с другими участниками в таблице лидеров, зарабатывай
                достижения и покупай награды в магазине.
              </p>
            </div>
            <div className="about-card">
              <span className="about-icon"><Icon name="users" size={32} /></span>
              <strong>Общение и батлы</strong>
              <p>
                Обсуждай прочитанное в чате, бросай друзьям культурные дуэли и
                участвуй в командных батлах.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="home-section facts-section">
        <div className="container">
          <div className="section-head section-head-center">
            <span className="section-kicker">Знаешь ли ты</span>
            <h2 className="section-title">Беларусь в цифрах и фактах</h2>
          </div>
          <div className="facts-grid">
            <div className="fact-card">
              <strong>4</strong>
              <span>объекта Всемирного наследия ЮНЕСКО</span>
            </div>
            <div className="fact-card">
              <strong>10 000+</strong>
              <span>озёр на территории страны</span>
            </div>
            <div className="fact-card">
              <strong>40%</strong>
              <span>территории покрыто лесами</span>
            </div>
            <div className="fact-card">
              <strong>1000+</strong>
              <span>лет истории Полоцка</span>
            </div>
            <div className="fact-card">
              <strong>11</strong>
              <span>миллионов жителей</span>
            </div>
            <div className="fact-card">
              <strong>3</strong>
              <span>языка в повседневном употреблении</span>
            </div>
          </div>
          <p className="facts-note">
            Это лишь малая часть того, что делает Беларусь уникальной. В
            «Спадчыне» мы собираем самые интересные истории и помогаем узнать
            родной край лучше.
          </p>
        </div>
      </section>

      <section className="home-section mission-section">
        <div className="container mission-inner">
          <div className="mission-text">
            <span className="section-kicker">Наша миссия</span>
            <h2 className="section-title">Сохранять и приумножать знания о Беларуси</h2>
            <p>
              Мы верим, что культурная память начинается с любопытства. Чем
              больше мы знаем о своей стране, тем бережнее относимся к её
              истории, природе и людям. «Спадчына» помогает сделать это в
              удобной, современной и увлекательной форме.
            </p>
            <button className="btn-primary btn-large" onClick={onStart}>
              Начать изучение
            </button>
          </div>
          <div className="mission-quote">
            <blockquote>
              «Кто не знает прошлого, тот не стоит на прочном основании для
              будущего».
            </blockquote>
            <cite>— Франциск Скорина</cite>
          </div>
        </div>
      </section>
    </>
  );
}
