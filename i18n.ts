/**
 * Tiny i18n layer for pi-personal-sidebar.
 *
 * Pi has no TUI locale, so the extension resolves its own:
 * PI_SIDEBAR_LANG > `language` in the config file > system locale.
 */

export type SidebarLanguage = "auto" | "es" | "en";
export type ResolvedLanguage = "es" | "en";

export const SIDEBAR_LANGUAGES: readonly SidebarLanguage[] = ["auto", "es", "en"];

export function isSidebarLanguage(value: unknown): value is SidebarLanguage {
  return typeof value === "string" && (SIDEBAR_LANGUAGES as readonly string[]).includes(value.toLowerCase());
}

const es = {
  "section.git": "Repo / Carpeta",
  "section.todo": "To-do",
  "section.usage": "Command Code",
  "section.agents": "Subagentes",
  "section.cache": "NPM cache",

  "label.repo": "repo:",
  "label.branch": "branch:",
  "label.folder": "folder:",
  "label.month": "month:",
  "label.left": "left",
  "label.model": "model:",
  "label.thinking": "thinking:",

  "value.loading": "cargando…",
  "value.noGit": "(no git)",
  "value.detached": "(detached)",
  "value.change": "cambio",
  "value.changes": "cambios",
  "value.noTasks": "sin tareas",
  "value.noneRunning": "ninguno corriendo",
  "value.more": "+{count} más",
  "value.na": "n/d",
  "value.noCredentials": "sin credenciales",
  "value.cleaning": "limpiando…",

  "action.clearCache": "[ Limpiar cache NPM ]",
  "cache.hint": "npm cache clean · pnpm store prune",
  "cache.confirmTitle": "Limpiar cache NPM",
  "cache.confirmMessage":
    "Se ejecutará `npm cache clean --force` y `pnpm store prune` (si pnpm está instalado). ¿Continuar?",
  "cache.status": "Cache: {status}",

  "language.auto": "Automático (según el sistema)",
  "language.es": "Español",
  "language.en": "English",
  "language.current": "Idioma actual: {value}",
  "language.changed": "Idioma: {value}",
  "language.usage": "Usage: /sidebar language auto|es|en",
  "language.invalid": "Idioma inválido: {value}. Usá auto, es o en.",

  "command.helpTitle": "Sidebar personal:",
  "command.helpToggle": "/sidebar toggle <git|todo|usage|agents|cache>",
  "command.helpFocus": "/sidebar focus | /sidebar hide | /sidebar show",
  "command.helpActions": "/sidebar cache | /sidebar refresh | /sidebar width <28-56> | /sidebar language <auto|es|en>",
  "command.unknownSection": "Sección desconocida: {value}. Usá: {sections}",
  "command.notReady": "Sidebar todavía no está lista. Probá de nuevo en un segundo.",
  "command.hidden": "Sidebar oculto. Usá /sidebar show primero.",
  "command.focused": "Sidebar enfocada: ↑↓ mover, Enter activar, Esc soltar.",
  "command.hide": "Sidebar oculto.",
  "command.show": "Sidebar visible.",
  "command.refreshed": "Sidebar actualizada.",
  "command.widthInvalid": "Ancho inválido. Usá {min}-{max}.",
  "command.widthSet": "Sidebar: ancho {width}.",
  "command.unknown": "Comando desconocido: {value}. Probá /sidebar help.",
  "command.fullscreenRequired":
    "Sidebar: requiere fullscreen (tuiMode fullscreen) para reservar la columna derecha.",
} as const;

export type SidebarStringKey = keyof typeof es;
export type Translator = (key: SidebarStringKey, vars?: Record<string, string | number>) => string;

const en: Record<SidebarStringKey, string> = {
  "section.git": "Repo / Folder",
  "section.todo": "To-do",
  "section.usage": "Command Code",
  "section.agents": "Subagents",
  "section.cache": "NPM cache",

  "label.repo": "repo:",
  "label.branch": "branch:",
  "label.folder": "folder:",
  "label.month": "month:",
  "label.left": "left",
  "label.model": "model:",
  "label.thinking": "thinking:",

  "value.loading": "loading…",
  "value.noGit": "(no git)",
  "value.detached": "(detached)",
  "value.change": "change",
  "value.changes": "changes",
  "value.noTasks": "no tasks",
  "value.noneRunning": "none running",
  "value.more": "+{count} more",
  "value.na": "n/a",
  "value.noCredentials": "no credentials",
  "value.cleaning": "cleaning…",

  "action.clearCache": "[ Clear NPM cache ]",
  "cache.hint": "npm cache clean · pnpm store prune",
  "cache.confirmTitle": "Clear NPM cache",
  "cache.confirmMessage":
    "`npm cache clean --force` and `pnpm store prune` (when pnpm is installed) will run. Continue?",
  "cache.status": "Cache: {status}",

  "language.auto": "Automatic (system)",
  "language.es": "Spanish",
  "language.en": "English",
  "language.current": "Current language: {value}",
  "language.changed": "Language: {value}",
  "language.usage": "Usage: /sidebar language auto|es|en",
  "language.invalid": "Invalid language: {value}. Use auto, es or en.",

  "command.helpTitle": "Personal sidebar:",
  "command.helpToggle": "/sidebar toggle <git|todo|usage|agents|cache>",
  "command.helpFocus": "/sidebar focus | /sidebar hide | /sidebar show",
  "command.helpActions": "/sidebar cache | /sidebar refresh | /sidebar width <28-56> | /sidebar language <auto|es|en>",
  "command.unknownSection": "Unknown section: {value}. Use: {sections}",
  "command.notReady": "Sidebar is not ready yet. Try again in a second.",
  "command.hidden": "Sidebar is hidden. Use /sidebar show first.",
  "command.focused": "Sidebar focused: ↑↓ move, Enter activate, Esc release.",
  "command.hide": "Sidebar hidden.",
  "command.show": "Sidebar visible.",
  "command.refreshed": "Sidebar refreshed.",
  "command.widthInvalid": "Invalid width. Use {min}-{max}.",
  "command.widthSet": "Sidebar: width {width}.",
  "command.unknown": "Unknown command: {value}. Try /sidebar help.",
  "command.fullscreenRequired":
    "Sidebar: requires fullscreen (tuiMode fullscreen) to reserve the right column.",
};

export const SIDEBAR_STRINGS: Record<ResolvedLanguage, Record<SidebarStringKey, string>> = { es, en };

/** Detect the system language, defaulting to English for non-Spanish locales. */
export function detectSystemLanguage(env: NodeJS.ProcessEnv = process.env, locale?: string): ResolvedLanguage {
  let intlLocale = locale;
  if (!intlLocale) {
    try {
      intlLocale = Intl.DateTimeFormat().resolvedOptions().locale;
    } catch {
      intlLocale = undefined;
    }
  }
  for (const candidate of [env.LC_ALL, env.LC_MESSAGES, env.LANG, env.LANGUAGE, intlLocale]) {
    const value = String(candidate ?? "").trim().toLowerCase();
    if (!value || value === "c" || value === "posix") continue;
    if (value.startsWith("es")) return "es";
    if (/^[a-z]{2}/.test(value)) return "en";
  }
  return "en";
}

function normalizePreference(value: unknown): SidebarLanguage | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return isSidebarLanguage(normalized) ? normalized : null;
}

/** Precedence: PI_SIDEBAR_LANG > config > system. `auto` delegates to the next source. */
export function resolveLanguage(
  preference?: string | null,
  env: NodeJS.ProcessEnv = process.env,
  locale?: string,
): ResolvedLanguage {
  const envPreference = normalizePreference(env.PI_SIDEBAR_LANG);
  if (envPreference === "es" || envPreference === "en") return envPreference;

  const configPreference = normalizePreference(preference);
  if (configPreference === "es" || configPreference === "en") return configPreference;

  return detectSystemLanguage(env, locale);
}

export function createTranslator(lang: ResolvedLanguage): Translator {
  const dictionary = SIDEBAR_STRINGS[lang] ?? SIDEBAR_STRINGS.en;
  return (key, vars) => {
    const template = dictionary[key] ?? SIDEBAR_STRINGS.en[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (match, name) => {
      if (!vars || !(name in vars)) return match;
      return String(vars[name]);
    });
  };
}

export function languageLabel(t: Translator, value: SidebarLanguage | undefined | null): string {
  if (value === "es") return t("language.es");
  if (value === "en") return t("language.en");
  return t("language.auto");
}
