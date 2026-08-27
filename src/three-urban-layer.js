import * as THREE from 'three';

export const SYNTHETIC_INDUSTRIAL_LAYER_ID = 'synthetic-industrial-infill';

const PALETTE = Object.freeze({
  warehouse: 0x66717c,
  'factory-hall': 0x586773,
  'office-block': 0x687985,
  'tank-or-silo': 0x78828a
});

function geometryFor(archetype) {
  if (archetype === 'tank-or-silo') {
    const geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
    geometry.rotateX(Math.PI / 2);
    return geometry;
  }
  return new THREE.BoxGeometry(1, 1, 1);
}

export function createThreeUrbanLayer({
  maplibregl,
  placements,
  origin,
  reducedMotion = false,
  onDiagnostics = () => {}
}) {
  let map;
  let camera;
  let scene;
  let renderer;
  let enabled = false;
  let opacity = 0;
  let transition = null;
  let meshes = [];
  const mercatorOrigin = maplibregl.MercatorCoordinate.fromLngLat(origin, 0);
  const mercatorScale = mercatorOrigin.meterInMercatorCoordinateUnits();

  function applyOpacity(value) {
    opacity = value;
    meshes.forEach((mesh) => {
      mesh.material.opacity = value;
      mesh.visible = value > 0.001;
    });
  }

  function setEnabled(nextEnabled, { immediate = false } = {}) {
    enabled = Boolean(nextEnabled);
    if (!renderer) return;
    const target = enabled ? 0.82 : 0;
    if (immediate || reducedMotion) {
      transition = null;
      applyOpacity(target);
      map.triggerRepaint();
      return;
    }
    transition = { from: opacity, to: target, startedAt: performance.now(), durationMs: 900, frameCount: 0 };
    map.triggerRepaint();
  }

  return {
    id: SYNTHETIC_INDUSTRIAL_LAYER_ID,
    type: 'custom',
    renderingMode: '3d',

    onAdd(mapInstance, gl) {
      map = mapInstance;
      camera = new THREE.Camera();
      scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xb8c8d2, 0x202832, 1.45));
      const directional = new THREE.DirectionalLight(0xe6eef2, 1.1);
      directional.position.set(-0.4, -0.7, 1);
      scene.add(directional);

      const byArchetype = placements.reduce((groups, placement) => {
          const group = groups.get(placement.archetype) ?? [];
          group.push(placement);
          groups.set(placement.archetype, group);
          return groups;
        }, new Map());
      const matrix = new THREE.Matrix4();
      const quaternion = new THREE.Quaternion();
      const position = new THREE.Vector3();
      const scale = new THREE.Vector3();
      const zAxis = new THREE.Vector3(0, 0, 1);

      byArchetype.forEach((instances, archetype) => {
        const geometry = geometryFor(archetype);
        const material = new THREE.MeshLambertMaterial({
          color: PALETTE[archetype] ?? PALETTE.warehouse,
          transparent: true,
          opacity: 0,
          depthWrite: true
        });
        const mesh = new THREE.InstancedMesh(geometry, material, instances.length);
        mesh.frustumCulled = false;
        instances.forEach((placement, index) => {
          position.set(placement.xM, placement.yM, placement.heightM / 2);
          quaternion.setFromAxisAngle(zAxis, placement.rotation);
          scale.set(placement.lengthM, placement.widthM, placement.heightM);
          matrix.compose(position, quaternion, scale);
          mesh.setMatrixAt(index, matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.visible = false;
        scene.add(mesh);
        meshes.push(mesh);
      });

      renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl,
        antialias: true,
        powerPreference: 'high-performance'
      });
      renderer.autoClear = false;
      onDiagnostics({ drawGroups: meshes.length });
      setEnabled(enabled, { immediate: true });
    },

    render(gl, args) {
      const now = performance.now();
      if (transition) {
        transition.frameCount += 1;
        const progress = Math.min(1, (now - transition.startedAt) / transition.durationMs);
        const eased = 1 - ((1 - progress) ** 3);
        applyOpacity(transition.from + (transition.to - transition.from) * eased);
        if (progress >= 1) {
          const observedFps = Math.round(transition.frameCount / ((now - transition.startedAt) / 1_000));
          transition = null;
          onDiagnostics({ observedFps });
        } else map.triggerRepaint();
      }
      if (opacity <= 0.001) return;

      const mainMatrix = args?.defaultProjectionData?.mainMatrix ?? args?.modelViewProjectionMatrix;
      const localTransform = new THREE.Matrix4()
        .makeTranslation(mercatorOrigin.x, mercatorOrigin.y, mercatorOrigin.z)
        .scale(new THREE.Vector3(mercatorScale, -mercatorScale, mercatorScale));
      camera.projectionMatrix = new THREE.Matrix4().fromArray(mainMatrix).multiply(localTransform);
      renderer.resetState();
      renderer.render(scene, camera);

      onDiagnostics({ drawGroups: renderer.info.render.calls });
    },

    onRemove() {
      meshes.forEach((mesh) => {
        scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
      });
      meshes = [];
      renderer?.dispose();
      renderer = null;
      scene = null;
      camera = null;
      map = null;
    },

    setEnabled,
    isEnabled: () => enabled
  };
}
