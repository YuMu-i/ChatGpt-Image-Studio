"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Eraser, History, ImagePlus, LoaderCircle, Sparkles, Trash2, Upload, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { AppImage } from "@/components/app-image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteImageConversation,
  listImageConversations,
  saveImageConversation,
  type ImageConversation,
  type ImageConversationTurn,
  type ImageMode,
  type StoredImage,
  type StoredSourceImage,
} from "@/store/image-conversations";
import {
  editImage,
  fetchAccountQuota,
  fetchPortalWorkspaceBootstrap,
  generateImageWithOptions,
  type Account,
  type ImageQuality,
  upscaleImage,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const modeOptions: Array<{ value: ImageMode; label: string; description: string }> = [
  { value: "generate", label: "生成", description: "输入提示词，或上传参考图辅助生成" },
  { value: "edit", label: "编辑", description: "上传图片并根据提示词修改画面" },
  { value: "upscale", label: "放大", description: "提升清晰度并放大细节" },
];

const sizeOptions = [
  { value: "1024x1024", label: "1:1 标准" },
  { value: "1536x1024", label: "3:2 横向" },
  { value: "1024x1536", label: "2:3 纵向" },
];

const qualityOptions: Array<{ value: ImageQuality; label: string }> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const countOptions = ["1", "2", "3", "4"];
const upscaleOptions = ["2x", "4x"];

type WorkspaceConfig = {
  allowDisabledStudioAccounts: boolean;
};

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getImageRemaining(account: Account) {
  const limit = account.limits_progress?.find((item) => item.feature_name === "image_gen");
  if (typeof limit?.remaining === "number") {
    return Math.max(0, limit.remaining);
  }
  return Math.max(0, account.quota);
}

function isImageAccountUsable(account: Account, allowDisabled: boolean) {
  const disabled = Boolean(account.disabled) || account.status === "禁用";
  return (!disabled || allowDisabled) && account.status !== "异常" && account.status !== "限流" && getImageRemaining(account) > 0;
}

function formatAvailableQuota(accounts: Account[], allowDisabled: boolean) {
  return String(accounts.filter((item) => isImageAccountUsable(item, allowDisabled)).reduce((sum, item) => sum + getImageRemaining(item), 0));
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

function dataUrlToFile(dataUrl: string, filename: string) {
  const [header, content] = dataUrl.split(",", 2);
  const mime = /data:(.*?);base64/.exec(header || "")?.[1] || "image/png";
  const bytes = Uint8Array.from(atob(content || ""), (char) => char.charCodeAt(0));
  return new File([bytes], filename, { type: mime });
}

function createLoadingImages(count: number, turnId: string): StoredImage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${turnId}-${index + 1}`,
    status: "loading",
  }));
}

function buildSourceImage(file: File, dataUrl: string): StoredSourceImage {
  return {
    id: makeId(),
    role: "image",
    name: file.name,
    dataUrl,
  };
}

function buildConversationTitle(mode: ImageMode, prompt: string) {
  const prefix = mode === "generate" ? "生成" : mode === "edit" ? "编辑" : "放大";
  return `${prefix} · ${prompt.trim().slice(0, 24) || "图片任务"}`;
}

export default function ImagePage() {
  const mountedRef = useRef(true);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const [mode, setMode] = useState<ImageMode>("generate");
  const [prompt, setPrompt] = useState("");
  const [imageCount, setImageCount] = useState("1");
  const [imageSize, setImageSize] = useState("1024x1024");
  const [imageQuality, setImageQuality] = useState<ImageQuality>("high");
  const [upscaleScale, setUpscaleScale] = useState("2x");
  const [sourceImages, setSourceImages] = useState<StoredSourceImage[]>([]);
  const [conversations, setConversations] = useState<ImageConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [workspaceConfig, setWorkspaceConfig] = useState<WorkspaceConfig>({ allowDisabledStudioAccounts: false });
  const [isQuotaLoading, setIsQuotaLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedConversation = useMemo(
    () => conversations.find((item) => item.id === selectedConversationId) ?? conversations[0] ?? null,
    [conversations, selectedConversationId],
  );

  const availableQuota = useMemo(
    () => (isQuotaLoading ? "加载中" : formatAvailableQuota(accounts, workspaceConfig.allowDisabledStudioAccounts)),
    [accounts, isQuotaLoading, workspaceConfig.allowDisabledStudioAccounts],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const [history, bootstrap] = await Promise.all([listImageConversations(), fetchPortalWorkspaceBootstrap()]);
        if (!mountedRef.current) {
          return;
        }
        setConversations(history);
        setSelectedConversationId(history[0]?.id ?? null);
        setAccounts(bootstrap.accounts);
        setWorkspaceConfig({
          allowDisabledStudioAccounts: bootstrap.workspace.allow_disabled_studio_accounts,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "初始化工作台失败";
        toast.error(message);
      } finally {
        if (mountedRef.current) {
          setIsQuotaLoading(false);
        }
      }
    };

    void load();
  }, []);

  const refreshAccountQuotaFromResults = async (images: StoredImage[]) => {
    const sourceAccountId =
      images.find((item) => item.source_account_id)?.source_account_id;
    if (!sourceAccountId) {
      return;
    }

    try {
      const quota = await fetchAccountQuota(sourceAccountId, { refresh: false });
      if (!mountedRef.current) {
        return;
      }
      setAccounts((current) =>
        current.map((account) =>
          account.id === sourceAccountId
            ? {
                ...account,
                status: quota.status,
                type: quota.type,
                quota: quota.quota,
                restoreAt: quota.image_gen_reset_after || account.restoreAt,
                limits_progress: [
                  ...(account.limits_progress || []).filter((item) => item.feature_name !== "image_gen"),
                  {
                    feature_name: "image_gen",
                    remaining: typeof quota.image_gen_remaining === "number" ? quota.image_gen_remaining : undefined,
                    reset_after: quota.image_gen_reset_after || undefined,
                  },
                ],
              }
            : account,
        ),
      );
    } catch {
      // Best effort only.
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }

    try {
      const next = await Promise.all(Array.from(files).map(async (file) => buildSourceImage(file, await fileToDataUrl(file))));
      setSourceImages((current) => [...current, ...next]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取图片失败";
      toast.error(message);
    }
  };

  const handleDeleteConversation = async (conversationId: string) => {
    await deleteImageConversation(conversationId);
    const next = conversations.filter((item) => item.id !== conversationId);
    setConversations(next);
    setSelectedConversationId(next[0]?.id ?? null);
  };

  const handleClearHistory = async () => {
    for (const item of conversations) {
      await deleteImageConversation(item.id);
    }
    setConversations([]);
    setSelectedConversationId(null);
  };

  const handleSubmit = async () => {
    const trimmedPrompt = prompt.trim();
    if (mode !== "upscale" && !trimmedPrompt) {
      toast.error("请输入提示词");
      return;
    }
    if ((mode === "edit" || mode === "upscale") && sourceImages.length === 0) {
      toast.error(mode === "edit" ? "编辑模式至少需要一张图片" : "放大模式至少需要一张图片");
      return;
    }

    const now = new Date().toISOString();
    const turnId = makeId();
    const count = mode === "generate" && sourceImages.length === 0 ? Math.max(1, Number(imageCount) || 1) : 1;
    const loadingImages = createLoadingImages(count, turnId);
    const conversation: ImageConversation = {
      id: makeId(),
      title: buildConversationTitle(mode, trimmedPrompt || "图片放大"),
      mode,
      prompt: trimmedPrompt,
      model: "gpt-image-2",
      count,
      scale: mode === "upscale" ? upscaleScale : undefined,
      sourceImages,
      images: loadingImages,
      createdAt: now,
      status: "generating",
      turns: [
        {
          id: turnId,
          title: buildConversationTitle(mode, trimmedPrompt || "图片放大"),
          mode,
          prompt: trimmedPrompt,
          model: "gpt-image-2",
          count,
          scale: mode === "upscale" ? upscaleScale : undefined,
          sourceImages,
          images: loadingImages,
          createdAt: now,
          status: "generating",
        } satisfies ImageConversationTurn,
      ],
    };

    setIsSubmitting(true);
    setConversations((current) => [conversation, ...current]);
    setSelectedConversationId(conversation.id);
    await saveImageConversation(conversation);

    try {
      let resultImages: StoredImage[] = [];
      if (mode === "generate") {
        if (sourceImages.length > 0) {
          const files = await Promise.all(sourceImages.map((item) => dataUrlToFile(item.dataUrl, item.name)));
          const payload = await editImage({
            prompt: trimmedPrompt,
            images: files,
            model: "gpt-image-2",
          });
          resultImages = (payload.data || []).map((item, index) => ({
            id: `${turnId}-${index + 1}`,
            status: item.b64_json || item.url ? "success" : "error",
            ...item,
          }));
        } else {
          const payload = await generateImageWithOptions(trimmedPrompt, {
            model: "gpt-image-2",
            count,
            size: imageSize,
            quality: imageQuality,
          });
          resultImages = (payload.data || []).map((item, index) => ({
            id: `${turnId}-${index + 1}`,
            status: item.b64_json || item.url ? "success" : "error",
            ...item,
          }));
        }
      } else if (mode === "edit") {
        const files = await Promise.all(sourceImages.map((item) => dataUrlToFile(item.dataUrl, item.name)));
        const payload = await editImage({
          prompt: trimmedPrompt,
          images: files,
          model: "gpt-image-2",
        });
        resultImages = (payload.data || []).map((item, index) => ({
          id: `${turnId}-${index + 1}`,
          status: item.b64_json || item.url ? "success" : "error",
          ...item,
        }));
      } else {
        const file = await dataUrlToFile(sourceImages[0].dataUrl, sourceImages[0].name);
        const payload = await upscaleImage({
          image: file,
          prompt: trimmedPrompt,
          scale: upscaleScale,
          model: "gpt-image-2",
        });
        resultImages = (payload.data || []).map((item, index) => ({
          id: `${turnId}-${index + 1}`,
          status: item.b64_json || item.url ? "success" : "error",
          ...item,
        }));
      }

      const hasFailure = resultImages.some((item) => item.status === "error");
      const nextConversation: ImageConversation = {
        ...conversation,
        images: resultImages,
        status: hasFailure ? "error" : "success",
        error: hasFailure ? "部分图片处理失败" : undefined,
        turns: [
          {
            ...(conversation.turns?.[0] as ImageConversationTurn),
            images: resultImages,
            status: hasFailure ? "error" : "success",
            error: hasFailure ? "部分图片处理失败" : undefined,
          },
        ],
      };

      await saveImageConversation(nextConversation);
      if (!mountedRef.current) {
        return;
      }
      setConversations((current) => [nextConversation, ...current.filter((item) => item.id !== nextConversation.id)]);
      setPrompt("");
      setSourceImages([]);
      void refreshAccountQuotaFromResults(resultImages);
      toast.success(mode === "generate" ? "图片已生成" : mode === "edit" ? "图片已编辑" : "图片已放大");
    } catch (error) {
      const message = error instanceof Error ? error.message : "图片任务失败";
      const failedImages = loadingImages.map((item) => ({
        ...item,
        status: "error" as const,
        error: message,
      }));
      const failedConversation: ImageConversation = {
        ...conversation,
        images: failedImages,
        status: "error",
        error: message,
        turns: [
          {
            ...(conversation.turns?.[0] as ImageConversationTurn),
            images: failedImages,
            status: "error",
            error: message,
          },
        ],
      };
      await saveImageConversation(failedConversation);
      if (mountedRef.current) {
        setConversations((current) => [failedConversation, ...current.filter((item) => item.id !== failedConversation.id)]);
      }
      toast.error(message);
    } finally {
      if (mountedRef.current) {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <section className="grid h-full min-h-0 grid-cols-1 gap-3 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col overflow-hidden rounded-[30px] border border-stone-200 bg-[#f0f0ed] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
        <div className="flex items-center justify-between px-2 py-2">
          <div>
            <div className="text-sm font-semibold text-stone-900">最近任务</div>
            <div className="mt-1 text-xs text-stone-500">本地保存的生成与编辑历史</div>
          </div>
          <History className="size-4 text-stone-500" />
        </div>

        <div className="mt-3 flex gap-2">
          <Button
            variant="outline"
            className="flex-1 rounded-2xl bg-white"
            onClick={() => setSelectedConversationId(null)}
          >
            新建任务
          </Button>
          <Button
            variant="outline"
            className="rounded-2xl bg-white"
            onClick={() => void handleClearHistory()}
            disabled={conversations.length === 0}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>

        <div className="hide-scrollbar mt-4 min-h-0 flex-1 overflow-auto">
          {conversations.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-stone-300 bg-white/70 px-4 py-6 text-center text-sm text-stone-500">
              还没有历史记录，先提交一个图片任务吧。
            </div>
          ) : (
            <div className="space-y-2">
              {conversations.map((item) => {
                const active = item.id === selectedConversation?.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedConversationId(item.id)}
                    className={cn(
                      "w-full rounded-2xl border px-4 py-4 text-left transition",
                      active ? "border-stone-900 bg-white shadow-sm" : "border-transparent bg-white/75 hover:border-stone-200 hover:bg-white",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-stone-900">{item.title}</div>
                        <div className="mt-1 truncate text-xs text-stone-500">{item.prompt || "图片放大任务"}</div>
                      </div>
                      <button
                        type="button"
                        className="shrink-0 rounded-full p-1 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700"
                        onClick={async (event) => {
                          event.stopPropagation();
                          await handleDeleteConversation(item.id);
                        }}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-stone-400">
                      <span>{formatDate(item.createdAt)}</span>
                      <span>{item.status === "success" ? "已完成" : item.status === "error" ? "失败" : "处理中"}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      <div className="flex min-h-0 flex-col overflow-hidden rounded-[30px] border border-stone-200 bg-white shadow-[0_14px_40px_rgba(15,23,42,0.05)]">
        <div className="flex items-center justify-between border-b border-stone-100 px-6 py-5">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-stone-950">图片工作台</h1>
            <p className="mt-1 text-sm text-stone-500">保留当前项目的工作流节奏，面向多人共享使用。</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-right">
            <div className="text-xs uppercase tracking-[0.18em] text-stone-400">可用额度</div>
            <div className="mt-1 text-lg font-semibold text-stone-950">{availableQuota}</div>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-3 p-3 xl:grid-cols-[minmax(0,1.2fr)_420px]">
          <div className="min-h-0 overflow-hidden rounded-[26px] border border-stone-200 bg-[#fcfcfb]">
            <div className="hide-scrollbar h-full overflow-auto p-5">
              {!selectedConversation ? (
                <div className="grid min-h-[420px] place-items-center rounded-[24px] border border-dashed border-stone-200 bg-white/80 p-8 text-center">
                  <div className="max-w-[460px]">
                    <div className="mx-auto inline-flex size-14 items-center justify-center rounded-2xl bg-stone-950 text-white shadow-sm">
                      <Sparkles className="size-5" />
                    </div>
                    <h2 className="mt-5 text-2xl font-semibold tracking-tight text-stone-950">从这里开始一条新的图片任务</h2>
                    <p className="mt-3 text-sm leading-7 text-stone-500">
                      你可以生成新图、上传图片编辑，或者直接放大已有图片。任务完成后会自动进入左侧历史列表。
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="rounded-[24px] border border-stone-200 bg-white p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-sm font-medium text-stone-900">{selectedConversation.title}</div>
                        <div className="mt-2 text-sm leading-7 text-stone-600">
                          {selectedConversation.prompt || "图片放大任务"}
                        </div>
                      </div>
                      <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-medium text-stone-600">
                        {selectedConversation.mode === "generate" ? "生成" : selectedConversation.mode === "edit" ? "编辑" : "放大"}
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    {selectedConversation.images.map((image) => (
                      <div key={image.id} className="overflow-hidden rounded-[24px] border border-stone-200 bg-white">
                        <div className="aspect-square bg-stone-100">
                          {image.b64_json ? (
                            <AppImage
                              src={`data:image/png;base64,${image.b64_json}`}
                              alt="result"
                              className="h-full w-full object-cover"
                            />
                          ) : image.url ? (
                            <AppImage src={image.url} alt="result" className="h-full w-full object-cover" />
                          ) : (
                            <div className="grid h-full place-items-center text-sm text-stone-500">
                              {image.status === "loading" ? (
                                <div className="flex items-center gap-3">
                                  <LoaderCircle className="size-4 animate-spin" />
                                  正在生成图片...
                                </div>
                              ) : (
                                image.error || "图片处理失败"
                              )}
                            </div>
                          )}
                        </div>
                        <div className="border-t border-stone-100 px-4 py-3 text-xs text-stone-500">
                          {image.revised_prompt || selectedConversation.prompt || "图片结果"}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="hide-scrollbar min-h-0 overflow-auto rounded-[26px] border border-stone-200 bg-[#faf9f7] p-5">
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2 rounded-2xl bg-white p-1 shadow-sm">
                {modeOptions.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={cn(
                      "rounded-xl px-3 py-3 text-left transition",
                      mode === item.value ? "bg-stone-950 text-white" : "text-stone-600 hover:bg-stone-50",
                    )}
                    onClick={() => setMode(item.value)}
                    disabled={isSubmitting}
                  >
                    <div className="text-sm font-medium">{item.label}</div>
                    <div className={cn("mt-1 text-xs leading-5", mode === item.value ? "text-white/72" : "text-stone-400")}>
                      {item.description}
                    </div>
                  </button>
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {mode === "generate" ? (
                  <>
                    <label className="space-y-2 text-sm font-medium text-stone-700">
                      图片数量
                      <select
                        value={imageCount}
                        onChange={(event) => setImageCount(event.target.value)}
                        className="h-11 w-full rounded-2xl border border-stone-200 bg-white px-4 text-sm font-normal text-stone-700 outline-none"
                      >
                        {countOptions.map((item) => (
                          <option key={item} value={item}>
                            {item} 张
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-2 text-sm font-medium text-stone-700">
                      分辨率
                      <select
                        value={imageSize}
                        onChange={(event) => setImageSize(event.target.value)}
                        className="h-11 w-full rounded-2xl border border-stone-200 bg-white px-4 text-sm font-normal text-stone-700 outline-none"
                      >
                        {sizeOptions.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                ) : null}

                {mode === "generate" ? (
                  <label className="space-y-2 text-sm font-medium text-stone-700">
                    质量
                    <select
                      value={imageQuality}
                      onChange={(event) => setImageQuality(event.target.value as ImageQuality)}
                      className="h-11 w-full rounded-2xl border border-stone-200 bg-white px-4 text-sm font-normal text-stone-700 outline-none"
                    >
                      {qualityOptions.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {mode === "upscale" ? (
                  <label className="space-y-2 text-sm font-medium text-stone-700">
                    放大倍数
                    <select
                      value={upscaleScale}
                      onChange={(event) => setUpscaleScale(event.target.value)}
                      className="h-11 w-full rounded-2xl border border-stone-200 bg-white px-4 text-sm font-normal text-stone-700 outline-none"
                    >
                      {upscaleOptions.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>

              <label className="block space-y-2 text-sm font-medium text-stone-700">
                提示词
                <Textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder={mode === "upscale" ? "可选：补充增强细节或风格要求" : "描述你想生成或修改的画面"}
                  className="min-h-[180px] rounded-[24px] border-stone-200 bg-white px-4 py-4 text-[15px] leading-7 shadow-none focus-visible:ring-1"
                />
              </label>

              <div className="space-y-3 rounded-[24px] border border-stone-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-stone-900">
                      {mode === "generate" ? "参考图" : mode === "edit" ? "待编辑图片" : "待放大图片"}
                    </div>
                    <div className="mt-1 text-xs text-stone-500">
                      {mode === "generate" ? "可选上传参考图辅助风格和构图" : "支持拖入或点击上传图片"}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    className="rounded-2xl"
                    onClick={() => uploadInputRef.current?.click()}
                    disabled={isSubmitting}
                  >
                    <Upload className="size-4" />
                    上传图片
                  </Button>
                </div>

                <input
                  ref={uploadInputRef}
                  type="file"
                  accept="image/*"
                  multiple={mode !== "upscale"}
                  className="hidden"
                  onChange={(event) => {
                    void handleFiles(event.target.files);
                    event.currentTarget.value = "";
                  }}
                />

                {sourceImages.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-stone-200 bg-stone-50 px-4 py-8 text-center text-sm text-stone-500">
                    <ImagePlus className="mx-auto mb-3 size-5 text-stone-400" />
                    暂未上传图片
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {sourceImages.map((item) => (
                      <div key={item.id} className="overflow-hidden rounded-2xl border border-stone-200 bg-stone-50">
                        <div className="aspect-square">
                          <AppImage src={item.dataUrl} alt={item.name} className="h-full w-full object-cover" />
                        </div>
                        <div className="flex items-center justify-between gap-3 px-3 py-3">
                          <div className="min-w-0 truncate text-xs text-stone-500">{item.name}</div>
                          <button
                            type="button"
                            className="rounded-full p-1 text-stone-400 transition hover:bg-white hover:text-stone-700"
                            onClick={() => setSourceImages((current) => current.filter((image) => image.id !== item.id))}
                          >
                            <Eraser className="size-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Button
                className="h-12 w-full rounded-[20px] bg-stone-950 text-white hover:bg-stone-800"
                onClick={() => void handleSubmit()}
                disabled={isSubmitting}
              >
                {isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
                {mode === "generate" ? "提交生成" : mode === "edit" ? "提交编辑" : "开始放大"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
