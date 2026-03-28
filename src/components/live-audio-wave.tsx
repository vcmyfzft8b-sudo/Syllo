"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const BAR_COUNT = 12;
const BAR_SHAPE = [0.26, 0.36, 0.5, 0.68, 0.86, 1, 1, 0.86, 0.68, 0.5, 0.36, 0.26];
const SILENT_HEIGHT = 4.2;
const SILENT_WIDTH = 2.2;
const ACTIVE_WIDTH = 3.3;

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
  return clamp((wave * 0.72 + pulse * 0.28) * 0.22, 0, 0.24);
}

function normalizeMicLevel(rms: number, peak: number) {
  const rmsBoost = clamp((rms - 0.004) / 0.05, 0, 1);
  const peakBoost = clamp((peak - 0.018) / 0.32, 0, 1);
  const combined = Math.max(rmsBoost * 0.82, peakBoost * 0.65);
  return clamp(Math.pow(combined, 0.42) * 1.9, 0, 1);
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
  const renderedLevel = active ? displayedLevel : 0;

  useEffect(() => {
    if (!active) {
      return;
    }

    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let timeDomainData: Uint8Array | null = null;

    const AudioContextCtor =
      typeof window === "undefined"
        ? null
        : window.AudioContext ||
          ((window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
            null);

    if (stream && AudioContextCtor) {
      audioContext = new AudioContextCtor();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.32;
      source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      timeDomainData = new Uint8Array(new ArrayBuffer(analyser.fftSize));
    }

    let mounted = true;

    const renderFrame = (now: number) => {
      if (!mounted) {
        return;
      }

      const nextPhase = now / 1000;
      setPhase(nextPhase);

      let sampledLevel = fallbackLevel(nextPhase);

      if (analyser && timeDomainData) {
        analyser.getByteTimeDomainData(timeDomainData as Uint8Array<ArrayBuffer>);

        let sum = 0;
        let peak = 0;
        for (let index = 0; index < timeDomainData.length; index += 1) {
          const sample = ((timeDomainData[index] ?? 128) - 128) / 128;
          sum += sample * sample;
          const amplitude = Math.abs(sample);
          if (amplitude > peak) {
            peak = amplitude;
          }
        }

        const rms = Math.sqrt(sum / timeDomainData.length);
        sampledLevel = normalizeMicLevel(rms, peak);
      }

      setDisplayedLevel((current) => {
        const delta = sampledLevel - current;
        const easing = delta >= 0 ? 0.58 : 0.16;
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
      <div className="flex h-12 w-[5.8rem] items-center justify-center gap-[2.6px] px-[5px] text-[var(--label)]">
        {Array.from({ length: BAR_COUNT }, (_, index) => {
          const normalizedLevel = clamp(renderedLevel, 0, 1);
          const shapedLevel = clamp(
            normalizedLevel * (0.58 + (BAR_SHAPE[index] ?? 0.3) * 0.9),
            0,
            1,
          );
          const activeProgress = smoothstep(0.02, 0.12, shapedLevel);
          const silentBlend = 1 - activeProgress;
          const shape = BAR_SHAPE[index] ?? BAR_SHAPE[0];
          const activeLevel = clamp((shapedLevel - 0.015) / 0.985, 0, 1);
          const boostedLevel = Math.min(1, Math.pow(activeLevel, 0.48) * 1.45);
          const timeWave = (Math.sin(phase * 21 + index * 0.82) + 1) * 0.5;
          const ripple = (Math.sin(phase * 9 + index * 0.34) + 1) * 0.5;
          const voiceHeight = boostedLevel * 20.5 * shape;
          const motionHeight =
            boostedLevel * (2.4 + shape * 3.4) * ((timeWave * 0.72) + (ripple * 0.28));
          const activeHeight = SILENT_HEIGHT + voiceHeight + motionHeight;
          const height = SILENT_HEIGHT + (activeHeight - SILENT_HEIGHT) * activeProgress;
          const width = SILENT_WIDTH + (ACTIVE_WIDTH - SILENT_WIDTH) * activeProgress;
          const shimmer = (Math.sin(phase * 9.2 + index * 0.9) + 1) * 0.5;
          const pulse = (Math.sin(phase * 2.6 + index * 0.2) + 1) * 0.5;
          const blended = shimmer * 0.76 + pulse * 0.24;
          const silentOpacity = 0.48 + 0.2 * blended;
          const opacity = silentOpacity * silentBlend + 0.98 * activeProgress;
          const shadowOpacity = (0.04 + 0.06 * (1 - shimmer)) * (0.2 + activeProgress * 0.8);
          const cornerRadius = 1.6 * silentBlend + 2.6 * activeProgress;

          return (
            <span
              key={index}
              className="block origin-center transition-[width,height,border-radius,opacity] duration-75 ease-linear will-change-[width,height]"
              style={{
                width: `${width}px`,
                height: `${height}px`,
                borderRadius: `${cornerRadius}px`,
                backgroundColor: `color-mix(in srgb, currentColor ${Math.round(opacity * 100)}%, transparent)`,
                boxShadow: `0 0.35px 0.65px color-mix(in srgb, currentColor ${Math.round(
                  shadowOpacity * 55,
                )}%, transparent)`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
