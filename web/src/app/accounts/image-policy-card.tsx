"use client";

import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Account } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  buildImageAccountGroupPreviews,
  getEffectiveImageAccountPolicy,
  getStoredImageAccountPolicy,
  normalizeImageAccountPolicy,
  setStoredImageAccountPolicy,
  type ImageAccountSortMode,
  type StoredImageAccountPolicy,
} from "@/store/image-account-policy";

type ImagePolicyCardProps = {
  accounts: Account[];
};

function formatImportedAt(value?: string | null) {
  if (!value) {
    return "未记录";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function ImagePolicyCard({ accounts }: ImagePolicyCardProps) {
  const [imagePolicy, setImagePolicy] = useState<StoredImageAccountPolicy>(() => getStoredImageAccountPolicy());

  useEffect(() => {
    setStoredImageAccountPolicy(imagePolicy);
  }, [imagePolicy]);

  const groups = useMemo(
    () => buildImageAccountGroupPreviews(accounts, imagePolicy),
    [accounts, imagePolicy],
  );

  const effectivePolicy = useMemo(
    () => getEffectiveImageAccountPolicy(imagePolicy, { groupCount: groups.length }),
    [groups.length, imagePolicy],
  );

  const enabledGroupSummary = useMemo(
    () =>
      effectivePolicy.enabledGroupIndexes.length > 0
        ? effectivePolicy.enabledGroupIndexes.map((index) => index + 1).join(" / ")
        : "未选择",
    [effectivePolicy.enabledGroupIndexes],
  );

  const updatePolicy = (patch: Partial<StoredImageAccountPolicy>) => {
    setImagePolicy((previous) =>
      normalizeImageAccountPolicy({
        ...previous,
        ...patch,
      }),
    );
  };

  const toggleGroup = (groupIndex: number, enabled: boolean) => {
    setImagePolicy((previous) => {
      const nextGroupIndexes = enabled
        ? Array.from(new Set([...previous.enabledGroupIndexes, groupIndex]))
        : previous.enabledGroupIndexes.filter((value) => value !== groupIndex);
      return normalizeImageAccountPolicy({
        ...previous,
        enabledGroupIndexes: nextGroupIndexes,
      });
    });
  };

  return (
    <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-stone-950">图片账号分组策略</h2>
            <p className="mt-1 text-sm leading-6 text-stone-500">
              仅对当前浏览器生效。启用后，当前浏览器发起的生图请求会优先在已勾选分组内轮询，并为每个账号保留安全阈值。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={imagePolicy.enabled ? "success" : "secondary"}>
              {imagePolicy.enabled ? "已启用" : "未启用"}
            </Badge>
            <Badge variant="info">实际发送分组：{enabledGroupSummary}</Badge>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-stone-100 bg-stone-50 p-4">
            <div className="mb-2 text-sm font-medium text-stone-800">是否启用</div>
            <div className="flex items-center gap-3">
              <Checkbox
                checked={imagePolicy.enabled}
                onCheckedChange={(checked) => updatePolicy({ enabled: Boolean(checked) })}
              />
              <span className="text-sm text-stone-600">为当前浏览器启用分组轮询</span>
            </div>
          </div>
          <div className="rounded-2xl border border-stone-100 bg-stone-50 p-4">
            <div className="mb-2 text-sm font-medium text-stone-800">排序方式</div>
            <Select
              value={imagePolicy.sortMode}
              onValueChange={(value) => updatePolicy({ sortMode: value as ImageAccountSortMode })}
            >
              <SelectTrigger className="h-10 rounded-xl border-stone-200 bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="imported_at">按导入时间</SelectItem>
                <SelectItem value="name">按名称</SelectItem>
                <SelectItem value="quota">按剩余额度</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-2xl border border-stone-100 bg-stone-50 p-4">
            <div className="mb-2 text-sm font-medium text-stone-800">每组账号数</div>
            <Input
              min={1}
              max={100}
              type="number"
              value={imagePolicy.groupSize}
              onChange={(event) => updatePolicy({ groupSize: Number(event.target.value) || 1 })}
              className="h-10 rounded-xl border-stone-200 bg-white"
            />
          </div>
          <div className="rounded-2xl border border-stone-100 bg-stone-50 p-4">
            <div className="mb-2 text-sm font-medium text-stone-800">保底百分比</div>
            <Input
              min={0}
              max={100}
              type="number"
              value={imagePolicy.reservePercent}
              onChange={(event) => updatePolicy({ reservePercent: Number(event.target.value) || 0 })}
              className="h-10 rounded-xl border-stone-200 bg-white"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className="h-9 rounded-xl border-stone-200 bg-white text-stone-700"
            onClick={() =>
              updatePolicy({
                enabledGroupIndexes: groups.slice(0, Math.min(2, groups.length)).map((group) => group.index),
              })
            }
            disabled={groups.length === 0}
          >
            勾选前 2 组
          </Button>
          <Button
            variant="outline"
            className="h-9 rounded-xl border-stone-200 bg-white text-stone-700"
            onClick={() =>
              updatePolicy({
                enabledGroupIndexes: groups.map((group) => group.index),
              })
            }
            disabled={groups.length === 0}
          >
            勾选全部分组
          </Button>
          <Button
            variant="outline"
            className="h-9 rounded-xl border-stone-200 bg-white text-stone-700"
            onClick={() => updatePolicy({ enabledGroupIndexes: [] })}
          >
            清空分组
          </Button>
        </div>

        <div className="grid gap-3 xl:grid-cols-2">
          {groups.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-stone-200 bg-stone-50 px-4 py-6 text-sm text-stone-500">
              先导入账号，这里才会生成自动分组预览。
            </div>
          ) : (
            groups.map((group) => (
              <div
                key={group.index}
                className={cn(
                  "rounded-2xl border p-4 transition-colors",
                  group.enabled ? "border-emerald-200 bg-emerald-50/70" : "border-stone-200 bg-stone-50",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={group.enabled}
                        onCheckedChange={(checked) => toggleGroup(group.index, Boolean(checked))}
                      />
                      <span className="text-sm font-semibold text-stone-900">{group.label}</span>
                      <Badge variant={group.enabled ? "success" : "secondary"}>
                        {group.enabled ? "参与轮询" : "不参与"}
                      </Badge>
                    </div>
                    <p className="text-xs text-stone-500">
                      共 {group.accounts.length} 个账号，可用 {group.availableCount} 个，总剩余 {group.totalRemaining}，
                      平均剩余 {group.averageRemaining}
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <div className="rounded-xl bg-white/80 px-3 py-2 text-xs text-stone-600">
                    <div className="text-stone-400">首个账号导入时间</div>
                    <div className="mt-1 font-medium text-stone-800">
                      {formatImportedAt(group.accounts[0]?.importedAt)}
                    </div>
                  </div>
                  <div className="rounded-xl bg-white/80 px-3 py-2 text-xs text-stone-600">
                    <div className="text-stone-400">末个账号导入时间</div>
                    <div className="mt-1 font-medium text-stone-800">
                      {formatImportedAt(group.accounts[group.accounts.length - 1]?.importedAt)}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
