"use client";

import { CircleCheck, Clock, LoaderCircle, TriangleAlert, Circle, FlaskConical } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import type { CapiLabel, CapiStatus, InboxLabels, InboxTag } from "@/lib/inbox/labels";
import { cn } from "@/lib/utils";

const statusStyle = {
  accepted: { icon: CircleCheck, color: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200" },
  pending: { icon: Clock, color: "bg-amber-500/15 text-amber-900 dark:text-amber-200" },
  retrying: { icon: Clock, color: "bg-amber-500/15 text-amber-900 dark:text-amber-200" },
  sending: { icon: LoaderCircle, color: "bg-sky-500/15 text-sky-900 dark:text-sky-200" },
  failed: { icon: TriangleAlert, color: "bg-destructive/10 text-destructive" },
  needs_review: { icon: TriangleAlert, color: "bg-amber-500/15 text-amber-900 dark:text-amber-200" },
  tested: { icon: FlaskConical, color: "bg-sky-500/15 text-sky-900 dark:text-sky-200" },
  skipped: { icon: Circle, color: "bg-muted text-muted-foreground" },
  not_sent: { icon: Circle, color: "bg-muted text-muted-foreground" },
} satisfies Record<CapiStatus, { icon: typeof Circle; color: string }>;

const focusRing = "rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function TagChip({ tag, expanded = false }: { tag: InboxTag; expanded?: boolean }) {
  return (
    <span className={cn("inline-block min-w-0 rounded border-l-2 bg-muted px-1.5 py-0.5 text-xs font-medium leading-tight text-foreground",
      expanded ? "break-words" : "max-w-[7rem] truncate")}
      style={{ borderLeftColor: tag.color, backgroundColor: `color-mix(in srgb, ${tag.color} 17%, var(--muted))` }}>
      {tag.name}
    </span>
  );
}

export function ConversationLabels({ tags, capi }: { tags: InboxTag[]; capi?: InboxLabels[string]["capi"] }) {
  const t = useTranslations("Inbox.conversationLabels");
  const format = useFormatter();

  function labelFor(event: CapiLabel) {
    if (event.test && event.status === "accepted") return t("status.tested");
    const label = t(`status.${event.status}`);
    return event.test && event.status !== "tested" ? t("testStatus", { status: label }) : label;
  }

  if (!tags.length && !capi) return null;
  const visible = tags.slice(0, 2);
  const style = capi && statusStyle[capi.latest.test && capi.latest.status === "accepted" ? "tested" : capi.latest.status];
  const Icon = style?.icon;

  return (
    <div className="ml-16 flex min-w-0 items-center gap-1.5 pb-2 pr-3">
      {tags.length > 0 && (
        <Popover>
          <PopoverTrigger aria-label={t("viewTags", { count: tags.length })}
            className={cn(focusRing, "flex min-h-7 min-w-0 items-center gap-1 text-left")}>
            {visible.map(tag => <TagChip key={tag.id} tag={tag} />)}
            {tags.length > visible.length &&
              <span className="shrink-0 rounded bg-muted px-1 text-xs text-muted-foreground">+{tags.length - visible.length}</span>}
          </PopoverTrigger>
          <PopoverContent align="start" className="max-h-64 max-w-[calc(100vw-2rem)] overflow-y-auto">
            <PopoverTitle>{t("tags")}</PopoverTitle>
            <div className="flex min-w-0 flex-wrap gap-1.5">
              {tags.map(tag => <TagChip key={tag.id} tag={tag} expanded />)}
            </div>
          </PopoverContent>
        </Popover>
      )}
      {capi && style && Icon && (
        <Popover>
          <PopoverTrigger aria-label={t("viewCapi", { status: labelFor(capi.latest) })}
            className={cn(focusRing, "ml-auto flex min-h-7 max-w-[60%] min-w-0 shrink-0 items-center")}>
            <span className={cn("inline-flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium leading-tight", style.color)}>
              <Icon aria-hidden="true" className={cn("size-3 shrink-0", capi.latest.status === "sending" && "motion-safe:animate-spin")} />
              <span className="truncate">CAPI {labelFor(capi.latest)}</span>
            </span>
          </PopoverTrigger>
          <PopoverContent align="end" className="max-h-80 max-w-[calc(100vw-2rem)] overflow-y-auto">
            <PopoverTitle>{t("conversionStatus")}</PopoverTitle>
            <PopoverDescription>{t("receiptHint")}</PopoverDescription>
            {capi.latest.status === "not_sent" && <p className="text-xs">{t("notSentHint")}</p>}
            {capi.events.length > 0 && (
              <ul className="divide-y divide-border">
                {capi.events.map((event) => (
                  <li key={`${event.stage}-${event.test}`} className="space-y-1 py-2 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <strong className="min-w-0 break-words">{event.eventName}</strong>
                      <span className="shrink-0 text-muted-foreground">{labelFor(event)}</span>
                    </div>
                    <p className="text-muted-foreground">
                      {format.dateTime(new Date(event.occurredAt), "short")} · {t("attempts", { count: event.attempts })}
                    </p>
                    {event.sentAt && <p className="text-muted-foreground">{t("sentAt", { date: format.dateTime(new Date(event.sentAt), "short") })}</p>}
                    {event.issue && <p className="text-muted-foreground">{t(`issue.${event.issue}`)}</p>}
                  </li>
                ))}
              </ul>
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
