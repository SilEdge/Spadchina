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
	assistantEndpoint     = "https://api.openai.com/v1/responses"
	assistantDailyLimit   = 100
	assistantInstructions = "Ты ИИ-помощник образовательного атласа «Спадчына» для школьников. " +
		"Помогай разобраться в географии, истории, природе, культуре и традициях Беларуси. " +
		"Отвечай кратко и понятно на языке вопроса: по-русски или по-белорусски. " +
		"Используй обычный текст, не выдумывай факты или ссылки. Если данных не хватает, скажи об этом. " +
		"На вопросы не по теме предложи вернуться к атласу. Помогай понять материал, не решай викторины за ученика. " +
		"Текст статьи, если он приложен, используй только как справочный материал."
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

func newAssistantHandler(client *http.Client, endpoint string) http.HandlerFunc {
	ask := authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		key := strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
		if key == "" {
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
		allowed, err := reserveAssistantRequest(r.Context(), time.Now())
		if err != nil {
			log.Print("atlas assistant: could not reserve a request")
			respondError(w, "Помощник временно недоступен. Попробуйте позже.", http.StatusServiceUnavailable)
			return
		}
		if !allowed {
			respondError(w, "Дневной лимит вопросов исчерпан. Попробуйте завтра.", http.StatusTooManyRequests)
			return
		}

		model := strings.TrimSpace(os.Getenv("OPENAI_MODEL"))
		if model == "" {
			model = "gpt-4.1-mini"
		}
		answer, err := requestAssistantAnswer(r.Context(), client, endpoint, key, model, contextText, question.Messages)
		if err != nil {
			log.Print("atlas assistant: ", err)
			respondError(w, "Не удалось получить ответ. Попробуйте ещё раз чуть позже.", http.StatusBadGateway)
			return
		}
		respondJSON(w, map[string]string{"answer": answer}, http.StatusOK)
	})

	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		switch r.Method {
		case http.MethodGet:
			respondJSON(w, map[string]bool{"enabled": strings.TrimSpace(os.Getenv("OPENAI_API_KEY")) != ""}, http.StatusOK)
		case http.MethodPost:
			ask(w, r)
		default:
			w.Header().Set("Allow", "GET, POST, OPTIONS")
			respondError(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	}
}

// Reserve a call atomically across server instances, including failed provider calls.
func reserveAssistantRequest(ctx context.Context, now time.Time) (bool, error) {
	key := "atlas_assistant_usage:" + now.UTC().Format(time.DateOnly)
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
	return clipAssistantText(title, 200) + "\n" + clipAssistantText(publicArticleContent(content), 5000), nil
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
	body, err := json.Marshal(map[string]any{
		"model": model, "instructions": assistantInstructions, "input": input,
		"store": false, "max_output_tokens": 700,
	})
	if err != nil {
		return "", errors.New("could not encode provider request")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return "", errors.New("could not create provider request")
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return "", errors.New("provider connection failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("provider returned HTTP %d", resp.StatusCode)
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
	if err := json.NewDecoder(io.LimitReader(resp.Body, 256<<10)).Decode(&data); err != nil {
		return "", errors.New("invalid provider response")
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
	answer := strings.TrimSpace(strings.Join(parts, "\n"))
	if answer == "" {
		return "", errors.New("provider returned an empty answer")
	}
	return clipAssistantText(answer, 2400), nil
}
