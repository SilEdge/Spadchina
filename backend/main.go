package main

import (
	"log"
	"net/http"
	"os"
	"strings"
)

func getPort() string {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
	}
	return port
}

func main() {
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
	log.Println("Admin credentials: n4963959@gmail.com / admin123")
	log.Fatal(http.ListenAndServe(addr, mux))
}

func newServerMux() *http.ServeMux {
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
	mux.HandleFunc("/api/articles", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/articles/") {
			getArticleHandler(w, r)
			return
		}
		getArticlesHandler(w, r)
	})

	// Results
	mux.HandleFunc("/api/results", authMiddleware(saveResultHandler))
	mux.HandleFunc("/api/results/my", authMiddleware(getMyResultsHandler))
	mux.HandleFunc("/api/progress", authMiddleware(getProgressHandler))

	// Leaderboard
	mux.HandleFunc("/api/leaderboard", getLeaderboardHandler)

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
	mux.HandleFunc("/api/admin/articles", adminMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			createArticleHandler(w, r)
		} else {
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
	mux.HandleFunc("/api/admin/users/", adminMiddleware(deleteUserHandler))

	// CORS preflight global
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		enableCORS(w, r)
		w.WriteHeader(http.StatusNotFound)
	})

	return mux
}
