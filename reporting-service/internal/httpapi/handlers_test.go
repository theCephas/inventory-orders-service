package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"inventory-orders/reporting-service/internal/store"
)

const testAPIKey = "test-internal-api-key-0123456789abcdef"

type fakeStore struct {
	summary store.Summary
	err     error
	block   bool // wait for the context to expire, simulating a slow query
	calls   int
	gotFrom time.Time
	gotTo   time.Time
}

func (f *fakeStore) OrderSummary(ctx context.Context, from, to time.Time) (store.Summary, error) {
	f.calls++
	f.gotFrom, f.gotTo = from, to
	if f.block {
		<-ctx.Done()
		return store.Summary{}, ctx.Err()
	}
	return f.summary, f.err
}

func newTestRouter(s SummaryStore) http.Handler {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return NewRouter(s, testAPIKey, 50*time.Millisecond, logger)
}

func serve(handler http.Handler, path, apiKey string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	if apiKey != "" {
		req.Header.Set(apiKeyHeader, apiKey)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func TestSummaryHandler(t *testing.T) {
	const validRange = "from=2026-01-01&to=2026-01-31"

	tests := []struct {
		name       string
		query      string
		apiKey     string
		store      *fakeStore
		wantStatus int
		wantError  string // substring of the JSON error message; empty for success
		wantCalls  int
	}{
		{name: "missing API key", query: validRange, wantStatus: http.StatusUnauthorized, wantError: "API key"},
		{name: "wrong API key", query: validRange, apiKey: "not-the-key", wantStatus: http.StatusUnauthorized, wantError: "API key"},
		{name: "missing from", query: "to=2026-01-31", apiKey: testAPIKey, wantStatus: http.StatusBadRequest, wantError: "required"},
		{name: "missing to", query: "from=2026-01-01", apiKey: testAPIKey, wantStatus: http.StatusBadRequest, wantError: "required"},
		{name: "impossible date", query: "from=2026-13-01&to=2026-12-31", apiKey: testAPIKey, wantStatus: http.StatusBadRequest, wantError: "invalid 'from'"},
		{name: "not a date", query: "from=2026-01-01&to=tomorrow", apiKey: testAPIKey, wantStatus: http.StatusBadRequest, wantError: "invalid 'to'"},
		{name: "timestamp instead of date", query: "from=2026-01-01T00:00:00Z&to=2026-01-31", apiKey: testAPIKey, wantStatus: http.StatusBadRequest, wantError: "invalid 'from'"},
		{name: "from after to", query: "from=2026-02-01&to=2026-01-31", apiKey: testAPIKey, wantStatus: http.StatusBadRequest, wantError: "must not be after"},
		{name: "single day range", query: "from=2026-01-31&to=2026-01-31", apiKey: testAPIKey, wantStatus: http.StatusOK, wantCalls: 1},
		{name: "store failure", query: validRange, apiKey: testAPIKey, store: &fakeStore{err: errors.New("connection refused")}, wantStatus: http.StatusInternalServerError, wantError: "internal server error", wantCalls: 1},
		{name: "query timeout", query: validRange, apiKey: testAPIKey, store: &fakeStore{block: true}, wantStatus: http.StatusGatewayTimeout, wantError: "timed out", wantCalls: 1},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			fake := tc.store
			if fake == nil {
				fake = &fakeStore{}
			}

			rec := serve(newTestRouter(fake), "/v1/summary?"+tc.query, tc.apiKey)

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d (body: %s)", rec.Code, tc.wantStatus, rec.Body.String())
			}
			if got := rec.Header().Get("Content-Type"); got != "application/json" {
				t.Errorf("Content-Type = %q, want application/json", got)
			}
			if fake.calls != tc.wantCalls {
				t.Errorf("store called %d times, want %d", fake.calls, tc.wantCalls)
			}
			if tc.wantError != "" {
				var body errorResponse
				if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
					t.Fatalf("error body is not JSON: %v", err)
				}
				if !strings.Contains(body.Error, tc.wantError) {
					t.Errorf("error = %q, want it to contain %q", body.Error, tc.wantError)
				}
			}
		})
	}
}

func TestSummaryHandlerResponseBody(t *testing.T) {
	fake := &fakeStore{summary: store.Summary{
		TotalOrders:    42,
		RevenueCents:   1234500,
		OrdersByStatus: map[string]int64{"pending": 3, "confirmed": 30, "shipped": 5, "cancelled": 4},
		TopProducts: []store.TopProduct{
			{ProductID: "6f1c0d8e-0000-4000-8000-000000000001", Name: "Keyboard", UnitsSold: 12, RevenueCents: 54000},
		},
	}}

	rec := serve(newTestRouter(fake), "/v1/summary?from=2026-01-01&to=2026-01-31", testAPIKey)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	wantFrom := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	wantTo := time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC) // inclusive end date becomes an exclusive bound
	if !fake.gotFrom.Equal(wantFrom) || !fake.gotTo.Equal(wantTo) {
		t.Errorf("store range = [%s, %s), want [%s, %s)", fake.gotFrom, fake.gotTo, wantFrom, wantTo)
	}

	var got summaryResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("body is not JSON: %v", err)
	}
	want := summaryResponse{
		From:           "2026-01-01",
		To:             "2026-01-31",
		TotalOrders:    42,
		RevenueCents:   1234500,
		OrdersByStatus: map[string]int64{"pending": 3, "confirmed": 30, "shipped": 5, "cancelled": 4},
		TopProducts: []topProduct{
			{ProductID: "6f1c0d8e-0000-4000-8000-000000000001", Name: "Keyboard", UnitsSold: 12, RevenueCents: 54000},
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("body = %+v, want %+v", got, want)
	}
}

func TestSummaryHandlerEncodesNoTopProductsAsEmptyArray(t *testing.T) {
	rec := serve(newTestRouter(&fakeStore{}), "/v1/summary?from=2026-01-01&to=2026-01-31", testAPIKey)

	if !strings.Contains(rec.Body.String(), `"topProducts":[]`) {
		t.Errorf("body = %s, want topProducts to be an empty array, not null", rec.Body.String())
	}
}

func TestHealthIsPublic(t *testing.T) {
	rec := serve(newTestRouter(&fakeStore{}), "/health", "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || body["status"] != "ok" {
		t.Errorf("body = %s, want {\"status\":\"ok\"}", rec.Body.String())
	}
}
