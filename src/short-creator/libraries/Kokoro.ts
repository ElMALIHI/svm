import { InferenceSession, Tensor } from 'onnxruntime-node';
import { join, dirname } from 'path';
import { existsSync, readFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { logger } from "../../config";
import type { Voices } from "../../types/shorts";

// Configuration
const MODEL_NAME = "Kokoro-82M-v1.0";
const MODEL_DIR = join(process.cwd(), 'models'); // Use absolute path
const MODEL_PATH = join(MODEL_DIR, MODEL_NAME);
const MODEL_FILE = join(MODEL_PATH, 'model.onnx');
const CONFIG_FILE = join(MODEL_PATH, 'config.json');

export class Kokoro {
  private session: InferenceSession;
  private config: any;

  constructor(session: InferenceSession, config: any) {
    this.session = session;
    this.config = config;
  }

  async generate(
    text: string,
    voice: Voices,
  ): Promise<{
    audio: ArrayBuffer;
    audioLength: number;
  }> {
    logger.debug({ text, voice }, "Generating audio with Kokoro on GPU");
    
    try {
      // Validate session is initialized
      if (!this.session) {
        throw new Error('Inference session not initialized');
      }

      // Preprocess input text
      const inputIds = this.preprocessText(text, voice);
      
      // Create input tensors
      const inputTensor = new Tensor('int64', inputIds, [1, inputIds.length]);
      
      // Run inference on GPU
      const outputs = await this.session.run({
        input_ids: inputTensor
      }, {
        executionProviders: ['cuda']
      });
      
      // Validate outputs
      if (!outputs || !outputs.audio) {
        throw new Error('Invalid model outputs');
      }
      
      // Postprocess output
      const audioData = this.postprocessAudio(outputs);
      
      logger.debug({ 
        textLength: text.length,
        audioSize: audioData.byteLength 
      }, "Audio generated successfully");
      
      return {
        audio: audioData,
        audioLength: audioData.byteLength / (this.config.sample_rate * 2) // 16-bit audio
      };
    } catch (error) {
      logger.error({ 
        error, 
        textLength: text.length,
        voice 
      }, "Failed to generate audio");
      throw error;
    }
  }

  private preprocessText(text: string, voice: Voices): BigInt64Array {
    if (!text || text.length === 0) {
      throw new Error('Input text cannot be empty');
    }

    // Implement your actual text preprocessing here
    // This is a placeholder implementation
    return new BigInt64Array(
      text.split('').map(c => BigInt(c.charCodeAt(0)))
    );
  }

  private postprocessAudio(outputs: any): ArrayBuffer {
    try {
      const audioData = outputs.audio.data;
      if (!audioData || !audioData.length) {
        throw new Error('Empty audio data received');
      }

      const buffer = new ArrayBuffer(audioData.length * 2);
      const view = new DataView(buffer);
      audioData.forEach((value: number, index: number) => {
        view.setInt16(index * 2, Math.min(32767, Math.max(-32768, value * 32767)), true);
      });
      return buffer;
    } catch (error) {
      logger.error({ error }, "Audio postprocessing failed");
      throw error;
    }
  }

  static async init(): Promise<Kokoro> {
    try {
      // 1. Dependency Installation
      logger.debug("Checking/installing onnxruntime-node...");
      try {
        execSync('npm install onnxruntime-node@latest --save', { 
          stdio: 'inherit',
          cwd: process.cwd()
        });
      } catch (installError) {
        logger.warn({ installError }, "Fallback to global installation");
        execSync('npm install -g onnxruntime-node@latest', { 
          stdio: 'inherit' 
        });
      }
      logger.debug("onnxruntime-node installation verified");

      // 2. Model Directory Setup
      if (!existsSync(MODEL_DIR)) {
        logger.debug(`Creating models directory at ${MODEL_DIR}`);
        mkdirSync(MODEL_DIR, { recursive: true });
      }

      // 3. Model File Verification
      const verifyFile = (path: string) => {
        if (!existsSync(path)) {
          throw new Error(`Model file not found: ${path}`);
        }
        logger.debug(`Found model file: ${path}`);
      };

      verifyFile(MODEL_FILE);
      verifyFile(CONFIG_FILE);

      // 4. Config Loading
      const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
      if (!config.sample_rate) {
        throw new Error('Invalid config file: missing sample_rate');
      }

      // 5. GPU Availability Check
      const providers = await InferenceSession.getAvailableProviders();
      logger.debug(`Available ONNX providers: ${providers.join(', ')}`);
      
      if (!providers.includes('cuda')) {
        throw new Error(
          'CUDA not available. Check:\n' +
          '1. NVIDIA drivers are installed\n' +
          '2. CUDA toolkit is installed\n' +
          '3. You have a compatible GPU\n' +
          '4. onnxruntime-node-gpu package is installed'
        );
      }

      // 6. Session Initialization
      logger.debug("Initializing ONNX session with CUDA...");
      const session = await InferenceSession.create(MODEL_FILE, {
        executionProviders: ['cuda'],
        graphOptimizationLevel: 'all',
        enableCpuMemArena: true,
        enableMemPattern: true,
        logSeverityLevel: 1
      });

      logger.debug("Kokoro TTS successfully initialized with GPU support");
      return new Kokoro(session, config);
    } catch (error) {
      logger.error({
        error,
        modelPath: MODEL_PATH,
        cudaAvailable: process.env.CUDA_PATH ? true : false
      }, "Kokoro initialization failed");
      
      throw new Error(`Failed to initialize Kokoro: ${error.message}`);
    }
  }
}
