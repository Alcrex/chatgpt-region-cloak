const COUNTRIES = Object.freeze({
  US: {locale: "en-US", timeZones: ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles"]},
  CA: {locale: "en-CA", timeZones: ["America/Toronto", "America/Winnipeg", "America/Edmonton", "America/Vancouver"]},
  GB: {locale: "en-GB", timeZones: ["Europe/London"]},
  DE: {locale: "de-DE", timeZones: ["Europe/Berlin"]},
  FR: {locale: "fr-FR", timeZones: ["Europe/Paris"]},
  ES: {locale: "es-ES", timeZones: ["Europe/Madrid"]},
  IT: {locale: "it-IT", timeZones: ["Europe/Rome"]},
  BR: {locale: "pt-BR", timeZones: ["America/Sao_Paulo"]},
  JP: {locale: "ja-JP", timeZones: ["Asia/Tokyo"]},
  KR: {locale: "ko-KR", timeZones: ["Asia/Seoul"]},
  SG: {locale: "en-SG", timeZones: ["Asia/Singapore"]},
  AU: {locale: "en-AU", timeZones: ["Australia/Sydney", "Australia/Adelaide", "Australia/Perth"]},
  HK: {locale: "en-HK", timeZones: ["Asia/Hong_Kong"]},
  IN: {locale: "en-IN", timeZones: ["Asia/Kolkata"]}
});

const SUPPORTED_LOCALES = new Set([
  "en-US", "en-CA", "en-GB", "en-AU", "en-SG", "en-HK", "en-IN",
  "fr-CA", "fr-FR", "de-DE", "es-ES", "it-IT", "pt-BR", "hi-IN",
  "ja-JP", "ko-KR", "zh-CN", "zh-SG", "zh-HK", "zh-TW"
]);

const SUPPORTED_TIME_ZONES = new Set(
  Object.values(COUNTRIES).flatMap((country) => country.timeZones)
);

const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  country: "US",
  locale: "en-US",
  timeZone: "America/New_York"
});

const LEGACY_ZONES = Object.freeze({
  ET: "America/New_York",
  CT: "America/Chicago",
  MT: "America/Denver",
  PT: "America/Los_Angeles"
});

const MATCHES = Object.freeze([
  "*://chatgpt.com/*",
  "*://*.chatgpt.com/*",
  "*://openai.com/*",
  "*://chat.openai.com/*"
]);

const CHATGPT_RESET_ORIGINS = Object.freeze([
  "https://chatgpt.com",
  "https://chat.openai.com",
  "https://auth.openai.com",
  "https://auth0.openai.com"
]);

const MAIN_SCRIPT_ID = "chatgpt-region-cloak-main";
const LEGACY_MAIN_SCRIPT_IDS = Object.freeze(["us-region-aligner-main"]);
const NETWORK_RULE_IDS = Object.freeze([1001, 1002]);
const LEGACY_RULE_IDS = Object.freeze([1]);

const LOCALE_FILES = Object.freeze(Object.fromEntries(
  [...SUPPORTED_LOCALES].map((locale) => [locale, `config/locales/${locale.toLowerCase()}.js`])
));

const TIME_ZONE_FILES = Object.freeze(Object.fromEntries(
  [...SUPPORTED_TIME_ZONES].map((timeZone) => [
    timeZone,
    `config/timezones/${timeZone.toLowerCase().replaceAll("/", "-").replaceAll("_", "-")}.js`
  ])
));

const RESOURCE_TYPES = Object.freeze([
  "main_frame",
  "sub_frame",
  "stylesheet",
  "script",
  "image",
  "font",
  "object",
  "xmlhttprequest",
  "ping",
  "media",
  "websocket",
  "other"
]);

function normalizeSettings(value) {
  const country = Object.hasOwn(COUNTRIES, value.country)
    ? value.country
    : DEFAULT_SETTINGS.country;
  const countrySettings = COUNTRIES[country];

  return {
    enabled: value.enabled !== false,
    country,
    locale: SUPPORTED_LOCALES.has(value.locale) ? value.locale : countrySettings.locale,
    timeZone: countrySettings.timeZones.includes(value.timeZone)
      ? value.timeZone
      : countrySettings.timeZones[0]
  };
}

async function getSettings() {
  return normalizeSettings(await chrome.storage.local.get(DEFAULT_SETTINGS));
}

async function ensureDefaults() {
  const stored = await chrome.storage.local.get([
    "enabled", "country", "locale", "timeZone", "zone"
  ]);
  const patch = {};

  if (typeof stored.enabled !== "boolean") {
    patch.enabled = DEFAULT_SETTINGS.enabled;
  }

  const country = Object.hasOwn(COUNTRIES, stored.country)
    ? stored.country
    : DEFAULT_SETTINGS.country;

  if (!Object.hasOwn(COUNTRIES, stored.country)) {
    patch.country = country;
  }

  if (!SUPPORTED_LOCALES.has(stored.locale)) {
    patch.locale = COUNTRIES[country].locale;
  }

  const legacyTimeZone = LEGACY_ZONES[stored.zone];
  const candidateTimeZone = stored.timeZone || legacyTimeZone;
  if (!COUNTRIES[country].timeZones.includes(candidateTimeZone)) {
    patch.timeZone = COUNTRIES[country].timeZones[0];
  } else if (stored.timeZone !== candidateTimeZone) {
    patch.timeZone = candidateTimeZone;
  }

  if (Object.keys(patch).length > 0) {
    await chrome.storage.local.set(patch);
  }
}

function makeAcceptLanguage(locale) {
  const baseLanguage = locale.split("-")[0];
  if (baseLanguage === locale) return locale;
  if (baseLanguage === "en") return `${locale},en;q=0.9`;
  return `${locale},${baseLanguage};q=0.9,en;q=0.7`;
}

function makeNetworkRules(settings) {
  if (!settings.enabled) return [];

  return [
    {
      id: NETWORK_RULE_IDS[0],
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          {
            header: "Accept-Language",
            operation: "set",
            value: makeAcceptLanguage(settings.locale)
          }
        ]
      },
      condition: {
        requestDomains: ["openai.com", "chatgpt.com"],
        resourceTypes: RESOURCE_TYPES
      }
    },
    {
      id: NETWORK_RULE_IDS[1],
      priority: 2,
      action: {
        type: "redirect",
        redirect: {
          regexSubstitution: "https://\\1/\\2"
        }
      },
      condition: {
        regexFilter: "^https?://(chatgpt\\.com|chat\\.openai\\.com|openai\\.com)/zh-Hans-CN/?(.*)$",
        isUrlFilterCaseSensitive: false,
        resourceTypes: ["main_frame"]
      }
    }
  ];
}

async function updateNetworkRules(settings) {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [...LEGACY_RULE_IDS, ...NETWORK_RULE_IDS],
    addRules: makeNetworkRules(settings)
  });
}

async function updateMainWorldRegistration(settings) {
  const registered = await chrome.scripting.getRegisteredContentScripts({
    ids: [MAIN_SCRIPT_ID, ...LEGACY_MAIN_SCRIPT_IDS]
  });
  const current = registered.filter((script) => script.id === MAIN_SCRIPT_ID);
  const legacyIds = registered
    .filter((script) => LEGACY_MAIN_SCRIPT_IDS.includes(script.id))
    .map((script) => script.id);

  if (legacyIds.length > 0) {
    await chrome.scripting.unregisterContentScripts({ids: legacyIds});
  }

  if (!settings.enabled) {
    if (current.length > 0) {
      await chrome.scripting.unregisterContentScripts({ids: [MAIN_SCRIPT_ID]});
    }
    return;
  }

  const registration = {
    id: MAIN_SCRIPT_ID,
    matches: MATCHES,
    js: [
      "config/base.js",
      LOCALE_FILES[settings.locale],
      TIME_ZONE_FILES[settings.timeZone],
      "page.js"
    ],
    runAt: "document_start",
    world: "MAIN",
    persistAcrossSessions: true
  };

  if (current.length > 0) {
    await chrome.scripting.updateContentScripts([registration]);
  } else {
    await chrome.scripting.registerContentScripts([registration]);
  }
}

async function updateOpenTabs(settings) {
  const tabs = await chrome.tabs.query({url: MATCHES});
  const message = {
    type: "US_REGION_ALIGNER_CONFIG",
    config: {
      enabled: settings.enabled,
      locale: settings.locale,
      timeZone: settings.timeZone
    }
  };

  await Promise.allSettled(tabs.map(async (tab) => {
    if (typeof tab.id !== "number") return;

    if (settings.enabled) {
      await chrome.scripting.executeScript({
        target: {tabId: tab.id},
        files: [
          "config/base.js",
          LOCALE_FILES[settings.locale],
          TIME_ZONE_FILES[settings.timeZone],
          "page.js"
        ],
        world: "MAIN",
        injectImmediately: true
      });
    }

    await chrome.tabs.sendMessage(tab.id, message);
  }));
}

async function resetChatGptSiteData() {
  const tabs = await chrome.tabs.query({
    url: [
      "*://chatgpt.com/*",
      "*://*.chatgpt.com/*",
      "*://chat.openai.com/*"
    ]
  });

  await Promise.allSettled(tabs.map((tab) => {
    if (typeof tab.id !== "number") return undefined;
    return chrome.scripting.executeScript({
      target: {tabId: tab.id},
      world: "MAIN",
      func: () => window.sessionStorage.clear()
    });
  }));

  await chrome.browsingData.remove({
    since: 0,
    origins: CHATGPT_RESET_ORIGINS,
    originTypes: {
      unprotectedWeb: true,
      protectedWeb: true
    }
  }, {
    cache: true,
    cacheStorage: true,
    cookies: true,
    fileSystems: true,
    indexedDB: true,
    localStorage: true,
    serviceWorkers: true,
    webSQL: true
  });

  const reloads = await Promise.allSettled(tabs.map((tab) => {
    if (typeof tab.id !== "number") return undefined;
    return chrome.tabs.reload(tab.id, {bypassCache: true});
  }));

  return {
    tabsReloaded: reloads.filter((result) => result.status === "fulfilled").length
  };
}

async function reconcile() {
  await ensureDefaults();
  const settings = await getSettings();

  await Promise.all([
    updateNetworkRules(settings),
    updateMainWorldRegistration(settings)
  ]);

  await updateOpenTabs(settings);
  return settings;
}

let reconcileQueue = Promise.resolve();

function scheduleReconcile() {
  reconcileQueue = reconcileQueue
    .catch(() => undefined)
    .then(reconcile);

  return reconcileQueue;
}

chrome.runtime.onInstalled.addListener(() => {
  void scheduleReconcile();
});

chrome.runtime.onStartup.addListener(() => {
  void scheduleReconcile();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (!changes.enabled && !changes.country && !changes.locale && !changes.timeZone && !changes.zone) return;
  void scheduleReconcile();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "US_REGION_ALIGNER_APPLY_NOW") {
    scheduleReconcile()
      .then((settings) => sendResponse({ok: true, settings}))
      .catch((error) => sendResponse({ok: false, error: String(error)}));
    return true;
  }

  if (message?.type === "US_REGION_ALIGNER_RESET_CHATGPT") {
    resetChatGptSiteData()
      .then((result) => sendResponse({ok: true, result}))
      .catch((error) => sendResponse({ok: false, error: String(error)}));
    return true;
  }

  return undefined;
});

void scheduleReconcile();
