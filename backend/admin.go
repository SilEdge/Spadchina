package backend

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

func createArticleHandler(w http.ResponseWriter, r *http.Request) {
	var input ArticleInput
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 524288)).Decode(&input) != nil || !validArticle(&input) {
		respondError(w, "Проверьте текст, вопросы и настройки статьи", 400)
		return
	}
	tx, err := db.BeginTx(r.Context(), nil)
	if err != nil {
		respondError(w, "db error", 500)
		return
	}
	defer tx.Rollback()
	result, err := tx.Exec("INSERT INTO articles(title,category,category_label,difficulty,difficulty_label,read_time,image,content,questions) VALUES(?,?,?,?,?,?,?,?,?)",
		input.Title, input.Category, input.CategoryLabel, input.Difficulty, input.DifficultyLabel, input.ReadTime, input.Image, input.Content, input.Questions)
	if err != nil {
		respondError(w, "db error", 500)
		return
	}
	id, _ := result.LastInsertId()
	if savePublication(tx, id, input) != nil {
		respondError(w, "Проверьте код статьи и координаты", 409)
		return
	}
	if tx.Commit() != nil {
		respondError(w, "db error", 500)
		return
	}
	respondJSON(w, map[string]int64{"id": id}, 201)
}

func updateArticleHandler(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(strings.TrimPrefix(r.URL.Path, "/api/admin/articles/"))
	if err != nil || id <= 0 {
		respondError(w, "invalid id", 400)
		return
	}
	var input ArticleInput
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 524288)).Decode(&input) != nil || !validArticle(&input) {
		respondError(w, "Проверьте текст, вопросы и настройки статьи", 400)
		return
	}
	tx, err := db.BeginTx(r.Context(), nil)
	if err != nil {
		respondError(w, "db error", 500)
		return
	}
	defer tx.Rollback()
	var oldSlug string
	_ = tx.QueryRow("SELECT slug FROM atlas_places WHERE article_id=?", id).Scan(&oldSlug)
	if oldSlug != "" && input.Slug != "" && input.Slug != oldSlug {
		respondError(w, "Код опубликованной статьи нельзя менять", 400)
		return
	}
	if oldSlug != "" {
		input.Slug = oldSlug
	}
	result, err := tx.Exec("UPDATE articles SET title=?,category=?,category_label=?,difficulty=?,difficulty_label=?,read_time=?,image=?,content=?,questions=? WHERE id=?",
		input.Title, input.Category, input.CategoryLabel, input.Difficulty, input.DifficultyLabel, input.ReadTime, input.Image, input.Content, input.Questions, id)
	if err != nil {
		respondError(w, "db error", 500)
		return
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		respondError(w, "article not found", 404)
		return
	}
	if savePublication(tx, int64(id), input) != nil {
		respondError(w, "Проверьте код статьи и координаты", 409)
		return
	}
	if tx.Commit() != nil {
		respondError(w, "db error", 500)
		return
	}
	respondJSON(w, map[string]string{"status": "updated"}, 200)
}

func deleteArticleHandler(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(strings.TrimPrefix(r.URL.Path, "/api/admin/articles/"))
	if err != nil || id <= 0 {
		respondError(w, "invalid id", 400)
		return
	}
	tx, err := db.BeginTx(r.Context(), nil)
	if err != nil {
		respondError(w, "db error", 500)
		return
	}
	defer tx.Rollback()
	// Keep earned results and their points intact when an article is archived.
	if _, err = tx.Exec("UPDATE atlas_places SET published=-1 WHERE article_id=?", id); err != nil {
		respondError(w, "db error", 500)
		return
	}
	var count int
	if tx.QueryRow("SELECT COUNT(*) FROM results WHERE article_id=?", id).Scan(&count) != nil {
		respondError(w, "db error", 500)
		return
	}
	var slug string
	_ = tx.QueryRow("SELECT slug FROM atlas_places WHERE article_id=?", id).Scan(&slug)
	builtIn := false
	for _, place := range readAtlasData().Places {
		if place.ID == slug {
			builtIn = true
			break
		}
	}
	if count == 0 && !builtIn {
		if _, err = tx.Exec("DELETE FROM atlas_places WHERE article_id=?", id); err != nil {
			respondError(w, "db error", 500)
			return
		}
		if _, err = tx.Exec("DELETE FROM articles WHERE id=?", id); err != nil {
			respondError(w, "db error", 500)
			return
		}
	}
	if tx.Commit() != nil {
		respondError(w, "db error", 500)
		return
	}
	respondJSON(w, map[string]string{"status": "deleted"}, 200)
}

func listUsersHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w, r)
	if r.Method != http.MethodGet {
		respondError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	rows, err := db.Query(`
		SELECT id, COALESCE(username, ''), COALESCE(NULLIF(TRIM(name), ''), username, 'Без имени'),
			COALESCE(email, ''), COALESCE(role, 'user'), COALESCE(points, 0), created_at
		FROM users
		ORDER BY id
	`)
	if err != nil {
		respondError(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	users := []User{}
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Username, &u.Name, &u.Email, &u.Role, &u.Points, &u.CreatedAt); err != nil {
			respondError(w, "db error", http.StatusInternalServerError)
			return
		}
		users = append(users, u)
	}
	if err := rows.Err(); err != nil {
		respondError(w, "db error", http.StatusInternalServerError)
		return
	}

	respondJSON(w, users, http.StatusOK)
}

type adminUserStats struct {
	ArticlesCompleted int `json:"articles_completed"`
	CorrectAnswers    int `json:"correct_answers"`
	AvailableAnswers  int `json:"available_answers"`
	DuelsPlayed       int `json:"duels_played"`
	DuelsWon          int `json:"duels_won"`
	TeamBattlesPlayed int `json:"team_battles_played"`
	RewardsOwned      int `json:"rewards_owned"`
}

type adminUserProfile struct {
	User  User           `json:"user"`
	Stats adminUserStats `json:"stats"`
}

func adminUserProfileHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w, r)
	if r.Method != http.MethodGet {
		respondError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id, err := strconv.Atoi(strings.TrimPrefix(r.URL.Path, "/api/admin/users/"))
	if err != nil || id <= 0 {
		respondError(w, "invalid id", http.StatusBadRequest)
		return
	}
	var profile adminUserProfile
	err = db.QueryRow(`
		SELECT id, COALESCE(username, ''), COALESCE(NULLIF(TRIM(name), ''), username, 'Без имени'),
			COALESCE(email, ''), COALESCE(role, 'user'), COALESCE(points, 0), created_at
		FROM users WHERE id=?`, id,
	).Scan(&profile.User.ID, &profile.User.Username, &profile.User.Name, &profile.User.Email,
		&profile.User.Role, &profile.User.Points, &profile.User.CreatedAt)
	if err != nil {
		respondError(w, "user not found", http.StatusNotFound)
		return
	}
	queries := []struct {
		dest  *int
		query string
		args  []interface{}
	}{
		{&profile.Stats.ArticlesCompleted, "SELECT COUNT(*) FROM results WHERE user_id=?", []interface{}{id}},
		{&profile.Stats.CorrectAnswers, "SELECT COALESCE(SUM(score),0) FROM results WHERE user_id=?", []interface{}{id}},
		{&profile.Stats.AvailableAnswers, "SELECT COALESCE(SUM(max_score),0) FROM results WHERE user_id=?", []interface{}{id}},
		{&profile.Stats.DuelsPlayed, "SELECT COUNT(*) FROM duels WHERE challenger_id=? OR opponent_id=?", []interface{}{id, id}},
		{&profile.Stats.DuelsWon, "SELECT COUNT(*) FROM duels WHERE winner_id=? AND status='completed'", []interface{}{id}},
		{&profile.Stats.TeamBattlesPlayed, "SELECT COUNT(*) FROM team_battle_participants WHERE user_id=?", []interface{}{id}},
		{&profile.Stats.RewardsOwned, "SELECT COUNT(*) FROM user_rewards WHERE user_id=?", []interface{}{id}},
	}
	for _, item := range queries {
		if err := db.QueryRow(item.query, item.args...).Scan(item.dest); err != nil {
			respondError(w, "db error", http.StatusInternalServerError)
			return
		}
	}
	respondJSON(w, profile, http.StatusOK)
}

func deleteUserHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w, r)
	if r.Method != http.MethodDelete {
		respondError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	idStr := strings.TrimPrefix(r.URL.Path, "/api/admin/users/")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		respondError(w, "invalid id", http.StatusBadRequest)
		return
	}

	claims := userFromContext(r.Context())
	if id == claims.UserID {
		respondError(w, "cannot delete yourself", http.StatusBadRequest)
		return
	}

	tx, err := db.BeginTx(r.Context(), nil)
	if err != nil {
		respondError(w, "could not delete user", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()
	var role string
	if err := tx.QueryRow("SELECT role FROM users WHERE id=?", id).Scan(&role); err != nil {
		respondError(w, "user not found", http.StatusNotFound)
		return
	}
	if role == "admin" {
		respondError(w, "cannot delete an administrator", http.StatusForbidden)
		return
	}
	statements := []struct {
		query string
		args  []interface{}
	}{
		{"DELETE FROM user_rewards WHERE user_id=?", []interface{}{id}},
		{"DELETE FROM results WHERE user_id=?", []interface{}{id}},
		{"DELETE FROM messages WHERE sender_id=? OR receiver_id=?", []interface{}{id, id}},
		{"DELETE FROM duels WHERE challenger_id=? OR opponent_id=? OR winner_id=?", []interface{}{id, id, id}},
		{"DELETE FROM team_battle_participants WHERE user_id=? OR battle_id IN (SELECT id FROM team_battles WHERE creator_id=?)", []interface{}{id, id}},
		{"DELETE FROM team_battles WHERE creator_id=?", []interface{}{id}},
		{"DELETE FROM users WHERE id=?", []interface{}{id}},
	}
	for _, statement := range statements {
		if _, err := tx.Exec(statement.query, statement.args...); err != nil {
			respondError(w, "could not delete user data", http.StatusInternalServerError)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		respondError(w, "could not delete user data", http.StatusInternalServerError)
		return
	}

	respondJSON(w, map[string]string{"status": "deleted"}, http.StatusOK)
}
