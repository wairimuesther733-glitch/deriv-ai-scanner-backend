const http = require("http");
const WebSocket = require("ws");

const PORT = Number(process.env.PORT) || 10000;

const DERIV_URL =
  "wss://api.derivws.com/trading/v1/options/ws/public";
const MARKETS = [
  "1HZ10V",
  "1HZ25V",
  "1HZ50V",
  "1HZ75V",
  "1HZ100V",
  "1HZ150V",
  "1HZ200V",
  "1HZ250V"
];

const HISTORY_COUNT = 200;
const MIN_MATCH_STRENGTH = 80;
const RESCAN_MS = 60 * 1000;

const clients = new Set();
const marketData = {};

let deriv = null;
let derivConnected = false;
let reconnectTimer = null;


/* -----------------------------
   HEALTH / HTTP SERVER
----------------------------- */

const httpServer = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.url === "/health") {
    res.writeHead(200, {
      "Content-Type": "application/json"
    });

    res.end(
      JSON.stringify({
        status: "online",
        derivConnected,
        markets: Object.keys(marketData).length,
        time: new Date().toISOString()
      })
    );

    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/plain"
  });

  res.end("Deriv AI Market Scanner backend is running.");
});


/* -----------------------------
   DASHBOARD WEBSOCKET SERVER
----------------------------- */

const dashboard = new WebSocket.Server({
  server: httpServer
});


dashboard.on("connection", socket => {

  clients.add(socket);

  console.log("Dashboard connected");

  sendToClient(socket, {
    type: "connection",
    connected: derivConnected
  });

  sendCurrentState(socket);

  socket.on("close", () => {
    clients.delete(socket);
    console.log("Dashboard disconnected");
  });

  socket.on("error", () => {
    clients.delete(socket);
  });

});


function sendToClient(socket, data) {

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

    sendToClient(socket, {
      type: "market",
      data: marketData[symbol]
    });

  }

}


/* -----------------------------
   DIGIT EXTRACTION
----------------------------- */

function getLastDigit(value) {

  const text = String(value);

  if (text.includes(".")) {

    const decimalPart = text.split(".")[1];

    if (decimalPart && decimalPart.length > 0) {
      return Number(decimalPart.slice(-1));
    }

  }

  return Number(text.slice(-1));

}


/* -----------------------------
   MARKET ANALYSIS
----------------------------- */

function analyse(symbol, digits) {

  if (!Array.isArray(digits) || digits.length < 30) {
    return null;
  }

  const cleanDigits = digits
    .map(Number)
    .filter(d => Number.isInteger(d) && d >= 0 && d <= 9);

  if (cleanDigits.length < 30) {
    return null;
  }


  const total = cleanDigits.length;

  const counts = Array(10).fill(0);

  for (const digit of cleanDigits) {
    counts[digit]++;
  }


  /*
    Find the most frequent digit.
  */

  let bestDigit = 0;

  for (let i = 1; i < 10; i++) {

    if (counts[i] > counts[bestDigit]) {
      bestDigit = i;
    }

  }


  const overallFrequency =
    (counts[bestDigit] / total) * 100;


  /*
    Recent 50 ticks.
  */

  const recent =
    cleanDigits.slice(-50);


  const recentCount =
    recent.filter(d => d === bestDigit).length;


  const recentFrequency =
    (recentCount / recent.length) * 100;


  /*
    Previous 50 ticks.
  */

  const previous =
    cleanDigits.slice(-100, -50);


  let previousFrequency = 0;

  if (previous.length > 0) {

    const previousCount =
      previous.filter(d => d === bestDigit).length;

    previousFrequency =
      (previousCount / previous.length) * 100;

  }


  /*
    Momentum.
  */

  const momentum =
    recentFrequency - previousFrequency;


  /*
    Statistical model score.

    This is a MODEL STRENGTH score.
    It is NOT a guaranteed probability of winning.
  */

  let strength =
    (overallFrequency * 0.50) +
    (recentFrequency * 0.35) +
    (Math.max(momentum, 0) * 0.15);


  strength =
    Math.max(0, Math.min(100, strength));


  /*
    Even / Odd.
  */

  const evenCount =
    cleanDigits.filter(d => d % 2 === 0).length;

  const oddCount =
    total - evenCount;


  const even =
    (evenCount / total) * 100;

  const odd =
    (oddCount / total) * 100;


  return {

    symbol,

    matchDigit: bestDigit,

    matchStrength:
      Number(strength.toFixed(1)),

    matchSignal:
      strength >= MIN_MATCH_STRENGTH
        ? "MATCH"
        : "NO_MATCH",

    even:
      Number(even.toFixed(1)),

    odd:
      Number(odd.toFixed(1)),

    ticks: total,

    digits:
      cleanDigits.slice(-50),

    timestamp:
      Date.now()

  };

}


/* -----------------------------
   UPDATE ANALYSIS
----------------------------- */

function updateMarket(symbol) {

  const market =
    marketData[symbol];

  if (!market) {
    return;
  }

  const result =
    analyse(symbol, market.digits);

  if (!result) {
    return;
  }

  marketData[symbol] = {
    ...market,
    ...result
  };


  broadcast({
    type: "market",
    data: marketData[symbol]
  });

}


/* -----------------------------
   CONNECT TO DERIV
----------------------------- */

function connectDeriv() {

  if (deriv) {

    try {
      deriv.close();
    } catch (_) {}

  }


  console.log("Connecting to Deriv...");

  deriv =
    new WebSocket(DERIV_URL);


  deriv.on("open", () => {

    derivConnected = true;

    console.log("Connected to Deriv");

    broadcast({
      type: "connection",
      connected: true
    });


    /*
      Request available symbols.
    */

    deriv.send(
      JSON.stringify({
        active_symbols: "brief",
        product_type: "basic",
        req_id: 1
      })
    );


    /*
      Request history and live ticks
      for every selected market.
    */

    MARKETS.forEach((symbol, index) => {

      deriv.send(
        JSON.stringify({
          ticks_history: symbol,
          count: HISTORY_COUNT,
          end: "latest",
          style: "ticks",
          req_id: 100 + index
        })
      );


      deriv.send(
        JSON.stringify({
          ticks: symbol,
          subscribe: 1,
          req_id: 200 + index
        })
      );

    });

  });


  deriv.on("message", raw => {

    try {

      const data =
        JSON.parse(raw.toString());


      if (data.error) {

        console.log(
          "Deriv error:",
          data.error.message || data.error
        );

        broadcast({
          type: "error",
          message:
            data.error.message || "Deriv error"
        });

        return;
      }


      /*
        Historical ticks.
      */

      if (
        data.msg_type === "history" &&
        data.history &&
        data.echo_req
      ) {

        const symbol =
          data.echo_req.ticks_history;


        if (!symbol) {
          return;
        }


        const prices =
          data.history.prices || [];


        const digits =
          prices
            .map(getLastDigit)
            .filter(
              d =>
                Number.isInteger(d) &&
                d >= 0 &&
                d <= 9
            );


        marketData[symbol] = {

          symbol,

          digits,

          ticks: digits.length,

          timestamp: Date.now()

        };


        updateMarket(symbol);

      }


      /*
        Live tick.
      */

      if (
        data.msg_type === "tick" &&
        data.tick
      ) {

        const symbol =
          data.tick.symbol;


        if (!symbol) {
          return;
        }


        const digit =
          getLastDigit(data.tick.quote);


        if (!Number.isInteger(digit)) {
          return;
        }


        if (!marketData[symbol]) {

          marketData[symbol] = {
            symbol,
            digits: []
          };

        }


        marketData[symbol].digits.push(digit);


        /*
          Keep the most recent 500 ticks.
        */

        if (
          marketData[symbol].digits.length > 500
        ) {

          marketData[symbol].digits =
            marketData[symbol]
              .digits
              .slice(-500);

        }


        marketData[symbol].ticks =
          marketData[symbol].digits.length;


        updateMarket(symbol);

      }

    }

    catch (error) {

      console.log(
        "Message error:",
        error.message
      );

    }

  });


  deriv.on("error", error => {

    console.log(
      "Deriv connection error:",
      error.message
    );

  });


  deriv.on("close", () => {

    derivConnected = false;

    console.log(
      "Deriv connection closed"
    );


    broadcast({
      type: "connection",
      connected: false
    });


    if (!reconnectTimer) {

      reconnectTimer =
        setTimeout(() => {

          reconnectTimer = null;

          connectDeriv();

        }, 5000);

    }

  });

}


/* -----------------------------
   AUTOMATIC 60 SECOND RESCAN
----------------------------- */

setInterval(() => {

  console.log(
    "Running 60-second analysis refresh..."
  );


  for (
    const symbol of Object.keys(marketData)
  ) {

    updateMarket(symbol);

  }


  broadcast({
    type: "scan",
    timestamp: Date.now()
  });


}, RESCAN_MS);


/* -----------------------------
   START SERVER
----------------------------- */

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
