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
  var layout = new Layout(
    {type: "v", c: [
        {type: "h", c: [
          {type: "v", pad: 20, c: [
            {type:"txt", font:"6x8", label:"Samp", pad:1},
            {type:"txt", id:"samples", font:"6x8:2", label:"-", pad:0, bgCol:g.theme.bg},
          ]},
          {type: "v", pad: 20, c: [
            {type:"txt", font:"6x8", label:"Time", pad:1},
            {type:"txt", id:"time", font:"6x8:2", label:"-", pad:0, bgCol:g.theme.bg},
          ]},
    ]},
    {type: "h", c: [
      { type: "v", pad: 20, c: [
        {type:"txt", font:"6x8", label:"Max G", pad:1},
        {type:"txt", id:"maxMag", font:"6x8:2", label:"-", pad:0, bgCol:g.theme.bg},
      ]},
      {type: "v", pad: 20, c: [
        {type:"txt", font:"6x8", label:"Max BPM", pad:1},
        {type:"txt", id:"bpm", font:"6x8:2", label:"-", pad:0, bgCol:g.theme.bg},
      ]},
    ]},
    {type: "h", c: [
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
        Bangle.removeListener('step', stepHandler);
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
  f.write("Epoch (ms),Battery,X,Y,Z,AccelMag,BPM,Confidence\n");
  var startTime = Date.now();
  var sampleCount = 0;
  var maxMag = 0;
  var stepCount = 0;
  var gbFlashTimeout;
  var lastUIUpdate = 0;
  
  // Rolling window of accel data (last 1 second)
  var accelWindow = [];
  //var lastAccel = {x: 0, y: 0, z: 0, mag: 0};

  function flashGBIndicator() {
    if (gbFlashTimeout) clearTimeout(gbFlashTimeout);
    layout.gb.bgCol = "#0f0";
    layout.render();
    gbFlashTimeout = setTimeout(function() {
      layout.gb.bgCol = "#00f";
      layout.render();
    }, 200);
  }

  function sendToGadgetbridge(timestamp, hrm, confidence, steps, movAvg) {
    if (!streamToGB) return;
    
    try {
      Bluetooth.println(JSON.stringify({
        t: "act",
        ts: timestamp,
        hrm: confidence > 30 ? hrm : undefined,  // Lower confidence threshold
        stp: steps,
        mov: Math.round(movAvg * 255),
        rt: 1  // Mark as realtime (don't store in DB)
      }));
      
      flashGBIndicator();
    } catch(e) {
      // Bluetooth error - probably not connected
    }
  }

  function accelHandler(accel) {
    var now = Date.now();
    var battery = E.getBattery();
    
    // Store last accel reading
    //lastAccel = {x: accel.x, y: accel.y, z: accel.z, mag: accel.mag};
    
    // Add to rolling window
    accelWindow.push({t: now, mag: accel.mag});
    
    // Remove data older than 1 second
    accelWindow = accelWindow.filter(d => now - d.t < 1000);
    
    // Write to CSV
    if (logRawData) {
      f.write([
        now,
        battery,
        Math.round(accel.x*8192),
        Math.round(accel.y*8192),
        Math.round(accel.z*8192),
        Math.round(accel.mag*8192),
        "",
        ""
      ].join(",")+"\n");
    } else {
      f.write([
        now,
        battery,
        accel.x,
        accel.y,
        accel.z,
        accel.mag,
        "",
        ""
      ].join(",")+"\n");
    }
    
    if (accel.mag > maxMag) {
      maxMag = accel.mag.toFixed(2);
    }

    sampleCount++;
    
    // Only update UI every 500ms to prevent overwriting
    var now = Date.now();
    if (now - lastUIUpdate > 500) {
      // Clear and update each field with fixed width
      layout.samples.label = (""+sampleCount).padStart(5);
      layout.time.label = (Math.round((now-startTime)/1000)+"s").padStart(5);
      layout.maxMag.label = (""+maxMag).padStart(4);
      layout.clear();
      layout.render();
      lastUIUpdate = now;
    }
  }

  function hrmHandler(hrm) {
    var now = Date.now();
    var battery = E.getBattery();
    
    // Write to CSV
    f.write([
      now,
      battery,
      "","","","",
      hrm.bpm,
      hrm.confidence
    ].join(",")+"\n");
    
    // Calculate average movement in the last 1 second window
    var movAvg = 0;
    if (accelWindow.length > 0) {
      movAvg = accelWindow.reduce((sum, d) => sum + d.mag, 0) / accelWindow.length;
    }
    
    // Stream to Gadgetbridge immediately with exact timestamp
    sendToGadgetbridge(now, hrm.bpm, hrm.confidence, stepCount, movAvg);
    
    // Update UI with fixed width
    layout.bpm.label = (""+hrm.bpm).padStart(3);
    layout.clear();
    layout.render();
  }

  function stepHandler(steps) {
    stepCount = steps;
  }

  Bangle.setPollInterval(80); // 12.5 Hz - the default
  Bangle.setHRMPower(1);
  Bangle.on('accel', accelHandler);
  Bangle.on('HRM', hrmHandler);
  Bangle.on('step', stepHandler);
}

Bangle.loadWidgets();
Bangle.drawWidgets();
showMenu();