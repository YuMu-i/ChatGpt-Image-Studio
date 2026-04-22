"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent } from "react";
import Zoom from "react-medium-image-zoom";
import "react-medium-image-zoom/dist/styles.css";
import {
  ArrowUp,
  Brush,
  Clock3,
  Copy,
  History,
  ImagePlus,
  LoaderCircle,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
  Trash2,
  Upload,
  ZoomIn,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ImageEditModal } from "@/components/image-edit-modal";
import {
  editImage,
  fetchAccounts,
  generateImage,
  upscaleImage,
  type InpaintSourceReference,
  type Account,
  type ImageModel,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  clearImageConversations,
  deleteImageConversation,
  listImageConversations,
  normalizeConversation,
  saveImageConversation,
  updateImageConversation,
  type ImageConversation,
  type ImageConversationTurn,
  type ImageMode,
  type StoredImage,
  type StoredSourceImage,
} from "@/store/image-conversations";
import {
  finishImageTask,
  isImageTaskActive,
  listActiveImageTasks,
  startImageTask,
  subscribeImageTasks,
} from "@/store/image-active-tasks";

const imageModelOptions: Array<{ label: string; value: ImageModel }> = [
  { label: "gpt-image-2", value: "gpt-image-2" },
  { label: "gpt-image-1", value: "gpt-image-1" },
];

const modeOptions: Array<{ label: string; value: ImageMode; description: string }> = [
  { label: "生成", value: "generate", description: "提示词生成新图，也可上传参考图辅助生成" },
  { label: "编辑", value: "edit", description: "上传图像后局部或整体改图" },
  { label: "放大", value: "upscale", description: "提升清晰度并放大细节" },
];

const upscaleOptions = ["2x", "4x"];

const modeLabelMap: Record<ImageMode, string> = {
  generate: "生成",
  edit: "编辑",
  upscale: "放大",
};

const inspirationExamples: Array<{
  id: string;
  title: string;
  prompt: string;
  hint: string;
  model: ImageModel;
  count: number;
  tone: string;
}> = [
  {
    id: "stellar-poster",
    title: "电影感联动海报",
    prompt: "制作一张高完成度的游戏联动海报，主角站在画面中央，远处有发光列车和方块世界入口，整体是电影海报构图，光影强烈，细节丰富，质感精致。",
    hint: "适合做大场景、角色群像、活动宣传图。",
    model: "gpt-image-2",
    count: 1,
    tone: "from-slate-900 via-indigo-900 to-slate-700",
  },
  {
    id: "product-shot",
    title: "极简产品陈列",
    prompt: "创建一张极简高级感的产品展示图，主体置于纯净背景中央，柔和顶光，边缘高光清晰，材质真实，画面留白克制，适合官网首屏视觉。",
    hint: "适合电商主图、产品页首图和发布会视觉。",
    model: "gpt-image-2",
    count: 1,
    tone: "from-stone-950 via-stone-700 to-stone-300",
  },
  {
    id: "editorial-fashion",
    title: "时尚杂志封面",
    prompt: "生成一张时尚杂志封面风格的人像图，主体半身居中，背景极简，色调统一，字体排版预留空间，整体克制、现代、有高级编辑感。",
    hint: "适合封面、人像 KV、品牌主视觉。",
    model: "gpt-image-2",
    count: 1,
    tone: "from-zinc-900 via-rose-800 to-amber-500",
  },
  {
    id: "cozy-isometric",
    title: "治愈系等距小场景",
    prompt: "设计一个等距视角的小型治愈空间，木质家具、柔和灯光、桌面绿植和窗外夜景，整体有轻微手工模型质感，色彩温暖舒适。",
    hint: "适合插画、空间概念和 UI 头图。",
    model: "gpt-image-2",
    count: 1,
    tone: "from-emerald-900 via-teal-700 to-amber-400",
  },
];

type ActiveRequestState = {
  conversationId: string;
  turnId: string;
  mode: ImageMode;
  count: number;
  variant: "standard" | "selection-edit";
};

function buildConversationTitle(mode: ImageMode, prompt: string, scale: string) {
  const trimmed = prompt.trim();
  const prefix = mode === "generate" ? "生成" : mode === "edit" ? "编辑" : `放大 ${scale}`;
  if (!trimmed) {
    return prefix;
  }
  if (trimmed.length <= 8) {
    return `${prefix} · ${trimmed}`;
  }
  return `${prefix} · ${trimmed.slice(0, 8)}...`;
}

function formatConversationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatAvailableQuota(accounts: Account[]) {
  const availableAccounts = accounts.filter((account) => account.status !== "禁用" && account.status !== "异常");
  return String(availableAccounts.reduce((sum, account) => sum + Math.max(0, account.quota), 0));
}

async function normalizeConversationHistory(items: ImageConversation[]) {
  const normalized = items.map((item) => {
    let changed = false;
    const turns = (item.turns ?? []).map((turn) => {
      if (turn.status !== "generating" || isImageTaskActive(item.id, turn.id)) {
        return turn;
      }

      changed = true;
      const errorMessage = turn.images.some((image) => image.status === "success")
        ? turn.error || "任务已中断"
        : "页面已刷新，任务已中断";

      return {
        ...turn,
        status: "error" as const,
        error: errorMessage,
        images: turn.images.map((image) =>
          image.status === "loading"
            ? {
                ...image,
                status: "error" as const,
                error: "页面已刷新，任务已中断",
              }
            : image,
        ),
      };
    });

    const conversation = normalizeConversation(
      changed
        ? {
            ...item,
            turns,
          }
        : item,
    );

    return { conversation, changed };
  });

  await Promise.all(
    normalized
      .filter((item) => item.changed)
      .map((item) => saveImageConversation(item.conversation)),
  );

  return normalized.map((item) => item.conversation);
}

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildImageDataUrl(image: StoredImage) {
  if (!image.b64_json) {
    return "";
  }
  return `data:image/png;base64,${image.b64_json}`;
}

function buildConversationPreviewSource(conversation: ImageConversation) {
  const latestSuccessfulImage = conversation.images.find((image) => image.status === "success" && image.b64_json);
  if (latestSuccessfulImage) {
    return buildImageDataUrl(latestSuccessfulImage);
  }

  const firstSourceImage = conversation.sourceImages?.find((item) => item.role === "image");
  return firstSourceImage?.dataUrl || "";
}

function createLoadingImages(count: number, conversationId: string) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${conversationId}-${index}`,
    status: "loading" as const,
  }));
}

function createConversationTurn(payload: {
  turnId: string;
  title: string;
  mode: ImageMode;
  prompt: string;
  model: ImageModel;
  count: number;
  scale?: string;
  sourceImages?: StoredSourceImage[];
  images: StoredImage[];
  createdAt: string;
  status: "generating" | "success" | "error";
  error?: string;
}): ImageConversationTurn {
  return {
    id: payload.turnId,
    title: payload.title,
    mode: payload.mode,
    prompt: payload.prompt,
    model: payload.model,
    count: payload.count,
    scale: payload.scale,
    sourceImages: payload.sourceImages ?? [],
    images: payload.images,
    createdAt: payload.createdAt,
    status: payload.status,
    error: payload.error,
  };
}

async function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`读取 ${file.name} 失败`));
    reader.readAsDataURL(file);
  });
}

async function dataUrlToFile(dataUrl: string, fileName: string) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], fileName, { type: blob.type || "image/png" });
}

function mergeResultImages(
  conversationId: string,
  items: Array<{
    b64_json?: string;
    revised_prompt?: string;
    file_id?: string;
    gen_id?: string;
    conversation_id?: string;
    parent_message_id?: string;
    source_account_id?: string;
  }>,
  expected: number,
) {
  const results: StoredImage[] = items.map((item, index) =>
    item.b64_json
      ? {
          id: `${conversationId}-${index}`,
          status: "success",
          b64_json: item.b64_json,
          revised_prompt: item.revised_prompt,
          file_id: item.file_id,
          gen_id: item.gen_id,
          conversation_id: item.conversation_id,
          parent_message_id: item.parent_message_id,
          source_account_id: item.source_account_id,
        }
      : {
          id: `${conversationId}-${index}`,
          status: "error",
          error: "接口没有返回图片数据",
        },
  );

  while (results.length < expected) {
    results.push({
      id: `${conversationId}-${results.length}`,
      status: "error",
      error: "接口返回的图片数量不足",
    });
  }
  return results;
}

function countFailures(images: StoredImage[]) {
  return images.filter((image) => image.status === "error").length;
}

function buildConversationSourceLabel(source: StoredSourceImage) {
  return source.role === "mask" ? "选区 / 遮罩" : "源图";
}

function formatProcessingDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function buildWaitingDots(totalSeconds: number) {
  return ".".repeat((totalSeconds % 3) + 1);
}

function buildProcessingStatus(
  mode: ImageMode,
  elapsedSeconds: number,
  count: number,
  variant: ActiveRequestState["variant"],
) {
  if (mode === "generate") {
    if (elapsedSeconds < 4) {
      return {
        title: "正在提交生成请求",
        detail: `已进入图像生成队列，本次目标 ${count} 张`,
      };
    }
    if (elapsedSeconds < 12) {
      return {
        title: "正在排队创建画面",
        detail: "模型正在准备构图与风格细节",
      };
    }
    return {
      title: "模型正在生成图片",
      detail: "通常需要 20 到 90 秒，请保持页面开启",
    };
  }

  if (mode === "edit") {
    if (elapsedSeconds < 4) {
      return {
        title: variant === "selection-edit" ? "正在提交选区编辑" : "正在提交编辑请求",
        detail: "请求已发送，正在准备处理素材",
      };
    }
    if (elapsedSeconds < 12) {
      return {
        title: variant === "selection-edit" ? "正在上传源图和选区" : "正在上传编辑素材",
        detail: "素材上传完成后会立即进入改图阶段",
      };
    }
    return {
      title: variant === "selection-edit" ? "模型正在按选区修改图片" : "模型正在编辑图片",
      detail: "通常需要 20 到 90 秒，请保持页面开启",
    };
  }

  if (elapsedSeconds < 4) {
    return {
      title: "正在提交放大请求",
      detail: "请求已发送，正在准备源图",
    };
  }
  if (elapsedSeconds < 12) {
    return {
      title: "正在上传源图",
      detail: "即将进入清晰度增强阶段",
    };
  }
  return {
    title: "模型正在增强清晰度与细节",
    detail: "通常需要 20 到 90 秒，请保持页面开启",
  };
}

function buildInpaintSourceReference(image: StoredImage): InpaintSourceReference | undefined {
  if (!image.file_id || !image.gen_id || !image.source_account_id) {
    return undefined;
  }
  return {
    original_file_id: image.file_id,
    original_gen_id: image.gen_id,
    conversation_id: image.conversation_id,
    parent_message_id: image.parent_message_id,
    source_account_id: image.source_account_id,
  };
}

function extractErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return "";
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

function shouldFallbackSelectionEdit(error: unknown) {
  const code = extractErrorCode(error);
  if (["source_account_not_found", "source_account_unavailable", "source_context_missing"].includes(code)) {
    return true;
  }

  const normalized = (error instanceof Error ? error.message : String(error || "")).toLowerCase();
  return (
    normalized.includes("conversation not found") ||
    normalized.includes("source account") ||
    normalized.includes("image account is unavailable") ||
    normalized.includes("原始图片") ||
    normalized.includes("所属账号")
  );
}

export default function ImagePage() {
  const didLoadQuotaRef = useRef(false);
  const mountedRef = useRef(true);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const maskInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resultsViewportRef = useRef<HTMLDivElement>(null);

  const [mode, setMode] = useState<ImageMode>("generate");
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageCount, setImageCount] = useState("1");
  const [imageModel, setImageModel] = useState<ImageModel>("gpt-image-2");
  const [upscaleScale, setUpscaleScale] = useState("2x");
  const [sourceImages, setSourceImages] = useState<StoredSourceImage[]>([]);
  const [conversations, setConversations] = useState<ImageConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [availableQuota, setAvailableQuota] = useState("加载中");
  const [activeRequest, setActiveRequest] = useState<ActiveRequestState | null>(null);
  const [submitStartedAt, setSubmitStartedAt] = useState<number | null>(null);
  const [submitElapsedSeconds, setSubmitElapsedSeconds] = useState(0);
  const [pendingPickerMode, setPendingPickerMode] = useState<ImageMode | null>(null);
  const [editorTarget, setEditorTarget] = useState<{
    conversationId: string;
    turnId: string;
    image: StoredImage;
    imageName: string;
    sourceDataUrl: string;
  } | null>(null);

  const selectedConversation = useMemo(
    () => conversations.find((item) => item.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId],
  );
  const selectedConversationTurns = useMemo(
    () => selectedConversation?.turns ?? [],
    [selectedConversation],
  );
  const parsedCount = useMemo(() => Math.max(1, Math.min(8, Number(imageCount) || 1)), [imageCount]);
  const imageSources = useMemo(() => sourceImages.filter((item) => item.role === "image"), [sourceImages]);
  const maskSource = useMemo(() => sourceImages.find((item) => item.role === "mask") ?? null, [sourceImages]);
  const hasGenerateReferences = useMemo(() => mode === "generate" && imageSources.length > 0, [imageSources, mode]);
  const processingStatus = useMemo(
    () =>
      activeRequest
        ? buildProcessingStatus(activeRequest.mode, submitElapsedSeconds, activeRequest.count, activeRequest.variant)
        : null,
    [activeRequest, submitElapsedSeconds],
  );
  const waitingDots = useMemo(() => buildWaitingDots(submitElapsedSeconds), [submitElapsedSeconds]);

  const syncRuntimeTaskState = (preferredConversationId?: string | null) => {
    const tasks = listActiveImageTasks();
    const nextTask =
      tasks.find((task) => preferredConversationId && task.conversationId === preferredConversationId) ?? tasks[0] ?? null;

    setIsSubmitting(tasks.length > 0);
    setActiveRequest(
      nextTask
        ? {
            conversationId: nextTask.conversationId,
            turnId: nextTask.turnId,
            mode: nextTask.mode,
            count: nextTask.count,
            variant: nextTask.variant,
          }
        : null,
    );
    setSubmitStartedAt(nextTask?.startedAt ?? null);
    if (!nextTask) {
      setSubmitElapsedSeconds(0);
    }
  };

  const refreshHistory = async (options: { normalize?: boolean; silent?: boolean; withLoading?: boolean } = {}) => {
    const { normalize = false, silent = false, withLoading = false } = options;

    try {
      if (withLoading && mountedRef.current) {
        setIsLoadingHistory(true);
      }
      const items = await listImageConversations();
      const nextItems = normalize ? await normalizeConversationHistory(items) : items;
      if (!mountedRef.current) {
        return;
      }
      setConversations(nextItems);
    } catch (error) {
      if (!silent) {
        const message = error instanceof Error ? error.message : "读取会话记录失败";
        toast.error(message);
      }
    } finally {
      if (withLoading && mountedRef.current) {
        setIsLoadingHistory(false);
      }
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void refreshHistory({ normalize: true, withLoading: true });
      syncRuntimeTaskState(selectedConversationId);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      syncRuntimeTaskState(selectedConversationId);
    });
    const unsubscribe = subscribeImageTasks(() => {
      void refreshHistory({ silent: true });
      window.requestAnimationFrame(() => {
        syncRuntimeTaskState(selectedConversationId);
      });
    });

    return () => {
      window.cancelAnimationFrame(frame);
      unsubscribe();
    };
  }, [selectedConversationId]);

  useEffect(() => {
    const loadQuota = async () => {
      try {
        const data = await fetchAccounts();
        setAvailableQuota(formatAvailableQuota(data.items));
      } catch {
        setAvailableQuota((prev) => (prev === "加载中" ? "—" : prev));
      }
    };

    if (didLoadQuotaRef.current) {
      return;
    }
    didLoadQuotaRef.current = true;
    void loadQuota();
  }, []);

  useEffect(() => {
    if (!selectedConversation && !isSubmitting) {
      return;
    }
    resultsViewportRef.current?.scrollTo({
      top: resultsViewportRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [selectedConversation, isSubmitting]);

  useEffect(() => {
    if (!isSubmitting || submitStartedAt === null) {
      return;
    }

    const updateElapsed = () => {
      setSubmitElapsedSeconds(Math.max(0, Math.floor((Date.now() - submitStartedAt) / 1000)));
    };

    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [isSubmitting, submitStartedAt]);

  useEffect(() => {
    if (!pendingPickerMode || mode !== pendingPickerMode) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      uploadInputRef.current?.click();
      setPendingPickerMode(null);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [mode, pendingPickerMode]);

  const persistConversation = async (conversation: ImageConversation) => {
    const normalizedConversation = normalizeConversation(conversation);
    await saveImageConversation(normalizedConversation);
    if (mountedRef.current) {
      setConversations((prev) => {
        const next = [normalizedConversation, ...prev.filter((item) => item.id !== normalizedConversation.id)];
        return next.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      });
    }
  };

  const updateConversation = async (
    conversationId: string,
    updater: (current: ImageConversation | null) => ImageConversation,
  ) => {
    const nextConversation = await updateImageConversation(conversationId, updater);
    if (mountedRef.current) {
      setConversations((prev) => {
        const next = [nextConversation, ...prev.filter((item) => item.id !== conversationId)];
        return next.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      });
    }
  };

  const resetComposer = (nextMode = mode) => {
    setMode(nextMode);
    setImagePrompt("");
    setImageCount("1");
    setUpscaleScale("2x");
    setSourceImages([]);
  };

  const openImagePickerForMode = (nextMode: ImageMode) => {
    if (isSubmitting) {
      return;
    }
    setPendingPickerMode(nextMode);
    setMode(nextMode);
  };

  const applyPromptExample = (example: (typeof inspirationExamples)[number]) => {
    setMode("generate");
    setImageModel(example.model);
    setImageCount(String(example.count));
    setImagePrompt(example.prompt);
    setSelectedConversationId(null);
    setSourceImages([]);
    textareaRef.current?.focus();
  };

  const handleCreateDraft = () => {
    setSelectedConversationId(null);
    resetComposer("generate");
    textareaRef.current?.focus();
  };

  const handleDeleteConversation = async (id: string) => {
    const nextConversations = conversations.filter((item) => item.id !== id);
    setConversations(nextConversations);
    setSelectedConversationId((prev) => (prev === id ? null : prev));

    try {
      await deleteImageConversation(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除会话失败";
      toast.error(message);
      const items = await listImageConversations();
      setConversations(items);
    }
  };

  const handleClearHistory = async () => {
    try {
      await clearImageConversations();
      setConversations([]);
      setSelectedConversationId(null);
      toast.success("已清空历史记录");
    } catch (error) {
      const message = error instanceof Error ? error.message : "清空历史记录失败";
      toast.error(message);
    }
  };

  const appendFiles = async (files: File[] | FileList | null, role: "image" | "mask") => {
    const normalizedFiles = files ? Array.from(files) : [];
    if (normalizedFiles.length === 0) {
      return;
    }
    const nextItems = await Promise.all(
      normalizedFiles.map(async (file) => ({
        id: makeId(),
        role,
        name: file.name,
        dataUrl: await fileToDataUrl(file),
      })),
    );
    setSourceImages((prev) => {
      if (role === "mask") {
        return [...prev.filter((item) => item.role !== "mask"), nextItems[0]];
      }
      if (mode === "upscale") {
        return [
          ...prev.filter((item) => item.role === "mask"),
          {
            ...nextItems[0],
            name: nextItems[0]?.name || "upscale.png",
          },
        ];
      }
      return [...prev.filter((item) => item.role !== "mask"), ...prev.filter((item) => item.role === "mask"), ...nextItems];
    });
  };

  const handlePromptPaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    if (isSubmitting) {
      return;
    }
    const clipboardImages = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));

    if (clipboardImages.length === 0) {
      return;
    }

    event.preventDefault();
    void appendFiles(clipboardImages, "image");
    toast.success(
      mode === "generate"
        ? "已从剪贴板添加参考图"
        : mode === "edit"
          ? "已从剪贴板添加源图"
          : "已从剪贴板添加放大源图",
    );
  };

  const removeSourceImage = (id: string) => {
    setSourceImages((prev) => prev.filter((item) => item.id !== id));
  };

  const seedFromResult = (conversationId: string, image: StoredImage, nextMode: ImageMode) => {
    const dataUrl = buildImageDataUrl(image);
    if (!dataUrl) {
      toast.error("当前图片没有可复用的数据");
      return;
    }
    setSelectedConversationId(conversationId);
    setMode(nextMode);
    setSourceImages([
      {
        id: makeId(),
        role: "image",
        name: "source.png",
        dataUrl,
      },
    ]);
    if (nextMode === "upscale") {
      setImagePrompt("");
    }
    textareaRef.current?.focus();
  };

  const openSelectionEditor = (conversationId: string, turnId: string, image: StoredImage, imageName: string) => {
    const dataUrl = buildImageDataUrl(image);
    if (!dataUrl) {
      toast.error("当前图片没有可复用的数据");
      return;
    }
    setEditorTarget({
      conversationId,
      turnId,
      image,
      imageName,
      sourceDataUrl: dataUrl,
    });
  };

  const handleSelectionEditSubmit = async ({
    prompt,
    mask,
  }: {
    prompt: string;
    mask: {
      file: File;
      previewDataUrl: string;
    };
  }) => {
    if (!editorTarget) {
      return;
    }

    const sourceReference = buildInpaintSourceReference(editorTarget.image);
    const conversationId = editorTarget.conversationId;
    const turnId = makeId();
    const now = new Date().toISOString();
    const draftTurn = createConversationTurn({
      turnId,
      title: buildConversationTitle("edit", prompt, upscaleScale),
      mode: "edit",
      prompt,
      model: imageModel,
      count: 1,
      sourceImages: [
        {
          id: makeId(),
          role: "image",
          name: editorTarget.imageName,
          dataUrl: editorTarget.sourceDataUrl,
        },
        {
          id: makeId(),
          role: "mask",
          name: "mask.png",
          dataUrl: mask.previewDataUrl,
        },
      ],
      images: createLoadingImages(1, turnId),
      createdAt: now,
      status: "generating",
    });

    const startedAt = Date.now();
    setIsSubmitting(true);
    setActiveRequest({
      conversationId,
      turnId,
      mode: "edit",
      count: 1,
      variant: "selection-edit",
    });
    setSubmitElapsedSeconds(0);
    setSubmitStartedAt(startedAt);
    setSelectedConversationId(conversationId);
    setImagePrompt("");
    setSourceImages([]);
    setEditorTarget(null);
    startImageTask({
      conversationId,
      turnId,
      mode: "edit",
      count: 1,
      variant: "selection-edit",
      startedAt,
    });

    try {
      await updateConversation(conversationId, (current) => {
        if (!current) {
          return {
            id: conversationId,
            title: draftTurn.title,
            mode: draftTurn.mode,
            prompt: draftTurn.prompt,
            model: draftTurn.model,
            count: draftTurn.count,
            scale: draftTurn.scale,
            sourceImages: draftTurn.sourceImages,
            images: draftTurn.images,
            createdAt: draftTurn.createdAt,
            status: draftTurn.status,
            error: draftTurn.error,
            turns: [draftTurn],
          };
        }
        return {
          ...current,
          turns: [...(current.turns ?? []), draftTurn],
        };
      });

      let fallbackImageFile = sourceReference
        ? null
        : await dataUrlToFile(editorTarget.sourceDataUrl, editorTarget.imageName || "source.png");
      let data;
      try {
        data = await editImage({
          prompt,
          images: fallbackImageFile ? [fallbackImageFile] : [],
          mask: mask.file,
          sourceReference,
          model: imageModel,
        });
      } catch (error) {
        if (!sourceReference || !shouldFallbackSelectionEdit(error)) {
          throw error;
        }
        fallbackImageFile =
          fallbackImageFile ??
          (await dataUrlToFile(editorTarget.sourceDataUrl, editorTarget.imageName || "source.png"));
        data = await editImage({
          prompt,
          images: [fallbackImageFile],
          mask: mask.file,
          model: imageModel,
        });
      }
      const resultItems = mergeResultImages(turnId, data.data || [], 1);
      const failedCount = countFailures(resultItems);

      await updateConversation(conversationId, (current) => ({
        ...(current ?? {
          id: conversationId,
          title: draftTurn.title,
          mode: draftTurn.mode,
          prompt: draftTurn.prompt,
          model: draftTurn.model,
          count: draftTurn.count,
          scale: draftTurn.scale,
          sourceImages: draftTurn.sourceImages,
          images: draftTurn.images,
          createdAt: draftTurn.createdAt,
          status: draftTurn.status,
          error: draftTurn.error,
          turns: [draftTurn],
        }),
        turns: (current?.turns ?? [draftTurn]).map((turn) =>
          turn.id === turnId
            ? {
                ...turn,
                images: resultItems,
                status: failedCount > 0 ? "error" : "success",
                error: failedCount > 0 ? `其中 ${failedCount} 张处理失败` : undefined,
              }
            : turn,
        ),
      }));

      if (failedCount > 0) {
        toast.error(`已返回结果，但有 ${failedCount} 张处理失败`);
      } else {
        toast.success("图片已按选区编辑");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "处理图片失败";
      await updateConversation(conversationId, (current) => ({
        ...(current ?? {
          id: conversationId,
          title: draftTurn.title,
          mode: draftTurn.mode,
          prompt: draftTurn.prompt,
          model: draftTurn.model,
          count: draftTurn.count,
          scale: draftTurn.scale,
          sourceImages: draftTurn.sourceImages,
          images: draftTurn.images,
          createdAt: draftTurn.createdAt,
          status: draftTurn.status,
          error: draftTurn.error,
          turns: [draftTurn],
        }),
        turns: (current?.turns ?? [draftTurn]).map((turn) =>
          turn.id === turnId
            ? {
                ...turn,
                status: "error",
                error: message,
                images: turn.images.map((image) => ({
                  ...image,
                  status: "error" as const,
                  error: message,
                })),
              }
            : turn,
        ),
      }));
      toast.error(message);
    } finally {
      finishImageTask(conversationId, turnId);
      setIsSubmitting(false);
      setActiveRequest(null);
      setSubmitStartedAt(null);
    }
  };

  const handleSubmit = async () => {
    const prompt = imagePrompt.trim();
    if (mode === "generate" && !prompt) {
      toast.error("请输入提示词");
      return;
    }
    if (mode === "edit" && imageSources.length === 0) {
      toast.error("编辑模式至少需要一张源图");
      return;
    }
    if (mode === "edit" && !prompt) {
      toast.error("编辑模式需要提示词");
      return;
    }
    if (mode === "upscale" && imageSources.length === 0) {
      toast.error("放大模式需要一张源图");
      return;
    }

    const conversationId = selectedConversationId ?? makeId();
    const turnId = makeId();
    const now = new Date().toISOString();
    const expectedCount = mode === "generate" && imageSources.length === 0 ? parsedCount : 1;
    const draftTurn = createConversationTurn({
      turnId,
      title: buildConversationTitle(mode, prompt, upscaleScale),
      mode,
      prompt,
      model: imageModel,
      count: expectedCount,
      scale: mode === "upscale" ? upscaleScale : undefined,
      sourceImages,
      images: createLoadingImages(expectedCount, turnId),
      createdAt: now,
      status: "generating",
    });

    const startedAt = Date.now();
    setIsSubmitting(true);
    setActiveRequest({
      conversationId,
      turnId,
      mode,
      count: expectedCount,
      variant: "standard",
    });
    setSubmitElapsedSeconds(0);
    setSubmitStartedAt(startedAt);
    setSelectedConversationId(conversationId);
    setImagePrompt("");
    setSourceImages([]);
    startImageTask({
      conversationId,
      turnId,
      mode,
      count: expectedCount,
      variant: "standard",
      startedAt,
    });

    try {
      if (selectedConversationId) {
        await updateConversation(conversationId, (current) => ({
          ...(current ?? {
            id: conversationId,
            title: draftTurn.title,
            mode: draftTurn.mode,
            prompt: draftTurn.prompt,
            model: draftTurn.model,
            count: draftTurn.count,
            scale: draftTurn.scale,
            sourceImages: draftTurn.sourceImages,
            images: draftTurn.images,
            createdAt: draftTurn.createdAt,
            status: draftTurn.status,
            error: draftTurn.error,
            turns: [draftTurn],
          }),
          turns: [...(current?.turns ?? []), draftTurn],
        }));
      } else {
        await persistConversation({
          id: conversationId,
          title: draftTurn.title,
          mode: draftTurn.mode,
          prompt: draftTurn.prompt,
          model: draftTurn.model,
          count: draftTurn.count,
          scale: draftTurn.scale,
          sourceImages: draftTurn.sourceImages,
          images: draftTurn.images,
          createdAt: draftTurn.createdAt,
          status: draftTurn.status,
          error: draftTurn.error,
          turns: [draftTurn],
        });
      }

      let resultItems: StoredImage[] = [];
      if (mode === "generate") {
        if (imageSources.length > 0) {
          const files = await Promise.all(
            imageSources.map((item, index) => dataUrlToFile(item.dataUrl, item.name || `reference-${index + 1}.png`)),
          );
          const data = await editImage({ prompt, images: files, model: imageModel });
          resultItems = mergeResultImages(turnId, data.data || [], 1);
        } else {
          const data = await generateImage(prompt, imageModel, parsedCount);
          resultItems = mergeResultImages(turnId, data.data || [], parsedCount);
        }
      }

      if (mode === "edit") {
        const files = await Promise.all(
          imageSources.map((item, index) => dataUrlToFile(item.dataUrl, item.name || `image-${index + 1}.png`)),
        );
        const mask = maskSource ? await dataUrlToFile(maskSource.dataUrl, maskSource.name || "mask.png") : null;
        const data = await editImage({ prompt, images: files, mask, model: imageModel });
        resultItems = mergeResultImages(turnId, data.data || [], 1);
      }

      if (mode === "upscale") {
        const file = await dataUrlToFile(imageSources[0].dataUrl, imageSources[0].name || "upscale.png");
        const data = await upscaleImage({ image: file, prompt, scale: upscaleScale, model: imageModel });
        resultItems = mergeResultImages(turnId, data.data || [], 1);
      }

      const failedCount = countFailures(resultItems);
      await updateConversation(conversationId, (current) => ({
        ...(current ?? {
          id: conversationId,
          title: draftTurn.title,
          mode: draftTurn.mode,
          prompt: draftTurn.prompt,
          model: draftTurn.model,
          count: draftTurn.count,
          scale: draftTurn.scale,
          sourceImages: draftTurn.sourceImages,
          images: draftTurn.images,
          createdAt: draftTurn.createdAt,
          status: draftTurn.status,
          error: draftTurn.error,
          turns: [draftTurn],
        }),
        turns: (current?.turns ?? [draftTurn]).map((turn) =>
          turn.id === turnId
            ? {
                ...turn,
                images: resultItems,
                status: failedCount > 0 ? "error" : "success",
                error: failedCount > 0 ? `其中 ${failedCount} 张处理失败` : undefined,
              }
            : turn,
        ),
      }));

      resetComposer(mode === "generate" ? "generate" : mode);
      if (failedCount > 0) {
        toast.error(`已返回结果，但有 ${failedCount} 张处理失败`);
      } else {
        toast.success(
          mode === "generate"
            ? imageSources.length > 0
              ? "参考图生成已完成"
              : "图片已生成"
            : mode === "edit"
              ? "图片已编辑"
              : "图片已放大",
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "处理图片失败";
      await updateConversation(conversationId, (current) => ({
        ...(current ?? {
          id: conversationId,
          title: draftTurn.title,
          mode: draftTurn.mode,
          prompt: draftTurn.prompt,
          model: draftTurn.model,
          count: draftTurn.count,
          scale: draftTurn.scale,
          sourceImages: draftTurn.sourceImages,
          images: draftTurn.images,
          createdAt: draftTurn.createdAt,
          status: draftTurn.status,
          error: draftTurn.error,
          turns: [draftTurn],
        }),
        turns: (current?.turns ?? [draftTurn]).map((turn) =>
          turn.id === turnId
            ? {
                ...turn,
                status: "error",
                error: message,
                images: turn.images.map((image) => ({
                  ...image,
                  status: "error" as const,
                  error: message,
                })),
              }
            : turn,
        ),
      }));
      toast.error(message);
    } finally {
      finishImageTask(conversationId, turnId);
      setIsSubmitting(false);
      setActiveRequest(null);
      setSubmitStartedAt(null);
    }
  };

  return (
    <section
      className={cn(
        "grid grid-cols-1 gap-3",
        historyCollapsed ? "lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)]" : "lg:h-full lg:min-h-0 lg:grid-cols-[320px_minmax(0,1fr)]",
      )}
    >
      {!historyCollapsed ? (
        <aside className="order-2 overflow-hidden rounded-[28px] border border-stone-200 bg-[#f8f8f7] shadow-[0_8px_30px_rgba(15,23,42,0.04)] lg:order-none lg:min-h-0">
          <div className="flex h-full min-h-0 flex-col">
            <div className="border-b border-stone-200/80 px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight text-stone-900">历史记录</h2>
                </div>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-stone-500 shadow-sm">
                  {conversations.length}
                </span>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <Button className="h-11 flex-1 rounded-2xl bg-stone-950 text-white hover:bg-stone-800" onClick={handleCreateDraft}>
                  <MessageSquarePlus className="size-4" />
                  新建对话
                </Button>
                <Button
                  variant="outline"
                  className="h-11 rounded-2xl border-stone-200 bg-white px-3 text-stone-600 hover:bg-stone-50"
                  onClick={() => void handleClearHistory()}
                  disabled={conversations.length === 0}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
              {isLoadingHistory ? (
                <div className="flex items-center gap-2 rounded-2xl px-3 py-3 text-sm text-stone-500">
                  <LoaderCircle className="size-4 animate-spin" />
                  正在读取会话记录
                </div>
              ) : conversations.length === 0 ? (
                <div className="px-3 py-4 text-sm leading-6 text-stone-500">
                  还没有历史记录。创建第一条图片任务后，会在这里保留缩略图和提示词摘要。
                </div>
              ) : (
                <div className="space-y-2">
                  {conversations.map((conversation) => {
                    const active = conversation.id === selectedConversationId;
                    const previewSrc = buildConversationPreviewSource(conversation);
                    return (
                      <div
                        key={conversation.id}
                        className={cn(
                          "group rounded-[22px] border p-2 transition",
                          active
                            ? "border-stone-200 bg-white shadow-sm"
                            : "border-transparent bg-transparent hover:border-stone-200/80 hover:bg-white/70",
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => setSelectedConversationId(conversation.id)}
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          >
                            <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-stone-100">
                              {previewSrc ? (
                                <Image
                                  src={previewSrc}
                                  alt={conversation.title}
                                  width={56}
                                  height={56}
                                  unoptimized
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <History className="size-4 text-stone-400" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-500">
                                  {modeLabelMap[conversation.mode]}
                                </span>
                                <span className="truncate text-xs text-stone-400">
                                  {formatConversationTime(conversation.createdAt)}
                                </span>
                              </div>
                              <div className="mt-2 truncate text-sm font-medium text-stone-800">{conversation.title}</div>
                              <div className="mt-1 line-clamp-2 text-xs leading-5 text-stone-500">
                                {conversation.prompt || "无额外提示词"}
                              </div>
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteConversation(conversation.id)}
                            className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl text-stone-400 opacity-100 transition hover:bg-stone-100 hover:text-rose-500 lg:opacity-0 lg:group-hover:opacity-100"
                            aria-label="删除会话"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </aside>
      ) : null}

      <div className="order-1 flex flex-col overflow-visible rounded-[30px] border border-stone-200 bg-white shadow-[0_14px_40px_rgba(15,23,42,0.05)] lg:order-none lg:min-h-0 lg:overflow-hidden">
        <div className="border-b border-stone-200/80 px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 rounded-full border-stone-200 bg-white px-4 text-stone-700 shadow-none"
                  onClick={() => setHistoryCollapsed((current) => !current)}
                >
                  {historyCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
                  {historyCollapsed ? "展开历史" : "收起历史"}
                </Button>
                <h1 className="text-xl font-semibold tracking-tight text-stone-950 sm:text-[22px]">图片工作台</h1>
                {selectedConversation ? (
                  <span className="truncate rounded-full bg-stone-100 px-3 py-1 text-xs font-medium text-stone-600">
                    {selectedConversation.title}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
              <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5">模型 {imageModel}</span>
              <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5">剩余额度 {availableQuota}</span>
            </div>
          </div>
        </div>

        <div ref={resultsViewportRef} className="hide-scrollbar overflow-visible bg-[#fcfcfb] lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {!selectedConversation ? (
            <div className="mx-auto flex max-w-[1080px] flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
              <div className="max-w-[760px]">
                <div className="inline-flex size-14 items-center justify-center rounded-[20px] bg-stone-950 text-white shadow-sm">
                  <Sparkles className="size-5" />
                </div>
                <h1 className="mt-6 text-3xl font-semibold tracking-tight text-stone-950 lg:text-5xl">
                  从一个提示词，开始完整的图像工作流。
                </h1>
                <p className="mt-4 text-[15px] leading-8 text-stone-500">
                  中间区域不再承担多余操作入口。这里展示灵感和 prompt 范例，所有实际操作统一从底部控制台发起。
                </p>
              </div>

              <div className="hide-scrollbar flex gap-3 overflow-x-auto pb-1 md:grid md:grid-cols-2 md:overflow-visible xl:grid-cols-4">
                {inspirationExamples.map((example) => (
                  <button
                    key={example.id}
                    type="button"
                    onClick={() => applyPromptExample(example)}
                    className="w-[220px] shrink-0 overflow-hidden rounded-[22px] border border-stone-200 bg-white text-left transition hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-sm md:w-auto"
                  >
                    <div className={cn("h-[4.5rem] bg-gradient-to-br md:h-20", example.tone)} />
                    <div className="space-y-2 px-4 py-3.5">
                      <div className="flex items-center gap-2 text-[11px] text-stone-500">
                        <span className="rounded-full bg-stone-100 px-2 py-0.5 font-medium">Prompt</span>
                        <span>{example.model}</span>
                      </div>
                      <div className="text-sm font-semibold tracking-tight text-stone-900">{example.title}</div>
                      <div className="line-clamp-2 text-sm leading-6 text-stone-600">{example.prompt}</div>
                      <div className="border-t border-stone-100 pt-2 text-xs leading-5 text-stone-500">{example.hint}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto flex w-full max-w-[980px] flex-col gap-8 px-4 py-8 sm:px-6">
              {selectedConversationTurns.map((turn) => {
                const turnProcessing = Boolean(
                  isSubmitting &&
                    activeRequest &&
                    activeRequest.conversationId === selectedConversation.id &&
                    activeRequest.turnId === turn.id,
                );

                return (
                  <div key={turn.id} className="space-y-4">
                    <div className="flex justify-end">
                      <div className="flex w-full max-w-[78%] flex-col items-end gap-4">
                        {turn.sourceImages && turn.sourceImages.length > 0 ? (
                          <div className="flex flex-wrap justify-end gap-2.5">
                            {turn.sourceImages.map((source) => (
                              <div
                                key={source.id}
                                className="w-[136px] overflow-hidden rounded-[20px] border border-stone-200 bg-white shadow-sm"
                              >
                                <div className="border-b border-stone-100 px-3 py-2 text-left text-[11px] font-medium text-stone-500">
                                  {buildConversationSourceLabel(source)}
                                </div>
                                <Zoom>
                                  <Image
                                    src={source.dataUrl}
                                    alt={source.name}
                                    width={220}
                                    height={160}
                                    unoptimized
                                    className="block h-24 w-full cursor-zoom-in bg-stone-50 object-contain"
                                  />
                                </Zoom>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        <div className="max-w-full rounded-[28px] bg-[#f2f2f1] px-5 py-4 text-[15px] leading-7 text-stone-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
                          {turn.prompt || "无额外提示词"}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center gap-3 px-1">
                        <span className="flex size-9 items-center justify-center rounded-2xl bg-stone-950 text-white">
                          <Sparkles className="size-4" />
                        </span>
                        <div>
                          <div className="text-sm font-semibold tracking-tight text-stone-900">ChatGpt Image Studio</div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 px-1 text-xs text-stone-500">
                        <span className="rounded-full bg-stone-100 px-3 py-1.5">{modeLabelMap[turn.mode]}</span>
                        <span className="rounded-full bg-stone-100 px-3 py-1.5">{turn.model}</span>
                        <span className="rounded-full bg-stone-100 px-3 py-1.5">{turn.count} 张</span>
                        {turn.scale ? (
                          <span className="rounded-full bg-stone-100 px-3 py-1.5">{turn.scale}</span>
                        ) : null}
                        <span className="rounded-full bg-stone-100 px-3 py-1.5">
                          <Clock3 className="mr-1 inline size-3.5" />
                          {formatConversationTime(turn.createdAt)}
                        </span>
                      </div>

                      {turnProcessing && processingStatus ? (
                        <div className="rounded-[28px] border border-stone-200 bg-white px-5 py-4 shadow-sm">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-start gap-3">
                              <span className="relative mt-1 flex size-3 shrink-0">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300/70" />
                                <span className="relative inline-flex size-3 rounded-full bg-emerald-500" />
                              </span>
                              <div>
                                <div className="text-sm font-semibold text-stone-900">
                                  {processingStatus.title}
                                  {waitingDots}
                                </div>
                                <div className="mt-1 text-xs leading-6 text-stone-500">{processingStatus.detail}</div>
                              </div>
                            </div>
                            <span className="rounded-full bg-stone-100 px-3 py-1.5 text-[11px] font-medium text-stone-600">
                              已等待 {formatProcessingDuration(submitElapsedSeconds)}
                            </span>
                          </div>
                        </div>
                      ) : null}

                      {turn.images.length > 0 ? (
                        <div
                          className={cn(
                            "grid gap-4",
                            turn.images.length === 1 ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2",
                          )}
                        >
                          {turn.images.map((image, index) => (
                            <div
                              key={image.id}
                              className={cn(
                                "overflow-hidden rounded-[22px] border border-stone-200 bg-white shadow-sm",
                                turn.images.length === 1 && "w-fit max-w-full justify-self-start",
                              )}
                            >
                              {image.status === "success" && image.b64_json ? (
                                <div>
                                  <Zoom>
                                    <Image
                                      src={buildImageDataUrl(image)}
                                      alt={`Generated result ${index + 1}`}
                                      width={1024}
                                      height={1024}
                                      unoptimized
                                      className="block h-auto max-h-[360px] w-auto max-w-full cursor-zoom-in"
                                    />
                                  </Zoom>
                                  <div className="flex flex-wrap items-center gap-2 border-t border-stone-100 px-4 py-3">
                                    <button
                                      type="button"
                                      className="inline-flex size-9 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-600 transition hover:bg-stone-100 hover:text-stone-900"
                                      onClick={() =>
                                        openSelectionEditor(
                                          selectedConversation.id,
                                          turn.id,
                                          image,
                                          `${turn.title || "image"}-${index + 1}.png`,
                                        )
                                      }
                                      title="选区"
                                      aria-label="选区"
                                    >
                                      <Brush className="size-4" />
                                    </button>
                                    <button
                                      type="button"
                                      className="inline-flex size-9 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-600 transition hover:bg-stone-100 hover:text-stone-900"
                                      onClick={() => seedFromResult(selectedConversation.id, image, "edit")}
                                      title="引用"
                                      aria-label="引用"
                                    >
                                      <Copy className="size-4" />
                                    </button>
                                    <button
                                      type="button"
                                      className="inline-flex size-9 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-600 transition hover:bg-stone-100 hover:text-stone-900"
                                      onClick={() => seedFromResult(selectedConversation.id, image, "upscale")}
                                      title="放大"
                                      aria-label="放大"
                                    >
                                      <ZoomIn className="size-4" />
                                    </button>
                                  </div>
                                </div>
                              ) : image.status === "error" ? (
                                <div className="flex min-h-[320px] items-center justify-center bg-rose-50 px-6 py-8 text-center text-sm leading-7 text-rose-600">
                                  {image.error || "处理失败"}
                                </div>
                              ) : (
                                <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 bg-stone-50 px-6 py-8 text-center text-stone-500">
                                  <div className="rounded-full bg-white p-3 shadow-sm">
                                    <LoaderCircle className="size-5 animate-spin" />
                                  </div>
                                  <p className="text-sm font-medium text-stone-700">
                                    {turnProcessing && processingStatus
                                      ? `${processingStatus.title}${waitingDots}`
                                      : "正在处理图片..."}
                                  </p>
                                  <p className="text-xs leading-6 text-stone-400">
                                    {turnProcessing && processingStatus
                                      ? `${processingStatus.detail} · 已等待 ${formatProcessingDuration(submitElapsedSeconds)}`
                                      : "图片处理通常需要几十秒，请稍候"}
                                  </p>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {turn.error ? (
                        <div className="rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700">
                          {turn.error}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-stone-200 bg-white px-3 py-3 sm:px-5 sm:py-4">
          <div className="mx-auto flex max-w-[980px] flex-col gap-3">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="inline-flex rounded-full bg-stone-100 p-1">
                {modeOptions.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setMode(item.value)}
                    className={cn(
                      "rounded-full px-4 py-2 text-sm font-medium transition",
                      mode === item.value
                        ? "bg-stone-950 text-white shadow-sm"
                        : "text-stone-600 hover:bg-stone-200 hover:text-stone-900",
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Select value={imageModel} onValueChange={(value) => setImageModel(value as ImageModel)}>
                  <SelectTrigger className="h-10 w-[164px] rounded-full border-stone-200 bg-white text-sm font-medium text-stone-700 shadow-none focus-visible:ring-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {imageModelOptions.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {mode === "generate" && !hasGenerateReferences ? (
                  <div className="flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-1">
                    <span className="text-sm font-medium text-stone-700">张数</span>
                    <Input
                      type="number"
                      min="1"
                      max="8"
                      step="1"
                      value={imageCount}
                      onChange={(event) => setImageCount(event.target.value)}
                      className="h-8 w-[64px] border-0 bg-transparent px-0 text-center text-sm font-medium text-stone-700 shadow-none focus-visible:ring-0"
                    />
                  </div>
                ) : null}

                {mode === "upscale" ? (
                  <Select value={upscaleScale} onValueChange={setUpscaleScale}>
                    <SelectTrigger className="h-10 w-[132px] rounded-full border-stone-200 bg-white text-sm font-medium text-stone-700 shadow-none focus-visible:ring-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {upscaleOptions.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}

                <span className="rounded-full bg-stone-100 px-3 py-2 text-xs font-medium text-stone-600">
                  剩余额度 {availableQuota}
                </span>
              </div>
            </div>

            <div
              className="overflow-hidden rounded-[28px] border border-stone-200 bg-[#fafaf9] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
              onClick={() => {
                textareaRef.current?.focus();
              }}
            >
              {(mode === "edit" || mode === "upscale") && imageSources.length === 0 ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    uploadInputRef.current?.click();
                  }}
                  className="flex w-full items-center justify-between border-b border-dashed border-stone-200 bg-white/70 px-4 py-4 text-left transition hover:bg-white"
                >
                  <div>
                    <div className="text-sm font-medium text-stone-800">
                      {mode === "edit" ? "先上传要编辑的源图" : "先上传要放大的图片"}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-stone-500">
                      {mode === "edit" ? "支持拖拽、点击或粘贴图片，上传后再描述修改方向。" : "上传后可以补充想增强的方向，也可以直接发送。"}
                    </div>
                  </div>
                  <span className="rounded-full bg-stone-950 px-3 py-1.5 text-xs font-medium text-white">上传图片</span>
                </button>
              ) : null}

              {sourceImages.length > 0 ? (
                <div className="hide-scrollbar flex gap-3 overflow-x-auto border-b border-stone-200 px-4 py-3">
                  {sourceImages.map((item) => (
                    <div
                      key={item.id}
                      className="w-[126px] shrink-0 overflow-hidden rounded-[18px] border border-stone-200 bg-white"
                    >
                      <div className="flex items-center justify-between border-b border-stone-100 px-3 py-2 text-[11px] font-medium text-stone-500">
                        <span>{item.role === "mask" ? "遮罩" : "源图"}</span>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            removeSourceImage(item.id);
                          }}
                          className="rounded-md p-1 text-stone-400 transition hover:bg-stone-100 hover:text-rose-500"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                      <Zoom>
                        <Image
                          src={item.dataUrl}
                          alt={item.name}
                          width={160}
                          height={110}
                          unoptimized
                          className="block h-20 w-full cursor-zoom-in bg-stone-50 object-contain"
                        />
                      </Zoom>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="relative px-4 py-3">
                <Textarea
                  ref={textareaRef}
                  value={imagePrompt}
                  onChange={(event) => setImagePrompt(event.target.value)}
                  placeholder={
                    mode === "generate"
                      ? "描述你想生成的画面，也可以先上传参考图"
                      : mode === "edit"
                        ? "描述你想如何修改当前图片"
                        : "可选：描述你想增强的方向"
                  }
                  onPaste={handlePromptPaste}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      if (!isSubmitting) {
                        void handleSubmit();
                      }
                    }
                  }}
                  className="min-h-[82px] resize-none border-0 bg-transparent !px-1 !pt-1 !pb-12 text-[15px] leading-7 text-stone-900 shadow-none placeholder:text-stone-400 focus-visible:ring-0"
                />
                <div className="absolute inset-x-4 bottom-3 flex items-end justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 rounded-full border-stone-200 bg-white px-3 text-sm font-medium text-stone-700 shadow-none"
                      onClick={(event) => {
                        event.stopPropagation();
                        uploadInputRef.current?.click();
                      }}
                    >
                      <ImagePlus className="size-4" />
                      {mode === "generate" ? "添加参考图" : "上传源图"}
                    </Button>

                    {mode === "edit" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 rounded-full border-stone-200 bg-white px-3 text-sm font-medium text-stone-700 shadow-none"
                        onClick={(event) => {
                          event.stopPropagation();
                          maskInputRef.current?.click();
                        }}
                      >
                        <Upload className="size-4" />
                        遮罩
                      </Button>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleSubmit()}
                    disabled={isSubmitting}
                    className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-stone-950 text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
                    aria-label="提交图片任务"
                  >
                    {isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
                  </button>
                </div>
              </div>

              <input
                ref={uploadInputRef}
                type="file"
                accept="image/*"
                multiple={mode !== "upscale"}
                className="hidden"
                onChange={(event) => {
                  void appendFiles(event.target.files, "image");
                  event.currentTarget.value = "";
                }}
              />
              <input
                ref={maskInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  void appendFiles(event.target.files, "mask");
                  event.currentTarget.value = "";
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <ImageEditModal
        key={editorTarget?.turnId || "image-edit-modal"}
        open={Boolean(editorTarget)}
        imageName={editorTarget?.imageName || "image.png"}
        imageSrc={editorTarget?.sourceDataUrl || ""}
        isSubmitting={isSubmitting}
        onClose={() => {
          if (!isSubmitting) {
            setEditorTarget(null);
          }
        }}
        onSubmit={handleSelectionEditSubmit}
      />
    </section>
  );
}
