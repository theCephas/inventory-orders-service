package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Port           string
	DatabaseURL    string
	InternalAPIKey string
	QueryTimeout   time.Duration
}

// Load reads configuration from the environment and reports every invalid value at once.
func Load() (Config, error) {
	cfg := Config{
		Port:           getEnv("PORT", "8080"),
		DatabaseURL:    os.Getenv("DATABASE_URL"),
		InternalAPIKey: os.Getenv("INTERNAL_API_KEY"),
		QueryTimeout:   5 * time.Second,
	}

	var errs []error
	if cfg.DatabaseURL == "" {
		errs = append(errs, errors.New("DATABASE_URL is required"))
	}
	if len(cfg.InternalAPIKey) < 32 {
		errs = append(errs, errors.New("INTERNAL_API_KEY must be at least 32 characters"))
	}
	if raw := os.Getenv("QUERY_TIMEOUT_MS"); raw != "" {
		ms, err := strconv.Atoi(raw)
		if err != nil || ms <= 0 {
			errs = append(errs, fmt.Errorf("QUERY_TIMEOUT_MS must be a positive integer, got %q", raw))
		} else {
			cfg.QueryTimeout = time.Duration(ms) * time.Millisecond
		}
	}
	return cfg, errors.Join(errs...)
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
