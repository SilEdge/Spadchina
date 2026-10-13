package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

type battleQuestionInput struct {
	Mode          string   `json:"mode"`
	Category      string   `json:"category"`
	CategoryLabel string   `json:"category_label"`
	Question      string   `json:"question"`
	Options       []string `json:"options"`
	Correct       int      `json:"correct"`
}

type adminBattleQuestion struct {
	ID int `json:"id"`
	battleQuestionInput
}

func validateBattleQuestion(q *battleQuestionInput) bool {
	q.Mode = strings.TrimSpace(q.Mode)
	q.Category = strings.TrimSpace(q.Category)
	q.CategoryLabel = strings.TrimSpace(q.CategoryLabel)
	q.Question = strings.TrimSpace(q.Question)
	if q.Mode != "duel" && q.Mode != "team" && q.Mode != "both" ||
		q.Category == "" || q.CategoryLabel == "" || q.Question == "" ||
		len(q.Options) < 2 || len(q.Options) > 6 || q.Correct < 0 || q.Correct >= len(q.Options) {
		return false
	}
	for i := range q.Options {
		q.Options[i] = strings.TrimSpace(q.Options[i])
		if q.Options[i] == "" {
			return false
		}
	}
	return true
}

func adminQuestionsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		rows, err := db.Query("SELECT id, mode, category, category_label, question, options, correct FROM battle_questions ORDER BY id DESC")
		if err != nil {
			respondError(w, "db error", 500)
			return
		}
		defer rows.Close()
		items := []adminBattleQuestion{}
		for rows.Next() {
			var item adminBattleQuestion
			var options string
			if rows.Scan(&item.ID, &item.Mode, &item.Category, &item.CategoryLabel, &item.Question, &options, &item.Correct) == nil {
				if json.Unmarshal([]byte(options), &item.Options) == nil {
					items = append(items, item)
				}
			}
		}
		respondJSON(w, items, 200)
	case http.MethodPost:
		var input battleQuestionInput
		if json.NewDecoder(r.Body).Decode(&input) != nil || !validateBattleQuestion(&input) {
			respondError(w, "invalid question", 400)
			return
		}
		options, _ := json.Marshal(input.Options)
		result, err := db.Exec("INSERT INTO battle_questions (mode, category, category_label, question, options, correct) VALUES (?, ?, ?, ?, ?, ?)",
			input.Mode, input.Category, input.CategoryLabel, input.Question, string(options), input.Correct)
		if err != nil {
			respondError(w, "db error", 500)
			return
		}
		id, _ := result.LastInsertId()
		respondJSON(w, map[string]int64{"id": id}, 201)
	default:
		respondError(w, "method not allowed", 405)
	}
}

func adminQuestionHandler(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(strings.TrimPrefix(r.URL.Path, "/api/admin/questions/"))
	if err != nil || id <= 0 {
		respondError(w, "invalid id", 400)
		return
	}
	var result sql.Result
	switch r.Method {
	case http.MethodPut:
		var input battleQuestionInput
		if json.NewDecoder(r.Body).Decode(&input) != nil || !validateBattleQuestion(&input) {
			respondError(w, "invalid question", 400)
			return
		}
		options, _ := json.Marshal(input.Options)
		result, err = db.Exec("UPDATE battle_questions SET mode=?, category=?, category_label=?, question=?, options=?, correct=? WHERE id=?",
			input.Mode, input.Category, input.CategoryLabel, input.Question, string(options), input.Correct, id)
	case http.MethodDelete:
		result, err = db.Exec("DELETE FROM battle_questions WHERE id=?", id)
	default:
		respondError(w, "method not allowed", 405)
		return
	}
	if err != nil {
		respondError(w, "db error", 500)
		return
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		respondError(w, "question not found", 404)
		return
	}
	respondJSON(w, map[string]string{"status": "ok"}, 200)
}

type rewardInput struct {
	ID   string `json:"id"`
	Icon string `json:"icon"`
	Name string `json:"name"`
	Cost int    `json:"cost"`
}

func validateReward(reward *rewardInput) bool {
	reward.ID = strings.TrimSpace(reward.ID)
	reward.Icon = strings.TrimSpace(reward.Icon)
	reward.Name = strings.TrimSpace(reward.Name)
	return reward.ID != "" && len(reward.ID) <= 80 && reward.Icon != "" && reward.Name != "" && reward.Cost >= 0
}

func adminRewardsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		rewardsHandler(w, r)
	case http.MethodPost:
		var input rewardInput
		if json.NewDecoder(r.Body).Decode(&input) != nil || !validateReward(&input) {
			respondError(w, "invalid reward", 400)
			return
		}
		_, err := db.Exec("INSERT INTO reward_items (id, icon, name, cost) VALUES (?, ?, ?, ?)", input.ID, input.Icon, input.Name, input.Cost)
		if err != nil {
			respondError(w, "reward id already exists", 409)
			return
		}
		respondJSON(w, input, 201)
	default:
		respondError(w, "method not allowed", 405)
	}
}

func adminRewardHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/admin/rewards/")
	if id == "" || strings.Contains(id, "/") {
		respondError(w, "invalid id", 400)
		return
	}
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM user_rewards WHERE reward_id=?", id).Scan(&count); err != nil {
		respondError(w, "db error", 500)
		return
	}
	var result sql.Result
	var err error
	switch r.Method {
	case http.MethodPut:
		var input rewardInput
		if json.NewDecoder(r.Body).Decode(&input) != nil || !validateReward(&input) || input.ID != id {
			respondError(w, "invalid reward", 400)
			return
		}
		if count > 0 {
			var oldCost int
			if db.QueryRow("SELECT cost FROM reward_items WHERE id=?", id).Scan(&oldCost) != nil {
				respondError(w, "reward not found", 404)
				return
			}
			if input.Cost != oldCost {
				respondError(w, "cost cannot change after redemption", 409)
				return
			}
		}
		result, err = db.Exec("UPDATE reward_items SET icon=?, name=?, cost=? WHERE id=?", input.Icon, input.Name, input.Cost, id)
	case http.MethodDelete:
		if count > 0 {
			respondError(w, "reward already redeemed by users", 409)
			return
		}
		result, err = db.Exec("DELETE FROM reward_items WHERE id=?", id)
	default:
		respondError(w, "method not allowed", 405)
		return
	}
	if err != nil {
		respondError(w, "db error", 500)
		return
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		respondError(w, "reward not found", 404)
		return
	}
	respondJSON(w, map[string]string{"status": "ok"}, 200)
}

// Admin questions take priority in new battles, then article questions fill the remaining slots.
func loadBattleQuestions(mode, category string) []DuelQuestion {
	rows, err := db.Query(`SELECT id, category, category_label, question, options, correct FROM battle_questions
		WHERE (mode=? OR mode='both') AND (?='all' OR category=?) ORDER BY RANDOM()`, mode, category, category)
	if err != nil {
		return nil
	}
	defer rows.Close()
	items := []DuelQuestion{}
	for rows.Next() {
		var item DuelQuestion
		var options string
		var correct int
		if rows.Scan(&item.ID, &item.Category, &item.CategoryLabel, &item.Question, &options, &correct) == nil &&
			json.Unmarshal([]byte(options), &item.Options) == nil {
			item.ID += 10000000
			item.Type = "single"
			item.Correct = correct
			items = append(items, item)
		}
	}
	return items
}
