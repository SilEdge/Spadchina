package handler

import (
	"cultcode-backend/backend"
	"net/http"
	"strings"
)

func Handler(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" || strings.HasPrefix(path, "/") || strings.Contains(path, "..") {
		http.Error(w, "invalid API path", http.StatusBadRequest)
		return
	}
	request := r.Clone(r.Context())
	requestURL := *r.URL
	query := requestURL.Query()
	query.Del("path")
	requestURL.Path = "/api/" + path
	requestURL.RawPath = ""
	requestURL.RawQuery = query.Encode()
	request.URL = &requestURL
	backend.Handler(w, request)
}
