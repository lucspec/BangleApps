(function() {
"use strict";
const STORAGE = require("Storage");

const ACCEL_INTERVAL = 50;
const MAX_FILE_SIZE = 32000;
const FILENAME_PREFIX = "loglog";

let hr=0, hrConf=0, lastAccelTime=0, fileIdx=0;
let file=null;
let isLogging=false;
let logCount=0;

function getBattery(){ try{return E.getBattery();}catch(e){return -1;} }
function getOrientation(){ try{return Bangle.getCompass()||0;}catch(e){return 0;} }
function getGyro(){ try{return Bangle.getGyro()||{x:0,y:0,z:0};}catch(e){return {x:0,y:0,z:0};} }

function openFile() {
  if(file) try{ file.close(); }catch(e){}
  const fname = `${FILENAME_PREFIX}${fileIdx++}.csv`;
  file = STORAGE.open(fname,"a");
  file.write("timestamp,hr,hr_conf,acc_x,acc_y,acc_z,gyro_x,gyro_y,gyro_z,orientation,battery\n");
}

function logData(a) {
  if(!isLogging || !file) return;
  const now = Date.now();
  if(now - lastAccelTime < ACCEL_INTERVAL) return;
  lastAccelTime = now;
  logCount++;
  const g = getGyro();
  const orient = getOrientation();
  const batt = getBattery();
  const line = [
    now, hr, hrConf,
    a.x.toFixed(3), a.y.toFixed(3), a.z.toFixed(3),
    g.x.toFixed(3), g.y.toFixed(3), g.z.toFixed(3),
    orient, batt
  ].join(",") + "\n";
  try{ file.write(line); }catch(e){}
  if(file.getLength && file.getLength() > MAX_FILE_SIZE) openFile();
}

function stopLogging() {
  if(!isLogging) return;
  isLogging = false;
  Bangle.removeAllListeners("accel");
  Bangle.removeAllListeners("HRM");
  try{ if(file) file.close(); }catch(e){}
  file=null;
}

function startLogging() {
  if(isLogging) return;
  isLogging = true;
  logCount = 0;
  openFile();
  Bangle.on("HRM", h=>{ hr=h.bpm; hrConf=h.confidence; });
  Bangle.on("accel", logData);
  if(!Bangle.isHRMOn()) Bangle.setHRMPower(1,"loglog");
}

// Simple command interface - no complex returns
global.loglogStart = startLogging;
global.loglogStop = stopLogging;
global.loglogStatus = function() {
  return {
    logging: isLogging,
    fileIdx: fileIdx,
    logCount: logCount,
    files: STORAGE.list(/loglog.*\.csv/).length
  };
};
})();
