package backend

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func TestPublishingAndVerifiedScoring(t *testing.T) {
	if db != nil {
		_ = db.Close()
	}
	t.Setenv("DATABASE_PATH", filepath.Join(t.TempDir(), "publishing.db"))
	t.Setenv("ADMIN_EMAIL", "admin@example.test")
	t.Setenv("ADMIN_PASSWORD", "test-admin-password-123")
	t.Setenv("TELEGRAM_BOT_TOKEN", "")
	t.Setenv("TELEGRAM_IDEAS_BOT_TOKEN", "")
	initDB()
	t.Cleanup(func() { _ = db.Close() })
	server := httptest.NewServer(newServerMux())
	defer server.Close()
	client := server.Client()
	user := registerTestUser(t, client, server.URL, "Reader", "reader@example.test")
	var admin testSession
	requestJSON(t, client, "POST", server.URL+"/api/login", "", LoginRequest{Email: "admin@example.test", Password: "test-admin-password-123"}, 200, &admin)
	lat, lon := 53.9, 27.56
	article := ArticleInput{Title: "Новая история", Category: "history", CategoryLabel: "История", Difficulty: "easy", DifficultyLabel: "Лёгкий", ReadTime: 3,
		Content:     `[{"type":"lead","text":"Текст из админки"},{"type":"paragraph","text":"Полный текст"}]`,
		Questions:   `[{"id":88001,"type":"single","question":"Выберите ответ","options":["Нет","Да"],"correct":1}]`,
		Publication: Publication{Published: true, Points: 100, Latitude: &lat, Longitude: &lon, Region: "Минск"}}
	var created struct {
		ID int `json:"id"`
	}
	requestJSON(t, client, "POST", server.URL+"/api/admin/articles", admin.Token, article, 201, &created)
	slug := fmt.Sprintf("article-%d", created.ID)
	var atlas struct {
		Places []struct {
			ID      string `json:"id"`
			Name    string `json:"name"`
			Content string `json:"content"`
			Version string `json:"quiz_version"`
		}
		Coords  map[string][]float64                `json:"coords"`
		Quizzes map[string][]map[string]interface{} `json:"quizzes"`
	}
	requestJSON(t, client, "GET", server.URL+"/api/atlas", "", nil, 200, &atlas)
	version := ""
	for _, p := range atlas.Places {
		if p.ID == slug {
			version = p.Version
			if p.Content != article.Content || p.Name != article.Title {
				t.Fatal("publication content mismatch")
			}
		}
	}
	if version == "" || len(atlas.Coords[slug]) != 2 {
		t.Fatal("publication missing from atlas/map")
	}
	for _, questions := range atlas.Quizzes {
		for _, q := range questions {
			if _, ok := q["ok"]; ok {
				t.Fatal("atlas leaks answers")
			}
		}
	}
	var public Article
	requestJSON(t, client, "GET", fmt.Sprintf("%s/api/articles/%d", server.URL, created.ID), "", nil, 200, &public)
	var sanitized []map[string]interface{}
	_ = json.Unmarshal([]byte(public.Questions), &sanitized)
	if _, ok := sanitized[0]["correct"]; ok {
		t.Fatal("public article leaks answers")
	}
	var checked map[string]interface{}
	answer := DuelAnswer{QuestionID: 88001, Selected: []int{1}}
	requestJSON(t, client, "POST", server.URL+"/api/atlas/check", "", map[string]interface{}{"slug": slug, "version": version, "question_id": answer.QuestionID, "selected": answer.Selected}, 200, &checked)
	if checked["correct"] != true {
		t.Fatal("server did not check the answer")
	}
	payload := map[string]interface{}{"slug": slug, "version": version, "answers": []DuelAnswer{{QuestionID: 88001, Selected: []int{0}}}, "score": 999999, "max_score": 999999}
	var saved struct {
		Score  int `json:"score"`
		Points int `json:"points"`
	}
	requestJSON(t, client, "POST", server.URL+"/api/atlas/results", user.Token, payload, 200, &saved)
	if saved.Score != 0 || saved.Points != 0 {
		t.Fatal("browser supplied score was trusted")
	}
	payload["answers"] = []DuelAnswer{answer}
	requestJSON(t, client, "POST", server.URL+"/api/atlas/results", user.Token, payload, 200, &saved)
	if saved.Score != 1 || saved.Points != 100 {
		t.Fatalf("bad verified score: %+v", saved)
	}
	requestJSON(t, client, "POST", server.URL+"/api/atlas/results", user.Token, payload, 200, &saved)
	if saved.Points != 100 {
		t.Fatal("repeated result awarded extra points")
	}
	requestJSON(t, client, "POST", server.URL+"/api/results", user.Token, map[string]interface{}{"article_id": created.ID, "score": 999, "max_score": 999}, 400, nil)
	payload["answers"] = []DuelAnswer{answer, answer}
	requestJSON(t, client, "POST", server.URL+"/api/atlas/results", user.Token, payload, 400, nil)
	payload["answers"] = []DuelAnswer{{QuestionID: 88001, Selected: []int{1, 1}}}
	requestJSON(t, client, "POST", server.URL+"/api/atlas/results", user.Token, payload, 400, nil)
	payload["answers"] = []DuelAnswer{answer}
	payload["version"] = "stale"
	requestJSON(t, client, "POST", server.URL+"/api/atlas/results", user.Token, payload, 409, nil)
	article.Title = "Изменённая история"
	article.Content = `[{"type":"lead","text":"Новый текст"}]`
	requestJSON(t, client, "PUT", fmt.Sprintf("%s/api/admin/articles/%d", server.URL, created.ID), admin.Token, article, 200, nil)
	requestJSON(t, client, "GET", fmt.Sprintf("%s/api/articles/%d", server.URL, created.ID), "", nil, 200, &public)
	if public.Title != article.Title || public.Content != article.Content {
		t.Fatal("editing did not reach public article")
	}
	requestJSON(t, client, "DELETE", fmt.Sprintf("%s/api/admin/articles/%d", server.URL, created.ID), admin.Token, nil, 200, nil)
	requestJSON(t, client, "GET", fmt.Sprintf("%s/api/articles/%d", server.URL, created.ID), "", nil, 404, nil)
	recalcPoints(user.User.ID)
	var after User
	requestJSON(t, client, "GET", server.URL+"/api/me", user.Token, nil, 200, &after)
	if after.Points != 100 {
		t.Fatal("archiving removed previously earned points")
	}
	requestJSON(t, client, "POST", server.URL+"/api/suggestions", "", SuggestionRequest{Name: "Reader", Message: "Добавьте ещё одно интересное место"}, 202, nil)
	requestJSON(t, client, "GET", server.URL+"/api/admin/suggestions", user.Token, nil, 403, nil)
	var ideas []map[string]interface{}
	requestJSON(t, client, "GET", server.URL+"/api/admin/suggestions", admin.Token, nil, 200, &ideas)
	if len(ideas) != 1 {
		t.Fatal("idea inbox is empty")
	}
	requestJSON(t, client, "POST", server.URL+"/api/admin/password", admin.Token, map[string]string{"current_password": "wrong", "password": "new-long-password-456"}, 403, nil)
	requestJSON(t, client, "POST", server.URL+"/api/admin/password", admin.Token, map[string]string{"current_password": "test-admin-password-123", "password": "new-long-password-456"}, 200, nil)
	requestJSON(t, client, "POST", server.URL+"/api/login", "", LoginRequest{Email: "admin@example.test", Password: "test-admin-password-123"}, http.StatusUnauthorized, nil)
	requestJSON(t, client, "POST", server.URL+"/api/login", "", LoginRequest{Email: "admin@example.test", Password: "new-long-password-456"}, 200, nil)
}
