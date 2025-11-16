"use strict";
const STORAGE = require("Storage");

const ACCEL_INTERVAL = 50;
const MAX_FILE_SIZE = 32000;
const FILENAME_PREFIX = "loglog";

let hr=0, hrConf=0, lastAccelTime=0, fileIdx=0;
let file=null;

global.BangleAppInterface = { start: startLogging, stop: stopLogging };

function startLogging() {
  openFile();
  Bangle.on("HRM", h=>{ hr=h.bpm; hrConf=h.confidence; });
  Bangle.on("accel", a=>logData(a));
  try{ if(!Bangle.isHRMOn()) Bangle.setHRMPower(true,"loglog"); }catch(e){}
  try{ Bangle.setAccelPower(true); }catch(e){}
  try{ Bangle.setGyroPower(true); }catch(e){}
  try{ Bangle.setCompassPower(true); }catch(e){}
}

function stopLogging() {
  try{ if(file) file.close(); }catch(e){}
  file=null;
  Bangle.removeAllListeners("accel");
  Bangle.removeAllListeners("HRM");
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
  try{ file.write(line); }catch(e){}
  if(file.getLength && file.getLength() > MAX_FILE_SIZE) openFile();
}

function getBattery(){ try{return E.getBattery();}catch(e){return -1;} }
function getOrientation(){ try{return Bangle.getCompass()||0;}catch(e){return 0;} }
function getGyro(){ try{return Bangle.getGyro()||{x:0,y:0,z:0};}catch(e){return {x:0,y:0,z:0};} }

E.on("kill", ()=>stopLogging());

