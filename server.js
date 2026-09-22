const http = require("http");
const WebSocket = require("ws");

const PORT = Number(process.env.PORT) || 10000;
const DERIV_URL = "wss://api.derivws.com/trading/v1/options/ws/public";

const HISTORY_COUNT = 200;
const MIN_MATCH_STRENGTH = 80;
const RESCAN_MS = 60 * 1000;
const HISTORY_TIMEOUT_MS = 10000;

const clients = new Set();
const marketData = {};

let deriv = null;
let derivConnected = false;
let reconnectTimer = null;

let availableMarkets = [];
let historyQueue = [];
let pendingHistory = null;
let historyTimer = null;
let nextReqId = 1;
let waitingForActiveSymbols = false;

const httpServer = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "online",
      derivConnected,
      markets: availableMarkets.length,
      analysedMarkets: Object.keys(marketData).length,
      time: new Date().toISOString()
    }));
    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Deriv AI Market Scanner backend is running.");
});

const dashboard = new WebSocket.Server({ server: httpServer });

dashboard.on("connection", socket => {
  clients.add(socket);
  console.log("Dashboard connected");

  send(socket, { type: "connection", connected: derivConnected });
  send(socket, { type: "markets", markets: availableMarkets });
  sendCurrentState(socket);

  socket.on("close", () => clients.delete(socket));
  socket.on("error", () => clients.delete(socket));
});

function send(socket, data) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(data));
  }
}

function broadcast(data) {
  const message = JSON.stringify(data);

  for (const socket of clients) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(message);
    }
  }
}

function sendCurrentState(socket) {
  for (const symbol of Object.keys(marketData)) {
    send(socket, {
      type: "market",
      data: marketData[symbol]
    });
  }
}

function getLastDigit(value) {
  const text = String(value);

  if (text.includes(".")) {
    const decimal = text.split(".")[1];
    if (decimal && decimal.length) {
      return Number(decimal.slice(-1));
    }
  }

  return Number(text.slice(-1));
}

function analyse(symbol, digits) {
  if (!Array.isArray(digits) || digits.length < 30) {
    return null;
  }

  const clean = digits
    .map(Number)
    .filter(d => Number.isInteger(d) && d >= 0 && d <= 9);

  if (clean.length < 30) {
    return null;
  }

  const total = clean.length;
  const counts = Array(10).fill(0);

  for (const digit of clean) {
    counts[digit]++;
  }

  let bestDigit = 0;

  for (let i = 1; i < 10; i++) {
    if (counts[i] > counts[bestDigit]) {
      bestDigit = i;
    }
  }

  const overall = counts[bestDigit] / total * 100;

  const recent = clean.slice(-50);
  const recentFrequency =
    recent.filter(d => d === bestDigit).length /
    recent.length * 100;

  const previous = clean.slice(-100, -50);
  const previousFrequency = previous.length
    ? previous.filter(d => d === bestDigit).length /
      previous.length * 100
    : 0;

  const momentum = recentFrequency - previousFrequency;

  let strength =
    overall * 0.50 +
    recentFrequency * 0.35 +
    Math.max(momentum, 0) * 0.15;

  strength = Math.max(0, Math.min(100, strength));

  const evenCount = clean.filter(d => d % 2 === 0).length;
  const oddCount = total - evenCount;

  const even = evenCount / total * 100;
  const odd = oddCount / total * 100;

  return {
    symbol,
    matchDigit: bestDigit,
    matchStrength: Number(strength.toFixed(1)),
    matchSignal: strength >= MIN_MATCH_STRENGTH ? "MATCH" : "NO_MATCH",
    even: Number(even.toFixed(1)),
    odd: Number(odd.toFixed(1)),
    evenSignal: even >= odd ? "EVEN" : "ODD",
    ticks: total,
    digits: clean.slice(-50),
    timestamp: Date.now()
  };
}

function updateMarket(symbol, digits) {
  const result = analyse(symbol, digits);

  if (!result) {
    console.log(
      "Not enough usable history for " + symbol +
      ": " + (digits ? digits.length : 0) + " digits"
    );
    return;
  }

  marketData[symbol] = result;

  console.log(
    "Analysed " + symbol +
    ": digit " + result.matchDigit +
    ", strength " + result.matchStrength +
    "%, even " + result.even +
    "%, odd " + result.odd + "%"
  );

  broadcast({
    type: "market",
    data: result
  });
}

function requestActiveSymbols() {
  if (!deriv || deriv.readyState !== WebSocket.OPEN) {
    return;
  }

  waitingForActiveSymbols = true;
  console.log("Requesting active markets from Deriv...");

  deriv.send(JSON.stringify({
    active_symbols: "brief",
    req_id: nextReqId++
  }));
}

function processActiveSymbols(symbols) {
  if (!Array.isArray(symbols)) {
    console.log("No active symbol list received.");
    waitingForActiveSymbols = false;
    return;
  }

  availableMarkets = symbols
    .map(item => item && item.underlying_symbol)
    .filter(symbol => typeof symbol === "string")
    .filter(symbol => /^1HZ\d+V$/.test(symbol));

  console.log(
    "Discovered " + availableMarkets.length +
    " valid digit markets: " +
    availableMarkets.join(", ")
  );

  broadcast({
    type: "markets",
    markets: availableMarkets
  });

  waitingForActiveSymbols = false;
  historyQueue = [...availableMarkets];

  requestNextHistory();
}

function finishPendingHistory() {
  pendingHistory = null;
  clearTimeout(historyTimer);
  historyTimer = null;
}

function requestNextHistory() {
  if (!deriv || deriv.readyState !== WebSocket.OPEN) {
    return;
  }

  if (pendingHistory) {
    return;
  }

  const symbol = historyQueue.shift();

  if (!symbol) {
    console.log("Market scan complete.");

    broadcast({
      type: "scan_complete",
      timestamp: Date.now()
    });

    return;
  }

  const reqId = nextReqId++;

  pendingHistory = {
    symbol,
    reqId
  };

  console.log(
    "Requesting history for " +
    symbol +
    " (req_id=" +
    reqId +
    ")"
  );

  deriv.send(JSON.stringify({
    ticks_history: symbol,
    count: HISTORY_COUNT,
    end: "latest",
    style: "ticks",
    subscribe: 0,
    req_id: reqId
  }));

  clearTimeout(historyTimer);

  historyTimer = setTimeout(() => {
    if (
      pendingHistory &&
      pendingHistory.symbol === symbol &&
      pendingHistory.reqId === reqId
    ) {
      console.log(
        "History timeout for " +
        symbol +
        " (req_id=" +
        reqId +
        ")"
      );

      finishPendingHistory();
      requestNextHistory();
    }
  }, HISTORY_TIMEOUT_MS);
}

function startFreshScan() {
  if (!deriv || deriv.readyState !== WebSocket.OPEN) {
    return;
  }

  if (pendingHistory || waitingForActiveSymbols) {
    console.log("Previous scan is still running.");
    return;
  }

  console.log("Starting fresh 60-second market scan...");

  broadcast({
    type: "scan",
    timestamp: Date.now()
  });

  requestActiveSymbols();
}

function connectDeriv() {
  if (deriv) {
    try {
      deriv.close();
    } catch (_) {}
  }

  clearTimeout(historyTimer);
  pendingHistory = null;
  historyQueue = [];
  waitingForActiveSymbols = false;

  console.log("Connecting to Deriv...");
  console.log("Endpoint: " + DERIV_URL);

  deriv = new WebSocket(DERIV_URL, {
    handshakeTimeout: 15000
  });

  deriv.on("open", () => {
    derivConnected = true;

    console.log("Connected to Deriv");

    broadcast({
      type: "connection",
      connected: true
    });

    requestActiveSymbols();
  });

  deriv.on("message", raw => {
    try {
      const data = JSON.parse(raw.toString());

      if (data.error) {
        console.log(
          "Deriv error:",
          data.error.message || JSON.stringify(data.error)
        );

        broadcast({
          type: "error",
          message: data.error.message || "Deriv error"
        });

        if (pendingHistory) {
          console.log(
            "Skipping failed market: " +
            pendingHistory.symbol +
            " (req_id=" +
            pendingHistory.reqId +
            ")"
          );

          finishPendingHistory();
          requestNextHistory();
        }

        if (data.msg_type === "active_symbols") {
          waitingForActiveSymbols = false;
        }

        return;
      }

      if (data.msg_type === "active_symbols") {
        processActiveSymbols(data.active_symbols);
        return;
      }

      if (data.msg_type === "history") {
        const reqId = data.req_id ?? "none";
        const pending = pendingHistory;

        console.log(
          "Received history response: req_id=" +
          reqId +
          ", pending=" +
          (pending ? pending.reqId : "none") +
          ", symbol=" +
          (pending ? pending.symbol : "none")
        );

        if (!data.history || !Array.isArray(data.history.prices)) {
          console.log("History response has no prices array.");
          return;
        }

        if (!pending) {
          console.log("History arrived without a pending request.");
          return;
        }

        if (
          data.req_id !== undefined &&
          data.req_id !== pending.reqId
        ) {
          console.log("Ignoring history for a different request.");
          return;
        }

        const digits = data.history.prices
          .map(getLastDigit)
          .filter(
            d =>
              Number.isInteger(d) &&
              d >= 0 &&
              d <= 9
          );

        console.log(
          "History received for " +
          pending.symbol +
          ": " +
          data.history.prices.length +
          " prices / " +
          digits.length +
          " digits"
        );

        const symbol = pending.symbol;

        finishPendingHistory();
        updateMarket(symbol, digits);
        requestNextHistory();
        return;
      }

      console.log(
        "Deriv message received: " +
        (data.msg_type || "unknown")
      );

    } catch (error) {
      console.log("Message error:", error.message);
    }
  });

  deriv.on("error", error => {
    console.log(
      "Deriv connection error:",
      error.message
    );
  });

  deriv.on("close", (code, reason) => {
    derivConnected = false;

    console.log(
      "Deriv connection closed. code=" +
      code +
      " reason=" +
      (reason || "")
    );

    broadcast({
      type: "connection",
      connected: false
    });

    clearTimeout(historyTimer);
    pendingHistory = null;
    waitingForActiveSymbols = false;

    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectDeriv();
      }, 5000);
    }
  });
}

setInterval(startFreshScan, RESCAN_MS);

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(
    "Backend listening on 0.0.0.0:" + PORT
  );

  connectDeriv();
});
