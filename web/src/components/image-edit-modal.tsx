"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Brush, Redo2, Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type StrokePoint = {
  x: number;
  y: number;
};

type Stroke = {
  points: StrokePoint[];
  sizeRatio: number;
};

type MaskPayload = {
  file: File;
  previewDataUrl: string;
};

type ImageEditModalProps = {
  open: boolean;
  imageName: string;
  imageSrc: string;
  isSubmitting?: boolean;
  onClose: () => void;
  onSubmit: (payload: { prompt: string; mask: MaskPayload }) => Promise<void>;
};

function clampPoint(value: number) {
  return Math.max(0, Math.min(1, value));
}

function renderStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  width: number,
  height: number,
  color: string,
) {
  if (stroke.points.length === 0) {
    return;
  }

  const lineWidth = stroke.sizeRatio * Math.min(width, height);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(4, lineWidth);

  if (stroke.points.length === 1) {
    const point = stroke.points[0];
    ctx.beginPath();
    ctx.arc(point.x * width, point.y * height, Math.max(2, lineWidth / 2), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(stroke.points[0].x * width, stroke.points[0].y * height);
  stroke.points.slice(1).forEach((point) => {
    ctx.lineTo(point.x * width, point.y * height);
  });
  ctx.stroke();
  ctx.restore();
}

async function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error("无法导出遮罩"));
    }, "image/png");
  });
}

export function ImageEditModal({
  open,
  imageName,
  imageSrc,
  isSubmitting = false,
  onClose,
  onSubmit,
}: ImageEditModalProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerActiveRef = useRef(false);

  const [prompt, setPrompt] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const [brushSize, setBrushSize] = useState(42);
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [redoStrokes, setRedoStrokes] = useState<Stroke[]>([]);
  const [currentStroke, setCurrentStroke] = useState<Stroke | null>(null);

  const hasSelection = strokes.length > 0;
  const helperText = useMemo(
    () =>
      selectionMode
        ? "拖动鼠标涂抹需要修改的区域。导出的遮罩会只替换你选中的部分。"
        : "点击右上角“选择”后，在图片上涂抹需要修改的区域。",
    [selectionMode],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !imageRef.current) {
      return;
    }

    const updateSize = () => {
      const element = imageRef.current;
      if (!element) {
        return;
      }
      const rect = element.getBoundingClientRect();
      setDisplaySize({
        width: Math.max(0, Math.round(rect.width)),
        height: Math.max(0, Math.round(rect.height)),
      });
      if (element.naturalWidth > 0 && element.naturalHeight > 0) {
        setNaturalSize({
          width: element.naturalWidth,
          height: element.naturalHeight,
        });
      }
    };

    updateSize();
    const observer = new ResizeObserver(() => updateSize());
    observer.observe(imageRef.current);
    window.addEventListener("resize", updateSize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateSize);
    };
  }, [open, imageSrc]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || displaySize.width <= 0 || displaySize.height <= 0) {
      return;
    }

    canvas.width = displaySize.width;
    canvas.height = displaySize.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokes.forEach((stroke) => {
      renderStroke(ctx, stroke, canvas.width, canvas.height, "rgba(80, 120, 255, 0.36)");
    });
    if (currentStroke) {
      renderStroke(ctx, currentStroke, canvas.width, canvas.height, "rgba(80, 120, 255, 0.36)");
    }
  }, [displaySize, strokes, currentStroke]);

  const mapClientPoint = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    return {
      x: clampPoint((clientX - rect.left) / rect.width),
      y: clampPoint((clientY - rect.top) / rect.height),
      sizeRatio: brushSize / Math.min(rect.width, rect.height),
    };
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!selectionMode || isSubmitting) {
      return;
    }
    event.preventDefault();
    const point = mapClientPoint(event.clientX, event.clientY);
    if (!point) {
      return;
    }

    pointerActiveRef.current = true;
    setRedoStrokes([]);
    setCurrentStroke({
      points: [{ x: point.x, y: point.y }],
      sizeRatio: point.sizeRatio,
    });
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!pointerActiveRef.current || !selectionMode || isSubmitting) {
      return;
    }
    event.preventDefault();
    const point = mapClientPoint(event.clientX, event.clientY);
    if (!point) {
      return;
    }
    setCurrentStroke((prev) =>
      prev
        ? {
            ...prev,
            points: [...prev.points, { x: point.x, y: point.y }],
          }
        : prev,
    );
  };

  const finishStroke = () => {
    pointerActiveRef.current = false;
    setCurrentStroke((prev) => {
      if (!prev || prev.points.length === 0) {
        return null;
      }
      setStrokes((current) => [...current, prev]);
      return null;
    });
  };

  const handleUndo = () => {
    if (!hasSelection || isSubmitting) {
      return;
    }
    setStrokes((current) => {
      const next = [...current];
      const removed = next.pop();
      if (removed) {
        setRedoStrokes((redo) => [...redo, removed]);
      }
      return next;
    });
  };

  const handleRedo = () => {
    if (redoStrokes.length === 0 || isSubmitting) {
      return;
    }
    setRedoStrokes((current) => {
      const next = [...current];
      const restored = next.pop();
      if (restored) {
        setStrokes((strokesValue) => [...strokesValue, restored]);
      }
      return next;
    });
  };

  const handleClear = () => {
    if ((!hasSelection && !currentStroke) || isSubmitting) {
      return;
    }
    setStrokes([]);
    setRedoStrokes([]);
    setCurrentStroke(null);
    pointerActiveRef.current = false;
  };

  const buildMaskPayload = async (): Promise<MaskPayload> => {
    if (naturalSize.width <= 0 || naturalSize.height <= 0) {
      throw new Error("图片尺寸读取失败");
    }

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = naturalSize.width;
    exportCanvas.height = naturalSize.height;
    const ctx = exportCanvas.getContext("2d");
    if (!ctx) {
      throw new Error("无法创建遮罩");
    }

    ctx.fillStyle = "rgba(255,255,255,1)";
    ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    ctx.globalCompositeOperation = "destination-out";
    strokes.forEach((stroke) => {
      renderStroke(ctx, stroke, exportCanvas.width, exportCanvas.height, "#000000");
    });

    const previewCanvas = document.createElement("canvas");
    previewCanvas.width = naturalSize.width;
    previewCanvas.height = naturalSize.height;
    const previewCtx = previewCanvas.getContext("2d");
    if (!previewCtx) {
      throw new Error("无法创建选区预览");
    }

    const sourceImage = imageRef.current;
    if (sourceImage) {
      previewCtx.drawImage(sourceImage, 0, 0, previewCanvas.width, previewCanvas.height);
    } else {
      previewCtx.fillStyle = "rgba(245,245,244,1)";
      previewCtx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
    }
    previewCtx.fillStyle = "rgba(15, 23, 42, 0.08)";
    previewCtx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
    strokes.forEach((stroke) => {
      renderStroke(previewCtx, stroke, previewCanvas.width, previewCanvas.height, "rgba(80, 120, 255, 0.42)");
    });

    const blob = await canvasToBlob(exportCanvas);
    return {
      file: new File([blob], "mask.png", { type: "image/png" }),
      previewDataUrl: previewCanvas.toDataURL("image/png"),
    };
  };

  const handleSubmit = async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      toast.error("请输入编辑说明");
      return;
    }
    if (!hasSelection) {
      toast.error("请先点击“选择”并涂抹需要修改的区域");
      return;
    }

    try {
      const mask = await buildMaskPayload();
      await onSubmit({ prompt: trimmedPrompt, mask });
    } catch (error) {
      const message = error instanceof Error ? error.message : "提交编辑失败";
      toast.error(message);
    }
  };

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 bg-white/95 backdrop-blur-sm">
      <div className="flex h-full flex-col">
        <header className="flex items-center justify-between border-b border-stone-200 px-5 py-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex size-9 items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-100 hover:text-stone-900"
            >
              <X className="size-5" />
            </button>
            <div>
              <div className="text-xl font-semibold tracking-tight text-stone-950">编辑选择</div>
              <div className="text-sm text-stone-500">{imageName}</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={handleUndo}
              disabled={!hasSelection || isSubmitting}
            >
              <Undo2 className="size-4" />
              撤销
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={handleRedo}
              disabled={redoStrokes.length === 0 || isSubmitting}
            >
              <Redo2 className="size-4" />
              重做
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={handleClear}
              disabled={(!hasSelection && !currentStroke) || isSubmitting}
            >
              <Trash2 className="size-4" />
              清空
            </Button>
            <Button
              variant={selectionMode ? "default" : "outline"}
              size="sm"
              className={cn("rounded-full", selectionMode ? "bg-stone-950 text-white hover:bg-stone-800" : "")}
              onClick={() => setSelectionMode((value) => !value)}
              disabled={isSubmitting}
            >
              <Brush className="size-4" />
              {selectionMode ? "正在选择" : "选择"}
            </Button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-hidden px-6 py-6">
          <div className="w-full max-w-[1200px] rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <span>{helperText}</span>
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium uppercase tracking-[0.18em] text-stone-400">笔刷</span>
                <Input
                  type="range"
                  min="16"
                  max="96"
                  step="2"
                  value={brushSize}
                  onChange={(event) => setBrushSize(Number(event.target.value))}
                  className="h-8 w-[160px] border-0 bg-transparent px-0"
                />
                <span className="min-w-10 text-right text-sm font-medium text-stone-700">{brushSize}px</span>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 w-full flex-1 items-center justify-center overflow-auto">
            <div className="relative inline-flex max-h-full max-w-full items-center justify-center">
              {/* 原生 img 便于直接读取天然尺寸并与遮罩 canvas 做 1:1 叠加。 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imageRef}
                src={imageSrc}
                alt={imageName}
                className="max-h-[calc(100vh-300px)] max-w-full rounded-2xl border border-stone-200 bg-white object-contain shadow-[0_24px_70px_rgba(28,25,23,0.10)]"
                onLoad={(event) => {
                  const target = event.currentTarget;
                  setNaturalSize({
                    width: target.naturalWidth,
                    height: target.naturalHeight,
                  });
                  const rect = target.getBoundingClientRect();
                  setDisplaySize({
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                  });
                }}
              />
              {displaySize.width > 0 && displaySize.height > 0 ? (
                <canvas
                  ref={canvasRef}
                  className={cn(
                    "absolute rounded-2xl touch-none",
                    selectionMode ? "cursor-crosshair pointer-events-auto" : "pointer-events-none",
                  )}
                  style={{
                    width: displaySize.width,
                    height: displaySize.height,
                    touchAction: selectionMode ? "none" : "auto",
                  }}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={finishStroke}
                  onPointerLeave={finishStroke}
                  onPointerCancel={finishStroke}
                />
              ) : null}
            </div>
          </div>
        </div>

        <footer className="border-t border-stone-200 px-6 py-5">
          <div className="mx-auto flex w-full max-w-[920px] items-end gap-4 rounded-[32px] border border-stone-200 bg-white px-5 py-4 shadow-[0_18px_48px_rgba(28,25,23,0.08)]">
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="描述选区内要怎么改，比如“把这几个字改成愿此行·终抵群星，与方块之地，保留原版风格和排版质感”"
              className="min-h-[88px] flex-1 resize-none rounded-none border-0 bg-transparent px-1 py-1 text-[15px] leading-7 shadow-none focus-visible:ring-0"
            />
            <Button
              className="h-11 rounded-full bg-stone-950 px-5 text-white hover:bg-stone-800"
              onClick={() => void handleSubmit()}
              disabled={isSubmitting}
            >
              {isSubmitting ? "处理中..." : "提交编辑"}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
