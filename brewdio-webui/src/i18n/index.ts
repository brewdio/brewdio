import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./en.json";
import nb from "./nb.json";

function detectBrowserLanguage(): "en" | "nb" {
  if (typeof navigator === "undefined") {
    return "en";
  }

  const preferredLanguages = navigator.languages?.length
    ? navigator.languages
    : [navigator.language];

  for (const language of preferredLanguages) {
    const baseLanguage = language.toLowerCase().split(/[-_]/)[0];
    if (baseLanguage === "nb" || baseLanguage === "no" || baseLanguage === "nn") {
      return "nb";
    }
    if (baseLanguage === "en") {
      return "en";
    }
  }

  return "en";
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        translation: en,
      },
      nb: {
        translation: nb,
      },
    },

    lng: detectBrowserLanguage(),
    fallbackLng: "en",

    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
