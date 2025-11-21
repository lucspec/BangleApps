var fileNumber = 0;
var MAXLOGS = 9;
var logRawData = false;
var streamToGB = true;
var stopped = false;
var recording = false;
var recordLayout = null;

// Returns file name for a given log number
function getFileName(n) { return "loglog."+n+".csv"; }

// Main menu
function showMenu() {
  var menu = {
    "" : { title : "LogLog" + (recording ? " [REC]" : "") },
    "< Back" : function() { load(); },
    "File No" : {
      value : fileNumber,
      min : 0,
      max : MAXLOGS,
      onchange : v => { fileNumber=v; }
    },
    "Start" : function() { 
      if (!recording) startRecord(); 
      else E.showMessage("Already recording! Press Back to exit."); 
    },
    "View Logs" : function() { viewLogs(); },
    "Log raw data" : {
      value : !!logRawData,
      onchange : v => { logRawData=v; }
    },
    "Stream to GB" : {
      value : !!streamToGB,
      onchange : v => { streamToGB=v; }
    },
  };
  if(recording) {
    menu["Stop Recording"] = function() {
      if(recordLayout) {
        Bangle.removeListener('accel', accelHandler);
        Bangle.removeListener('HRM', hrmHandler);
        Bangle.setHRMPower(0);
        recording = false;
        stopped = true;
        recordLayout = null;
        E.showMessage("Recording stopped");
      }
    };
  }
  E.showMenu(menu);
}

// View a single log
function viewLog(n) {
  E.showMessage("Loading...");
  var f = require("Storage").open(getFileName(n), "r");
  var records = 0, l = "", ll="";
  while ((l=f.readLine())!==undefined) {records++;ll=l;}
  var length = ll ? Math.round( (ll.split(",")[0]|0)/1000 ) : 0;

  var menu = {
    "" : { title : "Log "+n },
    "< Back" : () => { viewLogs(); }
  };
  menu[records+" Records"] = "";
  menu[length+" Seconds"] = "";
  menu["DELETE"] = function() {
    E.showPrompt("Delete Log "+n).then(ok=>{
      if (ok) { E.showMessage("Erasing..."); f.erase(); viewLogs(); }
      else viewLog(n);
    });
  };
  E.showMenu(menu);
}

// View all logs
function viewLogs() {
  var menu = { "" : { title : "Logs" }, "< Back" : () => { showMenu(); } };
  var hadLogs = false;
  for (var i=0;i<=MAXLOGS;i++) {
    var f = require("Storage").open(getFileName(i), "r");
    if (f.readLine()!==undefined) {
      (function(i){menu["Log "+i] = () => viewLog(i);})(i);
      hadLogs = true;
    }
  }
  if (!hadLogs) menu["No Logs Found"] = function(){};
  E.showMenu(menu);
}

// GLOBAL references for accelerometer / HRM handlers
var accelHandler, hrmHandler;

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

  g.clear();
  Bangle.drawWidgets();

  var Layout = require("Layout");

  // STATIC layout elements
  var layout = new Layout({
    type: "v", c: [
      { type:"txt", font:"6x8:2", label:"LOGLOG", pad:4, fillx:1, halign:"center", bgCol:g.theme.bg2 },

      { type:"h", pad:2, c:[
        { type:"v", fillx:1, c:[
            { type:"txt", font:"6x8", label:"Samples", halign:"center" },
            { type:"txt", id:"samplesLabel", font:"6x8:2", label:"0", pad:4, bgCol:g.theme.bg }
        ]},
        { type:"v", fillx:1, c:[
            { type:"txt", font:"6x8", label:"Time", halign:"center" },
            { type:"txt", id:"timeLabel", font:"6x8:2", label:"0 s", pad:4, bgCol:g.theme.bg }
        ]}
      ]},

      { type:"h", pad:2, c:[
        { type:"v", fillx:1, c:[
            { type:"txt", font:"6x8", label:"Max G", halign:"center" },
            { type:"txt", id:"maxMagLabel", font:"6x8:2", label:"-", pad:4, bgCol:g.theme.bg }
        ]},
        { type:"v", fillx:1, c:[
            { type:"txt", font:"6x8", label:"BPM", halign:"center" },
            { type:"txt", id:"bpmLabel", font:"6x8:2", label:"-", pad:4, bgCol:g.theme.bg }
        ]}
      ]},

      { type:"h", pad:4, c:[
        { id:"state", type:"txt", font:"6x8:2", label:"REC", bgCol:"#d00", fillx:1, halign:"center", pad:6 },
        { id:"gb", type:"txt", font:"6x8", label:"GB", bgCol:"#003399", pad:6 }
      ]}
    ]
  },{
    btns:[{
      id:"btnStop", label:"STOP", cb: ()=>{
        if (!stopped) {
          Bangle.removeListener('accel', accelHandler);
          Bangle.removeListener('HRM', hrmHandler);
          Bangle.setHRMPower(0);
          layout.state.label = "STOP";
          layout.state.bgCol = "#0b0";
          stopped = true;
          recording = false;
          layout.render();
        } else showMenu();
      }
    }]
  });
  layout.render();

  recordLayout = layout;
  recording = true;

  var f = require("Storage").open(getFileName(fileNumber), "w");
  f.write("Epoch (ms),Battery,Source,X,Y,Z,Total,BPM,Confidence\n");

  var startTime = Date.now();
  var sampleCount = 0;
  var maxMag = 0;
  var gbAccelSum = 0;
  var gbAccelCount = 0;
  var gbLastHRM = 0;
  var gbLastConf = 0;
  var lastGBSend = 0;
  var gbSendInterval = 10000;

  function sendToGadgetbridge() {
    if (!streamToGB) return;
    var movIntensity = gbAccelCount>0 ? Math.round((gbAccelSum/gbAccelCount)*255) : 0;
    if (movIntensity>255) movIntensity = 255;

    try {
      Bluetooth.println(JSON.stringify({
        t:"act",
        ts:Date.now(),
        hrm: gbLastConf>50?gbLastHRM:undefined,
        stp: sampleCount,
        mov: movIntensity
      }));
      layout.gb.bgCol="#0f0";
      layout.render();
      setTimeout(()=>{layout.gb.bgCol="#003399"; layout.render();},200);
    } catch(e){}
    gbAccelSum=0; gbAccelCount=0;
  }

  function updateUI() {
    layout.samplesLabel.label = sampleCount;
    layout.timeLabel.label = Math.round((Date.now()-startTime)/1000)+" s";
    layout.maxMagLabel.label = maxMag;
    layout.bpmLabel.label = gbLastHRM || "-";
    layout.render();
  }

  accelHandler = function(accel) {
    gbAccelSum += accel.mag;
    gbAccelCount++;

    if (logRawData) {
      f.write([Date.now(),E.getBattery(),accel.x*8192,accel.y*8192,accel.z*8192,accel.mag*8192,"",""].join(",")+"\n");
    } else {
      f.write([Date.now(),E.getBattery(),accel.x,accel.y,accel.z,accel.mag,-1,-1].join(",")+"\n");
    }

    if (accel.mag>maxMag) maxMag = accel.mag.toFixed(2);
    sampleCount++;

    if (Date.now()-lastGBSend >= gbSendInterval) {
      sendToGadgetbridge();
      lastGBSend = Date.now();
    }

    updateUI();
  };

  hrmHandler = function(hrm) {
    gbLastHRM = hrm.bpm;
    gbLastConf = hrm.confidence;
    f.write([Date.now(),E.getBattery(),"","","","",hrm.bpm,hrm.confidence].join(",")+"\n");
    updateUI();
  };

  // Back button to exit layout but keep recording
  setWatch(()=>{
    g.clear();
    Bangle.drawWidgets();
    E.showMenu(showMenu);
  }, BTN1, {repeat:false,edge:"falling"});

  Bangle.setPollInterval(80);
  Bangle.setHRMPower(1);
  Bangle.on('accel', accelHandler);
  Bangle.on('HRM', hrmHandler);
}

// Initialize
Bangle.loadWidgets();
Bangle.drawWidgets();
showMenu();
