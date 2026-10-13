package backend

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
	t.Setenv("ADMIN_EMAIL", "admin@example.test")
	t.Setenv("ADMIN_PASSWORD", "test-admin-password-123")
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
	preflight, err := http.NewRequest(http.MethodOptions, server.URL+"/api/atlas", nil)
	if err != nil {
		t.Fatal(err)
	}
	preflight.Header.Set("Origin", "http://localhost:5173")
	preflight.Header.Set("Access-Control-Request-Method", http.MethodGet)
	preflight.Header.Set("Access-Control-Request-Headers", "authorization")
	preflightResponse, err := client.Do(preflight)
	if err != nil {
		t.Fatal(err)
	}
	preflightResponse.Body.Close()
	if preflightResponse.StatusCode != http.StatusNoContent || preflightResponse.Header.Get("Access-Control-Allow-Origin") != "*" {
		t.Fatalf("CORS preflight failed: %s", preflightResponse.Status)
	}

	var health map[string]string
	requestJSON(t, client, http.MethodGet, server.URL+"/api/health", "", nil, http.StatusOK, &health)
	if health["status"] != "ok" {
		t.Fatalf("unexpected health response: %v", health)
	}

	first := registerTestUser(t, client, server.URL, "Alpha", "alpha@example.test")
	second := registerTestUser(t, client, server.URL, "Beta", "beta@example.test")
	var people []struct {
		Username string `json:"username"`
		Email    string `json:"email"`
	}
	requestJSON(t, client, http.MethodGet, server.URL+"/api/people", first.Token, nil, http.StatusOK, &people)
	if len(people) != 1 || people[0].Username != second.User.Username || people[0].Email != "" {
		t.Fatalf("people endpoint should return only other users' public fields: %+v", people)
	}
	var emptyRanking []LeaderboardEntry
	requestJSON(t, client, http.MethodGet, server.URL+"/api/leaderboard?period=all", "", nil, http.StatusOK, &emptyRanking)
	if len(emptyRanking) != 0 {
		t.Fatalf("users without completed tasks should not appear in leaderboard: %+v", emptyRanking)
	}
	var updatedProfile User
	requestJSON(t, client, http.MethodPatch, server.URL+"/api/me", first.Token, map[string]string{"name": "Alpha Updated"}, http.StatusOK, &updatedProfile)
	if updatedProfile.Name != "Alpha Updated" {
		t.Fatalf("profile name was not saved: %+v", updatedProfile)
	}
	requestJSON(t, client, http.MethodPatch, server.URL+"/api/me", first.Token, map[string]string{"name": "x"}, http.StatusBadRequest, nil)
	for _, period := range []string{"week", "month", "all"} {
		var ranking []LeaderboardEntry
		requestJSON(t, client, http.MethodGet, server.URL+"/api/leaderboard?period="+period, "", nil, http.StatusOK, &ranking)
	}
	requestJSON(t, client, http.MethodGet, server.URL+"/api/leaderboard?period=year", "", nil, http.StatusBadRequest, nil)

	requestJSON(t, client, http.MethodPost, server.URL+"/api/chat/messages", first.Token, map[string]string{
		"to": second.User.Username, "text": "Проверка чата",
	}, http.StatusCreated, nil)
	var messages []ChatMessage
	requestJSON(t, client, http.MethodGet, server.URL+"/api/chat/messages?peer="+second.User.Username, first.Token, nil, http.StatusOK, &messages)
	if len(messages) != 1 || messages[0].SenderName != "Alpha Updated" || messages[0].ReceiverName != second.User.Name {
		t.Fatalf("chat should use saved profile names: %+v", messages)
	}
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
	if duel.ChallengerName != "Alpha Updated" || duel.OpponentName != second.User.Name {
		t.Fatalf("duel should use saved profile names: %+v", duel)
	}
	if len(duel.Questions) != 10 {
		t.Fatalf("duel has %d questions", len(duel.Questions))
	}
	finish := DuelFinishRequest{Answers: correctAnswers(duel.Questions)}
	requestJSON(t, client, http.MethodPost, fmt.Sprintf("%s/api/duels/%d/finish", server.URL, duel.ID), first.Token, finish, http.StatusOK, nil)
	requestJSON(t, client, http.MethodPost, fmt.Sprintf("%s/api/duels/%d/finish", server.URL, duel.ID), second.Token, DuelFinishRequest{}, http.StatusOK, &duel)
	if duel.Status != "completed" {
		t.Fatalf("duel was not completed: %s", duel.Status)
	}

	var categories []TeamBattleCategory
	requestJSON(t, client, http.MethodGet, server.URL+"/api/team-battles/categories", first.Token, nil, http.StatusOK, &categories)
	if len(categories) == 0 || categories[0].QuestionCount < 10 {
		t.Fatalf("team battle categories are not ready: %+v", categories)
	}
	createBattle := TeamBattleCreateRequest{Code: "123456", Category: "all", QuestionCount: 10, TimeSeconds: 30}
	var battle TeamBattle
	requestJSON(t, client, http.MethodPost, server.URL+"/api/team-battles", first.Token, createBattle, http.StatusOK, &battle)
	if battle.Started || battle.TimeSeconds != 30 || battle.CategoryLabel != "Все темы" {
		t.Fatalf("battle lobby settings were not saved: %+v", battle)
	}
	requestJSON(t, client, http.MethodPost, server.URL+"/api/team-battles/123456/join", second.Token, nil, http.StatusOK, nil)
	requestJSON(t, client, http.MethodPost, server.URL+"/api/team-battles/123456/finish", first.Token, DuelFinishRequest{}, http.StatusConflict, nil)
	requestJSON(t, client, http.MethodPost, server.URL+"/api/team-battles/123456/start", first.Token, nil, http.StatusOK, &battle)
	if len(battle.Questions) != 10 {
		t.Fatalf("team battle has %d questions", len(battle.Questions))
	}
	battleFinish := DuelFinishRequest{Answers: correctAnswers(battle.Questions)}
	requestJSON(t, client, http.MethodPost, server.URL+"/api/team-battles/123456/finish", first.Token, battleFinish, http.StatusOK, nil)
	requestJSON(t, client, http.MethodPost, server.URL+"/api/team-battles/123456/finish", second.Token, battleFinish, http.StatusOK, &battle)
	requestJSON(t, client, http.MethodPost, server.URL+"/api/team-battles/123456/finish", second.Token, battleFinish, http.StatusConflict, nil)
	if len(battle.Participants) != 2 {
		t.Fatalf("team battle has %d participants", len(battle.Participants))
	}
	participantNames := map[string]bool{}
	for _, participant := range battle.Participants {
		participantNames[participant.Name] = true
	}
	if !participantNames["Alpha Updated"] || !participantNames[second.User.Name] {
		t.Fatalf("team battle should use saved profile names: %+v", battle.Participants)
	}
	requestJSON(t, client, http.MethodPost, server.URL+"/api/atlas/results", first.Token, map[string]interface{}{
		"slug": "mir", "score": 5, "max_score": 5,
	}, http.StatusOK, nil)
	var earned User
	requestJSON(t, client, http.MethodGet, server.URL+"/api/me", first.Token, nil, http.StatusOK, &earned)
	if earned.Points < 200 {
		t.Fatalf("duel and battle rewards disappeared after a quiz: %+v", earned)
	}
	var gameRanking []LeaderboardEntry
	requestJSON(t, client, http.MethodGet, server.URL+"/api/leaderboard?period=all", "", nil, http.StatusOK, &gameRanking)
	if len(gameRanking) < 2 || gameRanking[0].Username != first.User.Username || gameRanking[0].Points < 200 {
		t.Fatalf("game rewards should count in the ranking: %+v", gameRanking)
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
		Email: "admin@example.test", Password: "test-admin-password-123",
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
	question := battleQuestionInput{Mode: "both", Category: "history", CategoryLabel: "История", Question: "Тестовый вопрос баттла?", Options: []string{"Да", "Нет"}, Correct: 0}
	requestJSON(t, client, http.MethodPost, server.URL+"/api/admin/questions", first.Token, question, http.StatusForbidden, nil)
	var createdQuestion struct {
		ID int `json:"id"`
	}
	requestJSON(t, client, http.MethodPost, server.URL+"/api/admin/questions", admin.Token, question, http.StatusCreated, &createdQuestion)
	question.Question = "Обновлённый вопрос баттла?"
	requestJSON(t, client, http.MethodPut, fmt.Sprintf("%s/api/admin/questions/%d", server.URL, createdQuestion.ID), admin.Token, question, http.StatusOK, nil)
	for _, tc := range []struct {
		name      string
		questions []DuelQuestion
	}{
		{"duel", func() []DuelQuestion {
			q, err := buildDuelQuestions(10)
			if err != nil {
				t.Fatal(err)
			}
			return q
		}()},
		{"team", func() []DuelQuestion {
			q, err := buildTeamBattleQuestions("history", 5)
			if err != nil {
				t.Fatal(err)
			}
			return q
		}()},
	} {
		found := false
		for _, q := range tc.questions {
			if q.ID == createdQuestion.ID+10000000 && q.Question == question.Question {
				found = true
			}
		}
		if !found {
			t.Fatalf("custom question missing from %s", tc.name)
		}
	}
	requestJSON(t, client, http.MethodDelete, fmt.Sprintf("%s/api/admin/questions/%d", server.URL, createdQuestion.ID), admin.Token, nil, http.StatusOK, nil)
	reward := rewardInput{ID: "test-admin-reward", Icon: "★", Name: "Тестовая награда", Cost: 25}
	requestJSON(t, client, http.MethodPost, server.URL+"/api/admin/rewards", first.Token, reward, http.StatusForbidden, nil)
	requestJSON(t, client, http.MethodPost, server.URL+"/api/admin/rewards", admin.Token, reward, http.StatusCreated, nil)
	reward.Name = "Изменённая награда"
	requestJSON(t, client, http.MethodPut, server.URL+"/api/admin/rewards/"+reward.ID, admin.Token, reward, http.StatusOK, nil)
	requestJSON(t, client, http.MethodDelete, server.URL+"/api/admin/rewards/"+reward.ID, admin.Token, nil, http.StatusOK, nil)
	if _, err := db.Exec("DELETE FROM reward_items WHERE id='belt-frame'"); err != nil {
		t.Fatal(err)
	}
	seedAtlas()
	var restored int
	_ = db.QueryRow("SELECT COUNT(*) FROM reward_items WHERE id='belt-frame'").Scan(&restored)
	if restored != 0 {
		t.Fatal("deleted reward was restored by seeding")
	}
	if _, err := db.Exec("UPDATE articles SET title='Мирский замок — отредактирован' WHERE id=(SELECT article_id FROM atlas_places WHERE slug='mir')"); err != nil {
		t.Fatal(err)
	}
	seedAtlas()
	var editedTitle string
	_ = db.QueryRow("SELECT title FROM articles WHERE id=(SELECT article_id FROM atlas_places WHERE slug='mir')").Scan(&editedTitle)
	if editedTitle != "Мирский замок — отредактирован" {
		t.Fatal("edited atlas article was overwritten by seeding")
	}
	var profile struct {
		User  User `json:"user"`
		Stats struct {
			ArticlesCompleted int `json:"articles_completed"`
			CorrectAnswers    int `json:"correct_answers"`
		} `json:"stats"`
	}
	requestJSON(t, client, http.MethodGet, fmt.Sprintf("%s/api/admin/users/%d", server.URL, first.User.ID), admin.Token, nil, http.StatusOK, &profile)
	if profile.User.ID != first.User.ID || profile.User.Name != "Alpha Updated" || profile.Stats.ArticlesCompleted == 0 {
		t.Fatalf("admin profile is missing user identity or quiz stats: %+v", profile)
	}
	requestJSON(t, client, http.MethodDelete, fmt.Sprintf("%s/api/admin/users/%d", server.URL, admin.User.ID), admin.Token, nil, http.StatusBadRequest, nil)
	requestJSON(t, client, http.MethodDelete, fmt.Sprintf("%s/api/admin/users/%d", server.URL, first.User.ID), admin.Token, nil, http.StatusOK, nil)
	requestJSON(t, client, http.MethodGet, fmt.Sprintf("%s/api/admin/users/%d", server.URL, first.User.ID), admin.Token, nil, http.StatusNotFound, nil)
}

func TestAtlasPersistenceAndRewards(t *testing.T) {
	if db != nil {
		_ = db.Close()
	}
	t.Setenv("DATABASE_PATH", filepath.Join(t.TempDir(), "atlas-test.db"))
	t.Setenv("ADMIN_EMAIL", "admin@example.test")
	t.Setenv("ADMIN_PASSWORD", "test-admin-password-123")
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

	var atlas struct {
		Places []struct {
			ID    string `json:"id"`
			Image string `json:"image"`
		} `json:"places"`
	}
	requestJSON(t, client, http.MethodGet, server.URL+"/api/atlas", "", nil, http.StatusOK, &atlas)
	if len(atlas.Places) != 27 || atlas.Places[0].ID != "mir" || atlas.Places[0].Image != "img/hero.jpg" {
		t.Fatalf("unexpected archive atlas payload: %d places, first=%+v", len(atlas.Places), atlas.Places[0])
	}

	user := registerTestUser(t, client, server.URL, "Atlas Tester", "atlas@example.com")
	requestJSON(t, client, http.MethodPost, server.URL+"/api/atlas/results", user.Token, map[string]interface{}{
		"slug": "mir", "score": 3, "max_score": 5,
	}, http.StatusOK, nil)
	requestJSON(t, client, http.MethodPost, server.URL+"/api/atlas/results", user.Token, map[string]interface{}{
		"slug": "mir", "score": 1, "max_score": 1,
	}, http.StatusBadRequest, nil)
	requestJSON(t, client, http.MethodPost, server.URL+"/api/atlas/results", user.Token, map[string]interface{}{
		"slug": "mir", "score": 2, "max_score": 5,
	}, http.StatusOK, nil)
	var progress []struct {
		Slug     string `json:"slug"`
		Category string `json:"category"`
		Score    int    `json:"score"`
	}
	requestJSON(t, client, http.MethodGet, server.URL+"/api/atlas/progress", user.Token, nil, http.StatusOK, &progress)
	if len(progress) != 1 || progress[0].Slug != "mir" || progress[0].Category != "architecture" || progress[0].Score != 3 {
		t.Fatalf("unexpected saved atlas progress: %+v", progress)
	}

	if _, err := db.Exec("UPDATE users SET points=1000 WHERE id=?", user.User.ID); err != nil {
		t.Fatal(err)
	}
	var rewards []struct {
		ID   string `json:"id"`
		Cost int    `json:"cost"`
	}
	requestJSON(t, client, http.MethodGet, server.URL+"/api/rewards", "", nil, http.StatusOK, &rewards)
	if len(rewards) != 6 || rewards[0].ID != "belt-frame" {
		t.Fatalf("unexpected rewards: %+v", rewards)
	}
	requestJSON(t, client, http.MethodPost, server.URL+"/api/rewards/redeem", user.Token, map[string]string{
		"reward_id": rewards[0].ID,
	}, http.StatusOK, nil)
	var owned []struct {
		ID string `json:"id"`
	}
	requestJSON(t, client, http.MethodGet, server.URL+"/api/rewards/my", user.Token, nil, http.StatusOK, &owned)
	if len(owned) != 1 || owned[0].ID != rewards[0].ID {
		t.Fatalf("reward was not stored: %+v", owned)
	}
}
