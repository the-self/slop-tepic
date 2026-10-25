// js/types/three-fixes.d.ts
// Where @types/three's declarations are narrower than what three.js does, declared here (as extra overloads, so the
// published ones still hold) instead of casting at every call.
import type { Node, TextureNode } from 'three/webgpu';
import type SSRNode from 'three/addons/tsl/display/SSRNode.js';
import type { SSRNodeOptions } from 'three/addons/tsl/display/SSRNode.js';

declare module 'three/addons/tsl/display/SSRNode.js' {
  // SSRNode samples its normal input (normalNode.sample(uv)), so it takes the scene pass's normal texture node: the
  // typings ask for a vec3 node, which has no sample()
  export function ssr(
    colorNode: Node<'vec4'>,
    depthNode: Node<'float'> | Node<'vec4'>,
    normalNode: TextureNode,
    options?: SSRNodeOptions,
  ): SSRNode;
}
