package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"inventory-orders/reporting-service/internal/store"
)

// SummaryStore is the handlers' only data dependency, so tests can substitute a fake.
type SummaryStore interface {
	OrderSummary(ctx context.Context, from, to time.Time) (store.Summary, error)
}

type summaryResponse struct {
	From           string           `json:"from"`
	To             string           `json:"to"`
	TotalOrders    int64            `json:"totalOrders"`
	RevenueCents   int64            `json:"revenueCents"`
	OrdersByStatus map[string]int64 `json:"ordersByStatus"`
	TopProducts    []topProduct     `json:"topProducts"`
}

type topProduct struct {
	ProductID    string `json:"productId"`
	Name         string `json:"name"`
	UnitsSold    int64  `json:"unitsSold"`
	RevenueCents int64  `json:"revenueCents"`
}

type errorResponse struct {
	Error string `json:"error"`
}

type handlers struct {
	store        SummaryStore
	queryTimeout time.Duration
	logger       *slog.Logger
}

// NewRouter wires the routes. /health is open so orchestrators can probe it; everything under
// /v1 requires the internal API key.
func NewRouter(s SummaryStore, apiKey string, queryTimeout time.Duration, logger *slog.Logger) http.Handler {
	h := &handlers{store: s, queryTimeout: queryTimeout, logger: logger}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", h.health)
	mux.Handle("GET /v1/summary", requireAPIKey(apiKey, http.HandlerFunc(h.summary)))
	return recoverPanics(logger, mux)
}

func (h *handlers) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *handlers) summary(w http.ResponseWriter, r *http.Request) {
	from, to, err := parseDateRange(r.URL.Query().Get("from"), r.URL.Query().Get("to"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), h.queryTimeout)
	defer cancel()

	// "to" is an inclusive calendar date, so the query runs up to the start of the next day.
	summary, err := h.store.OrderSummary(ctx, from, to.AddDate(0, 0, 1))
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			h.logger.Warn("summary query timed out", "timeout", h.queryTimeout)
			writeJSON(w, http.StatusGatewayTimeout, errorResponse{Error: "summary query timed out"})
			return
		}
		h.logger.Error("summary query failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "internal server error"})
		return
	}

	top := make([]topProduct, 0, len(summary.TopProducts))
	for _, p := range summary.TopProducts {
		top = append(top, topProduct{
			ProductID:    p.ProductID,
			Name:         p.Name,
			UnitsSold:    p.UnitsSold,
			RevenueCents: p.RevenueCents,
		})
	}
	writeJSON(w, http.StatusOK, summaryResponse{
		From:           from.Format(time.DateOnly),
		To:             to.Format(time.DateOnly),
		TotalOrders:    summary.TotalOrders,
		RevenueCents:   summary.RevenueCents,
		OrdersByStatus: summary.OrdersByStatus,
		TopProducts:    top,
	})
}

// parseDateRange validates the inclusive YYYY-MM-DD range given in the query string.
func parseDateRange(rawFrom, rawTo string) (time.Time, time.Time, error) {
	if rawFrom == "" || rawTo == "" {
		return time.Time{}, time.Time{}, errors.New("query parameters 'from' and 'to' are required (YYYY-MM-DD)")
	}
	from, err := time.Parse(time.DateOnly, rawFrom)
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("invalid 'from' date %q: expected YYYY-MM-DD", rawFrom)
	}
	to, err := time.Parse(time.DateOnly, rawTo)
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("invalid 'to' date %q: expected YYYY-MM-DD", rawTo)
	}
	if from.After(to) {
		return time.Time{}, time.Time{}, errors.New("'from' must not be after 'to'")
	}
	return from, to, nil
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	// The status line has already been sent, so an encoding failure cannot be reported.
	_ = json.NewEncoder(w).Encode(body)
}
