import ffmpeg from "fluent-ffmpeg"; // v2.1.3
import { Readable } from "node:stream";
import { logger } from "../../logger";
import { execSync } from "child_process";

export class FFMpeg {
  private static gpuAccelerated = false;

  static async init(): Promise<FFMpeg> {
    return import("@ffmpeg-installer/ffmpeg").then((ffmpegInstaller) => {
      ffmpeg.setFfmpegPath(ffmpegInstaller.path);
      
      // Check for T4 GPU and configure hardware acceleration
      try {
        const nvidiaCheck = execSync('nvidia-smi --query-gpu=name --format=csv,noheader').toString().trim();
        if (nvidiaCheck.includes('T4')) {
          logger.info("NVIDIA T4 GPU detected, enabling hardware acceleration");
          this.gpuAccelerated = true;
          
          // Verify NVENC support
          const codecs = execSync(`${ffmpegInstaller.path} -codecs`).toString();
          if (!codecs.includes('nvenc')) {
            logger.warn("NVENC not available in FFmpeg build");
            this.gpuAccelerated = false;
          }
        }
      } catch (error) {
        logger.warn({ error }, "GPU detection failed, using CPU");
      }

      logger.info("FFmpeg initialized", {
        path: ffmpegInstaller.path,
        gpuAccelerated: this.gpuAccelerated,
        version: ffmpegInstaller.version
      });
      
      return new FFMpeg();
    });
  }

  private getAudioCommand(input: Readable) {
    const command = ffmpeg(input);
    
    if (FFMpeg.gpuAccelerated) {
      command
        .outputOptions([
          '-hwaccel cuda',
          '-hwaccel_output_format cuda',
          '-c:a aac', // Use GPU-accelerated codec when available
        ]);
    }
    
    return command;
  }

  async saveNormalizedAudio(
    audio: ArrayBuffer,
    outputPath: string,
  ): Promise<string> {
    logger.debug("Normalizing audio for Whisper");
    const inputStream = new Readable();
    inputStream.push(Buffer.from(audio));
    inputStream.push(null);

    return new Promise((resolve, reject) => {
      this.getAudioCommand(inputStream)
        .audioCodec("pcm_s16le")
        .audioChannels(1)
        .audioFrequency(16000)
        .toFormat("wav")
        .on("end", () => {
          logger.debug("Audio normalization complete", {
            outputPath,
            gpuAccelerated: FFMpeg.gpuAccelerated
          });
          resolve(outputPath);
        })
        .on("error", (err) => {
          logger.error(err, "Error normalizing audio");
          reject(err);
        })
        .save(outputPath);
    });
  }

  async createMp3DataUri(audio: ArrayBuffer): Promise<string> {
    const inputStream = new Readable();
    inputStream.push(Buffer.from(audio));
    inputStream.push(null);
    
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const command = this.getAudioCommand(inputStream)
        .audioCodec("libmp3lame")
        .audioBitrate(128)
        .audioChannels(2)
        .toFormat("mp3");

      if (FFMpeg.gpuAccelerated) {
        command.outputOptions([
          '-c:a aac', // Use GPU-accelerated codec
          '-b:a 128k'
        ]);
      }

      command
        .on("error", reject)
        .pipe()
        .on("data", (data: Buffer) => chunks.push(data))
        .on("end", () => {
          const buffer = Buffer.concat(chunks);
          resolve(`data:audio/mp3;base64,${buffer.toString("base64")}`);
        })
        .on("error", reject);
    });
  }

  async saveToMp3(audio: ArrayBuffer, filePath: string): Promise<string> {
    const inputStream = new Readable();
    inputStream.push(Buffer.from(audio));
    inputStream.push(null);

    return new Promise((resolve, reject) => {
      const command = this.getAudioCommand(inputStream)
        .audioCodec("libmp3lame")
        .audioBitrate(128)
        .audioChannels(2)
        .toFormat("mp3");

      if (FFMpeg.gpuAccelerated) {
        command.outputOptions([
          '-c:a aac',
          '-b:a 128k'
        ]);
      }

      command
        .on("end", () => {
          logger.debug("MP3 conversion complete", {
            filePath,
            gpuAccelerated: FFMpeg.gpuAccelerated
          });
          resolve(filePath);
        })
        .on("error", reject)
        .save(filePath);
    });
  }
}
