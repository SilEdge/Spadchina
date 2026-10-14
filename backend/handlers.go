package backend

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

func respondJSON(w http.ResponseWriter, data interface{}, status int) {
	// Never ship battle answer keys to players; scoring uses the database copy.
	switch value := data.(type) {
	case Duel:
		value.Questions = publicBattleQuestions(value.Questions)
		data = value
	case []Duel:
		copy := append([]Duel{}, value...)
		for i := range copy {
			copy[i].Questions = publicBattleQuestions(copy[i].Questions)
		}
		data = copy
	case TeamBattle:
		value.Questions = publicBattleQuestions(value.Questions)
		data = value
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func respondError(w http.ResponseWriter, message string, status int) {
	respondJSON(w, map[string]string{"error": message}, status)
}

func enableCORS(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
}

func registerHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		enableCORS(w, r)
		return
	}
	enableCORS(w, r)

	var req RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, "invalid request", http.StatusBadRequest)
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = strings.TrimSpace(req.Username)
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))

	if len(name) < 2 || len(req.Password) < 6 || !isValidEmail(email) {
		respondError(w, "name min 2 chars, valid email required, password min 6 chars", http.StatusBadRequest)
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		respondError(w, "server error", http.StatusInternalServerError)
		return
	}

	username := uniqueUsernameFromName(name)
	res, err := db.Exec(`
		INSERT INTO users (username, name, email, password)
		VALUES (?, ?, ?, ?)
	`, username, name, email, string(hash))
	if err != nil {
		if !strings.Contains(err.Error(), "UNIQUE constraint") {
			respondError(w, "Сервер временно недоступен. Попробуйте позже.", http.StatusServiceUnavailable)
			return
		}
		respondError(w, "email already exists", http.StatusConflict)
		return
	}

	id, _ := res.LastInsertId()
	user := User{ID: int(id), Username: username, Name: name, Email: email, Role: "user", Points: 0}
	token, err := generateToken(user)
	if err != nil {
		respondError(w, "token error", http.StatusInternalServerError)
		return
	}

	respondJSON(w, TokenResponse{Token: token, User: user}, http.StatusCreated)
}

func loginHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		enableCORS(w, r)
		return
	}
	enableCORS(w, r)

	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, "invalid request", http.StatusBadRequest)
		return
	}

	var user User
	email := strings.ToLower(strings.TrimSpace(req.Email))
	if email == "" {
		email = strings.ToLower(strings.TrimSpace(req.Username))
	}
	err := db.QueryRow(`
		SELECT id, username, COALESCE(name, username), COALESCE(email, ''), password, role, points
		FROM users
		WHERE lower(email) = ?
	`, email).Scan(&user.ID, &user.Username, &user.Name, &user.Email, &user.Password, &user.Role, &user.Points)
	if err != nil {
		if err != sql.ErrNoRows {
			respondError(w, "Сервер временно недоступен. Попробуйте позже.", http.StatusServiceUnavailable)
			return
		}
		respondError(w, "invalid credentials", http.StatusUnauthorized)
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
		respondError(w, "invalid credentials", http.StatusUnauthorized)
		return
	}

	token, err := generateToken(user)
	if err != nil {
		respondError(w, "token error", http.StatusInternalServerError)
		return
	}

	user.Password = ""
	respondJSON(w, TokenResponse{Token: token, User: user}, http.StatusOK)
}

func meHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w, r)
	claims := userFromContext(r.Context())
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method == http.MethodPatch {
		var request struct {
			Name string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			respondError(w, "invalid request", http.StatusBadRequest)
			return
		}
		request.Name = strings.TrimSpace(request.Name)
		if len([]rune(request.Name)) < 2 || len([]rune(request.Name)) > 80 {
			respondError(w, "name must contain between 2 and 80 characters", http.StatusBadRequest)
			return
		}
		if _, err := db.Exec("UPDATE users SET name = ? WHERE id = ?", request.Name, claims.UserID); err != nil {
			respondError(w, "could not update profile", http.StatusInternalServerError)
			return
		}
	} else if r.Method != http.MethodGet {
		respondError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var user User
	err := db.QueryRow(`
		SELECT id, username, COALESCE(name, username), COALESCE(email, ''), role, points
		FROM users
		WHERE id = ?
	`, claims.UserID).Scan(&user.ID, &user.Username, &user.Name, &user.Email, &user.Role, &user.Points)
	if err != nil {
		if err != sql.ErrNoRows {
			respondError(w, "Сервер временно недоступен. Попробуйте позже.", http.StatusServiceUnavailable)
			return
		}
		respondError(w, "user not found", http.StatusNotFound)
		return
	}

	respondJSON(w, user, http.StatusOK)
}

func isValidEmail(email string) bool {
	return regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`).MatchString(email)
}

func uniqueUsernameFromName(name string) string {
	base := strings.TrimSpace(name)
	if base == "" {
		base = "user"
	}

	username := base
	for suffix := 1; ; suffix += 1 {
		var count int
		_ = db.QueryRow("SELECT COUNT(*) FROM users WHERE username = ?", username).Scan(&count)
		if count == 0 {
			return username
		}
		username = fmt.Sprintf("%s %d", base, suffix)
	}
}

func getArticlesHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w, r)
	if r.Method != http.MethodGet {
		respondError(w, "method not allowed", 405)
		return
	}
	admin := strings.HasPrefix(r.URL.Path, "/api/admin/")
	query := articleSelect
	if !admin {
		query += " WHERE ap.published=1"
	} else {
		query += " WHERE COALESCE(ap.published,0)>=0"
	}
	rows, err := db.Query(query + " ORDER BY a.id")
	if err != nil {
		respondError(w, "db error", 500)
		return
	}
	defer rows.Close()
	items := []Article{}
	for rows.Next() {
		a, err := scanArticle(rows)
		if err != nil {
			respondError(w, "db error", 500)
			return
		}
		if !admin {
			hideArticleAnswers(&a)
		}
		items = append(items, a)
	}
	if rows.Err() != nil {
		respondError(w, "db error", 500)
		return
	}
	respondJSON(w, items, 200)
}

func getArticleHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w, r)
	if r.Method != http.MethodGet {
		respondError(w, "method not allowed", 405)
		return
	}
	id, err := strconv.Atoi(strings.TrimPrefix(r.URL.Path, "/api/articles/"))
	if err != nil {
		respondError(w, "invalid id", 400)
		return
	}
	a, err := scanArticle(db.QueryRow(articleSelect+" WHERE a.id=? AND ap.published=1", id))
	if err != nil {
		respondError(w, "not found", 404)
		return
	}
	hideArticleAnswers(&a)
	respondJSON(w, a, 200)
}

func saveResultHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w, r)
	if r.Method != http.MethodPost {
		respondError(w, "method not allowed", 405)
		return
	}
	var req struct {
		ArticleID int          `json:"article_id"`
		Version   string       `json:"version"`
		Answers   []DuelAnswer `json:"answers"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 131072)).Decode(&req) != nil {
		respondError(w, "invalid request", 400)
		return
	}
	var published int
	if db.QueryRow("SELECT COUNT(*) FROM atlas_places WHERE published=1 AND article_id=?", req.ArticleID).Scan(&published) != nil || published == 0 {
		respondError(w, "Статья не найдена", 404)
		return
	}
	saveVerifiedResult(w, r, req.ArticleID, req.Version, req.Answers)
}

func getMyResultsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w, r)
	claims := userFromContext(r.Context())

	rows, err := db.Query("SELECT id, user_id, article_id, score, max_score, created_at FROM results WHERE user_id = ?", claims.UserID)
	if err != nil {
		respondError(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	results := []Result{}
	for rows.Next() {
		var res Result
		rows.Scan(&res.ID, &res.UserID, &res.ArticleID, &res.Score, &res.MaxScore, &res.CreatedAt)
		results = append(results, res)
	}

	respondJSON(w, results, http.StatusOK)
}

func getProgressHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w, r)
	claims := userFromContext(r.Context())

	var points, total, completed int
	db.QueryRow("SELECT points FROM users WHERE id = ?", claims.UserID).Scan(&points)
	db.QueryRow("SELECT COUNT(*) FROM atlas_places").Scan(&total)
	db.QueryRow("SELECT COUNT(*) FROM results WHERE user_id = ?", claims.UserID).Scan(&completed)

	respondJSON(w, map[string]interface{}{
		"points":    points,
		"total":     total,
		"completed": completed,
	}, http.StatusOK)
}

func recalcPoints(userID int) {
	var total int
	db.QueryRow(`SELECT MAX(0,
		COALESCE((SELECT SUM(CASE WHEN ap.slug IS NOT NULL THEN ap.points * r.score / r.max_score
			ELSE r.score * 10 + CASE WHEN r.score = r.max_score THEN 20 WHEN r.score >= r.max_score * 0.7 THEN 10 ELSE 0 END END)
			FROM results r LEFT JOIN atlas_places ap ON ap.article_id = r.article_id WHERE r.user_id = ?), 0)
		+ COALESCE((SELECT COUNT(*) * 40 FROM duels WHERE winner_id = ? AND status = 'completed'), 0)
		+ COALESCE((SELECT SUM(reward_points) FROM team_battle_participants WHERE user_id = ?), 0)
		- COALESCE((SELECT SUM(ri.cost) FROM user_rewards ur JOIN reward_items ri ON ri.id = ur.reward_id WHERE ur.user_id = ?), 0))`, userID, userID, userID, userID).Scan(&total)
	db.Exec("UPDATE users SET points = ? WHERE id = ?", total, userID)
}

func getLeaderboardHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w, r)
	period := r.URL.Query().Get("period")
	modifier := ""
	switch period {
	case "", "all":
	case "week", "month":
		modifier = "-7 days"
		if period == "month" {
			modifier = "-30 days"
		}
	default:
		respondError(w, "period must be week, month or all", http.StatusBadRequest)
		return
	}
	quizTime, duelTime, battleTime := "", "", ""
	args := []interface{}{}
	if modifier != "" {
		quizTime = " AND r.created_at >= datetime('now', ?)"
		duelTime = " AND d.updated_at >= datetime('now', ?)"
		battleTime = " AND p.updated_at >= datetime('now', ?)"
		args = []interface{}{modifier, modifier, modifier}
	}
	query := `WITH quizzes AS (
		SELECT r.user_id, COUNT(*) AS completed_count, SUM(r.score) AS correct_count,
			SUM(CASE WHEN ap.slug IS NOT NULL THEN ap.points * r.score / r.max_score
				ELSE r.score * 10 + CASE WHEN r.score = r.max_score THEN 20 WHEN r.score >= r.max_score * 0.7 THEN 10 ELSE 0 END END) AS points
		FROM results r LEFT JOIN atlas_places ap ON ap.article_id = r.article_id
		WHERE 1=1` + quizTime + ` GROUP BY r.user_id
	), duels_won AS (
		SELECT d.winner_id AS user_id, COUNT(*) * 40 AS points FROM duels d
		WHERE d.status = 'completed' AND d.winner_id IS NOT NULL` + duelTime + ` GROUP BY d.winner_id
	), team_rewards AS (
		SELECT p.user_id, SUM(p.reward_points) AS points FROM team_battle_participants p
		WHERE p.reward_points > 0` + battleTime + ` GROUP BY p.user_id
	)
	SELECT u.username, COALESCE(NULLIF(u.name, ''), u.username),
		COALESCE(q.points, 0) + COALESCE(d.points, 0) + COALESCE(t.points, 0) AS earned,
		COALESCE(q.completed_count, 0), COALESCE(q.correct_count, 0)
	FROM users u LEFT JOIN quizzes q ON q.user_id = u.id
	LEFT JOIN duels_won d ON d.user_id = u.id
	LEFT JOIN team_rewards t ON t.user_id = u.id
	ORDER BY earned DESC, correct_count DESC, u.username ASC LIMIT 50`
	rows, err := db.Query(query, args...)
	if err != nil {
		respondError(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	entries := []LeaderboardEntry{}
	for rows.Next() {
		var e LeaderboardEntry
		if err := rows.Scan(&e.Username, &e.Name, &e.Points, &e.CompletedCount, &e.CorrectCount); err != nil {
			continue
		}
		entries = append(entries, e)
	}

	respondJSON(w, entries, http.StatusOK)
}

// getPeopleHandler exposes only the public fields needed to start a chat or duel.
func getPeopleHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w, r)
	if r.Method != http.MethodGet {
		respondError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	claims := userFromContext(r.Context())
	rows, err := db.Query(`
		SELECT id, username, COALESCE(name, username), points
		FROM users WHERE id != ? AND role = 'user'
		ORDER BY points DESC, username ASC LIMIT 100
	`, claims.UserID)
	if err != nil {
		respondError(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	people := []map[string]interface{}{}
	for rows.Next() {
		var id, points int
		var username, name string
		if err := rows.Scan(&id, &username, &name, &points); err != nil {
			continue
		}
		people = append(people, map[string]interface{}{
			"id": id, "username": username, "name": name, "points": points,
		})
	}
	respondJSON(w, people, http.StatusOK)
}

func getConversationsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w, r)
	claims := userFromContext(r.Context())

	rows, err := db.Query(`
		SELECT u.username, COALESCE(NULLIF(u.name, ''), u.username), u.points,
			COALESCE((
				SELECT m.text
				FROM messages m
				WHERE (m.sender_id = ? AND m.receiver_id = u.id)
					OR (m.sender_id = u.id AND m.receiver_id = ?)
				ORDER BY m.created_at DESC, m.id DESC
				LIMIT 1
			), '') AS last_message,
			COALESCE((
				SELECT m.created_at
				FROM messages m
				WHERE (m.sender_id = ? AND m.receiver_id = u.id)
					OR (m.sender_id = u.id AND m.receiver_id = ?)
				ORDER BY m.created_at DESC, m.id DESC
				LIMIT 1
			), '') AS last_at,
			(
				SELECT COUNT(*)
				FROM messages m
				WHERE m.sender_id = u.id AND m.receiver_id = ? AND m.is_read = 0
			) AS unread_count
		FROM users u
		WHERE u.id != ? AND u.role = 'user'
		ORDER BY unread_count DESC, last_at DESC, u.points DESC, u.username ASC
	`, claims.UserID, claims.UserID, claims.UserID, claims.UserID, claims.UserID, claims.UserID)
	if err != nil {
		respondError(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	conversations := []ChatConversation{}
	for rows.Next() {
		var item ChatConversation
		if err := rows.Scan(&item.Username, &item.Name, &item.Points, &item.LastMessage, &item.LastAt, &item.UnreadCount); err != nil {
			continue
		}
		conversations = append(conversations, item)
	}

	respondJSON(w, conversations, http.StatusOK)
}

func chatMessagesHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w, r)

	switch r.Method {
	case http.MethodGet:
		getChatMessagesHandler(w, r)
	case http.MethodPost:
		sendChatMessageHandler(w, r)
	default:
		respondError(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func getChatMessagesHandler(w http.ResponseWriter, r *http.Request) {
	claims := userFromContext(r.Context())
	peerName := strings.TrimSpace(r.URL.Query().Get("peer"))
	if peerName == "" {
		respondError(w, "peer required", http.StatusBadRequest)
		return
	}

	peerID, ok := findUserIDByUsername(peerName)
	if !ok {
		respondError(w, "user not found", http.StatusNotFound)
		return
	}

	db.Exec("UPDATE messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ?", peerID, claims.UserID)

	rows, err := db.Query(`
		SELECT m.id, su.username, COALESCE(NULLIF(su.name, ''), su.username),
			ru.username, COALESCE(NULLIF(ru.name, ''), ru.username), m.text, m.is_read, m.created_at
		FROM messages m
		JOIN users su ON su.id = m.sender_id
		JOIN users ru ON ru.id = m.receiver_id
		WHERE (m.sender_id = ? AND m.receiver_id = ?)
			OR (m.sender_id = ? AND m.receiver_id = ?)
		ORDER BY m.created_at ASC, m.id ASC
	`, claims.UserID, peerID, peerID, claims.UserID)
	if err != nil {
		respondError(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	messages := []ChatMessage{}
	for rows.Next() {
		var msg ChatMessage
		var readInt int
		if err := rows.Scan(&msg.ID, &msg.Sender, &msg.SenderName, &msg.Receiver, &msg.ReceiverName, &msg.Text, &readInt, &msg.CreatedAt); err != nil {
			continue
		}
		msg.IsRead = readInt == 1
		messages = append(messages, msg)
	}

	respondJSON(w, messages, http.StatusOK)
}

func sendChatMessageHandler(w http.ResponseWriter, r *http.Request) {
	claims := userFromContext(r.Context())

	var req SendMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, "invalid request", http.StatusBadRequest)
		return
	}

	req.To = strings.TrimSpace(req.To)
	req.Text = strings.TrimSpace(req.Text)
	if req.To == "" || req.Text == "" {
		respondError(w, "recipient and text required", http.StatusBadRequest)
		return
	}
	if len(req.Text) > 1000 {
		respondError(w, "message is too long", http.StatusBadRequest)
		return
	}

	receiverID, ok := findUserIDByUsername(req.To)
	if !ok {
		respondError(w, "user not found", http.StatusNotFound)
		return
	}
	if receiverID == claims.UserID {
		respondError(w, "cannot message yourself", http.StatusBadRequest)
		return
	}

	res, err := db.Exec("INSERT INTO messages (sender_id, receiver_id, text) VALUES (?, ?, ?)", claims.UserID, receiverID, req.Text)
	if err != nil {
		respondError(w, "db error", http.StatusInternalServerError)
		return
	}

	id, _ := res.LastInsertId()
	respondJSON(w, map[string]interface{}{"id": id, "status": "sent"}, http.StatusCreated)
}

func getUnreadCountHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w, r)
	claims := userFromContext(r.Context())

	var count int
	db.QueryRow("SELECT COUNT(*) FROM messages WHERE receiver_id = ? AND is_read = 0", claims.UserID).Scan(&count)
	respondJSON(w, UnreadResponse{UnreadCount: count}, http.StatusOK)
}

func findUserIDByUsername(username string) (int, bool) {
	var id int
	err := db.QueryRow("SELECT id FROM users WHERE username = ?", username).Scan(&id)
	if err != nil {
		if err == sql.ErrNoRows {
			return 0, false
		}
		return 0, false
	}
	return id, true
}

func findDuelOpponentID(identifier string, currentUserID int) (int, bool) {
	identifier = strings.TrimSpace(identifier)
	if identifier == "" {
		return 0, false
	}

	var id int
	err := db.QueryRow(`
		SELECT id
		FROM users
		WHERE lower(username) = lower(?) OR lower(name) = lower(?)
		ORDER BY
			CASE WHEN id = ? THEN 1 ELSE 0 END,
			CASE WHEN lower(username) = lower(?) THEN 0 ELSE 1 END,
			id
		LIMIT 1
	`, identifier, identifier, currentUserID, identifier).Scan(&id)
	if err != nil {
		return 0, false
	}
	return id, true
}

func duelsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w, r)

	switch r.Method {
	case http.MethodGet:
		getDuelsHandler(w, r)
	case http.MethodPost:
		createDuelHandler(w, r)
	default:
		respondError(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func getDuelsHandler(w http.ResponseWriter, r *http.Request) {
	claims := userFromContext(r.Context())
	rows, err := db.Query(`
		SELECT d.id, d.challenger_id, cu.username, COALESCE(NULLIF(cu.name, ''), cu.username),
			d.opponent_id, ou.username, COALESCE(NULLIF(ou.name, ''), ou.username),
			d.status, d.question_set, d.questions, d.challenger_score, d.opponent_score,
			COALESCE(d.winner_id, 0), COALESCE(wu.username, ''), COALESCE(NULLIF(wu.name, ''), wu.username, ''),
			d.created_at, d.updated_at
		FROM duels d
		JOIN users cu ON cu.id = d.challenger_id
		JOIN users ou ON ou.id = d.opponent_id
		LEFT JOIN users wu ON wu.id = d.winner_id
		WHERE d.challenger_id = ? OR d.opponent_id = ?
		ORDER BY d.updated_at DESC, d.id DESC
		LIMIT 30
	`, claims.UserID, claims.UserID)
	if err != nil {
		respondError(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	duels := []Duel{}
	for rows.Next() {
		duel, ok := scanDuel(rows)
		if ok {
			duels = append(duels, duel)
		}
	}
	respondJSON(w, duels, http.StatusOK)
}

func createDuelHandler(w http.ResponseWriter, r *http.Request) {
	claims := userFromContext(r.Context())

	var req DuelCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, "invalid request", http.StatusBadRequest)
		return
	}

	opponentName := strings.TrimSpace(req.Opponent)
	opponentID, ok := findDuelOpponentID(opponentName, claims.UserID)
	if !ok {
		respondError(w, "user not found", http.StatusNotFound)
		return
	}
	if opponentID == claims.UserID {
		respondError(w, "cannot duel yourself", http.StatusBadRequest)
		return
	}

	setIndex := int(time.Now().UnixNano() % 5)

	questions, err := buildDuelQuestions(10)
	if err != nil {
		respondError(w, "not enough questions", http.StatusInternalServerError)
		return
	}
	questionsJSON, _ := json.Marshal(questions)

	res, err := db.Exec(`
		INSERT INTO duels (challenger_id, opponent_id, question_set, questions)
		VALUES (?, ?, ?, ?)
	`, claims.UserID, opponentID, setIndex, string(questionsJSON))
	if err != nil {
		respondError(w, "db error", http.StatusInternalServerError)
		return
	}

	duelID, _ := res.LastInsertId()
	db.Exec(
		"INSERT INTO messages (sender_id, receiver_id, text) VALUES (?, ?, ?)",
		claims.UserID,
		opponentID,
		fmt.Sprintf("Бросил вызов на культурную дуэль #%d. Открой вкладку «Батлы», чтобы принять.", duelID),
	)

	respondJSON(w, map[string]interface{}{"id": duelID, "status": "pending"}, http.StatusCreated)
}

func duelActionHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w, r)
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/duels/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		respondError(w, "duel id required", http.StatusBadRequest)
		return
	}

	duelID, err := strconv.Atoi(parts[0])
	if err != nil {
		respondError(w, "invalid duel id", http.StatusBadRequest)
		return
	}

	if r.Method == http.MethodGet && len(parts) == 1 {
		getDuelHandler(w, r, duelID)
		return
	}
	if r.Method == http.MethodPost && len(parts) == 2 {
		switch parts[1] {
		case "accept":
			acceptDuelHandler(w, r, duelID)
		case "decline":
			declineDuelHandler(w, r, duelID)
		case "finish":
			finishDuelHandler(w, r, duelID)
		default:
			respondError(w, "unknown duel action", http.StatusNotFound)
		}
		return
	}

	respondError(w, "method not allowed", http.StatusMethodNotAllowed)
}

func getDuelHandler(w http.ResponseWriter, r *http.Request, duelID int) {
	claims := userFromContext(r.Context())
	duel, ok := getDuelForUser(duelID, claims.UserID)
	if !ok {
		respondError(w, "duel not found", http.StatusNotFound)
		return
	}
	respondJSON(w, duel, http.StatusOK)
}

func acceptDuelHandler(w http.ResponseWriter, r *http.Request, duelID int) {
	claims := userFromContext(r.Context())
	res, err := db.Exec(`
		UPDATE duels
		SET status = 'active', updated_at = CURRENT_TIMESTAMP
		WHERE id = ? AND opponent_id = ? AND status = 'pending'
	`, duelID, claims.UserID)
	if err != nil {
		respondError(w, "db error", http.StatusInternalServerError)
		return
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		respondError(w, "duel cannot be accepted", http.StatusBadRequest)
		return
	}
	respondJSON(w, map[string]string{"status": "active"}, http.StatusOK)
}

func updateDuelStatusHandler(w http.ResponseWriter, r *http.Request, duelID int, status string) {
	claims := userFromContext(r.Context())
	res, err := db.Exec(`
		UPDATE duels
		SET status = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ? AND opponent_id = ? AND status = 'pending'
	`, status, duelID, claims.UserID)
	if err != nil {
		respondError(w, "db error", http.StatusInternalServerError)
		return
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		respondError(w, "duel cannot be updated", http.StatusBadRequest)
		return
	}
	respondJSON(w, map[string]string{"status": status}, http.StatusOK)
}

func declineDuelHandler(w http.ResponseWriter, r *http.Request, duelID int) {
	claims := userFromContext(r.Context())

	tx, err := db.Begin()
	if err != nil {
		respondError(w, "db error", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	var challengerID int
	err = tx.QueryRow(`
		SELECT challenger_id
		FROM duels
		WHERE id = ? AND opponent_id = ? AND status = 'pending'
	`, duelID, claims.UserID).Scan(&challengerID)
	if err != nil {
		if err == sql.ErrNoRows {
			respondError(w, "duel cannot be updated", http.StatusBadRequest)
			return
		}
		respondError(w, "db error", http.StatusInternalServerError)
		return
	}

	res, err := tx.Exec(`
		UPDATE duels
		SET status = 'declined', updated_at = CURRENT_TIMESTAMP
		WHERE id = ? AND opponent_id = ? AND status = 'pending'
	`, duelID, claims.UserID)
	if err != nil {
		respondError(w, "db error", http.StatusInternalServerError)
		return
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		respondError(w, "duel cannot be updated", http.StatusBadRequest)
		return
	}

	_, err = tx.Exec(
		"INSERT INTO messages (sender_id, receiver_id, text) VALUES (?, ?, ?)",
		claims.UserID,
		challengerID,
		fmt.Sprintf("%s отклонил твой вызов на культурную дуэль #%d.", claims.Username, duelID),
	)
	if err != nil {
		respondError(w, "db error", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(); err != nil {
		respondError(w, "db error", http.StatusInternalServerError)
		return
	}

	respondJSON(w, map[string]string{"status": "declined"}, http.StatusOK)
}

func finishDuelHandler(w http.ResponseWriter, r *http.Request, duelID int) {
	claims := userFromContext(r.Context())
	duel, ok := getDuelForUser(duelID, claims.UserID)
	if !ok || duel.Status != "active" {
		respondError(w, "duel not active", http.StatusBadRequest)
		return
	}

	var req DuelFinishRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, "invalid request", http.StatusBadRequest)
		return
	}

	score := scoreDuelAnswers(duel.Questions, req.Answers)
	var query string
	if claims.UserID == duel.ChallengerID {
		query = "UPDATE duels SET challenger_score = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND challenger_score = -1"
	} else {
		query = "UPDATE duels SET opponent_score = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND opponent_score = -1"
	}
	res, err := db.Exec(query, score, duelID)
	if err != nil {
		respondError(w, "db error", http.StatusInternalServerError)
		return
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		respondError(w, "duel already finished by you", http.StatusBadRequest)
		return
	}

	finalizeDuelIfReady(duelID)
	nextDuel, _ := getDuelForUser(duelID, claims.UserID)
	respondJSON(w, nextDuel, http.StatusOK)
}

func getDuelForUser(duelID int, userID int) (Duel, bool) {
	row := db.QueryRow(`
		SELECT d.id, d.challenger_id, cu.username, COALESCE(NULLIF(cu.name, ''), cu.username),
			d.opponent_id, ou.username, COALESCE(NULLIF(ou.name, ''), ou.username),
			d.status, d.question_set, d.questions, d.challenger_score, d.opponent_score,
			COALESCE(d.winner_id, 0), COALESCE(wu.username, ''), COALESCE(NULLIF(wu.name, ''), wu.username, ''),
			d.created_at, d.updated_at
		FROM duels d
		JOIN users cu ON cu.id = d.challenger_id
		JOIN users ou ON ou.id = d.opponent_id
		LEFT JOIN users wu ON wu.id = d.winner_id
		WHERE d.id = ? AND (d.challenger_id = ? OR d.opponent_id = ?)
	`, duelID, userID, userID)

	duel, ok := scanDuel(row)
	return duel, ok
}

type duelScanner interface {
	Scan(dest ...interface{}) error
}

func scanDuel(scanner duelScanner) (Duel, bool) {
	var duel Duel
	var questionsRaw string
	err := scanner.Scan(
		&duel.ID,
		&duel.ChallengerID,
		&duel.Challenger,
		&duel.ChallengerName,
		&duel.OpponentID,
		&duel.Opponent,
		&duel.OpponentName,
		&duel.Status,
		&duel.QuestionSet,
		&questionsRaw,
		&duel.ChallengerScore,
		&duel.OpponentScore,
		&duel.WinnerID,
		&duel.Winner,
		&duel.WinnerName,
		&duel.CreatedAt,
		&duel.UpdatedAt,
	)
	if err != nil {
		return Duel{}, false
	}
	json.Unmarshal([]byte(questionsRaw), &duel.Questions)
	return duel, true
}

func buildDuelQuestions(count int) ([]DuelQuestion, error) {
	custom := loadBattleQuestions("duel", "all")
	rows, err := db.Query("SELECT category, category_label, questions FROM articles ORDER BY id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	allQuestions := []DuelQuestion{}
	for rows.Next() {
		var category, label, raw string
		if err := rows.Scan(&category, &label, &raw); err != nil {
			continue
		}
		var articleQuestions []DuelQuestion
		if err := json.Unmarshal([]byte(raw), &articleQuestions); err != nil {
			continue
		}
		for _, question := range articleQuestions {
			question.Category = category
			question.CategoryLabel = label
			allQuestions = append(allQuestions, question)
		}
	}

	if len(allQuestions)+len(custom) < count {
		return nil, fmt.Errorf("not enough questions")
	}

	random := rand.New(rand.NewSource(time.Now().UnixNano()))
	random.Shuffle(len(allQuestions), func(i, j int) {
		allQuestions[i], allQuestions[j] = allQuestions[j], allQuestions[i]
	})
	if len(custom) >= count {
		return custom[:count], nil
	}
	return append(custom, allQuestions[:count-len(custom)]...), nil
}

func scoreDuelAnswers(questions []DuelQuestion, answers []DuelAnswer) int {
	answerMap := map[int]DuelAnswer{}
	for _, answer := range answers {
		answerMap[answer.QuestionID] = answer
	}

	total := 0
	for _, question := range questions {
		answer, ok := answerMap[question.ID]
		if !ok {
			continue
		}
		if isDuelAnswerCorrect(question.Correct, answer.Selected) {
			timeLeft := answer.TimeLeft
			if timeLeft < 0 {
				timeLeft = 0
			}
			if timeLeft > 15 {
				timeLeft = 15
			}
			total += 100 + timeLeft*5
		}
	}
	return total
}

func isDuelAnswerCorrect(correct interface{}, selected []int) bool {
	switch value := correct.(type) {
	case int:
		return len(selected) == 1 && selected[0] == value
	case float64:
		return len(selected) == 1 && selected[0] == int(value)
	case []interface{}:
		correctList := []int{}
		for _, item := range value {
			if n, ok := item.(float64); ok {
				correctList = append(correctList, int(n))
			}
		}
		return reflect.DeepEqual(sortedInts(correctList), sortedInts(selected))
	default:
		return false
	}
}

func sortedInts(values []int) []int {
	next := append([]int{}, values...)
	for i := 0; i < len(next); i++ {
		for j := i + 1; j < len(next); j++ {
			if next[j] < next[i] {
				next[i], next[j] = next[j], next[i]
			}
		}
	}
	return next
}

func teamBattlesHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w, r)

	switch r.Method {
	case http.MethodGet:
		code := strings.TrimSpace(r.URL.Query().Get("code"))
		if code == "" {
			respondError(w, "code required", http.StatusBadRequest)
			return
		}
		respondTeamBattleByCode(w, code)
	case http.MethodPost:
		createTeamBattleHandler(w, r)
	default:
		respondError(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func teamBattleActionHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w, r)

	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/team-battles/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		respondError(w, "battle code required", http.StatusBadRequest)
		return
	}

	if parts[0] == "categories" && r.Method == http.MethodGet {
		getTeamBattleCategoriesHandler(w, r)
		return
	}

	if parts[0] == "check" && r.Method == http.MethodGet {
		checkTeamBattleCodeHandler(w, r)
		return
	}

	code := strings.TrimSpace(parts[0])
	if r.Method == http.MethodGet && len(parts) == 1 {
		respondTeamBattleByCode(w, code)
		return
	}

	if r.Method == http.MethodPost && len(parts) == 2 {
		switch parts[1] {
		case "join":
			joinTeamBattleHandler(w, r, code)
		case "start":
			startTeamBattleHandler(w, r, code)
		case "finish":
			finishTeamBattleHandler(w, r, code)
		default:
			respondError(w, "unknown team battle action", http.StatusNotFound)
		}
		return
	}

	respondError(w, "method not allowed", http.StatusMethodNotAllowed)
}

func getTeamBattleCategoriesHandler(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(`
		SELECT category, MIN(category_label)
		FROM articles
		GROUP BY category
		ORDER BY MIN(category_label)
	`)
	if err != nil {
		respondError(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	categories := []TeamBattleCategory{}
	for rows.Next() {
		var item TeamBattleCategory
		if err := rows.Scan(&item.Category, &item.CategoryLabel); err == nil {
			item.QuestionCount = countQuestionsForCategory(item.Category)
			categories = append(categories, item)
		}
	}
	customRows, err := db.Query("SELECT category, MIN(category_label) FROM battle_questions WHERE mode IN ('team','both') GROUP BY category")
	if err == nil {
		for customRows.Next() {
			var category, label string
			if customRows.Scan(&category, &label) == nil {
				found := false
				for _, item := range categories {
					if item.Category == category {
						found = true
						break
					}
				}
				if !found {
					categories = append(categories, TeamBattleCategory{Category: category, CategoryLabel: label, QuestionCount: countQuestionsForCategory(category)})
				}
			}
		}
		customRows.Close()
	}
	respondJSON(w, categories, http.StatusOK)
}

func checkTeamBattleCodeHandler(w http.ResponseWriter, r *http.Request) {
	code := strings.TrimSpace(r.URL.Query().Get("code"))
	if !isSixDigitCode(code) {
		respondError(w, "code must contain exactly 6 digits", http.StatusBadRequest)
		return
	}

	_, exists := findTeamBattleIDByCode(code)
	respondJSON(w, map[string]interface{}{
		"code":      code,
		"available": !exists,
	}, http.StatusOK)
}

func createTeamBattleHandler(w http.ResponseWriter, r *http.Request) {
	claims := userFromContext(r.Context())

	var req TeamBattleCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, "invalid request", http.StatusBadRequest)
		return
	}

	code := strings.TrimSpace(req.Code)
	if !isSixDigitCode(code) {
		respondError(w, "code must contain exactly 6 digits", http.StatusBadRequest)
		return
	}

	questionCount := req.QuestionCount
	if questionCount < 5 || questionCount > 30 {
		respondError(w, "question count must be from 5 to 30", http.StatusBadRequest)
		return
	}
	if req.TimeSeconds == 0 {
		req.TimeSeconds = 20
	}
	if req.TimeSeconds != 15 && req.TimeSeconds != 20 && req.TimeSeconds != 30 && req.TimeSeconds != 60 {
		respondError(w, "time per question must be 15, 20, 30 or 60 seconds", http.StatusBadRequest)
		return
	}

	categoryLabel, ok := findTeamBattleCategoryLabel(req.Category)
	if req.Category == "all" {
		categoryLabel, ok = "Все темы", true
	}
	if !ok {
		respondError(w, "category not found", http.StatusNotFound)
		return
	}

	questions, err := buildTeamBattleQuestions(req.Category, questionCount)
	if err != nil {
		respondError(w, "not enough questions for category", http.StatusInternalServerError)
		return
	}
	questionsJSON, _ := json.Marshal(questions)

	tx, err := db.Begin()
	if err != nil {
		respondError(w, "db error", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	res, err := tx.Exec(`
		INSERT INTO team_battles (code, creator_id, category, category_label, questions, time_seconds)
		VALUES (?, ?, ?, ?, ?, ?)
	`, code, claims.UserID, req.Category, categoryLabel, string(questionsJSON), req.TimeSeconds)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") || strings.Contains(err.Error(), "constraint") {
			respondError(w, "code already exists", http.StatusConflict)
			return
		}
		respondError(w, "db error", http.StatusInternalServerError)
		return
	}

	battleID, _ := res.LastInsertId()
	_, err = tx.Exec(`
		INSERT INTO team_battle_participants (battle_id, user_id)
		VALUES (?, ?)
	`, battleID, claims.UserID)
	if err != nil {
		respondError(w, "db error", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(); err != nil {
		respondError(w, "db error", http.StatusInternalServerError)
		return
	}

	respondTeamBattleByCode(w, code)
}

func joinTeamBattleHandler(w http.ResponseWriter, r *http.Request, code string) {
	claims := userFromContext(r.Context())
	battleID, ok := findTeamBattleIDByCode(code)
	if !ok {
		respondError(w, "team battle not found", http.StatusNotFound)
		return
	}

	_, err := db.Exec(`
		INSERT OR IGNORE INTO team_battle_participants (battle_id, user_id)
		VALUES (?, ?)
	`, battleID, claims.UserID)
	if err != nil {
		respondError(w, "db error", http.StatusInternalServerError)
		return
	}

	respondTeamBattleByCode(w, code)
}

func startTeamBattleHandler(w http.ResponseWriter, r *http.Request, code string) {
	claims := userFromContext(r.Context())

	res, err := db.Exec(`
		UPDATE team_battles
		SET started = 1, updated_at = CURRENT_TIMESTAMP
		WHERE code = ? AND creator_id = ?
	`, code, claims.UserID)
	if err != nil {
		respondError(w, "db error", http.StatusInternalServerError)
		return
	}

	affected, _ := res.RowsAffected()
	if affected == 0 {
		if _, ok := findTeamBattleIDByCode(code); !ok {
			respondError(w, "team battle not found", http.StatusNotFound)
			return
		}
		respondError(w, "only creator can start team battle", http.StatusForbidden)
		return
	}

	respondTeamBattleByCode(w, code)
}

func finishTeamBattleHandler(w http.ResponseWriter, r *http.Request, code string) {
	claims := userFromContext(r.Context())
	battle, ok := getTeamBattleByCode(code)
	if !ok {
		respondError(w, "team battle not found", http.StatusNotFound)
		return
	}
	if !battle.Started {
		respondError(w, "team battle has not started", http.StatusConflict)
		return
	}

	var req DuelFinishRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, "invalid request", http.StatusBadRequest)
		return
	}

	score := scoreTeamBattleAnswers(battle.Questions, req.Answers)
	result, err := db.Exec(`UPDATE team_battle_participants SET score = ?, updated_at = CURRENT_TIMESTAMP
		WHERE battle_id = ? AND user_id = ? AND score = -1`, score, battle.ID, claims.UserID)
	if err != nil {
		respondError(w, "db error", http.StatusInternalServerError)
		return
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		respondError(w, "join the battle before playing, or your result is already saved", http.StatusConflict)
		return
	}

	awardTeamBattlePoints(battle.ID)
	respondTeamBattleByCode(w, code)
}

func respondTeamBattleByCode(w http.ResponseWriter, code string) {
	battle, ok := getTeamBattleByCode(code)
	if !ok {
		respondError(w, "team battle not found", http.StatusNotFound)
		return
	}
	respondJSON(w, battle, http.StatusOK)
}

func getTeamBattleByCode(code string) (TeamBattle, bool) {
	row := db.QueryRow(`
		SELECT tb.id, tb.code, u.username, tb.category, tb.category_label,
		tb.questions, tb.started, tb.time_seconds, tb.created_at, tb.updated_at
		FROM team_battles tb
		JOIN users u ON u.id = tb.creator_id
		WHERE tb.code = ?
	`, code)

	var battle TeamBattle
	var questionsRaw string
	var started int
	err := row.Scan(
		&battle.ID,
		&battle.Code,
		&battle.Creator,
		&battle.Category,
		&battle.CategoryLabel,
		&questionsRaw,
		&started,
		&battle.TimeSeconds,
		&battle.CreatedAt,
		&battle.UpdatedAt,
	)
	if err != nil {
		return TeamBattle{}, false
	}

	json.Unmarshal([]byte(questionsRaw), &battle.Questions)
	battle.Started = started == 1
	battle.Participants = getTeamBattleParticipants(battle.ID)
	return battle, true
}

func getTeamBattleParticipants(battleID int) []TeamBattleParticipant {
	rows, err := db.Query(`
		SELECT u.username, COALESCE(NULLIF(u.name, ''), u.username), tbp.score, tbp.reward_points, tbp.updated_at
		FROM team_battle_participants tbp
		JOIN users u ON u.id = tbp.user_id
		WHERE tbp.battle_id = ?
		ORDER BY tbp.score DESC, tbp.updated_at ASC
	`, battleID)
	if err != nil {
		return []TeamBattleParticipant{}
	}
	defer rows.Close()

	participants := []TeamBattleParticipant{}
	for rows.Next() {
		var item TeamBattleParticipant
		if err := rows.Scan(&item.Username, &item.Name, &item.Score, &item.RewardPoints, &item.UpdatedAt); err == nil {
			item.Completed = item.Score >= 0
			participants = append(participants, item)
		}
	}
	return participants
}

func findTeamBattleIDByCode(code string) (int, bool) {
	var id int
	err := db.QueryRow("SELECT id FROM team_battles WHERE code = ?", code).Scan(&id)
	return id, err == nil
}

func findTeamBattleCategoryLabel(category string) (string, bool) {
	var label string
	err := db.QueryRow(`
		SELECT category_label
		FROM articles
		WHERE category = ?
		ORDER BY id
		LIMIT 1
	`, category).Scan(&label)
	if err == nil {
		return label, true
	}
	err = db.QueryRow("SELECT category_label FROM battle_questions WHERE category=? AND mode IN ('team','both') LIMIT 1", category).Scan(&label)
	return label, err == nil
}

func buildTeamBattleQuestions(category string, count int) ([]DuelQuestion, error) {
	custom := loadBattleQuestions("team", category)
	rows, err := db.Query(`
		SELECT category, category_label, questions
		FROM articles
		WHERE (? = 'all' OR category = ?)
		ORDER BY id
	`, category, category)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	questions := []DuelQuestion{}
	seen := map[int]bool{}
	for rows.Next() {
		var itemCategory, label, raw string
		if err := rows.Scan(&itemCategory, &label, &raw); err != nil {
			continue
		}
		var articleQuestions []DuelQuestion
		if err := json.Unmarshal([]byte(raw), &articleQuestions); err != nil {
			continue
		}
		for _, question := range articleQuestions {
			if seen[question.ID] {
				continue
			}
			question.Category = itemCategory
			question.CategoryLabel = label
			questions = append(questions, question)
			seen[question.ID] = true
		}
	}

	if len(questions)+len(custom) < count {
		return nil, fmt.Errorf("not enough questions for category")
	}

	rand.Shuffle(len(questions), func(i, j int) { questions[i], questions[j] = questions[j], questions[i] })
	selected := make([]DuelQuestion, 0, count)
	for i := 0; i < len(custom) && i < count; i++ {
		selected = append(selected, custom[i])
	}
	for i := 0; len(selected) < count; i++ {
		selected = append(selected, questions[i])
	}
	return selected, nil
}

func scoreTeamBattleAnswers(questions []DuelQuestion, answers []DuelAnswer) int {
	answerMap := map[int]DuelAnswer{}
	for _, answer := range answers {
		answerMap[answer.QuestionID] = answer
	}

	total := 0
	for _, question := range questions {
		answer, ok := answerMap[question.ID]
		if ok && isDuelAnswerCorrect(question.Correct, answer.Selected) {
			total += 100
		}
	}
	return total
}

func awardTeamBattlePoints(battleID int) {
	rows, err := db.Query(`
		SELECT tbp.user_id, tbp.reward_points
		FROM team_battle_participants tbp
		WHERE tbp.battle_id = ? AND tbp.score >= 0
		ORDER BY tbp.score DESC, tbp.updated_at ASC
	`, battleID)
	if err != nil {
		return
	}

	type rankedParticipant struct {
		UserID       int
		RewardPoints int
	}

	participants := []rankedParticipant{}
	for rows.Next() {
		var item rankedParticipant
		if err := rows.Scan(&item.UserID, &item.RewardPoints); err == nil {
			participants = append(participants, item)
		}
	}
	if err := rows.Close(); err != nil {
		return
	}

	rewards := []int{60, 40, 20}
	for index, participant := range participants {
		targetReward := 0
		if index < len(rewards) {
			targetReward = rewards[index]
		}
		delta := targetReward - participant.RewardPoints
		if delta == 0 {
			continue
		}

		_, err := db.Exec(`
			UPDATE team_battle_participants
			SET reward_points = ?
			WHERE battle_id = ? AND user_id = ?
		`, targetReward, battleID, participant.UserID)
		if err != nil {
			continue
		}
		recalcPoints(participant.UserID)
	}
}

func isSixDigitCode(code string) bool {
	if len(code) != 6 {
		return false
	}
	for _, char := range code {
		if char < '0' || char > '9' {
			return false
		}
	}
	return true
}

func finalizeDuelIfReady(duelID int) {
	var challengerID, opponentID, challengerScore, opponentScore int
	var status string
	err := db.QueryRow(`
		SELECT challenger_id, opponent_id, status, challenger_score, opponent_score
		FROM duels WHERE id = ?
	`, duelID).Scan(&challengerID, &opponentID, &status, &challengerScore, &opponentScore)
	if err != nil || status != "active" || challengerScore < 0 || opponentScore < 0 {
		return
	}

	winnerID := 0
	if challengerScore > opponentScore {
		winnerID = challengerID
	} else if opponentScore > challengerScore {
		winnerID = opponentID
	}

	var selectedWinner interface{}
	if winnerID > 0 {
		selectedWinner = winnerID
	}
	result, err := db.Exec(`UPDATE duels SET status = 'completed', winner_id = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ? AND status = 'active'`, selectedWinner, duelID)
	if err == nil {
		affected, _ := result.RowsAffected()
		if affected == 1 && winnerID > 0 {
			recalcPoints(winnerID)
		}
	}
}
