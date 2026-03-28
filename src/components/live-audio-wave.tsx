"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const BAR_COUNT = 18;
const HALF_BAR_COUNT = BAR_COUNT / 2;
const FFT_SIZE = 256;
const MIN_BAR_HEIGHT = 3;
const MAX_BAR_HEIGHT = 34;
const ENERGY_ATTACK = 0.34;
const ENERGY_RELEASE = 0.12;
const SPEECH_START_THRESHOLD = 0.11;
const SPEECH_STOP_THRESHOLD = 0.06;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function createEmptyBars() {
  return Array.from({ length: BAR_COUNT }, () => 0);
}

const EMPTY_BARS = createEmptyBars();

function averageRange(data: Uint8Array, start: number, end: number) {
  const from = clamp(start, 0, data.length - 1);
  const to = clamp(end, from + 1, data.length);
  let total = 0;

  for (let index = from; index < to; index += 1) {
    total += data[index] ?? 0;
  }

  return total / Math.max(1, to - from);
}

function normalizeEnergy(value: number) {
  return clamp((value - 0.085) / 0.42, 0, 1);
}

function smoothValue(current: number, target: number, rise: number, fall: number) {
  const easing = target > current ? rise : fall;
  return current + (target - current) * easing;
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
  const [barLevels, setBarLevels] = useState<number[]>(() => createEmptyBars());
  const [presence, setPresence] = useState(0);
  const frameRef = useRef<number | null>(null);
  const smoothedBarsRef = useRef<number[]>(createEmptyBars());
  const smoothedEnergyRef = useRef(0);
  const speakingRef = useRef(false);
  const isLive = active && Boolean(stream);
  const renderedBars = isLive ? barLevels : EMPTY_BARS;
  const renderedPresence = isLive ? presence : 0;

  useEffect(() => {
    if (!active || !stream) {
      speakingRef.current = false;
      smoothedEnergyRef.current = 0;
      smoothedBarsRef.current = createEmptyBars();
      return;
    }

    const AudioContextCtor =
      typeof window === "undefined"
        ? null
        : window.AudioContext ||
          ((window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
            null);

    if (!AudioContextCtor) {
      speakingRef.current = false;
      smoothedEnergyRef.current = 0;
      smoothedBarsRef.current = createEmptyBars();
      return;
    }

    let mounted = true;
    const audioContext = new AudioContextCtor();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);
    const frequencyData = new Uint8Array(analyser.frequencyBinCount);

    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.68;
    analyser.minDecibels = -92;
    analyser.maxDecibels = -18;
    source.connect(analyser);

    const renderFrame = () => {
      if (!mounted) {
        return;
      }

      analyser.getByteFrequencyData(frequencyData);

      const speechBandStart = 2;
      const speechBandEnd = Math.min(frequencyData.length, 52);
      const overallEnergy = averageRange(frequencyData, speechBandStart, speechBandEnd) / 255;

      smoothedEnergyRef.current = smoothValue(
        smoothedEnergyRef.current,
        overallEnergy,
        ENERGY_ATTACK,
        ENERGY_RELEASE,
      );

      if (speakingRef.current) {
        speakingRef.current = smoothedEnergyRef.current > SPEECH_STOP_THRESHOLD;
      } else {
        speakingRef.current = smoothedEnergyRef.current > SPEECH_START_THRESHOLD;
      }

      const halfBars = Array.from({ length: HALF_BAR_COUNT }, (_, index) => {
        const startProgress = Math.pow(index / HALF_BAR_COUNT, 1.65);
        const endProgress = Math.pow((index + 1) / HALF_BAR_COUNT, 1.65);
        const bandStart =
          speechBandStart + Math.floor((speechBandEnd - speechBandStart) * startProgress);
        const bandEnd =
          speechBandStart +
          Math.max(
            bandStart + 1,
            Math.floor((speechBandEnd - speechBandStart) * endProgress),
          );
        const bandEnergy = averageRange(frequencyData, bandStart, bandEnd) / 255;
        const normalizedBand = normalizeEnergy(bandEnergy);
        const centerWeight = 1 - index / Math.max(1, HALF_BAR_COUNT - 1);

        if (!speakingRef.current) {
          return 0;
        }

        return clamp(
          Math.pow(normalizedBand, 0.82) * (0.52 + centerWeight * 0.88) +
            smoothedEnergyRef.current * (0.18 + centerWeight * 0.34),
          0,
          1,
        );
      });

      const targetBars = [...halfBars.slice().reverse(), ...halfBars];
      const nextBars = smoothedBarsRef.current.map((current, index) =>
        smoothValue(current, targetBars[index] ?? 0, 0.42, speakingRef.current ? 0.16 : 0.24),
      );

      smoothedBarsRef.current = nextBars;
      setBarLevels(nextBars);
      setPresence(speakingRef.current ? clamp(smoothedEnergyRef.current * 1.4, 0, 1) : 0);

      frameRef.current = window.requestAnimationFrame(renderFrame);
    };

    const start = async () => {
      if (audioContext.state === "suspended") {
        await audioContext.resume().catch(() => undefined);
      }

      frameRef.current = window.requestAnimationFrame(renderFrame);
    };

    void start();

    return () => {
      mounted = false;

      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }

      source.disconnect();
      void audioContext.close().catch(() => undefined);
    };
  }, [active, stream]);

  return (
    <div aria-hidden="true" className={cn("flex items-center justify-center", className)}>
      <div className="relative flex h-16 w-full max-w-[13rem] items-center justify-center overflow-hidden rounded-full px-4 text-[var(--label)]">
        <div
          className="pointer-events-none absolute inset-0 rounded-full transition-opacity duration-150"
          style={{
            opacity: 0.2 + renderedPresence * 0.55,
            background: `radial-gradient(circle at 50% 50%, color-mix(in srgb, currentColor ${
              Math.round(14 + renderedPresence * 24)
            }%, transparent) 0%, transparent 72%)`,
          }}
        />
        <div
          className="pointer-events-none absolute inset-x-5 top-1/2 h-px -translate-y-1/2"
          style={{
            backgroundColor: "color-mix(in srgb, currentColor 14%, transparent)",
            opacity: 0.18 + (1 - renderedPresence) * 0.22,
          }}
        />
        <div className="relative flex h-10 w-full items-end justify-center gap-[5px]">
          {renderedBars.map((level, index) => {
            const height = MIN_BAR_HEIGHT + level * (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT);
            const opacity = 0.12 + level * 0.88;
            const highlight = 22 + Math.round(level * 46);

            return (
              <span
                key={index}
                className="block w-[5px] rounded-full transition-[height,opacity,transform] duration-75 ease-out"
                style={{
                  height: `${height}px`,
                  opacity,
                  transform: `scaleX(${0.88 + level * 0.16})`,
                  background: `linear-gradient(180deg, color-mix(in srgb, currentColor ${highlight}%, white) 0%, color-mix(in srgb, currentColor ${
                    40 + Math.round(level * 58)
                  }%, transparent) 100%)`,
                  boxShadow: `0 0 ${4 + level * 9}px color-mix(in srgb, currentColor ${
                    10 + Math.round(level * 30)
                  }%, transparent)`,
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
