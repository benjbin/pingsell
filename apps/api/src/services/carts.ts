import { all, newId, now, run, scalar, transaction, type DatabaseSync } from '../db.js';
import { fireTrigger } from './automations.js';
import { recordEvent, upsertContact } from './contacts.js';

/** A cart with an email and no order after this delay is « abandoned ». Overridable for tests. */
export const abandonAfterMs = () => Number(process.env.CART_ABANDON_MINUTES ?? 60) * 60_000;

export interface CartInput {
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  cart_id: string;
  total?: number;
  currency?: string;
  checkout_url?: string;
  items?: Array<{ title: string; quantity?: number; price?: number }>;
}

/** Stores or refreshes a cart (each call restarts the 1-hour countdown). Ignored once the cart was ordered or relaunched. */
export function upsertCart(db: DatabaseSync, accountId: string, input: CartInput): 'created' | 'updated' | 'closed' {
  const ts = now();
  const items = JSON.stringify((input.items ?? []).slice(0, 50).map((i) => ({ title: i.title, quantity: i.quantity ?? 1, price: i.price ?? 0 })));
  const existing = scalar(db, 'SELECT COUNT(*) FROM api_carts WHERE account_id = ? AND cart_id = ?', accountId, input.cart_id) > 0;
  const changed = run(
    db,
    `INSERT INTO api_carts (id, account_id, cart_id, email, first_name, last_name, total, currency, checkout_url, line_items, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, cart_id) DO UPDATE SET
       email = excluded.email, first_name = COALESCE(excluded.first_name, first_name), last_name = COALESCE(excluded.last_name, last_name),
       total = excluded.total, currency = excluded.currency, checkout_url = COALESCE(excluded.checkout_url, checkout_url),
       line_items = excluded.line_items, updated_at = excluded.updated_at
     WHERE api_carts.status = 'pending'`,
    newId(), accountId, input.cart_id, input.email.trim().toLowerCase(), input.first_name ?? null, input.last_name ?? null,
    input.total ?? 0, input.currency ?? null, input.checkout_url ?? null, items, ts, ts,
  );
  return !existing ? 'created' : changed ? 'updated' : 'closed';
}

/** An order closes this customer's pending carts: no reminder for something already bought. */
export function closeCartsForEmail(db: DatabaseSync, accountId: string, email: string): void {
  run(db, "UPDATE api_carts SET status = 'completed', updated_at = ? WHERE account_id = ? AND email = ? AND status = 'pending'", now(), accountId, email.trim().toLowerCase());
}

interface CartRow {
  id: string; account_id: string; cart_id: string; email: string; first_name: string | null; last_name: string | null;
  total: number; currency: string | null; checkout_url: string | null; line_items: string; created_at: string;
}

/** Fires `cart_abandoned` for carts idle past the delay with no order since. Called by the worker. */
export function processAbandonedCarts(db: DatabaseSync): number {
  const cutoff = new Date(Date.now() - abandonAfterMs()).toISOString();
  const rows = all<CartRow>(db, "SELECT * FROM api_carts WHERE status = 'pending' AND updated_at <= ? ORDER BY updated_at LIMIT 200", cutoff);
  let fired = 0;
  for (const row of rows) {
    transaction(db, () => {
      const ordered = scalar(
        db,
        `SELECT COUNT(*) FROM events e JOIN contacts c ON c.id = e.contact_id
          WHERE e.account_id = ? AND e.type = 'order' AND c.email = ? AND e.created_at >= ?`,
        row.account_id, row.email, row.created_at,
      ) > 0;
      if (ordered) {
        run(db, "UPDATE api_carts SET status = 'completed', updated_at = ? WHERE id = ?", now(), row.id);
        return;
      }
      if (!run(db, "UPDATE api_carts SET status = 'abandoned', abandoned_at = ? WHERE id = ? AND status = 'pending'", now(), row.id)) return;
      const r = upsertContact(db, row.account_id, { email: row.email, first_name: row.first_name ?? undefined, last_name: row.last_name ?? undefined, source: 'api' });
      if (r.created) {
        recordEvent(db, row.account_id, r.contact.id, 'contact_created', { source: 'api' });
        fireTrigger(db, row.account_id, r.contact.id, 'contact_created', { source: 'api' });
      }
      const data = {
        cart_id: row.cart_id, total: row.total, currency: row.currency, checkout_url: row.checkout_url,
        line_items: JSON.parse(row.line_items), source: 'api',
      };
      recordEvent(db, row.account_id, r.contact.id, 'cart_abandoned', data);
      fireTrigger(db, row.account_id, r.contact.id, 'cart_abandoned', data);
      fired++;
    });
  }
  return fired;
}
