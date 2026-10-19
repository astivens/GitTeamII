/**
 * Language selection.
 *
 * The interface is translated with plain objects instead of a library, in the
 * spirit of the rest of the frontend: every domain exports its own dictionary
 * and the English one defines the shape the Spanish one has to satisfy, so a
 * forgotten translation fails the type check.
 *
 * Like the theme, the choice is a preference of this machine: remembered in
 * `localStorage`, never stored in the repository or in a ticket.
 */
import { create } from "zustand";
import { en, type Dictionary } from "./i18n/en";
import { es } from "./i18n/es";

export const LANGUAGES = ["en", "es"] as const;

export type Language = (typeof LANGUAGES)[number];

/** Each option is named in its own language, so it reads even when it is not yours. */
export const LANGUAGE_LABELS: Record<Language, string> = {
  en: "English",
  es: "Español",
};

const STORAGE_KEY = "gitteam.language";

const DICTIONARIES: Record<Language, Dictionary> = { en, es };

export function isLanguage(value: unknown): value is Language {
  return (
    typeof value === "string" && (LANGUAGES as readonly string[]).includes(value)
  );
}

/** The stored choice, else the machine's language, else English. */
function detectLanguage(): Language {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLanguage(stored)) return stored;
  } catch {
    // Storage can be unavailable; fall through to the machine language.
  }
  const preferred = typeof navigator === "undefined" ? "en" : navigator.language;
  return preferred.toLowerCase().startsWith("es") ? "es" : "en";
}

/** Puts the language on the document so the platform and assistive tech agree. */
export function applyLanguage(language: Language): void {
  document.documentElement.setAttribute("lang", language);
}

interface LanguageState {
  language: Language;
  setLanguage: (language: Language) => void;
}

export const useLanguage = create<LanguageState>((set) => ({
  language: detectLanguage(),
  setLanguage: (language) => {
    applyLanguage(language);
    try {
      window.localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // Best effort: the choice still applies for this session.
    }
    set({ language });
  },
}));

applyLanguage(useLanguage.getState().language);

export interface I18n {
  /** The current dictionary. Domain objects are nested, so `t.tickets.newTicket` is checked. */
  t: Dictionary;
  language: Language;
  setLanguage: (language: Language) => void;
}

export function useI18n(): I18n {
  const language = useLanguage((s) => s.language);
  const setLanguage = useLanguage((s) => s.setLanguage);
  return { t: DICTIONARIES[language], language, setLanguage };
}

/** The current dictionary for code outside React, such as the store's toasts. */
export function msg(): Dictionary {
  return DICTIONARIES[useLanguage.getState().language];
}
