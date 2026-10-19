import { LANGUAGES, LANGUAGE_LABELS, useI18n } from "../../lib/i18n";

/**
 * Language switch, shaped like the theme switch it sits next to.
 *
 * The options are labelled in their own language: "English" and "Español" are
 * recognizable even when the interface is currently in the other one.
 */
export function LanguageSwitcher() {
  const { language, setLanguage, t } = useI18n();

  return (
    <div className="view-toggle" role="group" aria-label={t.common.language}>
      {LANGUAGES.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={language === option}
          aria-label={LANGUAGE_LABELS[option]}
          title={LANGUAGE_LABELS[option]}
          onClick={() => setLanguage(option)}
        >
          {option.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
