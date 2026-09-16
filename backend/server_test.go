package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

type testSession struct {
	Token string `json:"token"`
	User  User   `json:"user"`
}

func requestJSON(t *testing.T, client *http.Client, method, url, token string, body interface{}, wantStatus int, target interface{}) {
	t.Helper()
	var payload *bytes.Reader
	if body == nil {
		payload = bytes.NewReader(nil)
	} else {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		payload = bytes.NewReader(encoded)
	}

	req, err := http.NewRequest(method, url, payload)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != wantStatus {
		var failure map[string]interface{}
		_ = json.NewDecoder(res.Body).Decode(&failure)
		t.Fatalf("%s %s: got %d, want %d: %v", method, url, res.StatusCode, wantStatus, failure)
	}
	if target != nil {
		if err := json.NewDecoder(res.Body).Decode(target); err != nil {
			t.Fatal(err)
		}
	}
}

func registerTestUser(t *testing.T, client *http.Client, baseURL, name, email string) testSession {
	t.Helper()
	var session testSession
	requestJSON(t, client, http.MethodPost, baseURL+"/api/register", "", map[string]string{
		"name": name, "email": email, "password": "secret1",
	}, http.StatusCreated, &session)
	if session.Token == "" || session.User.ID == 0 {
		t.Fatal("registration did not return a usable session")
	}
	return session
}

func correctAnswers(questions []DuelQuestion) []DuelAnswer {
	answers := make([]DuelAnswer, 0, len(questions))
	for _, question := range questions {
		selected := []int{}
		switch correct := question.Correct.(type) {
		case float64:
			selected = append(selected, int(correct))
		case []interface{}:
			for _, value := range correct {
				if number, ok := value.(float64); ok {
					selected = append(selected, int(number))
				}
			}
		}
		answers = append(answers, DuelAnswer{QuestionID: question.ID, Selected: selected, TimeLeft: 10})
	}
	return answers
}

func TestServerWorkflow(t *testing.T) {
	if db != nil {
		_ = db.Close()
	}
	t.Setenv("DATABASE_PATH", filepath.Join(t.TempDir(), "test.db"))
	t.Setenv("TELEGRAM_BOT_TOKEN", "")
	t.Setenv("TELEGRAM_IDEAS_BOT_TOKEN", "")
	initDB()
	t.Cleanup(func() {
		_ = db.Close()
		_ = os.Unsetenv("DATABASE_PATH")
	})

	server := httptest.NewServer(newServerMux())
	defer server.Close()
	client := server.Client()

	var health map[string]string
	requestJSON(t, client, http.MethodGet, server.URL+"/api/health", "", nil, http.StatusOK, &health)
	if health["status"] != "ok" {
		t.Fatalf("unexpected health response: %v", health)
	}

	first := registerTestUser(t, client, server.URL, "Alpha", "alpha@example.test")
	second := registerTestUser(t, client, server.URL, "Beta", "beta@example.test")

	requestJSON(t, client, http.MethodPost, server.URL+"/api/chat/messages", first.Token, map[string]string{
		"to": second.User.Username, "text": "Проверка чата",
	}, http.StatusCreated, nil)
	var unread UnreadResponse
	requestJSON(t, client, http.MethodGet, server.URL+"/api/chat/unread", second.Token, nil, http.StatusOK, &unread)
	if unread.UnreadCount != 1 {
		t.Fatalf("unexpected unread count: %d", unread.UnreadCount)
	}

	var duelCreated struct {
		ID int `json:"id"`
	}
	requestJSON(t, client, http.MethodPost, server.URL+"/api/duels", first.Token, DuelCreateRequest{
		Opponent: second.User.Username,
	}, http.StatusCreated, &duelCreated)
	requestJSON(t, client, http.MethodPost, fmt.Sprintf("%s/api/duels/%d/accept", server.URL, duelCreated.ID), second.Token, nil, http.StatusOK, nil)
	var duel Duel
	requestJSON(t, client, http.MethodGet, fmt.Sprintf("%s/api/duels/%d", server.URL, duelCreated.ID), first.Token, nil, http.StatusOK, &duel)
	if len(duel.Questions) != 10 {
		t.Fatalf("duel has %d questions", len(duel.Questions))
	}
	finish := DuelFinishRequest{Answers: correctAnswers(duel.Questions)}
	requestJSON(t, client, http.MethodPost, fmt.Sprintf("%s/api/duels/%d/finish", server.URL, duel.ID), first.Token, finish, http.StatusOK, nil)
	requestJSON(t, client, http.MethodPost, fmt.Sprintf("%s/api/duels/%d/finish", server.URL, duel.ID), second.Token, finish, http.StatusOK, &duel)
	if duel.Status != "completed" {
		t.Fatalf("duel was not completed: %s", duel.Status)
	}

	var categories []TeamBattleCategory
	requestJSON(t, client, http.MethodGet, server.URL+"/api/team-battles/categories", first.Token, nil, http.StatusOK, &categories)
	if len(categories) == 0 || categories[0].QuestionCount < 10 {
		t.Fatalf("team battle categories are not ready: %+v", categories)
	}
	createBattle := TeamBattleCreateRequest{Code: "123456", Category: categories[0].Category, QuestionCount: 10}
	var battle TeamBattle
	requestJSON(t, client, http.MethodPost, server.URL+"/api/team-battles", first.Token, createBattle, http.StatusOK, &battle)
	requestJSON(t, client, http.MethodPost, server.URL+"/api/team-battles/123456/join", second.Token, nil, http.StatusOK, nil)
	requestJSON(t, client, http.MethodPost, server.URL+"/api/team-battles/123456/start", first.Token, nil, http.StatusOK, &battle)
	if len(battle.Questions) != 10 {
		t.Fatalf("team battle has %d questions", len(battle.Questions))
	}
	battleFinish := DuelFinishRequest{Answers: correctAnswers(battle.Questions)}
	requestJSON(t, client, http.MethodPost, server.URL+"/api/team-battles/123456/finish", first.Token, battleFinish, http.StatusOK, nil)
	requestJSON(t, client, http.MethodPost, server.URL+"/api/team-battles/123456/finish", second.Token, battleFinish, http.StatusOK, &battle)
	if len(battle.Participants) != 2 {
		t.Fatalf("team battle has %d participants", len(battle.Participants))
	}

	var savedSuggestion map[string]interface{}
	requestJSON(t, client, http.MethodPost, server.URL+"/api/suggestions", "", SuggestionRequest{
		Message: "Добавить новый маршрут по Беларуси", Name: "Alpha", Email: "alpha@example.test",
	}, http.StatusAccepted, &savedSuggestion)
	if savedSuggestion["status"] != "saved" {
		t.Fatalf("suggestion was not saved: %v", savedSuggestion)
	}

	var admin testSession
	requestJSON(t, client, http.MethodPost, server.URL+"/api/login", "", LoginRequest{
		Email: "n4963959@gmail.com", Password: "admin123",
	}, http.StatusOK, &admin)
	article := ArticleInput{
		Title: "Тестовый материал", Category: "history", CategoryLabel: "История",
		Difficulty: "easy", DifficultyLabel: "Лёгкий", ReadTime: 3, Image: "/images/kupalle.jpg",
		Content:   `[{"type":"lead","text":"Тест"}]`,
		Questions: `[{"id":99001,"type":"single","question":"Тест?","options":["Да","Нет"],"correct":0}]`,
	}
	var createdArticle struct {
		ID int `json:"id"`
	}
	requestJSON(t, client, http.MethodPost, server.URL+"/api/admin/articles", admin.Token, article, http.StatusCreated, &createdArticle)
	article.Title = "Тестовый материал обновлён"
	requestJSON(t, client, http.MethodPut, fmt.Sprintf("%s/api/admin/articles/%d", server.URL, createdArticle.ID), admin.Token, article, http.StatusOK, nil)
	requestJSON(t, client, http.MethodDelete, fmt.Sprintf("%s/api/admin/articles/%d", server.URL, createdArticle.ID), admin.Token, nil, http.StatusOK, nil)
}
