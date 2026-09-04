import { NativeModules, NativeEventEmitter, DeviceEventEmitter, Platform } from 'react-native';

const { FacePipeline: NativeFacePipeline } = NativeModules;

export interface PipelineProgress {
  stage: string;
  progress: number; // 0–1
}

export interface TimeSegment {
  startMs: number;
  endMs: number;
}

export interface PersonResult {
  id: string;
  appearanceCount: number;
  bestFrameBase64: string;
  qualityScore: number;
  frontality: number;
  eyesOpen: number;
  smiling: number;
  timeSegments: TimeSegment[];
}

export interface PipelineResult {
  persons: PersonResult[];
  totalAppearances: number;
  distinctPeople: number;
}

class FacePipelineBridge {
  private emitter: NativeEventEmitter | null = null;
  private subscription: any = null;

  isAvailable(): boolean {
    return Platform.OS === 'android' && !!NativeFacePipeline;
  }

  async processVideo(
    videoUri: string,
    onProgress: (p: PipelineProgress) => void
  ): Promise<PipelineResult> {
    if (!this.isAvailable()) {
      throw new Error(
        'FacePipeline native module not available. Please run the custom APK (not Expo Go).'
      );
    }

    // Subscribe to progress events
    this.subscription = DeviceEventEmitter.addListener(
      'FacePipelineProgress',
      (event: PipelineProgress) => onProgress(event)
    );
    try {
      const jsonStr: string = await NativeFacePipeline.processVideo(videoUri);
      const raw = JSON.parse(jsonStr) as {
        persons: any[];
        totalAppearances: number;
        distinctPeople: number;
      };

      const result: PipelineResult = {
        distinctPeople: raw.distinctPeople,
        totalAppearances: raw.totalAppearances,
        persons: raw.persons.map((p: any) => ({
          id: p.id,
          appearanceCount: p.appearanceCount,
          bestFrameBase64: p.bestFrameBase64,
          qualityScore: p.qualityScore,
          frontality: p.frontality,
          eyesOpen: p.eyesOpen,
          smiling: p.smiling,
          timeSegments: p.timeSegments ?? [],
        })),
      };
      return result;
    } finally {
      this.subscription?.remove();
      this.subscription = null;
    }
  }
}

export const FacePipeline = new FacePipelineBridge();
