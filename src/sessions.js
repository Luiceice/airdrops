import db from "./db.js";

function nowIso() {
  return new Date().toISOString();
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function upsertSession(sessionId) {
  const now = nowIso();

  const existing = db
    .prepare(`SELECT session_id FROM sessions WHERE session_id = ?`)
    .get(sessionId);

  if (existing) {
    db.prepare(`
      UPDATE sessions
      SET updated_at = ?
      WHERE session_id = ?
    `).run(now, sessionId);
    return;
  }

  db.prepare(`
    INSERT INTO sessions (session_id, created_at, updated_at)
    VALUES (?, ?, ?)
  `).run(sessionId, now, now);
}

export function getMembershipView(sessionId) {
  const row = db.prepare(`
    SELECT session_id, plan, starts_at, ends_at, status, tx_hash, updated_at
    FROM memberships
    WHERE session_id = ?
    LIMIT 1
  `).get(sessionId);

  if (!row) {
    return {
      active: false,
      plan: null,
      startsAt: null,
      endsAt: null,
      status: "inactive",
      txHash: null,
      updatedAt: null,
    };
  }

  const active =
    row.status === "active" &&
    row.ends_at &&
    new Date(row.ends_at).getTime() > Date.now();

  if (!active && row.status === "active") {
    db.prepare(`
      UPDATE memberships
      SET status = 'expired', updated_at = ?
      WHERE session_id = ?
    `).run(nowIso(), sessionId);
  }

  return {
    active,
    plan: row.plan,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: active ? "active" : "expired",
    txHash: row.tx_hash || null,
    updatedAt: row.updated_at,
  };
}

export function isMembershipActive(sessionId) {
  return getMembershipView(sessionId).active;
}

export function getMembershipByTxHash(txHash) {
  return db.prepare(`
    SELECT session_id, plan, starts_at, ends_at, status, tx_hash, updated_at
    FROM memberships
    WHERE tx_hash = ?
    LIMIT 1
  `).get(txHash);
}

export function activateMembership({
  sessionId,
  plan,
  startsAt,
  endsAt,
  txHash,
}) {
  const now = nowIso();

  if (txHash) {
    const existingTx = db.prepare(`
      SELECT session_id
      FROM memberships
      WHERE tx_hash = ?
      LIMIT 1
    `).get(txHash);

    if (existingTx) {
      return {
        ok: false,
        reason: "duplicate_tx",
      };
    }
  }

  const existingMembership = db.prepare(`
    SELECT session_id
    FROM memberships
    WHERE session_id = ?
    LIMIT 1
  `).get(sessionId);

  if (existingMembership) {
    db.prepare(`
      UPDATE memberships
      SET
        plan = ?,
        starts_at = ?,
        ends_at = ?,
        status = 'active',
        tx_hash = ?,
        updated_at = ?
      WHERE session_id = ?
    `).run(plan, startsAt, endsAt, txHash || null, now, sessionId);

    return {
      ok: true,
      reason: "updated",
    };
  }

  db.prepare(`
    INSERT INTO memberships (
      session_id,
      plan,
      starts_at,
      ends_at,
      status,
      tx_hash,
      updated_at
    )
    VALUES (?, ?, ?, ?, 'active', ?, ?)
  `).run(sessionId, plan, startsAt, endsAt, txHash || null, now);

  return {
    ok: true,
    reason: "inserted",
  };
}

export function getTodayUsage(sessionId) {
  const row = db.prepare(`
    SELECT count
    FROM query_usage
    WHERE session_id = ? AND usage_date = ?
    LIMIT 1
  `).get(sessionId, todayStr());

  return row ? row.count : 0;
}

export function incrementUsage(sessionId) {
  const today = todayStr();
  const existing = db.prepare(`
    SELECT count
    FROM query_usage
    WHERE session_id = ? AND usage_date = ?
    LIMIT 1
  `).get(sessionId, today);

  if (existing) {
    db.prepare(`
      UPDATE query_usage
      SET count = count + 1
      WHERE session_id = ? AND usage_date = ?
    `).run(sessionId, today);
    return;
  }

  db.prepare(`
    INSERT INTO query_usage (session_id, usage_date, count)
    VALUES (?, ?, 1)
  `).run(sessionId, today);
}