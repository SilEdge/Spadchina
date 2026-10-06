export default function Footer({ onNavigate }) {
  const currentYear = new Date().getFullYear();

  const handleClick = (tab) => (event) => {
    event.preventDefault();
    onNavigate?.(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer className="footer">
      <div className="container footer-grid">
        <div className="footer-brand">
          <strong className="footer-logo">Спадчына</strong>
          <p className="footer-sub">
            Цифровой атлас историй Беларуси: находи места, открывай их наследие
            и передавай знания дальше.
          </p>
        </div>

        <div className="footer-links">
          <strong>Разделы</strong>
          <nav>
            <a href="#home" onClick={handleClick('home')}>Главная</a>
            <a href="#library" onClick={handleClick('library')}>Достопримечательности</a>
            <a href="#leaderboard" onClick={handleClick('leaderboard')}>Лидеры</a>
            <a href="#shop" onClick={handleClick('shop')}>Магазин</a>
            <a href="#suggestions" onClick={handleClick('suggestions')}>Идеи</a>
          </nav>
        </div>

        <div className="footer-links">
          <strong>Пользователю</strong>
          <nav>
            <a href="#progress" onClick={handleClick('progress')}>Прогресс</a>
            <a href="#chat" onClick={handleClick('chat')}>Чат</a>
            <a href="#duels" onClick={handleClick('duels')}>Батлы</a>
          </nav>
        </div>

        <div className="footer-contact">
          <strong>Связь</strong>
          <p>По вопросам и предложениям пишите на почту:</p>
          <a href="mailto:n4963959@gmail.com">n4963959@gmail.com</a>
          <a
            href="https://t.me/Spadcgina_Support_bot"
            target="_blank"
            rel="noreferrer"
          >
            Поддержка в Telegram
          </a>
        </div>
      </div>

      <div className="container footer-bottom">
        <p>© {currentYear} Спадчына. Все права защищены.</p>
        <p className="footer-sub">История родного края — рядом.</p>
      </div>
    </footer>
  );
}
