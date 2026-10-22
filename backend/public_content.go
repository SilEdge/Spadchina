package backend

import (
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

const articleSelect = `SELECT a.id,a.title,a.category,a.category_label,a.difficulty,a.difficulty_label,a.read_time,a.image,a.content,a.questions,
 COALESCE(ap.slug,''),COALESCE(ap.region,''),COALESCE(ap.era,''),COALESCE(ap.points,120),ap.latitude,ap.longitude,COALESCE(ap.map_label,''),CASE WHEN ap.published=1 THEN 1 ELSE 0 END
 FROM articles a LEFT JOIN atlas_places ap ON ap.article_id=a.id`

func scanArticle(row interface{ Scan(...interface{}) error }) (Article, error) {
	var a Article
	err := row.Scan(&a.ID, &a.Title, &a.Category, &a.CategoryLabel, &a.Difficulty, &a.DifficultyLabel, &a.ReadTime, &a.Image, &a.Content, &a.Questions,
		&a.Slug, &a.Region, &a.Era, &a.Points, &a.Latitude, &a.Longitude, &a.MapLabel, &a.Published)
	return a, err
}

func hideArticleAnswers(a *Article) {
	a.Content = publicArticleContent(a.Content)
	var questions []DuelQuestion
	if json.Unmarshal([]byte(a.Questions), &questions) == nil {
		for i := range questions {
			questions[i].Multiple = len(correctIndices(questions[i].Correct)) > 1
			questions[i].Correct = nil
			questions[i].Explanation = ""
		}
		raw, _ := json.Marshal(questions)
		a.Questions = string(raw)
	}
}

func isVisualCredit(blockType, text string) bool {
	text = strings.TrimSpace(text)
	return blockType == "credit" || strings.HasPrefix(text, "Фото:") || strings.HasPrefix(text, "Иллюстрация создана с помощью ИИ")
}

func publicArticleContent(raw string) string {
	var blocks []map[string]interface{}
	if json.Unmarshal([]byte(raw), &blocks) != nil {
		return raw
	}
	visible := make([]map[string]interface{}, 0, len(blocks))
	for _, block := range blocks {
		blockType, _ := block["type"].(string)
		text, _ := block["text"].(string)
		if !isVisualCredit(blockType, text) {
			visible = append(visible, block)
		}
	}
	encoded, err := json.Marshal(visible)
	if err != nil {
		return raw
	}
	return string(encoded)
}

func publicBattleQuestions(questions []DuelQuestion) []DuelQuestion {
	public := append([]DuelQuestion{}, questions...)
	for i := range public {
		public[i].Multiple = len(correctIndices(public[i].Correct)) > 1
		public[i].Correct = nil
		public[i].Explanation = ""
	}
	return public
}

var slugPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

func validArticle(input *ArticleInput) bool {
	input.Title = strings.TrimSpace(input.Title)
	input.Region = strings.TrimSpace(input.Region)
	input.Era = strings.TrimSpace(input.Era)
	input.Slug = strings.TrimSpace(input.Slug)
	categories := map[string]bool{"history": true, "culture": true, "nature": true, "traditions": true, "architecture": true, "memory": true, "memorial": true}
	if input.Category == "memorial" {
		input.Category = "memory"
	}
	if input.Title == "" || len([]rune(input.Title)) > 200 || !categories[input.Category] || input.ReadTime < 1 || input.ReadTime > 120 {
		return false
	}
	if input.Difficulty != "easy" && input.Difficulty != "medium" && input.Difficulty != "hard" {
		return false
	}
	if input.Slug != "" && (!slugPattern.MatchString(input.Slug) || len(input.Slug) > 80) {
		return false
	}
	if input.Points < 0 || input.Points > 10000 {
		return false
	}
	if (input.Latitude == nil) != (input.Longitude == nil) {
		return false
	}
	if input.Latitude != nil && (*input.Latitude < -90 || *input.Latitude > 90 || *input.Longitude < -180 || *input.Longitude > 180) {
		return false
	}
	if input.Image != "" {
		parsed, err := url.Parse(input.Image)
		if err != nil || (parsed.Scheme != "" && parsed.Scheme != "https") || strings.HasPrefix(input.Image, "//") {
			return false
		}
	}
	var blocks []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if json.Unmarshal([]byte(input.Content), &blocks) != nil || len(blocks) == 0 {
		return false
	}
	for _, b := range blocks {
		if strings.TrimSpace(b.Text) == "" {
			return false
		}
	}
	var questions []DuelQuestion
	if json.Unmarshal([]byte(input.Questions), &questions) != nil || len(questions) == 0 || len(questions) > 100 {
		return false
	}
	seen := map[int]bool{}
	for _, q := range questions {
		if q.ID <= 0 || seen[q.ID] || strings.TrimSpace(q.Question) == "" || len(q.Options) < 2 || len(q.Options) > 6 {
			return false
		}
		seen[q.ID] = true
		for _, o := range q.Options {
			if strings.TrimSpace(o) == "" {
				return false
			}
		}
		indices := correctIndices(q.Correct)
		if len(indices) == 0 {
			return false
		}
		for _, i := range indices {
			if i < 0 || i >= len(q.Options) {
				return false
			}
		}
	}
	return true
}

func savePublication(tx *sql.Tx, id int64, input ArticleInput) error {
	if !input.Published {
		_, err := tx.Exec("UPDATE atlas_places SET published=0 WHERE article_id=?", id)
		return err
	}
	slug := input.Slug
	if slug == "" {
		slug = fmt.Sprintf("article-%d", id)
	}
	var blocks []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	_ = json.Unmarshal([]byte(input.Content), &blocks)
	lead := ""
	for _, block := range blocks {
		if !isVisualCredit(block.Type, block.Text) {
			lead = block.Text
			break
		}
	}
	_, err := tx.Exec(`INSERT INTO atlas_places(slug,article_id,region,era,lead,points,x,y,latitude,longitude,map_label,published)
 VALUES(?,?,?,?,?,?,50,50,?,?,?,1) ON CONFLICT(article_id) DO UPDATE SET region=excluded.region,era=excluded.era,lead=excluded.lead,
 points=excluded.points,latitude=excluded.latitude,longitude=excluded.longitude,map_label=excluded.map_label,published=1`,
		slug, id, input.Region, input.Era, lead, input.Points, input.Latitude, input.Longitude, input.MapLabel)
	return err
}

func quizVersion(raw string) string { return fmt.Sprintf("%x", sha256.Sum256([]byte(raw))) }
func correctIndices(correct interface{}) []int {
	switch v := correct.(type) {
	case float64:
		if v == float64(int(v)) {
			return []int{int(v)}
		}
	case int:
		return []int{v}
	case []interface{}:
		result := []int{}
		seen := map[int]bool{}
		for _, item := range v {
			n, ok := item.(float64)
			if !ok || n != float64(int(n)) || seen[int(n)] {
				return nil
			}
			seen[int(n)] = true
			result = append(result, int(n))
		}
		return result
	}
	return nil
}

func loadArticleQuiz(articleID int) ([]DuelQuestion, string, error) {
	var raw string
	if err := db.QueryRow("SELECT questions FROM articles WHERE id=?", articleID).Scan(&raw); err != nil {
		return nil, "", err
	}
	var q []DuelQuestion
	err := json.Unmarshal([]byte(raw), &q)
	return q, quizVersion(raw), err
}

func validSelections(q DuelQuestion, selected []int) bool {
	seen := map[int]bool{}
	for _, i := range selected {
		if i < 0 || i >= len(q.Options) || seen[i] {
			return false
		}
		seen[i] = true
	}
	return len(selected) <= len(q.Options)
}

func saveVerifiedResult(w http.ResponseWriter, r *http.Request, articleID int, version string, answers []DuelAnswer) {
	questions, currentVersion, err := loadArticleQuiz(articleID)
	if err != nil {
		respondError(w, "Статья не найдена", 404)
		return
	}
	if len(questions) == 0 || len(answers) != len(questions) {
		respondError(w, "Отправьте ответы на все вопросы", 400)
		return
	}
	if version != currentVersion {
		respondError(w, "Вопросы обновились. Откройте статью заново.", 409)
		return
	}
	byID := map[int]DuelQuestion{}
	for _, q := range questions {
		byID[q.ID] = q
	}
	seen := map[int]bool{}
	score := 0
	for _, a := range answers {
		q, ok := byID[a.QuestionID]
		if !ok || seen[a.QuestionID] || !validSelections(q, a.Selected) {
			respondError(w, "Некорректные ответы", 400)
			return
		}
		seen[a.QuestionID] = true
		if isDuelAnswerCorrect(q.Correct, a.Selected) {
			score++
		}
	}
	userID := userFromContext(r.Context()).UserID
	if _, err := db.Exec(`INSERT INTO results(user_id,article_id,score,max_score) VALUES(?,?,?,?)
 ON CONFLICT(user_id,article_id) DO UPDATE SET score=excluded.score,max_score=excluded.max_score,created_at=CURRENT_TIMESTAMP
 WHERE excluded.score*results.max_score>results.score*excluded.max_score`, userID, articleID, score, len(questions)); err != nil {
		respondError(w, "Не удалось сохранить результат", 500)
		return
	}
	recalcPoints(userID)
	var points int
	_ = db.QueryRow("SELECT points FROM users WHERE id=?", userID).Scan(&points)
	respondJSON(w, map[string]interface{}{"status": "ok", "score": score, "max_score": len(questions), "points": points}, 200)
}

func atlasCheckHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w, r)
	if r.Method != http.MethodPost {
		respondError(w, "method not allowed", 405)
		return
	}
	var req struct {
		Slug    string `json:"slug"`
		Version string `json:"version"`
		DuelAnswer
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16384)).Decode(&req) != nil {
		respondError(w, "invalid request", 400)
		return
	}
	var id int
	if db.QueryRow("SELECT article_id FROM atlas_places WHERE published=1 AND slug=?", req.Slug).Scan(&id) != nil {
		respondError(w, "Статья не найдена", 404)
		return
	}
	q, version, err := loadArticleQuiz(id)
	if err != nil {
		respondError(w, "Не удалось загрузить вопросы", 500)
		return
	}
	if req.Version != version {
		respondError(w, "Вопросы обновились. Откройте статью заново.", 409)
		return
	}
	for _, question := range q {
		if question.ID == req.QuestionID {
			if !validSelections(question, req.Selected) {
				respondError(w, "invalid answer", 400)
				return
			}
			respondJSON(w, map[string]interface{}{"correct": isDuelAnswerCorrect(question.Correct, req.Selected), "correct_options": correctIndices(question.Correct), "explanation": question.Explanation}, 200)
			return
		}
	}
	respondError(w, "Вопрос не найден", 404)
}
