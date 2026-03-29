/**
 * AURA BLSS — Phase 2: Three.js sahne + simülasyon (tek modül)
 * Renderer: #bg-canvas | UI: index.html içindeki id'ler
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// --- Sabitler ---
const STATION_GRAY = 0xcccccc;
const PLATE_R = 1.15;
const PLATE_H = 0.36;
const PLATE_TOP = PLATE_H;
const PLANT_H = 7.5;
const GH_TARGET = new THREE.Vector3(0, PLATE_TOP + PLANT_H * 0.45, 0);
const LAMP_POS = new THREE.Vector3(3.7, 4.85, 0.12);
const FRUIT_SCALE = 2.0;

const CROPS = {
  patates: { fruitHex: '#c4a574', growthRate: 0.9, o2K: 1.12, co2Abs: 1.05, yield: 0.95 },
  çilek: { fruitHex: '#e85d75', growthRate: 1.12, o2K: 0.98, co2Abs: 0.92, yield: 1.08 },
  havuç: { fruitHex: '#ea580c', growthRate: 1.0, o2K: 1.04, co2Abs: 0.96, yield: 1.0 },
};

// --- Simülasyon ---
class Simulation {
  constructor() {
    this.elapsedSec = 0;
    this.algaeLevel = 30;
    this.mistLevel = 45;
    this.lightOptimization = 75;
    this.humidity = 58;
    this.ph = 6.0;
    this.mineralBalance = 55;
    this.crewCount = 4;
    this.plantAreaM2 = 40;
    this.radiationAlert = false;
    this.crop = 'patates';

    this.plantHealth = 82;
    /** Alg sağlığı (0–1) — alg yetiştiriciliği ve ışığa bağlı */
    this.algaeHealth = 0.55;
    /** Bitki su / turgör (0–100), hipotonik uyarı için */
    this.plantWaterHealth = 72;
    this.heat = 22;
    this.o2Percent = 72;
    this.co2Percent = 0.42;
    this.waterRecoveryPercent = 68;
    this.foodProduced = 0;
    this.energyEfficiency = 0.58;
    /** 0–1: üretim verimliliği (O₂ + gıda, alan/ışık teorisine göre) */
    this.productionEfficiency = 0;
    this._foodRate = 0;
  }

  getCrop() {
    return CROPS[this.crop] || CROPS.patates;
  }

  zoneStress() {
    let s = 0;
    if (this.humidity < 35 || this.humidity > 75) s += 0.2;
    if (this.ph < 4.0 || this.ph > 7.5) s += 0.28;
    if (this.mineralBalance < 35 || this.mineralBalance > 80) s += 0.22;
    return THREE.MathUtils.clamp(s, 0, 1);
  }

  transpirationFactor() {
    return 0.35 + (this.plantHealth / 100) * 0.55 + (this.humidity / 100) * 0.12;
  }

  step(dt) {
    this.elapsedSec += dt;
    const crop = this.getCrop();
    const areaF = this.plantAreaM2 / 40;
    const lightF = this.lightOptimization / 100;
    const zs = this.zoneStress();
    const zsPlant = zs * 2.5;

    this.algaeHealth = THREE.MathUtils.clamp(
      (this.algaeLevel / 100) * lightF * (this.radiationAlert ? 0.25 : 1),
      0,
      1
    );

    if (this.radiationAlert) {
      this.plantHealth -= dt * 6.5;
      this.heat += dt * 2.8;
    } else {
      this.heat = THREE.MathUtils.lerp(this.heat, 20 + (100 - this.lightOptimization) * 0.06, dt * 0.08);
    }

    const photo =
      lightF * crop.growthRate * crop.o2K * areaF * (this.radiationAlert ? 0.14 : 1);
    this.plantHealth += dt * (photo * 12 - zsPlant * 9 - (this.radiationAlert ? 4.5 : 0));
    this.plantHealth = THREE.MathUtils.clamp(this.plantHealth, 0, 100);
    if (this.plantHealth >= 99 && zs > 0) {
      this.plantHealth = Math.min(this.plantHealth, 98 - zs * 2);
    }

    const transp = this.transpirationFactor();
    this.waterRecoveryPercent = THREE.MathUtils.clamp(
      this.humidity * transp * 1.05 + (this.mistLevel / 100) * 10 - this.crewCount * 0.55,
      5,
      100
    );
    this.plantWaterHealth = THREE.MathUtils.clamp(
      this.waterRecoveryPercent * 0.55 + this.humidity * 0.35 + this.plantHealth * 0.1 - zsPlant * 18,
      0,
      100
    );

    const plantPhoto = photo * (this.plantHealth / 100);
    const algaeRate = (this.algaeLevel / 100) * 1.2 * lightF * (this.radiationAlert ? 0.2 : 1);
    const o2Net =
      plantPhoto * (this.plantHealth / 100) + algaeRate * this.algaeHealth - this.crewCount * 0.8;
    this.o2Percent += o2Net * 0.11 * dt;
    this.o2Percent = THREE.MathUtils.clamp(this.o2Percent, 0, 100);

    const co2crew = this.crewCount * 0.048;
    const co2up =
      (crop.co2Abs * (this.plantHealth / 100) * lightF + this.algaeLevel * 0.015) *
      areaF *
      (this.radiationAlert ? 0.2 : 1);
    this.co2Percent += (co2crew - co2up * 1.05) * dt * 0.065;
    this.co2Percent = THREE.MathUtils.clamp(this.co2Percent, 0.05, 9);

    const growthConst = 0.00035 * crop.growthRate * crop.yield * areaF;
    this.foodProduced = this.plantHealth * this.elapsedSec * growthConst * (this.radiationAlert ? 0.35 : 1);
    this._foodRate = this.plantHealth * growthConst * (this.radiationAlert ? 0.35 : 1);

    const eIn = 6 + lightF * 22 + (this.mistLevel / 100) * 12 + this.crewCount * 2;
    const eOut = o2Net * 0.35 + co2up * 0.25 + this._foodRate * 120;
    this.energyEfficiency = THREE.MathUtils.clamp(eOut / Math.max(eIn, 0.01), 0, 1.2);

    const maxFoodRate = 100 * growthConst * (this.radiationAlert ? 0.35 : 1);
    const foodRateNormalized = maxFoodRate > 1e-12 ? this._foodRate / maxFoodRate : 0;
    const photoCap = lightF * crop.growthRate * crop.o2K * areaF * (this.radiationAlert ? 0.14 : 1);
    const algaeCap = (this.algaeLevel / 100) * 1.2 * lightF * (this.radiationAlert ? 0.2 : 1);
    const theoreticalMaxO2 =
      Math.max(0.08, photoCap + algaeCap - this.crewCount * 0.8 * 0.35) * (1 + areaF * lightF * 0.15);
    const o2NetPositive = Math.max(0, o2Net);
    const o2NetPositiveNorm = o2NetPositive / Math.max(theoreticalMaxO2, 0.01);
    const theoreticalMax = 2;
    this.productionEfficiency = THREE.MathUtils.clamp(
      (o2NetPositiveNorm + foodRateNormalized) / theoreticalMax,
      0,
      1
    );
  }

  crewCritical() {
    return this.o2Percent < 15 || this.co2Percent > 5;
  }

  crewCriticalReason() {
    if (this.o2Percent < 15) return `O₂ %${this.o2Percent.toFixed(1)} — eşik altı.`;
    if (this.co2Percent > 5) return `CO₂ %${this.co2Percent.toFixed(2)} — üst eşik.`;
    return '';
  }

  fruitCount() {
    const h = this.plantHealth / 100;
    const c = this.getCrop();
    const L = this.lightOptimization / 100;
    let n = 1 + Math.round(9 * h * L * (0.5 + 0.5 * c.yield));
    if (this.radiationAlert) n = Math.max(1, Math.floor(n * 0.5));
    return THREE.MathUtils.clamp(n, 1, 10);
  }
}

const sim = new Simulation();

// --- Three.js state ---
let renderer;
let scene;
let camera;
let controls;
let composer;
let plantRoot;
let leafMaterial;
let leafGroup;
let trunkMesh;
let trunkUniforms;
let fruitGroup;
let growPoint;
let growTube;
let bloomPass;
let vaporPoints;
let vaporUniforms;
let starfield;
let chart;
let chartAccum = 0;
let lastFrame = performance.now();
let currentCrop = 'patates';

const SCI_MAX = 40;
const sciLabels = [];
const sciO2 = [];
const sciFood = [];
const sciEnergy = [];

// --- Gövde ---
const trunkVert = `
  uniform float uTime;
  uniform float uStemH;
  varying vec2 vUv;
  varying vec3 vNw;
  void main() {
    vUv = uv;
    vec3 p = position;
    float y = p.y / max(uStemH, 0.001);
    float ang = atan(p.x, p.z);
    p.x += sin(ang * 4.0 + y * 6.0 + uTime * 1.2) * 0.04 * y;
    p.z += cos(ang * 3.0 + y * 5.0 + uTime * 0.9) * 0.035 * y;
    p.y += sin(ang * 2.0 + uTime * 0.8) * 0.025 * y;
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vNw = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const trunkFrag = `
  uniform vec3 uCol;
  varying vec2 vUv;
  varying vec3 vNw;
  void main() {
    vec3 N = normalize(vNw);
    float nd = max(dot(N, vec3(0.2, 0.85, 0.35)), 0.0);
    vec3 c = mix(uCol * 0.4, uCol * 1.1, nd);
    gl_FragColor = vec4(c, 1.0);
  }
`;

function createTrunk(parent) {
  const h = PLANT_H * 0.92;
  const geo = new THREE.CylinderGeometry(0.11, 0.17, h, 20, 12);
  geo.translate(0, h / 2, 0);
  trunkUniforms = { uTime: { value: 0 }, uStemH: { value: h } };
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: trunkUniforms.uTime,
      uStemH: trunkUniforms.uStemH,
      uCol: { value: new THREE.Color(0x4a3728) },
    },
    vertexShader: trunkVert,
    fragmentShader: trunkFrag,
  });
  trunkMesh = new THREE.Mesh(geo, mat);
  trunkMesh.position.y = 0;
  parent.add(trunkMesh);
}

// --- Yaprak (oval üçgen kümesi) ---
function triLeafGeo() {
  const g = new THREE.BufferGeometry();
  const p = new Float32Array([
    0, -0.28, 0, -0.14, -0.1, 0, 0.14, -0.1, 0, 0, -0.28, 0, -0.16, 0.06, 0, 0.16, 0.06, 0, -0.16, 0.06, 0, 0, 0.28, 0, 0.16, 0.06, 0,
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}

function createLeafCluster() {
  const geo = triLeafGeo();
  const m = new THREE.Mesh(geo, leafMaterial);
  m.scale.setScalar(2.8);
  return m;
}

function scatterLeaves(parent) {
  leafGroup = new THREE.Group();
  const golden = Math.PI * (3 - Math.sqrt(5));
  const n = 72;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const y = 0.4 + t * (PLANT_H * 0.88);
    const th = i * golden * 2.1;
    const r = 0.14 + 0.1 * Math.sin(t * Math.PI);
    const leaf = createLeafCluster();
    leaf.position.set(Math.cos(th) * r, y, Math.sin(th) * r);
    leaf.lookAt(new THREE.Vector3(0, y + 0.6, 0));
    leaf.rotation.z += (Math.random() - 0.5) * 0.5;
    leaf.userData.baseRot = leaf.rotation.clone();
    leafGroup.add(leaf);
  }
  parent.add(leafGroup);
}

// --- Meyve ---
function hexCol(hex) {
  return new THREE.Color(hex.startsWith('#') ? hex : `#${hex}`);
}

function clearFruits() {
  while (fruitGroup.children.length) {
    const ch = fruitGroup.children[0];
    fruitGroup.remove(ch);
    ch.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose();
        o.material?.dispose?.();
      }
    });
  }
}

function addFruit(kind, pos, scaleMod) {
  const c = hexCol(CROPS[kind]?.fruitHex || '#888');
  const s = scaleMod * FRUIT_SCALE;
  const g = new THREE.Group();
  if (kind === 'patates') {
    const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, metalness: 0.05 });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.16 * s, 10, 8), m);
    mesh.scale.set(1.1, 0.75, 1.12);
    g.add(mesh);
  } else if (kind === 'çilek') {
    const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.05 });
    for (let k = 0; k < 6; k++) {
      const sp = new THREE.Mesh(new THREE.SphereGeometry(0.038 * s, 6, 5), m);
      const a = (k / 6) * Math.PI * 2;
      sp.position.set(Math.cos(a) * 0.035 * s, (k % 2) * 0.02 * s, Math.sin(a) * 0.035 * s);
      g.add(sp);
    }
  } else {
    const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.02 });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.07 * s, 0.48 * s, 10), m);
    cone.rotation.x = Math.PI;
    cone.position.y = -0.05 * s;
    g.add(cone);
  }
  g.position.copy(pos);
  g.rotation.set(Math.random() * 0.2, Math.random() * 6.28, Math.random() * 0.15);
  g.userData.baseRot = g.rotation.clone();
  fruitGroup.add(g);
}

function syncFruits() {
  const n = sim.fruitCount();
  if (fruitGroup.userData.lastN === n && fruitGroup.userData.lastCrop === sim.crop) return;
  fruitGroup.userData.lastN = n;
  fruitGroup.userData.lastCrop = sim.crop;
  clearFruits();
  const kind = sim.crop;
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0.5;
    const y = 0.6 + t * (PLANT_H * 0.75);
    const th = i * 2.7;
    const r = 0.2 + 0.08 * Math.sin(t * Math.PI);
    addFruit(kind, new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r), 0.88 + (i % 3) * 0.04);
  }
}

// --- İstasyon ---
function buildStation() {
  const mat = new THREE.MeshStandardMaterial({
    color: STATION_GRAY,
    metalness: 0.35,
    roughness: 0.45,
  });
  const plate = new THREE.Mesh(
    new THREE.CylinderGeometry(PLATE_R, PLATE_R * 0.97, PLATE_H, 48),
    mat
  );
  plate.position.y = PLATE_H / 2;
  scene.add(plate);

  const pipeStart = new THREE.Vector3(PLATE_R * 0.85, PLATE_H * 0.35, 0);
  const pipeEnd = new THREE.Vector3(LAMP_POS.x - 0.2, PLATE_H + 0.1, LAMP_POS.z * 0.9);
  const dir = pipeEnd.clone().sub(pipeStart);
  const len = Math.max(dir.length(), 0.4);
  const mid = pipeStart.clone().add(pipeEnd).multiplyScalar(0.5);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(len, 0.17, 0.19), mat);
  beam.position.copy(mid);
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.clone().normalize());
  scene.add(beam);

  const GROW_PURPLE = 0x8800ff;
  const GROW_MAGENTA = 0xff00ff;

  const unit = new THREE.Group();
  unit.position.copy(LAMP_POS);
  const H = PLANT_H * 0.95;
  const back = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, H * 1.02, 0.065),
    new THREE.MeshStandardMaterial({ color: STATION_GRAY, roughness: 0.5, metalness: 0.3 })
  );
  back.position.set(0.06, 0, 0);
  unit.add(back);
  growTube = new THREE.Mesh(
    new THREE.BoxGeometry(0.09, H * 0.96, 0.13),
    new THREE.MeshStandardMaterial({
      color: GROW_PURPLE,
      emissive: GROW_MAGENTA,
      emissiveIntensity: 0.38,
      roughness: 0.28,
    })
  );
  growTube.position.set(-0.04, 0, 0);
  unit.add(growTube);
  growPoint = new THREE.PointLight(GROW_PURPLE, 58, 52, 1.85);
  growPoint.position.set(-0.05, 0, 0);
  unit.add(growPoint);

  scene.add(unit);
}

// --- Yıldız ---
function createStarfield() {
  const n = 1600;
  const R = 380;
  const pos = new Float32Array(n * 3);
  const sz = new Float32Array(n);
  const br = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = Math.random();
    const v = Math.random();
    const th = u * Math.PI * 2;
    const ph = Math.acos(2 * v - 1);
    const rr = R * (0.88 + Math.random() * 0.12);
    const sp = Math.sin(ph);
    pos[i * 3] = rr * sp * Math.cos(th);
    pos[i * 3 + 1] = rr * Math.cos(ph);
    pos[i * 3 + 2] = rr * sp * Math.sin(th);
    sz[i] = 0.4 + Math.random() * 3.2;
    br[i] = 0.25 + Math.random() * 0.75;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
  geo.setAttribute('aB', new THREE.BufferAttribute(br, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uPR: { value: Math.min(window.devicePixelRatio, 2) },
      uTime: { value: 0 },
    },
    vertexShader: `
      attribute float aSize; attribute float aB;
      varying float vB; uniform float uPR; uniform float uTime;
      void main() {
        float tw = 0.82 + 0.18 * sin(uTime * 2.2 + position.x * 0.03 + position.z * 0.028);
        vB = aB * tw;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uPR * (200.0 / max(-mv.z, 1.0));
      }
    `,
    fragmentShader: `
      varying float vB;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        if (length(c) > 0.5) discard;
        float a = smoothstep(0.5, 0.1, length(c)) * vB;
        gl_FragColor = vec4(vec3(1.0), a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  mat.toneMapped = false;
  return new THREE.Points(geo, mat);
}

// --- Buhar ---
function createVapor(maxCount) {
  const pos = new Float32Array(maxCount * 3);
  const rnd = new Float32Array(maxCount * 3);
  for (let i = 0; i < maxCount; i++) {
    const ang = Math.random() * Math.PI * 2;
    const rad = 0.5 + Math.random() * 1.1;
    pos[i * 3] = Math.cos(ang) * rad;
    pos[i * 3 + 1] = Math.random() * PLANT_H * 1.1;
    pos[i * 3 + 2] = Math.sin(ang) * rad;
    rnd[i * 3] = Math.random();
    rnd[i * 3 + 1] = Math.random();
    rnd[i * 3 + 2] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 3));
  vaporUniforms = { uTime: { value: 0 }, uH: { value: PLANT_H } };
  const mat = new THREE.ShaderMaterial({
    uniforms: vaporUniforms,
    vertexShader: `
      attribute vec3 aRnd; uniform float uTime; uniform float uH;
      void main() {
        vec3 p = position;
        p.y += mod(uTime * 0.35 + aRnd.x * 6.28, uH * 1.2);
        p.x += sin(uTime * 0.8 + aRnd.y * 10.0) * 0.08;
        p.z += cos(uTime * 0.7 + aRnd.z * 10.0) * 0.08;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = 18.0;
      }
    `,
    fragmentShader: `
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.2, d) * 0.18;
        gl_FragColor = vec4(0.92, 0.93, 0.95, a);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.userData.vaporMax = maxCount;
  pts.geometry.setDrawRange(0, maxCount);
  return pts;
}

// --- UI ---
function formatClock(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function readInputsFromUI() {
  sim.algaeLevel = +document.getElementById('slider-algae').value;
  sim.mistLevel = +document.getElementById('slider-mist').value;
  sim.lightOptimization = +document.getElementById('slider-light').value;
  sim.humidity = +document.getElementById('slider-humidity').value;
  sim.ph = +document.getElementById('slider-ph').value / 10;
  sim.mineralBalance = +document.getElementById('slider-mineral').value;
  sim.crewCount = +document.getElementById('slider-crew').value;
  sim.plantAreaM2 = +document.getElementById('slider-area').value;
  sim.radiationAlert = document.getElementById('radiation-toggle').checked;
  currentCrop = document.getElementById('crop-select').value;
  sim.crop = currentCrop;

  document.getElementById('val-algae').textContent = String(sim.algaeLevel);
  document.getElementById('val-mist').textContent = String(sim.mistLevel);
  document.getElementById('val-light').textContent = String(sim.lightOptimization);
  document.getElementById('val-humidity').textContent = String(sim.humidity);
  document.getElementById('val-ph').textContent = sim.ph.toFixed(1);
  document.getElementById('val-mineral').textContent = String(sim.mineralBalance);
  document.getElementById('val-crew').textContent = String(sim.crewCount);
  document.getElementById('val-area').textContent = String(sim.plantAreaM2);
}

function updateHUD() {
  document.getElementById('sim-clock').textContent = formatClock(sim.elapsedSec);
  const valT = document.getElementById('val-t');
  if (valT) valT.textContent = String(Math.floor(sim.elapsedSec));

  document.getElementById('out-o2').textContent = `${sim.o2Percent.toFixed(1)}%`;
  document.getElementById('out-co2').textContent = `${sim.co2Percent.toFixed(2)}%`;
  document.getElementById('out-plant').textContent = `${sim.plantHealth.toFixed(1)}%`;
  document.getElementById('out-water').textContent = `${sim.waterRecoveryPercent.toFixed(1)}%`;
  document.getElementById('out-food').textContent = sim.foodProduced.toFixed(2);
  document.getElementById('out-energy').textContent = `${(sim.energyEfficiency * 100).toFixed(1)}%`;
  document.getElementById('out-production').textContent = `${(sim.productionEfficiency * 100).toFixed(1)}%`;
  document.getElementById('out-heat').textContent = sim.heat.toFixed(1);

  const risk = document.getElementById('crew-risk-overlay');
  const rad = document.getElementById('radiation-overlay');
  if (sim.crewCritical()) {
    risk.classList.remove('hidden');
    risk.classList.add('flex');
    document.getElementById('crew-risk-reason').textContent = sim.crewCriticalReason();
  } else {
    risk.classList.add('hidden');
    risk.classList.remove('flex');
  }
  if (sim.radiationAlert) {
    rad.classList.remove('hidden');
    rad.classList.add('flex');
  } else {
    rad.classList.add('hidden');
    rad.classList.remove('flex');
  }
}

function initChart() {
  const ChartCtor = globalThis.Chart;
  if (!ChartCtor) return;
  const el = document.getElementById('science-chart');
  if (!el) return;
  const gridColor = 'rgba(0, 0, 0, 0.1)';
  const axisFont = { size: 12, family: "'JetBrains Mono', ui-monospace, monospace" };
  chart = new ChartCtor(el.getContext('2d'), {
    type: 'line',
    data: {
      labels: sciLabels,
      datasets: [
        {
          label: 'O₂ %',
          data: sciO2,
          borderColor: '#00f2ff',
          backgroundColor: 'rgba(0, 242, 255, 0.12)',
          borderWidth: 2,
          fill: true,
          tension: 0.25,
          pointRadius: 0,
        },
        {
          label: 'Gıda hızı',
          data: sciFood,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.06)',
          borderWidth: 3,
          fill: false,
          tension: 0.25,
          pointRadius: 0,
        },
        {
          label: 'Enerji verimliliği ×100',
          data: sciEnergy,
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245, 158, 11, 0.08)',
          borderWidth: 2,
          fill: false,
          tension: 0.25,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: { font: { size: 11, family: "'DM Sans', system-ui, sans-serif" }, boxWidth: 10 },
        },
      },
      scales: {
        x: {
          ticks: { font: axisFont, color: '#171717' },
          grid: { color: gridColor, lineWidth: 1 },
          border: { color: 'rgba(0,0,0,0.2)' },
        },
        y: {
          ticks: { font: axisFont, color: '#171717' },
          grid: { color: gridColor, lineWidth: 1 },
          border: { color: 'rgba(0,0,0,0.2)' },
        },
      },
    },
  });
}

function pushChart() {
  if (!chart) return;
  sciLabels.push(`${Math.floor(sim.elapsedSec)}s`);
  sciO2.push(sim.o2Percent);
  sciFood.push(sim._foodRate * 1000);
  sciEnergy.push(sim.energyEfficiency * 100);
  while (sciLabels.length > SCI_MAX) {
    sciLabels.shift();
    sciO2.shift();
    sciFood.shift();
    sciEnergy.shift();
  }
  chart.update('none');
}

function refreshChartTail() {
  if (!chart || sciLabels.length === 0) return;
  sciO2[sciO2.length - 1] = sim.o2Percent;
  sciFood[sciFood.length - 1] = sim._foodRate * 1000;
  sciEnergy[sciEnergy.length - 1] = sim.energyEfficiency * 100;
  chart.update('none');
}

function wireControls() {
  const on = () => {
    readInputsFromUI();
    updateHUD();
    refreshChartTail();
  };
  [
    'slider-algae',
    'slider-mist',
    'slider-light',
    'slider-humidity',
    'slider-ph',
    'slider-mineral',
    'slider-crew',
    'slider-area',
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', on);
  });
  const cs = document.getElementById('crop-select');
  const rt = document.getElementById('radiation-toggle');
  if (cs) cs.addEventListener('change', on);
  if (rt) rt.addEventListener('change', on);
}

// --- Görsel senkron ---
function syncPlantVisuals() {
  const zs = sim.zoneStress();
  const wilt = sim.plantWaterHealth < 50 ? (50 - sim.plantWaterHealth) / 50 : 0;
  const GROW_PURPLE = 0x8800ff;
  const GROW_MAGENTA = 0xff00ff;

  if (leafGroup) {
    leafGroup.rotation.x = wilt * 0.55;
    leafGroup.children.forEach((leaf, i) => {
      if (!leaf.userData.baseRot) return;
      leaf.rotation.x = leaf.userData.baseRot.x + wilt * 0.35 + Math.sin(i * 0.5) * 0.04;
    });
  }
  if (fruitGroup) {
    fruitGroup.rotation.x = wilt * 0.55;
    fruitGroup.children.forEach((fruit, i) => {
      if (!fruit.userData.baseRot) return;
      fruit.rotation.x = fruit.userData.baseRot.x + wilt * 0.35 + Math.sin(i * 0.5) * 0.04;
    });
  }
  const green = new THREE.Color(0x15803d);
  const yellow = new THREE.Color(0xc4a574);
  const brown = new THREE.Color(0x5c4033);
  const c = green.clone().lerp(yellow, zs * 0.85).lerp(brown, zs * zs * 0.4);
  if (leafMaterial) {
    leafMaterial.color.copy(c);
    leafMaterial.emissive.copy(c.clone().multiplyScalar(0.08));
  }
  if (growPoint) {
    if (sim.radiationAlert) {
      growPoint.intensity = 14;
      growPoint.color.setHex(0x886644);
    } else {
      growPoint.intensity = 58;
      growPoint.color.setHex(GROW_PURPLE);
    }
  }
  if (growTube?.material) {
    if (sim.radiationAlert) {
      growTube.material.color.setHex(0x886644);
      growTube.material.emissive.setHex(0x553322);
      growTube.material.emissiveIntensity = 0.1;
    } else {
      growTube.material.color.setHex(GROW_PURPLE);
      growTube.material.emissive.setHex(GROW_MAGENTA);
      growTube.material.emissiveIntensity = 0.38;
    }
  }
}

// --- init ---
function init() {
  const canvas =
    document.getElementById('bg-canvas') ||
    (() => {
      const c = document.createElement('canvas');
      c.id = 'bg-canvas';
      const wrap = document.getElementById('canvas-container');
      if (wrap) wrap.appendChild(c);
      return c;
    })();

  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setSize(w, h, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  camera = new THREE.PerspectiveCamera(75, w / h, 0.1, 1000);
  camera.position.set(0, 10, 20);
  camera.lookAt(GH_TARGET);

  scene.add(new THREE.AmbientLight(0xffffff, 1.5));

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(GH_TARGET);
  controls.enableDamping = true;
  controls.minDistance = 10;
  controls.maxDistance = 80;

  starfield = createStarfield();
  scene.add(starfield);

  buildStation();

  leafMaterial = new THREE.MeshStandardMaterial({
    color: 0x15803d,
    roughness: 0.62,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });

  plantRoot = new THREE.Group();
  plantRoot.position.set(0, PLATE_TOP, 0);
  scene.add(plantRoot);

  createTrunk(plantRoot);
  scatterLeaves(plantRoot);
  fruitGroup = new THREE.Group();
  plantRoot.add(fruitGroup);
  syncFruits();

  vaporPoints = createVapor(800);
  plantRoot.add(vaporPoints);

  composer = new EffectComposer(renderer);
  composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.48, 0.38, 0.08);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());

  window.addEventListener('resize', () => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    renderer.setSize(W, H, false);
    composer.setSize(W, H);
    composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    if (starfield?.material?.uniforms?.uPR) {
      starfield.material.uniforms.uPR.value = Math.min(window.devicePixelRatio, 2);
    }
  });

  initChart();
  wireControls();
  readInputsFromUI();
  pushChart();
  updateHUD();
}

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;

  sim.step(dt);
  if (trunkUniforms) trunkUniforms.uTime.value = now * 0.001;
  if (starfield?.material?.uniforms?.uTime) starfield.material.uniforms.uTime.value = now * 0.001;
  if (vaporUniforms) vaporUniforms.uTime.value = now * 0.001;

  if (plantRoot) plantRoot.rotation.y += 0.01;

  if (vaporPoints?.geometry && vaporPoints.userData.vaporMax) {
    const mx = vaporPoints.userData.vaporMax;
    const n = Math.round((sim.mistLevel / 100) * mx);
    vaporPoints.geometry.setDrawRange(0, Math.max(0, Math.min(mx, n)));
  }

  syncPlantVisuals();
  syncFruits();

  chartAccum += dt;
  if (chartAccum >= 2) {
    chartAccum -= 2;
    pushChart();
  }
  refreshChartTail();
  updateHUD();
  controls.update();
  composer.render();
}

init();
requestAnimationFrame(animate);

globalThis.AURA = { sim, get crop() { return currentCrop; } };