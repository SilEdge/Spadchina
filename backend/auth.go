package main

import (
	"crypto/rand"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var jwtKey = makeJWTKey()

func makeJWTKey() []byte {
	if configured := strings.TrimSpace(os.Getenv("JWT_SECRET")); configured != "" {
		if len([]byte(configured)) < 32 {
			log.Fatal("JWT_SECRET must contain at least 32 bytes")
		}
		return []byte(configured)
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		log.Fatalf("generate local JWT secret: %v", err)
	}
	log.Println("JWT_SECRET is unset; using an ephemeral development key")
	return key
}

type Claims struct {
	UserID   int    `json:"user_id"`
	Username string `json:"username"`
	Role     string `json:"role"`
	jwt.RegisteredClaims
}

func generateToken(user User) (string, error) {
	claims := Claims{
		UserID:   user.ID,
		Username: user.Username,
		Role:     user.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtKey)
}

func parseToken(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return jwtKey, nil
	})
	if err != nil {
		return nil, err
	}
	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		return claims, nil
	}
	return nil, fmt.Errorf("invalid token")
}

func authMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		enableCORS(w, r)
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			respondError(w, "missing token", http.StatusUnauthorized)
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
			respondError(w, "invalid auth header", http.StatusUnauthorized)
			return
		}

		claims, err := parseToken(parts[1])
		if err != nil {
			respondError(w, "invalid token", http.StatusUnauthorized)
			return
		}

		r = r.WithContext(contextWithUser(r.Context(), *claims))
		next(w, r)
	}
}

func adminMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		claims := userFromContext(r.Context())
		role := claims.Role

		if err := db.QueryRow("SELECT role FROM users WHERE id = ?", claims.UserID).Scan(&role); err != nil {
			respondError(w, "user not found", http.StatusUnauthorized)
			return
		}

		if role != "admin" {
			respondError(w, "admin only", http.StatusForbidden)
			return
		}
		next(w, r)
	})
}
