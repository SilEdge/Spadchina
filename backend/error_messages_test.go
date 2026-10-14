package backend

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestRussianErrors(t *testing.T) {
	for _, tc := range []struct {
		message  string
		status   int
		expected string
	}{
		{"invalid credentials", 401, "Неверная почта или пароль."},
		{"email already exists", 409, "Аккаунт с такой почтой уже зарегистрирован."},
		{"invalid token", 401, "Сессия истекла. Войдите в аккаунт заново."},
	} {
		response := httptest.NewRecorder()
		respondError(response, tc.message, tc.status)
		var body map[string]string
		if json.Unmarshal(response.Body.Bytes(), &body) != nil || body["error"] != tc.expected || response.Code != tc.status {
			t.Fatalf("unexpected localized error: %d %s", response.Code, response.Body.String())
		}
	}
}
