package backend

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

//go:embed atlas-content.json
var atlasContentJSON []byte

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
				Explanation:   question.Explanation,
			})
		}
		questionsJSON, _ := json.Marshal(questions)
		contentJSON, _ := json.Marshal([]map[string]string{{"type": "lead", "text": place.Lead}})
		var articleID int64
		knownAtlas := db.QueryRow("SELECT article_id FROM atlas_places WHERE slug = ?", place.ID).Scan(&articleID) == nil
		if articleID > 0 {
			var exists int
			_ = db.QueryRow("SELECT COUNT(*) FROM articles WHERE id = ?", articleID).Scan(&exists)
			if exists == 0 {
				continue
			}
		} else {
			_ = db.QueryRow("SELECT id FROM articles WHERE title = ? ORDER BY id LIMIT 1", place.Name).Scan(&articleID)
		}
		if articleID == 0 {
			result, err := db.Exec(`INSERT INTO articles (title, category, category_label, difficulty, difficulty_label, read_time, image, content, questions)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, place.Name, place.Cat, categoryLabels[place.Cat], "medium", "Средний", 5,
				place.Image, string(contentJSON), string(questionsJSON))
			if err != nil {
				continue
			}
			articleID, _ = result.LastInsertId()
		} else if !knownAtlas {
			_, _ = db.Exec(`UPDATE articles SET category=?, category_label=?, difficulty=?, difficulty_label=?, read_time=?, image=?, content=?, questions=? WHERE id=?`,
				place.Cat, categoryLabels[place.Cat], "medium", "Средний", 5, place.Image, string(contentJSON), string(questionsJSON), articleID)
		}
		_, _ = db.Exec(`INSERT INTO atlas_places (slug, article_id, region, era, lead, points, x, y,latitude,longitude,map_label)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?,?,?,?)
			ON CONFLICT(slug) DO NOTHING`,
			place.ID, articleID, place.Region, place.Era, place.Lead, place.Points, place.X, place.Y, data.Coords[place.ID][0], data.Coords[place.ID][1], atlasMapLabel(place.ID))
	}

	upgradeAtlasContent()

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
	var rewardSeeded string
	if err := db.QueryRow("SELECT value FROM app_settings WHERE key='rewards_seeded'").Scan(&rewardSeeded); err == nil {
		return
	}
	for _, reward := range rewards {
		_, _ = db.Exec(`INSERT INTO reward_items (id, icon, name, cost) VALUES (?, ?, ?, ?)
			ON CONFLICT(id) DO NOTHING`,
			reward.id, reward.icon, reward.name, reward.cost)
	}
	_, _ = db.Exec("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('rewards_seeded', '1')")
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
		respondError(w, "method not allowed", 405)
		return
	}
	rows, err := db.Query(articleSelect + " WHERE ap.published=1 ORDER BY a.id")
	if err != nil {
		respondError(w, "db error", 500)
		return
	}
	defer rows.Close()
	source := readAtlasData()
	places := []map[string]interface{}{}
	quizzes := map[string]interface{}{}
	coords := map[string][]float64{}
	counts := map[string]int{}
	for rows.Next() {
		a, err := scanArticle(rows)
		if err != nil {
			respondError(w, "db error", 500)
			return
		}
		var blocks []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		}
		_ = json.Unmarshal([]byte(a.Content), &blocks)
		lead := ""
		for _, block := range blocks {
			if block.Type != "credit" && !strings.HasPrefix(block.Text, "Фото:") {
				lead = block.Text
				break
			}
		}
		var questions []DuelQuestion
		if json.Unmarshal([]byte(a.Questions), &questions) != nil {
			respondError(w, "invalid article questions", 500)
			return
		}
		public := []map[string]interface{}{}
		for _, q := range questions {
			public = append(public, map[string]interface{}{"id": q.ID, "q": q.Question, "a": q.Options, "multiple": len(correctIndices(q.Correct)) > 1})
		}
		quizzes[a.Slug] = public
		counts[a.Category]++
		places = append(places, map[string]interface{}{"id": a.Slug, "article_id": a.ID, "name": a.Title, "cat": a.Category, "region": a.Region, "era": a.Era,
			"lead": lead, "image": a.Image, "tasks": len(questions), "pts": a.Points, "content": a.Content, "quiz_version": quizVersion(a.Questions), "map_label": a.MapLabel})
		if a.Latitude != nil && a.Longitude != nil {
			coords[a.Slug] = []float64{*a.Latitude, *a.Longitude}
		}
	}
	if rows.Err() != nil {
		respondError(w, "db error", 500)
		return
	}
	for i := range source.Categories {
		source.Categories[i].Count = counts[source.Categories[i].ID]
	}
	respondJSON(w, map[string]interface{}{"categories": source.Categories, "places": places, "quizzes": quizzes, "coords": coords}, 200)
}

func saveAtlasResultHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w, r)
	if r.Method != http.MethodPost {
		respondError(w, "method not allowed", 405)
		return
	}
	var req struct {
		Slug    string       `json:"slug"`
		Version string       `json:"version"`
		Answers []DuelAnswer `json:"answers"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 131072)).Decode(&req) != nil || req.Slug == "" {
		respondError(w, "invalid request", 400)
		return
	}
	var id int
	if db.QueryRow("SELECT article_id FROM atlas_places WHERE published=1 AND slug=?", req.Slug).Scan(&id) != nil {
		respondError(w, "place not found", 404)
		return
	}
	saveVerifiedResult(w, r, id, req.Version, req.Answers)
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

func atlasMapLabel(slug string) string {
	switch slug {
	case "kupalle":
		return "Александрия — место праздника Купалье"
	case "kolyady":
		return "Семежево — обряд «Колядные цари»"
	case "dozhinki":
		return "Горки — место республиканских Дожинок 2012 года"
	}
	return ""
}

// Upgrade only unchanged seed content. Never replace an administrator's edits.
func upgradeAtlasContent() {
	var source map[string]struct {
		Content interface{} `json:"content"`
		Image   string      `json:"image"`
	}
	if json.Unmarshal(atlasContentJSON, &source) != nil {
		return
	}
	for _, p := range readAtlasData().Places {
		seed, _ := json.Marshal([]map[string]string{{"type": "lead", "text": p.Lead}})
		content, _ := json.Marshal(source[p.ID].Content)
		_, _ = db.Exec("UPDATE articles SET content=?, image=? WHERE id=(SELECT article_id FROM atlas_places WHERE slug=?) AND content=?",
			string(content), source[p.ID].Image, p.ID, string(seed))
	}
}
