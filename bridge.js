(() => {
  const EVENT_NAME = "__CHATGPT_REGION_CLOAK_CONFIG_V3__";
  const LOCALES = new Set([
    "en-US", "en-CA", "en-GB", "en-AU", "en-SG", "en-HK", "en-IN",
    "fr-CA", "fr-FR", "de-DE", "es-ES", "it-IT", "pt-BR", "hi-IN",
    "ja-JP", "ko-KR", "zh-CN", "zh-SG", "zh-HK", "zh-TW"
  ]);
  const TIME_ZONES = new Set([
    "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
    "America/Toronto", "America/Winnipeg", "America/Edmonton", "America/Vancouver",
    "Europe/London", "Europe/Berlin", "Europe/Paris", "Europe/Madrid", "Europe/Rome",
    "America/Sao_Paulo", "Asia/Tokyo", "Asia/Seoul", "Asia/Singapore",
    "Australia/Sydney", "Australia/Adelaide", "Australia/Perth",
    "Asia/Hong_Kong", "Asia/Kolkata"
  ]);

  function publish(config) {
    const payload = JSON.stringify({
      enabled: config.enabled !== false,
      locale: LOCALES.has(config.locale) ? config.locale : "en-US",
      timeZone: TIME_ZONES.has(config.timeZone) ? config.timeZone : "America/New_York"
    });

    window.dispatchEvent(new CustomEvent(EVENT_NAME, {detail: payload}));
  }

  chrome.storage.local.get({
    enabled: true,
    locale: "en-US",
    timeZone: "America/New_York"
  }).then(publish);

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "US_REGION_ALIGNER_CONFIG") {
      publish(message.config || {});
    }
  });
})();
