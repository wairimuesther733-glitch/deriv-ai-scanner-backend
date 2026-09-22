const http = require("http");
const WebSocket = require("ws");

const PORT = Number(process.env.PORT) || 10000;

const DERIV_URL =
  "wss://api.derivws.com/trading/v1/options/ws/public";

const HISTORY_COUNT = 200;
const MIN_MATCH_STRENGTH = 80;
const RESCAN_MS = 60 * 1000;

const clients = new Set();
const marketData = {};

let deriv = null;
let derivConnected = false;
let reconnectTimer = null;

let availableMarkets = [];
let historyQueue = [];
let pendingHistorySymbol = null;
let waitingForActiveSymbols = false;


/* =========================
   HTTP SERVER
========================= */

const httpServer = http.createServer((req, res) => {

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "*"
  );

  if (req.url === "/health") {

    res.writeHead(200, {
      "Content-Type": "application/json"
    });

    res.end(
      JSON.stringify({
        status: "online",
        derivConnected,
        markets: availableMarkets.length,
        analysedMarkets:
          Object.keys(marketData).length,
        time: new Date().toISOString()
      })
    );

    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/plain"
  });

  res.end(
    "Deriv AI Market Scanner backend is running."
  );
});


/* =========================
   DASHBOARD WEBSOCKET
========================= */

const dashboard =
  new WebSocket.Server({
    server: httpServer
  });


dashboard.on("connection", socket => {

  clients.add(socket);

  console.log(
    "Dashboard connected"
  );

  sendToClient(socket, {
    type: "connection",
    connected: derivConnected
  });

  sendToClient(socket, {
    type: "markets",
    markets: availableMarkets
  });

  sendCurrentState(socket);

  socket.on("close", () => {
    clients.delete(socket);
  });

  socket.on("error", () => {
    clients.delete(socket);
  });

});


function sendToClient(socket, data) {

  if (
    socket.readyState ===
    WebSocket.OPEN
  ) {

    socket.send(
      JSON.stringify(data)
    );
  }
}


function broadcast(data) {

  const message =
    JSON.stringify(data);

  for (const socket of clients) {

    if (
      socket.readyState ===
      WebSocket.OPEN
    ) {

      socket.send(message);
    }
  }
}


function sendCurrentState(socket) {

  for (
    const symbol of
    Object.keys(marketData)
  ) {

    sendToClient(socket, {
      type: "market",
      data: marketData[symbol]
    });

  }
}


/* =========================
   DIGIT EXTRACTION
========================= */

function getLastDigit(value) {

  const text =
    String(value);

  if (text.includes(".")) {

    const decimalPart =
      text.split(".")[1];

    if (
      decimalPart &&
      decimalPart.length > 0
    ) {

      return Number(
        decimalPart.slice(-1)
      );
    }
  }

  return Number(
    text.slice(-1)
  );
}


/* =========================
   MARKET ANALYSIS
========================= */

function analyse(
  symbol,
  digits
) {

  if (
    !Array.isArray(digits) ||
    digits.length < 30
  ) {

    return null;
  }


  const cleanDigits =
    digits
      .map(Number)
      .filter(
        d =>
          Number.isInteger(d) &&
          d >= 0 &&
          d <= 9
      );


  if (
    cleanDigits.length < 30
  ) {

    return null;
  }


  const total =
    cleanDigits.length;


  const counts =
    Array(10).fill(0);


  for (
    const digit of
    cleanDigits
  ) {

    counts[digit]++;
  }


  let bestDigit = 0;


  for (
    let i = 1;
    i < 10;
    i++
  ) {

    if (
      counts[i] >
      counts[bestDigit]
    ) {

      bestDigit = i;
    }
  }


  const overallFrequency =
    (
      counts[bestDigit] /
      total
    ) * 100;


  const recent =
    cleanDigits.slice(-50);


  const recentCount =
    recent.filter(
      d =>
        d === bestDigit
    ).length;


  const recentFrequency =
    (
      recentCount /
      recent.length
    ) * 100;


  const previous =
    cleanDigits.slice(
      -100,
      -50
    );


  let previousFrequency = 0;


  if (
    previous.length > 0
  ) {

    const previousCount =
      previous.filter(
        d =>
          d === bestDigit
      ).length;


    previousFrequency =
      (
        previousCount /
        previous.length
      ) * 100;
  }


  const momentum =
    recentFrequency -
    previousFrequency;


  let strength =
    (
      overallFrequency * 0.50
    ) +
    (
      recentFrequency * 0.35
    ) +
    (
      Math.max(
        momentum,
        0
      ) * 0.15
    );


  strength =
    Math.max(
      0,
      Math.min(
        100,
        strength
      )
    );


  const evenCount =
    cleanDigits.filter(
      d =>
        d % 2 === 0
    ).length;


  const oddCount =
    total -
    evenCount;


  return {

    symbol,

    matchDigit:
      bestDigit,

    matchStrength:
      Number(
        strength.toFixed(1)
      ),

    matchSignal:
      strength >=
      MIN_MATCH_STRENGTH
        ? "MATCH"
        : "NO_MATCH",

    even:
      Number(
        (
          (
            evenCount /
            total
          ) * 100
        ).toFixed(1)
      ),

    odd:
      Number(
        (
          (
            oddCount /
            total
          ) * 100
        ).toFixed(1)
      ),

    ticks:
      total,

    digits:
      cleanDigits.slice(-50),

    timestamp:
      Date.now()
  };
}


/* =========================
   UPDATE MARKET
========================= */

function updateMarket(
  symbol
) {

  const market =
    marketData[symbol];


  if (!market) {
    return;
  }


  const result =
    analyse(
      symbol,
      market.digits
    );


  if (!result) {
    return;
  }


  marketData[symbol] = {
    ...market,
    ...result
  };


  broadcast({
    type: "market",
    data:
      marketData[symbol]
  });
}


/* =========================
   DISCOVER MARKETS
========================= */

function requestActiveSymbols() {

  if (
    !deriv ||
    deriv.readyState !==
      WebSocket.OPEN
  ) {

    return;
  }


  waitingForActiveSymbols =
    true;


  console.log(
    "Requesting active markets from Deriv..."
  );


  deriv.send(
    JSON.stringify({
      active_symbols:
        "brief"
    })
  );
}


/* =========================
   SELECT DIGIT MARKETS
========================= */

function processActiveSymbols(
  symbols
) {

  if (
    !Array.isArray(symbols)
  ) {

    console.log(
      "No active symbol list received."
    );

    waitingForActiveSymbols =
      false;

    return;
  }


  const discovered =
    symbols
      .map(item => {

        return {
          symbol:
            item.underlying_symbol,

          name:
            item.underlying_symbol_name,

          type:
            item.underlying_symbol_type,

          market:
            item.market,

          subgroup:
            item.subgroup
        };

      })
      .filter(item => {

        if (
          !item.symbol
        ) {

          return false;
        }


        /*
         * Digit/synthetic markets
         * used by this scanner.
         *
         * We deliberately discover
         * them from Deriv instead
         * of hard-coding symbols.
         */

        return (
          /^1HZ\d+V$/.test(
            item.symbol
          )
        );

      });


  availableMarkets =
    discovered
      .map(
        item =>
          item.symbol
      );


  console.log(
    `Discovered ${availableMarkets.length} valid digit markets.`
  );


  console.log(
    availableMarkets.join(", ")
  );


  broadcast({
    type: "markets",
    markets:
      availableMarkets
  });


  waitingForActiveSymbols =
    false;


  if (
    availableMarkets.length === 0
  ) {

    console.log(
      "No 1HZ digit markets are currently available."
    );

    return;
  }


  historyQueue =
    [
      ...availableMarkets
    ];


  requestNextHistory();
}


/* =========================
   HISTORY REQUEST QUEUE
========================= */

function requestNextHistory() {

  if (
    !deriv ||
    deriv.readyState !==
      WebSocket.OPEN
  ) {

    return;
  }


  if (
    pendingHistorySymbol
  ) {

    return;
  }


  const symbol =
    historyQueue.shift();


  if (!symbol) {

    console.log(
      "Market scan complete."
    );

    broadcast({
      type: "scan_complete",
      timestamp:
        Date.now()
    });

    return;
  }


  pendingHistorySymbol =
    symbol;


  console.log(
    `Requesting history for ${symbol}`
  );


  /*
   * One-time 200-tick request.
   *
   * No subscribe parameter.
   */

  deriv.send(
    JSON.stringify({

      ticks_history:
        symbol,

      count:
        HISTORY_COUNT,

      end:
        "latest",

      style:
        "ticks"

    })
  );
}


/* =========================
   FRESH SCAN
========================= */

function startFreshScan() {

  if (
    !deriv ||
    deriv.readyState !==
      WebSocket.OPEN
  ) {

    return;
  }


  if (
    pendingHistorySymbol ||
    waitingForActiveSymbols
  ) {

    console.log(
      "Previous scan is still running."
    );

    return;
  }


  console.log(
    "Starting fresh 60-second market scan..."
  );


  broadcast({
    type: "scan",
    timestamp:
      Date.now()
  });


  /*
   * Re-discover markets
   * every minute so invalid
   * or removed symbols never
   * remain hard-coded.
   */

  requestActiveSymbols();
}


/* =========================
   DERIV CONNECTION
========================= */

function connectDeriv() {

  if (deriv) {

    try {
      deriv.close();
    }
    catch (_) {}
  }


  console.log(
    "Connecting to Deriv..."
  );


  console.log(
    `Endpoint: ${DERIV_URL}`
  );


  historyQueue = [];

  pendingHistorySymbol =
    null;

  waitingForActiveSymbols =
    false;


  deriv =
    new WebSocket(
      DERIV_URL,
      {
        handshakeTimeout:
          15000
      }
    );


  deriv.on(
    "open",
    () => {

      derivConnected =
        true;


      console.log(
        "Connected to Deriv"
      );


      broadcast({
        type:
          "connection",

        connected:
          true
      });


      /*
       * First step:
       * discover the markets.
       */

      requestActiveSymbols();

    }
  );


  deriv.on(
    "message",
    raw => {

      try {

        const data =
          JSON.parse(
            raw.toString()
          );


        /* =================
           DERIV ERROR
        ================= */

        if (
          data.error
        ) {

          console.log(
            "Deriv error:",
            data.error.message ||
              data.error
          );


          broadcast({
            type: "error",

            message:
              data.error.message ||
              "Deriv error"
          });


          if (
            pendingHistorySymbol
          ) {

            pendingHistorySymbol =
              null;

            requestNextHistory();
          }


          if (
            data.msg_type ===
              "active_symbols"
          ) {

            waitingForActiveSymbols =
              false;
          }


          return;
        }


        /* =================
           ACTIVE SYMBOLS
        ================= */

        if (
          data.msg_type ===
            "active_symbols"
        ) {

          processActiveSymbols(
            data.active_symbols
          );

          return;
        }


        /* =================
           HISTORY
        ================= */

        if (
          data.msg_type ===
            "history" &&
          data.history &&
          Array.isArray(
            data.history.prices
          )
        ) {

          const symbol =
            pendingHistorySymbol;


          if (!symbol) {

            console.log(
              "Received history without pending symbol."
            );

            return;
          }


          const digits =
            data.history.prices
              .map(
                getLastDigit
              )
              .filter(
                d =>
                  Number.isInteger(
                    d
                  ) &&
                  d >= 0 &&
                  d <= 9
              );


          marketData[symbol] = {

            symbol,

            digits,

            ticks:
              digits.length,

            timestamp:
              Date.now()
          };


          pendingHistorySymbol =
            null;


          updateMarket(
            symbol
          );


          requestNextHistory();


          return;
        }

      }
      catch (error) {

        console.log(
          "Message error:",
          error.message
        );
      }

    }
  );


  deriv.on(
    "error",
    error => {

      console.log(
        "Deriv connection error:",
        error.message
      );

    }
  );


  deriv.on(
    "close",
    (code, reason) => {

      derivConnected =
        false;


      console.log(
        `Deriv connection closed. code=${code} reason=${reason || ""}`
      );


      broadcast({
        type:
          "connection",

        connected:
          false
      });


      pendingHistorySymbol =
        null;

      waitingForActiveSymbols =
        false;


      if (
        !reconnectTimer
      ) {

        reconnectTimer =
          setTimeout(
            () => {

              reconnectTimer =
                null;

              connectDeriv();

            },
            5000
          );
      }

    }
  );
}


/* =========================
   60 SECOND RESCAN
========================= */

setInterval(
  () => {

    startFreshScan();

  },
  RESCAN_MS
);


/* =========================
   START SERVER
========================= */

httpServer.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Backend listening on 0.0.0.0:${PORT}`
    );


    connectDeriv();

  }
);
