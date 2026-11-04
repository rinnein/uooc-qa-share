export const EMBEDDING_MODEL_METADATA = {
  name: "BGE-small-zh-v1.5 (量化版)",
  title: "需要安装本地 Embedding 模型",
  description:
    "UOOC 题库检索与语义相似度计算（BGE-small-zh-v1.5 量化版）需要本地向量模型，支持离线高速向量特征计算。",
  downloadCommand: "download_embedding_model",
  settingsFocus: "embedding",
  repository: "https://huggingface.co/Xenova/bge-small-zh-v1.5",
  revision: "75c43b069aac4d136ba6bc1122f995fedcfd2781",
  file: "onnx/model_quantized.onnx",
  sha256: "15b717c382bcb518ba457b93ea6850ede7f4f1cd8937454aa06972366cd19bcc",
  bytes: 24010842,
  url: "https://huggingface.co/Xenova/bge-small-zh-v1.5/resolve/main/onnx/model_quantized.onnx",
} as const;

export const MIRROR_OPTIONS = [
  // 镜像源未配置CORS
  // { label: "HF-Mirror (镜像1)", value: "https://hf-mirror.com/" },
  // { label: "HF-Mirror (镜像2)", value: "https://hf-mirror.net/" },
  { label: "HuggingFace (官方源)", value: "https://huggingface.co/" },
] as const;

export interface ProgressData {
  status: "initiate" | "download" | "progress" | "done" | "ready";
  name?: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

const STORAGE_KEYS = {
  ENHANCED_SEARCH: "uooc_enhanced_search_enabled",
  MIRROR: "uooc_model_mirror",
  MODEL_INSTALLED: "uooc_model_installed",
};

// Singleton pipeline instance and promise
let pipelineInstance: any = null;
let initPromise: Promise<any> | null = null;

export function getEnhancedSearchEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORAGE_KEYS.ENHANCED_SEARCH) === "true";
}

export function setEnhancedSearchEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEYS.ENHANCED_SEARCH, String(enabled));
}

export function getSelectedMirror(): string {
  if (typeof window === "undefined") return MIRROR_OPTIONS[0].value;
  return localStorage.getItem(STORAGE_KEYS.MIRROR) ?? MIRROR_OPTIONS[0].value;
}

export function setSelectedMirror(mirrorUrl: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEYS.MIRROR, mirrorUrl);
}

export function isModelLoaded(): boolean {
  return pipelineInstance !== null;
}

/**
 * Check whether the model file is already saved in the browser Cache API or marked as installed.
 */
export async function checkModelCached(): Promise<boolean> {
  if (typeof window === "undefined" || !("caches" in window)) {
    return false;
  }
  try {
    const cache = await caches.open("transformers-cache");
    const requests = await cache.keys();
    const hasQuantizedModel = requests.some((req) => req.url.includes("model_quantized.onnx"));
    if (hasQuantizedModel) {
      localStorage.setItem(STORAGE_KEYS.MODEL_INSTALLED, "true");
      return true;
    }
  } catch (err) {
    console.warn("Failed to inspect browser cache:", err);
  }
  return localStorage.getItem(STORAGE_KEYS.MODEL_INSTALLED) === "true";
}

/**
 * Remove cached model files from Cache API and reset pipeline.
 */
export async function clearModelCache(): Promise<void> {
  pipelineInstance = null;
  initPromise = null;
  if (typeof window !== "undefined") {
    localStorage.removeItem(STORAGE_KEYS.MODEL_INSTALLED);
    setEnhancedSearchEnabled(false);
    if ("caches" in window) {
      try {
        await caches.delete("transformers-cache");
      } catch (err) {
        console.warn("Failed to delete transformers-cache:", err);
      }
    }
  }
}

/**
 * Load the BGE-small-zh-v1.5 embedding pipeline with progress reporting.
 */
export async function loadEmbeddingPipeline(
  onProgress?: (data: ProgressData) => void,
): Promise<any> {
  if (pipelineInstance) {
    onProgress?.({ status: "ready" });
    return pipelineInstance;
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      const { pipeline, env } = await import("@huggingface/transformers");

      // Configure HuggingFace environment
      env.allowLocalModels = false;
      env.useBrowserCache = true;
      env.remoteHost = getSelectedMirror();

      const extractor = await pipeline("feature-extraction", "Xenova/bge-small-zh-v1.5", {
        dtype: "q8",
        revision: EMBEDDING_MODEL_METADATA.revision,
        progress_callback: (progress: any) => {
          if (progress && onProgress) {
            onProgress(progress as ProgressData);
          }
        },
      });

      pipelineInstance = extractor;
      if (typeof window !== "undefined") {
        localStorage.setItem(STORAGE_KEYS.MODEL_INSTALLED, "true");
      }
      onProgress?.({ status: "ready" });
      return extractor;
    } catch (err) {
      pipelineInstance = null;
      initPromise = null;
      throw err;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

/**
 * Compute 512-dimension vector embedding for search query text.
 */
export async function computeTextEmbedding(
  text: string,
  onProgress?: (data: ProgressData) => void,
): Promise<number[]> {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  const extractor = await loadEmbeddingPipeline(onProgress);
  const output = await extractor(trimmed, {
    pooling: "mean",
    normalize: true,
  });

  const rawData = output.data ?? output.tolist?.()?.[0];
  const vector = Array.from(rawData) as number[];

  if (vector.length !== 512) {
    throw new Error(`计算的向量维度异常: 期望 512, 实际获取 ${vector.length}`);
  }

  return vector;
}
