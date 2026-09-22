<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Deriv AI Market Scanner</title>

<style>
*{box-sizing:border-box}

body{
 margin:0;
 font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;
 background:#07111f;
 color:#eef4ff;
}

.wrap{
 max-width:1100px;
 margin:auto;
 padding:18px;
}

.top{
 display:flex;
 justify-content:space-between;
 align-items:center;
 margin-bottom:18px;
}

h1{
 margin:0 0 5px;
 font-size:26px;
}

.sub{
 color:#91a0b7;
 font-size:14px;
}

.status{
 padding:9px 13px;
 border-radius:20px;
 background:#132033;
 font-size:13px;
}

.dot{
 display:inline-block;
 width:9px;
 height:9px;
 border-radius:50%;
 background:#f59e0b;
 margin-right:6px;
}

.dot.on{background:#22c55e}
.dot.off{background:#ef4444}

.card{
 background:#0d1929;
 border:1px solid #1d2d44;
 border-radius:17px;
 padding:18px;
 margin-bottom:16px;
}

.label{
 color:#8fa0b8;
 font-size:12px;
 text-transform:uppercase;
 letter-spacing:.08em;
}

.note{
 color:#8999af;
 font-size:12px;
 line-height:1.5;
 margin-top:8px;
}

.grid{
 display:grid;
 grid-template-columns:1fr 1fr;
 gap:16px;
}

.signal{
 margin-top:12px;
 padding:20px;
 border-radius:14px;
 background:#111f33;
 border:1px solid #2a3b54;
}

.signal.match{
 border-color:#22c55e;
}

.big{
 font-size:32px;
 font-weight:800;
 margin-top:7px;
}

.strength{
 color:#aebbd0;
 margin-top:5px;
}

.metrics{
 display:grid;
 grid-template-columns:repeat(4,1fr);
 gap:10px;
 margin-top:14px;
}

.metric{
 background:#091523;
 border:1px solid #1d2d44;
 border-radius:12px;
 padding:13px;
}

.metric b{
 display:block;
 font-size:19px;
 margin-top:5px;
}

button{
 border:0;
 border-radius:10px;
 padding:11px 16px;
 font-weight:700;
 margin-top:14px;
 margin-right:6px;
}

.start{
 background:#22c55e;
 color:#04110a;
}

.stop{
 background:#29394f;
 color:white;
}

.table{
 overflow:auto;
 margin-top:12px;
}

table{
 width:100%;
 border-collapse:collapse;
 min-width:700px;
}

th,td{
 padding:11px 9px;
 border-bottom:1px solid #1c2b40;
 text-align:left;
 font-size:13px;
}

th{
 color:#8fa0b8;
}

.pill{
 padding:4px 8px;
 border-radius:20px;
 font-size:11px;
 font-weight:700;
}

.good{
 background:#123b28;
 color:#66e59a;
}

.no{
 background:#263449;
 color:#aebbd0;
}

.log{
 background:#07111f;
 border:1px solid #1c2b40;
 border-radius:12px;
 padding:10px;
 max-height:200px;
 overflow:auto;
 font:12px monospace;
 color:#9eabc0;
}

.empty{
 text-align:center;
 color:#71829a;
 padding:20px;
}

@media(max-width:750px){
 .grid{grid-template-columns:1fr}
 .metrics{grid-template-columns:repeat(2,1fr)}
 .top{align-items:flex-start}
 h1{font-size:22px}
}
</style>
</head>

<body>

<div class="wrap">

<div class="top">
 <div>
  <h1>Deriv AI Market Scanner</h1>
  <div class="sub">
   AI market analysis • automatic 60-second rescan
  </div>
 </div>

 <div class="status">
  <span id="dot" class="dot"></span>
  <span id="status">Connecting…</span>
 </div>
</div>

<div class="card">
 <div class="label">Analysis only</div>
 <div class="note">
  This scanner does not place trades.
  Model strength is a statistical confidence score,
  not a guaranteed win probability.
 </div>
</div>

<div class="grid">

<div class="card">
 <div class="label">Match signal</div>

 <div id="signalBox" class="signal">
  <div class="label">MATCH SIGNAL</div>
  <div id="signal" class="big">Waiting…</div>
  <div id="strength" class="strength">
   Model strength —
  </div>
 </div>

 <button class="start" onclick="start()">Start scanner</button>
 <button class="stop" onclick="stop()">Stop</button>
</div>

<div class="card">

 <div class="label">Live data</div>

 <div class="metrics">

  <div class="metric">
   <span class="label">Markets</span>
   <b id="markets">0</b>
  </div>

  <div class="metric">
   <span class="label">Ticks</span>
   <b id="ticks">0</b>
  </div>

  <div class="metric">
   <span class="label">Even</span>
   <b id="even">—</b>
  </div>

  <div class="metric">
   <span class="label">Odd</span>
   <b id="odd">—</b>
  </div>

 </div>

 <div class="metrics">

  <div class="metric">
   <span class="label">Next scan</span>
   <b id="timer">60s</b>
  </div>

  <div class="metric">
   <span class="label">Selected</span>
   <b id="selected">—</b>
  </div>

 </div>

</div>

</div>

<div class="card">

<div class="label">Markets</div>

<div class="table">

<table>

<thead>
<tr>
<th>Symbol</th>
<th>Ticks</th>
<th>Match</th>
<th>Strength</th>
<th>Even</th>
<th>Odd</th>
<th>Status</th>
</tr>
</thead>

<tbody id="marketBody">
<tr>
<td colspan="7" class="empty">
Waiting for market data…
</td>
</tr>
</tbody>

</table>

</div>
</div>

<div class="card">

<div class="label">Activity log</div>

<div id="log" class="log"></div>

</div>

</div>

<script>

const BACKEND =
"wss://deriv-ai-scanner-backend.onrender.com";

let socket=null;
let running=true;
let markets=[];
let data={};
let seconds=60;
let timer=null;

function log(text){

 const row=document.createElement("div");

 row.textContent=
 new Date().toLocaleTimeString()+" — "+text;

 document.getElementById("log")
 .prepend(row);

}

function connection(ok){

 const dot=document.getElementById("dot");

 dot.className="dot "+(ok?"on":"off");

 document.getElementById("status")
 .textContent=ok?"Connected":"Disconnected";

}

function connect(){

 if(socket &&
 (socket.readyState===1 ||
 socket.readyState===0)) return;

 connection(false);

 document.getElementById("status")
 .textContent="Connecting…";

 log("Connecting to scanner backend…");

 socket=new WebSocket(BACKEND);

 socket.onopen=function(){

  connection(true);

  log("Connected to scanner backend.");

 };

 socket.onmessage=function(event){

  try{

   const m=JSON.parse(event.data);

   if(m.type==="connection"){
    connection(m.connected);
   }

   if(m.type==="markets"){

    markets=m.markets||[];

    document.getElementById("markets")
    .textContent=markets.length;

    render();

   }

   if(m.type==="market" && m.data){

    data[m.data.symbol]=m.data;

    render();

    best();

   }

   if(m.type==="scan"){

    seconds=60;

    log("New 60-second scan started.");

   }

   if(m.type==="scan_complete"){

    seconds=60;

    log("Market scan complete.");

   }

   if(m.type==="error"){

    log("Backend error: "+m.message);

   }

  }catch(e){

   log("Invalid backend message.");

  }

 };

 socket.onclose=function(){

  connection(false);

  log("Backend disconnected.");

  if(running){

   setTimeout(connect,3000);

  }

 };

 socket.onerror=function(){

  log("Backend connection error.");

 };

}

function render(){

 const body=
 document.getElementById("marketBody");

 const rows=Object.values(data)
 .sort((a,b)=>
 Number(b.matchStrength)-
 Number(a.matchStrength));

 if(!rows.length){

  body.innerHTML=
  '<tr><td colspan="7" class="empty">'+
  'Waiting for market data…</td></tr>';

  return;
 }

 body.innerHTML=rows.map(m=>{

  const good=
  Number(m.matchStrength)>=80;

  return `
  <tr>

   <td><b>${m.symbol}</b></td>

   <td>${m.ticks}</td>

   <td>Digit ${m.matchDigit}</td>

   <td><b>${Number(m.matchStrength).toFixed(1)}%</b></td>

   <td>${Number(m.even).toFixed(1)}%</td>

   <td>${Number(m.odd).toFixed(1)}%</td>

   <td>
    <span class="pill ${good?"good":"no"}">
     ${good?"MATCH":"NO MATCH"}
    </span>
   </td>

  </tr>
  `;

 }).join("");

}

function best(){

 const rows=Object.values(data);

 if(!rows.length)return;

 rows.sort((a,b)=>
 Number(b.matchStrength)-
 Number(a.matchStrength));

 const m=rows[0];

 document.getElementById("ticks")
 .textContent=m.ticks;

 document.getElementById("even")
 .textContent=
 Number(m.even).toFixed(1)+"%";

 document.getElementById("odd")
 .textContent=
 Number(m.odd).toFixed(1)+"%";

 document.getElementById("selected")
 .textContent=m.symbol;

 const good=
 Number(m.matchStrength)>=80;

 if(good){

  document.getElementById("signal")
  .textContent=
  "DIGIT "+m.matchDigit;

  document.getElementById("strength")
  .textContent=
  "MATCH • "+
  Number(m.matchStrength).toFixed(1)+
  "% strength • "+m.symbol;

  document.getElementById("signalBox")
  .className="signal match";

 }else{

  document.getElementById("signal")
  .textContent="NO 80%+ MATCH";

  document.getElementById("strength")
  .textContent=
  "Highest: Digit "+
  m.matchDigit+" • "+
  Number(m.matchStrength).toFixed(1)+
  "% • "+m.symbol;

  document.getElementById("signalBox")
  .className="signal";

 }

}

function start(){

 running=true;

 connect();

 log("Scanner started.");

}

function stop(){

 running=false;

 if(socket){

  socket.close();

 }

 log("Scanner stopped.");

 connection(false);

}

timer=setInterval(function(){

 if(seconds>0)seconds--;

 document.getElementById("timer")
 .textContent=seconds+"s";

},1000);

connect();

</script>

</body>
</html>
