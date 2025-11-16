"use strict";
const STORAGE = require("Storage");

const ACCEL_INTERVAL = 50;
const MAX_FILE_SIZE = 32000;
const FILENAME_PREFIX = "loglog";

let hr=0, hrConf=0, lastAccelTime=0, fileIdx=0;
let file=null;
let isLogging = false;
let startTime = 0;
let logCount = 0;

global.BangleAppInterface = { start: startLogging, stop: stopLogging };

function startLogging() {
  if(isLogging) return;
  isLogging = true;
  startTime = Date.now();
  logCount = 0;
  openFile();
  Bangle.on("HRM", h=>{ hr=h.bpm; hrConf=h.confidence; });
  Bangle.on("accel", a=>logData(a));
  try{ if(!Bangle.isHRMOn()) Bangle.setHRMPower(true,"loglog"); }catch(e){}
  try{ Bangle.setAccelPower(true); }catch(e){}
  try{ Bangle.setGyroPower(true); }catch(e){}
  try{ Bangle.setCompassPower(true); }catch(e){}
  drawUI();
}

function stopLogging() {
  if(!isLogging) return;
  isLogging = false;
  try{ if(file) file.close(); }catch(e){}
  file=null;
  Bangle.removeAllListeners("accel");
  Bangle.removeAllListeners("HRM");
  try{ Bangle.setHRMPower(false,"loglog"); }catch(e){}
  drawUI();
}

function openFile() {
  if(file) try{ file.close(); }catch(e){}
  const fname = `${FILENAME_PREFIX}${fileIdx++}.csv`;
  file = STORAGE.open(fname,"a");
  file.write("timestamp,hr,hr_conf,acc_x,acc_y,acc_z,gyro_x,gyro_y,gyro_z,orientation,battery\n");
}

function logData(a) {
  const now = Date.now();
  if(now - lastAccelTime < ACCEL_INTERVAL) return;
  lastAccelTime = now;
  const g = getGyro();
  const orient = getOrientation();
  const batt = getBattery();
  const line = [
    now, hr, hrConf,
    a.x.toFixed(3), a.y.toFixed(3), a.z.toFixed(3),
    g.x.toFixed(3), g.y.toFixed(3), g.z.toFixed(3),
    orient, batt
  ].join(",") + "\n";
  try{ 
    file.write(line);
    logCount++;
    if(logCount % 20 === 0) drawUI(); // Update UI every 20 logs (~1 sec)
  }catch(e){}
  if(file.getLength && file.getLength() > MAX_FILE_SIZE) openFile();
}

function getBattery(){ try{return E.getBattery();}catch(e){return -1;} }
function getOrientation(){ try{return Bangle.getCompass()||0;}catch(e){return 0;} }
function getGyro(){ try{return Bangle.getGyro()||{x:0,y:0,z:0};}catch(e){return {x:0,y:0,z:0};} }

function getStorageInfo() {
  const info = STORAGE.getFree();
  const totalKB = Math.round(info / 1024);
  return totalKB;
}

function countLogFiles() {
  const files = STORAGE.list(/loglog.*\.csv/);
  return files.length;
}

function drawUI() {
  g.clear();
  g.setFont("6x8", 2);
  g.setFontAlign(0, 0);
  
  // Title
  g.drawString("LogLog", g.getWidth()/2, 30);
  
  // Status
  g.setFont("6x8", 1);
  if(isLogging) {
    g.setColor(0,1,0); // Green
    g.drawString("LOGGING", g.getWidth()/2, 60);
    g.setColor(1,1,1); // White
    
    // Duration
    const duration = Math.floor((Date.now() - startTime) / 1000);
    const mins = Math.floor(duration / 60);
    const secs = duration % 60;
    g.drawString(`Time: ${mins}m ${secs}s`, g.getWidth()/2, 80);
    
    // Log count
    g.drawString(`Logs: ${logCount}`, g.getWidth()/2, 100);
  } else {
    g.setColor(1,0,0); // Red
    g.drawString("STOPPED", g.getWidth()/2, 60);
    g.setColor(1,1,1); // White
  }
  
  // Storage info
  const freeKB = getStorageInfo();
  g.drawString(`Free: ${freeKB} KB`, g.getWidth()/2, 130);
  
  // File count
  const fileCount = countLogFiles();
  g.drawString(`Files: ${fileCount}`, g.getWidth()/2, 150);
  
  // Instructions
  g.setFont("6x8", 1);
  g.drawString("BTN1: Start", g.getWidth()/2, 190);
  g.drawString("BTN2: Stop", g.getWidth()/2, 210);
  g.drawString("BTN3: Exit", g.getWidth()/2, 230);
}

// Button handlers
setWatch(() => {
  startLogging();
}, BTN1, {repeat:true, edge:"falling"});

setWatch(() => {
  stopLogging();
}, BTN2, {repeat:true, edge:"falling"});

setWatch(() => {
  stopLogging();
  load();
}, BTN3, {repeat:true, edge:"falling"});

// Cleanup
E.on("kill", ()=>{
  stopLogging();
});

// Draw initial UI
drawUI();
