/**
 * pi-personal-sidebar — a theme-aware right-side dashboard for Pi.
 *
 * Pi has no native sidebar, so this wraps the TUI layout root in an HStack and
 * reserves a fixed right column. The chat/editor reflow into the remaining
 * width instead of being covered.
 *
 * The panel follows the active Pi theme: borders use the same thinking-level
 * color as the chat input, titles use `mdHeading`, text uses `text`, and
 * percentages/agent names use `mdCode`.
 *
 * Requires fullscreen mode (`tuiMode: "fullscreen"`), Pi's default.
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { HStack, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { fetchQuotaSnapshot, type QuotaSnapshot } from "./quota.ts";
import {
  addSessionUsage,
  cacheHitPercent,
  emptySessionUsage,
  type SessionUsage,
} from "./session-usage.ts";
import {
  createTranslator,
  isSidebarLanguage,
  languageLabel,
  resolveLanguage,
  type ResolvedLanguage,
  type SidebarLanguage,
  type Translator,
} from "./i18n.ts";

const execFileAsync = promisify(execFile);

const WIDGET_KEY = "personal-sidebar-anchor";
const TODO_WIDGET_KEY = "rpiv-todos";
const STATE_PATH = path.join(os.homedir(), ".pi", "agent", "personal-sidebar.json");
const MIN_TERMINAL_WIDTH = 100;
const MIN_SIDEBAR_WIDTH = 28;
const MAX_SIDEBAR_WIDTH = 56;
const DEFAULT_SIDEBAR_WIDTH = 40;
const TODO_LIMIT = 7;
const AGENT_LIMIT = 4;
const QUOTA_REFRESH_MS = 60_000;
const GIT_REFRESH_MS = 5_000;
const TODO_HIDE_MS = 5_000;

type SectionId = "git" | "todo" | "usage" | "agents" | "cache";
const SECTIONS: readonly SectionId[] = ["git", "todo", "usage", "agents", "cache"];

interface SidebarConfig {
  width: number;
  hidden: boolean;
  collapsed: SectionId[];
  language: SidebarLanguage;
}

interface GitInfo {
  repo: string;
  branch: string | null;
  dirty: number;
  folder: string;
  isRepo: boolean;
}

interface TodoTask {
  id: number;
  subject: string;
  status: "pending" | "in_progress" | "completed" | "deleted";
  activeForm?: string;
  blockedBy?: number[];
}

interface UsageData {
  snapshot: QuotaSnapshot | null;
  error?: string;
  updatedAt: number;
}

interface ContextSnapshot {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

interface AgentRun {
  id: string;
  agent: string;
  task: string;
  startedAt: number;
}

interface SidebarState {
  config: SidebarConfig;
  language: ResolvedLanguage;
  t: Translator;
  git: GitInfo | null;
  todos: TodoTask[];
  usage: UsageData;
  provider: string;
  sessionUsage: SessionUsage;
  contextUsage: ContextSnapshot | null;
  agents: Map<string, AgentRun>;
  model: string;
  thinking: string;
  cacheStatus: string;
}

interface SidebarHandlers {
  toggleSection: (id: SectionId) => void;
  cleanCache: () => void;
  unfocus: () => void;
  hide: () => void;
}

function loadConfig(): SidebarConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as Partial<SidebarConfig>;
    const width = Number(raw.width);
    const collapsed = Array.isArray(raw.collapsed)
      ? raw.collapsed.filter((id): id is SectionId => (SECTIONS as readonly string[]).includes(String(id)))
      : [];
    const language = isSidebarLanguage(raw.language) ? raw.language : "auto";
    return {
      width: Number.isFinite(width) ? Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width))) : DEFAULT_SIDEBAR_WIDTH,
      hidden: raw.hidden === true,
      collapsed,
      language,
    };
  } catch {
    return { width: DEFAULT_SIDEBAR_WIDTH, hidden: false, collapsed: [], language: "auto" };
  }
}

function saveConfig(config: SidebarConfig): void {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(config, null, 2) + "\n", "utf8");
  } catch {
    // A failed preference write must never break the session.
  }
}

function padCell(text: string, width: number): string {
  const clipped = truncateToWidth(text, Math.max(1, width), "…");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function shortPath(value: string, maxWidth: number): string {
  if (visibleWidth(value) <= maxWidth) return value;
  const parts = value.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return truncateToWidth(value, maxWidth, "…");
  return "…/" + truncateToWidth(parts.slice(-2).join("/"), Math.max(4, maxWidth - 2), "…");
}

/** Keep the provider and the last model segment when the id is long. */
function shortModel(value: string, maxWidth: number): string {
  if (visibleWidth(value) <= maxWidth) return value;
  const slash = value.indexOf("/");
  if (slash <= 0) return truncateToWidth(value, maxWidth, "…");
  const provider = value.slice(0, slash);
  const model = value.slice(slash + 1);
  const last = model.split("/").filter(Boolean).pop() ?? model;
  const withProvider = `${provider}/…${last}`;
  if (visibleWidth(withProvider) <= maxWidth) return withProvider;
  return truncateToWidth(`…${last}`, maxWidth, "…");
}

function formatClock(ms: number | null): string {
  if (ms === null) return "";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  const clock = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const sameDay = date.toDateString() === new Date().toDateString();
  if (sameDay) return clock;
  return `${date.toLocaleDateString([], { weekday: "short" })} ${clock}`;
}

function formatMoney(value: number | null, fallback = "n/d"): string {
  if (value === null || !Number.isFinite(value)) return fallback;
  if (Number.isInteger(value)) return value.toLocaleString();
  const text = value.toFixed(Math.abs(value) >= 10 ? 1 : 2);
  // 69.99 rounds to "70.0"; the trailing zero is only noise in a 40-col panel.
  return text.endsWith(".0") ? text.slice(0, -2) : text;
}

function formatPercent(value: number): string {
  if (value >= 99.95) return "100%";
  return `${value.toFixed(1)}%`;
}

function formatTokens(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "0";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) {
    const rounded = Math.round((count / 1_000) * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}k`;
  }
  return String(Math.round(count));
}

function elapsed(startedAt: number, now = Date.now()): string {
  const total = Math.max(0, Math.floor((now - startedAt) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/* Sidebar component                                                   */
/* ------------------------------------------------------------------ */

export class PersonalSidebar implements Component {
  focused = false;
  private state: SidebarState;
  private tui: TUI;
  private theme: Theme;
  private handlers: SidebarHandlers;
  private hitRows: Array<{ y: number; action: string }> = [];
  private focusRows: string[] = [];
  private focusIndex = 0;

  constructor(tui: TUI, theme: Theme, state: SidebarState, handlers: SidebarHandlers) {
    this.tui = tui;
    this.theme = theme;
    this.state = state;
    this.handlers = handlers;
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.invalidate();
  }

  invalidate(): void {
    // No cached render state.
  }

  dispose(): void {
    // Nothing to dispose.
  }

  private isCollapsed(id: SectionId): boolean {
    return this.state.config.collapsed.includes(id);
  }

  private pushTitle(body: string[], id: SectionId, title: string, badge?: string): void {
    const arrow = this.isCollapsed(id) ? "▸" : "▾";
    const label = `${arrow} ${title}${badge ? ` (${badge})` : ""}`;
    const y = body.length + 1; // + top border
    this.hitRows.push({ y, action: `toggle:${id}` });
    this.focusRows.push(`toggle:${id}`);
    body.push(this.theme.bold(this.theme.fg("mdHeading", label)));
  }

  private pushBody(body: string[], line: string): void {
    body.push("  " + line);
  }

  private buildBody(width: number): string[] {
    const body: string[] = [];
    this.hitRows = [];
    this.focusRows = [];
    const valueWidth = Math.max(8, width - 6);
    const prefixedWidth = Math.max(6, width - 11);
    const white = (text: string) => this.theme.fg("text", text);
    const orange = (text: string) => this.theme.fg("mdCode", text);

    // Git / folder
    this.pushTitle(body, "git", this.state.t("section.git"));
    if (!this.isCollapsed("git")) {
      const git = this.state.git;
      if (!git) {
        this.pushBody(body, white(this.state.t("value.loading")));
      } else if (!git.isRepo) {
        this.pushBody(body, `${white(this.state.t("label.repo"))} ${white(this.state.t("value.noGit"))}`);
        this.pushBody(body, `${white(this.state.t("label.folder"))} ${white(shortPath(git.folder, prefixedWidth))}`);
      } else {
        this.pushBody(body, `${white(this.state.t("label.repo"))} ${this.theme.bold(white(git.repo))}`);
        const dirty = git.dirty > 0 ? ` · ${git.dirty} ${this.state.t(git.dirty === 1 ? "value.change" : "value.changes")}` : "";
        this.pushBody(body, `${white(this.state.t("label.branch"))} ${white(git.branch || this.state.t("value.detached"))}${white(dirty)}`);
        this.pushBody(body, `${white(this.state.t("label.folder"))} ${white(shortPath(git.folder, prefixedWidth))}`);
      }
    }
    body.push("");

    // To-do
    const visibleTodos = this.state.todos.filter((task) => task.status !== "deleted");
    this.pushTitle(body, "todo", this.state.t("section.todo"), String(visibleTodos.length));
    if (!this.isCollapsed("todo")) {
      if (visibleTodos.length === 0) {
        this.pushBody(body, white(this.state.t("value.noTasks")));
      } else {
        for (const task of visibleTodos.slice(0, TODO_LIMIT)) {
          const icon =
            task.status === "completed"
              ? this.theme.fg("success", "[x]")
              : task.status === "in_progress"
                ? this.theme.fg("accent", "[~]")
                : this.theme.fg("dim", "[ ]");
          const text = task.status === "in_progress" && task.activeForm ? task.activeForm : task.subject;
          this.pushBody(body, `${icon} ${white(truncateToWidth(text, valueWidth, "…"))}`);
        }
        if (visibleTodos.length > TODO_LIMIT) {
          this.pushBody(body, white(this.state.t("value.more", { count: visibleTodos.length - TODO_LIMIT })));
        }
      }
    }
    body.push("");

    // Sub usage: quota, context window and session tokens
    this.pushTitle(body, "usage", this.state.t("section.usage"));
    if (!this.isCollapsed("usage")) {
      const usage = this.state.usage;
      const barWidth = Math.max(6, Math.min(12, valueWidth - 14));
      if (usage.error === "not-commandcode") {
        this.pushBody(body, white(this.state.t("value.quotaUnsupported")));
      } else if (usage.error) {
        this.pushBody(
          body,
          this.theme.fg(
            "warning",
            `${this.state.t("value.na")} (${usage.error === "no-credentials" ? this.state.t("value.noCredentials") : usage.error})`,
          ),
        );
      } else if (usage.snapshot) {
        this.pushBody(body, this.formatWindow("5h", usage.snapshot.fiveHour, barWidth));
        this.pushBody(body, this.formatWindow("7d", usage.snapshot.weekly, barWidth));
        this.pushBody(body, this.formatMonthly(usage.snapshot, barWidth, valueWidth));
      } else {
        this.pushBody(body, white(this.state.t("value.loading")));
      }

      const context = this.state.contextUsage;
      if (context && context.percent !== null) {
        const percent = clamp(Math.round(context.percent), 0, 100);
        this.pushBody(
          body,
          `${white(`${this.state.t("label.context")}:`)} ${this.bar(percent, barWidth)} ${orange(`${percent}%`)} ${white(`${formatTokens(context.tokens ?? 0)}/${formatTokens(context.contextWindow)}`)}`,
        );
      } else {
        this.pushBody(body, `${white(`${this.state.t("label.context")}:`)} ${white(this.state.t("value.na"))}`);
      }

      const totals = this.state.sessionUsage;
      const tokenTotal = totals.input + totals.output + totals.cacheRead + totals.cacheWrite;
      if (tokenTotal > 0) {
        const parts: string[] = [];
        if (totals.input > 0) parts.push(`↑${formatTokens(totals.input)}`);
        if (totals.output > 0) parts.push(`↓${formatTokens(totals.output)}`);
        if (totals.cacheRead > 0) parts.push(`R${formatTokens(totals.cacheRead)}`);
        if (totals.cacheWrite > 0) parts.push(`W${formatTokens(totals.cacheWrite)}`);
        this.pushBody(body, `${white(`${this.state.t("label.tokens")}:`)} ${white(parts.join(" "))}`);
      } else {
        this.pushBody(body, `${white(`${this.state.t("label.tokens")}:`)} ${white(this.state.t("value.na"))}`);
      }
      const hit = cacheHitPercent(totals);
      if (hit !== null) {
        this.pushBody(
          body,
          `${white(`${this.state.t("label.cacheHit")}:`)} ${this.bar(hit, barWidth, "hit")} ${orange(formatPercent(hit))}`,
        );
      }
      if (totals.cost > 0) {
        this.pushBody(body, `${white(`${this.state.t("label.cost")}:`)} ${orange(`$${totals.cost.toFixed(3)}`)}`);
      }

      this.pushBody(body, `${white(this.state.t("label.model"))} ${white(shortModel(this.state.model || this.state.t("value.na"), prefixedWidth))}`);
      this.pushBody(body, `${white(this.state.t("label.thinking"))} ${white(this.state.thinking || "off")}`);
    }
    body.push("");

    // Running subagents
    const agents = [...this.state.agents.values()];
    this.pushTitle(body, "agents", this.state.t("section.agents"), String(agents.length));
    if (!this.isCollapsed("agents")) {
      if (agents.length === 0) {
        this.pushBody(body, white(this.state.t("value.noneRunning")));
      } else {
        for (const agent of agents.slice(0, AGENT_LIMIT)) {
          this.pushBody(
            body,
            `${orange("●")} ${orange(this.theme.bold(agent.agent))} ${white(`· ${elapsed(agent.startedAt)}`)}`,
          );
          if (agent.task) {
            this.pushBody(body, white(truncateToWidth(agent.task, valueWidth, "…")));
          }
        }
        if (agents.length > AGENT_LIMIT) {
          this.pushBody(body, white(this.state.t("value.more", { count: agents.length - AGENT_LIMIT })));
        }
      }
    }
    body.push("");

    // NPM cache
    this.pushTitle(body, "cache", this.state.t("section.cache"));
    if (!this.isCollapsed("cache")) {
      const y = body.length + 1;
      this.hitRows.push({ y, action: "cache" });
      this.focusRows.push("cache");
      body.push(this.theme.bold(white(`  ${this.state.t("action.clearCache")}`)));
      if (this.state.cacheStatus) {
        this.pushBody(body, white(truncateToWidth(this.state.cacheStatus, valueWidth, "…")));
      } else {
        this.pushBody(body, white(this.state.t("cache.hint")));
      }
    }

    return body;
  }

  private bar(percent: number, width: number, mode: "used" | "hit" = "used"): string {
    const safe = clamp(percent, 0, 100);
    const filled = Math.round((safe / 100) * width);
    // Quota bars warn as they fill; a cache-hit bar is the other way around.
    const color =
      mode === "hit"
        ? safe >= 70
          ? "success"
          : safe >= 40
            ? "warning"
            : "error"
        : safe >= 90
          ? "error"
          : safe >= 70
            ? "warning"
            : "success";
    return this.theme.fg(color, "█".repeat(filled)) + this.theme.fg("dim", "░".repeat(Math.max(0, width - filled)));
  }

  /**
   * Monthly credits: the bar fills with the billing-period spend, against the
   * pool left plus what was already spent. Accounts without a billing period
   * fall back to the remaining balance, since there is no month to fill.
   */
  private formatMonthly(snapshot: QuotaSnapshot, barWidth: number, maxWidth: number): string {
    const white = (text: string) => this.theme.fg("text", text);
    const orange = (text: string) => this.theme.fg("mdCode", text);
    const monthly = snapshot.monthly;
    if (!monthly) {
      const remaining = snapshot.monthlyRemaining;
      return `${white(this.state.t("label.month"))} ${remaining === null ? white(this.state.t("value.na")) : orange(formatMoney(remaining, this.state.t("value.na")))} ${white(this.state.t("label.left"))}`;
    }
    const percent = clamp(Math.round((monthly.used / monthly.cap) * 100), 0, 100);
    const label = white(this.state.t("label.month"));
    const amounts = white(
      `$${formatMoney(monthly.used, this.state.t("value.na"))}/$${formatMoney(monthly.cap, this.state.t("value.na"))}`,
    );
    // Give the amounts their room first, then let the bar keep whatever is left.
    const room = maxWidth - visibleWidth(label) - visibleWidth(amounts) - 6; // separators + "NN%"
    const width = clamp(Math.min(barWidth, room), 3, barWidth);
    const head = `${label} ${this.bar(percent, width)} ${orange(`${percent}%`)}`;
    const withAmounts = `${head} ${amounts}`;
    return visibleWidth(withAmounts) <= maxWidth ? withAmounts : head;
  }

  private formatWindow(
    label: string,
    window: { used: number; cap: number; resetAt: number | null } | null,
    barWidth: number,
  ): string {
    const white = (text: string) => this.theme.fg("text", text);
    const orange = (text: string) => this.theme.fg("mdCode", text);
    if (!window || window.cap <= 0) return `${white(`${label}:`)} ${white(this.state.t("value.na"))}`;
    const percent = clamp(Math.round((window.used / window.cap) * 100), 0, 100);
    const reset = formatClock(window.resetAt);
    // The reset is secondary: a dim separator reads cleaner than a rotation
    // glyph glued to the clock, and it never depends on font fallback.
    const resetSuffix = reset ? ` ${this.theme.fg("dim", `· ${reset}`)}` : "";
    return `${white(`${label}:`)} ${this.bar(percent, barWidth)} ${orange(`${percent}%`)}${resetSuffix}${percent >= 100 ? this.theme.fg("warning", " ⚠") : ""}`;
  }

  render(width: number): string[] {
    const theme = this.theme;
    const panelWidth = Math.max(MIN_SIDEBAR_WIDTH, width);
    const innerWidth = Math.max(8, panelWidth - 2);
    const body = this.buildBody(innerWidth);
    const terminalRows = this.tui.terminal?.rows ?? 40;
    const height = Math.max(10, terminalRows);

    // Same border color as the chat input: the input border follows the
    // current thinking level, so the sidebar follows it too.
    const borderColor =
      typeof (theme as any).getThinkingBorderColor === "function"
        ? (theme as any).getThinkingBorderColor((this.state.thinking || "off") as any)
        : (text: string) => theme.fg("borderAccent", text);

    const panelLine = (content: string, highlighted = false) => {
      const bodyLine = " " + padCell(content, innerWidth - 1);
      return borderColor("│") + (highlighted ? theme.bg("selectedBg", bodyLine) : bodyLine) + borderColor("│");
    };

    const visible = body.slice(0, height - 2);
    // If the selected focus row is visible, highlight it.
    const focusedAction = this.focusRows[this.focusIndex];
    const focusRowIndex = focusedAction ? this.focusRows.indexOf(focusedAction) : -1;

    const lines: string[] = [];
    lines.push(borderColor("╭" + "─".repeat(innerWidth) + "╮"));
    for (let index = 0; index < visible.length; index++) {
      const highlighted = this.focused && index === focusRowIndex;
      lines.push(panelLine(visible[index] ?? "", highlighted));
    }
    while (lines.length < height - 1) lines.push(panelLine(""));
    lines.push(borderColor("╰" + "─".repeat(innerWidth) + "╯"));
    return lines;
  }

  private activate(action: string): void {
    if (action.startsWith("toggle:")) {
      const id = action.slice("toggle:".length) as SectionId;
      if (SECTIONS.includes(id)) this.handlers.toggleSection(id);
    } else if (action === "cache") {
      this.handlers.cleanCache();
    }
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.button !== "left" || event.type !== "click") return undefined;
    const hit = this.hitRows.find((row) => row.y === event.y);
    if (!hit) return undefined;
    this.focusIndex = Math.max(0, this.focusRows.indexOf(hit.action));
    this.activate(hit.action);
    return { handled: true, render: true };
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape")) {
      this.handlers.unfocus();
      return;
    }
    if (matchesKey(data, "up")) {
      this.focusIndex = this.focusRows.length ? (this.focusIndex - 1 + this.focusRows.length) % this.focusRows.length : 0;
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, "down")) {
      this.focusIndex = this.focusRows.length ? (this.focusIndex + 1) % this.focusRows.length : 0;
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, "enter") || matchesKey(data, "space")) {
      const action = this.focusRows[this.focusIndex];
      if (action) this.activate(action);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Layout wrapper: reserves a right column for the sidebar             */
/* ------------------------------------------------------------------ */

const SIDEBAR_GAP = 1;
const MIN_MAIN_WIDTH = 40;

class SidebarLayout extends HStack {
  private main: Component | null = null;
  private sidebar: Component;
  private sidebarWidth: number;
  private sidebarVisible: boolean;

  constructor(sidebar: Component, width: number, visible: boolean) {
    super([], { gap: SIDEBAR_GAP });
    this.sidebar = sidebar;
    this.sidebarWidth = clamp(width, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
    this.sidebarVisible = visible;
  }

  private rebuild(): void {
    const main = this.main;
    this.clear();
    if (main) {
      this.addChild(main, { grow: 1, basis: 0, shrink: 1, minSize: MIN_MAIN_WIDTH });
    }
    this.addChild(this.sidebar, {
      basis: this.sidebarWidth,
      minSize: this.sidebarWidth,
      maxSize: this.sidebarWidth,
      grow: 0,
      shrink: 0,
      visible: (viewport) => this.sidebarVisible && viewport.width >= MIN_TERMINAL_WIDTH,
    });
  }

  setMain(main: Component): void {
    this.main = main;
    this.rebuild();
  }

  setSidebarVisible(visible: boolean): void {
    this.sidebarVisible = visible;
    this.rebuild();
  }

  setSidebarWidth(width: number): void {
    this.sidebarWidth = clamp(width, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
    this.rebuild();
  }
}

/* ------------------------------------------------------------------ */
/* Extension runtime                                                   */
/* ------------------------------------------------------------------ */

export default function personalSidebarExtension(pi: ExtensionAPI): void {
  const config = loadConfig();
  const initialLanguage = resolveLanguage(config.language);
  const state: SidebarState = {
    config,
    language: initialLanguage,
    t: createTranslator(initialLanguage),
    git: null,
    todos: [],
    usage: { snapshot: null, updatedAt: 0 },
    provider: "",
    sessionUsage: emptySessionUsage(),
    contextUsage: null,
    agents: new Map(),
    model: "",
    thinking: "",
    cacheStatus: "",
  };

  const ref: {
    ctx: ExtensionContext | null;
    tui: TUI | null;
    component: PersonalSidebar | null;
    layout: SidebarLayout | null;
    previousFocus: Component | null;
    originalRoot: Component | null;
    originalSetLayoutRoot: ((root: Component | undefined) => void) | null;
    layoutUnavailableNotified: boolean;
  } = {
    ctx: null,
    tui: null,
    component: null,
    layout: null,
    previousFocus: null,
    originalRoot: null,
    originalSetLayoutRoot: null,
    layoutUnavailableNotified: false,
  };

  let timer: ReturnType<typeof setInterval> | null = null;
  let lastGit = 0;
  let lastQuota = 0;
  let lastSessionStats = 0;
  let lastTodoHide = 0;
  let gitInFlight = false;
  let quotaInFlight = false;

  const requestRender = () => {
    try {
      ref.tui?.requestRender();
    } catch {}
  };

  const hideRpiTodo = (ctx: ExtensionContext | null) => {
    try {
      ctx?.ui.setWidget(TODO_WIDGET_KEY, undefined);
    } catch {}
  };

  const handlers: SidebarHandlers = {
    toggleSection: (id) => {
      const collapsed = new Set(state.config.collapsed);
      if (collapsed.has(id)) collapsed.delete(id);
      else collapsed.add(id);
      state.config.collapsed = [...collapsed];
      saveConfig(state.config);
      requestRender();
    },
    cleanCache: () => {
      const ctx = ref.ctx;
      if (ctx) void cleanCache(ctx);
    },
    unfocus: () => {
      if (!ref.tui) return;
      const target = ref.previousFocus;
      ref.previousFocus = null;
      ref.tui.setFocus(target ?? null);
      requestRender();
    },
    hide: () => {
      setHidden(true);
    },
  };

  const layoutUnavailable = (ctx: ExtensionContext) => {
    if (ref.layoutUnavailableNotified) return;
    ref.layoutUnavailableNotified = true;
    ctx.ui.notify(state.t("command.fullscreenRequired"), "warning");
  };

  const installLayout = (tui: TUI, ctx: ExtensionContext): boolean => {
    const anyTui = tui as any;
    if (typeof anyTui.setLayoutRoot !== "function") {
      layoutUnavailable(ctx);
      return false;
    }
    if (ref.layout) return true;
    const layout = new SidebarLayout(ref.component!, state.config.width, !state.config.hidden);
    const originalSet = anyTui.setLayoutRoot.bind(tui);
    ref.layout = layout;
    ref.originalSetLayoutRoot = originalSet;
    ref.originalRoot = (anyTui.layoutRoot as Component | undefined) ?? null;
    try {
      anyTui.setLayoutRoot = (root: Component | undefined) => {
        if (!root) {
          ref.originalRoot = null;
          originalSet(undefined);
          return;
        }
        if (root === layout) {
          originalSet(root);
          return;
        }
        layout.setMain(root);
        ref.originalRoot = root;
        originalSet(layout);
      };
      if (ref.originalRoot) {
        layout.setMain(ref.originalRoot);
        originalSet(layout);
      }
    } catch {
      ref.layout = null;
      ref.originalSetLayoutRoot = null;
      ref.originalRoot = null;
      layoutUnavailable(ctx);
      return false;
    }
    return true;
  };

  const setHidden = (hidden: boolean) => {
    state.config.hidden = hidden;
    saveConfig(state.config);
    ref.layout?.setSidebarVisible(!hidden);
    requestRender();
  };

  const setWidth = (width: number) => {
    state.config.width = clamp(width, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
    saveConfig(state.config);
    ref.layout?.setSidebarWidth(state.config.width);
    requestRender();
  };

  const updateModel = (ctx: ExtensionContext) => {
    const model = ctx.model;
    const provider = (model as { provider?: string } | undefined)?.provider ?? "";
    const id = (model as { id?: string } | undefined)?.id ?? "";
    state.provider = provider;
    state.model = provider && id ? `${provider}/${id}` : id || "";
    state.thinking = ctx.thinkingLevel ?? "off";
  };

  const refreshSessionStats = (ctx: ExtensionContext) => {
    const totals = emptySessionUsage();
    try {
      const entries = ctx.sessionManager?.getEntries?.() ?? [];
      for (const entry of entries) {
        const item = entry as any;
        if (item?.type === "message" && item.message?.role === "assistant") {
          addSessionUsage(totals, item.message.usage);
        } else if (item?.type === "usage") {
          addSessionUsage(totals, item.usage);
        } else if (item?.type === "message" && item.message?.role === "toolResult" && item.message.usage) {
          addSessionUsage(totals, item.message.usage);
        } else if ((item?.type === "branch_summary" || item?.type === "compaction") && item.usage) {
          addSessionUsage(totals, item.usage);
        }
      }
    } catch {}
    state.sessionUsage = totals;
    try {
      const context = ctx.getContextUsage?.();
      state.contextUsage = context
        ? { tokens: context.tokens, contextWindow: context.contextWindow, percent: context.percent }
        : null;
    } catch {
      state.contextUsage = null;
    }
    requestRender();
  };

  const refreshGit = async (ctx: ExtensionContext) => {
    if (gitInFlight) return;
    gitInFlight = true;
    try {
      const top = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
        cwd: ctx.cwd,
        timeout: 5000,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });
      const root = String(top.stdout || "").trim();
      if (!root) {
        state.git = { repo: path.basename(ctx.cwd), branch: null, dirty: 0, folder: ctx.cwd, isRepo: false };
        return;
      }
      const [branch, status] = await Promise.all([
        execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
          cwd: root,
          timeout: 5000,
          windowsHide: true,
          maxBuffer: 1024 * 1024,
        }).catch(() => ({ stdout: "" })),
        execFileAsync("git", ["status", "--porcelain"], {
          cwd: root,
          timeout: 5000,
          windowsHide: true,
          maxBuffer: 4 * 1024 * 1024,
        }).catch(() => ({ stdout: "" })),
      ]);
      const dirty = String(status.stdout || "").trim();
      state.git = {
        repo: path.basename(root),
        branch: String(branch.stdout || "").trim() || "(detached)",
        dirty: dirty ? dirty.split("\n").length : 0,
        folder: ctx.cwd,
        isRepo: true,
      };
    } catch {
      state.git = { repo: path.basename(ctx.cwd), branch: null, dirty: 0, folder: ctx.cwd, isRepo: false };
    } finally {
      gitInFlight = false;
      requestRender();
    }
  };

  const resolveApiKey = async (ctx: ExtensionContext): Promise<string | undefined> => {
    try {
      const key = await ctx.modelRegistry?.getApiKeyForProvider?.("commandcode");
      if (key) return key;
    } catch {}
    return process.env.COMMAND_CODE_API_KEY ?? process.env.COMMANDCODE_API_KEY;
  };

  const refreshUsage = async (ctx: ExtensionContext) => {
    if (quotaInFlight) return;
    const provider = state.provider || (ctx.model as { provider?: string } | undefined)?.provider || "";
    if (provider && provider !== "commandcode") {
      state.usage = { snapshot: null, error: "not-commandcode", updatedAt: Date.now() };
      requestRender();
      return;
    }
    quotaInFlight = true;
    try {
      const apiKey = await resolveApiKey(ctx);
      if (!apiKey) {
        state.usage = { snapshot: null, error: "no-credentials", updatedAt: Date.now() };
        return;
      }
      const result = await fetchQuotaSnapshot({
        apiKey,
        baseUrl: process.env.COMMANDCODE_API_BASE,
      });
      state.usage = result.ok
        ? { snapshot: result.snapshot, updatedAt: Date.now() }
        : { snapshot: null, error: result.error, updatedAt: Date.now() };
    } catch (error) {
      state.usage = {
        snapshot: null,
        error: error instanceof Error ? error.message : String(error),
        updatedAt: Date.now(),
      };
    } finally {
      quotaInFlight = false;
      requestRender();
    }
  };

  const refreshTodos = (ctx: ExtensionContext) => {
    let latest: TodoTask[] = [];
    try {
      const entries = ctx.sessionManager?.getBranch?.() ?? [];
      for (const entry of entries) {
        const message = (entry as { type?: string; message?: Record<string, unknown> }).type === "message"
          ? ((entry as { message?: Record<string, unknown> }).message ?? null)
          : null;
        if (!message || message.role !== "toolResult" || message.toolName !== "todo") continue;
        const details = message.details as { tasks?: unknown } | undefined;
        if (Array.isArray(details?.tasks)) latest = details.tasks as TodoTask[];
      }
    } catch {}
    state.todos = latest;
    requestRender();
  };

  const cleanCache = async (ctx: ExtensionContext) => {
    const confirmed = await ctx.ui.confirm(
      state.t("cache.confirmTitle"),
      state.t("cache.confirmMessage"),
    );
    if (!confirmed) return;
    state.cacheStatus = state.t("value.cleaning");
    requestRender();
    const runShell = (commandLine: string, timeout: number) => {
      if (process.platform === "win32") {
        return pi.exec(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", commandLine], { timeout });
      }
      return pi.exec("/bin/sh", ["-lc", commandLine], { timeout });
    };
    let status = "";
    try {
      const npmResult = await runShell("npm cache clean --force", 120_000);
      status = npmResult.code === 0 ? "npm: OK" : `npm: error (${npmResult.code})`;
    } catch (error) {
      status = `npm: ${error instanceof Error ? error.message : String(error)}`;
    }
    try {
      const pnpmVersion = await runShell("pnpm --version", 5000);
      if (pnpmVersion.code === 0) {
        const pnpmResult = await runShell("pnpm store prune", 120_000);
        status += pnpmResult.code === 0 ? " · pnpm: OK" : ` · pnpm: error (${pnpmResult.code})`;
      }
    } catch {
      // pnpm is optional.
    }
    state.cacheStatus = status;
    ctx.ui.notify(state.t("cache.status", { status }), status.includes("error") ? "warning" : "info");
    requestRender();
  };

  const startTimers = (ctx: ExtensionContext) => {
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      const now = Date.now();
      if (now - lastGit > GIT_REFRESH_MS) {
        lastGit = now;
        void refreshGit(ctx);
      }
      if (now - lastQuota > QUOTA_REFRESH_MS) {
        lastQuota = now;
        void refreshUsage(ctx);
      }
      if (now - lastSessionStats > 2000) {
        lastSessionStats = now;
        refreshSessionStats(ctx);
      }
      if (now - lastTodoHide > TODO_HIDE_MS) {
        lastTodoHide = now;
        hideRpiTodo(ctx);
      }
      if (state.agents.size > 0) requestRender();
    }, 1000);
    timer.unref?.();
  };

  const stopTimers = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return; // The sidebar is a TUI-only personal feature.
    ref.ctx = ctx;
    updateModel(ctx);
    refreshTodos(ctx);
    refreshSessionStats(ctx);
    lastGit = 0;
    lastQuota = 0;
    lastSessionStats = 0;
    lastTodoHide = 0;
    void refreshGit(ctx);
    void refreshUsage(ctx);

    ctx.ui.setWidget(WIDGET_KEY, (tui, theme) => {
      ref.tui = tui;
      if (!ref.component) {
        ref.component = new PersonalSidebar(tui, theme, state, handlers);
      } else {
        ref.component.setTheme(theme);
      }
      installLayout(tui, ctx);
      return {
        render: () => [],
        invalidate: () => ref.component?.invalidate(),
      };
    });

    hideRpiTodo(ctx);
    setTimeout(() => hideRpiTodo(ctx), 250);
    startTimers(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    stopTimers();
    const restore = ref.originalSetLayoutRoot;
    const root = ref.originalRoot;
    if (ref.tui && restore) {
      try {
        (ref.tui as any).setLayoutRoot = restore;
      } catch {}
    }
    if (restore && root) {
      try {
        restore(root);
      } catch {}
    }
    ref.layout = null;
    ref.originalSetLayoutRoot = null;
    ref.originalRoot = null;
    ref.previousFocus = null;
    try {
      ctx.ui.setWidget(WIDGET_KEY, undefined);
      ctx.ui.setWidget(TODO_WIDGET_KEY, undefined);
    } catch {}
    ref.component?.dispose();
    ref.component = null;
    ref.tui = null;
    ref.ctx = null;
  });

  pi.on("model_select", (_event, ctx) => {
    updateModel(ctx);
    requestRender();
    void refreshUsage(ctx);
  });

  pi.on("thinking_level_select", (_event, ctx) => {
    updateModel(ctx);
    requestRender();
  });

  pi.on("tool_execution_start", (event) => {
    if (event.toolName !== "run_agent") return;
    const args = (event.args ?? {}) as Record<string, unknown>;
    state.agents.set(event.toolCallId, {
      id: event.toolCallId,
      agent: String(args.agent ?? "agent"),
      task: String(args.task ?? ""),
      startedAt: Date.now(),
    });
    requestRender();
  });

  pi.on("tool_execution_end", (event, ctx) => {
    if (state.agents.delete(event.toolCallId)) requestRender();
    if (event.toolName === "todo") hideRpiTodo(ctx);
  });

  pi.on("tool_result", (event, ctx) => {
    if (event.toolName !== "todo") return;
    const details = event.details as { tasks?: unknown } | undefined;
    if (Array.isArray(details?.tasks)) {
      state.todos = details.tasks as TodoTask[];
      requestRender();
    }
    hideRpiTodo(ctx);
  });

  pi.on("message_end", (_event, ctx) => {
    refreshSessionStats(ctx);
  });

  pi.on("agent_settled", (_event, ctx) => {
    refreshSessionStats(ctx);
  });

  pi.on("session_compact", (_event, ctx) => {
    refreshTodos(ctx);
    refreshSessionStats(ctx);
  });

  pi.on("session_tree", (_event, ctx) => {
    refreshTodos(ctx);
    refreshSessionStats(ctx);
  });

  pi.registerCommand("sidebar", {
    description: "Personal sidebar: toggle sections, focus, hide, clean npm cache, refresh",
    handler: async (args, ctx) => {
      const parts = (args || "").trim().split(/\s+/).filter(Boolean);
      const command = (parts[0] || "help").toLowerCase();
      const rest = parts.slice(1);

      if (command === "help" || command === "status") {
        ctx.ui.notify(
          [
            state.t("command.helpTitle"),
            state.t("command.helpToggle"),
            state.t("command.helpFocus"),
            state.t("command.helpActions"),
          ].join("\n"),
          "info",
        );
        return;
      }

      if (command === "toggle") {
        const id = (rest[0] || "").toLowerCase() as SectionId;
        if (!SECTIONS.includes(id)) {
          ctx.ui.notify(
            state.t("command.unknownSection", { value: rest[0] || "?", sections: SECTIONS.join(", ") }),
            "error",
          );
          return;
        }
        handlers.toggleSection(id);
        return;
      }

      if (command === "focus") {
        if (!ref.tui || !ref.component) {
          ctx.ui.notify(state.t("command.notReady"), "warning");
          return;
        }
        if (state.config.hidden) {
          ctx.ui.notify(state.t("command.hidden"), "warning");
          return;
        }
        ref.previousFocus = ref.tui.getFocusedComponent();
        ref.tui.setFocus(ref.component);
        requestRender();
        ctx.ui.notify(state.t("command.focused"), "info");
        return;
      }

      if (command === "hide") {
        setHidden(true);
        return;
      }
      if (command === "show") {
        setHidden(false);
        return;
      }
      if (command === "cache") {
        await cleanCache(ctx);
        return;
      }
      if (command === "refresh") {
        lastGit = 0;
        lastQuota = 0;
        await Promise.all([refreshGit(ctx), refreshUsage(ctx)]);
        refreshTodos(ctx);
        ctx.ui.notify(state.t("command.refreshed"), "info");
        return;
      }
      if (command === "language" || command === "lang" || command === "idioma") {
        if (!rest[0]) {
          ctx.ui.notify(
            state.t("language.current", { value: languageLabel(state.t, state.config.language) }),
            "info",
          );
          return;
        }
        const value = rest[0].toLowerCase();
        if (!isSidebarLanguage(value)) {
          ctx.ui.notify(state.t("language.invalid", { value: rest[0] }), "error");
          return;
        }
        state.config.language = value;
        saveConfig(state.config);
        state.language = resolveLanguage(state.config.language);
        state.t = createTranslator(state.language);
        requestRender();
        ctx.ui.notify(
          state.t("language.changed", { value: languageLabel(state.t, value) }),
          "info",
        );
        return;
      }
      if (command === "width") {
        const value = Number(rest[0]);
        if (!Number.isFinite(value) || value < MIN_SIDEBAR_WIDTH || value > MAX_SIDEBAR_WIDTH) {
          ctx.ui.notify(
            state.t("command.widthInvalid", { min: MIN_SIDEBAR_WIDTH, max: MAX_SIDEBAR_WIDTH }),
            "error",
          );
          return;
        }
        setWidth(Math.round(value));
        ctx.ui.notify(state.t("command.widthSet", { width: state.config.width }), "info");
        return;
      }

      ctx.ui.notify(state.t("command.unknown", { value: command }), "error");
    },
  });

  pi.registerShortcut("ctrl+alt+b", {
    description: "Toggle personal sidebar",
    handler: async (ctx) => {
      setHidden(!state.config.hidden);
      ctx.ui.notify(state.config.hidden ? state.t("command.hide") : state.t("command.show"), "info");
    },
  });
}
