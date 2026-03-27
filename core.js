// ============================================
// ROBOT CLASS
// ============================================
export class Robot {
  constructor(x, y, heading) {
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.xi = x;
    this.yi = y;
    this.headingi = heading;

    this.speed = 0;
    this.sidewaysSpeed = 0;
    this.turnRate = 0;

    this.targetSpeed = 0;
    this.targetSidewaysSpeed = 0;
    this.targetTurnRate = 0;

    this.acclRate = 64.0;
    this.declRate = 64.0;
    this.turnAcc = 720.0;

    this.distanceTraveled = 0;
    this.outOfBoundsTime = 0;  // NEW: track penalty duration
  }

  setTargetSpeed(s) {
    this.targetSpeed = s;
  }

  setTargetTurnRate(r) {
    this.targetTurnRate = r;
  }

  // NEW: Check if robot is outside course boundaries
  isOutOfBounds(courseImage, courseDPI) {
    if (!courseImage) return false;

    const maxX = courseImage.width / courseDPI;
    const maxY = courseImage.height / courseDPI;

    return (
      this.x < 0 || this.x > maxX ||
      this.y < 0 || this.y > maxY
    );
  }

  driveUpdate(dt, courseImage, courseDPI) {
    // Update speed with acceleration/deceleration
    if (this.speed !== this.targetSpeed) {
      if (this.speed < this.targetSpeed) {
        this.speed += this.acclRate * dt;
        if (this.speed > this.targetSpeed) this.speed = this.targetSpeed;
      } else {
        this.speed -= this.declRate * dt;
        if (this.speed < this.targetSpeed) this.speed = this.targetSpeed;
      }
    }

    // Update turn rate with acceleration
    if (this.turnRate !== this.targetTurnRate) {
      if (this.turnRate < this.targetTurnRate) {
        this.turnRate += this.turnAcc * dt;
        if (this.turnRate > this.targetTurnRate)
          this.turnRate = this.targetTurnRate;
      } else {
        this.turnRate -= this.turnAcc * dt;
        if (this.turnRate < this.targetTurnRate)
          this.turnRate = this.targetTurnRate;
      }
    }

    // Calculate movement
    let dist = this.speed * dt;
    this.distanceTraveled += Math.abs(dist);

    // Convert heading to radians and calculate position change
    let headingRad = radians(this.heading);
    let ca = Math.cos(headingRad);
    let sa = Math.sin(headingRad);

    this.x -= ca * dist;
    this.y -= sa * dist;

    // Update heading
    this.heading += this.turnRate * dt;

    // Keep heading in 0-360 range
    if (this.heading >= 360) this.heading -= 360;
    if (this.heading < 0) this.heading += 360;

    // NEW: Track out-of-bounds time
    if (this.isOutOfBounds(courseImage, courseDPI)) {
      this.outOfBoundsTime += dt;
    } else {
      this.outOfBoundsTime = 0;
    }
  }

  reset() {
    this.x = this.xi;
    this.y = this.yi;
    this.heading = this.headingi;
    this.speed = 0;
    this.sidewaysSpeed = 0;
    this.turnRate = 0;
    this.targetSpeed = 0;
    this.targetSidewaysSpeed = 0;
    this.targetTurnRate = 0;
    this.distanceTraveled = 0;
    this.outOfBoundsTime = 0;  // NEW: reset out of bounds time
  }

  hardStop() {
    this.speed = 0;
    this.turnRate = 0;
    this.targetSpeed = 0;
    this.targetTurnRate = 0;
  }
}

// ============================================
// SPOT SENSOR CLASS
// ============================================
export class SpotSensor {
  constructor(xoff, yoff, w, h) {
    this.xoff = xoff;
    this.yoff = yoff;
    this.spotWPix = w;
    this.spotHPix = h;
    this.intensity = 0;
    this.color = [0, 255, 0];
    this.name = "";
  }

  read() {
    return this.intensity;
  }

  setColor(r, g, b) {
    this.color = [r, g, b];
  }

  sampleFromImage(courseImage, robot, courseDPI) {
    if (!courseImage) return 0;

    let headingRad = radians(robot.heading);
    let cosH = Math.cos(headingRad);
    let sinH = Math.sin(headingRad);

    let cx = robot.x * courseDPI;
    let cy = robot.y * courseDPI;

    let sx = this.xoff * cosH - this.yoff * sinH;
    let sy = this.xoff * sinH + this.yoff * cosH;

    let xCenter = cx - sx * courseDPI;
    let yCenter = cy - sy * courseDPI;

    let sum = 0;
    let count = 0;

    for (let h = 0; h < this.spotHPix; h++) {
      for (let w = 0; w < this.spotWPix; w++) {
        let px = Math.floor(xCenter + w - this.spotWPix / 2);
        let py = Math.floor(yCenter + h - this.spotHPix / 2);

        if (
          px >= 0 &&
          px < courseImage.width &&
          py >= 0 &&
          py < courseImage.height
        ) {
          let idx = (py * courseImage.width + px) * 4;
          let gray =
            (courseImage.pixels[idx] +
              courseImage.pixels[idx + 1] +
              courseImage.pixels[idx + 2]) /
            3;
          sum += gray;
          count++;
        }
      }
    }

    // FIX: Return MAX value (1.0 = white) when out of bounds, not 0 (black line)
    this.intensity = count > 0 ? sum / (count * 255.0) : 1.0;
    return this.intensity;
  }
}

// ============================================
// LINE SENSOR CLASS
// ============================================
export class LineSensor extends SpotSensor {
  constructor(xoff, yoff, w, h, numberOfSensors) {
    super(xoff, yoff, w, h);
    this.sensorCells =
      numberOfSensors % 2 === 0 ? numberOfSensors + 1 : numberOfSensors;
    this.sensorTable = new Array(this.sensorCells).fill(0);
    this.colorTable = new Array(this.sensorCells).fill([0, 255, 0]);
    this.arcRadius = 0;
    this.rotationAngle = 0;
  }

  readArray() {
    return this.sensorTable;
  }

  getColorArray() {
    return this.colorTable;
  }

  sampleFromImage(courseImage, robot, courseDPI) {
    if (!courseImage) return;

    let halfWidth =
      ((this.sensorCells / 2.0) * this.spotWPix) / courseDPI;
    let a = radians(this.rotationAngle);
    let sinA = Math.sin(a);
    let cosA = Math.cos(a);

    for (let i = 0; i < this.sensorCells; i++) {
      let u = i / (this.sensorCells - 1);
      let t = Math.PI * u;

      let x = 0,
        y = 0;

      if (this.arcRadius !== 0) {
        y = -(this.arcRadius * Math.cos(t));
        x = this.arcRadius * Math.sin(t);
      } else {
        y = ((0.5 + i) * this.spotHPix) / courseDPI - halfWidth;
      }

      let spotX = this.xoff + x * cosA - y * sinA;
      let spotY = this.yoff + x * sinA + y * cosA;

      let tempSensor = new SpotSensor(
        spotX,
        spotY,
        this.spotWPix,
        this.spotHPix,
      );
      this.sensorTable[i] = tempSensor.sampleFromImage(
        courseImage,
        robot,
        courseDPI,
      );
    }
  }
}

// ============================================
// LFS MAIN CLASS
// ============================================
export class LFS {
  constructor() {
    this.robot = new Robot(100, 100, 0);
    this.courseImage = null;
    this.courseDPI = 64;

    this.spotSensors = [];
    this.lineSensors = [];

    this.controllerEnabled = false;
    this.contestState = "idle"; // idle, run, stop, finished

    this.maxSpeed = 25;
    this.maxTurnRate = 720;

    this.contestTime = 0;
    this.crumbs = [];
    this.crumbThreshold = 0.5;
    this.lastCrumbX = 0;
    this.lastCrumbY = 0;

    // Viewports
    this.robotVP = { x: 40, y: 40, w: 400, h: 400 };
    this.courseVP = { x: 480, y: 40, w: 1200, h: 800 };
    this.sensorVP = { x: 0, y: 0, w: 800, h: 800 };
  }

  createSpotSensor(xoff, yoff, w, h) {
    let sensor = new SpotSensor(xoff, yoff, w, h);
    this.spotSensors.push(sensor);
    return sensor;
  }

  createLineSensor(xoff, yoff, w, h, numberOfSensors) {
    let sensor = new LineSensor(xoff, yoff, w, h, numberOfSensors);
    this.lineSensors.push(sensor);
    return sensor;
  }

  loadCourse(img) {
    this.courseImage = img;
    this.courseImage.loadPixels();
  }

  updateSensors() {
    for (let sensor of this.spotSensors) {
      sensor.sampleFromImage(
        this.courseImage,
        this.robot,
        this.courseDPI,
      );
    }
    for (let sensor of this.lineSensors) {
      sensor.sampleFromImage(
        this.courseImage,
        this.robot,
        this.courseDPI,
      );
    }
  }

  driveUpdate(stepRequested, dt) {
    if (stepRequested || !this.controllerEnabled) {
      // Pass dt and boundary info to robot
      this.robot.driveUpdate(dt, this.courseImage, this.courseDPI);
    }

    if (this.controllerEnabled) {
      this.addCrumb();
    }

    if (
      stepRequested &&
      this.controllerEnabled &&
      this.contestState === "run"
    ) {
      this.contestTime += dt;
    }
  }

  addCrumb() {
    let dx = this.robot.x - this.lastCrumbX;
    let dy = this.robot.y - this.lastCrumbY;
    let dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > this.crumbThreshold) {
      this.crumbs.push({ x: this.robot.x, y: this.robot.y });
      this.lastCrumbX = this.robot.x;
      this.lastCrumbY = this.robot.y;
    }
  }

  clearCrumbs() {
    this.crumbs = [];
  }

  contestStart() {
    this.contestState = "run";
    this.controllerEnabled = true;
    this.clearCrumbs();
    this.contestTime = 0;
    this.robot.distanceTraveled = 0;
  }

  contestStop() {
    this.robot.hardStop();
    this.controllerEnabled = false;
    this.contestState = "stop";
  }

  contestFinish() {
    if (this.contestState === "run") this.contestStop();
    this.contestState = "finished";
  }

  contestEnd() {
    this.contestState = "idle";
  }

  drawRobotView() {
    if (!this.courseImage) return;

    push();
    translate(this.robotVP.x, this.robotVP.y);

    let viewSize = 400;
    let scale_ = viewSize / (this.sensorVP.w / 2);

    push();
    clip(() => {
      rect(0, 0, this.robotVP.w, this.robotVP.h);
    });
    translate(this.robotVP.w / 2, this.robotVP.h / 2);
    rotate(-radians(this.robot.heading - 90));
    scale(scale_);

    let sx = this.robot.x * this.courseDPI;
    let sy = this.robot.y * this.courseDPI;

    imageMode(CENTER);
    image(
      this.courseImage,
      -sx + this.courseImage.width / 2,
      -sy + this.courseImage.height / 2,
    );
    pop();

    // Draw crosshair
    stroke(255, 0, 0);
    strokeWeight(2);
    line(
      this.robotVP.w / 2 - 20,
      this.robotVP.h / 2,
      this.robotVP.w / 2 + 20,
      this.robotVP.h / 2,
    );
    line(
      this.robotVP.w / 2,
      this.robotVP.h / 2 - 20,
      this.robotVP.w / 2,
      this.robotVP.h / 2 + 20,
    );

    pop();
  }

  drawCourseView() {
    if (!this.courseImage) return;

    push();

    let scaleX = this.courseVP.w / this.courseImage.width;
    let scaleY = this.courseVP.h / this.courseImage.height;
    let _scale = Math.min(scaleX, scaleY);

    translate(this.courseVP.x, this.courseVP.y);

    push();
    scale(_scale);
    image(this.courseImage, 0, 0);
    pop();

    // Draw robot pointer
    let rx = this.robot.x * this.courseDPI * _scale;
    let ry = this.robot.y * this.courseDPI * _scale;

    push();
    translate(rx, ry);
    rotate(radians(this.robot.heading));

    fill(50, 50, 255);
    stroke(50, 50, 255);
    strokeWeight(12);
    line(0, 0, -60, 0);
    circle(0, 0, 10);
    pop();

    // Draw crumbs
    stroke(0, 255, 0);
    strokeWeight(3);
    for (let crumb of this.crumbs) {
      let cx = crumb.x * this.courseDPI * _scale;
      let cy = crumb.y * this.courseDPI * _scale;
      point(cx, cy);
    }

    // Draw start marker
    if (this.crumbs.length > 0) {
      fill(20, 200, 20);
      noStroke();
      textSize(20);
      let c = this.crumbs[0];
      text(
        "(S)",
        c.x * this.courseDPI * _scale,
        c.y * this.courseDPI * _scale,
      );
    }

    // Draw finish marker
    if (this.contestState === "finished" && this.crumbs.length > 0) {
      fill(200, 20, 20);
      noStroke();
      textSize(20);
      let c = this.crumbs[this.crumbs.length - 1];
      text(
        "(F)",
        c.x * this.courseDPI * _scale,
        c.y * this.courseDPI * _scale,
      );
    }

    pop();
  }

  drawSensors() {
    if (!this.courseImage) return;

    push();
    translate(
      this.robotVP.x + this.robotVP.w / 2,
      this.robotVP.y + this.robotVP.h / 2,
    );

    let _scale = (this.courseDPI * this.robotVP.w) / this.sensorVP.w;

    // Draw spot sensors
    for (let sensor of this.spotSensors) {
      let x = sensor.yoff * _scale;
      let y = -sensor.xoff * _scale;

      fill(sensor.color[0], sensor.color[1], sensor.color[2]);
      rectMode(CENTER);
      rect(x, y, sensor.spotWPix, sensor.spotHPix);
    }

    // Draw line sensors
    for (let sensor of this.lineSensors) {
      let colorArray = sensor.getColorArray();
      let halfWidth =
        ((sensor.sensorCells / 2.0) * sensor.spotWPix) / this.courseDPI;

      for (let i = 0; i < sensor.sensorCells; i++) {
        let y =
          ((0.5 + i) * sensor.spotHPix) / this.courseDPI - halfWidth;
        let x = sensor.xoff;
        let spotY = sensor.yoff + y;

        let sx = spotY * _scale;
        let sy = -x * _scale;

        let c = colorArray[i];
        fill(c[0], c[1], c[2]);
        rectMode(CENTER);
        rect(sx, sy, sensor.spotWPix, sensor.spotHPix);
      }
    }

    pop();
  }
}
