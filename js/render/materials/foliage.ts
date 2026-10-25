import * as THREE from 'three/webgpu';
import {
  Fn,
  float,
  vec2,
  vec3,
  vec4,
  color,
  attribute,
  positionGeometry,
  positionLocal,
  positionViewDirection,
  normalLocal,
  normalView,
  normalViewGeometry,
  frontFacing,
  uv,
  time,
  sin,
  abs,
  floor,
  fract,
  clamp,
  mix,
  step,
  smoothstep,
  dot,
  normalize,
  pow,
  texture
} from 'three/tsl';
import { noise2D, canyonSkyAONode } from './shared.ts';
import type { Node, NodeBuilder, LightingModelDirectInput, MeshStandardNodeMaterialParameters } from 'three/webgpu';

// js/render/materials/foliage.ts
// The trees' material: bark & leaf cards in one draw, wind sway, and sunlight through the leaves.

// Sunlight shining through leaves (Barré-Brisebois & Bouchard's fast translucency approximation): looking against
// the light, a leaf glows with the light it lets through. It takes the direct light's colour, so shadows (the crown's
// own included) dim it like the sunlit side. Materials set `translucencyNode` (vec3, 0 where nothing shines through).
class FoliageLightingModel extends THREE.PhysicalLightingModel {
  override direct(lightData: LightingModelDirectInput, builder: NodeBuilder): void {
    // (all vec3s: @types/three leaves the light data's nodes untyped)
    const lightDirection = lightData.lightDirection as Node<'vec3'>;
    const lightColor = lightData.lightColor as Node<'vec3'>;
    const directDiffuse = lightData.reflectedLight.directDiffuse as Node<'vec3'>;
    const material = builder.material;
    const translucency = material instanceof TreeNodeMaterial ? material.translucencyNode : null;
    if (translucency) {
      const scatter = normalize(lightDirection.add(normalView.mul(0.3)));
      const through = pow(clamp(dot(positionViewDirection, scatter.negate()), 0.0, 1.0), 3.0);
      directDiffuse.addAssign(lightColor.mul(translucency).mul(through));
    }
    super.direct(lightData, builder);
  }
}

class TreeNodeMaterial extends THREE.MeshStandardNodeMaterial {
  declare translucencyNode: Node<'vec3'> | null;

  static override get type(): string {
    return 'TreeNodeMaterial';
  }

  constructor(parameters?: MeshStandardNodeMaterialParameters) {
    super(parameters);
    this.translucencyNode = null;
  }

  override setupLightingModel(): FoliageLightingModel {
    return new FoliageLightingModel();
  }
}

// Prevailing wind (xz, blowing from the west-north-west across the city)
const TREE_WIND = vec2(0.86, 0.51);

/**
 * Instanced street & park tree material (js/world/trees.ts): bark tubes and alpha-tested leaf cards in ONE draw per mesh.
 * Geometry attributes:
 * - uv: leaf-atlas coordinates on the cards; on the bark (metres round the stem, metres along it)
 * - normal: on the cards, crown-shell normals (out from the crown centre, blended with the card face), so a crown
 *   shades as one leafy volume and both sides of a card light alike (the back faces keep them unflipped)
 * - aTree (vec4): x = 1 on leaf cards / 0 on bark, y = crown occlusion (0 deep inside .. 1 on the outer shell),
 *   z = sway weight (0 on the trunk .. 1 at the twig tips & cards), w = per-card random (leaf flutter phase) on the
 *   cards, on the bark the palm's skirt of dead fronds (0..1)
 * - aTreeData (instanced vec4): rgb = per-tree linear foliage tint, w = species index (+ 10 for a trunk whitewashed
 *   with cal up to ~1.3 m, as Tepic paints its street trees) + per-tree random fraction (species 0 laurel de la
 *   India: smooth pale grey bark, 1 jacaranda, 2 mango & 3 tabachín: dark furrowed bark, 4 Washingtonia palm: a
 *   grey trunk ringed with old leaf scars under a straw-brown skirt)
 * Leaf atlas texels: r = leaf brightness, g = per-leaf hue jitter, b = twig / stalk mask, a = coverage (its mipmaps
 * keep the coverage, so distant crowns stay full).
 * Shading: per-tree tint with sun-yellowed & cooler leaves, deep leaves darker and occluded from the sky, sunlight
 * shining through the leaves toward the camera (FoliageLightingModel), alpha-to-coverage leaf edges on the MSAA scene
 * pass (alpha-tested in the shadow maps: dappled shadows). Wind: gusts rolling across the city sway the crowns
 * (shadows follow), branches bob and leaves flutter.
 */
export function createTreeMaterial(leafAtlas: THREE.Texture): TreeNodeMaterial {
  // The alpha test is given as nodes (alphaTestNode on the scene pass, maskShadowNode in the shadow maps) rather than
  // `alphaTest`: the shadow passes copy each caster's `alphaTest` onto one shared shadow material, and every switch
  // between 0 and > 0 bumps its version, which made three.js re-hash the node graphs of all the casters' shadow render
  // objects every frame (~10 ms of CPU). The trees were the only alpha-tested casters.
  const mat = new TreeNodeMaterial({
    side: THREE.DoubleSide,
    alphaToCoverage: true,
    metalness: 0.0,
    roughness: 0.8
  });

  const aTree = attribute('aTree', 'vec4');
  const aData = attribute('aTreeData', 'vec4');
  const isLeaf = aTree.x;
  const crownAO = aTree.y;
  const rnd = fract(aData.w);
  const coded = floor(aData.w);
  const whitewash = step(9.5, coded);
  const species = coded.sub(whitewash.mul(10.0));
  const leaf = texture(leafAtlas, uv());

  // Wind. positionLocal is already instanced (world space); positionGeometry is the tree's own frame (metres)
  mat.positionNode = Fn(() => {
    const p = positionLocal;
    const g = positionGeometry;
    const phase = rnd.mul(6.2832);
    // gusts rolling downwind across the city
    const gust = sin(time.mul(0.5).sub(dot(p.xz, TREE_WIND).mul(0.045))).mul(0.5).add(0.5);
    const strength = gust.mul(gust).mul(0.7).add(0.3);
    // the whole tree bends with height, leaning downwind and rocking across it
    const h = g.y.div(11.0);
    const bend = h.mul(h);
    const lean = sin(time.mul(0.85).add(phase)).mul(0.45).add(0.55).mul(strength).mul(0.2);
    const rock = sin(time.mul(0.67).add(phase.mul(1.7))).mul(0.06).mul(strength);
    const sway = vec3(TREE_WIND.x.mul(lean).sub(TREE_WIND.y.mul(rock)), 0.0, TREE_WIND.y.mul(lean).add(TREE_WIND.x.mul(rock))).mul(bend);
    // branches bob, the phase flowing smoothly through the crown so joints stay together
    const bob = sin(time.mul(2.1).add(g.x.mul(0.9)).add(g.z.mul(0.7)).add(phase)).mul(0.05).mul(aTree.z).mul(strength);
    // leaves flutter, every card on its own
    const flutter = sin(time.mul(8.0).add(aTree.w.mul(37.0)).add(g.y.mul(2.0))).mul(0.03).mul(isLeaf).mul(aTree.z).mul(strength.add(0.25));
    return p.add(sway).add(vec3(0.0, bob, 0.0)).add(normalLocal.mul(flutter));
  })();

  // Coverage: leaf cards from the atlas; bark is opaque from outside (its back faces are dropped)
  const alpha = mix(float(frontFacing), leaf.a, isLeaf);
  mat.alphaTestNode = float(0.5);
  mat.maskShadowNode = alpha.greaterThan(0.5);

  mat.colorNode = Fn(() => {
    // Leaves: per-tree tint x atlas brightness, a share of sun-yellowed and of cooler leaves, brown twigs & stalks,
    // darker deep in the crown
    const tint = aData.xyz;
    const base = tint.mul(leaf.r.mul(1.4));
    const warm = smoothstep(0.62, 1.0, leaf.g).mul(0.55);
    const cool = smoothstep(0.38, 0.0, leaf.g).mul(0.45);
    const leafCol = mix(mix(base, base.mul(vec3(1.25, 1.08, 0.5)), warm), base.mul(vec3(0.8, 0.92, 1.05)), cool);
    const foliage = mix(leafCol, color(0x4a3b2c), leaf.b).mul(crownAO.mul(0.45).add(0.55));

    // Bark (uv in metres): furrowed grey-brown ridges; the ficus' smooth pale grey, mottled; the palm's grey trunk
    // ringed every ~12 cm, turning to the straw-brown, streaked skirt of dead fronds (aTree.w)
    const bu = uv();
    const n1 = noise2D(vec2(bu.x.mul(5.0), bu.y.mul(1.1)).add(rnd.mul(17.0)));
    const n2 = noise2D(bu.mul(vec2(3.2, 1.9)).add(rnd.mul(31.0)));
    const ridge = float(1.0).sub(abs(n1.sub(0.5).mul(2.0)));
    const furrowed = mix(color(0x2e261f), color(0x5c5043), smoothstep(0.35, 0.9, ridge));
    const ficusBark = mix(color(0x6c675d), color(0x99938a), smoothstep(0.3, 0.75, n2)).mul(mix(float(0.88), float(1.0), ridge));
    const ring = smoothstep(0.82, 0.95, fract(bu.y.div(0.12)));
    const palmTrunk = mix(color(0x7d7468), color(0x5a5249), ring.mul(0.7)).mul(mix(float(0.9), float(1.05), n2));
    const streak = noise2D(vec2(bu.x.mul(14.0), bu.y.mul(0.8)).add(rnd.mul(11.0)));
    const skirt = mix(color(0x5e4a33), color(0x9a7d55), smoothstep(0.25, 0.8, streak));
    const palmBark = mix(palmTrunk, skirt, aTree.w);
    const isFicus = step(species, 0.5);
    const isPalm = step(3.5, species);
    const barkCol = mix(mix(furrowed, ficusBark, isFicus), palmBark, isPalm);
    // cal on the trunk's foot, its top edge ragged where the brush stopped
    const washed = whitewash.mul(step(positionGeometry.y, n1.mul(0.12).add(1.25)));
    const bark = mix(barkCol, color(0xe6e2d6).mul(mix(float(0.9), float(1.0), n2)), washed).mul(crownAO.mul(0.4).add(0.6));

    return vec4(mix(bark, foliage, isLeaf), alpha);
  })();

  mat.roughnessNode = mix(float(0.93), float(0.72).sub(leaf.r.mul(0.1)), isLeaf);

  // Card normals are crown-shell normals on both faces: no back-face flip
  mat.normalNode = normalViewGeometry;

  // Sky light: street-canyon occlusion, deep inside the crown far less
  mat.aoNode = canyonSkyAONode().mul(crownAO.mul(0.75).add(0.25));

  // Light through the leaves: yellow-green, strongest out on the thin shell
  mat.translucencyNode = aData.xyz.mul(vec3(1.0, 1.2, 0.45)).mul(leaf.r.mul(1.5)).mul(crownAO.mul(0.8).add(0.2)).mul(isLeaf);

  return mat;
}
