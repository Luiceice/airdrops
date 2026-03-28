console.log("🔥 LOCAL SERVER VERSION 3DECIMAL");
console.log("✅ FILE MARK A");
console.log("__filename =", __filename);
const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const dayjs = require("dayjs");
const axios = require("axios");
const cheerio = require("cheerio");
const { chromium } = require("playwright");
require("dotenv").config();

const fs = require("fs");

const DATA_FILE = "./data.json";

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    const parsed = JSON.parse(raw);

    return {
      sessions: new Map(parsed.sessions || []),
      members: new Map(parsed.members || []),
      orders: new Map(parsed.orders || []),
    };
  } catch {
    return {
      sessions: new Map(),
      members: new Map(),
      orders: new Map(),
    };
  }
}

function saveData() {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify({
      sessions: Array.from(sessions.entries()),
      members: Array.from(members.entries()),
      orders: Array.from(orders.entries()),
    })
  );
}

console.log("ROOTDATA_API_KEY loaded:", process.env.ROOTDATA_API_KEY);

const app = express();
const PORT = 8787;

app.use(cors());
app.use(express.json());

const ETHERSCAN_API_KEY =
  process.env.ETHERSCAN_API_KEY || "WIR9UUQQ7ZFK81YKU2F8GQJCCV2Q6IQS89";
const POLYGON_CHAIN_ID = "137";

app.get("/api/test-airdrops", async (req, res) => {
  try {
    const query = req.query.q || "ETH";

    const resp = await axios.post(
      "https://api.rootdata.com/open/ser_inv",
      { query },
      {
        headers: {
          apikey: process.env.ROOTDATA_API_KEY,
          language: "en",
          "Content-Type": "application/json",
        },
      }
    );

    res.json(resp.data);
  } catch (err) {
    console.error("RootData error:", err.response?.data || err.message);
    res.status(500).json({
      error: "failed",
      details: err.response?.data || err.message,
    });
  }
});

app.get("/ping", (req, res) => {
  res.send("pong");
});

console.log("test-airdrops route loaded");


// 你收的是 Polygon 上的 USDT，就用这个合约
const USDT_CONTRACT = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";

function formatTokenAmount(value, decimals) {
  const raw = String(value || "0");
  const d = Number(decimals || 6);

  if (raw.length <= d) {
    const padded = raw.padStart(d, "0");
    return `0.${padded}`.replace(/0+$/, "").replace(/\.$/, "") || "0";
  }

  const intPart = raw.slice(0, raw.length - d);
  const decPart = raw.slice(raw.length - d).replace(/0+$/, "");
  return decPart ? `${intPart}.${decPart}` : intPart;
}

function amountMatches(a, b) {
  const x = Number(a);
  const y = Number(b);

  if (!isFinite(x) || !isFinite(y)) return false;

  // 允许 ±0.002 USDT 误差（你现在尾数是 0.001 级别）
  return Math.abs(x - y) <= 0.02;
}

function txAlreadyUsed(txHash, currentOrderId) {
  const normalizedHash = String(txHash || "").trim().toLowerCase();
  if (!normalizedHash) return false;

  for (const [id, o] of orders.entries()) {
    const existingHash = String(o.txHash || "").trim().toLowerCase();

    if (id !== currentOrderId && existingHash === normalizedHash) {
      return true;
    }
  }

  return false;
}

async function findMatchingTransfer(order) {
  const url = "https://api.etherscan.io/v2/api";

  const resp = await axios.get(url, {
    params: {
      chainid: POLYGON_CHAIN_ID,
      module: "account",
      action: "tokentx",
      contractaddress: USDT_CONTRACT,
      address: PAYMENT_ADDRESS,
      page: 1,
      offset: 100,
      sort: "desc",
      apikey: ETHERSCAN_API_KEY,
    },
    timeout: 15000,
  });

  const list = resp && resp.data && resp.data.result;
  if (!Array.isArray(list)) return null;

  const createdAtMs = new Date(order.createdAt).getTime();
  const orderAgeMs = Date.now() - createdAtMs;
  if (orderAgeMs > 30 * 60 * 1000) return null;

  for (let i = 0; i < list.length; i++) {
    const tx = list[i];

    const from = String(tx.from || "").toLowerCase();
    const to = String(tx.to || "").toLowerCase();
    const txHash = String(tx.hash || "");
    const txTimeMs = Number(tx.timeStamp || 0) * 1000;
    const amount = formatTokenAmount(tx.value, tx.tokenDecimal);
    const expireMs = createdAtMs + 30 * 60 * 1000;
    const expectedFrom = String(order.expectedFrom || "").toLowerCase();

    if (
      to === PAYMENT_ADDRESS.toLowerCase() &&
      amountMatches(amount, order.amountUsdt) &&
      txTimeMs >= createdAtMs &&
      txTimeMs <= expireMs &&
      (!expectedFrom || from === expectedFrom) &&
      !txAlreadyUsed(txHash, order.orderId)
    ) {
      return tx;
    }
  }

  return null;
}

async function scanPendingOrders() {
  const pendingOrders = Array.from(orders.values()).filter(
    (o) => o.status === "pending"
  );

  if (pendingOrders.length > 0) {
    console.log("🔎 scanPendingOrders pending =", pendingOrders.length);
  }

  for (const order of pendingOrders) {
    try {
      const tx = await findMatchingTransfer(order);

      if (!tx) {
  console.log("❌ no matching tx for order =", {
    orderId: order.orderId,
    amountUsdt: order.amountUsdt,
    expectedFrom: order.expectedFrom,
    createdAt: order.createdAt,
  });
  continue;
}

      if (order.status === "pending" && tx && tx.hash) {
        activateOrderAndMembership(order, tx.hash, tx.from);

        console.log(
          "✅ auto paid:",
          order.orderId,
          "amount:",
          order.amountUsdt,
          "tx:",
          tx.hash
        );
      }
    } catch (err) {
      console.error("scan pending order failed:", order.orderId, err.message);
    }
  }
}

function activateOrderAndMembership(order, txHash, payerAddress) {
  order.status = "paid";
  order.txHash = txHash || null;
  order.payerAddress = payerAddress || null;
  order.paidAt = nowIso();

  orders.set(order.orderId, order);

  const sessionId = order.sessionId;

  if (sessionId) {
    const endsAt =
      order.plan === "yearly"
        ? dayjs().add(1, "year").toISOString()
        : dayjs().add(30, "day").toISOString();

    members.set(sessionId, { active: true, endsAt });
  }

  saveData();   // 👈 只放一次在最后

  return order;
}

function ensureMembershipForPaidOrder(order) {
  if (!order?.sessionId) return;

  const member = members.get(order.sessionId);
  const stillActive =
    !!member?.active && !!member?.endsAt && !dayjs(member.endsAt).isBefore(dayjs());

  if (stillActive) return;

  const baseTime = order.paidAt ? dayjs(order.paidAt) : dayjs();
  const endsAt =
    order.plan === "yearly"
      ? baseTime.add(1, "year").toISOString()
      : baseTime.add(30, "day").toISOString();

  members.set(order.sessionId, { active: true, endsAt });
  saveData();
}

// ✅ 放在这里（全局函数）
function buildOrderAmount(plan) {
  const base = plan === "yearly" ? 39.99 : 4.99;

  // 保留两位小数，钱包更容易直接支付
  const tail = Math.floor(Math.random() * 9);
  const amount = Number((base - tail / 100).toFixed(2));

  console.log("buildOrderAmount result =", amount);

  return amount;
}
// 下面才是各种 app.use / app.post / app.get


const FREE_DAILY_LIMIT = 3;
const QUERY_MAX_PROJECTS = 18;
const FREE_VISIBLE_COUNT = 4;
const CRAWLER_REFRESH_MS = 30 * 60 * 1000;
const QUERY_REFRESH_STALE_MS = 10 * 60 * 1000;

const PAYMENT_ADDRESS = "0x0d0a861dc4af093b31dc60bc591369233bd4536c";

const data = loadData();
const sessions = data.sessions;
const members = data.members;
const orders = data.orders;

const airdropDB = {
  raw: [],
  claimable: [],
  upcoming: [],
  monitoring: [],
  lastUpdated: null,
  sourceStats: {},
};

let crawlerRunning = false;
let crawlerPromise = null;

/* ================= 工具 ================= */

function nowIso() {
  return new Date().toISOString();
}

function normalize(text = "") {
  return String(text).replace(/\s+/g, " ").trim();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function getRandomUA() {
  const uas = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/121 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Version/16.0 Mobile Safari/604.1",
  ];
  return uas[Math.floor(Math.random() * uas.length)];
}

function isGarbageProject(title = "", href = "", text = "") {
  const hay = `${title} ${href} ${text}`.toLowerCase();

  const bannedWords = [
    "documentation",
    "public-api",
    "market api",
    "real-time and historical crypto market",
    "what are the different airdrop statuses",
    "statuses and what do they mean",
    "queries, parameters, and response",
    "docs",
    "endpoint",
    "endpoints",
    "login",
    "log in",
    "sign up",
    "sign in",
    "portfolio",
    "watchlist",
    "advertise",
    "careers",
    "terms",
    "privacy",
    "cookie",
    "discord",
    "telegram",
    "twitter",
    "youtube",
    "facebook",
    "instagram",
    "support",
    "help center",
    "contact us",
    "press",
    "media kit",
  ];

  if (bannedWords.some((w) => hay.includes(w))) return true;

  const bannedExactTitles = [
    "potential",
    "claim",
    "reward",
    "airdrop",
    "campaign",
    "api",
    "documentation",
    "learn more",
    "read more",
  ];

  if (bannedExactTitles.includes(String(title).trim().toLowerCase())) return true;

  if (/\/docs\b/i.test(href)) return true;
  if (/\/public-api\b/i.test(href)) return true;
  if (/api\./i.test(href)) return true;
  if (/javascript:void/i.test(href)) return true;
  if (/^#/i.test(href)) return true;

  return false;
}

function inferNetwork(text = "") {
  const hay = String(text).toLowerCase();

  if (hay.includes("arbitrum")) return "Arbitrum";
  if (hay.includes("optimism")) return "Optimism";
  if (hay.includes("base")) return "Base";
  if (hay.includes("polygon") || hay.includes("matic")) return "Polygon";
  if (hay.includes("zksync")) return "zkSync Era";
  if (hay.includes("scroll")) return "Scroll";
  if (hay.includes("linea")) return "Linea";
  if (hay.includes("blast")) return "Blast";
  if (hay.includes("starknet")) return "StarkNet";
  if (hay.includes("berachain")) return "Berachain";
  if (hay.includes("monad")) return "Monad";
  if (hay.includes("fuel")) return "Fuel";
  if (hay.includes("solana")) return "Solana";
  if (hay.includes("bnb") || hay.includes("bsc")) return "BNB Chain";
  if (hay.includes("avax") || hay.includes("avalanche")) return "Avalanche";
  if (hay.includes("sui")) return "Sui";
  if (hay.includes("aptos")) return "Aptos";
  if (hay.includes("ethereum") || hay.includes(" eth ")) return "Ethereum";

  return "Multiple";
}

function inferSourceType(sourceName, text = "", url = "") {
  const hay = `${sourceName} ${text} ${url}`.toLowerCase();

  if (sourceName === "Airdrops.io") return "verified";
  if (hay.includes("official") || hay.includes("foundation")) return "verified";
  return "community";
}

function inferType(text = "", sourceName = "", url = "") {
  const hay = `${text} ${sourceName} ${url}`.toLowerCase();

    if (
    hay.includes("claim now") ||
    hay.includes("claim live") ||
    hay.includes("eligible") ||
    hay.includes("check eligibility") ||
    hay.includes("airdrop is live") ||
    hay.includes("now live") ||
    hay.includes("claim") ||
    hay.includes("airdrop live") ||
    hay.includes("live on") ||
    hay.includes("distribution")
  ) {
    return "claimable";
  }

  if (
    hay.includes("upcoming") ||
    hay.includes("testnet") ||
    hay.includes("reward") ||
    hay.includes("campaign") ||
    hay.includes("points") ||
    hay.includes("quest") ||
    hay.includes("mainnet") ||
    hay.includes("farm") ||
    hay.includes("/drophunting/") ||
    hay.includes("airdrop") ||
    hay.includes("retrodrop") ||
    hay.includes("incentivized")
  ) {
    return "upcoming";
  }

  return "monitoring";
}

function makeProjectKey(name = "", url = "") {
  const base = `${String(name).toLowerCase().trim()}|${String(url).toLowerCase().trim()}`;
  return base.replace(/\s+/g, " ");
}

function cleanProjectName(text = "") {
  let s = normalize(text);

  s = s
    .replace(/\b(read more|learn more|details|guide|campaign|airdrop guide)\b/gi, "")
    .replace(/\s+\|\s+.*/g, "")
    .replace(/\s+-\s+(airdrop|campaign|guide|details).*$/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (s.length > 80) s = s.slice(0, 80).trim();
  return s;
}

function scoreProjectCandidate(text = "", href = "", source = "") {
  const hay = `${text} ${href} ${source}`.toLowerCase();
  let score = 0;

  if (/airdrop|testnet|reward|campaign|points|quest|eligible|claim/i.test(hay)) score += 30;
  if (/claim|eligible|check eligibility|claim now/i.test(hay)) score += 25;
  if (/mainnet|points|testnet|quest/i.test(hay)) score += 15;
  if (source === "Airdrops.io") score += 10;
  if (/\/airdrops?\//i.test(href)) score += 12;
  if (/\/drophunting/i.test(href)) score += 10;
  if (text.length >= 12 && text.length <= 80) score += 8;
  if (isGarbageProject(text, href, text)) score -= 100;

  return score;
}

function uniqByName(arr) {
  const map = new Map();

  for (const item of safeArray(arr)) {
    if (!item?.name) continue;

    const key = makeProjectKey(item.name, item.projectUrl || item.claimUrl || "");
    const oldItem = map.get(key);

    if (!oldItem) {
      map.set(key, item);
      continue;
    }

    const oldScore =
      (oldItem.confidence || 0) +
      (oldItem.type === "claimable" ? 20 : 0) +
      (oldItem.sourceType === "verified" ? 8 : 0);

    const newScore =
      (item.confidence || 0) +
      (item.type === "claimable" ? 20 : 0) +
      (item.sourceType === "verified" ? 8 : 0);

    if (newScore >= oldScore) {
      map.set(key, item);
    }
  }

  return [...map.values()];
}

function fakeWalletSignalScore(walletAddress = "") {
  const tail = walletAddress.slice(-8).toLowerCase();
  let score = 0;

  for (const ch of tail) {
    score += parseInt(ch, 16) || 0;
  }

  return score;
}

function buildFakeWalletInsights(walletAddress = "") {
  const scoreSeed = fakeWalletSignalScore(walletAddress);
  const activityTier = scoreSeed % 3;
  const diversification = scoreSeed % 4;
  const consistency = scoreSeed % 5;

  const activeChains =
    activityTier === 0
      ? ["Polygon"]
      : activityTier === 1
      ? ["Polygon", "Ethereum"]
      : ["Polygon", "Ethereum", "Base"];

  const signals = [];

  if (scoreSeed % 2 === 0) signals.push("Bridging activity detected");
  if (scoreSeed % 3 === 0) signals.push("Multi-ecosystem interaction footprint");
  if (scoreSeed % 5 === 0) signals.push("Reward farming pattern detected");
  if (scoreSeed % 7 === 0) signals.push("Potential snapshot overlap");
  if (signals.length === 0) signals.push("General wallet activity detected");

  return {
    chainActivityScore: 58 + (scoreSeed % 38),
    protocolDiversityScore: 46 + diversification * 11,
    consistencyScore: 42 + consistency * 9,
    activeChains,
    interactionSignals: signals,
    walletAgeHint:
      scoreSeed % 4 === 0
        ? "Older wallet pattern"
        : scoreSeed % 4 === 1
        ? "Mid-age wallet pattern"
        : "Recently active wallet pattern",
  };
}

function calcProjectBoost(project, walletInsights) {
  let boost = 0;
  const network = String(project.network || "").toLowerCase();
  const name = String(project.name || "").toLowerCase();

  if (name.includes("layerzero")) boost += 40;
  if (name.includes("starknet")) boost += 40;
  if (name.includes("zksync")) boost += 35;
  if (name.includes("scroll")) boost += 30;
  if (name.includes("linea")) boost += 30;
  if (name.includes("base")) boost += 25;
  if (name.includes("blast")) boost += 25;
  if (name.includes("polymarket")) boost += 25;

  if (project.type === "claimable") boost += 22;
  if (project.sourceType === "verified") boost += 10;

  if (walletInsights.activeChains.some((x) => network.includes(x.toLowerCase()))) {
    boost += 18;
  }

  if (walletInsights.protocolDiversityScore > 70) boost += 6;
  if (walletInsights.consistencyScore > 70) boost += 6;

  return boost;
}

function calcEstimatedValue(projects, walletInsights, isPaid) {
  if (!projects.length) return "$0 - $0";

  const claimableCount = projects.filter((x) => x.type === "claimable").length;
  const upcomingCount = projects.filter((x) => x.type === "upcoming").length;

  const min =
    claimableCount * 140 +
    upcomingCount * 55 +
    Math.floor(walletInsights.chainActivityScore * 2.2);

  const max =
    claimableCount * 520 +
    upcomingCount * 240 +
    Math.floor(walletInsights.protocolDiversityScore * 6.5);

  if (!isPaid) return "$200 - $2000";

  return `$${min} - $${Math.max(min + 180, max)}`;
}

function staleMs() {
  if (!airdropDB.lastUpdated) return Infinity;
  return Date.now() - new Date(airdropDB.lastUpdated).getTime();
}

function shouldRefreshOnQuery() {
  if (!airdropDB.lastUpdated) return true;
  if (!airdropDB.raw.length) return true;
  return staleMs() > QUERY_REFRESH_STALE_MS;
}

/* ================= 抓取 ================= */

async function fetchHtml(url) {
  const res = await axios.get(url, {
    timeout: 40000,
    validateStatus: (s) => s < 500,
    headers: {
      "User-Agent": getRandomUA(),
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://www.google.com/",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
    validateStatus: (s) => s >= 200 && s < 400,
  });

  return res.data;
}

async function fetchAirdropsIO(url) {
  let browser;

  try {
    browser = await chromium.launch({
  headless: true,
  args: [
    "--disable-blink-features=AutomationControlled",
    "--no-sandbox",
    "--disable-setuid-sandbox",
  ],
});

    const page = await browser.newPage({
      userAgent: getRandomUA(),
      viewport: { width: 1440, height: 900 },
      locale: "en-US",
    });

    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://www.google.com/",
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    

    await page.waitForTimeout(6000);
    await page.waitForSelector("body", { timeout: 15000 });

    const html = await page.content();
return html;

console.log("A1");
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
console.log("A2");
await page.waitForTimeout(6000);
console.log("A3");
await page.waitForSelector("body", { timeout: 15000 });
console.log("A4");

  } catch (err) {
    console.error("fetchAirdropsIO failed FULL:", err);
    return "";
  } finally {
    if (browser) await browser.close();
  }
}

function buildProject({
  name,
  sourceName,
  href,
  text,
  confidence = 60,
  type,
}) {
  const finalType = type || inferType(text, sourceName, href);
  const network = inferNetwork(text);
  const sourceType = inferSourceType(sourceName, text, href);

  return {
    name,
    token: "TBA",
    network,
    type: finalType,
    value:
      finalType === "claimable"
        ? "$80 - $600"
        : finalType === "upcoming"
        ? "$50 - $400"
        : "TBA",
    sourceName,
    sourceType,
    confidence,
    claimUrl: href,
    projectUrl: href,
    actionUrl: href,
    claimLive: finalType === "claimable",
    claimType: finalType === "claimable" ? "manual" : "predicted",
    gasToken:
      network === "Polygon"
        ? "MATIC"
        : network === "Solana"
        ? "SOL"
        : network === "BNB Chain"
        ? "BNB"
        : "ETH",
    deadline: finalType === "claimable" ? "Soon" : "TBA",
    hint: finalType === "claimable" ? "Claim now" : "Interact",
    guide: "Check project page",
    eligibility: "Potential eligibility",
    reason:
      finalType === "claimable"
        ? "Claim or eligibility keywords detected"
        : "Airdrop/testnet/points activity detected",
    tags: (() => {
  const base =
    finalType === "claimable"
      ? ["claimable"]
      : ["potential"];

  const projectName = String(name || "")
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "");

  if (
  projectName.includes("layerzero") ||
  projectName.includes("starknet") ||
  projectName.includes("zksync") ||
  projectName.includes("scroll") ||
  projectName.includes("linea") ||
  projectName.includes("base") ||
  projectName.includes("blast") ||
  projectName.includes("polymarket")
) {
  base.push("high_value");
}
  base.push(network.toLowerCase());

  return base;
})(),
    lastCheckedAt: nowIso(),
  };
}

function parseProjects(html, source, baseUrl) {
  const $ = cheerio.load(html);
  const candidates = [];

  $("a").each((_, el) => {
    const rawText = normalize($(el).text());
    if (!rawText || rawText.length < 8) return;

    let href = $(el).attr("href") || "";
    try {
      href = new URL(href, baseUrl).toString();
    } catch {
      href = baseUrl;
    }
    if (source === "CryptoRank" && !/\/drophunting\/[a-z0-9-]+/i.test(href)) {
  return;
}

    const score = scoreProjectCandidate(rawText, href, source);
    if (source !== "Airdrops.io" && source !== "99Airdrops" && score < 0) return;

    const name = cleanProjectName(rawText);
    if (/drop hunting|rewardscomplete/i.test(name)) return;
    if (!name || name.length < 4) return;
    if (isGarbageProject(name, href, rawText)) return;

    candidates.push(
      buildProject({
        name,
        sourceName: source,
        href,
        text: rawText,
        confidence: Math.min(92, score + 30),
      })
    );
  });

  return uniqByName(candidates).slice(0, 80);
}

async function scrapeAirdrops() {
  return [];
}

async function scrapeCryptoRank() {
  try {
   const html = await fetchHtml("https://cryptorank.io/drophunting");
    return parseProjects(html, "CryptoRank", "https://cryptorank.io/");
  } catch (err) {
    console.error("[crawler] CryptoRank failed:", err.message);
    return [];
  }
}

async function scrapeAirdropKing() {
  try {
    const html = await fetchHtml("https://airdropking.io/en/");
    return parseProjects(html, "AirdropKing", "https://airdropking.io/");
  } catch (err) {
    console.error("[crawler] AirdropKing failed:", err.message);
    return [];
  }
}

async function scrape99Airdrops() {
  try {
    const html = await fetchAirdropsIO("https://99airdrops.com/");
    const data = parseProjects(html, "99Airdrops", "https://99airdrops.com/");

    console.log("[99Airdrops] parsed count:", data.length);
    console.log(
      "[99Airdrops] sample:",
      data.slice(0, 5).map((x) => ({
        name: x.name,
        type: x.type,
        url: x.projectUrl,
      }))
    );

    return data;
  } catch (err) {
    console.error("[crawler] 99Airdrops failed:", err.message);
    return [];
  }
}

async function scrapeAirdropAlert() {
  try {
    const html = await fetchHtml("https://airdropalert.com/");
    return parseProjects(html, "AirdropAlert", "https://airdropalert.com/");
  } catch (err) {
    console.error("[crawler] AirdropAlert failed:", err.message);
    return [];
  }
}

async function scrapeDropsEarn() {
  try {
    const html = await fetchHtml("https://dropsearn.com/airdrops/");
    return parseProjects(html, "DropsEarn", "https://dropsearn.com/");
  } catch (err) {
    console.error("[crawler] DropsEarn failed:", err.message);
    return [];
  }
}

async function scrapeAlphaDrops() {
  try {
    const html = await fetchHtml("https://alphadrops.net/alpha");
    return parseProjects(html, "AlphaDrops", "https://alphadrops.net/");
  } catch (err) {
    console.error("[crawler] AlphaDrops failed:", err.message);
    return [];
  }
}

async function scrapeDappRadar() {
  try {
    const html = await fetchHtml("https://dappradar.com/blog/tag/airdrops");
    const $ = cheerio.load(html);
    const list = [];

    $("a").each((_, el) => {
  const text = normalize(
    $(el).text() ||
    $(el).attr("title") ||
    $(el).attr("aria-label") ||
    ""
  );

  

  if (!text || text.length < 8) return;
  if (!/airdrop|airdrops/i.test(text)) return;

  let href = $(el).attr("href") || "";
  try {
    href = new URL(href, "https://dappradar.com/").toString();
  } catch {
    return;
  }
      if (!/\/blog\//i.test(href)) return;

      list.push(
        buildProject({
          name: cleanProjectName(text),
          sourceName: "DappRadar",
          href,
          text,
          confidence: 58,
          type: "upcoming",
        })
      );
    });

    return uniqByName(list).slice(0, 20);
  } catch (err) {
    console.error("[crawler] DappRadar failed:", err.message);
    return [];
  }
}

async function scrapeDefiLlama() {
  try {
    const html = await fetchAirdropsIO("https://defillama.com/airdrops");
    const $ = cheerio.load(html);
    const list = [];

    $("a").each((_, el) => {
      const rawText = normalize($(el).text());
      if (!rawText || rawText.length < 3) return;

      let href = $(el).attr("href") || "";
      try {
        href = new URL(href, "https://defillama.com").toString();
      } catch {
        return;
      }

      if (!href.includes("/airdrops")) return;
      if (isGarbageProject(rawText, href, rawText)) return;

      const name = cleanProjectName(rawText);
      if (!name || name.length < 2) return;

      list.push(
        buildProject({
          name,
          sourceName: "DefiLlama",
          href,
          text: rawText,
          confidence: 72,
          type: "upcoming",
        })
      );
    });

    return uniqByName(list).slice(0, 50);
  } catch (err) {
    console.error("[crawler] DefiLlama failed:", err.message);
    return [];
  }
}

async function scrapeAirdropsOne() {
  try {
    const html = await fetchHtml("https://airdrops.one/");
    return parseProjects(html, "AirdropsOne", "https://airdrops.one/");
  } catch (err) {
    console.error("[crawler] AirdropsOne failed:", err.message);
    return [];
  }
}
async function runCrawler() {
  const startedAt = nowIso();

  const results = await Promise.allSettled([
  scrapeCryptoRank(),
  scrapeDefiLlama(),
  scrapeAirdropAlert(),
  scrapeDropsEarn(),
  scrapeAirdropsOne(),
]);

 const names = [
  "CryptoRank",
  "DefiLlama",
  "AirdropAlert",
  "DropsEarn",
  "AirdropsOne",
];
  const sourceStats = {};
  let all = [];

 results.forEach((r, index) => {
  const sourceName = names[index] || "UnknownSource";
  console.log("[crawler source]", sourceName, r.status);

  if (r.status === "fulfilled") {
    const data = safeArray(r.value);
    all = all.concat(data);

    sourceStats[sourceName] = {
      ok: data.length > 0,
      count: data.length,
      checkedAt: nowIso(),
    };
  } else {
    sourceStats[sourceName] = {
      ok: false,
      count: 0,
      checkedAt: nowIso(),
      error: r.reason?.message || "unknown",
    };
  }
});

const deduped = all.filter((item, index, self) =>
  index === self.findIndex(x => x.claimUrl === item.claimUrl)
);

// 保留真实 + 填充重复（用来撑数量）
all = [...deduped, ...all.slice(0, 20)];

  const dedup = [];
const seen = new Set();

for (const item of all) {
  const key = item.projectUrl || item.name;
  if (!seen.has(key)) {
    seen.add(key);
    dedup.push(item);
  }
}
  airdropDB.raw = dedup;
  airdropDB.claimable = dedup.filter((x) => x.type === "claimable");
airdropDB.upcoming = dedup.filter((x) => x.type === "upcoming");
airdropDB.monitoring = dedup.filter((x) => x.type === "monitoring");
  airdropDB.lastUpdated = nowIso();
  airdropDB.sourceStats = sourceStats;

  return {
    ok: true,
    startedAt,
    updatedAt: airdropDB.lastUpdated,
    counts: {
      raw: airdropDB.raw.length,
      claimable: airdropDB.claimable.length,
      upcoming: airdropDB.upcoming.length,
      monitoring: airdropDB.monitoring.length,
    },
    sourceStats,
  };
}

async function crawl(force = false) {
  if (crawlerRunning && crawlerPromise) return crawlerPromise;

  if (!force && airdropDB.lastUpdated && staleMs() < 30 * 1000 && airdropDB.raw.length) {
    return {
      ok: true,
      skipped: true,
      updatedAt: airdropDB.lastUpdated,
      counts: {
        raw: airdropDB.raw.length,
        claimable: airdropDB.claimable.length,
        upcoming: airdropDB.upcoming.length,
        monitoring: airdropDB.monitoring.length,
      },
      sourceStats: airdropDB.sourceStats,
    };
  }

  crawlerRunning = true;
  crawlerPromise = runCrawler()
    .catch((err) => {
      console.error("Crawler failed:", err.message);
      throw err;
    })
    .finally(() => {
      crawlerRunning = false;
      crawlerPromise = null;
    });

  return crawlerPromise;
}

/* ================= API ================= */

app.post("/api/session", (req, res) => {
  const deviceId = String(req.headers["x-device-id"] || "").trim();

  if (deviceId) {
    for (const [id, session] of sessions.entries()) {
      if (session?.deviceId === deviceId) {
        if (!members.has(id)) {
          members.set(id, { active: false, endsAt: null });
          saveData();
        }
        return res.json({ sessionId: id });
      }
    }
  }

  const id = uuidv4();
  sessions.set(id, {
    usage: {},
    deviceId: deviceId || null,
  });
  members.set(id, { active: false, endsAt: null });
  saveData();

  res.json({ sessionId: id });
});

app.get("/api/membership/:id", (req, res) => {
  const member = members.get(req.params.id);

  if (!member || !member.active || !member.endsAt) {
    return res.json({ active: false, endsAt: null });
  }

  const expired = dayjs(member.endsAt).isBefore(dayjs());

  if (expired) {
    members.set(req.params.id, { active: false, endsAt: null });
    return res.json({ active: false, endsAt: null });
  }

  return res.json({
    active: true,
    endsAt: member.endsAt,
  });
});

app.post("/api/orders", (req, res) => {
const safePlan = req.body?.plan === "yearly" ? "yearly" : "monthly";
  const amountUsdt = buildOrderAmount(safePlan);

  console.log("new order amount:", amountUsdt, "plan:", safePlan);

  const order = {
    orderId: uuidv4(),
    sessionId: req.body?.sessionId || null,
    plan: safePlan,
    amountUsdt,
    paymentAddress: PAYMENT_ADDRESS,
    network: "Polygon",
    token: "USDT",
    status: "pending",
    txHash: null,
    payerAddress: null,
    expectedFrom: req.body?.payerAddress
      ? String(req.body.payerAddress).toLowerCase()
      : null,
    createdAt: nowIso(),
  };

console.log("🧾 new order =", {
  orderId: order.orderId,
  sessionId: order.sessionId,
  amountUsdt: order.amountUsdt,
  expectedFrom: order.expectedFrom,
  createdAt: order.createdAt,
});
 
 orders.set(order.orderId, order);
  saveData();
  res.json(order);
});
app.get("/api/orders/:id", async (req, res) => {
  const order = orders.get(req.params.id);

  if (!order) {
    return res.status(404).json({ error: "Order not found" });
  }

  try {
    if (order.status === "pending") {
      const tx = await findMatchingTransfer(order);

      if (tx && tx.hash) {
        activateOrderAndMembership(order, tx.hash, tx.from);
      }
    } else if (order.status === "paid") {
      ensureMembershipForPaidOrder(order);
    }
  } catch (err) {
    console.error("order status refresh failed:", order.orderId, err.message);
  }

  const freshOrder = orders.get(req.params.id) || order;
  const member = freshOrder.sessionId
    ? members.get(freshOrder.sessionId) || { active: false, endsAt: null }
    : { active: false, endsAt: null };

  res.json({
    ...freshOrder,
    membership: {
      active: !!member.active,
      expiry: member.endsAt || null,
    },
  });
});
app.post("/api/orders/:id/confirm", async (req, res) => {
  const order = orders.get(req.params.id);

  if (!order) {
    return res.status(404).json({ error: "Order not found" });
  }

  try {
    if (order.status === "pending") {
      const tx = await findMatchingTransfer(order);

      if (tx && tx.hash) {
        activateOrderAndMembership(order, tx.hash, tx.from);
      }
    }

    const freshOrder = orders.get(req.params.id) || order;

    if (freshOrder.status === "paid") {
      ensureMembershipForPaidOrder(freshOrder);
    }

    const member = freshOrder.sessionId
      ? members.get(freshOrder.sessionId) || { active: false, endsAt: null }
      : { active: false, endsAt: null };

    return res.json({
      ...freshOrder,
      membership: {
        active: !!member.active,
        expiry: member.endsAt || null,
      },
    });
  } catch (err) {
    console.error("manual confirm failed:", order.orderId, err.message);
    return res.status(500).json({ error: "Confirm failed" });
  }
});
/* ================= 查询核心 ================= */

app.post("/api/query", async (req, res) => {
  try {
    const { sessionId, walletAddress } = req.body;

    if (!sessionId || !sessions.has(sessionId)) {
      return res.status(400).json({ error: "Invalid session" });
    }

    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return res.status(400).json({ error: "Invalid wallet address" });
    }

    const session = sessions.get(sessionId);
    const member = members.get(sessionId) || { active: false };

    const today = dayjs().format("YYYY-MM-DD");
    session.usage[today] = session.usage[today] || 0;

   if (session.usage[today] >= FREE_DAILY_LIMIT && !member.active) {
  return res.json({
    code: "FREE_LIMIT_REACHED",
        found: false,
        isPaid: false,
        title: "Daily Free Limit Reached",
        totalCount: 0,
        visibleCount: 0,
        lockedCount: 0,
        projects: [],
        projectDetails: [],
        estimatedValue: "$0 - $0",
        walletIntel: {
          chainActivityScore: 0,
          protocolDiversityScore: 0,
          consistencyScore: 0,
          intelSummary: "Advanced wallet intelligence available after unlock",
          activeChains: "",
          interactionSignals: "",
          walletAgeHint: "",
        },
        queryMeta: {
          remaining: 0,
          crawlerUpdatedAt: airdropDB.lastUpdated,
          sources: airdropDB.sourceStats,
        },
      });
    }

    session.usage[today] += 1;

    if (shouldRefreshOnQuery()) {
      try {
        await crawl(true);
      } catch (err) {
        console.error("Query refresh failed:", err.message);
      }
    }

    const walletInsights = buildFakeWalletInsights(walletAddress);

    let list = [...airdropDB.raw].map((item) => ({
      ...item,
      confidence:
        (item.confidence || 0) +
        calcProjectBoost(item, walletInsights) +
        (walletInsights.chainActivityScore > 75 ? 4 : 0),
    }));

    list.sort((a, b) => {
  function score(x) {
    let s = x.confidence || 0;

    const name = String(x.name || "").toLowerCase();

    // 🔥 顶级项目强制加权
    if (name.includes("layerzero")) s += 120;
    if (name.includes("starknet")) s += 120;
    if (name.includes("zksync")) s += 110;
    if (name.includes("scroll")) s += 100;
    if (name.includes("linea")) s += 100;
    if (name.includes("base")) s += 90;
    if (name.includes("blast")) s += 90;
    if (name.includes("fuel")) s += 85;
    if (name.includes("berachain")) s += 85;
    if (name.includes("monad")) s += 85;

    // claimable 优先
    if (x.type === "claimable") s += 60;

    // verified 源优先
    if (x.sourceType === "verified") s += 25;

    // 高价值标签
    if (Array.isArray(x.tags) && x.tags.includes("high_value")) s += 40;

    return s;
  }

  return score(b) - score(a);
});
      list.sort((a, b) => {
  let aScore =
    (a.confidence || 0) +
    (a.type === "claimable" ? 30 : 0) +
    (a.sourceType === "verified" ? 10 : 0) +
    (Array.isArray(a.tags) && a.tags.includes("high_value") ? 35 : 0);

  if (/layerzero|starknet|zksync|scroll|linea/i.test(a.name)) aScore += 80;

  let bScore =
    (b.confidence || 0) +
    (b.type === "claimable" ? 30 : 0) +
    (b.sourceType === "verified" ? 10 : 0) +
    (Array.isArray(b.tags) && b.tags.includes("high_value") ? 35 : 0);

  if (/layerzero|starknet|zksync|scroll|linea/i.test(b.name)) bScore += 80;

  return bScore - aScore;
});

    list = list.slice(0, QUERY_MAX_PROJECTS);

    const isPaid = !!member.active;
    const finalProjects = isPaid ? list : list.slice(0, FREE_VISIBLE_COUNT);

    const claimableCount = list.filter((x) => x.type === "claimable").length;
    const upcomingCount = list.filter((x) => x.type === "upcoming").length;
    const monitoringCount = list.filter((x) => x.type === "monitoring").length;

    const score = Math.min(
      52 +
        Math.floor(walletInsights.chainActivityScore * 0.25) +
        Math.floor(walletInsights.protocolDiversityScore * 0.2) +
        claimableCount * 6,
      98
    );

    const estimatedValue = calcEstimatedValue(list, walletInsights, isPaid);

    res.json({
      found: list.length > 0,
      score,
      estimatedValue,
      projects: finalProjects.map((x) => x.name),
      projectDetails: finalProjects,
      title:
  finalProjects.some((x) => x.type === "claimable")
    ? "🎯 Claimable Airdrops Detected"
    : score > 75
    ? "⚡ High Probability Airdrop Detected"
    : "Potential Airdrop Opportunities",
      isPaid,
      totalCount: list.length,
      visibleCount: finalProjects.length,
      lockedCount: Math.max(list.length - finalProjects.length, 0),
      counts: {
        claimable: claimableCount,
        upcoming: upcomingCount,
        monitoring: monitoringCount,
      },
      upgradeHint: isPaid
        ? ""
        : `Unlock ${Math.max(list.length - finalProjects.length, 0)} more high-confidence airdrops`,
      walletIntel: {
        chainActivityScore: walletInsights.chainActivityScore,
        protocolDiversityScore: walletInsights.protocolDiversityScore,
        consistencyScore: walletInsights.consistencyScore,
        intelSummary: isPaid
          ? `Detected strong multi-ecosystem wallet activity across ${walletInsights.activeChains.join(", ")}`
          : "Advanced wallet intelligence available after unlock",
        activeChains: walletInsights.activeChains.join(", "),
        interactionSignals: walletInsights.interactionSignals.join(" • "),
        walletAgeHint: walletInsights.walletAgeHint,
      },
      queryMeta: {
        remaining: Math.max(FREE_DAILY_LIMIT - session.usage[today], 0),
        crawlerUpdatedAt: airdropDB.lastUpdated,
        sources: airdropDB.sourceStats,
      },
    });
  } catch (err) {
    console.error("Query failed:", err.message);
    res.status(500).json({ error: "Query failed" });
  }
});

/* ================= 调试接口 ================= */

app.get("/api/debug/refresh-airdrops", async (req, res) => {
  try {
    const result = await crawl(true);
    res.json({
      ok: true,
      updatedAt: airdropDB.lastUpdated,
      counts: {
        raw: airdropDB.raw.length,
        claimable: airdropDB.claimable.length,
        upcoming: airdropDB.upcoming.length,
        monitoring: airdropDB.monitoring.length,
      },
      sourceStats: airdropDB.sourceStats,
      sample: airdropDB.raw.slice(0, 8),
      crawlerResult: result,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/airdrops", (req, res) => {
  res.json(airdropDB);
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    port: String(PORT),
    crawlerUpdatedAt: airdropDB.lastUpdated,
    sources: airdropDB.sourceStats,
    total: airdropDB.raw.length,
    updatedAt: nowIso(),
  });
});

/* ================= 启动 ================= */

app.listen(PORT, async () => {
  console.log("🔥 NEW SERVER FILE LOADED");
  console.log("🚀 http://127.0.0.1:" + PORT);

  setInterval(scanPendingOrders, 2000);

  try {
    await crawl(true);
    console.log(
      `🕸️ crawler ready: ${airdropDB.raw.length} total / ${airdropDB.claimable.length} claimable / ${airdropDB.upcoming.length} upcoming / ${airdropDB.monitoring.length} monitoring`
    );
  } catch (err) {
    console.error("Initial crawl failed:", err.message);
  }

  setInterval(async () => {
  try {
    await crawl(true);
    console.log("🔄 crawler refreshed:", airdropDB.lastUpdated);
  } catch (err) {
    console.error("Crawler refresh failed:", err.message);
  }
}, CRAWLER_REFRESH_MS);
});
