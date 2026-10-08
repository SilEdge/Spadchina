package main

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

// The archive's catalogue is the canonical source for the atlas pages.
//
//go:embed atlas-data.json
var atlasDataJSON []byte

type atlasData struct {
	Categories []struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Count int    `json:"count"`
	} `json:"categories"`
	Places []struct {
		ID     string `json:"id"`
		Name   string `json:"name"`
		Region string `json:"region"`
		Cat    string `json:"cat"`
		Tasks  int    `json:"tasks"`
		Points int    `json:"pts"`
		X      int    `json:"x"`
		Y      int    `json:"y"`
		Era    string `json:"era"`
		Lead   string `json:"lead"`
		Image  string `json:"image"`
	} `json:"places"`
	Quizzes map[string][]struct {
		ID          string   `json:"id"`
		Question    string   `json:"q"`
		Answers     []string `json:"a"`
		Correct     int      `json:"ok"`
		Explanation string   `json:"explanation"`
	} `json:"quizzes"`
	Coords map[string][]float64 `json:"coords"`
	Rating []struct {
		Name string `json:"name"`
		City string `json:"city"`
		Pts  int    `json:"pts"`
		Team string `json:"team"`
	} `json:"rating"`
}

func readAtlasData() atlasData {
	var data atlasData
	if err := json.Unmarshal(atlasDataJSON, &data); err != nil {
		panic(fmt.Errorf("decode atlas data: %w", err))
	}
	return data
}

func seedAtlas() {
	data := readAtlasData()
	categoryLabels := make(map[string]string, len(data.Categories))
	for _, category := range data.Categories {
		categoryLabels[category.ID] = category.Name
	}

	for index, place := range data.Places {
		questions := make([]DuelQuestion, 0, len(data.Quizzes[place.ID]))
		for questionIndex, question := range data.Quizzes[place.ID] {
			questions = append(questions, DuelQuestion{
				ID:            900000 + index*100 + questionIndex,
				Type:          "single",
				Question:      question.Question,
				Options:       question.Answers,
				Correct:       question.Correct,
				Category:      place.Cat,
				CategoryLabel: categoryLabels[place.Cat],
			})
		}
		questionsJSON, _ := json.Marshal(questions)
		contentJSON, _ := json.Marshal([]map[string]string{{"type": "lead", "text": place.Lead}})
		var articleID int64
		_ = db.QueryRow("SELECT id FROM articles WHERE title = ? ORDER BY id LIMIT 1", place.Name).Scan(&articleID)
		if articleID == 0 {
			result, err := db.Exec(`INSERT INTO articles (title, category, category_label, difficulty, difficulty_label, read_time, image, content, questions)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, place.Name, place.Cat, categoryLabels[place.Cat], "medium", "Средний", 5,
				place.Image, string(contentJSON), string(questionsJSON))
			if err != nil {
				continue
			}
			articleID, _ = result.LastInsertId()
		} else {
			_, _ = db.Exec(`UPDATE articles SET category=?, category_label=?, difficulty=?, difficulty_label=?, read_time=?, image=?, content=?, questions=? WHERE id=?`,
				place.Cat, categoryLabels[place.Cat], "medium", "Средний", 5, place.Image, string(contentJSON), string(questionsJSON), articleID)
		}
		_, _ = db.Exec(`INSERT INTO atlas_places (slug, article_id, region, era, lead, points, x, y)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(slug) DO UPDATE SET article_id=excluded.article_id, region=excluded.region,
				era=excluded.era, lead=excluded.lead, points=excluded.points, x=excluded.x, y=excluded.y`,
			place.ID, articleID, place.Region, place.Era, place.Lead, place.Points, place.X, place.Y)
	}

	rewards := []struct {
		id, icon, name string
		cost           int
	}{
		{"belt-frame", "🖼", "Рамка «Слуцкий пояс»", 500},
		{"pushcha-badge", "🌲", "Значок «Пуща»", 800},
		{"bison-guardian", "🦬", "Зубр-хранитель", 1200},
		{"paparats-kvetka", "🌼", "Папараць-кветка", 1500},
		{"expert-crown", "👑", "Корона знатока", 2500},
		{"memory-shield", "🛡", "Щит памяти", 3000},
	}
	for _, reward := range rewards {
		_, _ = db.Exec(`INSERT INTO reward_items (id, icon, name, cost) VALUES (?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET icon=excluded.icon, name=excluded.name, cost=excluded.cost`,
			reward.id, reward.icon, reward.name, reward.cost)
	}
}

func atlasProgressHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w, r)
	claims := userFromContext(r.Context())
	rows, err := db.Query(`SELECT ap.slug, a.category, r.score, r.max_score
		FROM results r JOIN atlas_places ap ON ap.article_id=r.article_id
		JOIN articles a ON a.id=r.article_id WHERE r.user_id=? ORDER BY r.created_at DESC`, claims.UserID)
	if err != nil {
		respondError(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	items := []map[string]interface{}{}
	for rows.Next() {
		var slug, category string
		var score, maxScore int
		if rows.Scan(&slug, &category, &score, &maxScore) == nil {
			items = append(items, map[string]interface{}{"slug": slug, "category": category, "score": score, "max_score": maxScore})
		}
	}
	respondJSON(w, items, http.StatusOK)
}

func getAtlasHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w, r)
	if r.Method != http.MethodGet {
		respondError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	respondJSON(w, readAtlasData(), http.StatusOK)
}

func saveAtlasResultHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w, r)
	claims := userFromContext(r.Context())
	var request struct {
		Slug     string `json:"slug"`
		Score    int    `json:"score"`
		MaxScore int    `json:"max_score"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil || request.Slug == "" || request.MaxScore <= 0 || request.Score < 0 || request.Score > request.MaxScore {
		respondError(w, "invalid result", http.StatusBadRequest)
		return
	}
	var articleID int
	if err := db.QueryRow("SELECT article_id FROM atlas_places WHERE slug = ?", request.Slug).Scan(&articleID); err != nil {
		respondError(w, "place not found", http.StatusNotFound)
		return
	}
	if _, err := db.Exec(`INSERT INTO results (user_id, article_id, score, max_score)
		VALUES (?, ?, ?, ?) ON CONFLICT(user_id, article_id) DO UPDATE SET
		score=excluded.score, max_score=excluded.max_score, created_at=CURRENT_TIMESTAMP`,
		claims.UserID, articleID, request.Score, request.MaxScore); err != nil {
		respondError(w, "could not save result", http.StatusInternalServerError)
		return
	}
	recalcPoints(claims.UserID)
	respondJSON(w, map[string]string{"status": "ok"}, http.StatusOK)
}

func rewardsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w, r)
	if r.Method != http.MethodGet {
		respondError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	rows, err := db.Query("SELECT id, icon, name, cost FROM reward_items ORDER BY cost")
	if err != nil {
		respondError(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	items := []map[string]interface{}{}
	for rows.Next() {
		var id, icon, name string
		var cost int
		if rows.Scan(&id, &icon, &name, &cost) == nil {
			items = append(items, map[string]interface{}{"id": id, "icon": icon, "name": name, "cost": cost})
		}
	}
	respondJSON(w, items, http.StatusOK)
}

func myRewardsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w, r)
	claims := userFromContext(r.Context())
	rows, err := db.Query(`SELECT ri.id, ri.icon, ri.name, ri.cost FROM user_rewards ur
		JOIN reward_items ri ON ri.id=ur.reward_id WHERE ur.user_id=? ORDER BY ur.created_at DESC`, claims.UserID)
	if err != nil {
		respondError(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	items := []map[string]interface{}{}
	for rows.Next() {
		var id, icon, name string
		var cost int
		if rows.Scan(&id, &icon, &name, &cost) == nil {
			items = append(items, map[string]interface{}{"id": id, "icon": icon, "name": name, "cost": cost})
		}
	}
	respondJSON(w, items, http.StatusOK)
}

func redeemRewardHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w, r)
	claims := userFromContext(r.Context())
	var request struct {
		RewardID string `json:"reward_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil || strings.TrimSpace(request.RewardID) == "" {
		respondError(w, "reward_id is required", http.StatusBadRequest)
		return
	}
	tx, err := db.BeginTx(r.Context(), nil)
	if err != nil {
		respondError(w, "db error", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()
	var cost int
	if err := tx.QueryRow("SELECT cost FROM reward_items WHERE id=?", request.RewardID).Scan(&cost); err != nil {
		respondError(w, "reward not found", http.StatusNotFound)
		return
	}
	var owned int
	_ = tx.QueryRow("SELECT COUNT(*) FROM user_rewards WHERE user_id=? AND reward_id=?", claims.UserID, request.RewardID).Scan(&owned)
	if owned != 0 {
		respondError(w, "reward already owned", http.StatusConflict)
		return
	}
	var points int
	if err := tx.QueryRow("SELECT points FROM users WHERE id=?", claims.UserID).Scan(&points); err != nil {
		respondError(w, "user not found", http.StatusNotFound)
		return
	}
	if points < cost {
		respondError(w, "not enough points", http.StatusConflict)
		return
	}
	if _, err := tx.Exec("INSERT INTO user_rewards(user_id, reward_id) VALUES (?, ?)", claims.UserID, request.RewardID); err != nil {
		respondError(w, "could not redeem reward", http.StatusInternalServerError)
		return
	}
	if _, err := tx.Exec("UPDATE users SET points=points-? WHERE id=?", cost, claims.UserID); err != nil {
		respondError(w, "db error", http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(); err != nil {
		respondError(w, "db error", http.StatusInternalServerError)
		return
	}
	respondJSON(w, map[string]interface{}{"status": "ok", "points": points - cost}, http.StatusOK)
}
