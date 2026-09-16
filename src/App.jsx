import { useEffect, useState } from 'react';
import Header from './components/Header.jsx';
import Hero from './components/Hero.jsx';
import ArticleLibrary from './components/ArticleLibrary.jsx';
import ArticleReader from './components/ArticleReader.jsx';
import Quiz from './components/Quiz.jsx';
import QuizResult from './components/QuizResult.jsx';
import Progress from './components/Progress.jsx';
import Shop from './components/Shop.jsx';
import Leaderboard from './components/Leaderboard.jsx';
import Chat from './components/Chat.jsx';
import Duels from './components/Duels.jsx';
import TeamBattles from './components/TeamBattles.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import Suggestions from './components/Suggestions.jsx';
import Footer from './components/Footer.jsx';
import LoginModal from './components/LoginModal.jsx';
import { initSiteTranslator } from './utils/siteTranslator.js';
import './App.css';

export default function App() {
  const [activeTab, setActiveTab] = useState('home');
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [quizArticle, setQuizArticle] = useState(null);
  const [quizState, setQuizState] = useState('none'); // 'none' | 'reading' | 'quiz' | 'result'
  const [quizScore, setQuizScore] = useState(0);
  const [loginOpen, setLoginOpen] = useState(false);
  const [chatPeer, setChatPeer] = useState('');
  const [duelPeer, setDuelPeer] = useState('');

  useEffect(() => {
    initSiteTranslator();
  }, []);

  const handleStart = () => {
    setActiveTab('library');
  };

  const handleSelectArticle = (article) => {
    setSelectedArticle(article);
    setQuizArticle(null);
    setQuizState('reading');
  };

  const handleStartQuiz = () => {
    const sets = selectedArticle?.questionSets?.length ? selectedArticle.questionSets : [selectedArticle.questions];
    const shuffledSets = [...sets].sort(() => Math.random() - 0.5);
    const questions = shuffledSets.slice(0, 2).flat().slice(0, 10);
    setQuizArticle({ ...selectedArticle, questions: questions.length ? questions : selectedArticle.questions });
    setQuizState('quiz');
  };

  const handleFinishQuiz = (score) => {
    setQuizScore(score);
    setQuizState('result');
  };

  const handleBackToLibrary = () => {
    setSelectedArticle(null);
    setQuizArticle(null);
    setQuizState('none');
    setActiveTab('library');
  };

  const handleTabChange = (tab) => {
    setSelectedArticle(null);
    setQuizArticle(null);
    setQuizState('none');
    setActiveTab(tab);
  };

  const handleOpenChat = (username = '') => {
    setSelectedArticle(null);
    setQuizArticle(null);
    setQuizState('none');
    setChatPeer(username);
    setActiveTab('chat');
  };

  const handleOpenDuel = (username = '') => {
    setSelectedArticle(null);
    setQuizArticle(null);
    setQuizState('none');
    setDuelPeer(username);
    setActiveTab('duels');
  };

  const renderContent = () => {
    if (quizState === 'reading' && selectedArticle) {
      return (
        <ArticleReader
          article={selectedArticle}
          onStartQuiz={handleStartQuiz}
          onBack={handleBackToLibrary}
        />
      );
    }

    if (quizState === 'quiz' && selectedArticle) {
      return (
        <Quiz
          article={quizArticle || selectedArticle}
          onFinish={handleFinishQuiz}
          onBack={() => setQuizState('reading')}
        />
      );
    }

    if (quizState === 'result' && selectedArticle) {
      return (
        <QuizResult
          article={quizArticle || selectedArticle}
          score={quizScore}
          onBack={handleBackToLibrary}
        />
      );
    }

    switch (activeTab) {
      case 'home':
        return <Hero onStart={handleStart} onSelectArticle={handleSelectArticle} />;
      case 'library':
        return <ArticleLibrary onSelect={handleSelectArticle} />;
      case 'progress':
        return <Progress />;
      case 'leaderboard':
        return <Leaderboard onMessageUser={handleOpenChat} onBattleUser={handleOpenDuel} />;
      case 'chat':
        return <Chat initialPeer={chatPeer} onLoginOpen={() => setLoginOpen(true)} />;
      case 'duels':
        return <Duels initialOpponent={duelPeer} onLoginOpen={() => setLoginOpen(true)} />;
      case 'teams':
        return <TeamBattles onLoginOpen={() => setLoginOpen(true)} />;
      case 'shop':
        return <Shop onLoginOpen={() => setLoginOpen(true)} />;
      case 'suggestions':
        return <Suggestions />;
      case 'admin':
        return <AdminPanel />;
      default:
        return <Hero onStart={handleStart} />;
    }
  };

  return (
    <div className="app">
      <Header
        activeTab={activeTab}
        setActiveTab={handleTabChange}
        onLoginOpen={() => setLoginOpen(true)}
        onOpenChat={handleOpenChat}
        onOpenDuel={handleOpenDuel}
      />
      <main className="main">{renderContent()}</main>
      <Footer onNavigate={handleTabChange} />
      <LoginModal isOpen={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  );
}
