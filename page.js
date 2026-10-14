(() => {
  const BOOTSTRAP_KEY = Symbol.for("chatgpt-region-cloak.bootstrap.v3");
  const STATE_KEY = Symbol.for("chatgpt-region-cloak.state.v3");
  const EVENT_NAME = "__CHATGPT_REGION_CLOAK_CONFIG_V3__";
  const ALLOWED_LOCALES = new Set([
    "en-US", "en-CA", "en-GB", "en-AU", "en-SG", "en-HK", "en-IN",
    "fr-CA", "fr-FR", "de-DE", "es-ES", "it-IT", "pt-BR", "hi-IN",
    "ja-JP", "ko-KR", "zh-CN", "zh-SG", "zh-HK", "zh-TW"
  ]);
  const ALLOWED_ZONES = new Set([
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Toronto",
    "America/Winnipeg",
    "America/Edmonton",
    "America/Vancouver",
    "Europe/London",
    "Europe/Berlin",
    "Europe/Paris",
    "Europe/Madrid",
    "Europe/Rome",
    "America/Sao_Paulo",
    "Asia/Tokyo",
    "Asia/Seoul",
    "Asia/Singapore",
    "Australia/Sydney",
    "Australia/Adelaide",
    "Australia/Perth",
    "Asia/Hong_Kong",
    "Asia/Kolkata"
  ]);

  const bootstrap = globalThis[BOOTSTRAP_KEY];
  delete globalThis[BOOTSTRAP_KEY];

  if (globalThis[STATE_KEY]) {
    globalThis[STATE_KEY].apply(bootstrap);
    return;
  }

  const OriginalDate = Date;
  const originalDateMethods = new Map();
  const originalIntlConstructors = new Map();
  const originalNavigatorDescriptors = new Map();
  const originalHistoryMethods = new Map();
  const formatterCache = new Map();
  const config = {
    enabled: false,
    locale: "en-US",
    timeZone: "America/New_York"
  };

  let patched = false;
  let DateProxy = null;

  function normalizeConfig(value) {
    return {
      enabled: value?.enabled === true,
      locale: ALLOWED_LOCALES.has(value?.locale) ? value.locale : "en-US",
      timeZone: ALLOWED_ZONES.has(value?.timeZone)
        ? value.timeZone
        : "America/New_York"
    };
  }

  function getFormatter(kind) {
    const key = `${kind}:${config.timeZone}`;
    if (formatterCache.has(key)) return formatterCache.get(key);

    let options;
    if (kind === "parts") {
      options = {
        timeZone: config.timeZone,
        calendar: "gregory",
        numberingSystem: "latn",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
      };
    } else {
      options = {
        timeZone: config.timeZone,
        calendar: "gregory",
        numberingSystem: "latn",
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
        timeZoneName: "long"
      };
    }

    const OriginalDateTimeFormat = originalIntlConstructors.get("DateTimeFormat") || Intl.DateTimeFormat;
    const formatter = new OriginalDateTimeFormat(config.locale, options);
    formatterCache.set(key, formatter);
    return formatter;
  }

  function getTime(date) {
    return originalDateMethods.get("getTime").call(date);
  }

  function getZoneParts(date) {
    const timestamp = getTime(date);
    if (!Number.isFinite(timestamp)) return null;

    const result = {};
    for (const part of getFormatter("parts").formatToParts(date)) {
      if (part.type !== "literal") result[part.type] = part.value;
    }

    return {
      year: Number(result.year),
      month: Number(result.month) - 1,
      date: Number(result.day),
      hours: Number(result.hour),
      minutes: Number(result.minute),
      seconds: Number(result.second),
      milliseconds: originalDateMethods.get("getUTCMilliseconds").call(date)
    };
  }

  function wallTime(parts) {
    const value = new OriginalDate(0);
    originalDateMethods.get("setUTCFullYear").call(
      value,
      parts.year,
      parts.month,
      parts.date
    );
    originalDateMethods.get("setUTCHours").call(
      value,
      parts.hours,
      parts.minutes,
      parts.seconds,
      parts.milliseconds
    );
    return getTime(value);
  }

  function getZoneOffset(date) {
    const timestamp = getTime(date);
    const parts = getZoneParts(date);
    if (!parts) return NaN;

    const instantAtSecondPrecision = Math.trunc(timestamp / 1000) * 1000;
    const wallAtSecondPrecision = wallTime({...parts, milliseconds: 0});
    return Math.round((instantAtSecondPrecision - wallAtSecondPrecision) / 60000);
  }

  function zonedLocalToTimestamp(parts) {
    const targetWallTime = wallTime(parts);
    if (!Number.isFinite(targetWallTime)) return NaN;

    const sampleDistance = 36 * 60 * 60 * 1000;
    const offsets = new Set([
      getZoneOffset(new OriginalDate(targetWallTime - sampleDistance)),
      getZoneOffset(new OriginalDate(targetWallTime)),
      getZoneOffset(new OriginalDate(targetWallTime + sampleDistance))
    ]);
    const candidates = [];

    for (const offset of offsets) {
      if (!Number.isFinite(offset)) continue;
      const timestamp = targetWallTime + offset * 60000;
      const candidateParts = getZoneParts(new OriginalDate(timestamp));
      if (!candidateParts) continue;
      candidates.push({timestamp, wall: wallTime(candidateParts)});
    }

    const exact = candidates
      .filter((candidate) => candidate.wall === targetWallTime)
      .sort((a, b) => a.timestamp - b.timestamp);
    if (exact.length > 0) return exact[0].timestamp;

    // During a DST spring-forward gap, match native Date behavior by moving
    // forward to the earliest representable local time after the gap.
    const afterGap = candidates
      .filter((candidate) => candidate.wall > targetWallTime)
      .sort((a, b) => a.wall - b.wall || a.timestamp - b.timestamp);
    if (afterGap.length > 0) return afterGap[0].timestamp;

    return candidates.sort((a, b) => b.wall - a.wall)[0]?.timestamp ?? NaN;
  }

  function formatDateString(date, mode) {
    if (!Number.isFinite(getTime(date))) return "Invalid Date";

    const values = {};
    for (const part of getFormatter("long").formatToParts(date)) {
      if (part.type !== "literal") values[part.type] = part.value;
    }

    const dateText = `${values.weekday} ${values.month} ${values.day} ${values.year}`;
    const timeText = `${values.hour}:${values.minute}:${values.second}`;
    const offset = -getZoneOffset(date);
    const sign = offset >= 0 ? "+" : "-";
    const absoluteOffset = Math.abs(offset);
    const offsetText = `${sign}${String(Math.floor(absoluteOffset / 60)).padStart(2, "0")}${String(absoluteOffset % 60).padStart(2, "0")}`;
    const zoneText = `GMT${offsetText} (${values.timeZoneName})`;

    if (mode === "date") return dateText;
    if (mode === "time") return `${timeText} ${zoneText}`;
    return `${dateText} ${timeText} ${zoneText}`;
  }

  function patchNavigator() {
    const browserLanguages = () => {
      const baseLanguage = config.locale.split("-")[0];
      return Object.freeze([...new Set([config.locale, baseLanguage])]);
    };
    const values = {
      language: () => config.locale,
      languages: browserLanguages
    };

    for (const [property, getter] of Object.entries(values)) {
      originalNavigatorDescriptors.set(property, Object.getOwnPropertyDescriptor(navigator, property));
      Object.defineProperty(navigator, property, {
        configurable: true,
        enumerable: true,
        get: getter
      });
    }
  }

  function restoreNavigator() {
    for (const [property, descriptor] of originalNavigatorDescriptors) {
      if (descriptor) {
        Object.defineProperty(navigator, property, descriptor);
      } else {
        delete navigator[property];
      }
    }
    originalNavigatorDescriptors.clear();
  }

  function patchIntl() {
    const constructors = [
      "Collator",
      "DateTimeFormat",
      "DisplayNames",
      "ListFormat",
      "NumberFormat",
      "PluralRules",
      "RelativeTimeFormat",
      "Segmenter"
    ];

    for (const name of constructors) {
      const OriginalConstructor = Intl[name];
      if (typeof OriginalConstructor !== "function") continue;
      originalIntlConstructors.set(name, OriginalConstructor);

      let proxy;
      const prepareArguments = (args) => {
        const next = Array.from(args);
        if (next[0] === undefined) next[0] = config.locale;

        if (name === "DateTimeFormat") {
          const options = {...(next[1] || {})};
          if (options.timeZone === undefined) options.timeZone = config.timeZone;
          next[1] = options;
        }

        return next;
      };

      proxy = new Proxy(OriginalConstructor, {
        apply(target, thisArg, args) {
          return Reflect.apply(target, thisArg, prepareArguments(args));
        },
        construct(target, args, newTarget) {
          return Reflect.construct(
            target,
            prepareArguments(args),
            newTarget === proxy ? target : newTarget
          );
        }
      });

      Intl[name] = proxy;
    }
  }

  function restoreIntl() {
    for (const [name, OriginalConstructor] of originalIntlConstructors) {
      Intl[name] = OriginalConstructor;
    }
    originalIntlConstructors.clear();
    formatterCache.clear();
  }

  function saveDateMethod(name) {
    originalDateMethods.set(name, OriginalDate.prototype[name]);
  }

  function defineDateMethod(name, implementation) {
    Object.defineProperty(OriginalDate.prototype, name, {
      configurable: true,
      writable: true,
      value: implementation
    });
  }

  function patchDate() {
    const methodsToSave = [
      "getTime",
      "getUTCDate",
      "getUTCDay",
      "getUTCFullYear",
      "getUTCHours",
      "getUTCMilliseconds",
      "getUTCMinutes",
      "getUTCMonth",
      "getUTCSeconds",
      "setTime",
      "setUTCFullYear",
      "setUTCHours",
      "toString",
      "toDateString",
      "toTimeString",
      "toLocaleString",
      "toLocaleDateString",
      "toLocaleTimeString",
      "getFullYear",
      "getYear",
      "getMonth",
      "getDate",
      "getDay",
      "getHours",
      "getMinutes",
      "getSeconds",
      "getMilliseconds",
      "getTimezoneOffset",
      "setFullYear",
      "setYear",
      "setMonth",
      "setDate",
      "setHours",
      "setMinutes",
      "setSeconds",
      "setMilliseconds"
    ];

    for (const name of methodsToSave) saveDateMethod(name);

    const localPartGetters = {
      getFullYear: "year",
      getMonth: "month",
      getDate: "date",
      getHours: "hours",
      getMinutes: "minutes",
      getSeconds: "seconds",
      getMilliseconds: "milliseconds"
    };

    for (const [method, part] of Object.entries(localPartGetters)) {
      defineDateMethod(method, function regionAlignedDateGetter() {
        return getZoneParts(this)?.[part] ?? NaN;
      });
    }

    defineDateMethod("getYear", function regionAlignedGetYear() {
      const year = getZoneParts(this)?.year;
      return year === undefined ? NaN : year - 1900;
    });

    defineDateMethod("getDay", function regionAlignedGetDay() {
      const parts = getZoneParts(this);
      if (!parts) return NaN;
      const normalized = new OriginalDate(wallTime({...parts, hours: 0, minutes: 0, seconds: 0, milliseconds: 0}));
      return originalDateMethods.get("getUTCDay").call(normalized);
    });

    defineDateMethod("getTimezoneOffset", function regionAlignedOffset() {
      return getZoneOffset(this);
    });

    defineDateMethod("toString", function regionAlignedToString() {
      return formatDateString(this, "full");
    });

    defineDateMethod("toDateString", function regionAlignedToDateString() {
      return formatDateString(this, "date");
    });

    defineDateMethod("toTimeString", function regionAlignedToTimeString() {
      return formatDateString(this, "time");
    });

    const localeMethods = ["toLocaleString", "toLocaleDateString", "toLocaleTimeString"];
    for (const name of localeMethods) {
      defineDateMethod(name, function regionAlignedLocaleString(locales, options) {
        const nextOptions = {...(options || {})};
        if (nextOptions.timeZone === undefined) nextOptions.timeZone = config.timeZone;
        return originalDateMethods.get(name).call(
          this,
          locales === undefined ? config.locale : locales,
          nextOptions
        );
      });
    }

    const setterDefinitions = {
      setFullYear: ["year", "month", "date"],
      setMonth: ["month", "date"],
      setDate: ["date"],
      setHours: ["hours", "minutes", "seconds", "milliseconds"],
      setMinutes: ["minutes", "seconds", "milliseconds"],
      setSeconds: ["seconds", "milliseconds"],
      setMilliseconds: ["milliseconds"]
    };

    for (const [name, fields] of Object.entries(setterDefinitions)) {
      defineDateMethod(name, function regionAlignedDateSetter(...args) {
        const parts = getZoneParts(this);
        if (!parts) return NaN;
        fields.slice(0, Math.max(1, args.length)).forEach((field, index) => {
          parts[field] = Number(args[index]);
        });
        return originalDateMethods.get("setTime").call(this, zonedLocalToTimestamp(parts));
      });
    }

    defineDateMethod("setYear", function regionAlignedSetYear(year) {
      const parts = getZoneParts(this);
      if (!parts) return NaN;
      const numericYear = Number(year);
      parts.year = numericYear >= 0 && numericYear <= 99 ? numericYear + 1900 : numericYear;
      return originalDateMethods.get("setTime").call(this, zonedLocalToTimestamp(parts));
    });

    DateProxy = new Proxy(OriginalDate, {
      apply() {
        return formatDateString(new OriginalDate(), "full");
      },
      construct(target, args, newTarget) {
        if (args.length < 2) {
          return Reflect.construct(target, args, newTarget === DateProxy ? target : newTarget);
        }

        const values = [
          Number(args[0]),
          Number(args[1]),
          args.length > 2 ? Number(args[2]) : 1,
          args.length > 3 ? Number(args[3]) : 0,
          args.length > 4 ? Number(args[4]) : 0,
          args.length > 5 ? Number(args[5]) : 0,
          args.length > 6 ? Number(args[6]) : 0
        ];

        if (values[0] >= 0 && values[0] <= 99) values[0] += 1900;
        const timestamp = zonedLocalToTimestamp({
          year: values[0],
          month: values[1],
          date: values[2],
          hours: values[3],
          minutes: values[4],
          seconds: values[5],
          milliseconds: values[6]
        });

        return Reflect.construct(
          target,
          [timestamp],
          newTarget === DateProxy ? target : newTarget
        );
      }
    });

    globalThis.Date = DateProxy;
  }

  function restoreDate() {
    globalThis.Date = OriginalDate;
    for (const [name, implementation] of originalDateMethods) {
      defineDateMethod(name, implementation);
    }
    originalDateMethods.clear();
    formatterCache.clear();
    DateProxy = null;
  }

  function normalizeLocalizedUrl(value) {
    if (value === undefined || value === null) return value;

    try {
      const resolved = new URL(String(value), location.href);
      const host = resolved.hostname.toLowerCase();
      if (!(
        host === "chatgpt.com" ||
        host.endsWith(".chatgpt.com") ||
        host === "openai.com" ||
        host.endsWith(".openai.com")
      )) {
        return value;
      }

      if (resolved.pathname === "/zh-Hans-CN" || resolved.pathname.startsWith("/zh-Hans-CN/")) {
        resolved.pathname = resolved.pathname.slice("/zh-Hans-CN".length) || "/";
      } else {
        return value;
      }

      return `${resolved.pathname}${resolved.search}${resolved.hash}`;
    } catch {
      return value;
    }
  }

  function patchHistory() {
    for (const name of ["pushState", "replaceState"]) {
      const original = history[name];
      originalHistoryMethods.set(name, {
        descriptor: Object.getOwnPropertyDescriptor(history, name),
        method: original
      });
      Object.defineProperty(history, name, {
        configurable: true,
        writable: true,
        value(state, unused, url) {
          return original.call(this, state, unused, normalizeLocalizedUrl(url));
        }
      });
    }

    const cleaned = normalizeLocalizedUrl(location.href);
    if (cleaned !== location.href) {
      originalHistoryMethods.get("replaceState").method.call(history, history.state, "", cleaned);
    }
  }

  function restoreHistory() {
    for (const [name, original] of originalHistoryMethods) {
      if (original.descriptor) {
        Object.defineProperty(history, name, original.descriptor);
      } else {
        delete history[name];
      }
    }
    originalHistoryMethods.clear();
  }

  function enable() {
    if (patched) return;
    patchNavigator();
    patchIntl();
    patchDate();
    patchHistory();
    patched = true;
  }

  function disable() {
    if (!patched) return;
    restoreHistory();
    restoreDate();
    restoreIntl();
    restoreNavigator();
    patched = false;
  }

  const api = Object.freeze({
    apply(value) {
      const next = normalizeConfig(value);
      config.locale = next.locale;
      config.timeZone = next.timeZone;
      config.enabled = next.enabled;
      formatterCache.clear();

      if (config.enabled) enable();
      else disable();
    }
  });

  Object.defineProperty(globalThis, STATE_KEY, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: api
  });

  window.addEventListener(EVENT_NAME, (event) => {
    if (typeof event.detail !== "string") return;
    try {
      api.apply(JSON.parse(event.detail));
    } catch {
      // Ignore malformed messages from the page context.
    }
  });

  api.apply(bootstrap);
})();
