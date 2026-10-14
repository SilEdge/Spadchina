package backend

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
)

func getPort() string {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
	}
	return port
}

// Run starts the development server with schema setup and optional Telegram polling.
func Run() {
	initDB()
	defer db.Close()
	startTelegramBot()

	mux := newServerMux()

	port := getPort()
	host := os.Getenv("HOST")
	if host == "" {
		host = "0.0.0.0"
	}
	addr := host + ":" + port
	log.Println("Server starting on http://" + addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}

var cloudOnce sync.Once
var cloudHandler http.Handler
var cloudError error

// Handler serves the migrated database directly from a Vercel Function.
// Schema setup and seeding are performed before deployment, not on cold starts.
func Handler(w http.ResponseWriter, r *http.Request) {
	cloudOnce.Do(func() {
		if len(strings.TrimSpace(os.Getenv("JWT_SECRET"))) < 32 {
			cloudError = fmt.Errorf("JWT_SECRET is required for cloud sessions")
			return
		}
		cloudError = openDatabase()
		if cloudError == nil {
			cloudHandler = newServerMux()
		}
	})
	w.Header().Set("Cache-Control", "no-store")
	if cloudError != nil {
		log.Printf("cloud configuration: %v", cloudError)
		respondError(w, "Сервер временно недоступен. Попробуйте позже.", http.StatusServiceUnavailable)
		return
	}
	cloudHandler.ServeHTTP(w, r)
}

func newServerMux() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		enableCORS(w, r)
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			respondError(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if err := db.PingContext(r.Context()); err != nil {
			respondError(w, "database unavailable", http.StatusServiceUnavailable)
			return
		}
		respondJSON(w, map[string]string{"status": "ok"}, http.StatusOK)
	})

	// Auth
	mux.HandleFunc("/api/register", registerHandler)
	mux.HandleFunc("/api/login", loginHandler)
	mux.HandleFunc("/api/me", authMiddleware(meHandler))

	// Articles public
	mux.HandleFunc("/api/atlas", getAtlasHandler)
	mux.HandleFunc("/api/atlas/check", atlasCheckHandler)
	mux.HandleFunc("/api/atlas/results", authMiddleware(saveAtlasResultHandler))
	mux.HandleFunc("/api/atlas/progress", authMiddleware(atlasProgressHandler))
	mux.HandleFunc("/api/rewards", rewardsHandler)
	mux.HandleFunc("/api/rewards/my", authMiddleware(myRewardsHandler))
	mux.HandleFunc("/api/rewards/redeem", authMiddleware(redeemRewardHandler))
	mux.HandleFunc("/api/articles", getArticlesHandler)
	mux.HandleFunc("/api/articles/", getArticleHandler)

	// Results
	mux.HandleFunc("/api/results", authMiddleware(saveResultHandler))
	mux.HandleFunc("/api/results/my", authMiddleware(getMyResultsHandler))
	mux.HandleFunc("/api/progress", authMiddleware(getProgressHandler))

	// Leaderboard
	mux.HandleFunc("/api/leaderboard", getLeaderboardHandler)
	mux.HandleFunc("/api/people", authMiddleware(getPeopleHandler))

	// Suggestions
	mux.HandleFunc("/api/suggestions", suggestionHandler)

	// Chat
	mux.HandleFunc("/api/chat/conversations", authMiddleware(getConversationsHandler))
	mux.HandleFunc("/api/chat/messages", authMiddleware(chatMessagesHandler))
	mux.HandleFunc("/api/chat/unread", authMiddleware(getUnreadCountHandler))

	// Duels
	mux.HandleFunc("/api/duels", authMiddleware(duelsHandler))
	mux.HandleFunc("/api/duels/", authMiddleware(duelActionHandler))

	// Team battles
	mux.HandleFunc("/api/team-battles", authMiddleware(teamBattlesHandler))
	mux.HandleFunc("/api/team-battles/", authMiddleware(teamBattleActionHandler))

	// Admin
	mux.HandleFunc("/api/admin/suggestions", adminMiddleware(adminSuggestionsHandler))
	mux.HandleFunc("/api/admin/password", adminMiddleware(adminPasswordHandler))
	mux.HandleFunc("/api/admin/articles", adminMiddleware(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			getArticlesHandler(w, r)
		case http.MethodPost:
			createArticleHandler(w, r)
		default:
			respondError(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	}))
	mux.HandleFunc("/api/admin/articles/", adminMiddleware(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPut:
			updateArticleHandler(w, r)
		case http.MethodDelete:
			deleteArticleHandler(w, r)
		default:
			respondError(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	}))
	mux.HandleFunc("/api/admin/users", adminMiddleware(listUsersHandler))
	mux.HandleFunc("/api/admin/users/", adminMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			adminUserProfileHandler(w, r)
		} else {
			deleteUserHandler(w, r)
		}
	}))
	mux.HandleFunc("/api/admin/questions", adminMiddleware(adminQuestionsHandler))
	mux.HandleFunc("/api/admin/questions/", adminMiddleware(adminQuestionHandler))
	mux.HandleFunc("/api/admin/rewards", adminMiddleware(adminRewardsHandler))
	mux.HandleFunc("/api/admin/rewards/", adminMiddleware(adminRewardHandler))

	// CORS preflight global
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		enableCORS(w, r)
		w.WriteHeader(http.StatusNotFound)
	})

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		enableCORS(w, r)
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		mux.ServeHTTP(w, r)
	})
}
