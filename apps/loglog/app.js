var fileNumber = 0;
var MAXLOGS = 9;
var logRawData = false;
var streamToGB = true;

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
    "Stream to GB" : {
      value : !!streamToGB,
      onchange : v => { streamToGB=v; }
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
        {type:"txt", font:"6x8", label:"Samp", pad:1},
        {type:"txt", id:"samples", font:"6x8:2", label:"-", pad:2, bgCol:g.theme.bg},
      ]},
      { type: "v", c: [
        {type:"txt", font:"6x8", label:"Time", pad:1},
        {type:"txt", id:"time", font:"6x8:2", label:"-", pad:2, bgCol:g.theme.bg},
      ]},
    ]},
    { type: "h", c: [
      { type: "v", c: [
        {type:"txt", font:"6x8", label:"MaxG", pad:1},
        {type:"txt", id:"maxMag", font:"6x8:2", label:"-", pad:2, bgCol:g.theme.bg},
      ]},
      { type: "v", c: [
        {type:"txt", font:"6x8", label:"BPM", pad:1},
        {type:"txt", id:"bpm", font:"6x8:2", label:"-", pad:2, bgCol:g.theme.bg},
      ]},
    ]},
    { type: "h", c: [
      {type:"txt", id:"state", font:"6x8:2", label:"REC", bgCol:"#f00", pad:3, fillx:1},
      {type:"txt", id:"gb", font:"6x8", label:"GB", bgCol:"#00f", pad:3},
    ]},
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
        layout.state.label = "STOP";
        layout.state.bgCol = "#0f0";
        stopped = true;
        layout.render();
      }
    }}
  ]});
  layout.render();

  // now start writing
  var f = require("Storage").open(getFileName(fileNumber), "w");
  f.write("Epoch (ms),Battery,Source,X,Y,Z,Total,BPM,Confidence\n");
  var startTime = Date.now();
  var sampleCount = 0;
  var maxMag = 0;
  var stepCount = 0;
  var lastGBSend = 0;
  var gbSendInterval = 10000; // Send to GB every 10 seconds
  
  // Accumulators for GB streaming
  var gbAccelSum = 0;
  var gbAccelCount = 0;
  var gbLastHRM = 0;
  var gbLastConf = 0;

  function sendToGadgetbridge() {
    if (!streamToGB) return;
    
    // Calculate average movement intensity from accel data
    var movIntensity = 0;
    if (gbAccelCount > 0) {
      movIntensity = Math.round((gbAccelSum / gbAccelCount) * 255);
      if (movIntensity > 255) movIntensity = 255;
    }
    
    // Send activity packet to Gadgetbridge
    try {
      Bluetooth.println(JSON.stringify({
        t: "act",
        ts: Date.now(),
        hrm: gbLastConf > 50 ? gbLastHRM : undefined, // Only send if confident
        stp: stepCount,
        mov: movIntensity
      }));
      
      // Flash GB indicator
      layout.gb.bgCol = "#0f0";
      layout.render();
      setTimeout(function() {
        layout.gb.bgCol = "#00f";
        layout.render();
      }, 200);
    } catch(e) {
      // Bluetooth error - probably not connected
    }
    
    // Reset accumulators
    gbAccelSum = 0;
    gbAccelCount = 0;
  }

  function accelHandler(accel) {
    var t = Date.now();
    var battery = E.getBattery();
    
    // Accumulate for GB streaming
    gbAccelSum += accel.mag;
    gbAccelCount++;
    
    if (logRawData) {
      f.write([
        t,
        battery,
        accel.x*8192,
        accel.y*8192,
        accel.z*8192,
        accel.mag*8192,
        "",
        ""
      ].join(",")+"\n");
    } else {
      f.write([
        t,
        battery,
        accel.x,
        accel.y,
        accel.z,
        accel.mag,
        -1,
        -1
      ].join(",")+"\n");
    }
    
    if (accel.mag > maxMag) {
      maxMag = accel.mag.toFixed(2);
    }

    sampleCount++;
    layout.samples.label = sampleCount;
    layout.time.label = Math.round((Date.now()-startTime)/1000)+"s";
    layout.maxMag.label = maxMag;
    layout.render();
    
    // Send to Gadgetbridge periodically
    var now = Date.now();
    if (now - lastGBSend >= gbSendInterval) {
      sendToGadgetbridge();
      lastGBSend = now;
    }
  }

  function hrmHandler(hrm) {
    var t = Date.now();
    var battery = E.getBattery();
    
    // Store for GB streaming
    gbLastHRM = hrm.bpm;
    gbLastConf = hrm.confidence;
    
    f.write([
      t,
      battery,
      "","","","",
      hrm.bpm,
      hrm.confidence
    ].join(",")+"\n");
    
    layout.bpm.label = hrm.bpm;
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