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
	t.Setenv("GEMINI_API_KEY", "")
	t.Setenv("ANTHROPIC_API_KEY", "")
	t.Setenv("OPENAI_API_KEY", "")
	initDB()
	t.Cleanup(func() { _ = db.Close() })

	var upstreamCalls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/gemini" {
			var body struct {
				SystemInstruction struct {
					Parts []map[string]string `json:"parts"`
				} `json:"systemInstruction"`
				Contents []struct {
					Role  string              `json:"role"`
					Parts []map[string]string `json:"parts"`
				} `json:"contents"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
				return
			}
			if r.Method != http.MethodPost || r.Header.Get("x-goog-api-key") != "test-gemini-key" ||
				len(body.SystemInstruction.Parts) != 1 || body.SystemInstruction.Parts[0]["text"] != assistantInstructions ||
				len(body.Contents) != 3 || len(body.Contents[0].Parts) != 1 || len(body.Contents[2].Parts) != 1 ||
				!strings.Contains(body.Contents[0].Parts[0]["text"], "Справочный текст открытой статьи") ||
				body.Contents[1].Role != "model" || body.Contents[2].Parts[0]["text"] != "А кто его построил?" {
				t.Error("unexpected Gemini request")
			}
			fmt.Fprint(w, `{"candidates":[{"content":{"parts":[{"thought":true,"text":"hidden"},{"text":"Мирский замок связан с родом Ильиничей."}]}}]}`)
			return
		}
		if r.URL.Path == "/claude" {
			var body struct {
				Model     string             `json:"model"`
				System    string             `json:"system"`
				Messages  []assistantMessage `json:"messages"`
				MaxTokens int                `json:"max_tokens"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
				return
			}
			if r.Method != http.MethodPost || r.Header.Get("Authorization") != "Bearer test-anthropic-key" ||
				r.Header.Get("anthropic-version") != "2026-10-21" || body.Model != "claude-haiku-5-5" ||
				body.MaxTokens != 1200 || body.System != assistantInstructions || len(body.Messages) != 3 ||
				!strings.Contains(body.Messages[0].Content, "Справочный текст открытой статьи") ||
				!strings.HasSuffix(body.Messages[0].Content, "Расскажи про замок") ||
				body.Messages[1].Role != "assistant" || body.Messages[2].Content != "А кто его построил?" {
				t.Error("unexpected Claude request")
			}
			fmt.Fprint(w, `{"content":[{"type":"thinking","text":"hidden"},{"type":"text","text":"Мирский замок начали строить Ильиничи."}]}`)
			return
		}
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

	server := httptest.NewServer(newAssistantHandler(upstream.Client(), upstream.URL, upstream.URL+"/claude", upstream.URL+"/gemini"))
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
	requestJSON(t, client, http.MethodPost, server.URL, "invalid-token", question, http.StatusUnauthorized, nil)
	requestJSON(t, client, http.MethodPost, server.URL, "", question, http.StatusServiceUnavailable, nil)
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

	t.Setenv("ANTHROPIC_API_KEY", "test-anthropic-key")
	requestJSON(t, client, http.MethodPost, server.URL, token, question, http.StatusOK, &answer)
	if answer["answer"] != "Мирский замок начали строить Ильиничи." {
		t.Fatalf("unexpected Claude answer: %v", answer)
	}
	t.Setenv("OPENAI_API_KEY", "")
	requestJSON(t, client, http.MethodGet, server.URL, "", nil, http.StatusOK, &availability)
	if !availability["enabled"] {
		t.Fatal("assistant disabled with an Anthropic key")
	}

	t.Setenv("GEMINI_API_KEY", "test-gemini-key")
	requestJSON(t, client, http.MethodPost, server.URL, token, question, http.StatusOK, &answer)
	if answer["answer"] != "Мирский замок связан с родом Ильиничей." {
		t.Fatalf("unexpected Gemini answer: %v", answer)
	}
	t.Setenv("ANTHROPIC_API_KEY", "")
	requestJSON(t, client, http.MethodGet, server.URL, "", nil, http.StatusOK, &availability)
	if !availability["enabled"] {
		t.Fatal("assistant disabled with a Gemini key")
	}

	day := time.Now().UTC().Format(time.DateOnly)
	requestJSON(t, client, http.MethodPost, server.URL, "", question, http.StatusOK, &answer)
	if answer["answer"] != "Мирский замок связан с родом Ильиничей." {
		t.Fatalf("unexpected guest answer: %v", answer)
	}
	guestKey := "atlas_assistant_guest_usage:" + day
	if _, err := db.Exec("UPDATE app_settings SET value = ? WHERE key = ?", assistantGuestDailyLimit-1, guestKey); err != nil {
		t.Fatal(err)
	}
	requestJSON(t, client, http.MethodPost, server.URL, "", question, http.StatusOK, nil)
	requestJSON(t, client, http.MethodPost, server.URL, "", question, http.StatusTooManyRequests, nil)
	requestJSON(t, client, http.MethodPost, server.URL, token, question, http.StatusOK, nil)

	if _, err := db.Exec("UPDATE app_settings SET value = ? WHERE key = ?", assistantDailyLimit, "atlas_assistant_usage:"+day); err != nil {
		t.Fatal(err)
	}
	requestJSON(t, client, http.MethodPost, server.URL, token, question, http.StatusTooManyRequests, nil)
	requestJSON(t, client, http.MethodPost, server.URL, "", question, http.StatusTooManyRequests, nil)
}
