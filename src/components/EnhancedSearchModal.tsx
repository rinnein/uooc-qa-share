import { useState, useEffect } from "react";
import { Dialog } from "@base-ui/react";
import {
  Sparkles,
  Download,
  CheckCircle2,
  AlertCircle,
  Trash2,
  X,
  ExternalLink,
  Loader2,
  HardDrive,
  Copy,
  Check,
} from "lucide-react";
import {
  EMBEDDING_MODEL_METADATA,
  MIRROR_OPTIONS,
  checkModelCached,
  clearModelCache,
  getSelectedMirror,
  isModelLoaded,
  loadEmbeddingPipeline,
  setEnhancedSearchEnabled,
  setSelectedMirror,
  type ProgressData,
} from "@/lib/client-embedding";

interface EnhancedSearchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}

export default function EnhancedSearchModal({
  open,
  onOpenChange,
  enabled,
  onEnabledChange,
}: EnhancedSearchModalProps) {
  const [isCached, setIsCached] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadLoaded, setDownloadLoaded] = useState(0);
  const [downloadTotal, setDownloadTotal] = useState(0);
  const [currentFile, setCurrentFile] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [mirror, setMirror] = useState<string>(getSelectedMirror());
  const [copiedSha, setCopiedSha] = useState(false);

  useEffect(() => {
    if (open) {
      void checkModelCached().then((cached) => {
        setIsCached(cached || isModelLoaded());
      });
      setMirror(getSelectedMirror());
      setErrorMsg(null);
    }
  }, [open]);

  function handleMirrorChange(newMirror: string) {
    setMirror(newMirror);
    setSelectedMirror(newMirror);
  }

  async function handleDownloadAndLoad() {
    setDownloading(true);
    setErrorMsg(null);
    setDownloadProgress(0);
    setDownloadLoaded(0);
    setDownloadTotal(EMBEDDING_MODEL_METADATA.bytes);
    setCurrentFile(EMBEDDING_MODEL_METADATA.file);

    try {
      await loadEmbeddingPipeline((data: ProgressData) => {
        if (data.status === "progress") {
          if (data.file) setCurrentFile(data.file);
          if (typeof data.progress === "number") {
            setDownloadProgress(Math.min(100, Math.max(0, data.progress)));
          }
          if (typeof data.loaded === "number") {
            setDownloadLoaded(data.loaded);
          }
          if (typeof data.total === "number" && data.total > 0) {
            setDownloadTotal(data.total);
          }
        } else if (data.status === "ready" || data.status === "done") {
          setDownloadProgress(100);
        }
      });

      setIsCached(true);
      setEnhancedSearchEnabled(true);
      onEnabledChange(true);
    } catch (err: any) {
      console.error("Model download/initialization failed:", err);
      setErrorMsg(err?.message || "模型下载或加载失败，请检查网络或切换下载镜像源后重试。");
    } finally {
      setDownloading(false);
    }
  }

  async function handleClearCache() {
    if (!confirm("确定要删除本地保存的 Embedding 模型缓存吗？删除后需重新下载。")) {
      return;
    }
    await clearModelCache();
    setIsCached(false);
    onEnabledChange(false);
  }

  function handleToggleEnabled() {
    const next = !enabled;
    setEnhancedSearchEnabled(next);
    onEnabledChange(next);
  }

  function copySha256() {
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(EMBEDDING_MODEL_METADATA.sha256);
      setCopiedSha(true);
      setTimeout(() => setCopiedSha(false), 2000);
    }
  }

  const formattedSize = (EMBEDDING_MODEL_METADATA.bytes / (1024 * 1024)).toFixed(1);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in" />
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <Dialog.Popup className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto text-card-foreground animate-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <Dialog.Title className="text-lg font-bold leading-tight">
                    {EMBEDDING_MODEL_METADATA.title}
                  </Dialog.Title>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {EMBEDDING_MODEL_METADATA.name}
                  </p>
                </div>
              </div>
              <Dialog.Close className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                <X className="w-5 h-5" />
              </Dialog.Close>
            </div>

            {/* Description */}
            <Dialog.Description className="text-sm text-muted-foreground leading-relaxed">
              {EMBEDDING_MODEL_METADATA.description}
            </Dialog.Description>

            {/* Model Info Details */}
            <div className="rounded-xl border border-border/80 bg-muted/40 p-4 space-y-2.5 text-xs">
              <div className="flex justify-between items-center py-0.5">
                <span className="text-muted-foreground">模型架构</span>
                <span className="font-medium text-foreground">
                  BAAI / BGE-small-zh-v1.5 (512维)
                </span>
              </div>
              <div className="flex justify-between items-center py-0.5">
                <span className="text-muted-foreground">量化文件</span>
                <span className="font-mono text-foreground font-medium">
                  {EMBEDDING_MODEL_METADATA.file} ({formattedSize} MB)
                </span>
              </div>
              <div className="flex justify-between items-center py-0.5">
                <span className="text-muted-foreground">模型来源</span>
                <a
                  href={EMBEDDING_MODEL_METADATA.repository}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1 font-medium"
                >
                  HuggingFace Hub <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <div className="flex justify-between items-center py-0.5">
                <span className="text-muted-foreground">SHA-256</span>
                <button
                  type="button"
                  onClick={copySha256}
                  className="font-mono text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 bg-background/80 px-2 py-0.5 rounded border border-border"
                  title="点击复制 SHA-256"
                >
                  {EMBEDDING_MODEL_METADATA.sha256.slice(0, 12)}...
                  {EMBEDDING_MODEL_METADATA.sha256.slice(-6)}
                  {copiedSha ? (
                    <Check className="w-3 h-3 text-green-500" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                </button>
              </div>
            </div>

            {/* Mirror Selection */}
            {!isCached && !downloading && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">下载源加速选项</label>
                <div className="grid grid-cols-2 gap-2">
                  {MIRROR_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => handleMirrorChange(opt.value)}
                      className={`text-xs px-3 py-2 rounded-lg border text-left transition-colors font-medium ${
                        mirror === opt.value
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:bg-muted text-muted-foreground"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Error Message */}
            {errorMsg && (
              <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-xs text-destructive border border-destructive/20">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="space-y-1 flex-1">
                  <p className="font-semibold">下载或加载失败</p>
                  <p>{errorMsg}</p>
                </div>
              </div>
            )}

            {/* Download Progress Bar */}
            {downloading && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium flex items-center gap-1.5 text-primary">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    正在下载模型文件 ({currentFile || "准备中..."})
                  </span>
                  <span className="font-semibold text-foreground">
                    {Math.round(downloadProgress)}%
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all duration-200 ease-out"
                    style={{ width: `${downloadProgress}%` }}
                  />
                </div>
                {downloadTotal > 0 && (
                  <div className="flex justify-between text-[11px] text-muted-foreground">
                    <span>已完成: {(downloadLoaded / (1024 * 1024)).toFixed(1)} MB</span>
                    <span>预计总大小: {(downloadTotal / (1024 * 1024)).toFixed(1)} MB</span>
                  </div>
                )}
              </div>
            )}

            {/* Actions & Status */}
            {isCached ? (
              <div className="space-y-4 pt-1">
                <div className="flex items-center justify-between p-3.5 rounded-xl border border-green-500/20 bg-green-500/5">
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0" />
                    <div>
                      <div className="text-sm font-semibold text-foreground">本地模型已就绪</div>
                      <div className="text-xs text-muted-foreground">
                        已缓存至浏览器，支持离线 512 维向量特征提取
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleToggleEnabled}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      enabled ? "bg-primary" : "bg-muted"
                    }`}
                    role="switch"
                    aria-checked={enabled}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                        enabled ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between text-xs pt-1">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <HardDrive className="w-3.5 h-3.5" />
                    已占用存储空间约 {formattedSize} MB
                  </span>
                  <button
                    type="button"
                    onClick={handleClearCache}
                    className="inline-flex items-center gap-1 text-destructive hover:underline font-medium"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    清空本地模型缓存
                  </button>
                </div>
              </div>
            ) : (
              !downloading && (
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleDownloadAndLoad}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
                  >
                    <Download className="w-4 h-4" />
                    下载并安装模型 (~{formattedSize} MB)
                  </button>
                  <p className="text-[11px] text-muted-foreground text-center mt-2">
                    文件仅下载一次并保存在浏览器本地 Cache，不会上传或消耗服务器流量
                  </p>
                </div>
              )
            )}
          </Dialog.Popup>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
