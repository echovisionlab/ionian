import { ParticlesEngine } from '@/lib/particlesEngine';
import GUI from 'lil-gui';
import * as THREE from 'three';

const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-3, 3, 2.4, -2.4, 0.1, 100);
camera.position.z = 8;
const engine = new ParticlesEngine({
  textureSize: 64,
  scene,
  renderer,
  camera,
  useIntersection: false,
  dracoDecoderPath: null,
  pointerFacing: {
    enabled: true,
    strength: { x: 0.75, y: 0.75, z: 0.3 },
    response: { x: 5, y: 8, z: 3 },
    maxAngle: { x: Math.PI / 6, y: Math.PI / 6, z: Math.PI / 18 },
  },
});
engine.setGeometrySize({ x: 28, y: 28, z: 28 });
engine.setVelocityTractionForce(0.08);
engine.setPositionalTractionForce(0.2);
engine.setTextureSequence([{ type: 'color', value: '#cad7ea' }]);
engine.registerMesh('knot', new THREE.Mesh(new THREE.TorusKnotGeometry(0.9, 0.28, 128, 16)));

// A local glyph mask is triangulated into a sampling mesh; no CMS or font request.
function numberMesh(code: string) {
  const mask = document.createElement('canvas');
  mask.width = 480;
  mask.height = 200;
  const ctx = mask.getContext('2d')!;
  ctx.font = '800 180px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(code, 240, 100, 440);
  const pixels = ctx.getImageData(0, 0, 480, 200).data;
  const vertices: number[] = [];
  for (let y = 0; y < 200; y += 3) {
    for (let x = 0; x < 480; x += 3) {
      if (pixels[(y * 480 + x) * 4 + 3] < 100) continue;
      const left = (x - 240) / 100;
      const top = (100 - y) / 100;
      vertices.push(left, top, 0, left, top - 0.03, 0, left + 0.03, top, 0, left + 0.03, top, 0, left, top - 0.03, 0, left + 0.03, top - 0.03, 0);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry);
}
engine.registerMesh('404', numberMesh('404'));
engine.registerMesh('500', numberMesh('500'));

const settings = {
  shape: 'knot',
  follow: true,
  strength: { x: 0.75, y: 0.75, z: 0.3 },
  response: { x: 5, y: 8, z: 3 },
  maxAngle: { x: 30, y: 30, z: 10 },
  rotate: true,
  rotationX: 0,
  rotationY: 0.15,
  rotationZ: 0.12,
  reset: () => engine.getObject().rotation.set(0, 0, 0),
};
const gui = new GUI({ title: 'Ionian 미리보기', width: 280 });
gui
  .add(settings, 'shape', { '토러스 매듭': 'knot', '404': '404', '500': '500' })
  .name('형태')
  .onChange(async (value: string) => {
    await engine.setMeshSequence([value]);
    settings.reset();
  });
const follow = gui.addFolder('마우스 따라보기');
follow
  .add(settings, 'follow')
  .name('켜기')
  .onChange((enabled: boolean) => engine.setPointerFacing({ enabled }));
function applyFacing() {
  engine.setPointerFacing({
    strength: settings.strength,
    response: settings.response,
    maxAngle: {
      x: THREE.MathUtils.degToRad(settings.maxAngle.x),
      y: THREE.MathUtils.degToRad(settings.maxAngle.y),
      z: THREE.MathUtils.degToRad(settings.maxAngle.z),
    },
  });
}
for (const axis of ['x', 'y', 'z'] as const) {
  const label = { x: 'X · 위아래 기울기', y: 'Y · 좌우 방향', z: 'Z · 화면 안 기울기' }[axis];
  const folder = follow.addFolder(label);
  folder.add(settings.strength, axis, 0, 1, 0.01).name('따라가는 강도').onChange(applyFacing);
  folder.add(settings.response, axis, 0.5, 20, 0.1).name('반응 속도').onChange(applyFacing);
  folder.add(settings.maxAngle, axis, 0, 60, 1).name('최대 각도 (°)').onChange(applyFacing);
}
const rotation = gui.addFolder('자동 회전 · 별도 제어');
rotation.add(settings, 'rotate').name('켜기');
rotation.add(settings, 'rotationX', -0.5, 0.5, 0.01).name('X축 속도');
rotation.add(settings, 'rotationY', -0.5, 0.5, 0.01).name('Y축 속도');
rotation.add(settings, 'rotationZ', -0.5, 0.5, 0.01).name('Z축 속도');
rotation.add(settings, 'reset').name('회전 초기화');

function resize() {
  const { width, height } = canvas.getBoundingClientRect();
  renderer.setSize(width, height, false);
  const aspect = width / height;
  camera.left = -2.4 * aspect;
  camera.right = 2.4 * aspect;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
canvas.addEventListener('pointermove', (event) => {
  const rect = canvas.getBoundingClientRect();
  engine.setPointerFacingPosition({ x: (2 * (event.clientX - rect.left)) / rect.width - 1, y: 1 - (2 * (event.clientY - rect.top)) / rect.height });
});
canvas.addEventListener('pointerleave', () => engine.setPointerFacingPosition(null));
window.addEventListener('blur', () => engine.setPointerFacingPosition(null));

await engine.setMeshSequence(['knot']);
for (let i = 0; i < 180; i++) engine.renderFrame(1 / 60, i / 60);
let lastFrame = 0;
let elapsed = 3;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
status.textContent = 'Ionian 실제 엔진 · 4,096개 파티클 · 밝기 고정';
document.body.dataset.previewReady = 'true';
renderer.setAnimationLoop((now) => {
  const delta = lastFrame ? Math.min((now - lastFrame) / 1000, 0.05) : 0;
  lastFrame = now;
  elapsed += delta;
  if (settings.rotate && !reducedMotion.matches) {
    const object = engine.getObject();
    object.rotation.x += settings.rotationX * delta;
    object.rotation.y += settings.rotationY * delta;
    object.rotation.z += settings.rotationZ * delta;
  }
  engine.renderFrame(delta, elapsed);
  renderer.render(scene, camera);
});
document.addEventListener('visibilitychange', () => {
  lastFrame = 0;
});
window.addEventListener(
  'pagehide',
  () => {
    renderer.setAnimationLoop(null);
    engine.dispose();
    renderer.dispose();
    gui.destroy();
  },
  { once: true },
);
