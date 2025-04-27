import { execSync } from 'child_process';
import fs from 'fs-extra';
import path from 'path';
import { Config } from "../../config";
import type { Caption } from "../../types/shorts";
import { logger } from "../../logger";

export class Whisper {
  constructor(private config: Config) {}

  static async init(config: Config): Promise<Whisper> {
    if (!config.runningInDocker) {
      logger.debug("Setting up Whisper for T4 GPU");
      
      try {
        // Install required dependencies for GPU support
        execSync('pip install faster-whisper torch torchaudio --upgrade', { stdio: 'inherit' });
        
        // Verify CUDA is available
        const cudaCheck = execSync('python -c "import torch; print(torch.cuda.is_available())"').toString().trim();
        if (cudaCheck !== 'True') {
          throw new Error('CUDA is not available. Please ensure you are using a GPU runtime in Colab.');
        }
        
        logger.debug("Whisper GPU setup complete");
      } catch (error) {
        logger.error({ error }, "Failed to setup Whisper with GPU support");
        throw error;
      }
    }

    return new Whisper(config);
  }

  async CreateCaption(audioPath: string): Promise<Caption[]> {
    logger.debug({ audioPath }, "Starting to transcribe audio with GPU acceleration");
    
    try {
      // Create a temporary Python script to run the transcription
      const scriptPath = path.join(this.config.whisperInstallPath, 'transcribe_gpu.py');
      
      const pythonScript = `
from faster_whisper import WhisperModel
import json
import sys

model_size = "${this.config.whisperModel}"
audio_path = "${audioPath}"

# Run on GPU with FP16
model = WhisperModel(model_size, device="cuda", compute_type="float16")

segments, info = model.transcribe(audio_path, word_timestamps=True)

output = []
for segment in segments:
    for word in segment.words:
        output.append({
            "text": word.word,
            "start": word.start * 1000,  # convert to ms
            "end": word.end * 1000      # convert to ms
        })

print(json.dumps(output))
      `;

      await fs.writeFile(scriptPath, pythonScript);
      
      // Execute the Python script
      const output = execSync(`python ${scriptPath}`).toString();
      const words = JSON.parse(output) as Array<{text: string, start: number, end: number}>;
      
      logger.debug({ audioPath }, "Transcription finished, creating captions");
      
      // Convert to Caption format
      const captions: Caption[] = words.map(word => ({
        text: word.text,
        startMs: Math.round(word.start),
        endMs: Math.round(word.end)
      }));
      
      logger.debug({ audioPath }, "Captions created");
      return captions;
    } catch (error) {
      logger.error({ error, audioPath }, "Failed to transcribe audio");
      throw error;
    }
  }
}
