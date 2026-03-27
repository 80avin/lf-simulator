import { LFS, Robot, LineSensor } from './core.js';
import { ControllerAPI, EXAMPLES, TYPE_DEFINITIONS, DEFAULT_CONTROLLER } from './controllers.js';
import { ScoreCalculator, ProjectManager, MapManager } from './utils.js';

// ============================================
// CIRCULAR BUFFER FOR LIVE CHARTS
// ============================================
class CircularBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.buffer = new Array(capacity).fill(0);
    this.head = 0;
    this.size = 0;
  }

  push(value) {
    this.buffer[this.head] = value;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) {
      this.size++;
    }
  }

  toArray() {
    if (this.size < this.capacity) {
      // Not yet full, return partial array
      return this.buffer.slice(0, this.size);
    }
    // Full buffer, return in correct order
    const result = new Array(this.capacity);
    for (let i = 0; i < this.capacity; i++) {
      result[i] = this.buffer[(this.head + i) % this.capacity];
    }
    return result;
  }

  clear() {
    this.head = 0;
    this.size = 0;
    this.buffer.fill(0);
  }

  getMin() {
    return Math.min(...this.toArray());
  }

  getMax() {
    return Math.max(...this.toArray());
  }
}

// ============================================
// MONACO EDITOR SETUP
// ============================================
let monacoEditor = null;
let compileTimeout = null;
const COMPILE_DELAY = 500; // ms

function loadMonacoLoader(callback) {
  // Check if loader is already loaded
  if (typeof require !== "undefined") {
    callback();
    return;
  }

  // Create script element to load Monaco's AMD loader
  const script = document.createElement("script");
  script.src =
    "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.53.0/min/vs/loader.min.js";
  script.onload = callback;
  script.onerror = () => {
    console.error("Failed to load Monaco loader script");
    showStatus("✗ Failed to load editor", "error");
  };
  document.head.appendChild(script);
}

function initMonaco() {
  loadMonacoLoader(() => {
    require.config({
      paths: {
        vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.53.0/min/vs",
      },
    });

    require(["vs/editor/editor.main"], function () {
      // Add type definitions for autocomplete
      monaco.languages.typescript.javascriptDefaults.addExtraLib(
        TYPE_DEFINITIONS,
        "ts:filename/lfs-api.d.ts",
      );

      // Configure JavaScript defaults
      monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions(
        {
          noSemanticValidation: false,
          noSyntaxValidation: false,
        },
      );

      monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
        target: monaco.languages.typescript.ScriptTarget.ES2020,
        allowNonTsExtensions: true,
      });

      // Create editor
      monacoEditor = monaco.editor.create(
        document.getElementById("editor"),
        {
          value: DEFAULT_CONTROLLER,
          language: "javascript",
          theme: "vs-dark",
          automaticLayout: true,
          fontSize: 13,
          minimap: { enabled: true },
          scrollBeyondLastLine: false,
          lineNumbers: "on",
          renderWhitespace: "selection",
          tabSize: 4,
          insertSpaces: true,
        },
      );

      window.monacoEditor = monacoEditor;

      // Setup auto-compile on change
      monacoEditor.onDidChangeModelContent(() => {
        clearTimeout(compileTimeout);
        compileTimeout = setTimeout(() => {
          compileUserCode(monacoEditor.getValue());
        }, COMPILE_DELAY);
      });

      // Keyboard shortcuts
      monacoEditor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
        () => {
          runCode();
        },
      );

      // Initial compilation
      compileUserCode(monacoEditor.getValue());

      // Try loading from URL
      if (!loadFromURL()) {
        // Try loading last project
        const lastProject = localStorage.getItem("lfs-last-project");
        if (lastProject) {
          projectManager.loadProject(lastProject, monacoEditor, mapManager, setRobotPosition, showStatus);
        }
      }
    });
  });
}

// ============================================
// CODE COMPILATION & EXECUTION
// ============================================
let userController = null;

function compileUserCode(code) {
  try {
    // Clear previous markers
    if (monacoEditor) {
      monaco.editor.setModelMarkers(monacoEditor.getModel(), "owner", []);
    }

    // Validate syntax
    new Function(code);

    // Create controller instance
    const ControllerClass = new Function(
      "ControllerAPI",
      `${code}\nreturn Controller;`,
    )(ControllerAPI);

    // Instantiate
    userController = new ControllerClass();

    // Validate required methods
    if (typeof userController.update !== "function") {
      throw new Error("Controller must have an update() method");
    }

    // Call init if it exists
    if (typeof userController.init === "function") {
      userController.init(controllerAPI);
    }

    showStatus("✓ Compiled successfully", "success");
    return true;
  } catch (error) {
    showCompilationError(error);
    userController = null;
    return false;
  }
}

function showCompilationError(error) {
  showStatus("✗ Compilation error: " + error.message, "error");

  // Try to extract line number from error
  const match = error.stack && error.stack.match(/:(\d+):/);
  if (match && monacoEditor) {
    const lineNumber = parseInt(match[1]);
    monaco.editor.setModelMarkers(monacoEditor.getModel(), "owner", [
      {
        startLineNumber: lineNumber,
        startColumn: 1,
        endLineNumber: lineNumber,
        endColumn: 1000,
        message: error.message,
        severity: monaco.MarkerSeverity.Error,
      },
    ]);
  }

  console.error("Compilation error:", error);
}

function showRuntimeError(error) {
  showStatus("✗ Runtime error: " + error.message, "error");
  console.error("Runtime error:", error);
  lfs.contestStop();
}

function showStatus(message, type = "info") {
  const statusEl = document.getElementById("compile-status");
  statusEl.textContent = message;
  statusEl.className = "status-" + type;
}

function runCode() {
  if (compileUserCode(monacoEditor.getValue())) {
    resetRobot();
    // Clear chart buffers (both data and timestamps)
    chartBuffers.speed.clear();
    chartBuffers.times.clear();
    chartBuffers.error.clear();
    chartBuffers.turnRate.clear();
    setTimeout(() => {
      lfs.contestStart();
      resetController();
      scoreCalculator.reset();
      scoreCalculator.setStartPosition(lfs.robot.xi, lfs.robot.yi);
    }, 100);
  }
}

// ============================================
// URL SHARING
// ============================================
function shareToURL() {
  try {
    const state = {
      code: monacoEditor.getValue(),
      config: {
        mapId: mapManager.currentMap || "novice",
        robotPos: [lfs.robot.x, lfs.robot.y, lfs.robot.heading],
      },
    };

    const json = JSON.stringify(state);
    const compressed = LZString.compressToBase64(json);

    const url = new URL(window.location.href.split("#")[0]);
    url.hash = compressed;

    navigator.clipboard
      .writeText(url.href)
      .then(() => {
        showStatus("✓ URL copied to clipboard", "success");
      })
      .catch(() => {
        // Fallback: show URL in prompt
        prompt("Copy this URL:", url.href);
      });
  } catch (error) {
    showStatus("✗ Failed to create share URL", "error");
    console.error(error);
  }
}

function loadFromURL() {
  const hash = window.location.hash.slice(1);
  if (!hash) return false;

  try {
    const json = LZString.decompressFromBase64(hash);
    const state = JSON.parse(json);

    monacoEditor.setValue(state.code);

    // Load map
    if (state.config.mapId) {
      mapManager.loadMap(state.config.mapId, lfs, scoreCalculator, setRobotPosition, showStatus);
    }

    setRobotPosition(...state.config.robotPos);

    showStatus("✓ Loaded from URL", "success");
    return true;
  } catch (error) {
    console.error("Failed to load from URL:", error);
    showStatus("✗ Failed to load from URL", "error");
    return false;
  }
}

// ============================================
// P5.JS SKETCH
// ============================================
/** @type LFS */
let lfs;
/** @type LineSensor */
let lineSensor;
/** @type ControllerAPI */
let controllerAPI;
/** @type ProjectManager */
let projectManager;
/** @type ScoreCalculator */
let scoreCalculator;
/** @type MapManager */
let mapManager;

// Global state
let currentMapUrl =
  "https://raw.githubusercontent.com/ron-grant/LFS/refs/heads/master/distribution/lineFollowerSim-15/examples/MecanumDemo/data/Novice_LF_course-Fall_2018_64DPI.jpg";

// Physics/Rendering decoupling (Phase 2)
let physicsAccumulator = 0;
let physicsFrequency = 60; // User-configurable (10-1000 Hz)

// Live charts (Phase 2 enhancement)
const CHART_TIME_WINDOW = 3.0;  // Show last 3 seconds of data
let chartBuffers = {
  speed: new CircularBuffer(3000),     // Large enough for 3s at 1000Hz
  times: new CircularBuffer(3000), // Timestamps for speed data
  error: new CircularBuffer(3000),
  turnRate: new CircularBuffer(3000),
};
let chartCanvases = {};  // Will store 2D contexts

window.setup = function() {
  let canvas = createCanvas(windowWidth - 40, windowHeight);
  canvas.parent(document.getElementById("canvas-panel"));
  canvas.style("display", "block");
  canvas.mousePressed(canvasClicked);

  lfs = new LFS();
  lfs.robotVP = { x: 20, y: 20, w: 300, h: 300 };
  lfs.courseVP = {
    x: 340,
    y: 20,
    w: windowWidth - 400,
    h: windowHeight - 40,
  };

  // Create default sensors - 9 element line sensor, 2 inches forward of center
  lineSensor = lfs.createLineSensor(2, 0, 5, 5, 9);

  // Create API wrapper with physics Hz getter
  controllerAPI = new ControllerAPI(lfs, lineSensor, () => physicsFrequency);

  // Initialize project manager
  projectManager = new ProjectManager();
  projectManager.updateProjectList();

  // Initialize score calculator
  scoreCalculator = new ScoreCalculator();

  // Initialize map manager
  mapManager = new MapManager();
  mapManager.populateMapSelector();

  // Populate example selector
  populateExampleSelector();

  // Setup resizer
  setupResizer();

  // Initialize chart canvases
  chartCanvases.speed = document.getElementById('chart-speed').getContext('2d');
  chartCanvases.error = document.getElementById('chart-error').getContext('2d');
  chartCanvases.turnRate = document.getElementById('chart-turnrate').getContext('2d');

  frameRate(60);

  // Load default map
  mapManager.loadMap("novice", lfs, scoreCalculator, setRobotPosition, showStatus);

  // NEW: Set initial position for completion tracking
  scoreCalculator.setStartPosition(lfs.robot.xi, lfs.robot.yi);
};

// Initialize Monaco after page loads
window.addEventListener("load", () => {
  initMonaco();
});

window.windowResized = function() {
  resizeCanvas(windowWidth - 40, windowHeight);
  lfs.courseVP.w = windowWidth - 400;
  lfs.courseVP.h = windowHeight - 40;
};

window.draw = function() {
  background(20);

  if (!lfs || !lfs.courseImage) return;

  // Accumulator pattern for fixed timestep physics
  const frameDelta = deltaTime / 1000; // p5.js provides deltaTime in ms
  const drawStartTime = Date.now() / 1000;
  physicsAccumulator += frameDelta;

  const PHYSICS_DT = 1 / physicsFrequency;

  // Run physics steps until caught up
  while (physicsAccumulator >= PHYSICS_DT) {
    // Update sensors (reads from course image)
    lfs.updateSensors();

    // User controller update
    if (lfs.controllerEnabled && userController) {
      try {
        const sensors = controllerAPI.getSensorReadings();
        userController.update(controllerAPI, sensors);

        // Record frame for scoring (only during contest run)
        if (lfs.contestState === "run") {
          scoreCalculator.recordFrame(lfs.robot, sensors, PHYSICS_DT);
        }

        // Visual feedback: color sensors based on reading
        const colors = lineSensor.getColorArray();
        for (let i = 0; i < sensors.length; i++) {
          if (sensors[i] < 0.5) {
            colors[i] = [255, 0, 0]; // Line detected
          } else if (sensors[i] < 0.7) {
            colors[i] = [255, 255, 0]; // Gray area
          } else {
            colors[i] = [0, 255, 0]; // Background
          }
        }
      } catch (error) {
        showRuntimeError(error);
      }
    }

    // Physics update with explicit timestep
    lfs.driveUpdate(lfs.controllerEnabled, PHYSICS_DT);

    // Collect chart data at physics rate
    if (lfs.controllerEnabled && lfs.contestState === "run") {
      const currentTime = drawStartTime - physicsAccumulator; // Current time in seconds

      chartBuffers.speed.push(lfs.robot.speed);
      chartBuffers.times.push(currentTime);

      chartBuffers.turnRate.push(lfs.robot.turnRate);

      // Calculate error for chart
      const sensors = controllerAPI.getSensorReadings();
      const error = scoreCalculator.calculateCentroidError(sensors);
      chartBuffers.error.push(error + sensors.length/2);
    }

    physicsAccumulator -= PHYSICS_DT;
  }

  // Rendering (always runs at display refresh rate)
  lfs.drawRobotView();
  lfs.drawCourseView();
  lfs.drawSensors();

  // Draw viewport borders
  noFill();
  stroke(0, 255, 0);
  strokeWeight(2);
  rect(lfs.robotVP.x, lfs.robotVP.y, lfs.robotVP.w, lfs.robotVP.h);
  rect(lfs.courseVP.x, lfs.courseVP.y, lfs.courseVP.w, lfs.courseVP.h);

  // Draw live charts (rendered at UI rate, data collected at physics rate)
  drawCharts();

  // Update UI
  updateUI();
};

/**
 * Reset controller state - reinitialize user controller
 */
function resetController() {
  if (userController && typeof userController.init === "function") {
    try {
      userController.init(controllerAPI);
    } catch (error) {
      console.error("Error in controller init:", error);
    }
  }
}

/**
 * Draw mini line charts for real-time data visualization
 */
function drawCharts() {
  drawLineChart(chartCanvases.speed, chartBuffers.speed, chartBuffers.times, 0, lfs.maxSpeed, '#00ff00', 'Speed');
  drawLineChart(chartCanvases.error, chartBuffers.error, chartBuffers.times, 0, (lineSensor.sensorCells+1)/2, '#ff0000', 'Error');
  drawLineChart(chartCanvases.turnRate, chartBuffers.turnRate, chartBuffers.times, -lfs.maxTurnRate, lfs.maxTurnRate, '#00ccff', 'Turn Rate');
}

/**
 * Draw a single line chart on a canvas
 * @param {CanvasRenderingContext2D} ctx - Canvas 2D context
 * @param {CircularBuffer} dataBuffer - Data values buffer
 * @param {CircularBuffer} timeBuffer - Timestamp buffer
 * @param {number} minY - Minimum Y value
 * @param {number} maxY - Maximum Y value
 * @param {string} color - Line color
 * @param {string} label - Chart label
 */
function drawLineChart(ctx, dataBuffer, timeBuffer, minY, maxY, color, label) {
  const canvas = ctx.canvas;
  const width = canvas.width;
  const height = canvas.height;

  // Clear canvas
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, width, height);

  const allData = dataBuffer.toArray();
  const allTimes = timeBuffer.toArray();

  if (allData.length < 2 || allTimes.length < 2) return;

  // Find cutoff time (current time - time window)
  const currentTime = allTimes[allTimes.length - 1];
  const cutoffTime = currentTime - CHART_TIME_WINDOW;

  // Find first index where timestamp >= cutoffTime
  let startIdx = 0;
  for (let i = 0; i < allTimes.length; i++) {
    if (allTimes[i] >= cutoffTime) {
      startIdx = i;
      break;
    }
  }

  // Slice data and times from startIdx
  const data = allData.slice(startIdx);
  const times = allTimes.slice(startIdx);

  if (data.length < 2) return;

  // Draw grid lines
  ctx.strokeStyle = '#2a2a2a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();

  // Draw data line
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();

  const xStep = width / (times[times.length-1] - times[0]);
  const range = maxY - minY;

  for (let i = 0; i < data.length; i++) {
    const x = (times[i] - times[0]) * xStep;
    const normalizedY = (data[i] - minY) / range;
    const y = height - (normalizedY * height);

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }

  ctx.stroke();

  // Draw current value
  if (data.length > 0) {
    const currentValue = data[data.length - 1];
    ctx.fillStyle = color;
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(currentValue.toFixed(1), width - 2, 10);
  }
}

window.keyPressed = function() {
  // Check if Monaco editor is focused - if so, don't handle shortcuts
  if (monacoEditor && monacoEditor.hasTextFocus()) {
    return true; // Let Monaco handle it
  }

  // Space bar to stop (only when canvas focused)
  if (key === " ") {
    lfs.contestStop();
    return false; // Prevent default
  }

  // R to run
  if (key === "r" || key === "R") {
    runCode();
    return false;
  }

  // E to clear crumbs
  if (key === "e" || key === "E") {
    lfs.clearCrumbs();
    return false;
  }
};

function canvasClicked() {
  // Check if mouse is in course viewport
  if (
    mouseX >= lfs.courseVP.x &&
    mouseX <= lfs.courseVP.x + lfs.courseVP.w &&
    mouseY >= lfs.courseVP.y &&
    mouseY <= lfs.courseVP.y + lfs.courseVP.h &&
    lfs.courseImage &&
    lfs.contestState === "idle"
  ) {
    let scaleX = lfs.courseVP.w / lfs.courseImage.width;
    let scaleY = lfs.courseVP.h / lfs.courseImage.height;
    let _scale = Math.min(scaleX, scaleY);

    let wx = (mouseX - lfs.courseVP.x) / (lfs.courseDPI * _scale);
    let wy = (mouseY - lfs.courseVP.y) / (lfs.courseDPI * _scale);

    lfs.robot.x = wx;
    lfs.robot.y = wy;
    lfs.robot.xi = wx;
    lfs.robot.yi = wy;
    lfs.robot.hardStop();
    console.log(lfs);
  }
}

// ============================================
// UI CONTROL FUNCTIONS
// ============================================
window.loadMapFromURL = function(url) {
  if (!url) return;

  loadImage(
    url,
    (img) => {
      lfs.loadCourse(img);
      currentMapUrl = url;
    },
    (err) => {
      showStatus("✗ Failed to load map", "error");
      console.error(err);
    },
  );
};

window.loadSelectedMap = function() {
  const mapId = document.getElementById("map-selector").value;
  if (mapId && mapManager) {
    mapManager.loadMap(mapId, lfs, scoreCalculator, setRobotPosition, showStatus);
  }
};

window.loadSelectedExample = function() {
  const exampleId = document.getElementById("example-selector").value;
  if (exampleId && monacoEditor && EXAMPLES[exampleId]) {
    const example = EXAMPLES[exampleId];
    monacoEditor.setValue(example.code);
    showStatus("✓ Loaded: " + example.name, "success");

    // Reset selector
    document.getElementById("example-selector").value = "";
  }
};

function populateExampleSelector() {
  const selector = document.getElementById("example-selector");
  selector.innerHTML = '<option value="">Load Example...</option>';

  for (let id in EXAMPLES) {
    const example = EXAMPLES[id];
    const option = document.createElement("option");
    option.value = id;
    option.textContent = example.name;
    option.title = example.description;
    selector.appendChild(option);
  }
}

function setRobotPosition(x, y, heading) {
  lfs.robot.x = x;
  lfs.robot.y = y;
  lfs.robot.heading = heading;
  lfs.robot.xi = x;
  lfs.robot.yi = y;
  lfs.robot.headingi = heading;
  lfs.robot.hardStop();
}

function resetRobot() {
  lfs.robot.reset();
  lfs.clearCrumbs();
  lfs.contestEnd();
  resetController();
  scoreCalculator.reset()
}

window.togglePanel = function() {
  const panel = document.getElementById("controls-panel");
  const toggle = document.getElementById("panel-toggle");
  panel.classList.toggle("collapsed");
  toggle.textContent = panel.classList.contains("collapsed") ? "+" : "−";
};

window.saveProject = function() {
  const name = document.getElementById("project-name").value;
  if (projectManager.saveProject(name, monacoEditor, mapManager, lfs, showStatus)) {
    document.getElementById("project-name").value = "";
    localStorage.setItem("lfs-last-project", name);
  }
};

window.loadSelectedProject = function() {
  const select = document.getElementById("project-list");
  const name = select.value;
  if (name) {
    projectManager.loadProject(name, monacoEditor, mapManager, setRobotPosition, showStatus);
    localStorage.setItem("lfs-last-project", name);
    select.value = "";
  }
};

window.deleteCurrentProject = function() {
  const select = document.getElementById("project-list");
  const name = select.value || projectManager.currentProject;
  if (name) {
    projectManager.deleteProject(name, showStatus);
    select.value = "";
  }
};

function setupResizer() {
  const resizer = document.getElementById("resizer");
  const editorPanel = document.getElementById("editor-panel");
  const canvasPanel = document.getElementById("canvas-panel");

  let isResizing = false;

  resizer.addEventListener("mousedown", (e) => {
    isResizing = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });

  document.addEventListener("mousemove", (e) => {
    if (!isResizing) return;

    const totalWidth = editorPanel.offsetWidth + canvasPanel.offsetWidth;
    const newEditorWidth = e.clientX;

    if (newEditorWidth > 300 && newEditorWidth < totalWidth - 400) {
      const editorFlex = newEditorWidth;
      const canvasFlex = totalWidth - newEditorWidth;

      editorPanel.style.flex = `0 0 ${editorFlex}px`;
      canvasPanel.style.flex = `0 0 ${canvasFlex}px`;
    }
  });

  document.addEventListener("mouseup", () => {
    isResizing = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });
}

function updateUI() {
  if (!lfs) return;

  // Format time
  let totalMs = Math.floor(lfs.contestTime * 1000);
  let ms = totalMs % 1000;
  let totalSec = Math.floor(totalMs / 1000);
  let sec = totalSec % 60;
  let min = Math.floor(totalSec / 60);

  const timeEl = document.getElementById("time");
  if (timeEl) {
    timeEl.textContent =
      String(min).padStart(2, "0") +
      ":" +
      String(sec).padStart(2, "0") +
      "." +
      String(ms).padStart(3, "0");
  }

  const distEl = document.getElementById("distance");
  if (distEl) {
    distEl.textContent = lfs.robot.distanceTraveled.toFixed(1) + '"';
  }

  const fpsEl = document.getElementById("fps");
  if (fpsEl) {
    fpsEl.textContent = Math.round(frameRate()) + " FPS";
  }

  // Update scores
  if (scoreCalculator) {
    const scores = scoreCalculator.getDetailedScores();

    const totalEl = document.getElementById("score-total");
    if (totalEl) totalEl.textContent = scores.total.toFixed(1);

    const accuracyEl = document.getElementById("score-accuracy");
    if (accuracyEl) accuracyEl.textContent = scores.accuracy.toFixed(1);

    const efficiencyEl = document.getElementById("score-efficiency");
    if (efficiencyEl)
      efficiencyEl.textContent = scores.efficiency.toFixed(1);

    const completionEl = document.getElementById("score-completion");
    if (completionEl)
      completionEl.textContent = scores.completion.toFixed(1) + "%";
  }
}

// Export functions for modal handlers
window.openCustomMapModal = function() {
  const modal = document.getElementById("custom-map-modal");
  modal.classList.add("show");
};

window.closeCustomMapModal = function() {
  const modal = document.getElementById("custom-map-modal");
  modal.classList.remove("show");
};

window.saveCustomMap = function() {
  // Custom map functionality - to be implemented if needed
  alert("Custom map feature coming soon!");
  window.closeCustomMapModal();
};

// Physics frequency control
window.setPhysicsFrequency = function(hz) {
  physicsFrequency = parseInt(hz);
  const display = document.getElementById('physics-hz-display');
  if (display) {
    display.textContent = hz + ' Hz';
  }
};

window.runCode = runCode;
window.contestStop = () => lfs.contestStop()
window.shareToURL = shareToURL;
window.resetRobot = resetRobot;
