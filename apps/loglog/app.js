// LogLog - Heart Rate and Accelerometer Logger
// Uses circular buffer for continuous logging

E.setFlags({pretokenise:1});

// Load settings
var settings = Object.assign({
  maxFileSize: 100,
  logRawData: false,
  pollInterval: 80
}, require('Storage').readJSON('loglog.json', true) || {});

var fileName = "loglog.csv";
var maxFileSize = settings.maxFileSize * 1024; // Convert KB to bytes
var logRawData = settings.logRawData;
var logging = false;

function showMenu() {
  var fileSize = 0;
  var f = require("Storage").read(fileName);
  if (f) fileSize = f.length;
  
  var menu = {
    "" : { title : "LogLog" },
    "< Back" : function() {
      load();
    },
    "Start Recording" : function() {
      E.showMenu();
      startRecord();
    },
    "Stop Recording" : function() {
      stopRecord();
      showMenu();
    },
    "View Log" : function() {
      viewLog();
    },
    "Clear Log" : function() {
      E.showPrompt("Clear all data?").then(ok=>{
        if (ok) {
          require("Storage").erase(fileName);
          E.showMessage("Cleared!", "Success");
          setTimeout(showMenu, 1000);
        } else showMenu();
      });
    },
    "Log raw data" : {
      value : !!settings.logRawData,
      onchange : v => { 
        settings.logRawData = v;
        require('Storage').writeJSON('loglog.json', settings);
        logRawData = v;
        if (logging) {
          stopRecord();
          E.showMessage("Restart recording\nfor setting change", "Notice");
          setTimeout(showMenu, 2000);
        }
      }
    },
    "File size" : {
      value : Math.round(fileSize/1024)+"KB"
    },
  };
  E.showMenu(menu);
}

function viewLog() {
  E.showMessage("Loading...");
  var f = require("Storage").read(fileName);
  if (!f) {
    E.showMessage("No log data", "Empty");
    setTimeout(showMenu, 1500);
    return;
  }
  
  var lines = f.split("\n");
  var records = lines.length - 1; // minus header
  var lastLine = lines[lines.length-1];
  var firstLine = lines[1];
  var length = 0;
  
  if (lastLine && firstLine) {
    var lastTime = parseInt(lastLine.split(",")[0]);
    var firstTime = parseInt(firstLine.split(",")[0]);
    if (!isNaN(lastTime) && !isNaN(firstTime)) {
      length = Math.round((lastTime - firstTime)/1000);
    }
  }

  var menu = {
    "" : { title : "Log Data" },
    "< Back" : () => { showMenu(); }
  };
  menu[records+" Records"] = "";
  menu[length+" Seconds"] = "";
  menu[Math.round(f.length/1024)+" KB"] = "";
  
  E.showMenu(menu);
}

function stopRecord() {
  if (!logging) return;
  logging = false;
  
  Bangle.removeListener('accel', accelHandler);
  Bangle.removeListener('HRM', hrmHandler);
  Bangle.setHRMPower(0, "loglog");
}

function startRecord() {
  if (logging) return;
  
  logging = true;
  var stopped = false;
  
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
        {type:"txt", font:"6x8", label:"HR", pad:2},
        {type:"txt", id:"hr", font:"6x8:2", label:" - ", pad:5, bgCol:g.theme.bg},
      ]},
      { type: "v", c: [
        {type:"txt", font:"6x8", label:"Conf", pad:2},
        {type:"txt", id:"conf", font:"6x8", label:" - ", pad:5, bgCol:g.theme.bg},
      ]},
    ]},
    { type: "h", c: [
      { type: "v", c: [
        {type:"txt", font:"6x8", label:"Max X", pad:2},
        {type:"txt", id:"maxX", font:"6x8", label:" - ", pad:5, bgCol:g.theme.bg},
      ]},
      { type: "v", c: [
        {type:"txt", font:"6x8", label:"Max Y", pad:2},
        {type:"txt", id:"maxY", font:"6x8", label:" - ", pad:5, bgCol:g.theme.bg},
      ]},
      { type: "v", c: [
        {type:"txt", font:"6x8", label:"Max Z", pad:2},
        {type:"txt", id:"maxZ", font:"6x8", label:" - ", pad:5, bgCol:g.theme.bg},
      ]},
    ]},
    {type:"txt", font:"6x8", label:"Max G", pad:2},
    {type:"txt", id:"maxMag", font:"6x8:3", label:"  -  ", pad:5, bgCol:g.theme.bg},
    {type:"txt", id:"state", font:"6x8:2", label:"RECORDING", bgCol:"#f00", pad:5, fillx:1},
  ]},
  {
    btns:[
    {id: "btnStop", label:"STOP", cb:()=>{
      if (stopped) {
        stopRecord();
        showMenu();
      }
      else {
        Bangle.removeListener('accel', accelHandler);
        layout.state.label = "STOPPED";
        layout.state.bgCol = "#0f0";
        stopped = true;
        layout.render();
      }
    }}
  ]});
  layout.render();

  // Initialize or append to file
  var f = require("Storage").read(fileName);
  if (!f) {
    require("Storage").write(fileName, "Time (ms),BPM,Confidence,X,Y,Z,Magnitude\n");
  }
  
  var start = getTime();
  var sampleCount = 0;
  var maxMag = 0;
  var maxX = 0;
  var maxY = 0;
  var maxZ = 0;
  var lastHR = {bpm: 0, confidence: 0};
  var buffer = "";
  var bufferSize = 0;
  var writeInterval;

  function writeBuffer() {
    if (buffer.length === 0) return;
    
    var currentData = require("Storage").read(fileName);
    var newData = currentData + buffer;
    
    // Circular buffer logic: if too large, trim from the beginning
    if (newData.length > maxFileSize) {
      var lines = newData.split("\n");
      var header = lines[0];
      var dataLines = lines.slice(1);
      
      // Keep approximately last 80% of max size
      var targetSize = maxFileSize * 0.8;
      var totalDataSize = newData.length - header.length - 1;
      var linesToKeep = Math.floor(dataLines.length * targetSize / totalDataSize);
      
      var keptLines = dataLines.slice(-linesToKeep);
      newData = header + "\n" + keptLines.join("\n");
    }
    
    require("Storage").write(fileName, newData);
    buffer = "";
  }

  function hrmHandler(hrm) {
    lastHR = {bpm: hrm.bpm, confidence: hrm.confidence};
    layout.hr.label = hrm.bpm;
    layout.conf.label = hrm.confidence;
    layout.render();
  }

  function accelHandler(accel) {
    var t = getTime()-start;
    
    // Add to buffer
    if (logRawData) {
      buffer += [
        Math.round(t*1000),
        lastHR.bpm,
        lastHR.confidence,
        Math.round(accel.x*8192),
        Math.round(accel.y*8192),
        Math.round(accel.z*8192),
        Math.round(accel.mag*8192),
      ].join(",")+"\n";
    } else {
      buffer += [
        Math.round(t*1000),
        lastHR.bpm,
        lastHR.confidence,
        accel.x.toFixed(3),
        accel.y.toFixed(3),
        accel.z.toFixed(3),
        accel.mag.toFixed(3),
      ].join(",")+"\n";
    }
    
    // Write buffer every 50 samples to reduce storage operations
    bufferSize++;
    if (bufferSize >= 50) {
      writeBuffer();
      bufferSize = 0;
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

  // Write buffer periodically even if not full
  writeInterval = setInterval(writeBuffer, 5000);

  // Start Heart Rate Monitor
  Bangle.setHRMPower(1, "loglog");
  Bangle.on('HRM', hrmHandler);

  // Start Accelerometer
  Bangle.setPollInterval(settings.pollInterval);
  Bangle.on('accel', accelHandler);
  
  // Cleanup on stop
  var originalStop = stopRecord;
  stopRecord = function() {
    originalStop();
    if (writeInterval) clearInterval(writeInterval);
    writeBuffer(); // Final write
  };
}

Bangle.loadWidgets();
Bangle.drawWidgets();
showMenu();
