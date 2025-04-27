import z from "zod";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import path from "path";
import { ensureBrowser } from "@remotion/renderer";
import { Config } from "../../config";
import { shortVideoSchema } from "../../components/videos/ShortVideo";
import { logger } from "../../logger";
import ffmpeg from "@ffmpeg-installer/ffmpeg";

const COMPONENT_TO_RENDER = "ShortVideo";

export class Remotion {
  constructor(
    private bundled: string,
    private config: {
      concurrency: number;
      videoCacheSizeInBytes: number;
      // ... other config properties
    },
  ) {}

  // ... (other methods) ...

  private async fallbackCPURender(
    composition: any,
    data: z.infer<typeof shortVideoSchema>,
    outputLocation: string,
    id: string
  ) {
    logger.debug("Using CPU fallback render method");
    
    await renderMedia({
      codec: "h264",
      composition,
      serveUrl: this.bundled,
      outputLocation,
      inputProps: data,
      concurrency: Math.max(1, Math.floor(this.config.concurrency / 2)),
      offthreadVideoCacheSizeInBytes: Math.floor(this.config.videoCacheSizeInBytes / 2),
      // Removed ffmpegExecutable as it's not a valid option
    });
  }
}
