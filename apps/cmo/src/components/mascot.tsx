"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { Texture, WebGLRenderTarget } from "three";

/** How far the mascot turns toward the pointer, in radians. */
const MAX_TURN = { x: 0.18, y: 0.55 };

/**
 * Loads three.js and the mascot model, then renders it into `container`.
 * The mascot turns toward the pointer and bobs gently, unless the visitor
 * prefers reduced motion. Returns a cleanup that frees the GPU resources.
 */
async function mountMascot(
  container: HTMLElement,
  onReady: (ready: boolean) => void,
  signal: AbortSignal,
  isPaused: () => boolean,
): Promise<() => void> {
  const THREE = await import("three");
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const { RoomEnvironment } = await import(
    "three/addons/environments/RoomEnvironment.js"
  );
  if (signal.aborted) return () => {};

  const gltf = await new GLTFLoader().loadAsync("/mascot.glb");
  const model = gltf.scene;
  let renderer: InstanceType<typeof THREE.WebGLRenderer> | undefined;
  let environment: WebGLRenderTarget<Texture> | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let disposed = false;
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

  function dispose() {
    if (disposed) return;
    disposed = true;
    renderer?.setAnimationLoop(null);
    window.removeEventListener("pointermove", handlePointerMove);
    renderer?.domElement.removeEventListener("webglcontextlost", handleFailure);
    resizeObserver?.disconnect();
    const textures = new Set<InstanceType<typeof THREE.Texture>>();
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials) {
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) textures.add(value);
        }
        material.dispose();
      }
    });
    for (const texture of textures) {
      texture.dispose();
      if (
        typeof ImageBitmap !== "undefined" &&
        texture.image instanceof ImageBitmap
      ) {
        texture.image.close();
      }
    }
    environment?.dispose();
    renderer?.dispose();
    renderer?.forceContextLoss();
    renderer?.domElement.remove();
  }

  function handleFailure() {
    onReady(false);
    dispose();
  }

  if (signal.aborted) {
    dispose();
    return dispose;
  }

  try {
    const box = new THREE.Box3().setFromObject(model);
    model.position.sub(box.getCenter(new THREE.Vector3()));
    const pivot = new THREE.Group();
    pivot.add(model);

    const activeRenderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
    });
    renderer = activeRenderer;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.domElement.addEventListener("webglcontextlost", handleFailure);

    const scene = new THREE.Scene();
    scene.add(pivot);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    try {
      environment = pmrem.fromScene(room, 0.04);
    } finally {
      room.dispose();
      pmrem.dispose();
    }
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
      activeRenderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();
    container.appendChild(renderer.domElement);

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const startTime = performance.now();
    function render() {
      if (disposed) return;
      if (reducedMotion.matches || isPaused()) {
        pivot.rotation.set(0, 0, 0);
        pivot.position.y = 0;
      } else {
        const time = (performance.now() - startTime) / 1000;
        pivot.rotation.y += (target.y - pivot.rotation.y) * 0.06;
        pivot.rotation.x += (target.x - pivot.rotation.x) * 0.06;
        pivot.rotation.z = Math.sin(time * 0.9) * 0.03;
        pivot.position.y = Math.sin(time * 1.6) * 0.04;
      }
      try {
        activeRenderer.render(scene, camera);
      } catch {
        handleFailure();
      }
    }

    // Only replace the still after a frame renders successfully.
    render();
    if (!disposed) {
      window.addEventListener("pointermove", handlePointerMove);
      renderer.setAnimationLoop(render);
      onReady(true);
    }
    return dispose;
  } catch (error) {
    dispose();
    throw error;
  }
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
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let cleanup: (() => void) | undefined;
    const controller = new AbortController();
    mountMascot(
      stage,
      (nextReady) => {
        if (!controller.signal.aborted) setReady(nextReady);
      },
      controller.signal,
      () => pausedRef.current,
    )
      .then((dispose) => {
        if (controller.signal.aborted) dispose();
        else cleanup = dispose;
      })
      // No WebGL or a failed download: the still image stays.
      .catch(() => {
        if (!controller.signal.aborted) setReady(false);
      });
    return () => {
      controller.abort();
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
      {ready && (
        <button
          className="button button-secondary mascot-motion"
          type="button"
          onClick={() => {
            pausedRef.current = !pausedRef.current;
            setPaused(pausedRef.current);
          }}
        >
          {paused ? "Resume animation" : "Pause animation"}
        </button>
      )}
    </div>
  );
}
