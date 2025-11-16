// loglog.app.js - Bangle.js ML-ready logging
"use strict";

/** @type {import("Espruino").Storage} */
const STORAGE = require("Storage");

// === Config ===
const ACCEL_INTERVAL = 50; // ms between logging
const MAX_FILE_SIZE = 32000; // bytes per CSV
const FILENAME_PREFIX = "loglog";

// === State ===
let hr = 0;
let hrConfidence = 0;
let lastAccelTime = 0;
let fileIdx = 0;
/** @type {StorageFile} */
let file = null;

// === Utility Functions ===

/** Generate next CSV filename */
function getNextFilename() {
  return `${FILENAME_PREFIX}${fileIdx++}.csv`;
}

/** Open CSV file and write header */
function openFile() {
  if (file) file.close();
  const fname = getNextFilename();
  file = STORAGE.open(fname, "a");
  file.write(
    "timestamp,hr,hr_conf,acc_x,acc_y,acc_z,gyro_x,gyro_y,gyro_z,orientation,battery\n"
  );
  console.log("Logging to", fname);
}

// === HRM Listener ===
/** @param {{bpm:number,confidence:number}} hrm */
Bangle.on("HRM", (hrm) => {
  hr = hrm.bpm;
  hrConfidence = hrm.confidence;
});

// === Helpers ===
/** @returns {number} battery percentage 0-100 */
function getBattery() {
  return E.getBattery();
}

/** @returns {number} orientation/heading in degrees */
function getOrientation() {
  try {
    return Bangle.getCompass() || 0;
  } catch (e) {
    return 0;
  }
}

/** @returns {{x:number,y:number,z:number}} gyro reading */
function getGyro() {
  try {
    return Bangle.getGyro() || { x: 0, y: 0, z: 0 };
  } catch (e) {
    return { x: 0, y: 0, z: 0 };
  }
}

// === File rotation & logging ===
openFile();

Bangle.on("accel", /** @param {{x:number,y:number,z:number}} a */ (a) => {
  const now = Date.now();
  if (now - lastAccelTime < ACCEL_INTERVAL) return;
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
    battery,
  ].join(",") + "\n";

  file.write(line);

  if (file.getLength && file.getLength() > MAX_FILE_SIZE) {
    openFile();
  }
});

// === Cleanup on exit ===
E.on("kill", () => {
  if (file) file.close();
  console.log("Logging stopped.");
});

// === Start sensors ===
if (!Bangle.isHRMOn()) Bangle.setHRMPower(true, "loglog");
Bangle.setCompassPower(true);
Bangle.setAccelPower(true);
Bangle.setGyroPower(true);

// === Optional: Start/stop control via interface.html ===
global.loglogStart = () => {
  openFile();
  console.log("Logging started manually");
};
global.loglogStop = () => {
  if (file) file.close();
  console.log("Logging stopped manually");
};

