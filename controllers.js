// ============================================
// JSDOC TYPE DEFINITIONS FOR AUTOCOMPLETE
// ============================================
export const TYPE_DEFINITIONS = `
/**
 * Controller API - Interface for controlling the robot
 * @typedef {Object} ControllerAPI
 *
 * BASIC METHODS:
 * @property {function(): number[]} getSensorReadings - Get array of sensor values (0.0=black, 1.0=white)
 * @property {function(number): void} setSpeed - Set target speed in inches/second
 * @property {function(number): void} setTurnRate - Set target turn rate in degrees/second
 * @property {function(): RobotState} getState - Get current robot state
 * @property {function(): number} getTime - Get current contest time in seconds
 * @property {function(): number} getPhysicsHz - Get current physics frequency in Hz
 *
 * ADVANCED METHODS (research-informed):
 * @property {function(): number} getLineError - Calculate line position error (-N/2 to +N/2 for N sensors)
 * @property {function(): string} getCurveEstimate - Detect curve type: 'straight', 'gentle', or 'sharp'
 * @property {function(): number} getErrorDerivative - Get rate of change of error (for D term in PID)
 * @property {function(number, number): void} setSpeedProfile - Set speed with automatic curve slowdown
 */

/**
 * Robot state information
 * @typedef {Object} RobotState
 * @property {number} x - Position X (inches)
 * @property {number} y - Position Y (inches)
 * @property {number} heading - Heading (degrees, 0-360)
 * @property {number} speed - Current speed (inches/second)
 * @property {number} turnRate - Current turn rate (degrees/second)
 * @property {number} distanceTraveled - Total distance traveled (inches)
 */

/**
 * User controller class - Implement this!
 *
 * NOTES:
 * - Physics frequency is variable (10-1000 Hz). Do NOT hardcode dt!
 * - Use api.getTime() for timing instead of counting frames
 * - Use api.getLineError() instead of manually calculating from sensors
 * - Use api.getCurveEstimate() for adaptive speed control
 * - Competitive robots often run at 500Hz or higher
 *
 * @class Controller
 */
class Controller {
    /**
     * Initialize your controller
     * Called once when the controller is loaded
     * @param {ControllerAPI} api - The controller API
     */
    init(api) {
        // Initialize your variables here
        // Example: this.Kp = 100; this.Kd = 50;
    }

    /**
     * Update function - called every physics step
     * @param {ControllerAPI} api - The controller API
     * @param {number[]} sensors - Sensor readings (use api.getLineError() for convenience)
     */
    update(api, sensors) {
        // Your control logic here
        // Example:
        // const error = api.getLineError();
        // api.setSpeed(20);
        // api.setTurnRate(this.Kp * error);
    }
}
`;

// ============================================
// CONTROLLER API CLASS
// ============================================
export class ControllerAPI {
  constructor(lfs, lineSensor, getPhysicsHz) {
    this.lfs = lfs;
    this.lineSensor = lineSensor;
    this.getPhysicsHzFn = getPhysicsHz; // Function to get current physics frequency

    // History tracking for advanced features
    this.lastError = 0;
    this.errorHistory = [];
    this.maxHistoryLength = 10;
  }

  getSensorReadings() {
    return this.lineSensor.readArray();
  }

  setSpeed(inchesPerSec) {
    this.lfs.robot.setTargetSpeed(inchesPerSec);
  }

  setTurnRate(degreesPerSec) {
    this.lfs.robot.setTargetTurnRate(degreesPerSec);
  }

  getState() {
    return {
      x: this.lfs.robot.x,
      y: this.lfs.robot.y,
      heading: this.lfs.robot.heading,
      speed: this.lfs.robot.speed,
      turnRate: this.lfs.robot.turnRate,
      distanceTraveled: this.lfs.robot.distanceTraveled,
    };
  }

  getTime() {
    return this.lfs.contestTime;
  }

  getPhysicsHz() {
    return this.getPhysicsHzFn();
  }

  /**
   * Calculate line position error using centroid method
   * Returns error value where 0 = centered, negative = left, positive = right
   * Range: approximately -N/2 to +N/2 where N is number of sensors
   * @returns {number} Line position error
   */
  getLineError() {
    const sensors = this.getSensorReadings();
    const n = sensors.length;
    let lineSum = 0;
    let positionSum = 0;

    for (let i = 0; i < n; i++) {
      const lineValue = 1.0 - sensors[i]; // Invert: 0=white, 1=black line
      lineSum += lineValue;
      positionSum += lineValue * (i - (n - 1) / 2);
    }

    // Calculate error (0 when centered)
    const error = lineSum > 0.1 ? positionSum / lineSum : this.lastError;

    // Track error history for derivative calculation
    this.errorHistory.push(error);
    if (this.errorHistory.length > this.maxHistoryLength) {
      this.errorHistory.shift();
    }
    this.lastError = error;

    return error;
  }

  /**
   * Estimate curve sharpness from sensor activation pattern
   * Useful for adaptive speed control
   * @returns {string} 'straight' | 'gentle' | 'sharp'
   */
  getCurveEstimate() {
    const sensors = this.getSensorReadings();
    const n = sensors.length;

    // Count how many sensors detect the line (< 0.5 = line detected)
    let activeSensors = 0;
    for (let i = 0; i < n; i++) {
      if (sensors[i] < 0.5) activeSensors++;
    }

    // More activated sensors typically means tighter curve or wider line
    if (activeSensors <= 2) {
      return "straight"; // Narrow line detection = straight section
    } else if (activeSensors <= 4) {
      return "gentle"; // Medium activation = gentle curve
    } else {
      return "sharp"; // Many sensors = sharp curve or intersection
    }
  }

  /**
   * Get rate of change of line error (useful for PD/PID control)
   * @returns {number} Error derivative (change per second)
   */
  getErrorDerivative() {
    if (this.errorHistory.length < 2) return 0;

    const dt = 1 / this.getPhysicsHz();
    const currentError = this.errorHistory[this.errorHistory.length - 1];
    const previousError = this.errorHistory[this.errorHistory.length - 2];

    return (currentError - previousError) / dt;
  }

  /**
   * Simplified speed control with automatic slowdown on curves
   * @param {number} baseSpeed - Maximum speed on straights (inches/sec)
   * @param {number} turnSlowdownFactor - Speed multiplier on gentle curves (0-1, default 0.7)
   */
  setSpeedProfile(baseSpeed, turnSlowdownFactor = 0.7) {
    const curve = this.getCurveEstimate();
    let targetSpeed = baseSpeed;

    if (curve === "gentle") {
      targetSpeed = baseSpeed * turnSlowdownFactor;
    } else if (curve === "sharp") {
      targetSpeed = baseSpeed * (turnSlowdownFactor * 0.7);
    }

    this.setSpeed(targetSpeed);
  }
}

// ============================================
// EXAMPLE CONTROLLERS
// ============================================
export const EXAMPLES = {
  pid: {
    name: "PID Controller",
    description: "Full PID with tunable gains - best accuracy",
    code: `/**
 * Simple PID Line Follower Controller
 *
 * This example demonstrates a basic PID controller for line following.
 * The robot uses a weighted average of sensor readings to determine
 * the line position, then applies PID control to follow it.
 */
class Controller {
    init(api) {
        // PID gains - tune these for your course!
        this.Kp = 150;  // Proportional: responds to current error
        this.Ki = 0.5;  // Integral: eliminates steady-state error
        this.Kd = 50;   // Derivative: dampens oscillations

        // PID state
        this.lastError = 0;
        this.integral = 0;

        // Speed settings
        this.baseSpeed = 15;  // Base speed in inches/second
    }

    update(api, sensors) {
        // Calculate error (line position relative to center)
        const error = this.calculateError(sensors);

        // PID calculation
        const dt = 0.01667;  // 60 FPS
        this.integral += error * dt;
        this.integral = Math.max(-10, Math.min(10, this.integral));  // Anti-windup

        const derivative = (error - this.lastError) / dt;
        const correction = this.Kp * error + this.Ki * this.integral + this.Kd * derivative;

        this.lastError = error;

        // Adaptive speed: slow down for sharp turns
        const speed = this.baseSpeed * (1 - Math.abs(error) * 0.3);

        // Apply control
        api.setSpeed(speed);
        api.setTurnRate(correction);
    }

    /**
     * Calculate line position error using weighted average
     * Returns: position relative to center (-4 to +4 for 9 sensors)
     */
    calculateError(sensors) {
        const n = sensors.length;
        let lineSum = 0;
        let positionSum = 0;

        for (let i = 0; i < n; i++) {
            const lineValue = 1.0 - sensors[i];  // Invert: 0=white, 1=black
            lineSum += lineValue;
            positionSum += lineValue * (i - (n-1)/2);  // Weight by position
        }

        // Return error, or default to edge if line not detected
        return lineSum > 0.1 ? positionSum / lineSum : n/4;
    }
}`,
  },

  proportional: {
    name: "Proportional Controller",
    description: "Simple P-only control - easy to understand",
    code: `/**
 * Proportional-Only Line Follower
 *
 * Simplest controller: correction proportional to error.
 * Great for learning - only one parameter to tune!
 */
class Controller {
    init(api) {
        this.Kp = 100;  // Proportional gain - tune this!
        this.baseSpeed = 18;
    }

    update(api, sensors) {
        const error = this.calculateError(sensors);

        // P control: turn correction = gain × error
        api.setSpeed(this.baseSpeed);
        api.setTurnRate(this.Kp * error);
    }

    calculateError(sensors) {
        const n = sensors.length;
        let lineSum = 0;
        let positionSum = 0;

        for (let i = 0; i < n; i++) {
            const lineValue = 1.0 - sensors[i];
            lineSum += lineValue;
            positionSum += lineValue * (i - (n-1)/2);
        }

        return lineSum > 0.1 ? positionSum / lineSum : 0;
    }
}`,
  },

  pd_control: {
    name: "PD Controller (No Integral)",
    description: "Research-backed: often more stable than full PID at high speeds",
    code: `/**
 * PD-Only Line Follower Controller
 *
 * Research finding: Competition teams often use PD control without
 * the integral term to avoid instability at high speeds.
 *
 * Advantages over PID:
 * - No integral windup issues
 * - More stable at high speeds
 * - Simpler to tune (only 2 parameters)
 */
class Controller {
    init(api) {
        // PD gains - note NO Ki!
        this.Kp = 120;   // Proportional: responds to current error
        this.Kd = 60;    // Derivative: dampens oscillations

        // Speed settings
        this.baseSpeed = 18;
    }

    update(api, sensors) {
        // Use API helper to get error (no manual calculation needed!)
        const error = api.getLineError();
        const derivative = api.getErrorDerivative();

        // PD calculation (no integral term)
        const correction = this.Kp * error + this.Kd * derivative;

        // Apply control
        api.setSpeed(this.baseSpeed);
        api.setTurnRate(correction);
    }
}`,
  },

  adaptive_speed: {
    name: "Adaptive Speed Controller",
    description: "Automatically slows down on curves, speeds up on straights",
    code: `/**
 * Adaptive Speed Line Follower
 *
 * Research finding: Competition robots adjust speed dynamically
 * based on curve detection for optimal lap times.
 *
 * This controller uses the curve estimation API to automatically
 * slow down on turns and speed up on straight sections.
 */
class Controller {
    init(api) {
        // PD control gains
        this.Kp = 130;
        this.Kd = 55;

        // Speed profile configuration
        this.speeds = {
            straight: 22,    // Fast on straights
            gentle: 16,      // Medium on gentle curves
            sharp: 10        // Slow on sharp turns
        };
    }

    update(api, sensors) {
        // Get error and derivative using API helpers
        const error = api.getLineError();
        const derivative = api.getErrorDerivative();

        // PD control for steering
        const correction = this.Kp * error + this.Kd * derivative;

        // Adaptive speed based on curve detection
        const curveType = api.getCurveEstimate();
        const targetSpeed = this.speeds[curveType] || this.speeds.gentle;

        // Apply control
        api.setSpeed(targetSpeed);
        api.setTurnRate(correction);
    }
}`,
  },
};

// Set default controller
export const DEFAULT_CONTROLLER = EXAMPLES["pid"].code;
