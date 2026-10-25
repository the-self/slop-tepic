// js/app/shaders.ts
// Shader pre-compilation behind the loading screen, and the warm-up of the first frame. compileAsync() builds the node
// graphs in slices and has the GPU process compile the pipelines in parallel, but after every 8 ms slice it waits for a
// rendered frame, which leaves the main thread idle about half the time while nothing else animates; several calls
// side by side keep it busy (warm cache: 2.1 s instead of 4.0 s). (Rendering straight away compiled ~500 pipelines one
// after another: ~25 s with a cold shader cache.)
import * as THREE from 'three/webgpu';
import type { RenderPipeline } from './render-pipeline.ts';

const COMPILE_POOL = 16;

// The Prioritized Task Scheduling API's yield, where the browser has it
interface YieldingScheduler {
  yield?: () => Promise<void>;
}
const taskScheduler = (globalThis as { scheduler?: YieldingScheduler }).scheduler;
const nextTask = (): Promise<void> => (taskScheduler?.yield ? taskScheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0)));

// What gets drawn and so has pipelines to compile
const isDrawable = (o: THREE.Object3D): o is THREE.Mesh | THREE.Line | THREE.Points | THREE.Sprite =>
  o instanceof THREE.Mesh || o instanceof THREE.Line || o instanceof THREE.Points || o instanceof THREE.Sprite;

/**
 * Compiles the pipelines of every visible object for the scene pass, `onProgress` (0..1) as the jobs finish. Plain
 * meshes that share a material share its shader, so one job compiles them in turn (the first build serves the rest);
 * every instanced mesh gets a build of its own unless its chunks share a pipeline (userData.sharesPipelineWith).
 */
export async function precompileShaders(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera,
  { pipeline, scenePass, sceneMRT }: RenderPipeline, onProgress: (done: number) => void, onPostFX: () => void): Promise<void> {
  // An empty frame first: it sets up the post-processing chain, which configures the scene pass's render target
  // (MSAA samples, depth format), so the pipelines compiled below are the very ones the scene pass asks for
  scene.visible = false;
  pipeline.render();
  scene.visible = true;
  onPostFX();

  // Every visible object with frustum culling off (like the warm-up frame)
  const culled: THREE.Object3D[] = [];
  const jobs: THREE.Object3D[][] = [];
  const jobByMaterial = new Map<THREE.Material, THREE.Object3D[]>();
  const pipelines = new Set<THREE.Object3D>();
  scene.traverseVisible((o) => {
    if (o.frustumCulled) {
      culled.push(o);
      o.frustumCulled = false;
    }
    if (!isDrawable(o)) return;
    // Use the first visible chunk: the original representative may be in an inactive tree cell. Shadow stand-ins
    // only draw in the shadow maps (the warm-up frame compiles those).
    if (o.userData.shadowProxy) return;
    const shared = o.userData.sharesPipelineWith as THREE.Object3D | undefined;
    const key = shared ?? o;
    if (pipelines.has(key)) return;
    pipelines.add(key);
    const material = o.material;
    if (o instanceof THREE.InstancedMesh || Array.isArray(material)) {
      jobs.push([o]);
      return;
    }
    let job = jobByMaterial.get(material);
    if (!job) {
      job = [];
      jobByMaterial.set(material, job);
      jobs.push(job);
    }
    job.push(o);
  });

  renderer.setRenderTarget(scenePass.renderTarget);
  renderer.setMRT(sceneMRT);
  const compile = async (object: THREE.Object3D) => {
    // Each compile starts in a task of its own: compileAsync() keeps one precompilation state on the renderer, which
    // must not be mid-step for two of them in the same microtask checkpoint
    await nextTask();
    try {
      await renderer.compileAsync(object, camera, scene);
    } catch (e) {
      console.warn('[compile]', e); // the warm-up frame compiles it instead
    }
  };
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++] ?? [];
      for (const object of job) await compile(object);
      done++;
      onProgress(done / jobs.length);
    }
  };
  await Promise.all(Array.from({ length: COMPILE_POOL }, worker));
  renderer.setMRT(null);
  renderer.setRenderTarget(null);
  for (const o of culled) o.frustumCulled = true;
}

/**
 * The first frame, drawn behind the loading screen for what precompileShaders() can't reach (the shadow map passes):
 * with frustum culling off, every visible material's pipelines compile now instead of stalling the first time the
 * camera turns towards it (one chunk / shadow stand-in per shared pipeline is enough)
 */
export function warmUpFrame(scene: THREE.Scene, pipeline: THREE.RenderPipeline): void {
  const culled: THREE.Object3D[] = [];
  const pipelines = new Set<THREE.Object3D>();
  scene.traverseVisible((o) => {
    const key = (o.userData.sharesPipelineWith as THREE.Object3D | undefined) ?? o;
    if (pipelines.has(key)) return;
    pipelines.add(key);
    if (o.frustumCulled) {
      culled.push(o);
      o.frustumCulled = false;
    }
  });
  pipeline.render();
  for (const o of culled) o.frustumCulled = true;
}
