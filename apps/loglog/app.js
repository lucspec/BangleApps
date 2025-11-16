"use strict";
/** @type {import("Espruino").Storage} */
const STORAGE = require("Storage");

/** Configuration */
const ACCEL_INTERVAL = 50; // ms
const MAX_FILE_SIZE = 32000; // bytes
const FILENAME_PREFIX = "loglog";

/** State */
let hr = 0;
let hrConfidence = 0;
let lastAccelTime = 0;
let fileIdx = 0;
/** @type {StorageFile} */
let file = null;

/** Get next CSV filename */
function getNextFilename() {
  return `${FILENAME_PREFIX}${fileIdx++}.csv`;
}

/** Open CSV file and write header */
function openFile() {
  if(file) try{file.close();}catch(e){}
  const fname = getNextFilename();
  file = STORAGE.open(fname,"a");
  file.write("timestamp,hr,hr_conf,acc_x,acc_y,acc_z,gyro_x,gyro_y,gyro_z,orientation,battery\n");
  console.log("Logging to", fname);
}

/** HRM listener */
Bangle.on("HRM", /** @param {{bpm:number,confidence:number}} hrm */ h => {
  hr = h.bpm;
  hrConfidence = h.confidence;
});

/** Helper: battery percentage */
function getBattery() {
  try { return E.getBattery(); } catch(e){ return -1; }
}

/** Helper: compass/orientation */
function getOrientation() {
  try { return Bangle.getCompass() || 0; } catch(e){ return 0; }
}

/** Helper: gyro */
function getGyro() {
  try { return Bangle.getGyro() || {x:0,y:0,z:0}; } catch(e){ return {x:0,y:0,z:0}; }
}

/** Logging function */
function logData(a) {
  const now = Date.now();
  if(now - lastAccelTime < ACCEL_INTERVAL) return;
  lastAccelTime = now;

  const g = getGyro();
  const orientation = getOrientation();
  const battery = getBattery();

  const line = [
    now,
    hr,
    hrConfidence,
    a.x.toFixed(3),
    a.y.toFixed(3),
    a.z.toFixed(3),
    g.x.toFixed(3),
    g.y.toFixed(3),
    g.z.toFixed(3),
    orientation,
    battery
  ].join(",") + "\n";

  try { file.write(line); } catch(e){ console.log("Write error:", e); }

  if(file.getLength && file.getLength() > MAX_FILE_SIZE) openFile();
}

/** Start sensors robustly */
try{ if(!Bangle.isHRMOn()) Bangle.setHRMPower(true,"loglog"); } catch(e){}
try{ Bangle.setAccelPower(true); } catch(e){}
try{ Bangle.setGyroPower(true); } catch(e){}
try{ Bangle.setCompassPower(true); } catch(e){}

/** Register event listeners */
Bangle.on("accel", logData);

/** Cleanup on exit */
E.on("kill", () => {
  if(file) try{ file.close(); } catch(e){}
  console.log("Logging stopped.");
});

/** Export interface for Web UI */
global.BangleAppInterface = {
  start: () => {
    openFile();
    console.log("Logging started");
  },
  stop: () => {
    if(file) try{ file.close(); } catch(e){}
    console.log("Logging stopped");
  }
};

/** Open initial file */
openFile();

