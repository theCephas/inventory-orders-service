package store

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Statuses lists every order status so a summary reports all of them, including zero counts.
var Statuses = []string{"pending", "confirmed", "shipped", "cancelled"}

type TopProduct struct {
	ProductID    string
	Name         string
	UnitsSold    int64
	RevenueCents int64
}

type Summary struct {
	TotalOrders    int64
	RevenueCents   int64
	OrdersByStatus map[string]int64
	TopProducts    []TopProduct
}

type Store struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

const ordersByStatusSQL = `
SELECT status::text, count(*), COALESCE(sum(total_cents), 0)::bigint
FROM orders
WHERE created_at >= $1 AND created_at < $2
GROUP BY status`

const topProductsSQL = `
SELECT p.id::text,
       p.name,
       sum(oi.quantity)::bigint AS units_sold,
       sum(oi.quantity::bigint * oi.unit_price_cents)::bigint AS revenue_cents
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
JOIN products p ON p.id = oi.product_id
WHERE o.status <> 'cancelled' AND o.created_at >= $1 AND o.created_at < $2
GROUP BY p.id, p.name
ORDER BY units_sold DESC, revenue_cents DESC, p.id
LIMIT 5`

// OrderSummary aggregates orders created in the half-open range [from, to). Both queries run in
// one read-only REPEATABLE READ transaction so the totals and top products share a snapshot.
func (s *Store) OrderSummary(ctx context.Context, from, to time.Time) (Summary, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return Summary{}, fmt.Errorf("begin transaction: %w", err)
	}
	// Nothing is written, so rolling back is the simplest way to end the transaction.
	defer func() { _ = tx.Rollback(context.Background()) }()

	summary := Summary{OrdersByStatus: make(map[string]int64, len(Statuses))}
	for _, status := range Statuses {
		summary.OrdersByStatus[status] = 0
	}

	rows, err := tx.Query(ctx, ordersByStatusSQL, from, to)
	if err != nil {
		return Summary{}, fmt.Errorf("query orders by status: %w", err)
	}
	var (
		status     string
		count      int64
		totalCents int64
	)
	_, err = pgx.ForEachRow(rows, []any{&status, &count, &totalCents}, func() error {
		summary.OrdersByStatus[status] = count
		summary.TotalOrders += count
		if status != "cancelled" {
			summary.RevenueCents += totalCents
		}
		return nil
	})
	if err != nil {
		return Summary{}, fmt.Errorf("read orders by status: %w", err)
	}

	rows, err = tx.Query(ctx, topProductsSQL, from, to)
	if err != nil {
		return Summary{}, fmt.Errorf("query top products: %w", err)
	}
	summary.TopProducts, err = pgx.CollectRows(rows, pgx.RowToStructByPos[TopProduct])
	if err != nil {
		return Summary{}, fmt.Errorf("read top products: %w", err)
	}
	return summary, nil
}
