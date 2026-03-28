import { ethers } from "ethers";
import db from "./db.js";
import { activateMembership } from "./sessions.js";

const USDT_TRANSFER_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

let started = false;

function isTransferProcessed(txHash) {
  const row = db
    .prepare(`SELECT tx_hash FROM processed_transfers WHERE tx_hash = ? LIMIT 1`)
    .get(txHash);

  return !!row;
}

function recordProcessedTransfer({
  txHash,
  tokenContract,
  fromAddress,
  toAddress,
  amountUnits,
  orderId = null,
}) {
  db.prepare(`
    INSERT OR IGNORE INTO processed_transfers (
      tx_hash, token_contract, from_address, to_address, amount_units, processed_at, order_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    txHash,
    String(tokenContract).toLowerCase(),
    String(fromAddress).toLowerCase(),
    String(toAddress).toLowerCase(),
    String(amountUnits),
    new Date().toISOString(),
    orderId
  );
}

function findMatchingPendingOrder(amountUnits, treasuryAddress) {
  return db.prepare(`
    SELECT *
    FROM orders
    WHERE status = 'pending'
      AND lower(payment_address) = lower(?)
      AND amount_units = ?
      AND datetime(expires_at) > datetime('now')
      AND tx_hash IS NULL
    ORDER BY created_at ASC
    LIMIT 1
  `).get(treasuryAddress, String(amountUnits));
}

function markOrderPaid(orderId, txHash, fromAddress) {
  const nowIso = new Date().toISOString();

  const result = db.prepare(`
    UPDATE orders
    SET status = 'paid',
        tx_hash = ?,
        paid_at = ?,
        matched_from_address = ?
    WHERE id = ?
      AND status = 'pending'
      AND tx_hash IS NULL
      AND datetime(expires_at) > datetime('now')
  `).run(txHash, nowIso, String(fromAddress).toLowerCase(), orderId);

  return result.changes > 0;
}

function expireOldPendingOrders() {
  db.prepare(`
    UPDATE orders
    SET status = 'expired'
    WHERE status = 'pending'
      AND datetime(expires_at) <= datetime('now')
  `).run();
}

function getMembershipDates(plan) {
  const now = new Date();
  const endsAt =
    plan === "monthly"
      ? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
      : new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  return {
    startsAt: now.toISOString(),
    endsAt: endsAt.toISOString(),
  };
}

export function startChainWatcher() {
  if (started) {
    console.log("Chain watcher already started");
    return;
  }
  started = true;

  const rpcUrl = process.env.POLYGON_RPC_URL || "";
  const tokenAddress = (process.env.POLYGON_USDT_ADDRESS || "").toLowerCase();
  const treasuryAddress = (process.env.TREASURY_ADDRESS || "").toLowerCase();

  if (!rpcUrl) {
    console.error("Missing POLYGON_RPC_URL");
    return;
  }

  if (!tokenAddress) {
    console.error("Missing POLYGON_USDT_ADDRESS");
    return;
  }

  if (!treasuryAddress || treasuryAddress.includes("your")) {
    console.error("Missing or invalid TREASURY_ADDRESS");
    return;
  }

  let wsUrl = rpcUrl;
  if (wsUrl.startsWith("https://")) {
    wsUrl = wsUrl.replace("https://", "wss://");
  } else if (wsUrl.startsWith("http://")) {
    wsUrl = wsUrl.replace("http://", "ws://");
  }

  const provider = new ethers.WebSocketProvider(wsUrl);
  const usdt = new ethers.Contract(tokenAddress, USDT_TRANSFER_ABI, provider);

  console.log("Chain watcher started");
  console.log("Watching token:", tokenAddress);
  console.log("Watching treasury:", treasuryAddress);

  setInterval(() => {
    try {
      expireOldPendingOrders();
    } catch (e) {
      console.error("expire pending orders error:", e);
    }
  }, 15000);

  usdt.on("Transfer", (from, to, value, event) => {
    try {
      const contractAddress = String(event.log.address).toLowerCase();

      if (contractAddress !== tokenAddress) {
        console.log("❌ fake token ignored:", contractAddress);
        return;
      }

      const toLower = String(to).toLowerCase();
      if (toLower !== treasuryAddress) return;

      const amountUnits = value.toString();
      const txHash = event.log.transactionHash;

      console.log("💸 Transfer detected:", {
        from,
        to,
        amountUnits,
        txHash,
      });

      if (isTransferProcessed(txHash)) {
        console.log("⏭ tx already processed:", txHash);
        return;
      }

      const order = findMatchingPendingOrder(amountUnits, treasuryAddress);

      if (!order) {
        console.log("No matching pending order for amount_units:", amountUnits);

        recordProcessedTransfer({
          txHash,
          tokenContract: tokenAddress,
          fromAddress: from,
          toAddress: to,
          amountUnits,
          orderId: null,
        });
        return;
      }

      const paid = markOrderPaid(order.id, txHash, from);

      if (!paid) {
        console.log("⏭ order already matched or expired:", order.id);

        recordProcessedTransfer({
          txHash,
          tokenContract: tokenAddress,
          fromAddress: from,
          toAddress: to,
          amountUnits,
          orderId: order.id,
        });
        return;
      }

      const { startsAt, endsAt } = getMembershipDates(order.plan);

      const membershipResult = activateMembership({
        sessionId: order.session_id,
        plan: order.plan,
        startsAt,
        endsAt,
        txHash,
      });

      if (!membershipResult.ok && membershipResult.reason === "duplicate_tx") {
        console.log("⏭ duplicate membership tx ignored:", txHash);

        recordProcessedTransfer({
          txHash,
          tokenContract: tokenAddress,
          fromAddress: from,
          toAddress: to,
          amountUnits,
          orderId: order.id,
        });
        return;
      }

      recordProcessedTransfer({
        txHash,
        tokenContract: tokenAddress,
        fromAddress: from,
        toAddress: to,
        amountUnits,
        orderId: order.id,
      });

      console.log("✅ Order paid:", order.id);
      console.log("🔥 membership activated:", order.session_id);
    } catch (err) {
      console.error("chain watcher error:", err);
    }
  });

  provider.on("error", (err) => {
    console.error("WebSocket provider error:", err);
  });
}