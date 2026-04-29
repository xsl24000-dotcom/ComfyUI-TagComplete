import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { ComfyWidgets } from "../../scripts/widgets.js";

const EXT_ID = "ComfyUI.TagComplete";
const STYLE_ID = "comfyui-tagcomplete-style";
const TYPE_ORDER = {
    tag: 0,
    extra: 1,
    wildcard_file: 2,
    wildcard_value: 3,
    chant: 4,
    embedding: 5,
    lora: 6,
    lyco: 7,
    hypernetwork: 8,
};

const state = {
    bootstrap: null,
    config: null,
    choices: null,
    assetPrefix: "/tagcomplete/api/assets/",
    staticSignature: "",
    staticData: {
        tags: [],
        extras: [],
        translations: new Map(),
        forwardTranslations: new Map(),
        reverseTranslations: new Map(),
        chants: [],
    },
    dynamicData: new Map(),
    previewCache: new Map(),
    settingsBound: false,
};

const STYLE = `
.tc-dropdown {
    position: absolute;
    z-index: 100000;
    min-width: 260px;
    max-width: 680px;
    background: #0f1720;
    color: #eef2ff;
    border: 1px solid #324154;
    border-radius: 12px;
    box-shadow: 0 18px 60px rgba(0, 0, 0, 0.42);
    overflow: hidden;
    overscroll-behavior: contain;
}
.tc-results {
    max-height: min(52vh, 480px);
    overflow: auto;
}
.tc-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
    padding: 10px 12px;
    cursor: pointer;
    border-bottom: 1px solid rgba(148, 163, 184, 0.08);
}
.tc-row:last-child {
    border-bottom: 0;
}
.tc-row:hover,
.tc-row.tc-selected {
    background: #192231;
}
.tc-main {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
}
.tc-title {
    font-size: 13px;
    white-space: pre-wrap;
    word-break: break-word;
}
.tc-subtitle {
    font-size: 11px;
    color: #8ba0bc;
    white-space: pre-wrap;
    word-break: break-word;
}
.tc-side {
    display: flex;
    align-items: start;
    gap: 6px;
    color: #a9b7c8;
    font-size: 11px;
    white-space: nowrap;
}
.tc-pill {
    display: inline-flex;
    align-items: center;
    padding: 2px 6px;
    border-radius: 999px;
    background: rgba(148, 163, 184, 0.14);
}
.tc-count-button {
    border: 1px solid rgba(93, 114, 137, 0.7);
    background: rgba(25, 34, 49, 0.92);
    color: #eef2ff;
    border-radius: 999px;
    padding: 2px 8px;
    font-size: 11px;
    cursor: pointer;
}
.tc-count-button:hover {
    background: rgba(39, 54, 76, 0.96);
}
.tc-preview {
    display: none;
    position: absolute;
    left: calc(100% + 10px);
    top: 0;
    width: 220px;
    background: #0f1720;
    border: 1px solid #324154;
    border-radius: 12px;
    padding: 8px;
    box-shadow: 0 18px 60px rgba(0, 0, 0, 0.42);
}
.tc-index {
    color: #8ba0bc;
    min-width: 1.4rem;
    text-align: right;
}
.tc-preview img {
    width: 100%;
    height: 220px;
    object-fit: cover;
    border-radius: 8px;
    display: block;
}
.tc-preview-title {
    font-size: 11px;
    color: #9aa7b5;
    margin-top: 6px;
    overflow: hidden;
    text-overflow: ellipsis;
}
`;

function ensureStyle() {
    if (document.getElementById(STYLE_ID)) {
        return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = STYLE;
    document.head.appendChild(style);
}

function debounce(fn, wait) {
    let handle = null;
    return (...args) => {
        window.clearTimeout(handle);
        handle = window.setTimeout(() => fn(...args), wait);
    };
}

function normalizeTranslationKey(value) {
    return String(value || "")
        .trim()
        .replaceAll("_", " ")
        .replace(/\s+/g, " ")
        .toLowerCase();
}

function escapeRegex(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isCjk(text) {
    return /[\u3400-\u9FFF\uF900-\uFAFF]/.test(text || "");
}

function isLikelyAsciiTag(text) {
    return /[a-zA-Z]/.test(text || "") && !isCjk(text || "");
}

function dispatchTextEvents(element) {
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
}

function markNoTranslate(element, lang = "") {
    if (!(element instanceof HTMLElement)) {
        return element;
    }
    element.classList.add("tc-no-translate");
    element.dataset.tagcompleteNoTranslate = "true";
    element.setAttribute("translate", "no");
    if (lang) {
        element.lang = lang;
    }
    return element;
}

function resolveTextareaElement(widget) {
    const candidates = [];
    const addCandidate = (candidate) => {
        if (candidate instanceof HTMLTextAreaElement && !candidates.includes(candidate)) {
            candidates.push(candidate);
        }
    };
    const inspect = (candidate) => {
        if (!candidate) {
            return;
        }
        if (candidate instanceof HTMLTextAreaElement) {
            addCandidate(candidate);
            return;
        }
        if (!(candidate instanceof HTMLElement)) {
            return;
        }
        if (candidate.matches("textarea")) {
            addCandidate(candidate);
        }
        candidate.querySelectorAll("textarea").forEach(addCandidate);
        candidate.shadowRoot?.querySelectorAll("textarea").forEach(addCandidate);
    };
    const score = (candidate) => {
        if (!(candidate instanceof HTMLTextAreaElement)) {
            return -1;
        }
        let total = 0;
        const style = window.getComputedStyle(candidate);
        if (candidate === document.activeElement) {
            total += 20;
        }
        if (!candidate.disabled && !candidate.readOnly) {
            total += 8;
        }
        if (style.display !== "none" && style.visibility !== "hidden") {
            total += 6;
        }
        if (Number(style.opacity || "1") > 0) {
            total += 2;
        }
        if (candidate.offsetWidth > 0 && candidate.offsetHeight > 0) {
            total += 10;
        }
        if (document.body.contains(candidate)) {
            total += 4;
        }
        return total;
    };

    inspect(widget?.inputEl);
    inspect(widget?.element);
    return candidates.sort((left, right) => score(right) - score(left))[0] || null;
}

function translationsEnabled() {
    return Boolean(state.config?.useTranslations);
}

function unwrapTranslatableText(text) {
    const value = String(text || "").trim();
    const weighted = value.match(/^(\(+)(.+?)(:\s*-?\d+(?:\.\d+)?)((?:\))+)$/
    );
    if (weighted) {
        return {
            prefix: weighted[1],
            core: weighted[2],
            suffix: `${weighted[3]}${weighted[4]}`,
        };
    }
    const wrapped = value.match(/^([\(\[\{]+)(.+?)([\)\]\}]+)$/);
    if (wrapped) {
        return {
            prefix: wrapped[1],
            core: wrapped[2],
            suffix: wrapped[3],
        };
    }
    return {
        prefix: "",
        core: value,
        suffix: "",
    };
}

function isSpecialToken(text) {
    const trimmed = String(text || "").trim();
    return (
        !trimmed ||
        trimmed === "BREAK" ||
        trimmed.startsWith("<") ||
        trimmed.startsWith(state.config?.wcWrap || "__") ||
        /^<[^>]+>$/.test(trimmed)
    );
}

function getCanonicalTagText(text, staticData = state.staticData) {
    const raw = String(text || "").trim();
    if (!raw) {
        return "";
    }
    if (!translationsEnabled() || isSpecialToken(raw)) {
        return raw;
    }

    const wrapped = unwrapTranslatableText(raw);
    const reverseTranslations = staticData?.reverseTranslations || new Map();
    const recovered = reverseTranslations.get(normalizeTranslationKey(wrapped.core)) || "";
    const canonicalCore = isLikelyAsciiTag(recovered) ? recovered : wrapped.core;
    return `${wrapped.prefix}${canonicalCore}${wrapped.suffix}`;
}

function getLocalizedTagText(text, staticData = state.staticData) {
    const raw = String(text || "").trim();
    if (!translationsEnabled() || !raw || isSpecialToken(raw)) {
        return "";
    }

    const canonical = getCanonicalTagText(raw, staticData);
    const canonicalWrapped = unwrapTranslatableText(canonical);
    const originalWrapped = unwrapTranslatableText(raw);
    const forwardTranslations = staticData?.forwardTranslations || new Map();

    let localizedCore = forwardTranslations.get(normalizeTranslationKey(canonicalWrapped.core)) || "";
    if (!localizedCore && isCjk(originalWrapped.core)) {
        localizedCore = originalWrapped.core;
    }
    if (!localizedCore || normalizeTranslationKey(localizedCore) === normalizeTranslationKey(canonicalWrapped.core)) {
        return "";
    }
    return `${canonicalWrapped.prefix}${localizedCore}${canonicalWrapped.suffix}`;
}

function resolveDisplayTitleSubtitle(item, staticData, fallbackSubtitle = "") {
    const raw = String(item?.text || item?.value || "").trim();
    if (!raw) {
        return { title: "", subtitle: "" };
    }

    if (!translationsEnabled()) {
        const fallback = String(fallbackSubtitle || "").trim();
        return {
            title: raw,
            subtitle: fallback.startsWith("Alias:") ? fallback : "",
        };
    }

    const title = getCanonicalTagText(raw, staticData) || raw;
    let subtitle = getLocalizedTagText(raw, staticData);
    if (!subtitle) {
        const fallback = String(item?.translation || fallbackSubtitle || "").trim();
        if (fallback && normalizeTranslationKey(fallback) !== normalizeTranslationKey(title)) {
            subtitle = fallback;
        }
    }
    return { title, subtitle };
}

function frequencyKey(tagType, name) {
    return `${tagType}::${name}`;
}

function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const next = text[index + 1];

        if (char === '"' && inQuotes && next === '"') {
            field += '"';
            index += 1;
            continue;
        }

        if (char === '"') {
            inQuotes = !inQuotes;
            continue;
        }

        if (!inQuotes && char === ",") {
            row.push(field);
            field = "";
            continue;
        }

        if (!inQuotes && (char === "\n" || char === "\r")) {
            if (char === "\r" && next === "\n") {
                index += 1;
            }
            row.push(field);
            rows.push(row);
            row = [];
            field = "";
            continue;
        }

        field += char;
    }

    if (field.length || row.length) {
        row.push(field);
        rows.push(row);
    }

    return rows.filter((entry) => entry.some((value) => value !== ""));
}

async function fetchApiJson(path, options = {}) {
    const response = await api.fetchApi(path, {
        cache: "no-store",
        ...options,
    });
    if (!response.ok) {
        throw new Error(`Request failed: ${path} -> ${response.status}`);
    }
    return response.json();
}

async function fetchAssetText(name) {
    const response = await fetch(`${state.assetPrefix}${encodeURIComponent(name)}?t=${Date.now()}`);
    if (!response.ok) {
        throw new Error(`Asset not found: ${name}`);
    }
    const bytes = await response.arrayBuffer();
    const decode = (encoding, fatal = false) => {
        try {
            return new TextDecoder(encoding, { fatal }).decode(bytes);
        } catch (_error) {
            return null;
        }
    };
    return (
        decode("utf-8", true) ||
        decode("utf-16le", true) ||
        decode("utf-16be", true) ||
        decode("gb18030") ||
        decode("utf-8") ||
        ""
    ).replace(/^\uFEFF/, "");
}

function makeTagRecord(row, source) {
    const aliases = (row[3] || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    const count = Number.parseInt(row[2], 10);
    const text = (row[0] || "").trim();
    if (!text) {
        return null;
    }
    return {
        text,
        lowerText: text.toLowerCase(),
        type: String(row[1] || 0),
        count: Number.isFinite(count) ? count : 0,
        aliases,
        lowerAliases: aliases.map((value) => value.toLowerCase()),
        translation: (row[4] || "").trim(),
        lowerTranslation: ((row[4] || "").trim()).toLowerCase(),
        source,
        extraMeta: source === "extra" ? ((row[2] || "").trim() || "Custom tag") : "",
    };
}

function mergeTranslationData(items, translations) {
    for (const item of items) {
        if (!item.translation && translations.has(item.text)) {
            item.translation = translations.get(item.text);
            item.lowerTranslation = item.translation.toLowerCase();
        }
    }
}

function listToMap(rows) {
    const map = new Map();
    for (const row of rows) {
        const key = (row[0] || "").trim();
        if (!key) {
            continue;
        }
        const value = (row[1] || row[2] || "").trim();
        if (!value) {
            continue;
        }
        map.set(key, value);
    }
    return map;
}

function normalToken(before) {
    const match = before.match(/([^,;"|{}()\n]+)$/);
    if (!match) {
        return "";
    }
    return match[1].replace(/^\s+/, "");
}

function typeLabel(type) {
    switch (type) {
        case "extra":
            return "Extra";
        case "embedding":
            return "Embedding";
        case "lora":
            return "LoRA";
        case "lyco":
            return "LyCORIS";
        case "hypernetwork":
            return "Hypernetwork";
        case "wildcard_file":
            return "Wildcard";
        case "wildcard_value":
            return "Wildcard Value";
        case "chant":
            return "Chant";
        default:
            return "Tag";
    }
}

async function bootstrap(force = false) {
    if (state.bootstrap && !force) {
        return state.bootstrap;
    }
    state.bootstrap = fetchApiJson("/tagcomplete/api/bootstrap").then((payload) => {
        state.config = payload.config;
        state.choices = payload.choices;
        state.assetPrefix = payload.assetPrefix;
        ensureSettings();
        return payload;
    });
    return state.bootstrap;
}

async function saveConfig(nextConfig) {
    const payload = await fetchApiJson("/tagcomplete/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextConfig),
    });
    state.config = payload.config;
    state.staticSignature = "";
    state.dynamicData.clear();
    state.previewCache.clear();
    return payload.config;
}

async function loadStaticData(force = false) {
    await bootstrap();
    const signature = [
        state.config.tagFile,
        state.config.translationFile,
        state.config.extraFile,
        state.config.chantFile,
    ].join("|");
    if (!force && state.staticSignature === signature) {
        return state.staticData;
    }

    const tagsPromise = fetchAssetText(state.config.tagFile).then((text) =>
        parseCSV(text).map((row) => makeTagRecord(row, "tag")).filter(Boolean)
    );
    const translationPromise =
        state.config.translationFile && state.config.translationFile !== "None"
            ? fetchAssetText(state.config.translationFile).then((text) => listToMap(parseCSV(text)))
            : Promise.resolve(new Map());
    const extraPromise =
        state.config.extraFile && state.config.extraFile !== "None"
            ? fetchAssetText(state.config.extraFile).then((text) =>
                  parseCSV(text).map((row) => makeTagRecord(row, "extra")).filter(Boolean)
              )
            : Promise.resolve([]);
    const chantsPromise =
        state.config.chantFile && state.config.chantFile !== "None"
            ? fetchAssetText(state.config.chantFile).then((text) => JSON.parse(text))
            : Promise.resolve([]);

    const [tags, translations, extras, chants] = await Promise.all([
        tagsPromise,
        translationPromise,
        extraPromise,
        chantsPromise,
    ]);

    mergeTranslationData(tags, translations);
    mergeTranslationData(extras, translations);

    const forwardTranslations = new Map();
    const reverseTranslations = new Map();
    for (const item of [...tags, ...extras]) {
        if (!item.translation) {
            continue;
        }
        const sourceKey = normalizeTranslationKey(item.text);
        const translationKey = normalizeTranslationKey(item.translation);
        if (sourceKey && !forwardTranslations.has(sourceKey)) {
            forwardTranslations.set(sourceKey, item.translation);
        }
        if (translationKey && !reverseTranslations.has(translationKey)) {
            reverseTranslations.set(translationKey, item.text);
        }
    }
    for (const [key, value] of translations.entries()) {
        const sourceKey = normalizeTranslationKey(key);
        const translationKey = normalizeTranslationKey(value);
        if (sourceKey && !forwardTranslations.has(sourceKey)) {
            forwardTranslations.set(sourceKey, value);
        }
        if (translationKey && !reverseTranslations.has(translationKey)) {
            reverseTranslations.set(translationKey, key);
        }
    }

    state.staticData = {
        tags,
        extras,
        translations,
        forwardTranslations,
        reverseTranslations,
        chants: Array.isArray(chants) ? chants : [],
    };
    state.staticSignature = signature;
    return state.staticData;
}

async function getDynamic(kind, force = false) {
    await bootstrap();
    if (!force && state.dynamicData.has(kind)) {
        return state.dynamicData.get(kind);
    }
    const payload = await fetchApiJson(`/tagcomplete/api/dynamic/${kind}`);
    const items = payload.items || [];
    state.dynamicData.set(kind, items);
    return items;
}

async function getPreviewUrl(kind, name) {
    const key = `${kind}:${name}`;
    if (state.previewCache.has(key)) {
        return state.previewCache.get(key);
    }
    const payload = await fetchApiJson(
        `/tagcomplete/api/preview?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(name)}`
    );
    state.previewCache.set(key, payload.url || null);
    return payload.url || null;
}

function computeFrequencyBoost(count) {
    if (!state.config.frequencySort || count < state.config.frequencyMinCount) {
        return 0;
    }
    switch (state.config.frequencyFunction) {
        case "Usage first":
            return count;
        case "Logarithmic (strong)":
            return Math.log1p(count) * 2;
        default:
            return Math.log1p(count);
    }
}

function computeSessionBoost(level) {
    if (!level || level < 2) {
        return { score: 0, amount: 0, level: 0 };
    }
    const amount = 2 ** Math.min(level - 1, 10);
    return {
        score: amount * 32,
        amount,
        level,
    };
}

async function enrichFrequency(results, negative) {
    if (!state.config.frequencySort || !results.length) {
        return results;
    }
    const payload = await fetchApiJson("/tagcomplete/api/frequency/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            items: results.map((result) => ({ name: result.frequencyName, type: result.type })),
            negative,
            maxAgeDays: state.config.frequencyMaxAge,
        }),
    });
    const counts = payload.items || {};
    for (const result of results) {
        const key = `${result.type}::${result.frequencyName}`;
        result.frequencyCount = counts[key]?.count || 0;
        result.score += computeFrequencyBoost(result.frequencyCount);
    }
    results.sort(sortResults);
    return results;
}

function sortResults(left, right) {
    if (right.score !== left.score) {
        return right.score - left.score;
    }
    if ((TYPE_ORDER[left.type] || 99) !== (TYPE_ORDER[right.type] || 99)) {
        return (TYPE_ORDER[left.type] || 99) - (TYPE_ORDER[right.type] || 99);
    }
    if ((right.count || 0) !== (left.count || 0)) {
        return (right.count || 0) - (left.count || 0);
    }
    return left.value.localeCompare(right.value);
}

function computeManualCountIncrease(clicks) {
    if (clicks <= 1) {
        return 1000;
    }
    if (clicks === 2) {
        return 10000;
    }
    if (clicks === 3) {
        return 30000;
    }
    return 200000;
}

class TagCompleteTextArea {
    constructor(element, widget, node, inputName, inputData) {
        this.el = null;
        this.widget = widget || null;
        this.node = node;
        this.inputName = inputName;
        this.inputData = inputData;
        this.role = inputData?.tagcomplete?.role || (inputName.toLowerCase().includes("negative") ? "negative" : "positive");
        this.dropdown = document.createElement("div");
        this.dropdown.className = "tc-dropdown";
        markNoTranslate(this.dropdown);
        this.resultsHost = document.createElement("div");
        this.resultsHost.className = "tc-results";
        this.previewHost = document.createElement("div");
        this.previewHost.className = "tc-preview";
        markNoTranslate(this.resultsHost);
        markNoTranslate(this.previewHost);
        this.dropdown.append(this.resultsHost, this.previewHost);
        this.results = [];
        this.rowElements = [];
        this.selectedIndex = 0;
        this.visible = false;
        this.activeToken = "";
        this.isApplyingResult = false;
        this.selectionUseCounts = new Map();
        this.manualCountClicks = new Map();
        this.manualCountTotals = new Map();
        this.suppressBlurUntil = 0;
        this.previewRequestKey = "";
        this.lastSelectionStart = null;
        this.lastSelectionEnd = null;
        this.updateDebounced = debounce(() => this.update(), state.config?.delayTime || 80);

        this.dropdown.addEventListener(
            "wheel",
            (event) => {
                event.stopPropagation();
                if (event.target instanceof Element && event.target.closest(".tc-preview")) {
                    event.preventDefault();
                }
            },
            { passive: false, capture: true }
        );
        this.resultsHost.addEventListener(
            "wheel",
            (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.resultsHost.scrollTop += event.deltaY;
            },
            { passive: false }
        );
        this.dropdown.addEventListener("pointerdown", (event) => {
            this.suppressBlurUntil = Date.now() + 250;
            event.stopPropagation();
        });

        this.keydown = this.onKeyDown.bind(this);
        this.keyup = this.onKeyUp.bind(this);
        this.focus = () => {
            this.refreshElementBinding();
            this.captureSelection();
            this.updateDebounced();
        };
        this.click = () => {
            this.captureSelection();
            this.updateDebounced();
        };
        this.blur = () =>
            window.setTimeout(() => {
                const remaining = this.suppressBlurUntil - Date.now();
                if (remaining > 0) {
                    window.setTimeout(() => {
                        if (document.activeElement !== this.el) {
                            this.hide();
                        }
                    }, remaining + 10);
                    return;
                }
                if (document.activeElement !== this.el) {
                    this.hide();
                }
            }, 140);
        this.input = () => {
            this.mirrorValueToWidget(this.el.value || "");
            this.captureSelection();
            this.updateDebounced();
        };
        this.change = () => {
            this.mirrorValueToWidget(this.el.value || "");
            this.captureSelection();
        };

        this.bindElement(element);
        this.pollTimer = window.setInterval(() => this.refreshElementBinding(), 800);
    }

    bindElement(element) {
        if (!element || element === this.el) {
            return;
        }
        if (this.el) {
            this.el.removeEventListener("keydown", this.keydown);
            this.el.removeEventListener("keyup", this.keyup);
            this.el.removeEventListener("focus", this.focus);
            this.el.removeEventListener("click", this.click);
            this.el.removeEventListener("blur", this.blur);
            this.el.removeEventListener("input", this.input);
            this.el.removeEventListener("change", this.change);
            delete this.el.dataset.tagcompleteBound;
        }

        this.el = element;
        this.el.dataset.tagcompleteBound = "true";
        this.el.addEventListener("keydown", this.keydown);
        this.el.addEventListener("keyup", this.keyup);
        this.el.addEventListener("focus", this.focus);
        this.el.addEventListener("click", this.click);
        this.el.addEventListener("blur", this.blur);
        this.el.addEventListener("input", this.input);
        this.el.addEventListener("change", this.change);
        this.captureSelection();
    }

    refreshElementBinding() {
        const resolved = resolveTextareaElement(this.widget);
        if (!resolved || resolved === this.el) {
            return;
        }
        this.bindElement(resolved);
    }

    captureSelection() {
        if (!this.el) {
            return;
        }
        this.lastSelectionStart = this.el.selectionStart ?? this.el.value.length;
        this.lastSelectionEnd = this.el.selectionEnd ?? this.lastSelectionStart;
    }

    getCursorContext() {
        const start = this.el.selectionStart ?? this.el.value.length;
        const before = this.el.value.slice(0, start);
        const token = normalToken(before);
        this.lastSelectionStart = start;
        this.lastSelectionEnd = this.el.selectionEnd ?? start;
        return { before, token, start };
    }

    getApplyRange(fallbackToken = "") {
        const value = this.el?.value || "";
        const selectionEnd = this.lastSelectionEnd ?? this.el?.selectionEnd ?? value.length;
        const selectionStart = this.lastSelectionStart ?? this.el?.selectionStart ?? selectionEnd;
        if (selectionStart !== selectionEnd) {
            return {
                token: value.slice(selectionStart, selectionEnd),
                start: selectionStart,
                end: selectionEnd,
            };
        }

        let scanEnd = selectionEnd;
        while (scanEnd > 0 && /\s/.test(value[scanEnd - 1])) {
            scanEnd -= 1;
        }
        while (scanEnd > 0 && /[,;]/.test(value[scanEnd - 1])) {
            scanEnd -= 1;
            while (scanEnd > 0 && /\s/.test(value[scanEnd - 1])) {
                scanEnd -= 1;
            }
        }

        const token = normalToken(value.slice(0, scanEnd)) || fallbackToken || "";
        if (!token) {
            return {
                token: "",
                start: selectionStart,
                end: selectionEnd,
            };
        }

        return {
            token,
            start: Math.max(0, scanEnd - token.length),
            end: selectionEnd,
        };
    }

    async incrementResultCount(result) {
        const resultId = result.id;
        const key = frequencyKey(result.type, result.frequencyName);
        const clicks = this.getManualCountClicks(result.type, result.frequencyName) + 1;
        const increase = computeManualCountIncrease(clicks);
        const total = this.getManualCountTotal(result.type, result.frequencyName) + increase;

        this.manualCountClicks.set(key, clicks);
        this.manualCountTotals.set(key, total);
        result.frequencyCount = (result.frequencyCount || 0) + increase;

        const scrollTop = this.resultsHost.scrollTop;
        this.decorateSessionBoost(this.results);
        this.selectedIndex = Math.max(0, this.results.findIndex((item) => item.id === resultId));
        this.render();
        this.resultsHost.scrollTop = scrollTop;

        if (this.el) {
            this.el.focus({ preventScroll: true });
            if (this.lastSelectionStart != null && this.lastSelectionEnd != null) {
                this.el.setSelectionRange(this.lastSelectionStart, this.lastSelectionEnd);
            }
        }

        await fetchApiJson("/tagcomplete/api/frequency/increase", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: result.frequencyName,
                type: result.type,
                negative: this.role === "negative",
                amount: increase,
            }),
        }).catch(() => null);
    }

    mirrorValueToWidget(value) {
        const nextValue = String(value ?? "");
        if (this.widget) {
            this.widget.value = nextValue;

            const widgetInput = this.widget.inputEl;
            if (widgetInput instanceof HTMLTextAreaElement && widgetInput !== this.el) {
                widgetInput.value = nextValue;
            }

            const widgetElement = this.widget.element;
            if (widgetElement instanceof HTMLTextAreaElement && widgetElement !== this.el) {
                widgetElement.value = nextValue;
            }
        }

        if (Array.isArray(this.node?.widgets) && this.widget) {
            const widgetIndex = this.node.widgets.indexOf(this.widget);
            if (widgetIndex > -1) {
                if (!Array.isArray(this.node.widgets_values)) {
                    this.node.widgets_values = [];
                }
                this.node.widgets_values[widgetIndex] = nextValue;
            }
        }

        app.graph?.setDirtyCanvas?.(true, false);
    }

    getSelectionLevel(tagType, frequencyName) {
        return this.selectionUseCounts.get(frequencyKey(tagType, frequencyName)) || 0;
    }

    getManualCountClicks(tagType, frequencyName) {
        return this.manualCountClicks.get(frequencyKey(tagType, frequencyName)) || 0;
    }

    getManualCountTotal(tagType, frequencyName) {
        return this.manualCountTotals.get(frequencyKey(tagType, frequencyName)) || 0;
    }

    decorateSessionBoost(results) {
        for (const result of results) {
            const level = this.getSelectionLevel(result.type, result.frequencyName);
            const boost = computeSessionBoost(level);
            result.manualBoostClicks = this.getManualCountClicks(result.type, result.frequencyName);
            result.manualBoostTotal = this.getManualCountTotal(result.type, result.frequencyName);
            result.sessionBoostLevel = boost.level;
            result.sessionBoostAmount = boost.amount;
            result.score = (result.baseScore ?? result.score) + computeFrequencyBoost(result.frequencyCount || 0) + boost.score;
        }
        results.sort(sortResults);
        return results;
    }

    async searchNormal(term) {
        const query = term.trim().replace(/\s+/g, "_").toLowerCase();
        if (!query) {
            return [];
        }

        const data = await loadStaticData();
        const pool = [...data.tags, ...data.extras];
        const deduped = new Map();

        for (const item of pool) {
            let score = -1;
            let aliasHint = "";
            const value = item.text;
            let frequencyName = item.text;

            if (item.lowerText.startsWith(query)) {
                score = 1000;
            } else if (item.lowerText.includes(query)) {
                score = 820;
            }

            if (state.config.searchByAlias) {
                const aliasIndex = item.lowerAliases.findIndex((alias) => alias.includes(query));
                if (aliasIndex > -1) {
                    const alias = item.aliases[aliasIndex];
                    const aliasScore = item.lowerAliases[aliasIndex].startsWith(query) ? 970 : 790;
                    if (aliasScore > score) {
                        score = aliasScore;
                        aliasHint = `Alias: ${alias}`;
                        frequencyName = item.text;
                    }
                }
            }

            if (state.config.useTranslations && item.lowerTranslation && item.lowerTranslation.includes(query)) {
                const translationScore = item.lowerTranslation.startsWith(query) ? 920 : 760;
                if (translationScore > score) {
                    score = translationScore;
                }
            }

            if (score < 0) {
                continue;
            }

            const display = resolveDisplayTitleSubtitle(item, data, aliasHint);
            const result = {
                id: value,
                type: item.source === "extra" ? "extra" : "tag",
                title: display.title,
                subtitle: display.subtitle,
                translation: item.translation || "",
                detail: aliasHint,
                meta: item.source === "extra" ? item.extraMeta : "",
                value,
                frequencyName,
                count: item.count,
                baseScore: score + Math.log1p(item.count || 0),
                score: score + Math.log1p(item.count || 0),
                previewKind: null,
            };

            const existing = deduped.get(value);
            if (!existing || result.score > existing.score) {
                deduped.set(value, result);
            }
        }

        const results = [...deduped.values()].sort(sortResults);
        const cap = Math.max(state.config.frequencyRecommendCap || 10, 1) * 4;
        const topResults = results.slice(0, Math.min(results.length, cap));
        await enrichFrequency(topResults, this.role === "negative");
        return this.decorateSessionBoost(topResults.concat(results.slice(topResults.length)));
    }

    async searchAngle(token) {
        const lower = token.toLowerCase();
        const groups = [];
        let search = token.replace(/^</, "");

        if (lower.startsWith("<e:")) {
            search = token.slice(3);
            groups.push("embeddings");
        } else if (lower.startsWith("<h:") || lower.startsWith("<hypernet:")) {
            search = token.replace(/^<hypernet:/i, "").replace(/^<h:/i, "");
            groups.push("hypernetworks");
        } else if (lower.startsWith("<c:") || lower.startsWith("<chant:")) {
            search = token.replace(/^<chant:/i, "").replace(/^<c:/i, "");
            groups.push("chants");
        } else if (lower.startsWith("<lyco:")) {
            search = token.replace(/^<lyco:/i, "");
            groups.push("lycos");
        } else if (lower.startsWith("<lora:") || lower.startsWith("<l:")) {
            search = token.replace(/^<lora:/i, "").replace(/^<l:/i, "");
            groups.push("loras");
            if (state.config.useLycos) {
                groups.push("lycos");
            }
        } else {
            search = token.slice(1);
            if (state.config.useEmbeddings) groups.push("embeddings");
            if (state.config.useLoras) groups.push("loras");
            if (state.config.useLycos) groups.push("lycos");
            if (state.config.useHypernetworks) groups.push("hypernetworks");
            if (state.config.useChants) groups.push("chants");
        }

        const query = search.trim().toLowerCase();
        const results = [];
        for (const group of groups) {
            const items = group === "chants" ? (await loadStaticData()).chants : await getDynamic(group);
            for (const item of items) {
                const name = group === "chants" ? item.name || item.content : item.name;
                const haystack = `${name} ${(item.terms || "")}`.toLowerCase();
                if (query && !haystack.includes(query)) {
                    continue;
                }
                const value = group === "chants" ? item.content : item.name;
                const type =
                    group === "embeddings"
                        ? "embedding"
                        : group === "loras"
                          ? "lora"
                          : group === "lycos"
                            ? "lyco"
                            : group === "hypernetworks"
                              ? "hypernetwork"
                              : "chant";
                results.push({
                    id: `${type}:${value}`,
                    type,
                    title: name,
                    subtitle: group === "chants" ? item.terms || "" : item.filename || "",
                    meta: typeLabel(type),
                    value,
                    frequencyName: group === "chants" ? item.name || item.content : value,
                    count: 0,
                    baseScore: name.toLowerCase().startsWith(query) ? 980 : 760,
                    score: name.toLowerCase().startsWith(query) ? 980 : 760,
                    previewKind: ["lora", "lyco", "hypernetwork"].includes(type)
                        ? (type === "hypernetwork" ? "hypernetworks" : `${type}s`.replace("lycoss", "lycos"))
                        : null,
                });
            }
        }
        await enrichFrequency(results, this.role === "negative");
        return this.decorateSessionBoost(results);
    }

    async searchWildcards(token) {
        if (!state.config.useWildcards) {
            return [];
        }

        const wrap = state.config.wcWrap || "__";
        const wrapPattern = escapeRegex(wrap);
        const fileMatch = token.match(new RegExp(`^${wrapPattern}([^,\\n]+?)${wrapPattern}([^,\\n ]*)$`));
        const query = token.replace(new RegExp(`^${wrapPattern}`), "").toLowerCase();
        const files = await getDynamic("wildcards");

        if (fileMatch) {
            const fileName = fileMatch[1];
            const partial = (fileMatch[2] || "").toLowerCase();
            const exact = files.find((item) => item.name === fileName);
            if (!exact) {
                return [];
            }
            const payload = await fetchApiJson(
                `/tagcomplete/api/wildcard-contents?source_id=${encodeURIComponent(exact.source_id)}&file=${encodeURIComponent(exact.file)}&mode=${encodeURIComponent(exact.mode)}&key_path=${encodeURIComponent(exact.key_path || "")}`
            );
            const results = (payload.items || [])
                .filter((value) => !partial || value.toLowerCase().includes(partial))
                .map((value) => ({
                    id: `wildcard_value:${fileName}:${value}`,
                    type: "wildcard_value",
                    title: value,
                    subtitle: fileName,
                    meta: "Wildcard Value",
                    value,
                    frequencyName: value,
                    count: 0,
                    baseScore: value.toLowerCase().startsWith(partial) ? 900 : 700,
                    score: value.toLowerCase().startsWith(partial) ? 900 : 700,
                    previewKind: null,
                }))
                .sort(sortResults);
            await enrichFrequency(results, this.role === "negative");
            return this.decorateSessionBoost(results);
        }

        const results = files
            .filter((item) => !query || item.name.toLowerCase().includes(query))
            .map((item) => ({
                id: `wildcard_file:${item.name}`,
                type: "wildcard_file",
                title: item.name,
                subtitle: item.mode === "yaml" ? "YAML wildcard collection" : "Wildcard file",
                meta: "Wildcard",
                value: item.name,
                frequencyName: item.name,
                count: 0,
                baseScore: item.name.toLowerCase().startsWith(query) ? 920 : 720,
                score: item.name.toLowerCase().startsWith(query) ? 920 : 720,
                previewKind: null,
            }))
            .sort(sortResults);
        await enrichFrequency(results, this.role === "negative");
        return this.decorateSessionBoost(results);
    }

    async buildResults() {
        const { token } = this.getCursorContext();
        if (!token) {
            return { token: "", results: [] };
        }

        if (token.startsWith(state.config.wcWrap || "__")) {
            return { token, results: await this.searchWildcards(token) };
        }
        if (token.startsWith("<")) {
            return { token, results: await this.searchAngle(token) };
        }
        return { token, results: await this.searchNormal(token) };
    }

    async update() {
        await bootstrap();
        this.refreshElementBinding();
        if (!state.config.enabled || !this.el || document.activeElement !== this.el) {
            this.hide();
            return;
        }

        const { token, results } = await this.buildResults();
        this.activeToken = token;
        this.results = state.config.showAllResults ? results : results.slice(0, state.config.maxResults || 20);
        this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, this.results.length - 1));
        if (!this.results.length) {
            this.hide();
            return;
        }
        this.render();
    }

    render() {
        this.resultsHost.replaceChildren();
        this.rowElements = [];
        this.previewHost.style.display = "none";

        this.results.forEach((result, index) => {
            const row = document.createElement("div");
            row.className = `tc-row${index === this.selectedIndex ? " tc-selected" : ""}`;
            markNoTranslate(row);
            row.addEventListener("mouseenter", () => {
                this.selectedIndex = index;
                this.updateSelectedRow();
                this.showPreview(result);
            });
            row.addEventListener("pointerdown", (event) => {
                if (event.button !== 0) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                this.triggerApplyResult(result);
            });
            row.addEventListener("mousedown", (event) => {
                if (event.button !== 0) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
            });
            row.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.triggerApplyResult(result);
            });

            const main = document.createElement("div");
            main.className = "tc-main";

            const title = document.createElement("div");
            title.className = "tc-title";
            const display = this.getDisplayText(result);
            title.textContent = display.title;
            markNoTranslate(title, isLikelyAsciiTag(display.title) ? "en" : (isCjk(display.title) ? "zh-CN" : ""));
            if (isLikelyAsciiTag(display.title)) {
                title.lang = "en";
            }
            main.appendChild(title);

            if (display.subtitle) {
                const subtitle = document.createElement("div");
                subtitle.className = "tc-subtitle";
                subtitle.textContent = display.subtitle;
                markNoTranslate(subtitle, isCjk(display.subtitle) ? "zh-CN" : (isLikelyAsciiTag(display.subtitle) ? "en" : ""));
                main.appendChild(subtitle);
            }

            const side = document.createElement("div");
            side.className = "tc-side";
            const indexLabel = document.createElement("span");
            indexLabel.className = "tc-index";
            indexLabel.textContent = index < 9 ? `${index + 1}` : "";
            side.appendChild(indexLabel);

            const countButton = document.createElement("button");
            countButton.type = "button";
            countButton.className = "tc-count-button";
            countButton.textContent = `Count+ ${result.manualBoostClicks || 0}`;
            countButton.title = `Next +${computeManualCountIncrease((result.manualBoostClicks || 0) + 1)}`;
            markNoTranslate(countButton, "en");
            countButton.addEventListener("pointerdown", (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.suppressBlurUntil = Date.now() + 250;
            });
            countButton.addEventListener("mousedown", (event) => {
                event.preventDefault();
                event.stopPropagation();
            });
            countButton.addEventListener("click", async (event) => {
                event.preventDefault();
                event.stopPropagation();
                await this.incrementResultCount(result);
            });
            side.appendChild(countButton);

            if (result.meta) {
                const pill = document.createElement("span");
                pill.className = "tc-pill";
                pill.textContent = result.meta;
                side.appendChild(pill);
            }
            if (result.count) {
                const count = document.createElement("span");
                count.className = "tc-pill";
                count.textContent = `${result.count}`;
                side.appendChild(count);
            }
            if (result.frequencyCount) {
                const freq = document.createElement("span");
                freq.className = "tc-pill";
                freq.textContent = `Used ${result.frequencyCount}`;
                side.appendChild(freq);
            }
            if (result.manualBoostTotal) {
                const added = document.createElement("span");
                added.className = "tc-pill";
                added.textContent = `+${result.manualBoostTotal}`;
                side.appendChild(added);
            }
            if (result.sessionBoostAmount) {
                const boost = document.createElement("span");
                boost.className = "tc-pill";
                boost.textContent = `^${result.sessionBoostAmount}`;
                side.appendChild(boost);
            }

            row.append(main, side);
            this.resultsHost.appendChild(row);
            this.rowElements.push(row);
        });

        if (!this.dropdown.parentElement) {
            document.body.appendChild(this.dropdown);
        }

        const rect = this.el.getBoundingClientRect();
        this.dropdown.style.left = `${window.scrollX + rect.left}px`;
        this.dropdown.style.top = `${window.scrollY + rect.bottom + 8}px`;
        this.dropdown.style.maxHeight = `${window.innerHeight - rect.bottom - 20}px`;
        this.visible = true;
        this.showPreview(this.results[this.selectedIndex]);
    }

    getDisplayText(result) {
        if (result?.type === "tag" || result?.type === "extra") {
            const display = resolveDisplayTitleSubtitle(
                {
                    text: result.value || result.title || "",
                    translation: result.translation || result.subtitle || result.detail || "",
                },
                state.staticData,
                result.translation || result.subtitle || result.detail || ""
            );
            return {
                title: display.title,
                subtitle: display.subtitle,
            };
        }

        let title = String(result?.title || "").trim();
        let subtitle = String(result?.subtitle || "").trim();
        if (subtitle && normalizeTranslationKey(subtitle) === normalizeTranslationKey(title)) {
            subtitle = "";
        }
        return { title, subtitle };
    }

    updateSelectedRow() {
        this.rowElements.forEach((row, index) => {
            row.classList.toggle("tc-selected", index === this.selectedIndex);
        });
    }

    async showPreview(result) {
        if (!result || !result.previewKind) {
            this.previewRequestKey = "";
            this.previewHost.style.display = "none";
            return;
        }
        const requestKey = `${result.previewKind}:${result.value}`;
        this.previewRequestKey = requestKey;
        const url = await getPreviewUrl(result.previewKind, result.value);
        if (this.previewRequestKey !== requestKey || !url) {
            this.previewHost.style.display = "none";
            return;
        }

        this.previewHost.replaceChildren();
        const img = document.createElement("img");
        img.src = url;
        const label = document.createElement("div");
        label.className = "tc-preview-title";
        label.textContent = result.value;
        markNoTranslate(label, isLikelyAsciiTag(result.value) ? "en" : (isCjk(result.value) ? "zh-CN" : ""));
        this.previewHost.append(img, label);
        this.previewHost.style.display = "block";
    }

    triggerApplyResult(result) {
        if (this.isApplyingResult) {
            return;
        }
        this.suppressBlurUntil = Date.now() + 250;
        this.isApplyingResult = true;
        this.applyResult(result).finally(() => {
            window.setTimeout(() => {
                this.isApplyingResult = false;
            }, 0);
        });
    }

    onKeyDown(event) {
        this.captureSelection();
        if (!this.visible) {
            return;
        }

        const digitMatch = event.key.match(/^[1-9]$/);
        if (digitMatch) {
            const index = Number.parseInt(event.key, 10) - 1;
            if (index < this.results.length) {
                event.preventDefault();
                this.selectedIndex = index;
                this.render();
                this.triggerApplyResult(this.results[this.selectedIndex]);
            }
            return;
        }

        if (event.key === "ArrowDown") {
            event.preventDefault();
            this.selectedIndex = (this.selectedIndex + 1) % this.results.length;
            this.render();
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            this.selectedIndex = this.selectedIndex === 0 ? this.results.length - 1 : this.selectedIndex - 1;
            this.render();
        } else if (event.key === "Tab" || (event.key === "Enter" && !event.ctrlKey)) {
            event.preventDefault();
            this.triggerApplyResult(this.results[this.selectedIndex]);
        } else if (event.key === "Escape") {
            this.hide();
        }
    }

    onKeyUp(event) {
        this.captureSelection();
        if (["ArrowUp", "ArrowDown", "Tab", "Enter", "Escape"].includes(event.key)) {
            return;
        }
        this.updateDebounced();
    }

    getInsertText(result) {
        let value = result.value;
        switch (result.type) {
            case "embedding":
                value = result.value;
                break;
            case "lora":
                value = `<lora:${result.value}:${state.config.extraNetworksDefaultMultiplier}>`;
                break;
            case "lyco":
                value = `<lyco:${result.value}:${state.config.extraNetworksDefaultMultiplier}>`;
                break;
            case "hypernetwork":
                value = `<hypernet:${result.value}:${state.config.extraNetworksDefaultMultiplier}>`;
                break;
            case "wildcard_file":
                value = `${state.config.wcWrap}${result.value}${state.config.wcWrap}`;
                break;
            case "wildcard_value":
            case "chant":
                value = result.value;
                break;
            default:
                if (state.config.replaceUnderscores) {
                    value = value.replace(/_/g, " ");
                }
                if (state.config.escapeParentheses) {
                    value = value.replace(/\(/g, "\\(").replace(/\)/g, "\\)");
                }
                break;
        }
        return value;
    }

    async maybeInsertModelKeywords(result) {
        if (!state.config.modelKeywordCompletion || !["lora", "lyco"].includes(result.type) || this.role === "negative") {
            return;
        }
        const payload = await fetchApiJson(`/tagcomplete/api/model-keywords?name=${encodeURIComponent(result.value)}`);
        if (!payload.keywords) {
            return;
        }
        const keywords = payload.keywords.trim();
        if (!keywords || this.el.value.includes(keywords)) {
            return;
        }
        if (state.config.modelKeywordLocation === "End of prompt") {
            this.el.value = this.el.value.trim() ? `${this.el.value.trim()}, ${keywords}` : keywords;
        } else {
            this.el.value = this.el.value.trim() ? `${keywords}, ${this.el.value.trim()}` : keywords;
        }
    }

    async applyResult(result) {
        if (!result) {
            return;
        }

        this.refreshElementBinding();
        const value = this.getInsertText(result);
        const applyRange = this.getApplyRange(this.activeToken || "");
        const start = applyRange.start;
        const end = applyRange.end;

        this.el.focus();
        this.el.setSelectionRange(start, end);
        this.el.setRangeText(value, start, end, "end");

        const after = this.el.value.slice(this.el.selectionEnd);
        const shouldPad =
            !["lora", "lyco", "hypernetwork", "wildcard_file"].includes(result.type) &&
            !after.trimStart().startsWith(",") &&
            !after.startsWith("\n");
        if (shouldPad) {
            const cursor = this.el.selectionEnd;
            this.el.setSelectionRange(cursor, cursor);
            this.el.setRangeText(",", cursor, cursor, "end");
        }

        const sessionKey = frequencyKey(result.type, result.frequencyName);
        const nextLevel = (this.selectionUseCounts.get(sessionKey) || 0) + 1;
        this.selectionUseCounts.set(sessionKey, nextLevel);
        const boostAmount = 2 ** Math.min(nextLevel - 1, 10);

        await this.maybeInsertModelKeywords(result);
        this.mirrorValueToWidget(this.el.value || "");
        await fetchApiJson("/tagcomplete/api/frequency/increase", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: result.frequencyName,
                type: result.type,
                negative: this.role === "negative",
                amount: boostAmount,
            }),
        }).catch(() => null);
        this.captureSelection();
        dispatchTextEvents(this.el);
        this.hide();
    }

    hide() {
        this.visible = false;
        this.previewRequestKey = "";
        this.dropdown.remove();
        this.previewHost.style.display = "none";
    }
}

function ensureSettings() {
    if (state.settingsBound || !state.choices || !state.config) {
        return;
    }
    state.settingsBound = true;

    const makeSetter = (key) => async (value) => {
        const next = { ...state.config, [key]: value };
        await saveConfig(next);
    };

    app.ui.settings.addSetting({
        id: `${EXT_ID}.enabled`,
        name: "TagComplete Enabled",
        type: "boolean",
        defaultValue: state.config.enabled,
        onChange: makeSetter("enabled"),
    });
    app.ui.settings.addSetting({
        id: `${EXT_ID}.globalHook`,
        name: "TagComplete Global Hook",
        type: "boolean",
        defaultValue: state.config.globalHook,
        onChange: makeSetter("globalHook"),
    });
    app.ui.settings.addSetting({
        id: `${EXT_ID}.tagFile`,
        name: "TagComplete Tag File",
        type: "combo",
        options: state.choices.tagFiles.map((value) => ({ value, text: value })),
        defaultValue: state.config.tagFile,
        onChange: makeSetter("tagFile"),
    });
    app.ui.settings.addSetting({
        id: `${EXT_ID}.translationFile`,
        name: "TagComplete Translation File",
        type: "combo",
        options: state.choices.translationFiles.map((value) => ({ value, text: value })),
        defaultValue: state.config.translationFile,
        onChange: makeSetter("translationFile"),
    });
    app.ui.settings.addSetting({
        id: `${EXT_ID}.useTranslations`,
        name: "TagComplete Translations",
        type: "boolean",
        defaultValue: state.config.useTranslations,
        onChange: makeSetter("useTranslations"),
    });
    app.ui.settings.addSetting({
        id: `${EXT_ID}.extraFile`,
        name: "TagComplete Extra File",
        type: "combo",
        options: state.choices.extraFiles.map((value) => ({ value, text: value })),
        defaultValue: state.config.extraFile,
        onChange: makeSetter("extraFile"),
    });
    app.ui.settings.addSetting({
        id: `${EXT_ID}.chantFile`,
        name: "TagComplete Chant File",
        type: "combo",
        options: state.choices.chantFiles.map((value) => ({ value, text: value })),
        defaultValue: state.config.chantFile,
        onChange: makeSetter("chantFile"),
    });
    app.ui.settings.addSetting({
        id: `${EXT_ID}.maxResults`,
        name: "TagComplete Max Results",
        type: "number",
        defaultValue: state.config.maxResults,
        onChange: makeSetter("maxResults"),
    });
    app.ui.settings.addSetting({
        id: `${EXT_ID}.delayTime`,
        name: "TagComplete Delay (ms)",
        type: "number",
        defaultValue: state.config.delayTime,
        onChange: makeSetter("delayTime"),
    });
    app.ui.settings.addSetting({
        id: `${EXT_ID}.replaceUnderscores`,
        name: "TagComplete Replace _ With Space",
        type: "boolean",
        defaultValue: state.config.replaceUnderscores,
        onChange: makeSetter("replaceUnderscores"),
    });
    app.ui.settings.addSetting({
        id: `${EXT_ID}.escapeParentheses`,
        name: "TagComplete Escape Parentheses",
        type: "boolean",
        defaultValue: state.config.escapeParentheses,
        onChange: makeSetter("escapeParentheses"),
    });
    app.ui.settings.addSetting({
        id: `${EXT_ID}.searchByAlias`,
        name: "TagComplete Search By Alias",
        type: "boolean",
        defaultValue: state.config.searchByAlias,
        onChange: makeSetter("searchByAlias"),
    });
    app.ui.settings.addSetting({
        id: `${EXT_ID}.useWildcards`,
        name: "TagComplete Wildcards",
        type: "boolean",
        defaultValue: state.config.useWildcards,
        onChange: makeSetter("useWildcards"),
    });
    app.ui.settings.addSetting({
        id: `${EXT_ID}.useEmbeddings`,
        name: "TagComplete Embeddings",
        type: "boolean",
        defaultValue: state.config.useEmbeddings,
        onChange: makeSetter("useEmbeddings"),
    });
    app.ui.settings.addSetting({
        id: `${EXT_ID}.useLoras`,
        name: "TagComplete LoRAs",
        type: "boolean",
        defaultValue: state.config.useLoras,
        onChange: makeSetter("useLoras"),
    });
    app.ui.settings.addSetting({
        id: `${EXT_ID}.useHypernetworks`,
        name: "TagComplete Hypernetworks",
        type: "boolean",
        defaultValue: state.config.useHypernetworks,
        onChange: makeSetter("useHypernetworks"),
    });
    app.ui.settings.addSetting({
        id: `${EXT_ID}.useLycos`,
        name: "TagComplete LyCORIS",
        type: "boolean",
        defaultValue: state.config.useLycos,
        onChange: makeSetter("useLycos"),
    });
    app.ui.settings.addSetting({
        id: `${EXT_ID}.frequencySort`,
        name: "TagComplete Frequency Sort",
        type: "boolean",
        defaultValue: state.config.frequencySort,
        onChange: makeSetter("frequencySort"),
    });
    app.ui.settings.addSetting({
        id: `${EXT_ID}.modelKeywords`,
        name: "TagComplete Model Keyword Completion",
        type: "boolean",
        defaultValue: state.config.modelKeywordCompletion,
        onChange: makeSetter("modelKeywordCompletion"),
    });
    app.ui.settings.addSetting({
        id: `${EXT_ID}.reindex`,
        name: "TagComplete Reindex",
        defaultValue: false,
        type: (name) => {
            const row = document.createElement("tr");
            const left = document.createElement("td");
            left.textContent = name;
            const right = document.createElement("td");
            const button = document.createElement("button");
            button.textContent = "Reindex";
            button.onclick = async () => {
                button.disabled = true;
                button.textContent = "Reindexing...";
                await fetchApiJson("/tagcomplete/api/reindex", { method: "POST" });
                state.dynamicData.clear();
                state.previewCache.clear();
                button.textContent = "Done";
                window.setTimeout(() => {
                    button.disabled = false;
                    button.textContent = "Reindex";
                }, 1000);
            };
            right.appendChild(button);
            row.append(left, right);
            return row;
        },
    });
}

function shouldBind(node, inputName, inputData) {
    const widgetId = `${node.comfyClass}.${inputName}`;
    if (inputData?.tagcomplete === false) {
        return false;
    }
    if (state.config?.globalBlacklist?.includes(widgetId)) {
        return false;
    }
    if (!state.config?.globalHook && !inputData?.tagcomplete) {
        return false;
    }
    return true;
}

app.registerExtension({
    name: EXT_ID,
    async init() {
        ensureStyle();
        await bootstrap();
        await loadStaticData();

        const STRING = ComfyWidgets.STRING;
        ComfyWidgets.STRING = function tagCompleteString(node, inputName, inputData) {
            const result = STRING.apply(this, arguments);
            if (!inputData?.[1]?.multiline) {
                return result;
            }
            if (!shouldBind(node, inputName, inputData[1])) {
                return result;
            }
            const element = resolveTextareaElement(result.widget);
            if (!element || element.dataset.tagcompleteBound === "true") {
                return result;
            }
            new TagCompleteTextArea(element, result.widget, node, inputName, inputData[1]);
            return result;
        };
    },
});
