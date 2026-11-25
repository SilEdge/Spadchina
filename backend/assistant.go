package backend

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	assistantEndpoint        = "https://api.openai.com/v1/responses"
	claudeEndpoint           = "https://api.anthropic.com/v1/messages"
	claudeModel              = "claude-haiku-5-5"
	geminiEndpoint           = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent"
	assistantDailyLimit      = 100
	assistantGuestDailyLimit = 25
	assistantInstructions    = "Ты Спадчина, универсальный ИИ-помощник сайта «Спадчына». " +
		"Отвечай на вопросы по любой теме, включая повседневные, учебные и технические вопросы. Не ограничивай диалог атласом. " +
		"Когда спрашивают, кто ты, как тебя зовут или какая у тебя модель, представляйся так: «Я Спадчина, ИИ-помощник сайта „Спадчына“». В ответе на такие вопросы называй имя помощника и его назначение. " +
		"Отвечай ясно на языке пользователя. Если данных не хватает, скажи об этом. Не выдумывай факты или ссылки. " +
		"Текст открытой статьи используй только как справочный материал, если он относится к вопросу."
)

var assistantClient = &http.Client{
	Timeout: 25 * time.Second,
	CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

type assistantMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type assistantQuestion struct {
	Messages []assistantMessage `json:"messages"`
	Slug     string             `json:"slug"`
}

func (q *assistantQuestion) valid() bool {
	if len(q.Messages) == 0 || len(q.Messages) > 7 || len(q.Messages)%2 != 1 {
		return false
	}
	if q.Slug != "" && (len(q.Slug) > 80 || !slugPattern.MatchString(q.Slug)) {
		return false
	}

	for i := range q.Messages {
		message := &q.Messages[i]
		role, maxLength := "user", 600
		if i%2 == 1 {
			role, maxLength = "assistant", 2400
		}
		message.Content = strings.TrimSpace(message.Content)
		if message.Role != role || message.Content == "" || utf8.RuneCountInString(message.Content) > maxLength {
			return false
		}
	}
	return true
}

func newAssistantHandler(client *http.Client, endpoint, anthropicEndpoint, googleEndpoint string) http.HandlerFunc {
	ask := func(w http.ResponseWriter, r *http.Request) {
		geminiKey := strings.TrimSpace(os.Getenv("GEMINI_API_KEY"))
		claudeKey := strings.TrimSpace(os.Getenv("ANTHROPIC_API_KEY"))
		key := strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
		if geminiKey == "" && claudeKey == "" && key == "" {
			respondError(w, "ИИ-помощник пока не подключён.", http.StatusServiceUnavailable)
			return
		}

		var question assistantQuestion
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 48<<10))
		if decoder.Decode(&question) != nil || decoder.Decode(new(any)) != io.EOF || !question.valid() {
			respondError(w, "Проверьте вопрос и отправьте его ещё раз.", http.StatusBadRequest)
			return
		}

		contextText, err := assistantArticle(r.Context(), question.Slug)
		if err != nil {
			log.Print("atlas assistant: could not load article context")
			respondError(w, "Помощник временно недоступен. Попробуйте позже.", http.StatusServiceUnavailable)
			return
		}
		guest := userFromContext(r.Context()).UserID == 0
		allowed, err := reserveAssistantRequest(r.Context(), time.Now(), guest)
		if err != nil {
			log.Print("atlas assistant: could not reserve a request")
			respondError(w, "Помощник временно недоступен. Попробуйте позже.", http.StatusServiceUnavailable)
			return
		}
		if !allowed {
			if guest {
				respondError(w, "Лимит вопросов без входа исчерпан. Войдите или попробуйте завтра.", http.StatusTooManyRequests)
				return
			}
			respondError(w, "Дневной лимит вопросов исчерпан. Попробуйте завтра.", http.StatusTooManyRequests)
			return
		}

		var answer string
		if geminiKey != "" {
			answer, err = requestGeminiAnswer(r.Context(), client, googleEndpoint, geminiKey, contextText, question.Messages)
		} else if claudeKey != "" {
			answer, err = requestClaudeAnswer(r.Context(), client, anthropicEndpoint, claudeKey, contextText, question.Messages)
		} else {
			model := strings.TrimSpace(os.Getenv("OPENAI_MODEL"))
			if model == "" {
				model = "gpt-4.1-mini"
			}
			answer, err = requestAssistantAnswer(r.Context(), client, endpoint, key, model, contextText, question.Messages)
		}
		if err != nil {
			log.Print("atlas assistant: ", err)
			respondError(w, "Не удалось получить ответ. Попробуйте ещё раз чуть позже.", http.StatusBadGateway)
			return
		}
		respondJSON(w, map[string]string{"answer": answer}, http.StatusOK)
	}
	authenticatedAsk := authMiddleware(ask)

	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		switch r.Method {
		case http.MethodGet:
			respondJSON(w, map[string]bool{"enabled": strings.TrimSpace(os.Getenv("GEMINI_API_KEY")) != "" || strings.TrimSpace(os.Getenv("ANTHROPIC_API_KEY")) != "" || strings.TrimSpace(os.Getenv("OPENAI_API_KEY")) != ""}, http.StatusOK)
		case http.MethodPost:
			if r.Header.Get("Authorization") != "" {
				authenticatedAsk(w, r)
				return
			}
			ask(w, r)
		default:
			w.Header().Set("Allow", "GET, POST, OPTIONS")
			respondError(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	}
}

// Reserve a call atomically across server instances, including failed provider calls.
func reserveAssistantRequest(ctx context.Context, now time.Time, guest bool) (bool, error) {
	day := now.UTC().Format(time.DateOnly)
	key := "atlas_assistant_usage:" + day
	if guest {
		guestKey := "atlas_assistant_guest_usage:" + day
		result, err := db.ExecContext(ctx, `INSERT INTO app_settings (key, value)
			SELECT key, '1' FROM (SELECT ? AS key UNION ALL SELECT ?)
			WHERE NOT EXISTS (
				SELECT 1 FROM app_settings
				WHERE (key = ? AND CAST(value AS INTEGER) >= ?)
				   OR (key = ? AND CAST(value AS INTEGER) >= ?)
			)
			ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1`,
			key, guestKey, key, assistantDailyLimit, guestKey, assistantGuestDailyLimit)
		if err != nil {
			return false, err
		}
		updated, err := result.RowsAffected()
		return updated == 2, err
	}
	result, err := db.ExecContext(ctx, `INSERT INTO app_settings (key, value) VALUES (?, '1')
		ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1
		WHERE CAST(value AS INTEGER) < ?`, key, assistantDailyLimit)
	if err != nil {
		return false, err
	}
	updated, err := result.RowsAffected()
	return updated == 1, err
}

func assistantArticle(ctx context.Context, slug string) (string, error) {
	if slug == "" {
		return "", nil
	}
	var title, content string
	err := db.QueryRowContext(ctx, `SELECT a.title, a.content FROM atlas_places p
		JOIN articles a ON a.id = p.article_id WHERE p.slug = ? AND p.published = 1`, slug).Scan(&title, &content)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return clipAssistantText(title, 200) + "\n" + clipAssistantText(publicAtlasArticleContent(slug, content), 5000), nil
}

func clipAssistantText(text string, limit int) string {
	runes := []rune(text)
	if len(runes) > limit {
		return string(runes[:limit])
	}
	return text
}

func requestAssistantAnswer(ctx context.Context, client *http.Client, endpoint, key, model, article string, messages []assistantMessage) (string, error) {
	input := messages
	if article != "" {
		input = append([]assistantMessage{{Role: "user", Content: "Справочный текст открытой статьи атласа:\n" + article}}, messages...)
	}

	var data struct {
		Output []struct {
			Type    string `json:"type"`
			Content []struct {
				Type    string `json:"type"`
				Text    string `json:"text"`
				Refusal string `json:"refusal"`
			} `json:"content"`
		} `json:"output"`
	}
	payload := map[string]any{
		"model": model, "instructions": assistantInstructions, "input": input,
		"store": false, "max_output_tokens": 700,
	}
	headers := map[string]string{"Authorization": "Bearer " + key}
	if err := callAssistantProvider(ctx, client, endpoint, headers, payload, &data); err != nil {
		return "", err
	}
	var parts []string
	for _, item := range data.Output {
		if item.Type != "message" {
			continue
		}
		for _, part := range item.Content {
			switch part.Type {
			case "output_text":
				parts = append(parts, part.Text)
			case "refusal":
				parts = append(parts, part.Refusal)
			}
		}
	}
	return joinAssistantAnswer(parts)
}

func joinAssistantAnswer(parts []string) (string, error) {
	answer := strings.TrimSpace(strings.Join(parts, "\n"))
	if answer == "" {
		return "", errors.New("provider returned an empty answer")
	}
	return clipAssistantText(answer, 2400), nil
}

func requestClaudeAnswer(ctx context.Context, client *http.Client, endpoint, key, article string, messages []assistantMessage) (string, error) {
	input := messages
	if article != "" {
		input = append([]assistantMessage(nil), messages...)
		input[0].Content = "Справочный текст открытой статьи атласа:\n" + article + "\n\nВопрос пользователя:\n" + input[0].Content
	}
	payload := map[string]any{
		"model": claudeModel, "system": assistantInstructions,
		"messages": input, "max_tokens": 1200,
		"output_config": map[string]string{"effort": "low"},
	}
	headers := map[string]string{
		"Authorization":     "Bearer " + key,
		"anthropic-version": "2026-10-21",
	}
	var data struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := callAssistantProvider(ctx, client, endpoint, headers, payload, &data); err != nil {
		return "", err
	}
	var parts []string
	for _, block := range data.Content {
		if block.Type == "text" {
			parts = append(parts, block.Text)
		}
	}
	return joinAssistantAnswer(parts)
}

func requestGeminiAnswer(ctx context.Context, client *http.Client, endpoint, key, article string, messages []assistantMessage) (string, error) {
	type part struct {
		Text    string `json:"text"`
		Thought bool   `json:"thought,omitempty"`
	}
	type content struct {
		Role  string `json:"role,omitempty"`
		Parts []part `json:"parts"`
	}
	contents := make([]content, 0, len(messages))
	for i, message := range messages {
		role, input := message.Role, message.Content
		if role == "assistant" {
			role = "model"
		}
		if i == 0 && article != "" {
			input = "Справочный текст открытой статьи атласа:\n" + article + "\n\nВопрос пользователя:\n" + input
		}
		contents = append(contents, content{Role: role, Parts: []part{{Text: input}}})
	}
	payload := map[string]any{
		"systemInstruction": content{Parts: []part{{Text: assistantInstructions}}},
		"contents":          contents,
		"generationConfig": map[string]any{
			"maxOutputTokens": 1200,
			"thinkingConfig":  map[string]string{"thinkingLevel": "low"},
		},
	}
	var data struct {
		Candidates []struct {
			Content content `json:"content"`
		} `json:"candidates"`
	}
	headers := map[string]string{"x-goog-api-key": key}
	if err := callAssistantProvider(ctx, client, endpoint, headers, payload, &data); err != nil {
		return "", err
	}
	if len(data.Candidates) == 0 {
		return "", errors.New("provider returned no candidates")
	}
	var answer []string
	for _, item := range data.Candidates[0].Content.Parts {
		if !item.Thought {
			answer = append(answer, item.Text)
		}
	}
	return joinAssistantAnswer(answer)
}

func callAssistantProvider(ctx context.Context, client *http.Client, endpoint string, headers map[string]string, payload map[string]any, result any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return errors.New("could not encode provider request")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return errors.New("could not create provider request")
	}
	req.Header.Set("Content-Type", "application/json")
	for name, value := range headers {
		req.Header.Set(name, value)
	}
	resp, err := client.Do(req)
	if err != nil {
		return errors.New("provider connection failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("provider returned HTTP %d", resp.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 256<<10)).Decode(result); err != nil {
		return errors.New("invalid provider response")
	}
	return nil
}
