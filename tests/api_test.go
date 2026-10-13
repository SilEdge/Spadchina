package tests

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	handler "cultcode-backend/api"
	_ "modernc.org/sqlite"
)

func TestVercelFunctionAuthentication(t *testing.T) {
	path := "file:function-auth-test?mode=memory&cache=shared"
	database, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = database.Exec(`CREATE TABLE users (
		id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
		name TEXT, email TEXT UNIQUE, password TEXT NOT NULL,
		role TEXT DEFAULT 'user', points INTEGER DEFAULT 0)`)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	t.Setenv("DATABASE_PATH", path)
	t.Setenv("TURSO_DATABASE_URL", "")
	t.Setenv("VERCEL", "")
	t.Setenv("JWT_SECRET", "function-test-secret-at-least-32-characters")
	request := func(method, route, token string, body any) *httptest.ResponseRecorder {
		encoded, _ := json.Marshal(body)
		r := httptest.NewRequest(method, "/api/handler?path="+route, bytes.NewReader(encoded))
		r.Header.Set("Content-Type", "application/json")
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		handler.Handler(w, r)
		return w
	}
	if w := request("GET", "health", "", nil); w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("function health: %d %s", w.Code, w.Body.String())
	}
	if w := request("GET", "me", "", nil); w.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated profile returned %d", w.Code)
	}
	w := request("POST", "register", "", map[string]string{"name": "Function user", "email": "function@example.test", "password": "test-password"})
	if w.Code != http.StatusCreated {
		t.Fatalf("registration: %d %s", w.Code, w.Body.String())
	}
	var session struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &session); err != nil || session.Token == "" {
		t.Fatal("missing session")
	}
	w = request("GET", "me", session.Token, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("authenticated profile: %d %s", w.Code, w.Body.String())
	}
	w = request("PATCH", "me", session.Token, map[string]string{"name": "Updated function user"})
	if w.Code != http.StatusOK {
		t.Fatalf("update profile: %d %s", w.Code, w.Body.String())
	}
	w = request("GET", "me", session.Token, nil)
	if !bytes.Contains(w.Body.Bytes(), []byte("Updated function user")) {
		t.Fatal("profile change was not persisted")
	}
	w = request("GET", "../private", session.Token, nil)
	if w.Code != http.StatusBadRequest {
		t.Fatal("invalid path was accepted")
	}
}
