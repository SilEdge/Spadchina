package backend

import (
	"context"
)

type contextKey string

const userContextKey contextKey = "user"

func contextWithUser(ctx context.Context, claims Claims) context.Context {
	return context.WithValue(ctx, userContextKey, claims)
}

func userFromContext(ctx context.Context) Claims {
	if claims, ok := ctx.Value(userContextKey).(Claims); ok {
		return claims
	}
	return Claims{}
}
