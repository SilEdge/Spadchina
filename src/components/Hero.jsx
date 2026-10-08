import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { articles as localArticles } from '../data/articles.js';
import { useUser } from '../contexts/UserContext.jsx';
import HeritageAtlas from './HeritageAtlas.jsx';
import Icon from './Icon.jsx';

const categories = [
  { id: 'history', label: 'История' },
  { id: 'culture', label: 'Культура' },
  { id: 'nature', label: 'Природа' },
  { id: 'traditions', label: 'Традиции' },
  { id: 'architecture', label: 'Архитектура' },
  { id: 'memorial', label: 'Память' },
];

const steps = [
  ['Найди место', 'Памятник, музей, озеро или обряд родного края.'],
  ['Открой историю', 'Факты, контекст и то, чем место живёт сегодня.'],
  ['Передай дальше', 'Пройди задание, получи баллы, вызови друга.'],
];

const localArticleByTitle = new Map(localArticles.map((article) => [article.title, article]));
const isPublicArticle = (article) => !article.title?.startsWith('Командные вопросы:');

function parseArticle(article) {
  const localArticle = localArticleByTitle.get(article.title);
  return {
    ...article,
    content: typeof article.content === 'string' ? JSON.parse(article.content || '[]') : article.content,
    questions: localArticle?.questions || (typeof article.questions === 'string' ? JSON.parse(article.questions || '[]') : article.questions),
    questionSets: localArticle?.questionSets,
    image: localArticle?.image || article.image,
  };
}

function findPlace(articles, text) {
  return articles.find((article) => article.title.toLocaleLowerCase().includes(text.toLocaleLowerCase()));
}

function Mono({ children, className = '' }) {
  return <span className={`design-mono ${className}`}>{children}</span>;
}

export default function Hero({ onStart, onSelectArticle, onNavigate }) {
  const { user } = useUser();
  const [articles, setArticles] = useState(localArticles);
  const [activeCategory, setActiveCategory] = useState('');
  const totalQuestions = articles.reduce((sum, article) => sum + (article.questionSets?.flat().length || article.questions?.length || 0), 0);
  const braslav = useMemo(() => findPlace(articles, 'Браславские озёра'), [articles]);

  useEffect(() => {
    let ignore = false;
    api.getArticles().then((data) => {
      if (!ignore && Array.isArray(data) && data.length) {
        const parsed = data.filter(isPublicArticle).map(parseArticle);
        setArticles(parsed.length ? parsed : localArticles);
      }
    }).catch(() => {
      if (!ignore) setArticles(localArticles);
    });
    return () => { ignore = true; };
  }, []);

  const chooseCategory = (category) => {
    setActiveCategory(category);
    document.getElementById('atlas')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="heritage-home">
      <section className="home-topline">
        <div className="home-cover">
          <img src="/design/lakes.jpg" alt="Браславские озёра с высоты" />
          <div className="home-cover-shade" />
          <div className="home-cover-copy container">
            {user && <p className="home-welcome">С возвращением, {user.name || user.username}</p>}
            <h1>Спадчына</h1>
            <p className="home-cover-title">Малая<br /><span>родина</span></p>
            <p className="home-cover-caption">в объективе технологий</p>
            <button className="home-cover-place" onClick={() => braslav && onSelectArticle(braslav)}>
              Браславские озёра <span aria-hidden="true">↗</span>
            </button>
          </div>
        </div>

        <div className="container home-intro">
          <p className="home-intro-text">Открывай Беларусь через истории её мест — от замков и храмов до деревень, озёр и живых традиций. Читай, отвечай, собирай баллы.</p>
          <div className="home-intro-actions">
            <button className="home-action-primary" onClick={onStart}>Пройти маршрут <span aria-hidden="true">→</span></button>
            <button className="home-action-link" onClick={onStart}>Каталог мест</button>
          </div>
        </div>

        <dl className="home-stats" aria-label="Атлас в цифрах">
          <div><dt>{articles.length}</dt><dd>мест</dd></div>
          <div><dt>{totalQuestions.toLocaleString('ru-RU')}</dt><dd>заданий</dd></div>
          <div><dt>06</dt><dd>направлений</dd></div>
        </dl>
      </section>

      <section className="home-directions container">
        <div className="home-section-heading">
          <h2>Шесть нитей одного узора</h2>
          <p>Выбери направление — атлас покажет места, связанные с ним.</p>
        </div>
        <ul className="home-category-list">
          {categories.map((category, index) => {
            const count = articles.filter((article) => article.category === category.id).length;
            return (
              <li key={category.id}>
                <button className="home-category-row" onClick={() => chooseCategory(category.id)}>
                  <Mono>0{index + 1}</Mono>
                  <span className="home-category-name">{category.label}</span>
                  <span className="home-category-count"><Mono>{count} мест</Mono><span className="home-category-arrow" aria-hidden="true">↗</span></span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <HeritageAtlas articles={articles} activeCategory={activeCategory} onSelect={onSelectArticle} onOpenCatalog={onStart} />

      <section className="home-how container">
        <div className="home-step-grid">
          {steps.map(([title, description], index) => (
            <article className="home-step" key={title} style={{ '--step-offset': `${index * 4}rem` }}>
              <span className="home-step-number">0{index + 1}</span>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="home-together container">
        <div className="home-bento">
          <button className="home-bento-team" onClick={() => onNavigate?.('teams')}>
            <Mono>Вместе</Mono>
            <span className="home-bento-team-bottom"><Icon name="users" size={40} /><span><strong>Командные батлы</strong><small>Соберите класс или клуб и пройдите маршрут вместе.</small></span></span>
            <span className="home-bento-arrow" aria-hidden="true">↗</span>
          </button>
          <button className="home-bento-duel" onClick={() => onNavigate?.('duels')}>
            <span><Icon name="swords" size={32} /><strong>Дуэли 1 на 1</strong></span><span aria-hidden="true">↗</span>
          </button>
          <button className="home-bento-chat" onClick={() => onNavigate?.('chat')}>
            <span><Icon name="chat" size={32} /><strong>Чат</strong></span><span aria-hidden="true">↗</span>
          </button>
        </div>
      </section>

      <section className="home-quote">
        <img src="/design/lakes.jpg" alt="" loading="lazy" />
        <div className="home-quote-shade" />
        <blockquote className="container">«Кто не знает прошлого, тот не стоит на прочном основании для будущего».
          <footer><Mono>— Франциск Скорина</Mono></footer>
        </blockquote>
      </section>
    </div>
  );
}
