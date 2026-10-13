package backend

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

var telegramState struct {
	sync.RWMutex
	ideasChatID string
}

type telegramUpdatesResponse struct {
	OK     bool             `json:"ok"`
	Result []telegramUpdate `json:"result"`
}

type telegramUpdate struct {
	UpdateID int             `json:"update_id"`
	Message  telegramMessage `json:"message"`
}

type telegramMessage struct {
	MessageID int          `json:"message_id"`
	Text      string       `json:"text"`
	Chat      telegramChat `json:"chat"`
	From      telegramUser `json:"from"`
}

type telegramChat struct {
	ID        int64  `json:"id"`
	FirstName string `json:"first_name"`
	Username  string `json:"username"`
}

type telegramUser struct {
	FirstName string `json:"first_name"`
	Username  string `json:"username"`
}

func startTelegramBot() {
	token := strings.TrimSpace(os.Getenv("TELEGRAM_BOT_TOKEN"))
	if token == "" {
		log.Println("Telegram support bot disabled: TELEGRAM_BOT_TOKEN is empty")
	} else {
		go pollTelegramUpdates("support", token, handleTelegramMessage)
		log.Println("Telegram support bot polling started")
	}

	ideasToken := strings.TrimSpace(os.Getenv("TELEGRAM_IDEAS_BOT_TOKEN"))
	if ideasToken == "" {
		log.Println("Telegram ideas bot disabled: TELEGRAM_IDEAS_BOT_TOKEN is empty")
		return
	}
	if ideasToken == token {
		log.Println("Telegram ideas bot uses the same token as support bot; separate polling skipped")
		return
	}

	go pollTelegramUpdates("ideas", ideasToken, handleIdeasTelegramMessage)
	log.Println("Telegram ideas bot polling started")
}

func pollTelegramUpdates(name, token string, handler func(string, telegramMessage)) {
	client := &http.Client{Timeout: 35 * time.Second}
	offset := 0

	for {
		updates, err := getTelegramUpdates(client, token, offset)
		if err != nil {
			log.Printf("Telegram %s polling error: %v", name, err)
			time.Sleep(3 * time.Second)
			continue
		}

		for _, update := range updates {
			if update.UpdateID >= offset {
				offset = update.UpdateID + 1
			}
			handler(token, update.Message)
		}
	}
}

func getTelegramUpdates(client *http.Client, token string, offset int) ([]telegramUpdate, error) {
	url := fmt.Sprintf("https://api.telegram.org/bot%s/getUpdates?timeout=30&offset=%d", token, offset)
	res, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("telegram getUpdates status %d", res.StatusCode)
	}

	var data telegramUpdatesResponse
	if err := json.NewDecoder(res.Body).Decode(&data); err != nil {
		return nil, err
	}
	if !data.OK {
		return nil, fmt.Errorf("telegram getUpdates not ok")
	}

	return data.Result, nil
}

func handleTelegramMessage(token string, message telegramMessage) {
	if message.Chat.ID == 0 {
		return
	}

	text := strings.TrimSpace(message.Text)
	chatID := strconv.FormatInt(message.Chat.ID, 10)
	supportChatID := strings.TrimSpace(os.Getenv("TELEGRAM_SUPPORT_CHAT_ID"))
	name := strings.TrimSpace(message.From.Username)
	if name != "" {
		name = "@" + name
	}
	if name == "" {
		name = strings.TrimSpace(message.From.FirstName)
	}
	if name == "" {
		name = strings.TrimSpace(message.Chat.FirstName)
	}
	if name == "" {
		name = "друг"
	}

	switch {
	case text == "/start" || strings.HasPrefix(text, "/start "):
		welcome := fmt.Sprintf("Привет, %s!\n\nЯ бот поддержки «Спадчына». Напиши сюда, если что-то не работает: что случилось, где именно и, если можешь, приложи скрин.\n\nМы получим сообщение и ответим как можно быстрее.", name)
		if err := sendTelegramMessageWithToken(token, chatID, welcome); err != nil {
			log.Printf("Telegram /start reply error: %v", err)
		}
	case text == "/id":
		if err := sendTelegramMessageWithToken(token, chatID, fmt.Sprintf("chat_id: %d", message.Chat.ID)); err != nil {
			log.Printf("Telegram /id reply error: %v", err)
		}
	case strings.HasPrefix(text, "/reply "):
		handleSupportReply(token, chatID, supportChatID, text)
	case strings.HasPrefix(text, "/"):
		if err := sendTelegramMessageWithToken(token, chatID, "Не понял команду. Просто опиши проблему сообщением, и я передам её в поддержку."); err != nil {
			log.Printf("Telegram unknown command reply error: %v", err)
		}
	case text != "":
		handleSupportRequest(token, chatID, supportChatID, name, text)
	}
}

func handleIdeasTelegramMessage(token string, message telegramMessage) {
	if message.Chat.ID == 0 {
		return
	}

	text := strings.TrimSpace(message.Text)
	chatID := strconv.FormatInt(message.Chat.ID, 10)
	setTelegramIdeasChatID(chatID)

	switch {
	case text == "/start" || strings.HasPrefix(text, "/start "):
		reply := "Привет! Я бот для идей «Спадчына». Идеи с сайта будут приходить сюда."
		if err := sendTelegramMessageWithToken(token, chatID, reply); err != nil {
			log.Printf("Telegram ideas /start reply error: %v", err)
		}
	case text == "/id":
		if err := sendTelegramMessageWithToken(token, chatID, fmt.Sprintf("chat_id: %d", message.Chat.ID)); err != nil {
			log.Printf("Telegram ideas /id reply error: %v", err)
		}
	case strings.HasPrefix(text, "/"):
		if err := sendTelegramMessageWithToken(token, chatID, "Я принимаю идеи с сайта. Чтобы узнать id этого чата, отправь /id."); err != nil {
			log.Printf("Telegram ideas unknown command reply error: %v", err)
		}
	}
}

func setTelegramIdeasChatID(chatID string) {
	chatID = strings.TrimSpace(chatID)
	if chatID == "" {
		return
	}

	telegramState.Lock()
	telegramState.ideasChatID = chatID
	telegramState.Unlock()
}

func getTelegramIdeasChatID() string {
	telegramState.RLock()
	defer telegramState.RUnlock()
	return telegramState.ideasChatID
}

func handleSupportRequest(token, userChatID, supportChatID, name, text string) {
	if supportChatID != "" && supportChatID != userChatID {
		report := fmt.Sprintf("🆘 Новое обращение в поддержку\n\nОт: %s\nchat_id: %s\n\n%s\n\nОтветить: /reply %s ваш текст", name, userChatID, text, userChatID)
		if err := sendTelegramMessageWithToken(token, supportChatID, report); err != nil {
			log.Printf("Telegram support forward error: %v", err)
		}
	}

	reply := "Спасибо! Мы получили обращение. Поддержка посмотрит проблему и ответит здесь."
	if supportChatID == "" {
		reply = "Спасибо! Сообщение получено. Поддержка пока не подключена: администратору нужно указать TELEGRAM_SUPPORT_CHAT_ID."
	}
	if err := sendTelegramMessageWithToken(token, userChatID, reply); err != nil {
		log.Printf("Telegram support auto-reply error: %v", err)
	}
}

func handleSupportReply(token, fromChatID, supportChatID, text string) {
	if supportChatID != "" && fromChatID != supportChatID {
		_ = sendTelegramMessageWithToken(token, fromChatID, "Отвечать пользователям может только чат поддержки.")
		return
	}

	parts := strings.SplitN(strings.TrimSpace(strings.TrimPrefix(text, "/reply")), " ", 2)
	if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" {
		_ = sendTelegramMessageWithToken(token, fromChatID, "Формат: /reply chat_id текст ответа")
		return
	}

	targetChatID := strings.TrimSpace(parts[0])
	answer := strings.TrimSpace(parts[1])
	if err := sendTelegramMessageWithToken(token, targetChatID, "Ответ поддержки «Спадчына»:\n\n"+answer); err != nil {
		_ = sendTelegramMessageWithToken(token, fromChatID, "Не удалось отправить ответ пользователю.")
		return
	}
	_ = sendTelegramMessageWithToken(token, fromChatID, "Ответ отправлен.")
}

func sendTelegramMessage(chatID string, text string) error {
	token := strings.TrimSpace(os.Getenv("TELEGRAM_BOT_TOKEN"))
	if token == "" {
		return fmt.Errorf("telegram bot is not configured")
	}
	return sendTelegramMessageWithToken(token, chatID, text)
}

func sendTelegramMessageWithToken(token string, chatID string, text string) error {
	chatID = strings.TrimSpace(chatID)
	if strings.TrimSpace(token) == "" || chatID == "" {
		return fmt.Errorf("telegram bot is not configured")
	}

	payload := map[string]string{
		"chat_id": chatID,
		"text":    text,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("telegram payload error")
	}

	client := &http.Client{Timeout: 10 * time.Second}
	res, err := client.Post(
		fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", token),
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		return fmt.Errorf("telegram request failed")
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("telegram returned status %d", res.StatusCode)
	}

	return nil
}
