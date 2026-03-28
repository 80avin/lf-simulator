// ============================================
// MAP CONFIGURATION
// ============================================
export const MAPS = {
  novice: {
    id: "novice",
    name: "Novice Course",
    url: "https://raw.githubusercontent.com/ron-grant/LFS/refs/heads/master/distribution/lineFollowerSim-15/examples/MecanumDemo/data/Novice_LF_course-Fall_2018_64DPI.jpg",
    difficulty: "Easy",
    startPosition: [27, 12, 0], // [x, y, heading]
    courseLength: 305, // inches (approximate)
    description:
      "Simple oval track with gentle curves. Perfect for testing basic algorithms.",
  },
  // More maps can be added here
};

// ============================================
// SCORE CALCULATOR CLASS (WITH FIXES)
// ============================================
export class ScoreCalculator {
  constructor() {
    this.metrics = {
      time: 0,
      accuracy: 0,
      efficiency: 0,
      completion: 0,
    };

    this.errorHistory = [];
    this.speedHistory = [];
    this.outOfBoundsFrames = 0;  // NEW: track OOB penalty
    this.startTime = 0;
    this.courseLength = 200; // Default course length in inches

    // NEW: Track furthest progress
    this.maxDistanceFromStart = 0;
    this.startPosition = { x: 0, y: 0 };
  }

  reset() {
    this.metrics = { time: 0, accuracy: 0, efficiency: 0, completion: 0 };
    this.errorHistory = [];
    this.speedHistory = [];
    this.outOfBoundsFrames = 0;
    this.startTime = Date.now();
    this.maxDistanceFromStart = 0;
  }

  setStartPosition(x, y) {
    this.startPosition = { x, y };
  }

  recordFrame(robot, sensors, dt) {
    // Calculate centroid error
    const error = this.calculateCentroidError(sensors);
    this.errorHistory.push(error);

    // Track speed
    this.speedHistory.push(robot.speed);

    // NEW: Track out-of-bounds frames
    if (robot.outOfBoundsTime > 0) {
      this.outOfBoundsFrames++;
    }

    // Update metrics
    this.updateMetrics(robot, error, dt);
  }

  calculateCentroidError(sensors) {
    let lineSum = 0;
    let positionSum = 0;
    const n = sensors.length;

    for (let i = 0; i < n; i++) {
      const lineValue = 1.0 - sensors[i]; // Invert: 0=white, 1=black
      lineSum += lineValue;
      positionSum += lineValue * (i - (n - 1) / 2);
    }

    // FIX: Return MAX error when line not detected (not 0!)
    if (lineSum <= 0.1) {
      return n / 2;  // Maximum possible error
    }

    return Math.abs(positionSum / lineSum);
  }

  updateMetrics(robot, error, dt) {
    const elapsedTime = (Date.now() - this.startTime) / 1000; // seconds

    this.metrics.time = elapsedTime;

    // FIX: Linear accuracy calculation (not exponential)
    if (this.errorHistory.length > 0) {
      const meanError =
        this.errorHistory.reduce((a, b) => a + b, 0) /
        this.errorHistory.length;

      const maxError = 4.5; // Max error for 9 sensors
      this.metrics.accuracy = 100 * (1 - Math.min(meanError / maxError, 1));

      // NEW: Apply out-of-bounds penalty
      const oobPenalty = (this.outOfBoundsFrames / this.errorHistory.length) * 50;
      this.metrics.accuracy = Math.max(0, this.metrics.accuracy - oobPenalty);
    }

    // Efficiency: speed consistency (lower variance = higher score)
    if (this.speedHistory.length > 10) {
      const speedVariance = this.calculateVariance(this.speedHistory);
      this.metrics.efficiency = 100 / (1 + speedVariance / 10);
    }

    // FIX: Completion based on max distance from start
    const currentDistance = Math.sqrt(
      Math.pow(robot.x - this.startPosition.x, 2) +
      Math.pow(robot.y - this.startPosition.y, 2)
    );

    this.maxDistanceFromStart = Math.max(this.maxDistanceFromStart, currentDistance);

    this.metrics.completion = Math.min(
      100,
      (this.maxDistanceFromStart / this.courseLength) * 100
    );
  }

  calculateVariance(arr) {
    if (arr.length === 0) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const squaredDiffs = arr.map((x) => Math.pow(x - mean, 2));
    return squaredDiffs.reduce((a, b) => a + b, 0) / arr.length;
  }

  getTotalScore() {
    // Weighted average: accuracy matters most
    return (
      25/(this.metrics.time/10+1) +
      this.metrics.accuracy * 0.4 +
      this.metrics.efficiency * 0.2 +
      this.metrics.completion * 0.15
    );
  }

  getDetailedScores() {
    const meanError =
      this.errorHistory.length > 0
        ? this.errorHistory.reduce((a, b) => a + b, 0) /
          this.errorHistory.length
        : 0;

    return {
      total: this.getTotalScore(),
      ...this.metrics,
      meanError: meanError,
    };
  }
}

// ============================================
// MAP MANAGER CLASS
// ============================================
export class MapManager {
  constructor() {
    this.maps = MAPS;
    this.currentMap = null;
  }

  getMap(mapId) {
    return this.maps[mapId];
  }

  async loadMap(mapId, lfs, scoreCalculator, setRobotPosition, showStatus) {
    const map = this.maps[mapId];
    if (!map) {
      showStatus("✗ Map not found: " + mapId, "error");
      return false;
    }

    return new Promise((resolve, reject) => {
      loadImage(
        map.url,
        (img) => {
          lfs.loadCourse(img);
          this.currentMap = mapId;

          // Set robot position
          setRobotPosition(...map.startPosition);

          // Update course length for scoring
          if (scoreCalculator) {
            scoreCalculator.courseLength = map.courseLength;
          }

          showStatus("✓ Loaded: " + map.name, "success");
          resolve(true);
        },
        (err) => {
          showStatus("✗ Failed to load map: " + map.name, "error");
          console.error(err);
          reject(err);
        },
      );
    });
  }

  populateMapSelector() {
    const selector = document.getElementById("map-selector");
    selector.innerHTML = "";

    for (let id in this.maps) {
      const map = this.maps[id];
      const option = document.createElement("option");
      option.value = id;
      option.textContent = `${map.name} (${map.difficulty})`;
      option.title = map.description;
      selector.appendChild(option);
    }
  }
}

// ============================================
// PROJECT MANAGER CLASS
// ============================================
export class ProjectManager {
  constructor() {
    this.storageKey = "lfs-projects";
    this.currentProject = null;
  }

  saveProject(name, monacoEditor, mapManager, lfs, showStatus) {
    if (!name || name.trim() === "") {
      alert("Please enter a project name");
      return false;
    }

    const projects = this.loadProjects();
    const project = {
      name: name,
      code: monacoEditor.getValue(),
      config: {
        mapId: mapManager.currentMap || "novice",
        robotPos: [lfs.robot.x, lfs.robot.y, lfs.robot.heading],
      },
      timestamp: Date.now(),
    };

    projects[name] = project;
    localStorage.setItem(this.storageKey, JSON.stringify(projects));
    this.currentProject = name;

    showStatus("✓ Project saved: " + name, "success");
    return true;
  }

  loadProject(name, monacoEditor, mapManager, lfs, scoreCalculator, setRobotPosition, showStatus) {
    const projects = this.loadProjects();
    const project = projects[name];

    if (project) {
      monacoEditor.setValue(project.code);

      // Load map with all required parameters
      if (project.config.mapId) {
        mapManager.loadMap(project.config.mapId, lfs, scoreCalculator, setRobotPosition, showStatus);
      } else {
        // If no map config, just set robot position
        setRobotPosition(...project.config.robotPos);
      }

      this.currentProject = name;
      showStatus("✓ Project loaded: " + name, "success");
      return true;
    }
    return false;
  }

  deleteProject(name, showStatus) {
    if (!name) return false;

    if (confirm('Delete project "' + name + '"?')) {
      const projects = this.loadProjects();
      delete projects[name];
      localStorage.setItem(this.storageKey, JSON.stringify(projects));

      if (this.currentProject === name) {
        this.currentProject = null;
      }

      showStatus("✓ Project deleted: " + name, "success");
      return true;
    }
    return false;
  }

  loadProjects() {
    const stored = localStorage.getItem(this.storageKey);
    return stored ? JSON.parse(stored) : {};
  }

  updateProjectListModal() {
    const projects = this.loadProjects();
    const select = document.getElementById("project-list-modal");
    if (!select) return;

    select.innerHTML = "";

    const projectNames = Object.keys(projects).sort();

    if (projectNames.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No saved projects";
      option.disabled = true;
      select.appendChild(option);
    } else {
      projectNames.forEach((name) => {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        select.appendChild(option);
      });
    }
  }
}
