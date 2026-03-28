"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const BAR_COUNT = 10;
const BAR_SHAPE = [0.34, 0.46, 0.62, 0.8, 0.98, 0.98, 0.8, 0.62, 0.46, 0.34];
const SILENT_HEIGHT = 3.9;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function smoothstep(start: number, end: number, value: number) {
  const t = clamp((value - start) / (end - start), 0, 1);
  return t * t * (3 - 2 * t);
}

function fallbackLevel(phase: number) {
  const wave = (Math.sin(phase * 3.2) + 1) * 0.5;
  const pulse = (Math.sin(phase * 1.15) + 1) * 0.5;
  return clamp((wave * 0.72 + pulse * 0.28) * 0.18, 0, 0.2);
}

export function LiveAudioWave({
  stream,
  active,
  className,
}: {
  stream: MediaStream | null;
  active: boolean;
  className?: string;
}) {
  const [phase, setPhase] = useState(0);
  const [displayedLevel, setDisplayedLevel] = useState(0);
  const frameRef = useRef<number | null>(null);
  const targetLevelRef = useRef(0);
  const renderedLevel = active ? displayedLevel : 0;

  useEffect(() => {
    if (!active) {
      targetLevelRef.current = 0;
      return;
    }

    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let frequencyData: Uint8Array | null = null;

    const AudioContextCtor =
      typeof window === "undefined"
        ? null
        : window.AudioContext ||
          ((window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
            null);

    if (stream && AudioContextCtor) {
      audioContext = new AudioContextCtor();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.55;
      source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      frequencyData = new Uint8Array(new ArrayBuffer(analyser.fftSize));
    }

    let mounted = true;

    const renderFrame = (now: number) => {
      if (!mounted) {
        return;
      }

      const nextPhase = now / 1000;
      setPhase(nextPhase);

      let sampledLevel = fallbackLevel(nextPhase);

      if (analyser && frequencyData) {
        analyser.getByteTimeDomainData(frequencyData as Uint8Array<ArrayBuffer>);

        let sum = 0;
        for (let index = 0; index < frequencyData.length; index += 1) {
          const sample = ((frequencyData[index] ?? 128) - 128) / 128;
          sum += sample * sample;
        }

        const rms = Math.sqrt(sum / frequencyData.length);
        sampledLevel = clamp((rms - 0.01) / 0.16, 0, 1);
      }

      targetLevelRef.current = sampledLevel;

      setDisplayedLevel((current) => {
        const target = targetLevelRef.current;
        const delta = target - current;
        const easing = delta >= 0 ? 0.26 : 0.08;
        return clamp(current + delta * easing, 0, 1);
      });

      frameRef.current = window.requestAnimationFrame(renderFrame);
    };

    const start = async () => {
      if (audioContext?.state === "suspended") {
        await audioContext.resume().catch(() => undefined);
      }

      frameRef.current = window.requestAnimationFrame(renderFrame);
    };

    void start();

    return () => {
      mounted = false;
      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }

      source?.disconnect();
      if (audioContext) {
        void audioContext.close().catch(() => undefined);
      }
    };
  }, [active, stream]);

  return (
    <div aria-hidden="true" className={cn("flex items-center justify-center", className)}>
      <div className="flex h-10 w-[4.6rem] items-center justify-center gap-[2.4px] rounded-[13px] border border-white/10 bg-[#050505] px-[7px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
        {Array.from({ length: BAR_COUNT }, (_, index) => {
          const normalizedLevel = clamp(renderedLevel, 0, 1);
          const activeProgress = smoothstep(0.008, 0.055, normalizedLevel);
          const silentBlend = 1 - activeProgress;
          const shape = BAR_SHAPE[index] ?? BAR_SHAPE[0];
          const activeLevel = clamp((normalizedLevel - 0.015) / 0.985, 0, 1);
          const boostedLevel = Math.min(1, Math.pow(activeLevel, 0.5) * 1.48);
          const timeWave = (Math.sin(phase * 16 + index * 0.7) + 1) * 0.5;
          const voiceHeight = boostedLevel * 10.8 * shape;
          const motionHeight = boostedLevel * (0.6 + shape) * timeWave * 1.2;
          const activeHeight = SILENT_HEIGHT + voiceHeight + motionHeight;
          const height = SILENT_HEIGHT + (activeHeight - SILENT_HEIGHT) * activeProgress;
          const width = 1.85 + (2.2 - 1.85) * activeProgress;
          const shimmer = (Math.sin(phase * 8.4 + index * 0.9) + 1) * 0.5;
          const pulse = (Math.sin(phase * 2.2 + index * 0.2) + 1) * 0.5;
          const blended = shimmer * 0.76 + pulse * 0.24;
          const silentOpacity = 0.62 + 0.3 * blended;
          const opacity = silentOpacity * silentBlend + 0.98 * activeProgress;
          const shadowOpacity = (0.06 + 0.08 * (1 - shimmer)) * silentBlend;
          const cornerRadius = 1.4 * silentBlend + 2 * activeProgress;

          return (
            <span
              key={index}
              className="block transition-[width,height,border-radius] duration-75 ease-linear"
              style={{
                width: `${width}px`,
                height: `${height}px`,
                borderRadius: `${cornerRadius}px`,
                backgroundColor: `rgba(255,255,255,${opacity})`,
                boxShadow: `0 0.35px 0.65px rgba(0,0,0,${shadowOpacity})`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
