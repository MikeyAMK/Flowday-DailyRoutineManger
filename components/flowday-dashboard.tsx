"use client";

import {
  Activity,
  ArrowRight,
  BookOpen,
  CalendarDays,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Coffee,
  Dumbbell,
  Focus,
  Leaf,
  LogOut,
  Moon,
  Plus,
  RotateCcw,
  Sparkles,
  Sun,
  Sunrise,
  Utensils,
  X,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

type Category = "morning" | "meal" | "focus" | "break" | "movement" | "personal" | "event";
type Daypart = "morning" | "afternoon" | "evening";
type Subcategory = "morning-routine" | "midday-activities" | "work-study" | "night-routine" | "personal-time" | "plans";
type AdjustmentMode = "late" | "early";
type ScheduleSaveStatus = "connecting" | "saving" | "saved" | "local";

type ScheduleItem = {
  id: string;
  title: string;
  start: number;
  originalStart: number;
  duration: number;
  category: Category;
  fixed: boolean;
  done: boolean;
  skipped?: boolean;
  subcategory?: Subcategory;
  note?: string;
};

const PLANNED_DAY_END = 17 * 60;

const dayparts: { key: Daypart; label: string; icon: LucideIcon }[] = [
  { key: "morning", label: "Morning", icon: Sun },
  { key: "afternoon", label: "Afternoon", icon: Sunrise },
  { key: "evening", label: "Evening", icon: Moon },
];

const subcategoryNames: Record<Subcategory, string> = {
  "morning-routine": "Morning routine",
  "midday-activities": "Midday activities",
  "work-study": "Work / study",
  "night-routine": "Night routine",
  "personal-time": "Personal time",
  plans: "Plans & appointments",
};

const categoryIcons: Record<Category, LucideIcon> = {
  morning: Sun,
  meal: Utensils,
  focus: Focus,
  break: Coffee,
  movement: Dumbbell,
  personal: BookOpen,
  event: CalendarPlus,
};

const categoryNames: Record<Category, string> = {
  morning: "Morning",
  meal: "Meal",
  focus: "Focus time",
  break: "A little pause",
  movement: "Movement",
  personal: "Personal",
  event: "Fixed event",
};

function createStarterPlan(): ScheduleItem[] {
  return [
    { id: "wake", title: "Wake up & get ready", start: 7 * 60, originalStart: 7 * 60, duration: 30, category: "morning", subcategory: "morning-routine", fixed: true, done: false, note: "Ease into the day" },
    { id: "breakfast", title: "Breakfast", start: 7 * 60 + 30, originalStart: 7 * 60 + 30, duration: 30, category: "meal", subcategory: "morning-routine", fixed: false, done: false, note: "A little fuel before you begin" },
    { id: "deep-work", title: "Focus block", start: 8 * 60, originalStart: 8 * 60, duration: 120, category: "focus", subcategory: "work-study", fixed: false, done: false, note: "One important thing at a time" },
    { id: "reset", title: "Short reset", start: 10 * 60, originalStart: 10 * 60, duration: 15, category: "break", subcategory: "midday-activities", fixed: false, done: false, note: "Stretch, breathe, get some water" },
    { id: "assignments", title: "Assignments & errands", start: 10 * 60 + 15, originalStart: 10 * 60 + 15, duration: 60, category: "focus", subcategory: "work-study", fixed: false, done: false, note: "Take the next small step" },
    { id: "workout", title: "Move your body", start: 11 * 60 + 15, originalStart: 11 * 60 + 15, duration: 60, category: "movement", subcategory: "midday-activities", fixed: false, done: false, note: "Gym, walk, or whatever feels good" },
    { id: "lunch", title: "Lunch", start: 12 * 60 + 15, originalStart: 12 * 60 + 15, duration: 45, category: "meal", subcategory: "midday-activities", fixed: false, done: false, note: "Step away from your to-do list" },
    { id: "project", title: "Personal project time", start: 13 * 60, originalStart: 13 * 60, duration: 120, category: "personal", subcategory: "work-study", fixed: false, done: false, note: "Make progress at your own pace" },
    { id: "review", title: "Review & plan ahead", start: 15 * 60, originalStart: 15 * 60, duration: 30, category: "focus", subcategory: "work-study", fixed: false, done: false, note: "Notice what you got done" },
    { id: "free-time", title: "Free time", start: 15 * 60 + 30, originalStart: 15 * 60 + 30, duration: 90, category: "personal", subcategory: "personal-time", fixed: false, done: false, note: "Leave room for life" },
  ];
}

function itemDaypart(item: ScheduleItem): Daypart {
  const minuteOfDay = ((item.start % (24 * 60)) + 24 * 60) % (24 * 60);
  if (minuteOfDay < 12 * 60) return "morning";
  if (minuteOfDay < 17 * 60) return "afternoon";
  return "evening";
}

function itemSubcategory(item: ScheduleItem): Subcategory {
  if (item.subcategory) return item.subcategory;
  if (item.category === "event") return "plans";
  if (item.category === "morning" || (item.category === "meal" && item.start < 12 * 60)) return "morning-routine";
  if (item.category === "break" || item.category === "movement" || item.category === "meal") return "midday-activities";
  if (item.category === "personal" && item.title.toLowerCase().includes("free")) return "personal-time";
  return "work-study";
}

function timeRange(items: ScheduleItem[]) {
  if (!items.length) return "Nothing planned yet";
  const start = Math.min(...items.map((item) => item.start));
  const end = Math.max(...items.map((item) => item.start + item.duration));
  return `${formatTime(start)} – ${formatTime(end)}`;
}

function reflowAroundFixedItems(items: ScheduleItem[]): ScheduleItem[] {
  const fixedItems = items.filter((item) => item.fixed && !item.skipped).sort((a, b) => a.start - b.start);
  const flexibleItems = items.filter((item) => !item.fixed && !item.skipped).sort((a, b) => a.originalStart - b.originalStart);
  const skippedItems = items.filter((item) => item.skipped);
  let cursor = 7 * 60;

  const rescheduled = flexibleItems.map((item) => {
    let start = Math.max(item.originalStart, cursor);
    let foundConflict = true;

    while (foundConflict) {
      foundConflict = false;
      for (const fixed of fixedItems) {
        const overlaps = start < fixed.start + fixed.duration && fixed.start < start + item.duration;
        if (overlaps) {
          start = fixed.start + fixed.duration;
          foundConflict = true;
          break;
        }
      }
    }

    cursor = start + item.duration;
    return { ...item, start };
  });

  return [...fixedItems, ...rescheduled, ...skippedItems].sort((a, b) => a.start - b.start || Number(b.fixed) - Number(a.fixed));
}

function formatTime(minutes: number) {
  const hour = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  const period = hour < 12 ? "AM" : "PM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute.toString().padStart(2, "0")} ${period}`;
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours && remainder) return `${hours} hr ${remainder} min`;
  if (hours) return `${hours} ${hours === 1 ? "hr" : "hrs"}`;
  return `${minutes} min`;
}

function scheduleEnd(items: ScheduleItem[]) {
  const activeItems = items.filter((item) => !item.skipped);
  return activeItems.length ? Math.max(...activeItems.map((item) => item.start + item.duration)) : 7 * 60;
}

function currentActivityEnd(items: ScheduleItem[], currentMinute: number) {
  const activeEnds = items
    .filter((item) => !item.skipped && !item.done && item.start < currentMinute && item.start + item.duration > currentMinute)
    .map((item) => item.start + item.duration);
  return Math.max(currentMinute, ...activeEnds);
}

function shortenRemainingSchedule(
  items: ScheduleItem[],
  cuts: Record<string, number>,
  skippedIds: string[],
  currentMinute: number,
) {
  const skipped = new Set(skippedIds);
  const fixedItems = items.filter((item) => item.fixed && !item.skipped);
  const candidates = items
    .filter((item) => !item.fixed && !item.done && !item.skipped && item.start >= currentMinute)
    .sort((a, b) => a.start - b.start);
  const updates = new Map<string, ScheduleItem>();
  let savedMinutes = 0;
  let cursor = currentActivityEnd(items, currentMinute);

  for (const item of candidates) {
    if (skipped.has(item.id)) {
      updates.set(item.id, { ...item, skipped: true });
      savedMinutes += item.duration;
      continue;
    }
    const cut = Math.min(cuts[item.id] ?? 0, Math.max(item.duration - 15, 0));
    const duration = Math.max(15, item.duration - cut);
    let start = Math.max(currentMinute, cursor, item.start - savedMinutes);
    let overlapsFixed = true;
    while (overlapsFixed) {
      overlapsFixed = false;
      for (const fixed of fixedItems) {
        if (start < fixed.start + fixed.duration && fixed.start < start + duration) {
          start = fixed.start + fixed.duration;
          overlapsFixed = true;
          break;
        }
      }
    }
    updates.set(item.id, { ...item, start, duration });
    cursor = start + duration;
    savedMinutes += cut;
  }

  return items.map((item) => updates.get(item.id) ?? item).sort((a, b) => a.start - b.start || Number(b.fixed) - Number(a.fixed));
}

function moveRemainingEarlier(
  items: ScheduleItem[],
  minutes: number,
  skippedIds: string[],
  currentMinute: number,
) {
  const skipped = new Set(skippedIds);
  const fixedItems = items.filter((item) => item.fixed && !item.skipped);
  const candidates = items
    .filter((item) => !item.fixed && !item.done && !item.skipped && item.start >= currentMinute)
    .sort((a, b) => a.start - b.start);
  const updates = new Map<string, ScheduleItem>();
  let skippedMinutes = 0;
  let cursor = currentActivityEnd(items, currentMinute);

  for (const item of candidates) {
    if (skipped.has(item.id)) {
      updates.set(item.id, { ...item, skipped: true });
      skippedMinutes += item.duration;
      continue;
    }
    let start = Math.max(currentMinute, cursor, item.start - minutes - skippedMinutes);
    let overlapsFixed = true;
    while (overlapsFixed) {
      overlapsFixed = false;
      for (const fixed of fixedItems) {
        if (start < fixed.start + fixed.duration && fixed.start < start + item.duration) {
          start = fixed.start + fixed.duration;
          overlapsFixed = true;
          break;
        }
      }
    }
    updates.set(item.id, { ...item, start });
    cursor = start + item.duration;
  }

  return items.map((item) => updates.get(item.id) ?? item).sort((a, b) => a.start - b.start || Number(b.fixed) - Number(a.fixed));
}

function localDateKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function readableDate() {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());
}

function greetingPeriod(currentMinute: number | null): "morning" | "afternoon" | "evening" {
  const hour = currentMinute === null ? 9 : Math.floor(currentMinute / 60);
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

export function FlowdayDashboard() {
  const router = useRouter();
  const [items, setItems] = useState<ScheduleItem[]>(createStarterPlan);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [scheduleUserId, setScheduleUserId] = useState<string | null>(null);
  const [scheduleSaveStatus, setScheduleSaveStatus] = useState<ScheduleSaveStatus>("connecting");
  const [isEventFormOpen, setIsEventFormOpen] = useState(false);
  const [isOverflowPromptOpen, setIsOverflowPromptOpen] = useState(false);
  const [isSqueezeEditorOpen, setIsSqueezeEditorOpen] = useState(false);
  const [isAdjustmentOpen, setIsAdjustmentOpen] = useState(false);
  const [adjustmentMode, setAdjustmentMode] = useState<AdjustmentMode>("late");
  const [adjustmentMinutes, setAdjustmentMinutes] = useState(30);
  const [adjustmentNowMinute, setAdjustmentNowMinute] = useState(7 * 60);
  const [adjustmentCuts, setAdjustmentCuts] = useState<Record<string, number>>({});
  const [adjustmentSkippedIds, setAdjustmentSkippedIds] = useState<string[]>([]);
  const [pendingSchedule, setPendingSchedule] = useState<ScheduleItem[] | null>(null);
  const [pendingEventName, setPendingEventName] = useState("");
  const [pendingEventId, setPendingEventId] = useState<string | null>(null);
  const [squeezeCuts, setSqueezeCuts] = useState<Record<string, number>>({});
  const [eventTitle, setEventTitle] = useState("");
  const [eventTime, setEventTime] = useState("12:00");
  const [eventDuration, setEventDuration] = useState(60);
  const [eventError, setEventError] = useState("");
  const [toast, setToast] = useState("");
  const [today, setToday] = useState("Your plan for today");
  const [currentMinute, setCurrentMinute] = useState<number | null>(null);
  const [selectedDaypart, setSelectedDaypart] = useState<Daypart>("morning");
  const [expandedSubcategory, setExpandedSubcategory] = useState<string | null>("morning-routine");

  useEffect(() => {
    let cancelled = false;
    const date = localDateKey();
    setToday(readableDate());
    const updateClock = () => {
      const now = new Date();
      setCurrentMinute(now.getHours() * 60 + now.getMinutes());
    };
    updateClock();
    const clockInterval = window.setInterval(updateClock, 60_000);

    let localPlan = createStarterPlan();
    try {
      const stored = localStorage.getItem("flowday-plan-v1");
      if (stored) {
        const parsed = JSON.parse(stored) as { date?: string; items?: ScheduleItem[] };
        if (parsed.date === date && Array.isArray(parsed.items) && parsed.items.length > 0) {
          localPlan = parsed.items;
        }
      }
    } catch {
      localPlan = createStarterPlan();
    }

    const loadSchedule = async () => {
      try {
        const supabase = createClient();
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (cancelled) return;
        if (userError || !user) {
          setItems(localPlan);
          setScheduleSaveStatus("local");
          setHasLoaded(true);
          return;
        }

        setScheduleUserId(user.id);
        const { data, error } = await supabase
          .from("flowday_schedules")
          .select("items")
          .eq("user_id", user.id)
          .eq("schedule_date", date)
          .maybeSingle();
        if (cancelled) return;
        if (error) {
          setItems(localPlan);
          setScheduleSaveStatus("local");
          setHasLoaded(true);
          return;
        }

        const scheduleItems = Array.isArray(data?.items) ? data.items as ScheduleItem[] : localPlan;
        setItems(scheduleItems);
        setScheduleSaveStatus(data ? "saved" : "saving");
        setHasLoaded(true);
      } catch {
        if (cancelled) return;
        setItems(localPlan);
        setScheduleSaveStatus("local");
        setHasLoaded(true);
      }
    };

    void loadSchedule();
    return () => {
      cancelled = true;
      window.clearInterval(clockInterval);
    };
  }, []);

  useEffect(() => {
    if (!hasLoaded) return;
    const date = localDateKey();
    try {
      localStorage.setItem("flowday-plan-v1", JSON.stringify({ date, items }));
    } catch {
      // The schedule still works for this visit if browser storage is unavailable.
    }

    if (!scheduleUserId) {
      setScheduleSaveStatus("local");
      return;
    }

    let cancelled = false;
    setScheduleSaveStatus("saving");
    const saveTimeout = window.setTimeout(async () => {
      try {
        const supabase = createClient();
        const { error } = await supabase.from("flowday_schedules").upsert({
          user_id: scheduleUserId,
          schedule_date: date,
          items,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id,schedule_date" });
        if (!cancelled) setScheduleSaveStatus(error ? "local" : "saved");
      } catch {
        if (!cancelled) setScheduleSaveStatus("local");
      }
    }, 500);

    return () => {
      cancelled = true;
      window.clearTimeout(saveTimeout);
    };
  }, [items, hasLoaded, scheduleUserId]);

  const activeItems = items.filter((item) => !item.skipped);
  const upcomingTask = currentMinute === null ? undefined : activeItems
    .filter((item) => !item.done && item.start >= currentMinute)
    .sort((a, b) => a.start - b.start)[0];
  const currentTask = currentMinute === null ? undefined : activeItems.find((item) =>
    !item.done && item.start < currentMinute && item.start + item.duration > currentMinute,
  );
  const currentGreetingPeriod = greetingPeriod(currentMinute);
  const greetingMessage = currentMinute === null
    ? ", a little structure, with room to adjust."
    : upcomingTask
      ? `, next task is ${upcomingTask.title} at ${formatTime(upcomingTask.start)}.`
      : currentTask
        ? `, you’re on ${currentTask.title} now.`
        : ", no more tasks are scheduled today.";
  const completedCount = useMemo(() => activeItems.filter((item) => item.done).length, [activeItems]);
  const routineCount = activeItems.length;
  const completion = routineCount ? Math.round((completedCount / routineCount) * 100) : 0;
  const saveStatusText = scheduleSaveStatus === "saved"
    ? "Saved to your account"
    : scheduleSaveStatus === "saving"
      ? "Saving your plan..."
      : scheduleSaveStatus === "connecting"
        ? "Connecting to your account..."
        : "Saved on this device";
  const plannedMinutes = useMemo(() => activeItems.reduce((total, item) => total + item.duration, 0), [activeItems]);
  const dayStart = activeItems.length ? Math.min(...activeItems.map((item) => item.start)) : 7 * 60;
  const dayEnd = scheduleEnd(activeItems);
  const movedCount = useMemo(
    () => activeItems.filter((item) => !item.fixed && item.start !== item.originalStart).length,
    [activeItems],
  );
  const focusMinutes = useMemo(
    () => activeItems.filter((item) => item.category === "focus").reduce((total, item) => total + item.duration, 0),
    [activeItems],
  );
  const firstEvent = activeItems.find((item) => item.category === "event");
  const daypartSchedules = dayparts.map((daypart) => ({
    ...daypart,
    items: activeItems.filter((item) => itemDaypart(item) === daypart.key),
  }));
  const selectedDaypartItems = activeItems.filter((item) => itemDaypart(item) === selectedDaypart);
  const subcategoryMap = new Map<Subcategory, ScheduleItem[]>();
  selectedDaypartItems.forEach((item) => {
    const key = itemSubcategory(item);
    subcategoryMap.set(key, [...(subcategoryMap.get(key) ?? []), item]);
  });
  const selectedSubcategories = Array.from(subcategoryMap.entries())
    .map(([key, groupItems]) => ({ key, label: subcategoryNames[key], items: groupItems }))
    .sort((a, b) => Math.min(...a.items.map((item) => item.start)) - Math.min(...b.items.map((item) => item.start)));
  const pendingEnd = pendingSchedule ? scheduleEnd(pendingSchedule) : PLANNED_DAY_END;
  const squeezeEvent = pendingSchedule?.find((item) => item.id === pendingEventId && item.category === "event");
  const squeezeCandidates = pendingSchedule?.filter((item) =>
    !item.fixed && !item.done && item.duration > 15 && squeezeEvent && item.start >= squeezeEvent.start + squeezeEvent.duration,
  ) ?? [];
  const squeezePreview = pendingSchedule?.map((item) => ({
    ...item,
    duration: Math.max(15, item.duration - (squeezeCuts[item.id] ?? 0)),
  })) ?? [];
  const squeezedSchedule = pendingSchedule ? reflowAroundFixedItems(squeezePreview) : [];
  const squeezedEnd = pendingSchedule ? scheduleEnd(squeezedSchedule) : PLANNED_DAY_END;
  const totalSqueezeMinutes = Object.values(squeezeCuts).reduce((total, minutes) => total + minutes, 0);
  const adjustmentCandidates = activeItems
    .filter((item) => !item.fixed && !item.done && item.start >= adjustmentNowMinute)
    .sort((a, b) => a.start - b.start);
  const adjustmentPreview = adjustmentMode === "late"
    ? shortenRemainingSchedule(items, adjustmentCuts, adjustmentSkippedIds, adjustmentNowMinute)
    : moveRemainingEarlier(items, adjustmentMinutes, adjustmentSkippedIds, adjustmentNowMinute);
  const adjustmentEnd = scheduleEnd(adjustmentPreview);
  const selectedLateSavings = adjustmentCandidates.reduce((total, item) => {
    if (adjustmentSkippedIds.includes(item.id)) return total + item.duration;
    return total + Math.min(adjustmentCuts[item.id] ?? 0, Math.max(item.duration - 15, 0));
  }, 0);
  const selectedLateCount = adjustmentCandidates.filter((item) =>
    adjustmentSkippedIds.includes(item.id) || (adjustmentCuts[item.id] ?? 0) > 0,
  ).length;
  const earliestAdjustableStart = adjustmentCandidates[0]?.start ?? adjustmentNowMinute;
  const adjustmentAnchorEnd = currentActivityEnd(items, adjustmentNowMinute);
  const availableEarlyMinutes = Math.max(0, earliestAdjustableStart - adjustmentAnchorEnd);
  const actualEarlyShift = Math.min(adjustmentMinutes, availableEarlyMinutes);
  const canApplyAdjustment = adjustmentMode === "late"
    ? adjustmentCandidates.length > 0 && selectedLateSavings >= adjustmentMinutes
    : adjustmentCandidates.length > 0 && (actualEarlyShift > 0 || adjustmentSkippedIds.length > 0);

  function toggleDone(id: string) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, done: !item.done } : item));
  }

  function finishAddingEvent(next: ScheduleItem[], title: string, shortenedCount = 0, addedEventId?: string) {
    const moved = next.filter((item) => !item.fixed && item.start !== item.originalStart).length;
    const addedEvent = next.find((item) => item.id === (addedEventId ?? pendingEventId));
    setItems(next);
    if (addedEvent) {
      setSelectedDaypart(itemDaypart(addedEvent));
      setExpandedSubcategory("plans");
    }
    setToast(shortenedCount > 0
      ? `${title} is in. We shortened ${shortenedCount} ${shortenedCount === 1 ? "routine" : "routines"}; your day ends at ${formatTime(scheduleEnd(next))}.`
      : `${title} is added to your day. ${moved ? `${moved} routine ${moved === 1 ? "block moved" : "blocks moved"}; ` : ""}your day ends at ${formatTime(scheduleEnd(next))}.`);
    setPendingSchedule(null);
    setPendingEventName("");
    setPendingEventId(null);
    setSqueezeCuts({});
    setIsOverflowPromptOpen(false);
    setIsSqueezeEditorOpen(false);
  }

  function cancelPendingEvent() {
    setPendingSchedule(null);
    setPendingEventName("");
    setPendingEventId(null);
    setSqueezeCuts({});
    setIsOverflowPromptOpen(false);
    setIsSqueezeEditorOpen(false);
  }

  function addEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEventError("");
    const title = eventTitle.trim();
    const [hoursText, minutesText] = eventTime.split(":");
    const start = Number(hoursText) * 60 + Number(minutesText);
    if (!title) {
      setEventError("Give your event a name so you can spot it in your day.");
      return;
    }

    const overlapsFixed = items.some((item) => item.fixed && start < item.start + item.duration && item.start < start + eventDuration);
    if (overlapsFixed) {
      setEventError("That time overlaps another fixed item. Try a different start time.");
      return;
    }

    const newEvent: ScheduleItem = {
      id: `event-${Date.now()}`,
      title,
      start,
      originalStart: start,
      duration: eventDuration,
      category: "event",
      fixed: true,
      done: false,
      note: "This time is held in place",
    };
    const next = reflowAroundFixedItems([...items, newEvent]);
    setIsEventFormOpen(false);
    setEventTitle("");
    if (scheduleEnd(next) > PLANNED_DAY_END) {
      setPendingSchedule(next);
      setPendingEventName(title);
      setPendingEventId(newEvent.id);
      setSqueezeCuts({});
      setIsOverflowPromptOpen(true);
      return;
    }
    finishAddingEvent(next, title, 0, newEvent.id);
  }

  async function logOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
    router.refresh();
  }

  function resetDay() {
    setItems(createStarterPlan());
    setSelectedDaypart("morning");
    setExpandedSubcategory("morning-routine");
    setToast("Your sample day is back in place.");
  }

  function openScheduleAdjustment(mode: AdjustmentMode) {
    const now = new Date();
    setAdjustmentNowMinute(now.getHours() * 60 + now.getMinutes());
    setAdjustmentMode(mode);
    setAdjustmentMinutes(30);
    setAdjustmentCuts({});
    setAdjustmentSkippedIds([]);
    setIsAdjustmentOpen(true);
  }

  function applyScheduleAdjustment() {
    if (!canApplyAdjustment) return;
    setItems(adjustmentPreview);
    const earlyChanges = [
      actualEarlyShift ? `moved the upcoming plan up by ${formatDuration(actualEarlyShift)}` : "",
      adjustmentSkippedIds.length ? `skipped ${adjustmentSkippedIds.length} routine${adjustmentSkippedIds.length === 1 ? "" : "s"} for today` : "",
    ].filter(Boolean).join(" and ");
    setToast(adjustmentMode === "late"
      ? `You made back ${formatDuration(selectedLateSavings)} across ${selectedLateCount} ${selectedLateCount === 1 ? "routine" : "routines"}. Your day now ends at ${formatTime(adjustmentEnd)}.`
      : `You ${earlyChanges}. Your day now ends at ${formatTime(adjustmentEnd)}.`);
    setIsAdjustmentOpen(false);
    setAdjustmentCuts({});
    setAdjustmentSkippedIds([]);
  }

  return (
    <div className="flow-shell">
      <header className="flow-topbar">
        <a className="flow-brand" href="/protected" aria-label="Flowday home">
          <span className="flow-brand-mark"><Leaf size={19} strokeWidth={2.2} /></span>
          <span>flowday</span>
        </a>
        <div className="flow-topbar-center">
          <span className="flow-nav-icon"><CalendarDays size={16} /></span>
          <span>My day</span>
        </div>
        <button className="flow-logout" type="button" onClick={logOut}>
          <LogOut size={16} />
          <span>Log out</span>
        </button>
      </header>

      <main className="flow-main">
        <section className="flow-intro">
          <div>
            <div className="flow-date-row">
              <span className="flow-date">{today}</span>
              <span className="flow-live"><span />Your day is in motion</span>
            </div>
            <h1>
              <span className={`flow-greeting flow-greeting-${currentGreetingPeriod}`}>Good {currentGreetingPeriod}</span>
              {greetingMessage}
            </h1>
            <p className="flow-subtitle">Plan the things that matter. Flowday will help the rest fit around them.</p>
          </div>
          <div className="flow-intro-actions">
            <button className="flow-adjustment-button" type="button" onClick={() => openScheduleAdjustment("late")}>
              <Clock3 size={16} /> Running Late
            </button>
            <button className="flow-adjustment-button" type="button" onClick={() => openScheduleAdjustment("early")}>
              <Sun size={16} /> Running Early
            </button>
            <button className="flow-primary-button" type="button" onClick={() => { setIsEventFormOpen(true); setEventError(""); }}>
              <Plus size={18} strokeWidth={2.5} />
              Add a change
            </button>
          </div>
        </section>

        <section className="flow-stats" aria-label="Your day at a glance">
          <article className="flow-stat-card">
            <span className="flow-stat-icon green"><Clock3 size={18} /></span>
            <div><span className="flow-stat-label">Time planned</span><strong>{formatDuration(plannedMinutes)}</strong></div>
            <span className="flow-stat-caption">routines &amp; events</span>
          </article>
          <article className="flow-stat-card">
            <span className="flow-stat-icon lilac"><Focus size={18} /></span>
            <div><span className="flow-stat-label">Focus time</span><strong>{formatDuration(focusMinutes)}</strong></div>
            <span className="flow-stat-caption">for what matters most</span>
          </article>
          <article className="flow-stat-card">
            <span className="flow-stat-icon peach"><CheckCircle2 size={18} /></span>
            <div><span className="flow-stat-label">Day progress</span><strong>{completedCount} of {routineCount} blocks</strong></div>
            <div className="flow-progress-track"><span style={{ width: `${completion}%` }} /></div>
          </article>
        </section>

        <div className="flow-content-grid">
          <section className="flow-schedule-panel">
            <div className="flow-panel-heading">
              <div>
                <span className="flow-section-kicker">YOUR PLAN</span>
                <h2>Today&apos;s schedule</h2>
              </div>
              <span className="flow-time-window">{formatTime(dayStart)} <span>—</span> {formatTime(dayEnd)}</span>
            </div>
            {toast && (
              <div className="flow-toast" role="status">
                <span className="flow-toast-check"><Check size={14} /></span>
                <span>{toast}</span>
                <button type="button" aria-label="Dismiss message" onClick={() => setToast("")}><X size={16} /></button>
              </div>
            )}
            <div className="flow-planner-board">
              <div className="flow-daypart-rail" role="tablist" aria-label="Choose a part of your day">
                {daypartSchedules.map((daypart) => {
                  const Icon = daypart.icon;
                  const total = daypart.items.reduce((sum, item) => sum + item.duration, 0);
                  const selected = selectedDaypart === daypart.key;
                  return (
                    <div className={`flow-daypart-stop ${selected ? "selected" : ""}`} key={daypart.key}>
                      <span className="flow-daypart-time">
                        <strong>{daypart.items.length ? timeRange(daypart.items) : "Open"}</strong>
                        <small>{total ? `${formatDuration(total)} planned` : "Nothing planned"}</small>
                      </span>
                      <button
                        className={`flow-daypart-button ${selected ? "selected" : ""}`}
                        id={`flow-period-${daypart.key}`}
                        type="button"
                        role="tab"
                        aria-label={`${daypart.label}, ${total ? formatDuration(total) : "open"}, ${timeRange(daypart.items)}`}
                        aria-selected={selected}
                        aria-controls="flow-period-panel"
                        title={daypart.label}
                        onClick={() => {
                          setSelectedDaypart(daypart.key);
                          const firstItem = [...daypart.items].sort((a, b) => a.start - b.start)[0];
                          setExpandedSubcategory(firstItem ? itemSubcategory(firstItem) : null);
                        }}
                      >
                        <Icon className="flow-daypart-symbol" size={25} strokeWidth={1.7} aria-hidden="true" />
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="flow-daypart-content" id="flow-period-panel" role="tabpanel" aria-labelledby={`flow-period-${selectedDaypart}`} key={selectedDaypart}>
              {selectedSubcategories.length ? selectedSubcategories.map((group) => {
                const expanded = expandedSubcategory === group.key;
                const total = group.items.reduce((sum, item) => sum + item.duration, 0);
                return (
                  <section className="flow-subcategory" key={group.key}>
                    <button
                      className={`flow-subcategory-heading ${expanded ? "expanded" : ""}`}
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={`flow-subcategory-${group.key}`}
                      onClick={() => setExpandedSubcategory(expanded ? null : group.key)}
                    >
                      <span className="flow-subcategory-copy"><strong>{group.label}</strong><small>{timeRange(group.items)}</small></span>
                      <span className="flow-subcategory-total">{formatDuration(total)}</span>
                      <ChevronDown className="flow-subcategory-chevron" size={16} />
                    </button>
                    {expanded && (
                      <div className="flow-schedule-list" id={`flow-subcategory-${group.key}`}>
                        {group.items.map((item) => {
                          const Icon = categoryIcons[item.category];
                          const shifted = !item.fixed && item.start !== item.originalStart;
                          return (
                            <article className={`flow-schedule-row ${item.done ? "is-done" : ""}`} key={item.id}>
                              <div className="flow-time-column">
                                <strong>{formatTime(item.start)}</strong>
                                <span>to {formatTime(item.start + item.duration)}</span>
                              </div>
                              <div className="flow-timeline-rail" aria-hidden="true"><span className={`flow-timeline-dot ${item.category}`} /></div>
                              <div className={`flow-block ${item.category}`}>
                                <span className={`flow-block-icon ${item.category}`}><Icon size={17} strokeWidth={1.9} /></span>
                                <div className="flow-block-copy">
                                  <div className="flow-block-title-line">
                                    <h3>{item.title}</h3>
                                    {shifted && <span className="flow-moved-tag">Moved</span>}
                                    {item.category === "event" && <span className="flow-fixed-tag">Fixed time</span>}
                                  </div>
                                  <p>{item.note ?? categoryNames[item.category]}</p>
                                </div>
                                <div className="flow-block-meta">
                                  <span>{formatDuration(item.duration)}</span>
                                  <button
                                    className="flow-done-button"
                                    type="button"
                                    aria-label={`${item.done ? "Mark" : "Complete"} ${item.title}`}
                                    title={item.done ? "Mark as not done" : "Mark as done"}
                                    onClick={() => toggleDone(item.id)}
                                  >
                                    {item.done ? <Check size={15} /> : <span />}
                                  </button>
                                </div>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </section>
                );
              }) : (
                <div className="flow-daypart-empty">
                  <span className="flow-daypart-empty-icon"><Sparkles size={18} /></span>
                  <strong>Your {selectedDaypart === "evening" ? "evening is open" : `${selectedDaypart} is open`}</strong>
                  <p>{selectedDaypart === "evening" ? "Your night routine can live here." : "Nothing is planned here yet. Your routines will show up in this section."}</p>
                </div>
              )}
              </div>
            </div>
            <div className="flow-schedule-footer">
              <span><Sparkles size={15} /> Your routine can move when plans change.</span>
              <span>{saveStatusText}</span>
            </div>
          </section>

          <aside className="flow-side-column">
            <section className="flow-flex-card">
              <div className="flow-flex-card-top"><span className="flow-flex-sparkle"><Sparkles size={17} /></span><span>MADE TO FLEX</span></div>
              <h2>{firstEvent ? "Your day made room." : "Plans change. Your day can too."}</h2>
              <p>{firstEvent
                ? `“${firstEvent.title}” stays at ${formatTime(firstEvent.start)}${movedCount ? ` while ${movedCount} routine ${movedCount === 1 ? "block shifts" : "blocks shift"} around it.` : "."}`
                : "Add a meeting, an errand, or a friend hangout. Flowday will keep it in place and move flexible routines around it."}</p>
              <button className="flow-flex-action" type="button" onClick={() => { setIsEventFormOpen(true); setEventError(""); }}>
                Add an event <ArrowRight size={16} />
              </button>
              <div className="flow-flex-decoration"><span /><span /><span /><span /></div>
            </section>

            <section className="flow-progress-card">
              <div className="flow-progress-heading">
                <span className="flow-side-icon"><Activity size={17} /></span>
                <div><h2>Your rhythm</h2><p>Small steps count.</p></div>
              </div>
              <div className="flow-rhythm-number"><strong>{completedCount}</strong><span>of {routineCount} blocks complete</span></div>
              <div className="flow-progress-track large"><span style={{ width: `${completion}%` }} /></div>
              <div className="flow-progress-bottom"><span>{completion}% of today</span><span>{Math.max(routineCount - completedCount, 0)} left</span></div>
            </section>

            <section className="flow-tip-card">
              <span className="flow-tip-icon"><Sparkles size={16} /></span>
              <div>
                <h2>A flexible plan is still a plan.</h2>
                <p>When you add something new, Flowday protects that time and shifts the blocks around it.</p>
              </div>
            </section>

            <button className="flow-reset-button" type="button" onClick={resetDay}>
              <RotateCcw size={14} /> Reset to sample day
            </button>
          </aside>
        </div>
      </main>

      <footer className="flow-footer"><span>flowday</span><span>Make a little room for what matters.</span></footer>

      {isEventFormOpen && (
        <div className="flow-modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setIsEventFormOpen(false);
        }}>
          <section className="flow-modal" role="dialog" aria-modal="true" aria-labelledby="event-modal-title">
            <div className="flow-modal-heading">
              <span className="flow-modal-icon"><CalendarPlus size={20} /></span>
              <button className="flow-modal-close" type="button" aria-label="Close" onClick={() => setIsEventFormOpen(false)}><X size={18} /></button>
            </div>
            <span className="flow-section-kicker">MAKE ROOM FOR LIFE</span>
            <h2 id="event-modal-title">What changed?</h2>
            <p className="flow-modal-description">Add a fixed event. We&apos;ll rearrange the flexible parts of your day around it.</p>
            <form onSubmit={addEvent}>
              <label className="flow-field-label" htmlFor="event-title">Event name</label>
              <input id="event-title" autoFocus value={eventTitle} onChange={(event) => setEventTitle(event.target.value)} placeholder="Friend hangout, appointment…" maxLength={60} />
              <div className="flow-form-row">
                <div>
                  <label className="flow-field-label" htmlFor="event-time">Starts at</label>
                  <input id="event-time" type="time" value={eventTime} onChange={(event) => setEventTime(event.target.value)} />
                </div>
                <div>
                  <label className="flow-field-label" htmlFor="event-duration">How long?</label>
                  <select id="event-duration" value={eventDuration} onChange={(event) => setEventDuration(Number(event.target.value))}>
                    <option value={30}>30 minutes</option>
                    <option value={60}>1 hour</option>
                    <option value={90}>1 hour 30 minutes</option>
                    <option value={120}>2 hours</option>
                    <option value={180}>3 hours</option>
                  </select>
                </div>
              </div>
              {eventError && <p className="flow-form-error" role="alert">{eventError}</p>}
              <div className="flow-modal-note"><Clock3 size={15} /><span>Your event stays fixed. Flexible routines may move later.</span></div>
              <button className="flow-primary-button flow-modal-submit" type="submit">Add &amp; adjust my day <ArrowRight size={17} /></button>
            </form>
          </section>
        </div>
      )}

      {isAdjustmentOpen && (
        <div className="flow-modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setIsAdjustmentOpen(false);
        }}>
          <section className="flow-modal flow-adjustment-modal" role="dialog" aria-modal="true" aria-labelledby="adjustment-modal-title">
            <div className="flow-modal-heading">
              <span className="flow-modal-icon"><Clock3 size={20} /></span>
              <button className="flow-modal-close" type="button" aria-label="Close" onClick={() => setIsAdjustmentOpen(false)}><X size={18} /></button>
            </div>
            <span className="flow-section-kicker">TODAY&apos;S PLAN, YOUR CALL</span>
            <h2 id="adjustment-modal-title">{adjustmentMode === "late" ? "Running late?" : "Running early?"}</h2>
            <p className="flow-modal-description">
              {adjustmentMode === "late"
                ? "Choose how much time you need back, then decide which routines to shorten or skip for today."
                : "Choose how much earlier to move your upcoming plan. You can also choose routines to skip today."}
            </p>

            <span className="flow-field-label">
              {adjustmentMode === "late" ? "How much time do you need back?" : "How far ahead should the plan move?"}
            </span>
            <div className="flow-adjustment-choices" role="group" aria-label={adjustmentMode === "late" ? "Time to make up" : "Move schedule earlier"}>
              {[15, 30, 45, 60].map((minutes) => (
                <button
                  className={`flow-adjustment-choice ${adjustmentMinutes === minutes ? "selected" : ""}`}
                  key={minutes}
                  type="button"
                  aria-pressed={adjustmentMinutes === minutes}
                  onClick={() => setAdjustmentMinutes(minutes)}
                >
                  {formatDuration(minutes)}
                </button>
              ))}
            </div>

            <div className="flow-adjustment-summary" role="status">
              {adjustmentMode === "late" ? (
                <>
                  <strong>{formatDuration(selectedLateSavings)} made room · {selectedLateSavings >= adjustmentMinutes ? "goal reached" : `${formatDuration(Math.max(adjustmentMinutes - selectedLateSavings, 0))} still needed`}</strong>
                  <span>Your day would end at {formatTime(adjustmentEnd)}.</span>
                </>
              ) : (
                <>
                  <strong>{actualEarlyShift ? `Upcoming blocks move up ${formatDuration(actualEarlyShift)}` : "No open time to move the plan earlier"}</strong>
                  <span>{adjustmentSkippedIds.length ? `${adjustmentSkippedIds.length} routine${adjustmentSkippedIds.length === 1 ? "" : "s"} selected to skip today. ` : ""}Your day would end at {formatTime(adjustmentEnd)}.</span>
                </>
              )}
            </div>

            {adjustmentCandidates.length ? (
              <div className="flow-adjustment-list">
                <p className="flow-field-label">Choose what feels lower priority today</p>
                {adjustmentCandidates.map((item) => {
                  const maxCut = Math.floor((item.duration - 15) / 5) * 5;
                  const cut = Math.min(adjustmentCuts[item.id] ?? 0, maxCut);
                  const skipped = adjustmentSkippedIds.includes(item.id);
                  const sliderId = `adjustment-${item.id}`;
                  const skipId = `skip-${item.id}`;
                  return (
                    <div className="flow-squeeze-item" key={item.id}>
                      <div className="flow-squeeze-item-heading">
                        <label htmlFor={sliderId}>{item.title}</label>
                        <span>{skipped ? "Skipped today" : cut ? `Shorten by ${formatDuration(cut)}` : `${formatDuration(item.duration)} now`}</span>
                      </div>
                      {adjustmentMode === "late" && maxCut > 0 && (
                        <>
                          <input
                            id={sliderId}
                            className="flow-squeeze-slider"
                            type="range"
                            min={0}
                            max={maxCut}
                            step={5}
                            value={skipped ? 0 : cut}
                            disabled={skipped}
                            aria-label={`Shorten ${item.title}`}
                            onChange={(event) => setAdjustmentCuts((current) => ({ ...current, [item.id]: Number(event.target.value) }))}
                          />
                          {cut > 0 && !skipped && <span className="flow-squeeze-new-duration">It will still have {formatDuration(item.duration - cut)}.</span>}
                        </>
                      )}
                      {adjustmentMode === "late" && maxCut === 0 && <span className="flow-squeeze-new-duration">This routine is already at its shortest length.</span>}
                      <label className="flow-adjustment-skip" htmlFor={skipId}>
                        <input
                          id={skipId}
                          type="checkbox"
                          checked={skipped}
                          onChange={(event) => {
                            setAdjustmentSkippedIds((current) => event.target.checked
                              ? [...current, item.id]
                              : current.filter((id) => id !== item.id));
                            if (event.target.checked) {
                              setAdjustmentCuts((current) => ({ ...current, [item.id]: 0 }));
                            }
                          }}
                        />
                        <span>Skip this routine today</span>
                      </label>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="flow-squeeze-empty">There are no upcoming unfinished routines to adjust. Your fixed plans stay in place.</p>
            )}

            <div className="flow-squeeze-actions">
              <button className="flow-squeeze-back" type="button" onClick={() => setIsAdjustmentOpen(false)}>Cancel</button>
              <button className="flow-primary-button flow-modal-submit" type="button" disabled={!canApplyAdjustment} onClick={applyScheduleAdjustment}>
                Apply my choices <ArrowRight size={16} />
              </button>
            </div>
          </section>
        </div>
      )}

      {isOverflowPromptOpen && pendingSchedule && (
        <div className="flow-modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) cancelPendingEvent();
        }}>
          <section className="flow-modal flow-squeeze-modal" role="dialog" aria-modal="true" aria-labelledby="squeeze-prompt-title">
            <div className="flow-modal-heading">
              <span className="flow-modal-icon"><Clock3 size={20} /></span>
              <button className="flow-modal-close" type="button" aria-label="Close" onClick={cancelPendingEvent}><X size={18} /></button>
            </div>
            <span className="flow-section-kicker">SQUEEZE ME IN</span>
            <h2 id="squeeze-prompt-title">Today might run a little longer.</h2>
            <p className="flow-modal-description">
              Adding <strong>{pendingEventName}</strong> would move your finish time from {formatTime(PLANNED_DAY_END)} to {formatTime(pendingEnd)}. Would you like to extend your day, or make room by shortening a few routines?
            </p>
            <div className="flow-squeeze-choice-list">
              <button className="flow-squeeze-choice" type="button" onClick={() => finishAddingEvent(pendingSchedule, pendingEventName)}>
                <span><strong>Extend today</strong><small>Keep all your routines the same length.</small></span>
                <span className="flow-squeeze-choice-time">Ends {formatTime(pendingEnd)}</span>
              </button>
              <button className="flow-squeeze-choice featured" type="button" onClick={() => { setIsOverflowPromptOpen(false); setIsSqueezeEditorOpen(true); }}>
                <span><strong>Squeeze me in</strong><small>Choose what can get a little less time today.</small></span>
                <ArrowRight size={17} />
              </button>
            </div>
            <button className="flow-squeeze-cancel" type="button" onClick={cancelPendingEvent}>Keep my day as it is</button>
          </section>
        </div>
      )}

      {isSqueezeEditorOpen && pendingSchedule && (
        <div className="flow-modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) cancelPendingEvent();
        }}>
          <section className="flow-modal flow-squeeze-modal" role="dialog" aria-modal="true" aria-labelledby="squeeze-editor-title">
            <div className="flow-modal-heading">
              <span className="flow-modal-icon"><Sparkles size={20} /></span>
              <button className="flow-modal-close" type="button" aria-label="Close" onClick={cancelPendingEvent}><X size={18} /></button>
            </div>
            <span className="flow-section-kicker">SQUEEZE ME IN</span>
            <h2 id="squeeze-editor-title">What can get a little less time?</h2>
            <p className="flow-modal-description">Choose the routines you want to prioritize less just for today. Flowday will keep at least 15 minutes for each one.</p>
            <div className="flow-squeeze-summary" role="status">
              <span>{Math.max(pendingEnd - PLANNED_DAY_END, 0) ? `Need to make up ${formatDuration(pendingEnd - PLANNED_DAY_END)} to finish by ${formatTime(PLANNED_DAY_END)}.` : "Your day fits within its planned time."}</span>
              <strong>With these changes, your day ends at {formatTime(squeezedEnd)}.</strong>
            </div>
            {squeezeCandidates.length ? (
              <div className="flow-squeeze-list">
                {squeezeCandidates.map((item) => {
                  const maxCut = Math.floor((item.duration - 15) / 5) * 5;
                  const cut = Math.min(squeezeCuts[item.id] ?? 0, maxCut);
                  const sliderId = `squeeze-${item.id}`;
                  return (
                    <div className="flow-squeeze-item" key={item.id}>
                      <div className="flow-squeeze-item-heading">
                        <label htmlFor={sliderId}>{item.title}</label>
                        <span>{cut ? `Shorten by ${formatDuration(cut)}` : `${formatDuration(item.duration)} now`}</span>
                      </div>
                      <input
                        id={sliderId}
                        className="flow-squeeze-slider"
                        type="range"
                        min={0}
                        max={maxCut}
                        step={5}
                        value={cut}
                        aria-label={`Shorten ${item.title}`}
                        onChange={(event) => setSqueezeCuts((current) => ({ ...current, [item.id]: Number(event.target.value) }))}
                      />
                      {cut > 0 && <span className="flow-squeeze-new-duration">It will still have {formatDuration(item.duration - cut)}.</span>}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="flow-squeeze-empty">There are no unfinished routines after this plan to shorten. You can extend your day instead.</p>
            )}
            {squeezedEnd > PLANNED_DAY_END && totalSqueezeMinutes > 0 && (
              <p className="flow-squeeze-note">The selected changes help, and your day will still finish at {formatTime(squeezedEnd)}.</p>
            )}
            <div className="flow-squeeze-actions">
              <button className="flow-squeeze-back" type="button" onClick={() => { setIsSqueezeEditorOpen(false); setIsOverflowPromptOpen(true); }}><ArrowRight className="flow-back-arrow" size={15} /> Back</button>
              <button
                className="flow-primary-button flow-modal-submit"
                type="button"
                disabled={totalSqueezeMinutes === 0 || squeezedEnd >= pendingEnd}
                onClick={() => finishAddingEvent(squeezedSchedule, pendingEventName, Object.values(squeezeCuts).filter((minutes) => minutes > 0).length)}
              >
                Use this plan <ArrowRight size={16} />
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
