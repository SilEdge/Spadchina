export default function Footer({ onNavigate }) {
  const links = [
    ['Каталог мест', 'library'], ['Рейтинг', 'leaderboard'], ['Дуэли', 'duels'], ['Командные батлы', 'teams'],
    ['Чат', 'chat'], ['Магазин', 'shop'], ['Идеи', 'suggestions'], ['Мой прогресс', 'progress'],
  ];
  const handleClick = (tab) => (event) => {
    event.preventDefault();
    onNavigate?.(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer className="footer">
      <div className="container footer-grid">
        <div className="footer-brand">
          <strong className="footer-logo"><img src="/design/logo-woven.png" alt="" />Спадчына</strong>
          <p className="footer-sub">Места, люди и истории,<br />из которых складывается Беларусь.</p>
          <a className="footer-atlas-link" href="#library" onClick={handleClick('library')}>Открыть атлас <span aria-hidden="true">↗</span></a>
        </div>
        <nav className="footer-nav" aria-label="Навигация внизу страницы">
          {links.map(([label, tab]) => <a key={tab} href={`#${tab}`} onClick={handleClick(tab)}>{label}<span aria-hidden="true">↗</span></a>)}
        </nav>
      </div>
      <div className="container footer-bottom">
        <p>⌖ &nbsp;Цифровой атлас Беларуси</p>
        <p>Номинация «Судьба малой родины в объективе технологий»</p>
      </div>
    </footer>
  );
}
