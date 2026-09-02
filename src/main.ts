// --- START OF FILE main.ts ---

import { linear } from '@/lib/easing';
import { ParticlesEngine } from '@/lib/particlesEngine';
import { TextureSequence } from '@/lib/types';
import GUI, { Controller } from 'lil-gui';
import Stats from 'stats.js';
import * as THREE from 'three';
import { OrbitControls } from 'three-stdlib';

type CMSEntry = { id: number; name: string; file: string };

// --- Fetching Functions (Keep as is) ---
const fetchOptions = { headers: { Authorization: `Bearer ${import.meta.env.VITE_CMS_TOKEN}` } };
const fetchResourceUrls = async (key: string): Promise<CMSEntry[]> => {
  try {
    const response = await fetch(`/api/items/${key}`, fetchOptions);
    if (!response.ok) throw new Error(`Failed to fetch ${key}: ${response.statusText}`);
    const obj = await response.json();
    return obj.data as CMSEntry[];
  } catch (error) {
    console.error(`Error fetching resource URLs for ${key}:`, error);
    return [];
  }
};

// --- Canvas, Renderer, Camera, Controls, Scene Setup (Keep as is) ---
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(canvas.width, canvas.height);
renderer.setPixelRatio(window.devicePixelRatio);
const camera = new THREE.PerspectiveCamera(75, canvas.width / canvas.height, 0.01, 100);
camera.position.z = 3;
camera.lookAt(0, 0, 0);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
const scene = new THREE.Scene();
scene.add(camera);

// --- Particles Engine Initialization ---
const initialTextureSize = 64;
const engine = new ParticlesEngine({
  textureSize: initialTextureSize,
  scene,
  renderer,
  camera,
  useIntersection: false, // Initial state for intersection
});

const initialTextureSequence: TextureSequence = [{ type: 'color', value: '#808080' }];
engine.setTextureSequence(initialTextureSequence);

// --- GUI Setup ---
const gui = new GUI();
gui.title('Particle Engine Controls');

// --- GUI Parameters Objects ---
const meshParams = {
  overallProgress: 0,
  targetProgress: 1.0,
  transitionDuration: 2000, // ms
};

const simulationParams = {
  velocityTraction: 0.1,
  positionalTraction: 0.1,
  maxRepelDistance: 0.3,
};

const instanceParams = {
  geometryScale: 1.0,
  textureSize: engine.getTextureSize(),
  useIntersect: engine.getUseIntersect(),
};

// --- Helper Variables for GUI ---
let matcapIds: string[] = [];
let overallProgressController: Controller | null = null;

const sequenceFolder = gui.addFolder('Sequence Control (Mesh & Texture)').close();

overallProgressController = sequenceFolder
  .add(meshParams, 'overallProgress', 0, 1, 0.001)
  .name('Overall Progress')
  .onChange((value: number) => {
    engine.setOverallProgress(value, true);
  });

sequenceFolder.add(meshParams, 'targetProgress', 0, 1, 0.01).name('Target Progress');
sequenceFolder.add(meshParams, 'transitionDuration', 500, 10000, 100).name('Duration (ms)');
sequenceFolder
  .add(
    {
      trigger: () => {
        console.log(`Scheduling overall transition to ${meshParams.targetProgress} over ${meshParams.transitionDuration}ms`);

        engine.scheduleMeshSequenceTransition(
          meshParams.targetProgress,
          meshParams.transitionDuration,
          linear,
          {
            onTransitionProgress: (p) => {
              if (overallProgressController) {
                meshParams.overallProgress = p;
                overallProgressController.updateDisplay();
              }
            },
            onTransitionFinished: () => console.log('Overall transition finished.'),
            onTransitionCancelled: () => console.log('Overall transition cancelled.'),
          },
          true,
        );
      },
    },
    'trigger',
  )
  .name('Start Overall Transition');

// --- 3. Simulation Parameters Folder ---
const simFolder = gui.addFolder('Simulation Parameters').close();
simFolder
  .add(simulationParams, 'velocityTraction', 0.01, 1.0, 0.001)
  .name('Velocity Traction')
  .onChange((value: number) => engine.setVelocityTractionForce(value));
simFolder
  .add(simulationParams, 'positionalTraction', 0.01, 1.0, 0.001)
  .name('Position Traction')
  .onChange((value: number) => engine.setPositionalTractionForce(value));
simFolder
  .add(simulationParams, 'maxRepelDistance', 0.0, 1.0, 0.001)
  .name('Max Repel Distance')
  .onChange((value: number) => engine.setMaxRepelDistance(value));

// --- 4. Instance Settings Folder ---
const instanceFolder = gui.addFolder('Instance Settings').close();
instanceFolder
  .add(instanceParams, 'geometryScale', 0.1, 5.0, 0.001)
  .name('Particle Scale')
  .onChange((value: number) => engine.setGeometrySize({ x: value, y: value, z: value }));

const textureSizes = [64, 128, 256, 512, 1024];
instanceFolder
  .add(instanceParams, 'textureSize', textureSizes)
  .name('Texture Size')
  .onChange((value: number) => {
    console.log(`Requesting texture size change to: ${value}`);
    instanceFolder.title('Instance Settings (Resizing...)');
    engine
      .setTextureSize(value)
      .then(() => {
        console.log(`Texture size successfully set to ${value}.`);
        instanceFolder.title('Instance Settings');
        instanceParams.textureSize = engine.getTextureSize();
        if (overallProgressController) {
          meshParams.overallProgress = engine.getEngineStateSnapshot().overallProgress;
          overallProgressController.updateDisplay();
        }
      })
      .catch((error) => {
        console.error(`Failed to set texture size to ${value}:`, error);
        instanceParams.textureSize = engine.getTextureSize();
        instanceFolder.title('Instance Settings (Error)');
      });
  });

instanceFolder
  .add(instanceParams, 'useIntersect')
  .name('Enable Mouse Interaction')
  .onChange((value: boolean) => engine.useIntersect(value));

// --- Asset Loading ---

// Load Meshes and Set Initial Sequence
fetchResourceUrls('meshes').then((entries) => {
  if (!entries || entries.length === 0) {
    console.warn('No mesh entries found.');
    return;
  }
  console.log(`Found ${entries.length} mesh entries. Loading...`);
  const promises = entries.map((entry) =>
    engine.fetchAndRegisterMesh(entry.name, `/api/assets/${entry.file}`).catch((error) => {
      console.error(`Failed to load mesh ${entry.name}:`, error);
      return null;
    }),
  );

  Promise.all(promises).then((results) => {
    const loadedMeshes = results.filter((mesh) => mesh !== null) as THREE.Mesh[];
    const meshNames = loadedMeshes.map((mesh) => mesh.name);
    if (meshNames.length > 0) {
      console.log(`Loaded ${meshNames.length} meshes. Setting sequence:`, meshNames);
      engine
        .setMeshSequence(meshNames) // Set the initial mesh sequence
        .then(() => console.log('Initial mesh sequence set.'))
        .catch((error) => console.error('Error setting initial mesh sequence:', error));
    } else {
      console.error('Failed to load any meshes.');
    }
  });
});

// Load Matcaps and Update Texture Sequence
fetchResourceUrls('matcaps').then((entries) => {
  if (!entries || entries.length === 0) {
    console.warn('No matcap entries found. Using initial texture sequence.');
    return;
  }
  console.log(`Found ${entries.length} matcap entries. Loading...`);
  const promises = entries.map((entry) =>
    engine.fetchAndRegisterMatcap(entry.name, `/api/assets/${entry.file}`).catch((error) => {
      console.error(`Failed to load matcap ${entry.name}:`, error);
      return null;
    }),
  );

  Promise.all(promises).then((results) => {
    const loadedMatcaps = results.filter((tex) => tex !== null) as THREE.Texture[];
    matcapIds = loadedMatcaps.map((tex) => tex.name); // Store loaded IDs

    console.log(`Loaded ${matcapIds.length} matcaps.`);

    // --- Update texture sequence after the load ---
    if (matcapIds.length > 0) {
      const dynamicTextureSequence: TextureSequence = [];
      matcapIds.forEach((id) => dynamicTextureSequence.push({ type: 'matcap', id }));
      if (dynamicTextureSequence.length > 1) {
        dynamicTextureSequence.splice(1, 0, { type: 'color', value: 'lime' });
      } else {
        dynamicTextureSequence.push({ type: 'color', value: '#0000ff' });
      }

      console.log('Setting dynamic texture sequence:', dynamicTextureSequence);
      engine.setTextureSequence(dynamicTextureSequence);
    } else {
      console.warn('No matcaps loaded, keeping initial texture sequence.');
    }
  });
});

// --- Event Handlers ---
const resizeHandler = () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  camera.aspect = canvas.width / canvas.height;
  camera.updateProjectionMatrix();
  renderer.setSize(canvas.width, canvas.height);
};
function mouseEventHandler(event: MouseEvent) {
  const x = (event.clientX / window.innerWidth) * 2 - 1;
  const y = -((event.clientY / window.innerHeight) * 2 - 1);
  engine.setPointerPosition({ x, y });
}

// --- Stats ---
const stats = new Stats();
stats.showPanel(0);
document.body.appendChild(stats.dom);

// --- Event Listeners ---
window.addEventListener('mousemove', mouseEventHandler);
window.addEventListener('resize', resizeHandler);
window.addEventListener('beforeunload', () => {
  console.log('Disposing resources...');
  gui.destroy();
  stats.dom.remove();
  engine.dispose();
  renderer.dispose();
  controls.dispose();
  window.removeEventListener('resize', resizeHandler);
  window.removeEventListener('mousemove', mouseEventHandler);
});

// --- Animation Loop ---
function animate(timestamp: number) {
  stats.begin();
  controls.update();

  engine.render(timestamp); // Pass timestamp (ms)

  renderer.render(scene, camera);
  stats.end();
  requestAnimationFrame(animate);
}

// Start the animation loop
requestAnimationFrame(animate);

// --- END OF FILE main.ts ---
