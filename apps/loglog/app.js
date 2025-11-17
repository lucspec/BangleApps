var fileNumber = 0;
var MAXLOGS = 9;
var logRawData = false;

function getFileName(n) {
  return "loglog."+n+".csv";
}

function showMenu() {
  var menu = {
    "" : { title : "LogLog" },
    "< Back" : function() {
      load();
    },
    "File No" : {
      value : fileNumber,
      min : 0,
      max : MAXLOGS,
      onchange : v => { fileNumber=v; }
    },
    "Start" : function() {
      E.showMenu();
      startRecord();
    },
    "View Logs" : function() {
      viewLogs();
    },
    "Log raw data" : {
      value : !!logRawData,
      onchange : v => { logRawData=v; }
    },
  };
  E.showMenu(menu);
}

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

function viewLogs() {
  var menu = {
    "" : { title : "Logs" },
    "< Back" : () => { showMenu(); }
  };

  var hadLogs = false;
  for (var i=0;i<=MAXLOGS;i++) {
    var f = require("Storage").open(getFileName(i), "r");
    if (f.readLine()!==undefined) {
      (function(i) {
        menu["Log "+i] = () => viewLog(i);
      })(i);
      hadLogs = true;
    }
  }
  if (!hadLogs)
    menu["No Logs Found"] = function(){};
  E.showMenu(menu);
}

function startRecord(force) {
  var stopped = false;
  if (!force) {
    // check for existing file
    var f = require("Storage").open(getFileName(fileNumber), "r");
    if (f.readLine()!==undefined)
      return E.showPrompt("Overwrite Log "+fileNumber+"?").then(ok=>{
        if (ok) startRecord(true); else showMenu();
      });
  }
  // display
  g.clear(1);
  Bangle.drawWidgets();

  var Layout = require("Layout");
  var layout = new Layout({ type: "v", c: [
    { type: "h", c: [
      { type: "v", c: [
        {type:"txt", font:"6x8", label:"Samples", pad:2},
        {type:"txt", id:"samples", font:"6x8:2", label:"  -  ", pad:5, bgCol:g.theme.bg},
      ]},
      { type: "v", c: [
        {type:"txt", font:"6x8", label:"Time", pad:2},
        {type:"txt", id:"time", font:"6x8:2", label:"  -  ", pad:5, bgCol:g.theme.bg},
      ]},
    ]},
    { type: "h", c: [
      { type: "v", c: [
        {type:"txt", font:"6x8", label:"Max X", pad:2},
        {type:"txt", id:"maxX", font:"6x8", label:"  -  ", pad:5, bgCol:g.theme.bg},
      ]},
      { type: "v", c: [
        {type:"txt", font:"6x8", label:"Max Y", pad:2},
        {type:"txt", id:"maxY", font:"6x8", label:"  -  ", pad:5, bgCol:g.theme.bg},
      ]},
      { type: "v", c: [
        {type:"txt", font:"6x8", label:"Max Z", pad:2},
        {type:"txt", id:"maxZ", font:"6x8", label:"  -  ", pad:5, bgCol:g.theme.bg},
      ]},
    ]},
    {type:"txt", font:"6x8", label:"Max G", pad:2},
    {type:"txt", id:"maxMag", font:"6x8:4", label:"  -  ", pad:5, bgCol:g.theme.bg},
    { type: "h", c: [
      { type: "v", c: [
        {type:"txt", font:"6x8", label:"BPM", pad:2},
        {type:"txt", id:"bpm", font:"6x8:2", label:"  -  ", pad:5, bgCol:g.theme.bg},
      ]},
      { type: "v", c: [
        {type:"txt", font:"6x8", label:"Conf", pad:2},
        {type:"txt", id:"conf", font:"6x8:2", label:"  -  ", pad:5, bgCol:g.theme.bg},
      ]},
    ]},
    {type:"txt", id:"state", font:"6x8:2", label:"RECORDING", bgCol:"#f00", pad:5, fillx:1},
  ]},
  {
    btns:[
    {id: "btnStop", label:"STOP", cb:()=>{
      if (stopped) {
        showMenu();
      }
      else {
        Bangle.removeListener('accel', accelHandler);
        Bangle.removeListener('HRM', hrmHandler);
        Bangle.setHRMPower(0);
        layout.state.label = "STOPPED";
        layout.state.bgCol = "#0f0";
        stopped = true;
        layout.render();
      }
    }}
  ]});
  layout.render();

  // now start writing
  var f = require("Storage").open(getFileName(fileNumber), "w");
  f.write("Time (ms),Battery,Source,X,Y,Z,Total,BPM,Confidence\n");
  var start = getTime();
  var sampleCount = 0;
  var maxMag = 0;
  var maxX = 0;
  var maxY = 0;
  var maxZ = 0;
  var lastHRM = {bpm: 0, confidence: 0};

  function accelHandler(accel) {
    var t = getTime()-start;
    var battery = E.getBattery();
    
    if (logRawData) {
      f.write([
        t*1000,
        battery,
        "accel",
        accel.x*8192,
        accel.y*8192,
        accel.z*8192,
        accel.mag*8192,
        lastHRM.bpm,
        lastHRM.confidence
      ].map(n=>Math.round(n)).join(",")+"\n");
    } else {
      f.write([
        Math.round(t*1000),
        battery,
        "accel",
        accel.x,
        accel.y,
        accel.z,
        accel.mag,
        lastHRM.bpm,
        lastHRM.confidence
      ].join(",")+"\n");
    }
    
    if (accel.mag > maxMag) {
      maxMag = accel.mag.toFixed(2);
    }
    if (accel.x > maxX) {
      maxX = accel.x.toFixed(2);
    }
    if (accel.y > maxY) {
      maxY = accel.y.toFixed(2);
    }
    if (accel.z > maxZ) {
      maxZ = accel.z.toFixed(2);
    }

    sampleCount++;
    layout.samples.label = sampleCount;
    layout.time.label = Math.round(t)+"s";
    layout.maxX.label = maxX;
    layout.maxY.label = maxY;
    layout.maxZ.label = maxZ;
    layout.maxMag.label = maxMag;
    layout.render();
  }

  function hrmHandler(hrm) {
    var t = getTime()-start;
    var battery = E.getBattery();
    
    lastHRM = {bpm: hrm.bpm, confidence: hrm.confidence};
    
    f.write([
      Math.round(t*1000),
      battery,
      "hrm",
      "0","0","0","0",
      hrm.bpm,
      hrm.confidence
    ].join(",")+"\n");
    
    layout.bpm.label = hrm.bpm;
    layout.conf.label = hrm.confidence;
    layout.render();
  }

  Bangle.setPollInterval(80); // 12.5 Hz - the default
  Bangle.setHRMPower(1);
  Bangle.on('accel', accelHandler);
  Bangle.on('HRM', hrmHandler);
}

Bangle.loadWidgets();
Bangle.drawWidgets();
showMenu();