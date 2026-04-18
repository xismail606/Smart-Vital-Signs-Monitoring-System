/* ══════════════════════════════════════════════
   VitalSync — Application Logic
   ══════════════════════════════════════════════ */

const socket = io();

// ── DOM Cache ──
const dom = {
  bpmValue:        document.getElementById('bpmValue'),
  bpmCard:         document.getElementById('bpmCard'),
  alertBanner:     document.getElementById('alertBanner'),
  statusDot:       document.getElementById('statusDot'),
  statusText:      document.getElementById('statusText'),
  statusValue:     document.getElementById('statusValue'),
  maxValue:        document.getElementById('maxValue'),
  minValue:        document.getElementById('minValue'),
  avgValue:        document.getElementById('avgValue'),
  readingCount:    document.getElementById('readingCount'),
  waitingMsg:      document.getElementById('waitingMsg'),
  pauseBtn:        document.getElementById('pauseBtn'),
  pauseIcon:       document.getElementById('pauseIcon'),
  pauseText:       document.getElementById('pauseText'),
  pausedBadge:     document.getElementById('pausedBadge'),
  fsIcon:          document.getElementById('fsIcon'),
  sessionStart:    document.getElementById('sessionStart'),
  sessionDuration: document.getElementById('sessionDuration'),
  tempValue:       document.getElementById('tempValue'),
  tempStatus:      document.getElementById('tempStatus'),
  tempCard:        document.getElementById('tempCard'),
  feverBanner:     document.getElementById('feverBanner'),
  tempMaxValue:    document.getElementById('tempMaxValue'),
  tempMinValue:    document.getElementById('tempMinValue'),
  tempAvgValue:    document.getElementById('tempAvgValue'),
};

// ── Chart Setup ──
const MAX_POINTS = 30;
const labels = [],
  dataPoints = [];
const ctx = document.getElementById("bpmChart").getContext("2d");

const chart = new Chart(ctx, {
  type: "line",
  data: {
    labels,
    datasets: [
      {
        label: "BPM",
        data: dataPoints,
        borderColor: "#ff2d55",
        backgroundColor: "rgba(255,45,85,0.08)",
        borderWidth: 2,
        pointRadius: 3,
        pointBackgroundColor: "#ff2d55",
        pointHoverRadius: 5,
        pointHoverBackgroundColor: "#fff",
        tension: 0.4,
        fill: true,
      },
    ],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 400 },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "#111118",
        borderColor: "#ff2d55",
        borderWidth: 1,
        titleColor: "#ff2d55",
        bodyColor: "#e8e8f0",
        titleFont: { family: "Space Mono" },
        bodyFont: { family: "Space Mono" },
        displayColors: false,
        callbacks: {
          label: (ctx) => `${ctx.parsed.y} BPM`,
        },
      },
    },
    scales: {
      x: { display: false },
      y: {
        grid: { color: "rgba(255,255,255,0.04)" },
        ticks: { color: "#5a5a7a", font: { family: "Space Mono", size: 11 } },
        suggestedMin: 50,
        suggestedMax: 120,
      },
    },
  },
});

// ── Temperature Chart Setup ──
const tempLabels = [],
  tempDataPoints = [];
const tempCtx = document.getElementById("tempChart").getContext("2d");

const tempChart = new Chart(tempCtx, {
  type: "line",
  data: {
    labels: tempLabels,
    datasets: [
      {
        label: "Temp °C",
        data: tempDataPoints,
        borderColor: "#ff9500",
        backgroundColor: "rgba(255,149,0,0.08)",
        borderWidth: 2,
        pointRadius: 3,
        pointBackgroundColor: "#ff9500",
        pointHoverRadius: 5,
        pointHoverBackgroundColor: "#fff",
        tension: 0.4,
        fill: true,
      },
    ],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 400 },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "#111118",
        borderColor: "#ff9500",
        borderWidth: 1,
        titleColor: "#ff9500",
        bodyColor: "#e8e8f0",
        titleFont: { family: "Space Mono" },
        bodyFont: { family: "Space Mono" },
        displayColors: false,
        callbacks: {
          label: (ctx) => `${ctx.parsed.y}°C`,
        },
      },
    },
    scales: {
      x: { display: false },
      y: {
        grid: { color: "rgba(255,255,255,0.04)" },
        ticks: {
          color: "#5a5a7a",
          font: { family: "Space Mono", size: 11 },
          callback: (v) => v + "°",
        },
        suggestedMin: 30,
        suggestedMax: 42,
      },
    },
  },
});

// ── State ──
let isPaused = false;
let maxBPM = 0,
  minBPM = Infinity;
let allBPMs = [];
let allTimestamps = [];
let hasData = false,
  lastBPM = null;
let sessionStart = null;
let sessionTimerInterval = null;
let alertSoundEnabled = true;

// ── Temperature State ──
let lastTemp = null;
let maxTemp = -Infinity,
  minTemp = Infinity;
let allTemps = [];

// ── Audio Context for Alert Sound ──
let audioCtx = null;
function playAlertBeep() {
  if (!alertSoundEnabled) return;
  try {
    if (!audioCtx)
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = 880;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.4);
  } catch (e) {
    /* ignore audio errors */
  }
}

// ── Session Timer ──
function startSessionTimer() {
  sessionStart = Date.now();
  dom.sessionStart.textContent = formatTime(
    new Date(sessionStart),
  );

  sessionTimerInterval = setInterval(() => {
    const elapsed = Date.now() - sessionStart;
    const mins = Math.floor(elapsed / 60000);
    const secs = Math.floor((elapsed % 60000) / 1000);
    dom.sessionDuration.textContent =
      `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }, 1000);
}

function formatTime(d) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

// ── Pause / Resume ──
function togglePause() {
  isPaused = !isPaused;
  socket.emit("control", isPaused ? "pause" : "resume");

  const btn = dom.pauseBtn;
  const dot = dom.statusDot;
  const badge = dom.pausedBadge;
  const card = dom.bpmCard;
  const val = dom.bpmValue;
  if (isPaused) {
    btn.classList.add("paused");
    dom.pauseIcon.textContent = "▶";
    dom.pauseText.textContent = "Resume";
    dot.classList.replace("active", "paused");
    badge.classList.add("visible");
    card.classList.add("paused");
    val.classList.add("paused-color");
    dom.statusText.textContent = "Paused";
  } else {
    btn.classList.remove("paused");
    dom.pauseIcon.textContent = "⏸";
    dom.pauseText.textContent = "Pause";
    dot.classList.replace("paused", "active");
    badge.classList.remove("visible");
    card.classList.remove("paused");
    val.classList.remove("paused-color");
    if (lastBPM !== null) updateDashboard(lastBPM, Date.now());
  }
}

// ── Fullscreen ──
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
    dom.fsIcon.textContent = "🔲";
  } else {
    document.exitFullscreen();
    dom.fsIcon.textContent = "⛶";
  }
}

document.addEventListener("fullscreenchange", () => {
  dom.fsIcon.textContent = document.fullscreenElement
    ? "🔲"
    : "⛶";
});

// ── Reset Dashboard ──
function resetDashboard() {
  // Reset state
  maxBPM = 0;
  minBPM = Infinity;
  allBPMs = [];
  allTimestamps = [];
  hasData = false;
  lastBPM = null;

  // Clear chart
  labels.length = 0;
  dataPoints.length = 0;
  chart.options.scales.y.suggestedMin = 50;
  chart.options.scales.y.suggestedMax = 120;
  chart.update();

  // Reset UI elements
  dom.bpmValue.textContent = "---";
  dom.statusValue.textContent = "—";
  dom.statusValue.className = "stat-value";
  dom.maxValue.textContent = "—";
  dom.minValue.textContent = "—";
  dom.avgValue.textContent = "—";
  dom.readingCount.textContent = "0";
  dom.waitingMsg.style.display = "";
  dom.bpmCard.classList.remove("alert");
  dom.alertBanner.classList.remove("visible");

  // Reset temperature state
  lastTemp = null;
  maxTemp = -Infinity;
  minTemp = Infinity;
  allTemps = [];
  tempLabels.length = 0;
  tempDataPoints.length = 0;
  tempChart.options.scales.y.suggestedMin = 30;
  tempChart.options.scales.y.suggestedMax = 42;
  tempChart.update();
  dom.tempValue.textContent = "--.-";
  dom.tempStatus.textContent = "Waiting for sensor...";
  dom.tempMaxValue.textContent = "—";
  dom.tempMinValue.textContent = "—";
  dom.tempAvgValue.textContent = "—";
  dom.tempCard.classList.remove("fever");
  dom.feverBanner.classList.remove("visible");

  // Reset session timer
  if (sessionTimerInterval) clearInterval(sessionTimerInterval);
  sessionTimerInterval = null;
  sessionStart = null;
  document.getElementById("sessionStart").textContent = "--:--:--";
  document.getElementById("sessionDuration").textContent = "00:00";

  // If paused, unpause
  if (isPaused) {
    isPaused = false;
    dom.pauseBtn.classList.remove("paused");
    dom.pauseIcon.textContent = "⏸";
    dom.pauseText.textContent = "Pause";
    dom.pausedBadge.classList.remove("visible");
    dom.bpmCard.classList.remove("paused");
    dom.bpmValue.classList.remove("paused-color");  }

  // Send reset to server → Arduino
  socket.emit("control", "reset");

  // Update status
  const dot = dom.statusDot;
  dot.classList.remove("paused");
  dot.classList.add("active");
  dom.statusText.textContent =
    "Session reset — waiting for data...";
}

// ── Export CSV ──
function exportCSV() {
  if (allBPMs.length === 0) return;

  let csv = "Index,BPM,Status,Temperature(°C),Timestamp\n";
  allBPMs.forEach((bpm, i) => {
    let status = "Normal";
    if (bpm < 60) status = "Low";
    else if (bpm > 140) status = "Danger";
    else if (bpm > 100) status = "High";
    const temp = allTemps[i] !== undefined ? allTemps[i] : "N/A";
    const ts = allTimestamps[i] ? new Date(allTimestamps[i]).toLocaleTimeString() : "N/A";
    csv += `${i + 1},${bpm},${status},${temp},${ts}\n`;
  });

  csv += `\nMin BPM,${minBPM === Infinity ? "N/A" : minBPM}\n`;
  csv += `Max BPM,${maxBPM}\n`;
  csv += `Average BPM,${Math.round(allBPMs.reduce((a, b) => a + b, 0) / allBPMs.length)}\n`;
  csv += `Total Readings,${allBPMs.length}\n`;
  if (allTemps.length > 0) {
    csv += `Min Temp,${minTemp === Infinity ? "N/A" : minTemp}°C\n`;
    csv += `Max Temp,${maxTemp === -Infinity ? "N/A" : maxTemp}°C\n`;
    const avgTemp = (allTemps.reduce((a, b) => a + b, 0) / allTemps.length).toFixed(1);
    csv += `Average Temp,${avgTemp}°C\n`;
  }

  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vitalsync-data-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Socket Events ──
socket.on("connect", () => {
  dom.statusDot.classList.add("active");
  dom.statusText.textContent = "Connected to server";
});

socket.on("disconnect", () => {
  dom.statusDot.classList.remove("active", "paused");
  dom.statusText.textContent = "Disconnected!";
});

socket.on("serial-status", ({ connected, error }) => {
  if (connected) {
    dom.statusDot.classList.add("active");
    dom.statusText.textContent = "Sensor connected";
  } else if (error) {
    dom.statusText.textContent = `Error: ${error}`;
  }
});

// Arduino hardware status messages
socket.on("arduino-status", ({ status }) => {
  const statusMap = {
    CALIBRATING: "Calibrating sensor...",
    READY: "Sensor ready",
    NO_SIGNAL: "No signal — place finger",
    NO_TEMP_SENSOR: "No temperature sensor detected",
    PAUSED: "Arduino paused",
    RESUMED: "Arduino resumed",
    RESET: "Session reset",
    LOW: "Low heart rate",
    NORMAL: "Normal heart rate",
    HIGH: "High heart rate",
  };
  const dot = dom.statusDot;
  const msg = statusMap[status] || status;

  if (status === "NO_SIGNAL") {
    dot.classList.remove("active");
    dot.classList.add("paused");
    dom.statusText.textContent = msg;
  } else if (status === "NO_TEMP_SENSOR") {
    dom.tempStatus.textContent = "Sensor not found";
    dom.tempStatus.className = "temp-status low";
  } else if (status === "READY" || status === "RESUMED" || status === "RESET") {
    dot.classList.remove("paused");
    dot.classList.add("active");
    dom.statusText.textContent = msg;
  } else if (status === "CALIBRATING") {
    dom.statusText.textContent = msg;
  }
});

socket.on("bpm", ({ bpm, time }) => {
  lastBPM = bpm;
  if (!isPaused) updateDashboard(bpm, time);
});

// ── Temperature Socket Event ──
socket.on("temperature", ({ temp, time }) => {
  lastTemp = temp;
  if (!isPaused) updateTemperature(temp, time);
});

// ── Update Dashboard ──
let lastAlertTime = 0;

function updateDashboard(bpm, time) {
  // Start session timer on first data
  if (!hasData) {
    hasData = true;
    dom.waitingMsg.style.display = "none";
    startSessionTimer();
  }

  // Animate BPM value
  const bpmEl = dom.bpmValue;
  bpmEl.textContent = bpm;
  bpmEl.classList.remove("beat");
  void bpmEl.offsetWidth;
  bpmEl.classList.add("beat");

  // Alert for high BPM
  const isHigh = bpm > 100;
  dom.bpmCard.classList.toggle("alert", isHigh);
  dom.alertBanner.classList.toggle("visible", isHigh);

  if (isHigh && Date.now() - lastAlertTime > 5000) {
    playAlertBeep();
    lastAlertTime = Date.now();
  }

  // Status
  const s = dom.statusValue;
  if (bpm < 60) {
    s.textContent = "Low";
    s.className = "stat-value caution";
  } else if (bpm <= 100) {
    s.textContent = "Normal ✓";
    s.className = "stat-value normal";
  } else if (bpm <= 140) {
    s.textContent = "High ⚠";
    s.className = "stat-value high";
  } else {
    s.textContent = "Danger 🚨";
    s.className = "stat-value high";
  }

  // Max / Min
  if (bpm > maxBPM) {
    maxBPM = bpm;
    dom.maxValue.textContent = maxBPM;
  }
  if (bpm < minBPM) {
    minBPM = bpm;
    dom.minValue.textContent = minBPM;
  }

  // Average
  allBPMs.push(bpm);
  allTimestamps.push(time);
  if (allBPMs.length > 200) { allBPMs.shift(); allTimestamps.shift(); }
  const avg = Math.round(allBPMs.reduce((a, b) => a + b, 0) / allBPMs.length);
  dom.avgValue.textContent = avg;

  // Chart — dynamic Y axis
  const currentMin = Math.min(...dataPoints, bpm);
  const currentMax = Math.max(...dataPoints, bpm);
  chart.options.scales.y.suggestedMin = Math.max(30, currentMin - 15);
  chart.options.scales.y.suggestedMax = currentMax + 15;

  const t = new Date(time);
  const label = formatTime(t);
  labels.push(label);
  dataPoints.push(bpm);
  if (labels.length > MAX_POINTS) {
    labels.shift();
    dataPoints.shift();
  }
  chart.update();

  // Reading count
  dom.readingCount.textContent = allBPMs.length;

  // Status text
  if (!isPaused) {
    dom.statusText.textContent = `Last update ${label}`;
  }
}

// ── Update Temperature ──
function updateTemperature(temp, time) {
  // Update display value
  const tempEl = dom.tempValue;
  tempEl.textContent = temp.toFixed(1);

  // Fever detection (> 37.5°C)
  const isFever = temp > 37.5;
  dom.tempCard.classList.toggle("fever", isFever);
  dom.feverBanner.classList.toggle("visible", isFever);

  // Temperature status
  const ts = dom.tempStatus;
  if (temp < 36.0) {
    ts.textContent = "Low";
    ts.className = "temp-status low";
  } else if (temp <= 37.5) {
    ts.textContent = "Normal";
    ts.className = "temp-status normal";
  } else {
    ts.textContent = "Fever ⚠";
    ts.className = "temp-status fever";
  }

  // Max / Min
  if (temp > maxTemp) {
    maxTemp = temp;
    dom.tempMaxValue.textContent = maxTemp.toFixed(1) + "°";
  }
  if (temp < minTemp) {
    minTemp = temp;
    dom.tempMinValue.textContent = minTemp.toFixed(1) + "°";
  }

  // Store & Average
  allTemps.push(temp);
  if (allTemps.length > 200) allTemps.shift();
  const avgTemp = (allTemps.reduce((a, b) => a + b, 0) / allTemps.length).toFixed(1);
  dom.tempAvgValue.textContent = avgTemp + "°";

  // Chart — dynamic Y axis
  const cMin = Math.min(...tempDataPoints, temp);
  const cMax = Math.max(...tempDataPoints, temp);
  tempChart.options.scales.y.suggestedMin = Math.max(20, cMin - 2);
  tempChart.options.scales.y.suggestedMax = cMax + 2;

  const t = new Date(time);
  const label = formatTime(t);
  tempLabels.push(label);
  tempDataPoints.push(temp);
  if (tempLabels.length > MAX_POINTS) {
    tempLabels.shift();
    tempDataPoints.shift();
  }
  tempChart.update();
}
