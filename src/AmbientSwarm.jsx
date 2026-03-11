import React, { useEffect, useRef, useState } from "react";

/**
 * PS5Swarm Engine v4
 * - Restored size-based Bokeh expansion.
 * - Added optimized Gaussian Filter stack.
 * - Optimized state-batching for ctx.filter to prevent lag.
 * - Corrected depth-blur logic to respect 0-values.
 */
const parseRGBA = (rgba) => {
  const match = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return match
    ? [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])]
    : [255, 255, 255];
};
function evalLensCurve(z, lens) {
  const { near, focus, far, strength = 1, variance = 0, rnd = 0 } = lens;

  let depthValue;

  if (z < 0) {
    const t = Math.max(0, Math.min(1, (z + 800) / 800));
    depthValue = near + (focus - near) * t;
  } else {
    const t = Math.max(0, Math.min(1, z / 800));
    depthValue = focus + (far - focus) * t;
  }

  return depthValue * strength + rnd * variance;
}
export const PS5Swarm = ({
  bursts = [],
  opacity: cOpacity = 1,
  particleCount = 950,
  color1 = [6, 182, 212],
  color2 = [16, 185, 129],
  colorVariance = 1.0,
  blendMode = "lighter",
  baseSize = 1.3,

  // Lens & Depth
  nearMultiplier = 0.04,
  focusMultiplier = 0.53,
  farMultiplier = 0.53,

  // Old Bokeh (Size expansion)
  bokehIntensity = 1.4,

  // Chromatic Aberration (Hue-based)
  aberrationIntensity = 0.01,
  hueShiftAmount = 30,

  // Gaussian Blur (Filter-based)
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
  if (typeof color1 === "string") {
    color1 = parseRGBA(color1);
    color2 = parseRGBA(color2);
  }
  const canvasRef = useRef(null);
  const cfg = useRef({
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
  });

  useEffect(() => {
    cfg.current = {
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

    const Z_FOCAL_PLANE = 0;
    const CAMERA_Z = 800;
    const FOV = 600;

    let particles = [];
    const initParticles = () => {
      particles = [];
      for (let i = 0; i < particleCount; i++) {
        particles.push({
          id: Math.random() * 10000,
          origRadius: 100 + Math.random() * 800,
          theta: Math.random() * Math.PI * 2,
          origY: (Math.random() - 0.5) * 600,
          rndSize: Math.random(),
          rndColor: Math.random(),
          rndBlur: Math.random(),
          rndOrbit: (Math.random() - 0.5) * 2,
          orbitDir: Math.random() > 0.5 ? 1 : -1,
          rotX: Math.random() * Math.PI * 2,
          rotY: Math.random() * Math.PI * 2,
          rotZ: Math.random() * Math.PI * 2,
          rndTumbleX: Math.random() - 0.5,
          rndTumbleY: Math.random() - 0.5,
          rndTumbleZ: Math.random() - 0.5,
        });
      }
    };
    initParticles();

    let globalCameraTime = 0;
    let globalParticleTime = 0;
    let globalWindY = 0;

    const render = () => {
      ctx.clearRect(0, 0, width, height);
      const c = cfg.current;

      globalCameraTime += 0.001;
      globalParticleTime += 0.001 * c.timeScale;
      globalWindY += c.windY * c.timeScale;
      globalWindY %= 2000;

      const tiltX = Math.sin(globalCameraTime * 0.5) * 0.1 * c.cameraWobble;
      const tiltZ = Math.cos(globalCameraTime * 0.3) * 0.08 * c.cameraWobble;

      for (let i = 0; i < particleCount; i++) {
        const p = particles[i];
        const orbitSpeed =
          (0.001 + p.rndOrbit * 0.001 * c.orbitVariance) * p.orbitDir;
        p.theta += orbitSpeed * c.particleSpeed * c.timeScale;

        p.rotX +=
          p.rndTumbleX * 0.05 * c.tumbleSpeed * c.tumbleVariance * c.timeScale;
        p.rotY +=
          p.rndTumbleY * 0.05 * c.tumbleSpeed * c.tumbleVariance * c.timeScale;
        p.rotZ +=
          p.rndTumbleZ * 0.05 * c.tumbleSpeed * c.tumbleVariance * c.timeScale;

        let rawY = p.origY + globalWindY;
        if (rawY > 1000) rawY -= 2000;
        else if (rawY < -1000) rawY += 2000;

        const cohesionBlend = Math.min(1, c.cohesion / 5.0);
        const activeRadius =
          p.origRadius + (c.cohesionRadius - p.origRadius) * cohesionBlend;
        const activeY = rawY + (0 - rawY) * cohesionBlend;

        const finalRadius = Math.max(
          10,
          activeRadius +
            (c.turbulence > 0
              ? Math.sin(globalParticleTime * 100 + p.id) * c.turbulence * 10
              : 0) +
            (c.swarmBreathing > 0
              ? Math.sin(globalParticleTime * 2 + p.id * 0.01) *
                c.swarmBreathing *
                50
              : 0),
        );
        const finalY =
          activeY +
          (c.turbulence > 0
            ? Math.cos(globalParticleTime * 110 + p.id) * c.turbulence * 10
            : 0);

        let x = Math.cos(p.theta) * finalRadius * c.spreadMultiplier;
        let z = Math.sin(p.theta) * finalRadius * c.spreadMultiplier;
        let y = finalY * c.spreadMultiplier;

        let ty = y * Math.cos(tiltX) - z * Math.sin(tiltX);
        let tz = y * Math.sin(tiltX) + z * Math.cos(tiltX);
        let tx = x * Math.cos(tiltZ) - ty * Math.sin(tiltZ);
        ty = x * Math.sin(tiltZ) + ty * Math.cos(tiltZ);

        const scale = FOV / (FOV + tz + CAMERA_Z);
        if (tz < -CAMERA_Z) {
          p.scale = 0;
          continue;
        }

        p.screenX = tx * scale + cx;
        p.screenY = ty * scale + cy;
        p.scale = scale;
        p.projectedZ = tz;
      }

      particles.sort((a, b) => b.projectedZ - a.projectedZ);

      ctx.globalCompositeOperation = c.blendMode;

      // PERFORMANCE CACHE: Keep track of current blur filter to avoid excessive state changes
      let currentFilterBlur = -1;

      for (let i = 0; i < particleCount; i++) {
        const p = particles[i];
        if (p.scale === 0) continue;

        let depthSizeMult = 1.0;
        if (p.projectedZ < Z_FOCAL_PLANE) {
          const t = Math.max(
            0,
            Math.min(1, (p.projectedZ + CAMERA_Z) / CAMERA_Z),
          );
          depthSizeMult =
            c.nearMultiplier + (c.focusMultiplier - c.nearMultiplier) * t;
        } else {
          const t = Math.max(0, Math.min(1, p.projectedZ / CAMERA_Z));
          depthSizeMult =
            c.focusMultiplier + (c.farMultiplier - c.focusMultiplier) * t;
        }

        const distFromFocus = Math.abs(p.projectedZ - Z_FOCAL_PLANE);

        // 1. OLD BOKEH (Physical Expansion)
        const bokehFactor = Math.min(
          2,
          (distFromFocus / 600) * c.bokehIntensity,
        );
        const individualSize = 1.5 + p.rndSize * 3 * c.sizeVariance;
        const baseProjectedSize =
          individualSize * p.scale * c.baseSize * depthSizeMult;
        const visualSize =
          baseProjectedSize + bokehFactor * baseProjectedSize * 4;

        // 2. GAUSSIAN BLUR (Native Filter - Optimized Batching)
        // If softness/variance are 0, depth blur only kicks in if gaussianBlur > 0
        const isBlurEnabled = c.gaussianBlur > 0 || c.blurVariance > 0;
        const gBlurBase = c.gaussianBlur + p.rndBlur * c.blurVariance * 2;
        const gBlurDepth = isBlurEnabled ? (distFromFocus / 400) * 4.0 : 0;
        const isAffectedByBlur = p.rndBlur <= c.blurVariance;
        let totalGBlur = 0;

        if (isAffectedByBlur) {
          const gBlurBase = c.gaussianBlur;
          // Depth blur still scales with distance from the focal plane if the particle is blurred
          const gBlurDepth = (distFromFocus / 400) * 4.0;
          totalGBlur = (gBlurBase + gBlurDepth) * p.scale;
        }

        // PERFORMANCE CACHE: Round to nearest 0.5px to reduce state changes
        const roundedBlur = Math.round(totalGBlur * 2) / 2;
        if (roundedBlur !== currentFilterBlur) {
          ctx.filter = roundedBlur > 0.4 ? `blur(${roundedBlur}px)` : "none";
          currentFilterBlur = roundedBlur;
        }

        const isFacingCamera = Math.abs(Math.cos(p.rotX) * Math.cos(p.rotY));
        const glintIntensity = Math.pow(isFacingCamera, 4);
        const baseAlpha = Math.max(
          0.05,
          Math.min(
            1,
            (0.4 + glintIntensity * 0.6) * (1 - distFromFocus / 1800),
          ),
        );

        // Min thickness floor (0.15) for smooth rotation
        const radiusX = Math.max(0.15, visualSize * Math.abs(Math.cos(p.rotY)));
        const radiusY = Math.max(0.15, visualSize * Math.abs(Math.cos(p.rotX)));

        const mixFactor = 0.5 + (p.rndColor - 0.5) * c.colorVariance;
        const clampedMix = Math.max(0, Math.min(1, mixFactor));

        const r = Math.round(
          c.color1[0] + (c.color2[0] - c.color1[0]) * clampedMix,
        );
        const g = Math.round(
          c.color1[1] + (c.color2[1] - c.color1[1]) * clampedMix,
        );
        const b = Math.round(
          c.color1[2] + (c.color2[2] - c.color1[2]) * clampedMix,
        );

        // 3. PERCEPTUAL HUE-SHIFT CA (Optimized)

        // 2. PULSE LOGIC (Move this BEFORE the fillStyle assignments)
        let pulseWhiteFactor = 0;
        if (c.bursts && c.bursts.length > 0) {
          const now = Date.now();
          const maxRadius = Math.max(width, height) * 1.2;
          const ringWidth = 250;

          c.bursts.forEach((burstTime) => {
            const age = now - burstTime;
            if (age > 1000 || age < 0) return;
            const progress = age / 1000;
            const currentRadius = progress * maxRadius;
            const dx = p.screenX - cx;
            const dy = p.screenY - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const ringIntensity = Math.max(
              0,
              1 - Math.abs(dist - currentRadius) / (ringWidth / 2),
            );
            pulseWhiteFactor = Math.max(pulseWhiteFactor, ringIntensity);
          });
        }

        // 3. APPLY PULSE TO COLORS
        const finalR = Math.round(r + (255 - r) * pulseWhiteFactor);
        const finalG = Math.round(g + (255 - g) * pulseWhiteFactor);
        const finalB = Math.round(b + (255 - b) * pulseWhiteFactor);
        const finalAlpha = Math.min(1, baseAlpha + pulseWhiteFactor * 0.5);

        // 4. DRAWING
        if (c.aberrationIntensity > 0 && bokehFactor > 0.1) {
          // For CA, we convert our "pulsed" RGB back to HSL to maintain the hue-shift logic
          const [h, s, l] = rgbToHsl(finalR, finalG, finalB);
          const caOffset = Math.min(
            30,
            bokehFactor * visualSize * c.aberrationIntensity * 15,
          );
          const caAlpha = finalAlpha * 0.7;

          // Red-ish Shift
          ctx.fillStyle = `hsla(${h + c.hueShiftAmount}, ${s}%, ${l}%, ${caAlpha})`;
          ctx.beginPath();
          ctx.ellipse(
            p.screenX - caOffset,
            p.screenY,
            radiusX,
            radiusY,
            p.rotZ,
            0,
            Math.PI * 2,
          );
          ctx.fill();

          // Blue-ish Shift
          ctx.fillStyle = `hsla(${h - c.hueShiftAmount}, ${s}%, ${l}%, ${caAlpha})`;
          ctx.beginPath();
          ctx.ellipse(
            p.screenX + caOffset,
            p.screenY,
            radiusX,
            radiusY,
            p.rotZ,
            0,
            Math.PI * 2,
          );
          ctx.fill();

          // Center (Main Body)
          ctx.fillStyle = `hsla(${h}, ${s}%, ${l + glintIntensity * 20}%, ${finalAlpha})`;
          ctx.beginPath();
          ctx.ellipse(
            p.screenX,
            p.screenY,
            radiusX,
            radiusY,
            p.rotZ,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        } else {
          // Standard Render (Use finalR/G/B here!)
          ctx.fillStyle = `rgba(${finalR}, ${finalG}, ${finalB}, ${finalAlpha})`;
          ctx.beginPath();
          ctx.ellipse(
            p.screenX,
            p.screenY,
            radiusX,
            radiusY,
            p.rotZ,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
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
    <div className={`absolute inset-0 overflow-hidden  ${className}`}>
      <canvas
        style={{ opacity: cOpacity }}
        ref={canvasRef}
        className="absolute inset-0 z-20 pointer-events-none"
      />
    </div>
  );
};

// ============================================================================
// DEMO OVERLAY
// ============================================================================
export default function App() {
  const [params, setParams] = useState({
    particleCount: 950,
    moodFactor: 0.5,
    blendMode: "lighter",
    colorVariance: 1.0,
    baseSize: 1.3,
    nearMultiplier: 0.04,
    focusMultiplier: 0.53,
    farMultiplier: 0.53,
    bokehIntensity: 1.4, // Restored
    aberrationIntensity: 0.01,
    hueShiftAmount: 30,
    gaussianBlur: 1.5,
    blurVariance: 1.0,
    spreadMultiplier: 3.0,
    timeScale: 1.0,
    cameraWobble: 1.0,
    particleSpeed: 0.3,
    tumbleSpeed: 0.4,
    sizeVariance: 1.5,
    orbitVariance: 1.0,
    tumbleVariance: 1.0,
    cohesion: 0.0,
    cohesionRadius: 250,
    turbulence: 0.0,
    swarmBreathing: 0.0,
    windY: 0.0,
  });

  const [activeTab, setActiveTab] = useState("lens");
  const [copied, setCopied] = useState(false);

  const cRed = [244, 63, 94];
  const cCyan = [6, 182, 212];
  const cOrange = [251, 146, 60];
  const cEmerald = [16, 185, 129];

  const lerpColor = (c1, c2, t) => [
    Math.round(c1[0] + (c2[0] - c1[0]) * t),
    Math.round(c1[1] + (c2[1] - c1[1]) * t),
    Math.round(c1[2] + (c2[2] - c1[2]) * t),
  ];

  const primaryRGB = lerpColor(cRed, cCyan, params.moodFactor);
  const secondaryRGB = lerpColor(cOrange, cEmerald, params.moodFactor);

  const handleCopy = () => {
    const code = `<PS5Swarm \n  particleCount={${params.particleCount}} \n  color1={[${primaryRGB.join(", ")}]} \n  color2={[${secondaryRGB.join(", ")}]} \n  colorVariance={${params.colorVariance}} \n  blendMode="${params.blendMode}" \n  baseSize={${params.baseSize}} \n  nearMultiplier={${params.nearMultiplier}} \n  focusMultiplier={${params.focusMultiplier}} \n  farMultiplier={${params.farMultiplier}} \n  bokehIntensity={${params.bokehIntensity}} \n  aberrationIntensity={${params.aberrationIntensity}} \n  hueShiftAmount={${params.hueShiftAmount}} \n  gaussianBlur={${params.gaussianBlur}} \n  blurVariance={${params.blurVariance}} \n  spreadMultiplier={${params.spreadMultiplier}} \n  timeScale={${params.timeScale}} \n  cameraWobble={${params.cameraWobble}} \n  particleSpeed={${params.particleSpeed}} \n  tumbleSpeed={${params.tumbleSpeed}} \n  sizeVariance={${params.sizeVariance}} \n  orbitVariance={${params.orbitVariance}} \n  tumbleVariance={${params.tumbleVariance}} \n  cohesion={${params.cohesion}} \n  cohesionRadius={${params.cohesionRadius}} \n  turbulence={${params.turbulence}} \n  swarmBreathing={${params.swarmBreathing}} \n  windY={${params.windY}} \n/>`;
    const textArea = document.createElement("textarea");
    textArea.value = code;
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand("copy");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {}
    document.body.removeChild(textArea);
  };

  const updateParam = (key, value) => {
    if (key === "blendMode") {
      setParams((prev) => ({ ...prev, [key]: value }));
      return;
    }
    const parsed = parseFloat(value);
    setParams((prev) => ({ ...prev, [key]: isNaN(parsed) ? 0 : parsed }));
  };

  return (
    <div className="relative w-full h-full min-h-screen font-sans bg-slate-900 text-slate-200">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute w-[80%] h-[80%] rounded-full blur-[140px] mix-blend-screen fluid-blob anim-heavy"
          style={{ backgroundColor: cRed }}
        />
        <div
          className="absolute w-[90%] h-[90%] rounded-full blur-[160px] mix-blend-screen fluid-blob anim-bounce"
          style={{ backgroundColor: cOrange }}
        />
      </div>

      <style>{`
            .firework-particle {
  opacity: 0;
  transform: rotate(var(--angle)) translateY(0) scale(1);
  animation: explode 0.8s ease-out forwards;
  animation-delay: var(--delay);
  filter: blur(2px) brightness(1.5);
  box-shadow: 0 0 15px #22d3ee;
}

@keyframes explode {
  0% {
    opacity: 0;
    transform: rotate(var(--angle)) translateY(0) scale(1);
  }
  20% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: rotate(var(--angle)) translateY(150px) scale(0.1);
  }
}
            /* Hardware acceleration and strict separation of concerns */
            .fluid-blob {
              will-change: transform;
              backface-visibility: hidden;
              perspective: 1000px;
              
              /* 1. Anchor to the exact center of the container */
              top: 50%;
              left: 50%;
              
              /* 2. Transition ONLY the color to prevent layout thrashing */
              transition: background-color 2s ease-in-out;
            }

            .anim-heavy {
              animation: fluid-heavy 22s linear infinite;
            }

            .anim-bounce {
              animation: fluid-bounce 28s linear infinite;
            }

            /* By using calc(-50% + offset), we maintain the perfect center anchor 
              at all times, preventing the "drift" to the bottom right!
            */
            @keyframes fluid-heavy {
              0%   { transform: translate(calc(-50% + 0vw), calc(-50% + 0vh)) rotate(0deg) scale(1); }
              25%  { transform: translate(calc(-50% + 15vw), calc(-50% - 10vh)) rotate(90deg) scale(1.2); }
              50%  { transform: translate(calc(-50% - 15vw), calc(-50% + 10vh)) rotate(180deg) scale(0.9); }
              75%  { transform: translate(calc(-50% + 10vw), calc(-50% + 15vh)) rotate(270deg) scale(1.1); }
              100% { transform: translate(calc(-50% + 0vw), calc(-50% + 0vh)) rotate(360deg) scale(1); }
            }

            @keyframes fluid-bounce {
              0%   { transform: translate(calc(-50% - 10vw), calc(-50% + 15vh)) scale(1); }
              33%  { transform: translate(calc(-50% + 20vw), calc(-50% - 15vh)) scale(1.3); }
              66%  { transform: translate(calc(-50% - 20vw), calc(-50% - 10vh)) scale(0.8); }
              100% { transform: translate(calc(-50% - 10vw), calc(-50% + 15vh)) scale(1); }
            }
            `}</style>

      <div className="absolute inset-0 backdrop-blur-[60px] bg-slate-950/10" />
      <PS5Swarm {...params} color1={primaryRGB} color2={secondaryRGB} />

      <div className="absolute top-4 right-4 z-50 w-[350px] bg-slate-900/70 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-5 shadow-2xl overflow-y-auto max-h-[90vh]">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-sm font-bold tracking-widest text-white uppercase">
            Swarm Engine v4
          </h2>
          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
        </div>

        <div className="flex gap-2 mb-6 border-b border-slate-700/50 pb-2">
          {["lens", "visuals", "motion", "physics"].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`text-[10px] font-bold tracking-wider uppercase transition-colors ${activeTab === tab ? "text-cyan-400" : "text-slate-500 hover:text-slate-300"}`}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === "lens" && (
          <div className="space-y-6">
            <LensEditor
              near={params.nearMultiplier}
              focus={params.focusMultiplier}
              far={params.farMultiplier}
              onChange={updateParam}
            />
            <div className="space-y-4">
              <Slider
                label="Gaussian Softness"
                val={params.gaussianBlur}
                min={0.0}
                max={10.0}
                step={0.1}
                onChange={(v) => updateParam("gaussianBlur", v)}
              />
              <Slider
                label="Softness Variance"
                val={params.blurVariance}
                min={0.0}
                max={5.0}
                step={0.1}
                onChange={(v) => updateParam("blurVariance", v)}
              />
              <Slider
                label="Bokeh (Size Expand)"
                val={params.bokehIntensity}
                min={0.0}
                max={5.0}
                step={0.1}
                onChange={(v) => updateParam("bokehIntensity", v)}
              />
              <div className="pt-2 border-t border-slate-700/50 space-y-4">
                <Slider
                  label="Perceptual CA Amt"
                  val={params.aberrationIntensity}
                  min={0.0}
                  max={0.2}
                  step={0.01}
                  onChange={(v) => updateParam("aberrationIntensity", v)}
                />
                <Slider
                  label="Hue Shift Offset"
                  val={params.hueShiftAmount}
                  min={0}
                  max={120}
                  step={1}
                  onChange={(v) => updateParam("hueShiftAmount", v)}
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === "visuals" && (
          <div className="space-y-4">
            <Slider
              label="Particle Count"
              val={params.particleCount}
              min={50}
              max={2500}
              step={50}
              onChange={(v) => updateParam("particleCount", v)}
            />
            <Slider
              label="Mood Factor"
              val={params.moodFactor}
              min={0.0}
              max={1.0}
              step={0.01}
              onChange={(v) => updateParam("moodFactor", v)}
            />
            <Slider
              label="Base Size"
              val={params.baseSize}
              min={0.1}
              max={5.0}
              step={0.1}
              onChange={(v) => updateParam("baseSize", v)}
            />
            <Slider
              label="Spread"
              val={params.spreadMultiplier}
              min={0.1}
              max={5.0}
              step={0.1}
              onChange={(v) => updateParam("spreadMultiplier", v)}
            />
          </div>
        )}

        {activeTab === "motion" && (
          <div className="space-y-4">
            <Slider
              label="Time Scale"
              val={params.timeScale}
              min={0.0}
              max={3.0}
              step={0.1}
              onChange={(v) => updateParam("timeScale", v)}
            />
            <Slider
              label="Orbit Speed"
              val={params.particleSpeed}
              min={0.0}
              max={5.0}
              step={0.1}
              onChange={(v) => updateParam("particleSpeed", v)}
            />
            <Slider
              label="Tumble Variance"
              val={params.tumbleVariance}
              min={0.0}
              max={5.0}
              step={0.1}
              onChange={(v) => updateParam("tumbleVariance", v)}
            />
          </div>
        )}

        {activeTab === "physics" && (
          <div className="space-y-4">
            <Slider
              label="Cohesion"
              val={params.cohesion}
              min={0.0}
              max={5.0}
              step={0.1}
              onChange={(v) => updateParam("cohesion", v)}
            />
            <Slider
              label="Wind Y"
              val={params.windY}
              min={-10.0}
              max={10.0}
              step={0.1}
              onChange={(v) => updateParam("windY", v)}
            />
          </div>
        )}

        <button
          onClick={handleCopy}
          className={`mt-6 w-full py-2 px-4 rounded-lg font-mono text-[10px] uppercase tracking-wider font-bold transition-all duration-200
            ${copied ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/50" : "bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/20"}`}
        >
          {copied ? "COPIED TO CLIPBOARD" : "COPY PROPS COMPONENT"}
        </button>
      </div>
    </div>
  );
}

function Slider({ label, val, min, max, step, onChange }) {
  return (
    <div className="flex flex-col gap-1.5 group">
      <div className="flex justify-between items-center">
        <span className="text-[10px] text-slate-400 uppercase tracking-wider">
          {label}
        </span>
        <input
          type="number"
          value={val}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(e.target.value)}
          className="w-16 bg-slate-800/50 text-right font-mono text-cyan-300 text-xs outline-none rounded px-1 border border-transparent focus:border-cyan-500/50"
        />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={val}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
      />
    </div>
  );
}

function LensEditor({ near, focus, far, onChange }) {
  const svgRef = useRef();
  const [dragging, setDragging] = useState(null);
  const mapY = (val) => 50 - (Math.min(3.0, val) / 3.0) * 45;
  const yNear = mapY(near);
  const yFocus = mapY(focus);
  const yFar = mapY(far);

  useEffect(() => {
    const handleMove = (e) => {
      if (!dragging) return;
      const rect = svgRef.current.getBoundingClientRect();
      const localY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
      const distFromCenter = Math.abs(50 - (localY / rect.height) * 100);
      const val = (distFromCenter / 45) * 3.0;
      let key =
        dragging === "near"
          ? "nearMultiplier"
          : dragging === "focus"
            ? "focusMultiplier"
            : "farMultiplier";
      onChange(key, parseFloat(val.toFixed(2)));
    };
    const handleUp = () => setDragging(null);
    if (dragging) {
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    }
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [dragging, onChange]);

  const pts = `20,${yNear} 100,${yFocus} 180,${yFar} 180,${100 - yFar} 100,${100 - yFocus} 20,${100 - yNear}`;

  return (
    <div className="relative w-full h-24 bg-slate-950/50 rounded-lg border border-slate-800 overflow-hidden select-none">
      <svg
        ref={svgRef}
        viewBox="0 0 200 100"
        className="w-full h-full"
        preserveAspectRatio="none"
      >
        <line
          x1="0"
          y1="50"
          x2="200"
          y2="50"
          stroke="#334155"
          strokeWidth="1"
          strokeDasharray="4 4"
        />
        <polygon points={pts} fill="rgba(34, 211, 238, 0.1)" />
        <polyline
          points={`20,${yNear} 100,${yFocus} 180,${yFar}`}
          fill="none"
          stroke="rgba(34, 211, 238, 0.4)"
          strokeWidth="1"
        />
        <polyline
          points={`20,${100 - yNear} 100,${100 - yFocus} 180,${100 - yFar}`}
          fill="none"
          stroke="rgba(34, 211, 238, 0.4)"
          strokeWidth="1"
        />
        <line
          x1="20"
          y1={yNear}
          x2="20"
          y2={100 - yNear}
          stroke={dragging === "near" ? "#fff" : "#22d3ee"}
          strokeWidth="3"
          strokeLinecap="round"
        />
        <line
          x1="100"
          y1={yFocus}
          x2="100"
          y2={100 - yFocus}
          stroke={dragging === "focus" ? "#fff" : "#22d3ee"}
          strokeWidth="3"
          strokeLinecap="round"
        />
        <line
          x1="180"
          y1={yFar}
          x2="180"
          y2={100 - yFar}
          stroke={dragging === "far" ? "#fff" : "#22d3ee"}
          strokeWidth="3"
          strokeLinecap="round"
        />
        <rect
          x="0"
          y="0"
          width="40"
          height="100"
          fill="transparent"
          style={{ cursor: "ns-resize" }}
          onPointerDown={() => setDragging("near")}
        />
        <rect
          x="80"
          y="0"
          width="40"
          height="100"
          fill="transparent"
          style={{ cursor: "ns-resize" }}
          onPointerDown={() => setDragging("focus")}
        />
        <rect
          x="160"
          y="0"
          width="40"
          height="100"
          fill="transparent"
          style={{ cursor: "ns-resize" }}
          onPointerDown={() => setDragging("far")}
        />
      </svg>
    </div>
  );
}
