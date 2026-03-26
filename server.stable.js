require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const dayjs = require("dayjs");
const axios = require("axios");
const cheerio = require("cheerio");
const { chromium } = require("playwright");
console.log("🔥 RUNNING FILE:", __filename);

const app = express();
const PORT = 8787;

const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "WIR9UUQQ7ZFK81YKU2F8GQJCCV2Q6IQS89";
const POLYGON_CHAIN_ID = "137";

// 你收的是 Polygon 上的 USDT，就用这个合约
const POLYGON_USDT_CONTRACT = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";

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

function sameAmount(a, b) {
  return Number(a).toFixed(3) === Number(b).toFixed(3);
}

function txAlreadyUsed(txHash, currentOrderId) {
  for (const [id, o] of orders.entries()) {
    if (id !== currentOrderId && o.txHash === txHash) {
      return true;
    }
  }
  return false;
}

async function findMatchingTransfer(order) {
  const url = "https://api.etherscan.io/v2/api";

  let resp;

try {
  resp = await axios.get(url, {
    params: {
      chainid: POLYGON_CHAIN_ID,
      module: "account",
      action: "tokentx",
      contractaddress: POLYGON_USDT_CONTRACT,
      address: PAYMENT_ADDRESS,
      page: 1,
      offset: 200,
      sort: "desc",
      apikey: ETHERSCAN_API_KEY,
    },
    timeout: 30000,
  });
} catch (e) {
  console.log("etherscan request failed:", e.message);
  return null;
}
const txs = resp?.data?.result || [];

  const list = resp?.data?.result;
  if (!Array.isArray(list)) return null;

  const createdAtMs = new Date(order.createdAt).getTime();
  const expectedRaw = String(Math.round(Number(order.amountUsdt) * 1e6));
  const paymentAddressLower = String(PAYMENT_ADDRESS).toLowerCase();

  const hit = list.find((tx) => {
    const to = String(tx.to || "").toLowerCase();
    const from = String(tx.from || "").toLowerCase();
    const txHash = String(tx.hash || "");
    const txTimeMs = Number(tx.timeStamp || 0) * 1000;
    const valueRaw = String(tx.value || "");
    const confirmations = Number(tx.confirmations || 0);
    const isError = String(tx.isError || "0");
    const contractAddress = String(tx.contractAddress || "").toLowerCase();
console.log("checking tx:", txHash, "amount:", valueRaw);
    return (
  to === paymentAddressLower &&
  from !== paymentAddressLower &&
  contractAddress === POLYGON_USDT_CONTRACT.toLowerCase() &&
  Math.abs(Number(valueRaw) - Number(expectedRaw)) <= 20 &&
  txTimeMs > createdAtMs - 5 * 60 * 1000 &&
txTimeMs < createdAtMs + 30 * 60 * 1000 &&
  isError === "0" &&
  confirmations >= 1 &&
  txHash.length === 66 &&
  !txAlreadyUsed(txHash, order.orderId)
);
  });

  return hit || null;
}



async function scanPendingOrders() {
  const pendingOrders = Array.from(orders.values()).filter(
    (o) => o.status === "pending"
  );

  for (const order of pendingOrders) {
    try {
      const tx = await findMatchingTransfer(order);
      if (!tx || !tx.hash) continue;

     if (!tx) continue;

console.log("MATCHED TX DEBUG", {
  orderId: order.orderId,
  orderAmount: order.amountUsdt,
  orderCreatedAt: order.createdAt,
  txHash: tx.hash,
  txFrom: tx.from,
  txTo: tx.to,
  txValue: tx.value,
  txTimeStamp: tx.timeStamp,
  txContract: tx.contractAddress,
});

activateOrderAndMembership(order, tx.hash);
console.log(
  "auto paid:",
  order.orderId,
  "amount:",
  order.amountUsdt,
  "tx:",
  tx.hash
);
    } catch (err) {
      console.error("scan pending order failed:", order.orderId, err.message);
    }
  }
}

// setInterval(scanPendingOrders, 5000);

function activateOrderAndMembership(order, realTxHash) {
  order.status = "paid";
  order.txHash = realTxHash; // ✅ 用真实链上 hash
  orders.set(order.orderId, order);

  const sessionId = order.sessionId;
  if (sessionId) {
    const endsAt =
      order.plan === "yearly"
        ? dayjs().add(1, "year").toISOString()
        : dayjs().add(30, "day").toISOString();

    members.set(sessionId, { active: true, endsAt });
  }

  return order;
}


// ✅ 放在这里（全局函数）
function buildOrderAmount(plan) {
  const base = plan === "yearly" ? 39.99 : 4.99;
  const tail = Math.floor(Math.random() * 9) + 1;
  return Number((base + tail / 1000).toFixed(3));
}

// 下面才是各种 app.use / app.post / app.get

app.use(cors());
app.use(express.json());

const FREE_DAILY_LIMIT = 5;
const QUERY_MAX_PROJECTS = 18;
const FREE_VISIBLE_COUNT = 4;
const CRAWLER_REFRESH_MS = 30 * 60 * 1000;
const QUERY_REFRESH_STALE_MS = 10 * 60 * 1000;

const PAYMENT_ADDRESS = "0x0d0a861dc4af093b31dc60bc591369233bd4536c";

const sessions = new Map();
const members = new Map();
const orders = new Map();

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
    hay.includes("now live")
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
    hay.includes("/drophunting/")
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
    timeout: 20000,
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
    value: finalType === "claimable" ? "$80 - $600" : "TBA",
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
    tags:
      finalType === "claimable"
        ? ["claimable", network.toLowerCase()]
        : ["potential", network.toLowerCase()],
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
    if (source !== "Airdrops.io" && score < 0) return;

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
        value: score > 50 ? "$500+" : "$50-$200",
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

  if (source === "Airdrops.io") console.log("A:", text);

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

async function runCrawler() {
  const startedAt = nowIso();

 const results = await Promise.allSettled([
  scrapeAirdrops(),
  scrapeCryptoRank(),
]);

 const names = [
  "Airdrops.io",
  "CryptoRank",
  "DappRadar",
];
  const sourceStats = {};
  let all = [];

  results.forEach((r, index) => {
    const sourceName = names[index];

    if (r.status === "fulfilled") {
      const data = safeArray(r.value);
      all = all.concat(data);

      const safeSourceName = sourceName || "UnknownSource";

sourceStats[safeSourceName] = {
  ok: data.length > 0,
  count: data.length,
  checkedAt: nowIso(),
};
    } else {
      sourceStats[safeSourceName] = {
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
  const id = uuidv4();
  sessions.set(id, { usage: {} });
  members.set(id, { active: false, endsAt: null });
  res.json({ sessionId: id });
});

app.get("/api/membership/:id", (req, res) => {
  res.json(members.get(req.params.id) || { active: false, endsAt: null });
});

app.post("/api/orders", (req, res) => {
  const plan = req.body?.plan === "yearly" ? "yearly" : "monthly";
const baseAmount = buildOrderAmount(plan);

  // ✅ 关键：生成唯一尾数（0.0001 ~ 0.0099）
  const uniqueOffset = Number((Math.random() * 0.009 + 0.001).toFixed(3));
  const amountUsdt = Number((baseAmount + uniqueOffset).toFixed(3));

  console.log("new order amount:", amountUsdt, "plan:", req.body?.plan);

  const order = {
    orderId: uuidv4(),
    sessionId: req.body?.sessionId || null,
    amountUsdt,
    baseAmount,
    uniqueOffset, // 🔥 用于链上匹配
    paymentAddress: PAYMENT_ADDRESS,
    network: "Polygon",
    token: "USDT",
    status: "pending",
    txHash: null,
    createdAt: nowIso(),
  };

  orders.set(order.orderId, order);
  res.json(order);
});

function isoToUnix(isoString) {
  return Math.floor(new Date(isoString).getTime() / 1000);
}

function isOrderExpired(order, minutes = 30) {
  const created = new Date(order.createdAt).getTime();
  return Date.now() - created > minutes * 60 * 1000;
}

function usdtToRaw(amountUsdt) {
  return String(Math.round(Number(amountUsdt) * 1e6));
}

async function findMatchingUsdtPayment(order) {
  const url =
    `https://api.etherscan.io/v2/api` +
    `?chainid=${POLYGON_CHAIN_ID}` +
    `&module=account` +
    `&action=tokentx` +
    `&contractaddress=${POLYGON_USDT_CONTRACT}` +
    `&address=${PAYMENT_ADDRESS}` +
    `&startblock=0` +
    `&page=1` +
    `&offset=100` +
    `&sort=desc` +
    `&apikey=${ETHERSCAN_API_KEY}`;

  const resp = await fetch(url);
  const data = await resp.json();

  if (!data || !Array.isArray(data.result)) {
    return null;
  }

  const orderCreatedAtUnix = isoToUnix(order.createdAt);
  const expectedRaw = usdtToRaw(order.amountUsdt);

  for (const tx of data.result) {
    const to = String(tx.to || "").toLowerCase();
    const tokenContract = String(tx.contractAddress || "").toLowerCase();
    const txValueRaw = String(tx.value || "");
    const txTime = Number(tx.timeStamp || 0);
    const confirmations = Number(tx.confirmations || 0);
    const isError = String(tx.isError || "0");

    if (to !== String(PAYMENT_ADDRESS).toLowerCase()) continue;
    if (tokenContract !== POLYGON_USDT_CONTRACT.toLowerCase()) continue;
    if (txValueRaw !== expectedRaw) continue;
    if (txTime < orderCreatedAtUnix - 60) continue;
    if (isError !== "0") continue;
    if (confirmations < 1) continue;

    return {
      txHash: tx.hash,
      valueUsdt: Number(tx.value) / 1e6,
      from: tx.from,
      to: tx.to,
      confirmations,
      timeStamp: tx.timeStamp,
    };
  }

  return null;
}

function activateMembershipByOrder(order, payment) {
  order.status = "paid";
  order.txHash = payment.txHash;
  order.paidAt = new Date().toISOString();

  if (order.sessionId && sessions.has(order.sessionId)) {
    const session = sessions.get(order.sessionId);
    const expiry = new Date();

    if (order.baseAmount >= 39) {
      expiry.setFullYear(expiry.getFullYear() + 1);
      session.plan = "yearly";
    } else {
      expiry.setMonth(expiry.getMonth() + 1);
      session.plan = "monthly";
    }

    session.isMember = true;
    session.membershipExpiry = expiry.toISOString();
    session.updatedAt = new Date().toISOString();

    sessions.set(order.sessionId, session);

    order.membership = {
      isMember: true,
      plan: session.plan,
      expiry: session.membershipExpiry,
    };
  }

  orders.set(order.orderId, order);
}

async function refreshOrderStatus(order) {
  if (!order) return null;

  if (order.status === "paid") return order;
  if (order.status === "expired") return order;

  if (isOrderExpired(order, 30)) {
    order.status = "expired";
    orders.set(order.orderId, order);
    return order;
  }

  const payment = await findMatchingUsdtPayment(order);

if (payment && payment.hash && order.status === "pending") {
  activateMembershipByOrder(order, payment);
}

  return orders.get(order.orderId);
}

app.get("/api/orders/:id", async (req, res) => {
  try {
    const order = orders.get(req.params.id);

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    const updatedOrder = await refreshOrderStatus(order);

    res.json(updatedOrder);
  } catch (err) {
    console.error("order refresh error:", err);
    res.status(500).json({ error: "refresh failed" });
  }
});

app.post("/api/orders/:id/confirm", (req, res) => {
  return res.status(403).json({
    error: "Manual confirm disabled. Order status must be determined by on-chain payment check.",
  });
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
        code: "LIMIT",
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
      const aScore =
        (a.confidence || 0) +
        (a.type === "claimable" ? 30 : 0) +
        (a.sourceType === "verified" ? 10 : 0);

      const bScore =
        (b.confidence || 0) +
        (b.type === "claimable" ? 30 : 0) +
        (b.sourceType === "verified" ? 10 : 0);

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
          ? "Claimable Airdrops Detected"
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

app.post("/api/debug/refresh-airdrops", async (req, res) => {
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

app.listen(PORT, '0.0.0.0', async () => {
  console.log("🔥 NEW SERVER FILE LOADED");
  console.log("🚀 Server running on port " + PORT);

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