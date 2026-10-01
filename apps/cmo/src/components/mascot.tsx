"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

/** How far the mascot turns toward the pointer, in radians. */
const MAX_TURN = { x: 0.18, y: 0.55 };

/**
 * Loads three.js and the mascot model, then renders it into `container`.
 * The mascot turns toward the pointer and bobs gently, unless the visitor
 * prefers reduced motion. Returns a cleanup that frees the GPU resources.
 */
async function mountMascot(
  container: HTMLElement,
  onReady: () => void,
): Promise<() => void> {
  const THREE = await import("three");
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const { RoomEnvironment } = await import(
    "three/addons/environments/RoomEnvironment.js"
  );

  // Load first: a failed download then leaves no renderer behind.
  const gltf = await new GLTFLoader().loadAsync("/mascot.glb");
  const model = gltf.scene;
  const box = new THREE.Box3().setFromObject(model);
  model.position.sub(box.getCenter(new THREE.Vector3()));
  const pivot = new THREE.Group();
  pivot.add(model);

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;

  const scene = new THREE.Scene();
  scene.add(pivot);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04);
  pmrem.dispose();
  scene.environment = environment.texture;
  scene.environmentIntensity = 1.2;
  const keyLight = new THREE.DirectionalLight(0xffffff, 2);
  keyLight.position.set(1.5, 2, 3);
  scene.add(keyLight);

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 20);
  camera.position.set(0, 0, 5);

  function resize() {
    const { clientWidth: width, clientHeight: height } = container;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();
  container.appendChild(renderer.domElement);

  const target = { x: 0, y: 0 };
  function handlePointerMove(event: PointerEvent) {
    const rect = container.getBoundingClientRect();
    const x =
      (event.clientX - (rect.left + rect.width / 2)) / window.innerWidth;
    const y =
      (event.clientY - (rect.top + rect.height / 2)) / window.innerHeight;
    target.y = Math.max(-1, Math.min(1, x * 2)) * MAX_TURN.y;
    target.x = Math.max(-1, Math.min(1, y * 2)) * MAX_TURN.x;
  }

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const clock = new THREE.Clock();
  function render() {
    if (reducedMotion.matches) {
      pivot.rotation.set(0, 0, 0);
      pivot.position.y = 0;
    } else {
      const time = clock.getElapsedTime();
      pivot.rotation.y += (target.y - pivot.rotation.y) * 0.06;
      pivot.rotation.x += (target.x - pivot.rotation.x) * 0.06;
      pivot.rotation.z = Math.sin(time * 0.9) * 0.03;
      pivot.position.y = Math.sin(time * 1.6) * 0.04;
    }
    renderer.render(scene, camera);
  }

  window.addEventListener("pointermove", handlePointerMove);
  renderer.setAnimationLoop(render);
  onReady();

  return () => {
    renderer.setAnimationLoop(null);
    window.removeEventListener("pointermove", handlePointerMove);
    resizeObserver.disconnect();
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const material: InstanceType<typeof THREE.Material> = object.material;
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    });
    environment.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}

interface MascotProps {
  className?: string;
}

/**
 * The CMO.XYZ mascot. The still image shows at once and stays if WebGL is
 * missing; the 3D model fades in over it once loaded.
 */
export function Mascot({ className }: MascotProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    mountMascot(stage, () => {
      if (!cancelled) setReady(true);
    })
      .then((dispose) => {
        if (cancelled) dispose();
        else cleanup = dispose;
      })
      // No WebGL or a failed download: the still image stays.
      .catch(() => {});
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return (
    <div
      className={["mascot", className].filter(Boolean).join(" ")}
      data-ready={ready}
    >
      <Image
        className="mascot-still"
        src="/mascot.webp"
        alt=""
        width={800}
        height={800}
        sizes="(min-width: 900px) 480px, 280px"
        preload
      />
      <div className="mascot-stage" ref={stageRef} aria-hidden="true" />
    </div>
  );
}
