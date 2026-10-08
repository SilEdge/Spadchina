import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useUser } from '../contexts/UserContext.jsx';
import Icon from './Icon.jsx';

const decorationItems = {
  'mir-castle-card': { title: 'Хранитель Мирского замка', short: 'Мир' },
  'nesvizh-gold': { title: 'Золото Несвижа', short: 'Н' },
  'brest-fortress': { title: 'Крепость-герой', short: 'Брест' },
  'bison-badge': { title: 'Зубр Беловежья', short: 'Зубр' },
  'braslav-water': { title: 'Браславская вода', short: 'Озёра' },
  'kalozha-stone': { title: 'Камни Каложи', short: 'XII' },
  'duel-champion-frame': { title: 'Победитель дуэли', short: 'VS' },
};

const headerText = {
  ru: {
    profileNoDecoration: 'Профиль без украшения',
    points: 'Баллы',
    nft: 'NFT и стикеры',
    collection: 'Коллекция',
    emptyCollection: 'Пока пусто. Купи первое украшение в магазине.',
    messages: 'Сообщения',
    shop: 'Открыть магазин',
    progress: 'Мой прогресс',
    duels: 'Мои батлы',
    logout: 'Выйти',
    email: 'Почта',
    login: 'Войти',
    language: 'Язык',
    russian: 'Русский',
    belarusian: 'Белорусский',
    openProfile: 'Открыть профиль',
    openMenu: 'Открыть меню',
    closeMenu: 'Закрыть меню',
    navigation: 'Основная навигация',
    tabs: {
      home: 'Главная',
      library: 'Достопримечательности',
      progress: 'Прогресс',
      leaderboard: 'Лидеры',
      chat: 'Чат',
      duels: 'Батлы',
      teams: 'Команды',
      shop: 'Магазин',
      suggestions: 'Идеи',
      admin: 'Админка',
    },
  },
  be: {
    profileNoDecoration: 'Профіль без упрыгожання',
    points: 'Балы',
    nft: 'NFT і стыкеры',
    collection: 'Калекцыя',
    emptyCollection: 'Пакуль пуста. Купі першае ўпрыгожанне ў краме.',
    messages: 'Паведамленні',
    shop: 'Адкрыць краму',
    progress: 'Мой прагрэс',
    duels: 'Мае батлы',
    logout: 'Выйсці',
    email: 'Пошта',
    login: 'Увайсці',
    language: 'Мова',
    russian: 'Руская',
    belarusian: 'Беларуская',
    openProfile: 'Адкрыць профіль',
    openMenu: 'Адкрыць меню',
    closeMenu: 'Закрыць меню',
    navigation: 'Асноўная навігацыя',
    tabs: {
      home: 'Галоўная',
      library: 'Славутасці',
      progress: 'Прагрэс',
      leaderboard: 'Лідары',
      chat: 'Чат',
      duels: 'Батлы',
      teams: 'Каманды',
      shop: 'Крама',
      suggestions: 'Ідэі',
      admin: 'Адмінка',
    },
  },
};

function getSavedLanguage() {
  return localStorage.getItem('cultcode_language') === 'be' ? 'be' : 'ru';
}

function getShopState(username) {
  if (!username) return { owned: [], active: null };

  try {
    const state = JSON.parse(localStorage.getItem(`cultcode_shop_${username}`) || '{}');
    return {
      owned: Array.isArray(state.owned) ? state.owned : [],
      active: state.active || null,
    };
  } catch {
    return { owned: [], active: null };
  }
}

export default function Header({ activeTab, setActiveTab, onLoginOpen, onOpenChat, onOpenDuel }) {
  const { user, logout, isAdmin } = useUser();
  const profileRef = useRef(null);
  const menuRef = useRef(null);
  const burgerRef = useRef(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [shopState, setShopState] = useState(() => getShopState(user?.username));
  const [unreadCount, setUnreadCount] = useState(0);
  const [language, setLanguage] = useState(getSavedLanguage);

  const text = headerText[language];
  const activeDecoration = decorationItems[shopState.active] || null;
  const displayName = user?.name || user?.username || '';
  const profileEmail = user?.email || '';
  const ownedDecorations = shopState.owned
    .map((id) => decorationItems[id])
    .filter(Boolean);

  const tabs = [
    { id: 'home', label: text.tabs.home },
    { id: 'library', label: text.tabs.library },
    { id: 'progress', label: text.tabs.progress },
    { id: 'leaderboard', label: text.tabs.leaderboard },
    { id: 'chat', label: text.tabs.chat },
    { id: 'duels', label: text.tabs.duels },
    { id: 'teams', label: text.tabs.teams },
    { id: 'shop', label: text.tabs.shop },
    { id: 'suggestions', label: text.tabs.suggestions },
  ];

  const changeLanguage = (nextLanguage) => {
    setLanguage(nextLanguage);
    localStorage.setItem('cultcode_language', nextLanguage);
    document.documentElement.lang = nextLanguage === 'be' ? 'be' : 'ru';
    window.dispatchEvent(new CustomEvent('cultcode-language-change', { detail: { language: nextLanguage } }));
  };

  useEffect(() => {
    const syncDecoration = () => setShopState(getShopState(user?.username));
    syncDecoration();
    window.addEventListener('cultcode-decoration-change', syncDecoration);
    window.addEventListener('storage', syncDecoration);
    return () => {
      window.removeEventListener('cultcode-decoration-change', syncDecoration);
      window.removeEventListener('storage', syncDecoration);
    };
  }, [user?.username]);

  useEffect(() => {
    const handleClick = (event) => {
      if (!profileRef.current?.contains(event.target)) {
        setProfileOpen(false);
      }
      if (
        !menuRef.current?.contains(event.target) &&
        !burgerRef.current?.contains(event.target)
      ) {
        setMenuOpen(false);
      }
    };

    const handleKey = (event) => {
      if (event.key === 'Escape') {
        setProfileOpen(false);
        setMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  useEffect(() => {
    if (!user || activeTab === 'chat') {
      setUnreadCount(0);
      return undefined;
    }

    const loadUnread = () => {
      api.getUnreadCount()
        .then((data) => setUnreadCount(data.unread_count || 0))
        .catch(() => setUnreadCount(0));
    };

    const handleChatRead = (event) => {
      setUnreadCount(typeof event.detail?.unreadCount === 'number' ? event.detail.unreadCount : 0);
    };

    loadUnread();
    const timer = window.setInterval(loadUnread, 7000);
    window.addEventListener('cultcode-chat-read', handleChatRead);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('cultcode-chat-read', handleChatRead);
    };
  }, [activeTab, user]);

  if (isAdmin()) {
    tabs.push({ id: 'admin', label: text.tabs.admin });
  }

  return (
    <>
    <div className="ornament-band" />
    <header className="header">
      <div className="container header-inner">
        <div className="logo" onClick={() => setActiveTab('home')}>
          <span className="logo-icon">
            <img src="/design/logo-woven.png" alt="" />
          </span>
          <span className="logo-text">Спадчына</span>
        </div>

        <nav className={`nav ${menuOpen ? 'nav-open' : ''}`} ref={menuRef} aria-label={text.navigation}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`nav-link ${activeTab === tab.id ? 'active' : ''}`}
              aria-current={activeTab === tab.id ? 'page' : undefined}
              onClick={() => {
                setActiveTab(tab.id);
                setMenuOpen(false);
              }}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <button
          ref={burgerRef}
          className="burger"
          type="button"
          aria-label={menuOpen ? text.closeMenu : text.openMenu}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Icon name={menuOpen ? 'xmark' : 'bars'} size={22} />
        </button>

        <div className="user-panel">
          {user ? (
            <div className="profile-menu" ref={profileRef}>
              <button
                className={`profile-trigger ${activeDecoration ? 'decorated' : ''}`}
                onClick={() => setProfileOpen((open) => !open)}
                aria-expanded={profileOpen}
                aria-label={text.openProfile}
              >
                <span className="profile-avatar-small">
                  {displayName.slice(0, 1).toUpperCase()}
                  {unreadCount > 0 && <strong className="profile-unread-dot">{unreadCount}</strong>}
                </span>
                <span className="profile-trigger-info">
                  <span>{displayName}</span>
                </span>
              </button>

              {profileOpen && (
                <div className="profile-dropdown">
                  <div className="profile-dropdown-scroll">
                    <div className={`profile-card-mini ${activeDecoration ? 'has-decoration' : ''}`}>
                      <span className="profile-avatar-large">{displayName.slice(0, 1).toUpperCase()}</span>
                      <div>
                        <strong>{displayName}</strong>
                        <span>{activeDecoration ? activeDecoration.title : text.profileNoDecoration}</span>
                      </div>
                    </div>

                    <div className="profile-stats-mini">
                      <div>
                        <span>{text.points}</span>
                        <strong>{user.points}</strong>
                      </div>
                      <div>
                        <span>{text.nft}</span>
                        <strong>{ownedDecorations.length}</strong>
                      </div>
                    </div>

                    <div className="profile-language-switch">
                      <span className="profile-dropdown-label">{text.language}</span>
                      <div>
                        <button
                          type="button"
                          className={language === 'ru' ? 'active' : ''}
                          onClick={() => changeLanguage('ru')}
                        >
                          {text.russian}
                        </button>
                        <button
                          type="button"
                          className={language === 'be' ? 'active' : ''}
                          onClick={() => changeLanguage('be')}
                        >
                          {text.belarusian}
                        </button>
                      </div>
                    </div>

                    <div className="profile-nft-list">
                      <span className="profile-dropdown-label">{text.collection}</span>
                      {ownedDecorations.length > 0 ? (
                        <div className="profile-nft-grid">
                          {ownedDecorations.slice(0, 4).map((item) => (
                            <span key={item.title} title={item.title}>{item.short}</span>
                          ))}
                        </div>
                      ) : (
                        <p>{text.emptyCollection}</p>
                      )}
                    </div>

                    <div className="profile-actions">
                      <button
                        className="btn-ghost btn-full profile-message-action"
                        onClick={() => {
                          onOpenChat?.();
                          setProfileOpen(false);
                        }}
                      >
                        <Icon name="bell" size={17} />
                        {text.messages} {unreadCount > 0 ? `(${unreadCount})` : ''}
                      </button>
                      <button
                        className="btn-primary btn-full"
                        onClick={() => {
                          setActiveTab('shop');
                          setProfileOpen(false);
                        }}
                      >
                        {text.shop}
                      </button>
                      <button
                        className="btn-ghost btn-full"
                        onClick={() => {
                          setActiveTab('progress');
                          setProfileOpen(false);
                        }}
                      >
                        {text.progress}
                      </button>
                      <button
                        className="btn-ghost btn-full"
                        onClick={() => {
                          onOpenDuel?.();
                          setProfileOpen(false);
                        }}
                      >
                        {text.duels}
                      </button>
                      <button
                        className="btn-ghost btn-full"
                        onClick={() => {
                          logout();
                          setProfileOpen(false);
                        }}
                      >
                        {text.logout}
                      </button>
                    </div>
                    {profileEmail && (
                      <div className="profile-email">
                        <span>{text.email}</span>
                        <strong>{profileEmail}</strong>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <button className="btn-primary" onClick={onLoginOpen}>
              {text.login}
            </button>
          )}
        </div>
      </div>
    </header>
    </>
  );
}
