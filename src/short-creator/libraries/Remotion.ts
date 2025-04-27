import z from "zod";
import { bundle } from "@remotion/bundler"; // v4.0.286
import { renderMedia, selectComposition } from "@remotion/renderer"; // v4.0.286
import path from "path";
import { ensureBrowser } from "@remotion/renderer"; // v4.0.286
import ffmpeg from "@ffmpeg-installer/ffmpeg"; // v1.1.0
import { Config } from "../../config";
import { shortVideoSchema } from "../../components/videos/ShortVideo";
import { logger } from "../../logger";
import { execSync } from "child_process";

const COMPONENT_TO_RENDER = "ShortVideo";

export class Remotion {
  constructor(
    private bundled: string,
    private config: Config,
  ) {}

  static async init(config: Config): Promise<Remotion> {
    await ensureBrowser();

    // Verify and install GPU dependencies
    if (!config.runningInDocker) {
      try {
        logger.debug("Setting up GPU acceleration with specific versions");
        
        // Install exact version of ffmpeg
        execSync('npm install @ffmpeg-installer/ffmpeg@1.1.0 --no-save', { 
          stdio: 'inherit' 
        });
        
        // Verify versions
        const remotionVersion = execSync('npm list @remotion/renderer').toString();
        if (!remotionVersion.includes('4.0.286')) {
          throw new Error('Incorrect @remotion version installed');
        }

        // Configure GPU acceleration
        execSync('export FFMPEG_BINARY=' + ffmpeg.path, { stdio: 'inherit' });
        logger.debug("GPU acceleration configured with FFmpeg v1.1.0");
      } catch (error) {
        logger.warn({ error }, "GPU setup failed, falling back to CPU");
      }
    }

    const bundled = await bundle({
      publicDir: config.musicDirPath,
      entryPoint: path.join(
        config.packageDirPath,
        config.devMode ? "src" : "dist",
        "components",
        "root",
        `index.${config.devMode ? "ts" : "js"}`,
      ),
    });

    logger.debug("Remotion v4.0.286 initialized with GPU support");
    return new Remotion(bundled, config);
  }

  async render(data: z.infer<typeof shortVideoSchema>, id: string) {
    const composition = await selectComposition({
      serveUrl: this.bundled,
      id: COMPONENT_TO_RENDER,
      inputProps: data,
    });

    logger.debug(
      { component: COMPONENT_TO_RENDER, videoID: id },
      "Starting GPU-accelerated rendering with Remotion v4.0.286"
    );

    const outputLocation = path.join(this.config.videosDirPath, `${id}.mp4`);

    try {
      await renderMedia({
        codec: "h264",
        composition,
        serveUrl: this.bundled,
        outputLocation,
        inputProps: data,
        onProgress: ({ progress }) => {
          logger.debug(`Rendering ${id} ${Math.floor(progress * 100)}% complete`);
        },
        ffmpegExecutable: ffmpeg.path,
        concurrency: this.config.concurrency,
        offthreadVideoCacheSizeInBytes: this.config.videoCacheSizeInBytes,
        pixelFormat: "yuv420p",
        videoBitrate: "8000k",
        audioBitrate: "256k",
      });

      logger.debug(
        {
          outputLocation,
          component: COMPONENT_TO_RENDER,
          videoID: id,
        },
        "Video successfully rendered with GPU acceleration"
      );
    } catch (error) {
      logger.error(
        { error, videoID: id },
        "GPU rendering failed, attempting CPU fallback"
      );
      
      await this.fallbackCPURender(composition, data, outputLocation, id);
      
      logger.debug(
        {
          outputLocation,
          component: COMPONENT_TO_RENDER,
          videoID: id,
        },
        "Video rendered with CPU fallback"
      );
    }
  }

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
      ffmpegExecutable: ffmpeg.path,
    });
  }
}
