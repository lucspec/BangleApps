"use strict";

/** @type {import("Espruino").Storage} */
const STORAGE = require("Storage");

/** Configuration */
const ACCEL_INTERVAL = 50; // ms between logging
const MAX_FILE_SIZE = 32000; // bytes per CSV file
const FILENAME_PREFIX = "loglog";

/** State */
let hr = 0;
let hrConf = 0;
let lastAccelTime = 0;
let fileIdx = 0;
/** @type {StorageFile} */
let file = null;

/** Export interface first — required by Web UI and loader */
global.BangleAppInterface = {
  start: startLogging,
  stop: stopLogging
};

/** Start logging */
function startLogging() {
  openFile();

  // HRM
  Bangle.on("HRM", h => { hr = h.bpm; hrConf = h.confidence; });

  // Accelerometer logging
  Bangle.on("accel", a => logData(a));

  // Ensure sensors are powered
  try { if(!Bangle.isHRMOn()) Bangle.setHRMPower(true,"loglog"); } catch(e){}
  try { Bangle.setAccelPower(true); } catch(e){}
  try { Bangle.setGyroPower(true); } catch(e){}
  try { Bangle.setCompassPower(true); } catch(e){}

  console.log("Logging started");
}

/** Stop logging */
function stopLogging() {
  try { if(file) file.close(); } catch(e){}
  file = null;

  // Remove event listeners to prevent duplicate writes
  Bangle.removeAllListeners("accel");
  Bangle.removeAllListeners("HRM");

  console.log("Logging stopped");
}

/** Open CSV file */
function openFile() {
  if(file) try{ file.close(); }catch(e){}
  const fname = getNextFilename();
  file = STORAGE.open(fname,"a");
  file.write("timestamp,hr,hr_conf,acc_x,acc_y,acc_z,gyro_x,gyro_y,gyro_z,orientation,battery\n");
  console.log("Logging to", fname);
}

/** Generate next filename */
function getNextFilename() {
  return `${FILENAME_PREFIX}${fileIdx++}.csv`;
}

/** Log a single sample */
function logData(a) {
  const now = Date.now();
  if(now - lastAccelTime < ACCEL_INTERVAL) return;
  lastAccelTime = now;

  const g = getGyro();
  const orient = getOrientation();
  const batt = getBattery();

  const line = [
    now,
    hr,
    hrConf,
    a.x.toFixed(3),
    a.y.toFixed(3),
    a.z.toFixed(3),
    g.x.toFixed(3),
    g.y.toFixed(3),
    g.z.toFixed(3),
    orient,
    batt
  ].join(",") + "\n";

  try { file.write(line); } catch(e){ console.log("Write error:", e); }

  if(file.getLength && file.getLength() > MAX_FILE_SIZE) openFile();
}

/** Helpers */
function getBattery() {
  try { return E.getBattery(); } catch(e){ return -1; }
}
function getOrientation() {
  try { return Bangle.getCompass() || 0; } catch(e){ return 0; }
}
function getGyro() {
  try { return Bangle.getGyro() || {x:0,y:0,z:0}; } catch(e){ return {x:0,y:0,z:0}; }
}

/** Cleanup on kill */
E.on("kill", () => stopLogging());

