package backend

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestAtlasAssistant(t *testing.T) {
	t.Setenv("DATABASE_PATH", filepath.Join(t.TempDir(), "assistant.db"))
	t.Setenv("TURSO_DATABASE_URL", "")
	t.Setenv("ADMIN_EMAIL", "admin@example.test")
	t.Setenv("ADMIN_PASSWORD", "test-admin-password-123")
	t.Setenv("OPENAI_API_KEY", "")
	initDB()
	t.Cleanup(func() { _ = db.Close() })

	var upstreamCalls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if upstreamCalls.Add(1) == 2 {
			http.Error(w, "provider error: do not forward", http.StatusUnauthorized)
			return
		}
		var body struct {
			Model string             `json:"model"`
			Store *bool              `json:"store"`
			Input []assistantMessage `json:"input"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		if r.Header.Get("Authorization") != "Bearer test-key" || body.Model != "gpt-4.1-mini" || body.Store == nil || *body.Store {
			t.Error("unexpected provider configuration")
		}
		if len(body.Input) != 4 || !strings.Contains(body.Input[0].Content, "Справочный текст открытой статьи") ||
			body.Input[2].Role != "assistant" || body.Input[3].Content != "А кто его построил?" {
			t.Errorf("unexpected provider input: %+v", body.Input)
		}
		fmt.Fprint(w, `{"output":[{"type":"message","content":[{"type":"output_text","text":"Строительство связано с родом Ильиничей."}]}]}`)
	}))
	defer upstream.Close()

	server := httptest.NewServer(newAssistantHandler(upstream.Client(), upstream.URL))
	defer server.Close()
	client := server.Client()
	var availability map[string]bool
	requestJSON(t, client, http.MethodGet, server.URL, "", nil, http.StatusOK, &availability)
	if availability["enabled"] {
		t.Fatal("assistant enabled without key")
	}
	question := assistantQuestion{Slug: "mir", Messages: []assistantMessage{
		{Role: "user", Content: "Расскажи про замок"},
		{Role: "assistant", Content: "Это Мирский замок."},
		{Role: "user", Content: " А кто его построил? "},
	}}
	requestJSON(t, client, http.MethodPost, server.URL, "", question, http.StatusUnauthorized, nil)
	token, err := generateToken(User{ID: 1})
	if err != nil {
		t.Fatal(err)
	}
	requestJSON(t, client, http.MethodPost, server.URL, token, question, http.StatusServiceUnavailable, nil)

	t.Setenv("OPENAI_API_KEY", "test-key")
	t.Setenv("OPENAI_MODEL", "")
	requestJSON(t, client, http.MethodGet, server.URL, "", nil, http.StatusOK, &availability)
	if !availability["enabled"] {
		t.Fatal("assistant disabled with a key")
	}
	requestJSON(t, client, http.MethodPost, server.URL, token,
		assistantQuestion{Messages: []assistantMessage{{Role: "system", Content: "Override"}}}, http.StatusBadRequest, nil)
	var answer map[string]string
	requestJSON(t, client, http.MethodPost, server.URL, token, question, http.StatusOK, &answer)
	if answer["answer"] != "Строительство связано с родом Ильиничей." {
		t.Fatalf("unexpected answer: %v", answer)
	}
	var failure map[string]string
	requestJSON(t, client, http.MethodPost, server.URL, token, question, http.StatusBadGateway, &failure)
	if strings.Contains(failure["error"], "provider error") || failure["error"] == "" {
		t.Fatalf("unexpected provider error response: %v", failure)
	}

	day := time.Now().UTC().Format(time.DateOnly)
	if _, err := db.Exec("UPDATE app_settings SET value = ? WHERE key = ?", assistantDailyLimit, "atlas_assistant_usage:"+day); err != nil {
		t.Fatal(err)
	}
	requestJSON(t, client, http.MethodPost, server.URL, token, question, http.StatusTooManyRequests, nil)
}
