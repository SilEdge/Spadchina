package backend

import (
	"encoding/json"
	"golang.org/x/crypto/bcrypt"
	"net/http"
)

func adminSuggestionsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, "method not allowed", 405)
		return
	}
	rows, err := db.Query("SELECT id,COALESCE(name,''),COALESCE(email,''),message,CAST(created_at AS TEXT) FROM suggestions ORDER BY id DESC")
	if err != nil {
		respondError(w, "db error", 500)
		return
	}
	defer rows.Close()
	items := []map[string]interface{}{}
	for rows.Next() {
		var id int
		var name, email, message, created string
		if rows.Scan(&id, &name, &email, &message, &created) != nil {
			respondError(w, "db error", 500)
			return
		}
		items = append(items, map[string]interface{}{"id": id, "name": name, "email": email, "message": message, "created_at": created})
	}
	if rows.Err() != nil {
		respondError(w, "db error", 500)
		return
	}
	respondJSON(w, items, 200)
}

func adminPasswordHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, "method not allowed", 405)
		return
	}
	var input struct {
		Current  string `json:"current_password"`
		Password string `json:"password"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&input) != nil || len(input.Password) < 6 || len(input.Password) > 72 {
		respondError(w, "Новый пароль должен содержать от 6 до 72 символов", 400)
		return
	}
	id := userFromContext(r.Context()).UserID
	var hash string
	if db.QueryRow("SELECT password FROM users WHERE id=?", id).Scan(&hash) != nil || bcrypt.CompareHashAndPassword([]byte(hash), []byte(input.Current)) != nil {
		respondError(w, "Текущий пароль неверен", 403)
		return
	}
	updated, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		respondError(w, "Не удалось сменить пароль", 500)
		return
	}
	result, err := db.Exec("UPDATE users SET password=? WHERE id=? AND password=?", string(updated), id, hash)
	if err != nil {
		respondError(w, "db error", 500)
		return
	}
	n, _ := result.RowsAffected()
	if n != 1 {
		respondError(w, "Пароль уже изменён, войдите заново", 409)
		return
	}
	respondJSON(w, map[string]string{"status": "ok"}, 200)
}
