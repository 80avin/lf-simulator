// ============================================
// JSDOC TYPE DEFINITIONS FOR AUTOCOMPLETE
// ============================================
export const TYPE_DEFINITIONS = `
/**
 * Controller API - Interface for controlling the robot
 * @typedef {Object} ControllerAPI
 * @property {function(): number[]} getSensorReadings - Get array of sensor values (0.0=black, 1.0=white)
 * @property {function(number): void} setSpeed - Set target speed in inches/second
 * @property {function(number): void} setTurnRate - Set target turn rate in degrees/second
 * @property {function(): RobotState} getState - Get current robot state
 * @property {function(): number} getTime - Get current contest time in seconds
 * @property {function(): number} getPhysicsHz - Get current physics frequency in Hz
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
 * NOTE: Physics frequency is variable (10-1000 Hz). Do NOT hardcode dt = 0.01667!
 * Use api.getTime() for timing instead of counting frames.
 * Competitive robots often run at 500Hz or higher.
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
    }

    /**
     * Update function - called every physics step (NOT every frame!)
     * Physics frequency is user-configurable (10-120 Hz)
     * @param {ControllerAPI} api - The controller API
     * @param {number[]} sensors - Sensor readings array
     */
    update(api, sensors) {
        // Your control logic here
        // Example: api.setSpeed(20); api.setTurnRate(0);
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

  bangbang: {
    name: "Bang-Bang Controller",
    description: "On/off control - fast but oscillates",
    code: `/**
 * Bang-Bang (On-Off) Line Follower
 *
 * Simple binary control: turn hard left or hard right.
 * Fast but causes oscillation. Good for sharp turns!
 */
class Controller {
    init(api) {
        this.turnRate = 200;  // Turn rate in degrees/second
        this.threshold = 0.5; // Error threshold for switching
        this.baseSpeed = 16;
    }

    update(api, sensors) {
        const error = this.calculateError(sensors);

        // Bang-bang: full turn left or right based on threshold
        let turn = 0;
        if (error > this.threshold) {
            turn = this.turnRate;  // Turn right
        } else if (error < -this.threshold) {
            turn = -this.turnRate;  // Turn left
        }

        // Slow down when turning
        const speed = Math.abs(turn) > 0 ? this.baseSpeed * 0.7 : this.baseSpeed;

        api.setSpeed(speed);
        api.setTurnRate(turn);
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

  statemachine: {
    name: "State Machine Controller",
    description: "Handles different scenarios - intersections, lost line",
    code: `/**
 * State Machine Line Follower
 *
 * Uses different behaviors for different situations:
 * - FOLLOWING: normal line following
 * - LOST: line not detected, search for it
 * - SHARP_TURN: detected sharp turn
 */
class Controller {
    init(api) {
        this.state = 'FOLLOWING';
        this.Kp = 120;
        this.lostTimer = 0;
        this.lastError = 0;
    }

    update(api, sensors) {
        const error = this.calculateError(sensors);
        const lineDetected = this.isLineDetected(sensors);

        // State machine logic
        switch(this.state) {
            case 'FOLLOWING':
                if (!lineDetected) {
                    this.state = 'LOST';
                    this.lostTimer = 0;
                } else if (Math.abs(error) > 3) {
                    this.state = 'SHARP_TURN';
                } else {
                    this.followLine(api, error);
                }
                break;

            case 'LOST':
                this.lostTimer++;
                // Try to recover by turning in direction of last error
                api.setSpeed(8);
                api.setTurnRate(this.lastError > 0 ? 150 : -150);

                if (lineDetected) {
                    this.state = 'FOLLOWING';
                } else if (this.lostTimer > 60) {
                    // Give up after 1 second
                    api.setSpeed(0);
                }
                break;

            case 'SHARP_TURN':
                // Slow down for sharp turns
                api.setSpeed(10);
                api.setTurnRate(this.Kp * error * 1.5);

                if (Math.abs(error) < 2) {
                    this.state = 'FOLLOWING';
                }
                break;
        }

        this.lastError = error;
    }

    followLine(api, error) {
        const baseSpeed = 20;
        const speed = baseSpeed * (1 - Math.abs(error) * 0.2);

        api.setSpeed(speed);
        api.setTurnRate(this.Kp * error);
    }

    isLineDetected(sensors) {
        let lineSum = 0;
        for (let i = 0; i < sensors.length; i++) {
            lineSum += (1.0 - sensors[i]);
        }
        return lineSum > 0.5;
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

        return lineSum > 0.1 ? positionSum / lineSum : this.lastError;
    }
}`,
  },

  fuzzy: {
    name: "Fuzzy Logic Controller",
    description: "Advanced: uses fuzzy rules for smooth control",
    code: `/**
 * Fuzzy Logic Line Follower
 *
 * Uses fuzzy logic to map error to turn rate.
 * Linguistic variables: NegativeBig, NegativeSmall, Zero, PositiveSmall, PositiveBig
 * Smooth transitions between states.
 */
class Controller {
    init(api) {
        this.baseSpeed = 18;
    }

    update(api, sensors) {
        const error = this.calculateError(sensors);

        // Fuzzification: calculate membership for each fuzzy set
        const fuzzyError = this.fuzzify(error);

        // Fuzzy inference: apply rules
        const fuzzyTurn = this.inference(fuzzyError);

        // Defuzzification: convert fuzzy output to crisp value
        const turnRate = this.defuzzify(fuzzyTurn);

        // Adaptive speed based on error magnitude
        const speed = this.baseSpeed * (1 - Math.abs(error) * 0.25);

        api.setSpeed(speed);
        api.setTurnRate(turnRate);
    }

    fuzzify(error) {
        // Map error to fuzzy sets using triangular membership functions
        return {
            NB: this.triangleMF(error, -6, -4, -2),  // Negative Big
            NS: this.triangleMF(error, -3, -1.5, 0),  // Negative Small
            Z:  this.triangleMF(error, -1, 0, 1),     // Zero
            PS: this.triangleMF(error, 0, 1.5, 3),    // Positive Small
            PB: this.triangleMF(error, 2, 4, 6)       // Positive Big
        };
    }

    triangleMF(x, a, b, c) {
        // Triangular membership function
        if (x <= a || x >= c) return 0;
        if (x === b) return 1;
        if (x < b) return (x - a) / (b - a);
        return (c - x) / (c - b);
    }

    inference(fuzzyError) {
        // Fuzzy rules:
        // IF error is NB THEN turn is NB (turn hard left)
        // IF error is NS THEN turn is NS (turn soft left)
        // IF error is Z THEN turn is Z (go straight)
        // IF error is PS THEN turn is PS (turn soft right)
        // IF error is PB THEN turn is PB (turn hard right)

        return {
            NB: fuzzyError.NB,
            NS: fuzzyError.NS,
            Z:  fuzzyError.Z,
            PS: fuzzyError.PS,
            PB: fuzzyError.PB
        };
    }

    defuzzify(fuzzyTurn) {
        // Center of gravity defuzzification
        // Map fuzzy sets to turn rates
        const turnRates = {
            NB: -250,  // Hard left
            NS: -100,  // Soft left
            Z:  0,     // Straight
            PS: 100,   // Soft right
            PB: 250    // Hard right
        };

        let numerator = 0;
        let denominator = 0;

        for (let key in fuzzyTurn) {
            numerator += fuzzyTurn[key] * turnRates[key];
            denominator += fuzzyTurn[key];
        }

        return denominator > 0 ? numerator / denominator : 0;
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
};

// Set default controller
export const DEFAULT_CONTROLLER = EXAMPLES["pid"].code;
