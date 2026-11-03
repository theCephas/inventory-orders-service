package httpapi

import (
	"crypto/subtle"
	"log/slog"
	"net/http"
)

const apiKeyHeader = "X-Internal-Api-Key"

// requireAPIKey authenticates service-to-service calls. User authorisation happens in the API.
func requireAPIKey(apiKey string, next http.Handler) http.Handler {
	expected := []byte(apiKey)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		provided := []byte(r.Header.Get(apiKeyHeader))
		// Constant-time comparison so response timing reveals nothing about the key.
		if subtle.ConstantTimeCompare(provided, expected) != 1 {
			writeJSON(w, http.StatusUnauthorized, errorResponse{Error: "missing or invalid internal API key"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func recoverPanics(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				logger.Error("panic while serving request", "path", r.URL.Path, "panic", recovered)
				writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "internal server error"})
			}
		}()
		next.ServeHTTP(w, r)
	})
}
