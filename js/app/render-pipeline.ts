// js/app/render-pipeline.ts
// The frame's TSL render pipeline: the scene pass with its MRT (colour, view normals, metalness & roughness), half-res
// screen-space reflections faded out on distant and matte surfaces so SSR spends its rays on visible glossy ones, and
// the colour grade over them (render/post-processing.ts: bloom, filmic toning, the time of day's look).
import * as THREE from 'three/webgpu';
import { pass, mrt, output, normalView, positionView, metalness, roughness, vec2, vec4, smoothstep } from 'three/tsl';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { createPostProcessing } from '../render/post-processing.ts';
import type { ColorGrade } from '../render/post-processing.ts';

export interface RenderPipeline {
  pipeline: THREE.RenderPipeline;
  /** the scene pass, whose render target and MRT the shader precompile renders into */
  scenePass: ReturnType<typeof pass>;
  sceneMRT: ReturnType<typeof mrt>;
  colorGrade: ColorGrade;
}

// Above this roughness a surface reflects nothing on screen (its reflections would only blur into noise)
const MAX_SSR_ROUGHNESS = 0.75;

/** withSSR: the graphics tier's screen-space reflections (app/quality.ts); without them the scene pass writes its colour
 *  only */
export function createRenderPipeline(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, withSSR = true): RenderPipeline {
  const scenePass = pass(scene, camera);
  // The multisampled colour attachments (output, normal, metalRough) only need resolving, never storing: discarding
  // them spares the GPU writing 3 x 4 samples per pixel to memory every frame (transient, memoryless attachments where
  // the browser supports them). The multisampled depth stays stored: SSR reads it.
  scenePass.renderTarget.storeMultisampledColorBuffer = false;
  const scenePassColor = scenePass.getTextureNode('output');
  if (!withSSR) {
    // (a phone's tier: no reflections, and none of the normal & roughness attachments they would read, nor the
    // multisampled depth stored past the pass: nothing samples it)
    scenePass.renderTarget.storeMultisampledDepthBuffer = false;
    const sceneMRT = mrt({ output });
    scenePass.setMRT(sceneMRT);
    const colorGrade = createPostProcessing(renderer, scenePassColor, vec4(0));
    return { pipeline: new THREE.RenderPipeline(renderer, colorGrade.outputNode), scenePass, sceneMRT, colorGrade };
  }
  const ssrFade = smoothstep(360.0, 180.0, positionView.z.negate());
  const sceneMRT = mrt({
    output,
    normal: normalView,
    metalRough: vec2(roughness.lessThan(MAX_SSR_ROUGHNESS).select(metalness.mul(ssrFade), 0), roughness)
  });
  sceneMRT.setBlendMode('normal', new THREE.BlendMode(THREE.MaterialBlending));
  sceneMRT.setBlendMode('metalRough', new THREE.BlendMode(THREE.MaterialBlending));
  scenePass.setMRT(sceneMRT);

  const scenePassDepth = scenePass.getTextureNode('depth');
  const scenePassNormal = scenePass.getTextureNode('normal');
  const scenePassMetalRough = scenePass.getTextureNode('metalRough');

  const ssrPass = ssr(scenePassColor, scenePassDepth, scenePassNormal, {
    metalnessNode: scenePassMetalRough.r,
    roughnessNode: scenePassMetalRough.g,
    camera
  });
  ssrPass.resolutionScale = 0.5;
  ssrPass.blurQuality = 1;
  ssrPass.maxDistance.value = 42;
  ssrPass.thickness.value = 0.85;
  // Fewer coarse steps, then refine detected hits to keep reflection edges precise.
  ssrPass.quality.value = 0.25;
  ssrPass.binaryRefine = true;
  ssrPass.intensity.value = 0.50;
  ssrPass.screenEdgeFadeBlack = true;

  // Roughness mip blur must not spread reflections back onto matte or nonreflective surfaces.
  const reflectionMask = scenePassMetalRough.r.greaterThan(0).select(smoothstep(MAX_SSR_ROUGHNESS, 0.55, scenePassMetalRough.g), 0);
  const reflections = ssrPass.mul(reflectionMask);
  const colorGrade = createPostProcessing(renderer, scenePassColor, reflections);
  return { pipeline: new THREE.RenderPipeline(renderer, colorGrade.outputNode), scenePass, sceneMRT, colorGrade };
}
