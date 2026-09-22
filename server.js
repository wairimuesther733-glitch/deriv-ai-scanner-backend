const http = require("http");
const WebSocket = require("ws");

const PORT = Number(process.env.PORT) || 10000;
const DERIV_URL = "wss://api.derivws.com/trading/v1/options/ws/public";
const MARKETS = ["1HZ10V","1HZ25V","1HZ50V","1HZ75V","1HZ100V","1HZ150V","1HZ200V","1HZ250V"];
const HISTORY_COUNT = 200;
const MIN_MATCH_STRENGTH = 80;
const RESCAN_MS = 60 * 1000;

const clients = new Set();
const marketData = {};
let deriv = null;
let derivConnected = false;
let reconnectTimer = null;
let historyQueue = [];
let pendingHistorySymbol = null;

const httpServer = http.createServer((req,res)=>{
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Headers","*");
  if(req.url === "/health"){
    res.writeHead(200,{"Content-Type":"application/json"});
    return res.end(JSON.stringify({status:"online",derivConnected,markets:Object.keys(marketData).length,time:new Date().toISOString()}));
  }
  res.writeHead(200,{"Content-Type":"text/plain"});
  res.end("Deriv AI Market Scanner backend is running.");
});

const dashboard = new WebSocket.Server({server:httpServer});
dashboard.on("connection",socket=>{
  clients.add(socket);
  sendToClient(socket,{type:"connection",connected:derivConnected});
  for(const symbol of Object.keys(marketData)) sendToClient(socket,{type:"market",data:marketData[symbol]});
  socket.on("close",()=>clients.delete(socket));
  socket.on("error",()=>clients.delete(socket));
});

function sendToClient(socket,data){ if(socket.readyState===WebSocket.OPEN) socket.send(JSON.stringify(data)); }
function broadcast(data){ const msg=JSON.stringify(data); for(const socket of clients) if(socket.readyState===WebSocket.OPEN) socket.send(msg); }

function getLastDigit(value){
  const text=String(value);
  if(text.includes(".")){ const part=text.split(".")[1]; if(part) return Number(part.slice(-1)); }
  return Number(text.slice(-1));
}

function analyse(symbol,digits){
  if(!Array.isArray(digits) || digits.length<30) return null;
  const clean=digits.map(Number).filter(d=>Number.isInteger(d)&&d>=0&&d<=9);
  if(clean.length<30) return null;
  const total=clean.length, counts=Array(10).fill(0);
  for(const d of clean) counts[d]++;
  let best=0;
  for(let i=1;i<10;i++) if(counts[i]>counts[best]) best=i;
  const overall=(counts[best]/total)*100;
  const recent=clean.slice(-50);
  const recentFreq=(recent.filter(d=>d===best).length/recent.length)*100;
  const previous=clean.slice(-100,-50);
  const previousFreq=previous.length?(previous.filter(d=>d===best).length/previous.length)*100:0;
  const momentum=recentFreq-previousFreq;
  let strength=overall*.50+recentFreq*.35+Math.max(momentum,0)*.15;
  strength=Math.max(0,Math.min(100,strength));
  const even=clean.filter(d=>d%2===0).length;
  return {symbol,matchDigit:best,matchStrength:Number(strength.toFixed(1)),matchSignal:strength>=MIN_MATCH_STRENGTH?"MATCH":"NO_MATCH",even:Number(((even/total)*100).toFixed(1)),odd:Number((((total-even)/total)*100).toFixed(1)),ticks:total,digits:clean.slice(-50),timestamp:Date.now()};
}

function updateMarket(symbol){
  if(!marketData[symbol]) return;
  const result=analyse(symbol,marketData[symbol].digits);
  if(!result) return;
  marketData[symbol]={...marketData[symbol],...result};
  broadcast({type:"market",data:marketData[symbol]});
}

function requestNextHistory(){
  if(!deriv || deriv.readyState!==WebSocket.OPEN || pendingHistorySymbol) return;
  const symbol=historyQueue.shift();
  if(!symbol){ console.log("Market scan complete."); return; }
  pendingHistorySymbol=symbol;
  console.log(`Requesting history for ${symbol}`);
  // No subscribe field: this scanner needs a fresh snapshot, not a live stream.
  deriv.send(JSON.stringify({ticks_history:symbol,count:HISTORY_COUNT,end:"latest",style:"ticks"}));
}

function startFreshScan(){
  if(!deriv || deriv.readyState!==WebSocket.OPEN) return;
  if(pendingHistorySymbol){ console.log("Previous market scan is still running; keeping it in progress."); return; }
  historyQueue=[...MARKETS];
  console.log("Starting fresh 60-second market scan...");
  broadcast({type:"scan",timestamp:Date.now()});
  requestNextHistory();
}

function connectDeriv(){
  if(deriv){ try{deriv.close();}catch(_){} }
  console.log("Connecting to Deriv...");
  console.log(`Endpoint: ${DERIV_URL}`);
  historyQueue=[...MARKETS];
  pendingHistorySymbol=null;
  deriv=new WebSocket(DERIV_URL,{handshakeTimeout:15000});

  deriv.on("open",()=>{
    derivConnected=true;
    console.log("Connected to Deriv");
    broadcast({type:"connection",connected:true});
    requestNextHistory();
  });

  deriv.on("message",raw=>{
    try{
      const data=JSON.parse(raw.toString());
      if(data.error){
        console.log("Deriv error:",data.error.message||data.error);
        broadcast({type:"error",message:data.error.message||"Deriv error"});
        if(pendingHistorySymbol){ pendingHistorySymbol=null; requestNextHistory(); }
        return;
      }
      if(data.msg_type==="history" && data.history && Array.isArray(data.history.prices)){
        const symbol=pendingHistorySymbol;
        if(!symbol) return;
        const digits=data.history.prices.map(getLastDigit).filter(d=>Number.isInteger(d)&&d>=0&&d<=9);
        marketData[symbol]={symbol,digits,ticks:digits.length,timestamp:Date.now()};
        pendingHistorySymbol=null;
        updateMarket(symbol);
        requestNextHistory();
      }
    }catch(error){ console.log("Message error:",error.message); }
  });

  deriv.on("error",error=>console.log("Deriv connection error:",error.message));
  deriv.on("close",(code,reason)=>{
    derivConnected=false;
    console.log(`Deriv connection closed. code=${code} reason=${reason||""}`);
    broadcast({type:"connection",connected:false});
    pendingHistorySymbol=null;
    if(!reconnectTimer){ reconnectTimer=setTimeout(()=>{reconnectTimer=null;connectDeriv();},5000); }
  });
}

setInterval(startFreshScan,RESCAN_MS);
httpServer.listen(PORT,"0.0.0.0",()=>{ console.log(`Backend listening on 0.0.0.0:${PORT}`); connectDeriv(); });
