var fileNumber = 0;
var MAXLOGS = 9;
var logRawData = false;
var streamToGB = true;
var stopped = false;

function getFileName(n) {
  return "loglog."+n+".csv";
}

// Show main menu
function showMenu() {
  var menu = {
    "" : { title : "LogLog" },
    "< Back" : function() { load(); },
    "File No" : {
      value : fileNumber,
      min : 0,
      max : MAXLOGS,
      onchange : v => { fileNumber=v; }
    },
    "Start" : function() { E.showMenu(); startRecord(); },
    "View Logs" : function() { viewLogs(); },
    "Log raw data" : {
      value : !!logRawData,
      onchange : v => { logRawData=v; }
    },
    "Stream to GB" : {
      value : !!streamToGB,
      onchange : v => { streamToGB=v; }
    }
  };
  E.showMenu(menu);
}

// View single log
function viewLog(n) {
  E.showMessage("Loading...");
  var f = require("Storage").open(getFileName(n), "r");
  var records = 0, l = "", ll="";
  while ((l=f.readLine())!==undefined) {records++;ll=l;}
  var length = 0;
  if (ll) length = Math.round( (ll.split(",")[0]|0)/1000 );

  var menu = {
    "" : { title : "Log "+n },
    "< Back" : () => { viewLogs(); }
  };
  menu[records+" Records"] = "";
  menu[length+" Seconds"] = "";
  menu["DELETE"] = function() {
    E.showPrompt("Delete Log "+n).then(ok=>{
      if (ok) {
        E.showMessage("Erasing...");
        f.erase();
        viewLogs();
      } else viewLog(n);
    });
  };
  E.showMenu(menu);
}

// View all logs
function viewLogs() {
  var menu = {
    "" : { title : "Logs" },
    "< Back" : () => { showMenu(); }
  };
  var hadLogs = false;
  for (var i=0;i<=MAXLOGS;i++) {
    var f = require("Storage").open(getFileName(i), "r");
    if (f.readLine()!==undefined) {
      (function(i){menu["Log "+i] = () => viewLog(i);})(i);
      hadLogs = true;
    }
  }
  if (!hadLogs)
    menu["No Logs Found"] = function(){};
  E.showMenu(menu);
}

// Start recording
function startRecord(force) {
  stopped = false;
  if (!force) {
    var f = require("Storage").open(getFileName(fileNumber), "r");
    if (f.readLine()!==undefined)
      return E.showPrompt("Overwrite Log "+fileNumber+"?").then(ok=>{
        if (ok) startRecord(true); else showMenu();
      });
  }

  g.clear(1);
  Bangle.drawWidgets();

  var Layout = require("Layout");
  var layout = new Layout({
    type: "v", c: [
      { type: "txt", font: "6x8:2", label: "LOGLOG", pad: 4, fillx:1, halign:"center", bgCol:g.theme.bg2 },

      { type:"h", pad:2, c:[
        { type:"v", fillx:1, c:[
            { type:"txt", font:"6x8", label:"Samples", halign:"center" },
            { id:"samples", type:"txt", font:"6x8:2", label:"0", pad:4, bgCol:g.theme.bg }
        ]},
        { type:"v", fillx:1, c:[
            { type:"txt", font:"6x8", label:"Time", halign:"center" },
            { id:"time", type:"txt", font:"6x8:2", label:"0 s", pad:4, bgCol:g.theme.bg }
        ]}
      ]},

      { type:"h", pad:2, c:[
        { type:"v", fillx:1, c:[
            { type:"txt", font:"6x8", label:"Max G", halign:"center" },
            { id:"maxMag", type:"txt", font:"6x8:2", label:"-", pad:4, bgCol:g.theme.bg }
        ]},
        { type:"v", fillx:1, c:[
            { type:"txt", font:"6x8", label:"BPM", halign:"center" },
            { id:"bpm", type:"txt", font:"6x8:2", label:"-", pad:4, bgCol:g.theme.bg }
        ]}
      ]},

      { type:"h", pad:4, filly:1, c:[
        { id:"state", type:"txt", font:"6x8:2", label:"REC", bgCol:"#d00", fillx:1, halign:"center", pad:6 },
        { id:"gb", type:"txt", font:"6x8", label:"GB", bgCol:"#003399", pad:6 }
      ]}
    ]
  },{
    btns:[{
      id:"btnStop",
      label:"STOP",
      cb: ()=>{
        if (!stopped) {
          Bangle.removeListener('accel', accelHandler);
          Bangle.removeListener('HRM', hrmHandler);
          Bangle.setHRMPower(0);
          layout.state.label = "STOP";
          layout.state.bgCol = "#0b0";
          stopped = true;
          layout.render();
        } else showMenu();
      }
    }]
  });
  layout.render();

  var f = require("Storage").open(getFileName(fileNumber), "w");
  f.write("Epoch (ms),Battery,X,Y,Z,AccMag,BPM,Confidence\n");

  var startTime = Date.now();
  var sampleCount = 0;
  var maxMag = 0;
  var stepCount = 0;
  var lastGBSend = 0;
  var gbSendInterval = 10000;
  var gbAccelSum = 0;
  var gbAccelCount = 0;
  var gbLastHRM = 0;
  var gbLastConf = 0;
  var lastUIUpdate = 0;

  function updateUI() {
    var now = Date.now();
    if (now - lastUIUpdate > 200) { // 5Hz
      layout.samples.label = sampleCount;
      layout.time.label = Math.round((now-startTime)/1000)+" s";
      layout.maxMag.label = maxMag;
      layout.bpm.label = gbLastHRM || "-";
      layout.render();
      lastUIUpdate = now;
    }
  }

  function sendToGadgetbridge() {
    if (!streamToGB) return;
    var movIntensity = gbAccelCount>0?Math.round((gbAccelSum/gbAccelCount)*255):0;
    if (movIntensity>255) movIntensity=255;

    try {
      Bluetooth.println(JSON.stringify({
        t: "act",
        ts: Date.now(),
        hrm: gbLastConf>50?gbLastHRM:undefined,
        stp: stepCount,
        mov: movIntensity
      }));
      layout.gb.bgCol="#0f0";
      layout.render();
      setTimeout(()=>{layout.gb.bgCol="#003399"; layout.render();},200);
    } catch(e){}

    gbAccelSum=0;
    gbAccelCount=0;
  }

  function accelHandler(accel) {
    var t=Date.now();
    var battery = E.getBattery();
    gbAccelSum += accel.mag;
    gbAccelCount++;

    if (logRawData) {
      f.write([t,battery,accel.x*8192,accel.y*8192,accel.z*8192,accel.mag*8192,"",""].join(",")+"\n");
    } else {
      f.write([t,battery,accel.x,accel.y,accel.z,accel.mag,-1,-1].join(",")+"\n");
    }

    if (accel.mag>maxMag) maxMag = accel.mag.toFixed(2);
    sampleCount++;

    if (Date.now()-lastGBSend>=gbSendInterval) {
      sendToGadgetbridge();
      lastGBSend = Date.now();
    }

    updateUI();
  }

  function hrmHandler(hrm) {
    var t=Date.now();
    var battery = E.getBattery();
    gbLastHRM = hrm.bpm;
    gbLastConf = hrm.confidence;
    f.write([t,battery,"","","","",hrm.bpm,hrm.confidence].join(",")+"\n");
    updateUI();
  }

  Bangle.setPollInterval(80);
  Bangle.setHRMPower(1);
  Bangle.on('accel', accelHandler);
  Bangle.on('HRM', hrmHandler);
}

// Initialize
Bangle.loadWidgets();
Bangle.drawWidgets();
showMenu();
