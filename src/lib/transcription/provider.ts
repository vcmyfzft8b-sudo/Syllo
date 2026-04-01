import "server-only";

import { SonioxTranscriptionProvider } from "@/lib/transcription/soniox";
import type { TranscriptionProvider } from "@/lib/transcription/types";

const sonioxProvider = new SonioxTranscriptionProvider();

export function getTranscriptionProvider(): TranscriptionProvider {
  return sonioxProvider;
}
