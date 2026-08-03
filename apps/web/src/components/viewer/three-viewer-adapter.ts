import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { collectModelStats, toMaterials } from "./model-viewer-stats.js";
import type {
  ModelStats,
  ModelViewerAdapter,
  ViewerLightingSettings
} from "./model-viewer-types.js";

type TexturedMaterial = THREE.Material & {
  map?: THREE.Texture | null;
};

export class ThreeViewerAdapter implements ModelViewerAdapter {
  readonly #container: HTMLElement;
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.PerspectiveCamera(35, 1, 0.01, 2_000);
  readonly #renderer: THREE.WebGLRenderer;
  readonly #controls: OrbitControls;
  readonly #grid = new THREE.GridHelper(12, 24, 0x62666d, 0x383b42);
  readonly #ground = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.2 })
  );
  readonly #hemisphere = new THREE.HemisphereLight(0xb9d8ff, 0x66503c, 0.75);
  readonly #keyLight = new THREE.DirectionalLight(0xfff1dd, 2.4);
  readonly #fillLight = new THREE.DirectionalLight(0xb8cbff, 0);
  readonly #rimLight = new THREE.DirectionalLight(0xd9e5ff, 0);
  readonly #clayMaterial = new THREE.MeshStandardMaterial({
    color: 0xc8cbd0,
    roughness: 0.72,
    metalness: 0,
    side: THREE.DoubleSide
  });
  readonly #topologyMaterial = new THREE.MeshBasicMaterial({
    color: 0x20242a,
    wireframe: true,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1
  });
  readonly #resizeObserver: ResizeObserver;
  readonly #pmremGenerator: THREE.PMREMGenerator;
  readonly #studioEnvironment: THREE.WebGLRenderTarget;
  readonly #originalTextures = new Map<THREE.Material, THREE.Texture | null>();
  readonly #originalMeshMaterials = new Map<
    THREE.Mesh,
    THREE.Material | THREE.Material[]
  >();
  #model: THREE.Object3D | null = null;
  #animationFrame = 0;
  #disposed = false;
  #wireframeVisible = false;
  #textureVisible = true;
  #lighting: ViewerLightingSettings = {
    mode: "daylight",
    keyIntensity: 1.35,
    ambientIntensity: 0.4,
    fillIntensity: 0,
    azimuth: 35,
    elevation: 48,
    shadowIntensity: 0.45
  };
  #daylightEnvironment: THREE.WebGLRenderTarget | null = null;
  #environmentTimer: number | null = null;
  #daylightEnvironmentDirection = "";
  #modelCenter = new THREE.Vector3();
  #modelRadius = 1;

  constructor(container: HTMLElement) {
    this.#container = container;
    this.#renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance"
    });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.#renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.#renderer.toneMapping = THREE.NeutralToneMapping;
    this.#renderer.toneMappingExposure = 1;
    this.#renderer.shadowMap.enabled = true;
    this.#renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.#renderer.domElement.setAttribute("aria-label", "3D 模型查看器");
    this.#renderer.domElement.setAttribute("role", "img");
    container.replaceChildren(this.#renderer.domElement);
    this.#pmremGenerator = new THREE.PMREMGenerator(this.#renderer);
    const roomEnvironment = new RoomEnvironment();
    this.#studioEnvironment = this.#pmremGenerator.fromScene(roomEnvironment, 0.04);
    roomEnvironment.dispose();

    this.#scene.background = new THREE.Color(0x18191b);
    this.#scene.environment = this.#studioEnvironment.texture;
    this.#scene.add(
      this.#hemisphere,
      this.#keyLight,
      this.#keyLight.target,
      this.#fillLight,
      this.#fillLight.target,
      this.#rimLight,
      this.#rimLight.target
    );
    this.#keyLight.castShadow = true;
    this.#keyLight.shadow.mapSize.set(2_048, 2_048);

    this.#grid.material.transparent = true;
    this.#grid.material.opacity = 0.35;
    this.#scene.add(this.#grid);

    this.#ground.rotation.x = -Math.PI / 2;
    this.#ground.receiveShadow = true;
    this.#scene.add(this.#ground);

    this.#camera.position.set(2.8, 2, 3.6);
    this.#controls = new OrbitControls(this.#camera, this.#renderer.domElement);
    this.#controls.enableDamping = true;
    this.#controls.dampingFactor = 0.08;
    this.#controls.autoRotateSpeed = 1.5;
    this.#controls.minDistance = 0.05;
    this.#controls.maxDistance = 500;

    this.#resizeObserver = new ResizeObserver(() => this.#resize());
    this.#resizeObserver.observe(container);
    this.#resize();
    this.#render();
  }

  async load(sourceUrl: string, signal: AbortSignal): Promise<ModelStats> {
    this.#removeModel();
    const response = await fetch(sourceUrl, { signal });
    if (!response.ok) throw new Error(`Model download failed: ${response.status}`);
    const data = await response.arrayBuffer();
    signal.throwIfAborted();
    const loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(new URL("draco/", document.baseURI).toString());
    loader.setDRACOLoader(dracoLoader);
    loader.setMeshoptDecoder(MeshoptDecoder);
    const resourcePath = new URL(".", new URL(sourceUrl, window.location.href)).toString();
    const gltf = await loader.parseAsync(data, resourcePath)
      .finally(() => dracoLoader.dispose());
    if (signal.aborted || this.#disposed) {
      disposeObject(gltf.scene);
      signal.throwIfAborted();
      throw new Error("Viewer was disposed.");
    }

    this.#model = gltf.scene;
    this.#model.traverse((object) => {
      if (!isMesh(object)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      this.#originalMeshMaterials.set(object, object.material);
      for (const material of toMaterials(object.material)) {
        const textured = material as TexturedMaterial;
        if ("map" in textured && !this.#originalTextures.has(material)) {
          this.#originalTextures.set(material, textured.map ?? null);
        }
      }
    });
    this.#scene.add(this.#model);
    this.#fitCamera();
    this.#applyMaterialState();
    return collectModelStats(this.#model, gltf.animations.length);
  }

  setAutoRotate(enabled: boolean): void {
    this.#controls.autoRotate = enabled;
  }

  setGridVisible(visible: boolean): void {
    this.#grid.visible = visible;
  }

  setWireframeVisible(visible: boolean): void {
    this.#wireframeVisible = visible;
    this.#applyMaterialState();
  }

  setTextureVisible(visible: boolean): void {
    this.#textureVisible = visible;
    this.#applyMaterialState();
  }

  setLighting(settings: ViewerLightingSettings): void {
    this.#lighting = { ...settings };
    this.#applyLighting();
  }

  setExposure(value: number): void {
    this.#renderer.toneMappingExposure = value;
  }

  setFov(value: number): void {
    this.#camera.fov = Math.max(15, Math.min(80, value));
    this.#camera.updateProjectionMatrix();
  }

  resetCamera(): void {
    this.#fitCamera();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    cancelAnimationFrame(this.#animationFrame);
    this.#resizeObserver.disconnect();
    this.#controls.dispose();
    this.#removeModel();
    this.#grid.geometry.dispose();
    this.#ground.geometry.dispose();
    this.#ground.material.dispose();
    this.#clayMaterial.dispose();
    this.#topologyMaterial.dispose();
    if (this.#environmentTimer !== null) window.clearTimeout(this.#environmentTimer);
    this.#daylightEnvironment?.dispose();
    this.#studioEnvironment.dispose();
    this.#pmremGenerator.dispose();
    this.#renderer.dispose();
    this.#renderer.domElement.remove();
  }

  #applyMaterialState(): void {
    for (const [material, texture] of this.#originalTextures) {
      const textured = material as TexturedMaterial;
      if ("map" in textured) {
        textured.map = this.#textureVisible ? texture : null;
        textured.needsUpdate = true;
      }
    }
    for (const [mesh, original] of this.#originalMeshMaterials) {
      mesh.material = this.#wireframeVisible
        ? Array.isArray(original)
          ? original.map(() => this.#clayMaterial)
          : this.#clayMaterial
        : original;
    }
  }

  #applyLighting(): void {
    const settings = this.#lighting;
    const shadow = Math.max(0, Math.min(1, settings.shadowIntensity));
    this.#keyLight.shadow.intensity = shadow;
    this.#keyLight.castShadow = settings.mode !== "flat" && shadow > 0;
    const groundMaterial = this.#ground.material;
    if (groundMaterial instanceof THREE.ShadowMaterial) {
      groundMaterial.opacity = shadow;
    }

    if (settings.mode === "daylight") {
      this.#hemisphere.color.setHex(0xb9d8ff);
      this.#hemisphere.groundColor.setHex(0x66503c);
      this.#hemisphere.intensity = settings.ambientIntensity * 0.35;
      this.#keyLight.color.setHex(0xfff1dd);
      this.#keyLight.intensity = settings.keyIntensity;
      this.#fillLight.intensity = 0;
      this.#rimLight.intensity = 0;
      this.#scene.environmentIntensity = Math.max(0.1, settings.ambientIntensity);
      this.#scene.environment =
        this.#daylightEnvironment?.texture ?? this.#studioEnvironment.texture;
      this.#scheduleDaylightEnvironment();
    } else if (settings.mode === "studio") {
      this.#hemisphere.color.setHex(0xffffff);
      this.#hemisphere.groundColor.setHex(0x30333a);
      this.#hemisphere.intensity = settings.ambientIntensity;
      this.#keyLight.color.setHex(0xfff6e8);
      this.#keyLight.intensity = settings.keyIntensity;
      this.#fillLight.color.setHex(0xb8cbff);
      this.#fillLight.intensity = settings.fillIntensity;
      this.#rimLight.color.setHex(0xd9e5ff);
      this.#rimLight.intensity = settings.fillIntensity * 0.7;
      this.#scene.environment = this.#studioEnvironment.texture;
      this.#scene.environmentIntensity = 0.65;
    } else {
      this.#hemisphere.color.setHex(0xffffff);
      this.#hemisphere.groundColor.setHex(0x777b82);
      this.#hemisphere.intensity = settings.ambientIntensity;
      this.#keyLight.intensity = 0;
      this.#fillLight.intensity = 0;
      this.#rimLight.intensity = 0;
      this.#scene.environment = this.#studioEnvironment.texture;
      this.#scene.environmentIntensity = 0.35;
    }
    this.#updateLightTransform();
  }

  #updateLightTransform(): void {
    const azimuth = THREE.MathUtils.degToRad(this.#lighting.azimuth);
    const elevation = THREE.MathUtils.degToRad(this.#lighting.elevation);
    const horizontal = Math.cos(elevation);
    const direction = new THREE.Vector3(
      Math.sin(azimuth) * horizontal,
      Math.sin(elevation),
      Math.cos(azimuth) * horizontal
    ).normalize();
    const distance = Math.max(3, this.#modelRadius * 4);
    this.#keyLight.position.copy(this.#modelCenter).addScaledVector(direction, distance);
    this.#keyLight.target.position.copy(this.#modelCenter);
    this.#fillLight.position.copy(this.#modelCenter).addScaledVector(direction, -distance);
    this.#fillLight.position.y += this.#modelRadius;
    this.#fillLight.target.position.copy(this.#modelCenter);
    this.#rimLight.position.copy(this.#modelCenter).add(
      new THREE.Vector3(-direction.z, 0.65, direction.x)
        .normalize()
        .multiplyScalar(distance)
    );
    this.#rimLight.target.position.copy(this.#modelCenter);
    this.#keyLight.target.updateMatrixWorld();
    this.#fillLight.target.updateMatrixWorld();
    this.#rimLight.target.updateMatrixWorld();
  }

  #configureShadowCamera(): void {
    const camera = this.#keyLight.shadow.camera;
    const extent = Math.max(1, this.#modelRadius * 1.3);
    camera.left = -extent;
    camera.right = extent;
    camera.top = extent;
    camera.bottom = -extent;
    camera.near = Math.max(0.01, this.#modelRadius * 0.05);
    camera.far = Math.max(10, this.#modelRadius * 10);
    camera.updateProjectionMatrix();
    this.#keyLight.shadow.bias = -0.0003;
    this.#keyLight.shadow.normalBias = Math.max(0.001, this.#modelRadius * 0.0015);
    this.#keyLight.shadow.needsUpdate = true;
  }

  #scheduleDaylightEnvironment(): void {
    const directionKey = `${this.#lighting.azimuth}:${this.#lighting.elevation}`;
    if (
      this.#daylightEnvironment &&
      this.#daylightEnvironmentDirection === directionKey
    ) {
      this.#scene.environment = this.#daylightEnvironment.texture;
      return;
    }
    if (this.#environmentTimer !== null) window.clearTimeout(this.#environmentTimer);
    this.#environmentTimer = window.setTimeout(() => {
      this.#environmentTimer = null;
      if (this.#disposed || this.#lighting.mode !== "daylight") return;
      const nextDirectionKey =
        `${this.#lighting.azimuth}:${this.#lighting.elevation}`;
      const sky = new Sky();
      sky.scale.setScalar(10_000);
      const azimuth = THREE.MathUtils.degToRad(this.#lighting.azimuth);
      const phi = THREE.MathUtils.degToRad(90 - this.#lighting.elevation);
      const sun = new THREE.Vector3().setFromSphericalCoords(1, phi, azimuth);
      sky.material.uniforms["turbidity"]!.value = 7;
      sky.material.uniforms["rayleigh"]!.value = 2;
      sky.material.uniforms["mieCoefficient"]!.value = 0.005;
      sky.material.uniforms["mieDirectionalG"]!.value = 0.8;
      sky.material.uniforms["sunPosition"]!.value.copy(sun);
      const skyScene = new THREE.Scene();
      skyScene.add(sky);
      const nextEnvironment = this.#pmremGenerator.fromScene(
        skyScene,
        0.02,
        0.1,
        100_000
      );
      sky.geometry.dispose();
      sky.material.dispose();
      this.#daylightEnvironment?.dispose();
      this.#daylightEnvironment = nextEnvironment;
      this.#daylightEnvironmentDirection = nextDirectionKey;
      this.#scene.environment = nextEnvironment.texture;
    }, 120);
  }

  #fitCamera(): void {
    if (!this.#model) return;
    const bounds = new THREE.Box3().setFromObject(this.#model);
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 0.01);
    this.#modelCenter.copy(center);
    this.#modelRadius = radius;
    const distance = radius / (2 * Math.tan(THREE.MathUtils.degToRad(this.#camera.fov / 2)));
    this.#controls.target.copy(center);
    this.#camera.position.copy(center).add(
      new THREE.Vector3(0.75, 0.45, 1).normalize().multiplyScalar(distance * 1.45)
    );
    this.#camera.near = Math.max(distance / 100, 0.001);
    this.#camera.far = Math.max(distance * 100, 100);
    this.#camera.updateProjectionMatrix();
    this.#grid.position.y = bounds.min.y;
    this.#ground.position.y = bounds.min.y - radius * 0.002;
    this.#updateLightTransform();
    this.#configureShadowCamera();
    this.#controls.update();
  }

  #removeModel(): void {
    if (this.#model) {
      for (const [mesh, original] of this.#originalMeshMaterials) {
        mesh.material = original;
      }
      this.#scene.remove(this.#model);
      disposeObject(this.#model);
      this.#model = null;
    }
    this.#originalTextures.clear();
    this.#originalMeshMaterials.clear();
  }

  #resize(): void {
    const width = Math.max(1, this.#container.clientWidth);
    const height = Math.max(1, this.#container.clientHeight);
    this.#camera.aspect = width / height;
    this.#camera.updateProjectionMatrix();
    this.#renderer.setSize(width, height, false);
  }

  #render = (): void => {
    if (this.#disposed) return;
    this.#controls.update();
    this.#renderer.render(this.#scene, this.#camera);
    if (this.#wireframeVisible && this.#model) {
      const groundVisible = this.#ground.visible;
      const gridVisible = this.#grid.visible;
      const background = this.#scene.background;
      this.#ground.visible = false;
      this.#grid.visible = false;
      this.#scene.background = null;
      this.#scene.overrideMaterial = this.#topologyMaterial;
      this.#renderer.autoClear = false;
      this.#renderer.render(this.#scene, this.#camera);
      this.#renderer.autoClear = true;
      this.#scene.overrideMaterial = null;
      this.#scene.background = background;
      this.#ground.visible = groundVisible;
      this.#grid.visible = gridVisible;
    }
    this.#animationFrame = requestAnimationFrame(this.#render);
  };
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return "isMesh" in object && object.isMesh === true;
}

function disposeObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!isMesh(object)) return;
    geometries.add(object.geometry);
    for (const material of toMaterials(object.material)) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture) value.dispose();
    }
    material.dispose();
  }
}
