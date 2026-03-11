import React, { useEffect, useRef } from "react";

/**
 * PS5Swarm Engine v4.2 (Precision Optimized)
 * - Restored sub-pixel rendering to fix "stepping" jitter.
 * - Retained Filter State Batching for performance.
 * - Optimized local variable caching to minimize object lookups.
 */

const parseRGBA = (rgba) => {
  const match = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return match
    ? [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])]
    : [255, 255, 255];
};

export const PS5Swarm = ({
  bursts = [],
  opacity: cOpacity = 1,
  particleCount = 950,
  color1 = [6, 182, 212],
  color2 = [16, 185, 129],
  colorVariance = 1.0,
  blendMode = "lighter",
  baseSize = 1.3,
  nearMultiplier = 0.04,
  focusMultiplier = 0.53,
  farMultiplier = 0.53,
  bokehIntensity = 1.4,
  aberrationIntensity = 0.01,
  hueShiftAmount = 30,
  gaussianBlur = 2.0,
  blurVariance = 1.0,
  spreadMultiplier = 3.0,
  timeScale = 1.0,
  cameraWobble = 1.0,
  particleSpeed = 0.3,
  tumbleSpeed = 0.4,
  sizeVariance = 1.5,
  orbitVariance = 1.0,
  tumbleVariance = 1.0,
  cohesion = 0.0,
  cohesionRadius = 250,
  turbulence = 0.0,
  swarmBreathing = 0.0,
  windY = 0.0,
  className = "",
}) => {
  // Standardize colors
  const c1 = typeof color1 === "string" ? parseRGBA(color1) : color1;
  const c2 = typeof color2 === "string" ? parseRGBA(color2) : color2;

  const canvasRef = useRef(null);
  const cfg = useRef({
    bursts,
    color1: c1,
    color2: c2,
    colorVariance,
    blendMode,
    baseSize,
    cameraWobble,
    particleSpeed,
    tumbleSpeed,
    timeScale,
    nearMultiplier,
    focusMultiplier,
    farMultiplier,
    bokehIntensity,
    aberrationIntensity,
    hueShiftAmount,
    gaussianBlur,
    blurVariance,
    spreadMultiplier,
    sizeVariance,
    orbitVariance,
    tumbleVariance,
    cohesion,
    cohesionRadius,
    turbulence,
    swarmBreathing,
    windY,
  });

  useEffect(() => {
    cfg.current = {
      bursts,
      color1: c1,
      color2: c2,
      colorVariance,
      blendMode,
      baseSize,
      cameraWobble,
      particleSpeed,
      tumbleSpeed,
      timeScale,
      nearMultiplier,
      focusMultiplier,
      farMultiplier,
      bokehIntensity,
      aberrationIntensity,
      hueShiftAmount,
      gaussianBlur,
      blurVariance,
      spreadMultiplier,
      sizeVariance,
      orbitVariance,
      tumbleVariance,
      cohesion,
      cohesionRadius,
      turbulence,
      swarmBreathing,
      windY,
    };
  }, [
    bursts,
    color1,
    color2,
    colorVariance,
    blendMode,
    baseSize,
    cameraWobble,
    particleSpeed,
    tumbleSpeed,
    timeScale,
    nearMultiplier,
    focusMultiplier,
    farMultiplier,
    bokehIntensity,
    aberrationIntensity,
    hueShiftAmount,
    gaussianBlur,
    blurVariance,
    spreadMultiplier,
    sizeVariance,
    orbitVariance,
    tumbleVariance,
    cohesion,
    cohesionRadius,
    turbulence,
    swarmBreathing,
    windY,
  ]);

  const rgbToHsl = (r, g, b) => {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b);
    let h,
      s,
      l = (max + min) / 2;
    if (max === min) h = s = 0;
    else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r:
          h = (g - b) / d + (g < b ? 6 : 0);
          break;
        case g:
          h = (b - r) / d + 2;
          break;
        case b:
          h = (r - g) / d + 4;
          break;
      }
      h /= 6;
    }
    return [h * 360, s * 100, l * 100];
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { alpha: true });
    let animationFrameId;

    let width, height, cx, cy;
    const resize = () => {
      const parent = canvas.parentElement;
      width = parent.clientWidth;
      height = parent.clientHeight;
      canvas.width = width;
      canvas.height = height;
      cx = width / 2;
      cy = height / 2;
    };
    window.addEventListener("resize", resize);
    resize();

    const CAMERA_Z = 800;
    const FOV = 600;
    const TWO_PI = Math.PI * 2;

    let particles = Array.from({ length: particleCount }, () => ({
      id: Math.random() * 10000,
      origRadius: 100 + Math.random() * 800,
      theta: Math.random() * TWO_PI,
      origY: (Math.random() - 0.5) * 600,
      rndSize: Math.random(),
      rndColor: Math.random(),
      rndBlur: Math.random(),
      rndOrbit: (Math.random() - 0.5) * 2,
      orbitDir: Math.random() > 0.5 ? 1 : -1,
      rotX: Math.random() * TWO_PI,
      rotY: Math.random() * TWO_PI,
      rotZ: Math.random() * TWO_PI,
      rndTumbleX: Math.random() - 0.5,
      rndTumbleY: Math.random() - 0.5,
      rndTumbleZ: Math.random() - 0.5,
      projectedZ: 0,
      roundedBlur: 0,
    }));

    let globalCameraTime = 0;
    let globalParticleTime = 0;
    let globalWindY = 0;

    const render = () => {
      ctx.clearRect(0, 0, width, height);
      const c = cfg.current;

      // 1. Time & Wind Updates
      globalParticleTime += 0.001 * c.timeScale;
      globalWindY = (globalWindY + c.windY * c.timeScale) % 2000;

      for (let i = 0; i < particleCount; i++) {
        const p = particles[i];

        // 2. Motion Logic
        p.theta +=
          (0.001 + p.rndOrbit * 0.001 * c.orbitVariance) *
          p.orbitDir *
          c.particleSpeed *
          c.timeScale;
        p.rotX +=
          p.rndTumbleX * 0.05 * c.tumbleSpeed * c.tumbleVariance * c.timeScale;
        p.rotY +=
          p.rndTumbleY * 0.05 * c.tumbleSpeed * c.tumbleVariance * c.timeScale;
        p.rotZ +=
          p.rndTumbleZ * 0.05 * c.tumbleSpeed * c.tumbleVariance * c.timeScale;

        // 3. Vertical Position & Cohesion
        let rawY = p.origY + globalWindY;
        if (rawY > 1000) rawY -= 2000;
        else if (rawY < -1000) rawY += 2000;

        const cohesionBlend = Math.min(1, c.cohesion / 5.0);
        const activeRadius =
          p.origRadius + (c.cohesionRadius - p.origRadius) * cohesionBlend;
        const finalRadius =
          activeRadius +
          (c.turbulence > 0
            ? Math.sin(globalParticleTime * 100 + p.id) * c.turbulence * 10
            : 0);

        // 4. Direct 3D -> 2D Projection (No Camera Rotation)
        let x = Math.cos(p.theta) * finalRadius * c.spreadMultiplier;
        let z = Math.sin(p.theta) * finalRadius * c.spreadMultiplier;
        let y = rawY * (1 - cohesionBlend) * c.spreadMultiplier;

        const scale = FOV / (FOV + z + CAMERA_Z);
        p.scale = z < -CAMERA_Z ? 0 : scale;
        p.screenX = x * scale + cx;
        p.screenY = y * scale + cy;
        p.projectedZ = z;

        // 5. Blur Pre-calculation
        const distFromFocus = Math.abs(z);
        const blurVal = (c.gaussianBlur + (distFromFocus / 400) * 4.0) * scale;
        p.roundedBlur = Math.round(blurVal * 2) / 2; // Step by 0.5 for batching
        p.distFromFocus = distFromFocus;
      }

      // 6. Depth Sort
      particles.sort((a, b) => b.projectedZ - a.projectedZ);

      ctx.globalCompositeOperation = c.blendMode;
      let currentFilterBlur = -1;

      // 7. Drawing Loop
      for (let i = 0; i < particleCount; i++) {
        const p = particles[i];
        if (p.scale <= 0) continue;

        // Filter Batching
        if (p.roundedBlur !== currentFilterBlur) {
          ctx.filter =
            p.roundedBlur > 0.4 ? `blur(${p.roundedBlur}px)` : "none";
          currentFilterBlur = p.roundedBlur;
        }

        // Size & Alpha Calculations
        const bokehFactor = Math.min(
          2,
          (p.distFromFocus / 600) * c.bokehIntensity,
        );
        const visualSize =
          (1.5 + p.rndSize * 3 * c.sizeVariance) *
          p.scale *
          c.baseSize *
          (p.projectedZ < 0
            ? c.nearMultiplier +
              (c.focusMultiplier - c.nearMultiplier) *
                Math.max(0, Math.min(1, (p.projectedZ + CAMERA_Z) / CAMERA_Z))
            : c.focusMultiplier +
              (c.farMultiplier - c.focusMultiplier) *
                Math.max(0, Math.min(1, p.projectedZ / CAMERA_Z)));

        const finalVisualSize = visualSize + bokehFactor * visualSize * 4;
        const radiusX = Math.max(
          0.1,
          finalVisualSize * Math.abs(Math.cos(p.rotY)),
        );
        const radiusY = Math.max(
          0.1,
          finalVisualSize * Math.abs(Math.cos(p.rotX)),
        );

        // Color Logic
        const mix = Math.max(
          0,
          Math.min(1, 0.5 + (p.rndColor - 0.5) * c.colorVariance),
        );
        const r = (c.color1[0] + (c.color2[0] - c.color1[0]) * mix) | 0;
        const g = (c.color1[1] + (c.color2[1] - c.color1[1]) * mix) | 0;
        const b = (c.color1[2] + (c.color2[2] - c.color1[2]) * mix) | 0;
        const baseAlpha = Math.max(
          0.05,
          Math.min(
            1,
            (0.4 + Math.pow(Math.abs(Math.cos(p.rotX)), 4) * 0.6) *
              (1 - p.distFromFocus / 1800),
          ),
        );

        // Chromatic Aberration & Rendering
        if (c.aberrationIntensity > 0 && bokehFactor > 0.1) {
          const [h, s, l] = rgbToHsl(r, g, b);
          const caOffset = Math.min(
            30,
            bokehFactor * finalVisualSize * c.aberrationIntensity * 15,
          );

          ctx.fillStyle = `hsla(${h + c.hueShiftAmount}, ${s}%, ${l}%, ${baseAlpha * 0.7})`;
          ctx.beginPath();
          ctx.ellipse(
            p.screenX - caOffset,
            p.screenY,
            radiusX,
            radiusY,
            p.rotZ,
            0,
            TWO_PI,
          );
          ctx.fill();

          ctx.fillStyle = `hsla(${h - c.hueShiftAmount}, ${s}%, ${l}%, ${baseAlpha * 0.7})`;
          ctx.beginPath();
          ctx.ellipse(
            p.screenX + caOffset,
            p.screenY,
            radiusX,
            radiusY,
            p.rotZ,
            0,
            TWO_PI,
          );
          ctx.fill();

          ctx.fillStyle = `hsla(${h}, ${s}%, ${l + 10}%, ${baseAlpha})`;
        } else {
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${baseAlpha})`;
        }

        ctx.beginPath();
        ctx.ellipse(p.screenX, p.screenY, radiusX, radiusY, p.rotZ, 0, TWO_PI);
        ctx.fill();
      }

      ctx.filter = "none";
      animationFrameId = requestAnimationFrame(render);
    };
    render();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, [particleCount]);

  return (
    <div
      className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}
    >
      <canvas
        ref={canvasRef}
        style={{ opacity: cOpacity }}
        className="absolute inset-0"
      />
    </div>
  );
};

export default PS5Swarm;
