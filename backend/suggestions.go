package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
)

func suggestionHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		enableCORS(w, r)
		return
	}
	enableCORS(w, r)

	if r.Method != http.MethodPost {
		respondError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req SuggestionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, "invalid request", http.StatusBadRequest)
		return
	}

	message := strings.TrimSpace(req.Message)
	if len([]rune(message)) < 8 {
		respondError(w, "message is too short", http.StatusBadRequest)
		return
	}
	if len([]rune(message)) > 2000 {
		respondError(w, "message is too long", http.StatusBadRequest)
		return
	}

	result, err := db.Exec(
		"INSERT INTO suggestions (name, email, message) VALUES (?, ?, ?)",
		strings.TrimSpace(req.Name),
		strings.TrimSpace(req.Email),
		message,
	)
	if err != nil {
		respondError(w, "db error", http.StatusInternalServerError)
		return
	}

	id, _ := result.LastInsertId()
	if err := sendSuggestionToTelegram(req); err != nil {
		log.Printf("Suggestion %d saved locally; Telegram delivery skipped: %v", id, err)
		respondJSON(w, map[string]interface{}{
			"id":       id,
			"status":   "saved",
			"delivery": "local",
		}, http.StatusAccepted)
		return
	}

	_, _ = db.Exec("UPDATE suggestions SET telegram_delivered = 1 WHERE id = ?", id)
	respondJSON(w, map[string]interface{}{
		"id":       id,
		"status":   "sent",
		"delivery": "telegram",
	}, http.StatusOK)
}

func sendSuggestionToTelegram(req SuggestionRequest) error {
	token := strings.TrimSpace(os.Getenv("TELEGRAM_IDEAS_BOT_TOKEN"))
	if token == "" {
		token = strings.TrimSpace(os.Getenv("TELEGRAM_BOT_TOKEN"))
	}
	chatID := strings.TrimSpace(os.Getenv("TELEGRAM_IDEAS_CHAT_ID"))
	if chatID == "" {
		chatID = strings.TrimSpace(os.Getenv("TELEGRAM_CHAT_ID"))
	}
	if chatID == "" {
		chatID = getTelegramIdeasChatID()
	}
	if chatID == "" {
		return fmt.Errorf("telegram ideas chat id is not configured")
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = "Гость"
	}

	email := strings.TrimSpace(req.Email)
	if email == "" {
		email = "не указан"
	}

	text := fmt.Sprintf("💡 Новая идея со Спадчыны\n\n👤 От: %s\n✉️ Email: %s\n\n📝 Сообщение:\n%s", name, email, strings.TrimSpace(req.Message))
	return sendTelegramMessageWithToken(token, chatID, text)
}
