"use client";

import Image from "next/image";
import {
  ChangeEvent,
  FormEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type ElementFound = {
  name: string;
  page: number;
  evidence?: string | null;
  value?: string | null;
  value_position?: string | null;
  right_text?: string | null;
  below_text?: string | null;
  anchor_text?: string | null;
  target_text?: string | null;
  target_right_text?: string | null;
  target_below_text?: string | null;
  lines_below?: string | null;
};

type AnalyzeResponse = {
  document_id: string;
  item: string;
  item_auto_detected: boolean;
  score: number;
  valid: boolean;
  variant_detected: string | null;
  variant_score: number;
  threshold: number;
  matched_weight_sum: number;
  total_weight_sum: number;
  missing_elements: string[];
  elements_found: ElementFound[];
  ocr_used: boolean;
  ocr_mode_requested: "auto" | "native" | "ocr";
  ocr_mode_applied: "native" | "ocr";
  ocr_attempted: boolean;
  ocr_blocks_count: number;
  native_text_length: number;
  ocr_error?: string | null;
  processing_time_ms: number;
  document_type: "pdf" | "excel";
  excel_pairs_preview: string[];
};

type AnalyzeBatchResult = {
  filename?: string | null;
  document_type: "pdf" | "excel";
  item_requested?: string | null;
  success: boolean;
  error?: string | null;
  analysis?: AnalyzeResponse | null;
};

type AnalyzeBatchResponse = {
  results: AnalyzeBatchResult[];
  total_count: number;
  success_count: number;
  error_count: number;
};

type DocumentType = "pdf" | "excel";

type Tab = "analyze" | "settings" | "training";
type ConfigKind = "item" | "template" | "global";
type SettingsEditorTab = "required_elements" | "ocr_relative" | "variants";

type RequiredElement = {
  name: string;
  weight: number;
  pages?: string;
  strategy?: "keyword" | "relative_anchor";
  anchor?: {
    keyword?: string;
    occurrence?: number;
  };
  move?: {
    lines_below?: number;
    tolerance?: number;
  };
  target?: {
    keyword?: string;
    mode?: "contains" | "exact" | "regex";
  };
};

type VariantSignature = {
  name: string;
  page_count: number;
  dominant_keywords: string[];
  table_presence: boolean;
  title_patterns: string[];
};

type OcrRelativeRegion = {
  name: string;
  pages?: string;
  x_pct: number;
  y_pct: number;
  width_pct: number;
  height_pct: number;
  margin_pct?: number;
  anchor_text?: string;
  anchor_mode?: "contains" | "exact" | "regex";
  anchor_search_radius_pct?: number;
  notes?: string;
};

type ItemConfig = {
  item: string;
  language: string;
  template: string;
  threshold: number;
  variant_required?: boolean;
  required_elements: RequiredElement[];
  ocr_regions?: OcrRelativeRegion[];
  variants: string[];
  variant_signatures: VariantSignature[];
  audit?: {
    sample_count?: number;
    page_distribution?: Record<string, number>;
    document_type?: "pdf" | "excel";
    excel_header_axis?: "first_row" | "first_column" | null;
    excel_pairs_preview?: string[];
  };
};

type TrainingBuildResponse = {
  status: string;
  item: string;
  saved_to: string;
  config: ItemConfig;
};

type RectDraft = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type DecimalInputProps = {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  className?: string;
};

type RelativeOverlayRect = {
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
};

type OcrRegionResizeHandle = "nw" | "ne" | "sw" | "se";

type ActiveOcrRegionEdit = {
  pointerId: number;
  regionIndex: number;
  mode: "move" | OcrRegionResizeHandle;
  startX: number;
  startY: number;
  initialRect: RelativeOverlayRect;
  marginPct: number;
};

function formatDecimalInputValue(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "";
  return String(value);
}

function parseDecimalInputValue(raw: string): number | null {
  const normalized = raw.replace(",", ".").trim();
  if (!normalized || normalized === "." || normalized === "-" || normalized === "-.") {
    return null;
  }
  const nextValue = Number(normalized);
  return Number.isFinite(nextValue) ? nextValue : null;
}

function clampDecimalInputValue(value: number, min?: number, max?: number): number {
  let nextValue = value;
  if (typeof min === "number") {
    nextValue = Math.max(min, nextValue);
  }
  if (typeof max === "number") {
    nextValue = Math.min(max, nextValue);
  }
  return nextValue;
}

function DecimalInput({ value, onValueChange, min, max, className }: DecimalInputProps) {
  const [draft, setDraft] = useState(() => formatDecimalInputValue(value));
  const [isFocused, setIsFocused] = useState(false);
  const displayValue = isFocused ? draft : formatDecimalInputValue(value);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={displayValue}
      onFocus={() => setIsFocused(true)}
      onChange={(e) => {
        const rawValue = e.target.value;
        setDraft(rawValue);
        const parsedValue = parseDecimalInputValue(rawValue);
        if (parsedValue === null) return;
        onValueChange(clampDecimalInputValue(parsedValue, min, max));
      }}
      onBlur={() => {
        setIsFocused(false);
        const parsedValue = parseDecimalInputValue(draft);
        if (parsedValue === null) {
          setDraft(formatDecimalInputValue(value));
          return;
        }
        const nextValue = clampDecimalInputValue(parsedValue, min, max);
        onValueChange(nextValue);
        setDraft(formatDecimalInputValue(nextValue));
      }}
      className={className}
    />
  );
}

function parsePagesValue(value: string | undefined): Set<number> {
  if (!value) return new Set();
  const pages = new Set<number>();
  for (const rawChunk of value.replaceAll(";", ",").split(",")) {
    const chunk = rawChunk.trim();
    if (!chunk) continue;
    if (chunk.includes("-")) {
      const [leftRaw, rightRaw] = chunk.split("-", 2);
      const left = Number(leftRaw);
      const right = Number(rightRaw);
      if (!Number.isInteger(left) || !Number.isInteger(right) || left <= 0 || right <= 0) continue;
      const start = Math.min(left, right);
      const end = Math.max(left, right);
      for (let page = start; page <= end; page += 1) {
        pages.add(page);
      }
      continue;
    }
    const page = Number(chunk);
    if (Number.isInteger(page) && page > 0) {
      pages.add(page);
    }
  }
  return pages;
}

function regionAppliesToPage(region: OcrRelativeRegion, page: number): boolean {
  const pages = parsePagesValue(region.pages);
  return pages.size === 0 || pages.has(page);
}

function buildRegionOverlayRect(region: OcrRelativeRegion, extraMarginPct: number): RelativeOverlayRect {
  const totalMargin = Math.max(0, region.margin_pct ?? 0) + Math.max(0, extraMarginPct);
  const leftPct = Math.max(0, region.x_pct - totalMargin);
  const topPct = Math.max(0, region.y_pct - totalMargin);
  const rightPct = Math.min(100, region.x_pct + region.width_pct + totalMargin);
  const bottomPct = Math.min(100, region.y_pct + region.height_pct + totalMargin);
  return {
    leftPct,
    topPct,
    widthPct: Math.max(0, rightPct - leftPct),
    heightPct: Math.max(0, bottomPct - topPct),
  };
}

function roundPct(value: number): number {
  return Number(value.toFixed(2));
}

function regionFromReadingRect(rect: RelativeOverlayRect, marginPct: number): Pick<
  OcrRelativeRegion,
  "x_pct" | "y_pct" | "width_pct" | "height_pct"
> {
  const xPct = clampDecimalInputValue(rect.leftPct + marginPct, 0, 100);
  const yPct = clampDecimalInputValue(rect.topPct + marginPct, 0, 100);
  const rightPct = clampDecimalInputValue(rect.leftPct + rect.widthPct - marginPct, xPct, 100);
  const bottomPct = clampDecimalInputValue(rect.topPct + rect.heightPct - marginPct, yPct, 100);
  return {
    x_pct: roundPct(xPct),
    y_pct: roundPct(yPct),
    width_pct: roundPct(Math.max(0.1, rightPct - xPct)),
    height_pct: roundPct(Math.max(0.1, bottomPct - yPct)),
  };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Impossible de lire le fichier"));
    reader.readAsDataURL(file);
  });
}

function detectDocumentType(file: File): DocumentType | null {
  const fileName = (file.name || "").toLowerCase();
  if (fileName.endsWith(".pdf")) return "pdf";
  if (fileName.endsWith(".xlsx") || fileName.endsWith(".xlsm")) return "excel";

  const mime = (file.type || "").toLowerCase();
  if (mime === "application/pdf") return "pdf";
  if (
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "application/vnd.ms-excel.sheet.macroenabled.12"
  ) {
    return "excel";
  }
  return null;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.detail || "Request failed");
  }
  return body as T;
}

function emptyItemConfig(itemName: string): ItemConfig {
  return {
    item: itemName,
    language: "fr",
    template: "contract",
    threshold: 0.7,
    variant_required: true,
    required_elements: [],
    ocr_regions: [],
    variants: [],
    variant_signatures: [],
  };
}

function triggerDownload(content: BlobPart, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("analyze");

  const [items, setItems] = useState<string[]>(["contrat_assurance_vie"]);
  const [templates, setTemplates] = useState<string[]>([]);

  const [item, setItem] = useState("contrat_assurance_vie");
  const [analyzeOcrMode, setAnalyzeOcrMode] = useState<"auto" | "native" | "ocr">("auto");
  const [analyzeExcelHeaderAxis, setAnalyzeExcelHeaderAxis] =
    useState<"first_row" | "first_column">("first_row");
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState<{
    current: number;
    total: number;
    phase: "encoding" | "processing";
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [batchResult, setBatchResult] = useState<AnalyzeBatchResponse | null>(null);
  const [selectedBatchIndex, setSelectedBatchIndex] = useState(0);
  const [analyzeDetectItem, setAnalyzeDetectItem] = useState(true);
  const [analyzeTrace, setAnalyzeTrace] = useState<string[]>([]);
  const [showAnalyzeTrace, setShowAnalyzeTrace] = useState(false);
  const [showAnalyzeDetectedFields, setShowAnalyzeDetectedFields] = useState(false);
  const [showAnalyzeDebug, setShowAnalyzeDebug] = useState(false);

  const [configKind, setConfigKind] = useState<ConfigKind>("item");
  const [configName, setConfigName] = useState("contrat_assurance_vie");
  const [configText, setConfigText] = useState("{}");
  const [configMessage, setConfigMessage] = useState<string | null>(null);
  const [configBusy, setConfigBusy] = useState(false);
  const [showAdvancedConfig, setShowAdvancedConfig] = useState(false);

  const [guidedItemName, setGuidedItemName] = useState("contrat_assurance_vie");
  const [guidedItemConfig, setGuidedItemConfig] = useState<ItemConfig | null>(null);
  const [guidedBusy, setGuidedBusy] = useState(false);
  const [guidedMessage, setGuidedMessage] = useState<string | null>(null);
  const [guidedMessageTone, setGuidedMessageTone] = useState<"success" | "error" | "info">("info");
  const [showConfigHelp, setShowConfigHelp] = useState(false);
  const [settingsEditorTab, setSettingsEditorTab] =
    useState<SettingsEditorTab>("required_elements");
  const [duplicateItemName, setDuplicateItemName] = useState("");
  const [ocrCalibrationFile, setOcrCalibrationFile] = useState<File | null>(null);
  const [ocrCalibrationPage, setOcrCalibrationPage] = useState(1);
  const [ocrCalibrationPageCount, setOcrCalibrationPageCount] = useState(0);
  const [ocrCalibrationImageUrl, setOcrCalibrationImageUrl] = useState<string | null>(null);
  const [ocrCalibrationBusy, setOcrCalibrationBusy] = useState(false);
  const [ocrCalibrationError, setOcrCalibrationError] = useState<string | null>(null);
  const [ocrCalibrationDraft, setOcrCalibrationDraft] = useState<RectDraft | null>(null);
  const [ocrCalibrationStart, setOcrCalibrationStart] = useState<{ x: number; y: number } | null>(null);
  const [ocrCalibrationPointerId, setOcrCalibrationPointerId] = useState<number | null>(null);
  const [selectedOcrRegionIndex, setSelectedOcrRegionIndex] = useState<number | null>(null);
  const [activeOcrRegionEdit, setActiveOcrRegionEdit] = useState<ActiveOcrRegionEdit | null>(null);
  const [pendingOcrRegionFocusIndex, setPendingOcrRegionFocusIndex] = useState<number | null>(null);
  const calibrationImageRef = useRef<HTMLImageElement | null>(null);
  const calibrationCanvasRef = useRef<HTMLDivElement | null>(null);
  const ocrRegionNameInputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const [trainingItem, setTrainingItem] = useState("nouvel_item");
  const [trainingExcelHeaderAxis, setTrainingExcelHeaderAxis] =
    useState<"first_row" | "first_column">("first_row");
  const [trainingFiles, setTrainingFiles] = useState<File[]>([]);
  const [trainingBusy, setTrainingBusy] = useState(false);
  const [trainingMessage, setTrainingMessage] = useState<string | null>(null);
  const [trainingTrace, setTrainingTrace] = useState<string[]>([]);
  const [trainingResult, setTrainingResult] = useState<TrainingBuildResponse | null>(null);
  const [showTrainingResult, setShowTrainingResult] = useState(false);
  const [showTrainingDebug, setShowTrainingDebug] = useState(false);
  const trainingInputRef = useRef<HTMLInputElement | null>(null);
  const selectedBatchEntry =
    batchResult && batchResult.results[selectedBatchIndex] ? batchResult.results[selectedBatchIndex] : null;
  const selectedAnalysis = selectedBatchEntry?.analysis || result;
  const calibrationVisibleRegions = useMemo(() => {
    if (!guidedItemConfig?.ocr_regions) return [];
    return guidedItemConfig.ocr_regions
      .map((region, regionIndex) => ({
        region,
        regionIndex,
      }))
      .filter(({ region }) => regionAppliesToPage(region, ocrCalibrationPage))
      .map(({ region, regionIndex }) => ({
        region,
        regionIndex,
        readingRect: buildRegionOverlayRect(region, 0),
        searchRect: buildRegionOverlayRect(region, region.anchor_search_radius_pct ?? 0),
      }));
  }, [guidedItemConfig?.ocr_regions, ocrCalibrationPage]);

  const scorePercent = useMemo(() => {
    if (!selectedAnalysis) return 0;
    return Math.round(selectedAnalysis.score * 100);
  }, [selectedAnalysis]);

  const refreshLists = useCallback(async () => {
    const itemResp = await fetchJson<{ items: string[] }>(
      "/api/document-engine/config/items",
    );
    const templateResp = await fetchJson<{ templates: string[] }>(
      "/api/document-engine/config/templates",
    );
    setItems(itemResp.items);
    setTemplates(templateResp.templates);
    if (itemResp.items.length > 0 && !itemResp.items.includes(item)) {
      setItem(itemResp.items[0]);
    }
  }, [item]);

  useEffect(() => {
    refreshLists().catch(() => undefined);
  }, [refreshLists]);

  useEffect(() => {
    if (pendingOcrRegionFocusIndex === null) return;
    const input = ocrRegionNameInputRefs.current[pendingOcrRegionFocusIndex];
    if (!input) return;
    input.focus();
    input.select();
    setPendingOcrRegionFocusIndex(null);
  }, [guidedItemConfig, pendingOcrRegionFocusIndex]);

  useEffect(() => {
    if (items.length > 0 && !items.includes(guidedItemName)) {
      setGuidedItemName(items[0]);
    }
  }, [items, guidedItemName]);

  useEffect(() => {
    if (configKind === "global") {
      setConfigName("rules");
      return;
    }

    const pool = configKind === "template" ? templates : items;
    if (pool.length === 0) return;
    if (!pool.includes(configName)) {
      setConfigName(pool[0]);
    }
  }, [configKind, configName, items, templates]);

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFiles = Array.from(event.target.files || []);
    const unsupported = nextFiles.find((nextFile) => detectDocumentType(nextFile) === null);
    if (unsupported) {
      setFiles([]);
      setAnalyzeProgress(null);
      setError("Formats supportés: PDF, XLSX, XLSM.");
      setResult(null);
      setBatchResult(null);
      setAnalyzeTrace([]);
      return;
    }
    setFiles(nextFiles);
    if (nextFiles.length > 0 && nextFiles.every((nextFile) => detectDocumentType(nextFile) === "excel")) {
      setAnalyzeOcrMode("native");
    }
    setResult(null);
    setBatchResult(null);
    setAnalyzeProgress(null);
    setError(null);
    setAnalyzeTrace([]);
    setShowAnalyzeTrace(false);
    setShowAnalyzeDetectedFields(false);
    setShowAnalyzeDebug(false);
    setSelectedBatchIndex(0);
  };

  const pushAnalyzeTrace = (message: string) => {
    const stamp = new Date().toISOString().slice(11, 19);
    setAnalyzeTrace((prev) => [...prev, `[${stamp}] ${message}`]);
  };

  const onAnalyzeSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setResult(null);
    setBatchResult(null);
    setAnalyzeProgress(null);
    setAnalyzeTrace([]);
    setShowAnalyzeTrace(true);
    setShowAnalyzeDetectedFields(false);
    setShowAnalyzeDebug(false);
    pushAnalyzeTrace("Début de l'analyse");

    if (files.length === 0) {
      pushAnalyzeTrace("Validation échouée: aucun fichier sélectionné");
      setError("Sélectionne au moins un fichier (PDF ou Excel) avant de lancer l'analyse.");
      setShowAnalyzeTrace(false);
      return;
    }

    const documentTypes = files.map((entry) => detectDocumentType(entry));
    if (documentTypes.some((entry) => !entry)) {
      pushAnalyzeTrace("Validation échouée: au moins un fichier est dans un format invalide");
      setError("Tous les fichiers doivent être en PDF, XLSX ou XLSM.");
      setShowAnalyzeTrace(false);
      return;
    }

    if (documentTypes.every((entry) => entry === "excel") && analyzeOcrMode === "ocr") {
      setAnalyzeOcrMode("auto");
    }

    pushAnalyzeTrace(`Validation OK: ${files.length} fichier(s)`);
    setLoading(true);
    setAnalyzeProgress({ current: 0, total: files.length, phase: "encoding" });
    try {
      pushAnalyzeTrace("Encodage Base64 des fichiers");
      const encodedFiles: string[] = [];
      for (let idx = 0; idx < files.length; idx += 1) {
        const currentType = documentTypes[idx] as DocumentType;
        setAnalyzeProgress({ current: idx + 1, total: files.length, phase: "encoding" });
        pushAnalyzeTrace(`Encodage ${idx + 1}/${files.length}: ${files[idx].name} (${currentType})`);
        encodedFiles.push(await fileToBase64(files[idx]));
      }
      const modeToSend = analyzeOcrMode;
      pushAnalyzeTrace(
        `Envoi au backend (${files.length} fichier(s), mode: ${modeToSend}, item=${analyzeDetectItem ? "auto-détection" : item})`,
      );
      const batchEntries: AnalyzeBatchResult[] = [];
      let successCount = 0;
      for (let idx = 0; idx < encodedFiles.length; idx += 1) {
        const currentFile = files[idx];
        const currentType = documentTypes[idx] as DocumentType;
        setAnalyzeProgress({ current: idx, total: encodedFiles.length, phase: "processing" });
        pushAnalyzeTrace(`Traitement backend ${idx + 1}/${encodedFiles.length}: ${currentFile.name}`);
        const partialBody = await fetchJson<AnalyzeBatchResponse>(
          "/api/document-engine/analyze-batch",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              item: analyzeDetectItem ? null : item,
              detect_item: analyzeDetectItem,
              filenames: [currentFile.name],
              documents: [encodedFiles[idx]],
              document_types: [currentType],
              ocr_mode: modeToSend,
              excel_header_axis: analyzeExcelHeaderAxis,
            }),
          },
        );
        const partialResult = partialBody.results[0];
        batchEntries.push(partialResult);
        if (partialResult?.success) {
          successCount += 1;
        }
        setAnalyzeProgress({ current: idx + 1, total: encodedFiles.length, phase: "processing" });
        pushAnalyzeTrace(
          partialResult?.success
            ? `Terminé ${idx + 1}/${encodedFiles.length}: ${currentFile.name}`
            : `Échec ${idx + 1}/${encodedFiles.length}: ${currentFile.name}`,
        );
      }
      const body: AnalyzeBatchResponse = {
        results: batchEntries,
        total_count: batchEntries.length,
        success_count: successCount,
        error_count: batchEntries.length - successCount,
      };
      pushAnalyzeTrace("Réponse backend reçue");
      pushAnalyzeTrace(
        `Synthèse: ${body.success_count} succès, ${body.error_count} erreur(s), ${body.total_count} fichier(s) traités`,
      );
      const firstSuccessIndex = body.results.findIndex((entry) => entry.success && entry.analysis);
      setSelectedBatchIndex(firstSuccessIndex >= 0 ? firstSuccessIndex : 0);
      setBatchResult(body);
      setResult(firstSuccessIndex >= 0 ? body.results[firstSuccessIndex].analysis || null : null);
    } catch (err) {
      pushAnalyzeTrace(
        `Erreur attrapée: ${err instanceof Error ? err.message : "Erreur inconnue"}`,
      );
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      pushAnalyzeTrace("Fin de l'analyse");
      setAnalyzeProgress(null);
      setShowAnalyzeTrace(false);
      setLoading(false);
    }
  };

  const loadConfig = async () => {
    setConfigBusy(true);
    setConfigMessage(null);
    try {
      let body: { config: unknown };
      if (configKind === "global") {
        body = await fetchJson<{ config: unknown }>(
          "/api/document-engine/config/global-rules",
        );
      } else if (configKind === "template") {
        body = await fetchJson<{ config: unknown }>(
          `/api/document-engine/config/templates/${configName}`,
        );
      } else {
        body = await fetchJson<{ config: unknown }>(
          `/api/document-engine/config/items/${configName}`,
        );
      }
      setConfigText(JSON.stringify(body.config, null, 2));
      setConfigMessage("Configuration chargée.");
    } catch (err) {
      setConfigMessage(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setConfigBusy(false);
    }
  };

  const saveConfig = async () => {
    setConfigBusy(true);
    setConfigMessage(null);
    try {
      const payload = JSON.parse(configText);
      if (configKind === "global") {
        await fetchJson("/api/document-engine/config/global-rules", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payload }),
        });
      } else if (configKind === "template") {
        await fetchJson(`/api/document-engine/config/templates/${configName}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payload }),
        });
      } else {
        await fetchJson(`/api/document-engine/config/items/${configName}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payload }),
        });
        await refreshLists();
      }
      setConfigMessage("Configuration sauvegardée.");
    } catch (err) {
      setConfigMessage(err instanceof Error ? err.message : "Erreur de sauvegarde");
    } finally {
      setConfigBusy(false);
    }
  };

  const loadGuidedItem = async (targetItem: string = guidedItemName) => {
    setGuidedBusy(true);
    setGuidedMessage(null);
    setGuidedMessageTone("info");
    try {
      const body = await fetchJson<{ config: ItemConfig }>(
        `/api/document-engine/config/items/${targetItem}`,
      );
      const cfg = body.config;
      cfg.required_elements = (cfg.required_elements || []).map((entry) => ({
        ...entry,
        strategy: entry.strategy || "keyword",
      }));
      cfg.ocr_regions = cfg.ocr_regions || [];
      cfg.variant_required = cfg.variant_required ?? true;
      cfg.variant_signatures = cfg.variant_signatures || [];
      cfg.variants = cfg.variants || [];
      setGuidedItemConfig(cfg);
      setGuidedMessage("Item chargé.");
    } catch {
      const fresh = emptyItemConfig(targetItem);
      setGuidedItemConfig(fresh);
      setGuidedMessage("Item inexistant: nouveau brouillon initialisé.");
    } finally {
      setGuidedBusy(false);
    }
  };

  const saveGuidedItem = async () => {
    if (!guidedItemConfig) return;
    setGuidedBusy(true);
    setGuidedMessage(null);
    setGuidedMessageTone("info");
    try {
      const payload: ItemConfig = {
        ...guidedItemConfig,
        item: guidedItemName,
        variants: guidedItemConfig.variant_signatures.map((v) => v.name),
      };
      await fetchJson(`/api/document-engine/config/items/${guidedItemName}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload }),
      });
      await refreshLists();
      setGuidedMessage("Item sauvegardé.");
      setGuidedMessageTone("success");
    } catch (err) {
      setGuidedMessage(err instanceof Error ? err.message : "Erreur de sauvegarde");
      setGuidedMessageTone("error");
    } finally {
      setGuidedBusy(false);
    }
  };

  const duplicateGuidedItem = async () => {
    if (!guidedItemConfig) return;
    const nextItemName = duplicateItemName.trim();
    if (!nextItemName) {
      setGuidedMessage("Renseigne un nom d'item pour la duplication.");
      setGuidedMessageTone("error");
      return;
    }

    setGuidedBusy(true);
    setGuidedMessage(null);
    setGuidedMessageTone("info");
    try {
      const payload: ItemConfig = {
        ...guidedItemConfig,
        item: nextItemName,
        variants: guidedItemConfig.variant_signatures.map((v) => v.name),
      };
      await fetchJson(`/api/document-engine/config/items/${nextItemName}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload }),
      });
      await refreshLists();
      setGuidedItemName(nextItemName);
      setGuidedItemConfig(payload);
      setDuplicateItemName("");
      setGuidedMessage(`Item dupliqué vers '${nextItemName}'.`);
      setGuidedMessageTone("success");
    } catch (err) {
      setGuidedMessage(err instanceof Error ? err.message : "Erreur de duplication");
      setGuidedMessageTone("error");
    } finally {
      setGuidedBusy(false);
    }
  };

  const deleteGuidedItem = async () => {
    if (!guidedItemName) return;
    if (!window.confirm(`Supprimer définitivement l'item '${guidedItemName}' ?`)) {
      return;
    }

    setGuidedBusy(true);
    setGuidedMessage(null);
    setGuidedMessageTone("info");
    try {
      const deletedItemName = guidedItemName;
      await fetchJson(`/api/document-engine/config/items/${guidedItemName}`, {
        method: "DELETE",
      });
      await refreshLists();
      const remainingItems = items.filter((name) => name !== guidedItemName);
      const nextItemName = remainingItems[0] || "nouvel_item";
      setGuidedItemName(nextItemName);
      if (remainingItems.length > 0) {
        await loadGuidedItem(nextItemName);
      } else {
        setGuidedItemConfig(emptyItemConfig(nextItemName));
      }
      setGuidedMessage(`Item '${deletedItemName}' supprimé.`);
      setGuidedMessageTone("success");
    } catch (err) {
      setGuidedMessage(err instanceof Error ? err.message : "Erreur de suppression");
      setGuidedMessageTone("error");
    } finally {
      setGuidedBusy(false);
    }
  };

  const onTrainingFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []).filter((f) => detectDocumentType(f) !== null);
    setTrainingFiles(files);
  };

  const clearTrainingFiles = () => {
    setTrainingFiles([]);
    if (trainingInputRef.current) {
      trainingInputRef.current.value = "";
    }
  };

  useEffect(() => {
    return () => {
      if (ocrCalibrationImageUrl) {
        URL.revokeObjectURL(ocrCalibrationImageUrl);
      }
    };
  }, [ocrCalibrationImageUrl]);

  const loadOcrCalibrationPreview = useCallback(
    async (file: File, page: number) => {
      setOcrCalibrationBusy(true);
      setOcrCalibrationError(null);
      setOcrCalibrationDraft(null);
      setOcrCalibrationStart(null);
      try {
        const document = await fileToBase64(file);
        const response = await fetch("/api/document-engine/training/render-pdf-page", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ document, page }),
        });
        if (!response.ok) {
          const body = await response.text();
          throw new Error(body || "Impossible de générer l'aperçu PDF");
        }
        const nextPageCount = Number(response.headers.get("X-Page-Count") || "0");
        const nextPageNumber = Number(response.headers.get("X-Page-Number") || String(page));
        const blob = await response.blob();
        const nextUrl = URL.createObjectURL(blob);
        setOcrCalibrationImageUrl((previous) => {
          if (previous) {
            URL.revokeObjectURL(previous);
          }
          return nextUrl;
        });
        setOcrCalibrationPageCount(nextPageCount);
        setOcrCalibrationPage(nextPageNumber);
      } catch (err) {
        setOcrCalibrationError(err instanceof Error ? err.message : "Erreur de preview PDF");
      } finally {
        setOcrCalibrationBusy(false);
      }
    },
    [],
  );

  const onOcrCalibrationFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = (event.target.files || [])[0] || null;
    setOcrCalibrationFile(file);
    setOcrCalibrationImageUrl((previous) => {
      if (previous) {
        URL.revokeObjectURL(previous);
      }
      return null;
    });
    setOcrCalibrationPage(1);
    setOcrCalibrationPageCount(0);
    setOcrCalibrationDraft(null);
    setOcrCalibrationStart(null);
    setSelectedOcrRegionIndex(null);
    setActiveOcrRegionEdit(null);
    setOcrCalibrationError(null);
    if (!file) {
      return;
    }
    if (detectDocumentType(file) !== "pdf") {
      setOcrCalibrationError("La calibration visuelle OCR ne supporte que les PDF.");
      return;
    }
    await loadOcrCalibrationPreview(file, 1);
  };

  const goToOcrCalibrationPage = async (page: number) => {
    if (!ocrCalibrationFile || ocrCalibrationBusy) return;
    setSelectedOcrRegionIndex(null);
    setActiveOcrRegionEdit(null);
    await loadOcrCalibrationPreview(ocrCalibrationFile, page);
  };

  const relativePointFromClient = (clientX: number, clientY: number) => {
    const container = calibrationCanvasRef.current?.getBoundingClientRect();
    if (!container) return null;
    const x = Math.max(0, Math.min(container.width, clientX - container.left));
    const y = Math.max(0, Math.min(container.height, clientY - container.top));
    return { x, y, width: container.width, height: container.height };
  };

  const relativePointFromPointerEvent = (event: ReactPointerEvent<HTMLDivElement>) => {
    const container = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(container.width, event.clientX - container.left));
    const y = Math.max(0, Math.min(container.height, event.clientY - container.top));
    return { x, y, width: container.width, height: container.height };
  };

  const updateOcrRegionAtIndex = useCallback(
    (regionIndex: number, updater: (region: OcrRelativeRegion) => OcrRelativeRegion) => {
      setGuidedItemConfig((current) => {
        if (!current?.ocr_regions || !current.ocr_regions[regionIndex]) return current;
        const nextRegions = [...current.ocr_regions];
        nextRegions[regionIndex] = updater(nextRegions[regionIndex]);
        return {
          ...current,
          ocr_regions: nextRegions,
        };
      });
    },
    [],
  );

  const stopOcrCalibrationSelection = useCallback((event?: ReactPointerEvent<HTMLDivElement>) => {
    if (event && ocrCalibrationPointerId !== null && event.currentTarget.hasPointerCapture(ocrCalibrationPointerId)) {
      event.currentTarget.releasePointerCapture(ocrCalibrationPointerId);
    }
    if (event && activeOcrRegionEdit && event.currentTarget.hasPointerCapture(activeOcrRegionEdit.pointerId)) {
      event.currentTarget.releasePointerCapture(activeOcrRegionEdit.pointerId);
    }
    setOcrCalibrationPointerId(null);
    setOcrCalibrationStart(null);
    setActiveOcrRegionEdit(null);
  }, [activeOcrRegionEdit, ocrCalibrationPointerId]);

  const beginOcrCalibrationSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activeOcrRegionEdit) return;
    if (event.button !== 0) return;
    event.preventDefault();
    const point = relativePointFromPointerEvent(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    setOcrCalibrationPointerId(event.pointerId);
    setOcrCalibrationStart({ x: point.x, y: point.y });
    setOcrCalibrationDraft({ x: point.x, y: point.y, width: 0, height: 0 });
  };

  const updateOcrCalibrationSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activeOcrRegionEdit) {
      if (activeOcrRegionEdit.pointerId !== event.pointerId) return;
      event.preventDefault();
      const point = relativePointFromClient(event.clientX, event.clientY);
      if (!point) return;
      const deltaXPct = (point.x - activeOcrRegionEdit.startX) / point.width * 100;
      const deltaYPct = (point.y - activeOcrRegionEdit.startY) / point.height * 100;
      const initialLeft = activeOcrRegionEdit.initialRect.leftPct;
      const initialTop = activeOcrRegionEdit.initialRect.topPct;
      const initialRight = activeOcrRegionEdit.initialRect.leftPct + activeOcrRegionEdit.initialRect.widthPct;
      const initialBottom = activeOcrRegionEdit.initialRect.topPct + activeOcrRegionEdit.initialRect.heightPct;
      const minWidthPct = Math.max(0.5, activeOcrRegionEdit.marginPct * 2 + 0.1);
      const minHeightPct = Math.max(0.5, activeOcrRegionEdit.marginPct * 2 + 0.1);

      let nextLeft = initialLeft;
      let nextTop = initialTop;
      let nextRight = initialRight;
      let nextBottom = initialBottom;

      if (activeOcrRegionEdit.mode === "move") {
        nextLeft = clampDecimalInputValue(initialLeft + deltaXPct, 0, 100 - activeOcrRegionEdit.initialRect.widthPct);
        nextTop = clampDecimalInputValue(initialTop + deltaYPct, 0, 100 - activeOcrRegionEdit.initialRect.heightPct);
        nextRight = nextLeft + activeOcrRegionEdit.initialRect.widthPct;
        nextBottom = nextTop + activeOcrRegionEdit.initialRect.heightPct;
      } else {
        if (activeOcrRegionEdit.mode === "nw" || activeOcrRegionEdit.mode === "sw") {
          nextLeft = clampDecimalInputValue(initialLeft + deltaXPct, 0, initialRight - minWidthPct);
        }
        if (activeOcrRegionEdit.mode === "ne" || activeOcrRegionEdit.mode === "se") {
          nextRight = clampDecimalInputValue(initialRight + deltaXPct, initialLeft + minWidthPct, 100);
        }
        if (activeOcrRegionEdit.mode === "nw" || activeOcrRegionEdit.mode === "ne") {
          nextTop = clampDecimalInputValue(initialTop + deltaYPct, 0, initialBottom - minHeightPct);
        }
        if (activeOcrRegionEdit.mode === "sw" || activeOcrRegionEdit.mode === "se") {
          nextBottom = clampDecimalInputValue(initialBottom + deltaYPct, initialTop + minHeightPct, 100);
        }
      }

      const nextRect = {
        leftPct: roundPct(nextLeft),
        topPct: roundPct(nextTop),
        widthPct: roundPct(nextRight - nextLeft),
        heightPct: roundPct(nextBottom - nextTop),
      };
      updateOcrRegionAtIndex(activeOcrRegionEdit.regionIndex, (region) => ({
        ...region,
        ...regionFromReadingRect(nextRect, activeOcrRegionEdit.marginPct),
      }));
      return;
    }
    if (!ocrCalibrationStart || ocrCalibrationPointerId !== event.pointerId) return;
    event.preventDefault();
    const point = relativePointFromPointerEvent(event);
    const nextX = Math.min(ocrCalibrationStart.x, point.x);
    const nextY = Math.min(ocrCalibrationStart.y, point.y);
    const nextWidth = Math.abs(point.x - ocrCalibrationStart.x);
    const nextHeight = Math.abs(point.y - ocrCalibrationStart.y);
    setOcrCalibrationDraft({
      x: nextX,
      y: nextY,
      width: nextWidth,
      height: nextHeight,
    });
  };

  const beginOcrRegionEdit = (
    event: ReactPointerEvent<HTMLDivElement>,
    regionIndex: number,
    rect: RelativeOverlayRect,
    marginPct: number,
    mode: ActiveOcrRegionEdit["mode"],
  ) => {
    if (event.button !== 0) return;
    const point = relativePointFromClient(event.clientX, event.clientY);
    if (!point || !calibrationCanvasRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    calibrationCanvasRef.current.setPointerCapture(event.pointerId);
    setSelectedOcrRegionIndex(regionIndex);
    setOcrCalibrationDraft(null);
    setOcrCalibrationStart(null);
    setOcrCalibrationPointerId(null);
    setActiveOcrRegionEdit({
      pointerId: event.pointerId,
      regionIndex,
      mode,
      startX: point.x,
      startY: point.y,
      initialRect: rect,
      marginPct,
    });
  };

  const appendOcrRegion = (region: OcrRelativeRegion) => {
    if (!guidedItemConfig) return;
    const nextRegions = [...(guidedItemConfig.ocr_regions || []), region];
    setGuidedItemConfig({
      ...guidedItemConfig,
      ocr_regions: nextRegions,
    });
    setPendingOcrRegionFocusIndex(nextRegions.length - 1);
  };

  const addCalibrationDraftToRegions = () => {
    if (!guidedItemConfig || !ocrCalibrationDraft || !calibrationImageRef.current) return;
    const rect = calibrationImageRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const xPct = Number(((ocrCalibrationDraft.x / rect.width) * 100).toFixed(2));
    const yPct = Number(((ocrCalibrationDraft.y / rect.height) * 100).toFixed(2));
    const widthPct = Number(((ocrCalibrationDraft.width / rect.width) * 100).toFixed(2));
    const heightPct = Number(((ocrCalibrationDraft.height / rect.height) * 100).toFixed(2));
    appendOcrRegion({
      name: `zone_ocr_p${ocrCalibrationPage}`,
      pages: String(ocrCalibrationPage),
      x_pct: xPct,
      y_pct: yPct,
      width_pct: widthPct,
      height_pct: heightPct,
      margin_pct: 2,
      anchor_text: "",
      anchor_mode: "contains",
      anchor_search_radius_pct: 0,
      notes: "",
    });
    setOcrCalibrationDraft(null);
    setOcrCalibrationStart(null);
  };

  const pushTrainingTrace = (message: string) => {
    const stamp = new Date().toISOString().slice(11, 19);
    setTrainingTrace((prev) => [...prev, `[${stamp}] ${message}`]);
  };

  const runTraining = async () => {
    setTrainingBusy(true);
    setTrainingMessage(null);
    setTrainingTrace([]);
    setTrainingResult(null);
    setShowTrainingResult(false);
    setShowTrainingDebug(false);
    try {
      pushTrainingTrace("Début du training");
      if (trainingFiles.length < 3) {
        pushTrainingTrace(`Validation échouée: ${trainingFiles.length} document(s) fourni(s)`);
        throw new Error("Ajoute au moins 3 documents (idéalement 5 à 10).");
      }
      const types = new Set(trainingFiles.map((f) => detectDocumentType(f)));
      if (types.has(null)) {
        throw new Error("Un ou plusieurs fichiers sont dans un format non supporté.");
      }
      if (types.size > 1) {
        throw new Error("Mélange interdit: en training, utilise uniquement PDF ou uniquement Excel.");
      }
      const documentType = Array.from(types)[0] as DocumentType;
      pushTrainingTrace(`Validation OK: ${trainingFiles.length} document(s) (${documentType})`);
      if (documentType === "excel") {
        pushTrainingTrace(
          `Paramètre Excel: intitulés en ${trainingExcelHeaderAxis === "first_row" ? "première ligne" : "première colonne"}`,
        );
      }

      const docs: string[] = [];
      for (let i = 0; i < trainingFiles.length; i += 1) {
        const file = trainingFiles[i];
        pushTrainingTrace(`Encodage fichier ${i + 1}/${trainingFiles.length}: ${file.name}`);
        docs.push(await fileToBase64(file));
      }
      pushTrainingTrace("Encodage terminé, envoi au backend");

      const response = await fetch("/api/document-engine/training/build-item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item: trainingItem,
          template: "contract",
          language: "fr",
          threshold: 0.7,
          documents: docs,
          document_type: documentType,
          excel_header_axis: trainingExcelHeaderAxis,
        }),
      });
      pushTrainingTrace(`Réponse HTTP reçue: ${response.status}`);

      const rawBody = await response.text();
      let parsedBody: unknown = null;
      try {
        parsedBody = rawBody ? JSON.parse(rawBody) : null;
      } catch {
        parsedBody = rawBody;
      }

      if (!response.ok) {
        const detail =
          typeof parsedBody === "object" && parsedBody && "detail" in parsedBody
            ? String((parsedBody as { detail: unknown }).detail)
            : rawBody || `HTTP ${response.status}`;
        pushTrainingTrace(`Erreur backend: ${detail}`);
        throw new Error(detail);
      }

      pushTrainingTrace("Backend OK, rafraîchissement des listes");
      const result = parsedBody as TrainingBuildResponse;
      setTrainingResult(result);
      setShowTrainingResult(false);
      setShowTrainingDebug(false);
      setGuidedItemConfig(result.config);
      await refreshLists();
      clearTrainingFiles();
      setGuidedItemName(result.item);
      setTab("settings");
      pushTrainingTrace("Training terminé avec succès");
      setTrainingMessage(
        `Item '${result.item}' généré et sauvegardé (${result.saved_to}).`,
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Erreur training";
      pushTrainingTrace(`Erreur attrapée: ${detail}`);
      setTrainingMessage(err instanceof Error ? err.message : "Erreur training");
    } finally {
      setTrainingBusy(false);
    }
  };

  const optionList = configKind === "template" ? templates : items;

  const exportAnalyzeSummaryCsv = () => {
    if (!batchResult) return;
    const rows = [
      ["Fichier", "Type", "Item", "Auto item", "Valide", "Score", "OCR", "Temps ms", "Champs manquants", "Erreur"],
      ...batchResult.results.map((entry) => {
        const analysis = entry.analysis;
        return [
          entry.filename || "",
          entry.document_type,
          analysis?.item || entry.item_requested || "",
          analysis?.item_auto_detected ? "oui" : "non",
          analysis ? (analysis.valid ? "oui" : "non") : "non",
          analysis ? `${Math.round(analysis.score * 100)}%` : "",
          analysis ? (analysis.ocr_used ? "oui" : "non") : "",
          analysis ? String(analysis.processing_time_ms) : "",
          analysis?.missing_elements.join(" | ") || "",
          entry.error || "",
        ];
      }),
    ];
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
      .join("\n");
    triggerDownload(csv, "analyse-resume.csv", "text/csv;charset=utf-8");
  };

  const exportAnalyzeSummaryExcel = () => {
    if (!batchResult) return;
    const header = ["Fichier", "Type", "Item", "Auto item", "Valide", "Score", "OCR", "Temps ms", "Champs manquants", "Erreur"];
    const rows = batchResult.results
      .map((entry) => {
        const analysis = entry.analysis;
        const values = [
          entry.filename || "",
          entry.document_type,
          analysis?.item || entry.item_requested || "",
          analysis?.item_auto_detected ? "oui" : "non",
          analysis ? (analysis.valid ? "oui" : "non") : "non",
          analysis ? `${Math.round(analysis.score * 100)}%` : "",
          analysis ? (analysis.ocr_used ? "oui" : "non") : "",
          analysis ? String(analysis.processing_time_ms) : "",
          analysis?.missing_elements.join(" | ") || "",
          entry.error || "",
        ];
        return `<tr>${values.map((value) => `<td>${String(value)}</td>`).join("")}</tr>`;
      })
      .join("");
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><table border="1"><thead><tr>${header.map((value) => `<th>${value}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></body></html>`;
    triggerDownload(html, "analyse-resume.xls", "application/vnd.ms-excel;charset=utf-8");
  };

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
      <section className="mx-auto w-full max-w-5xl">
        <p className="mb-3 inline-flex items-center rounded-full border border-emerald-400/40 bg-emerald-400/10 px-4 py-1 text-xs font-semibold tracking-wide text-emerald-300">
          VirtuaDoc • Document Completeness Engine
        </p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">
          Moteur déterministe de validation documentaire
        </h1>

        <div className="mt-6 flex flex-wrap gap-2">
          {([
            ["analyze", "Analyse"],
            ["settings", "Réglages"],
            ["training", "Training"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                tab === key
                  ? "bg-emerald-400 text-slate-950"
                  : "bg-slate-900 text-slate-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "analyze" ? (
          <section className="mt-6">
            <form
              onSubmit={onAnalyzeSubmit}
              className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/70 p-5"
            >
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-200">
                  Détection de l&apos;item
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setAnalyzeDetectItem(true)}
                    className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                      analyzeDetectItem ? "bg-emerald-400 text-slate-950" : "bg-slate-800 text-slate-200"
                    }`}
                  >
                    Auto-détection
                  </button>
                  <button
                    type="button"
                    onClick={() => setAnalyzeDetectItem(false)}
                    className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                      !analyzeDetectItem ? "bg-emerald-400 text-slate-950" : "bg-slate-800 text-slate-200"
                    }`}
                  >
                    Item manuel
                  </button>
                </div>
                {!analyzeDetectItem ? (
                  <select
                    value={item}
                    onChange={(e) => setItem(e.target.value)}
                    className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  >
                    {items.map((entry) => (
                      <option key={entry} value={entry}>
                        {entry}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-200">
                  Documents (PDF ou Excel natif)
                </label>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.xlsx,.xlsm,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12"
                  onChange={onFileChange}
                  className="block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-emerald-500 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-950"
                />
                <p className="mt-2 text-xs text-slate-400">{files.length} fichier(s) sélectionné(s)</p>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-200">
                  Mode d&apos;analyse
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setAnalyzeOcrMode("auto")}
                    className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                      analyzeOcrMode === "auto"
                        ? "bg-emerald-400 text-slate-950"
                        : "bg-slate-800 text-slate-200"
                    }`}
                  >
                    Auto
                  </button>
                  <button
                    type="button"
                    onClick={() => setAnalyzeOcrMode("native")}
                    className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                      analyzeOcrMode === "native"
                        ? "bg-emerald-400 text-slate-950"
                        : "bg-slate-800 text-slate-200"
                    }`}
                  >
                    Natif
                  </button>
                  <button
                    type="button"
                    onClick={() => setAnalyzeOcrMode("ocr")}
                    disabled={files.length > 0 && files.every((entry) => detectDocumentType(entry) === "excel")}
                    className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                      analyzeOcrMode === "ocr"
                        ? "bg-emerald-400 text-slate-950"
                        : "bg-slate-800 text-slate-200"
                    }`}
                  >
                    OCR
                  </button>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Auto = natif puis OCR si la détection est faible. Natif = extraction texte PDF/Excel. OCR = forcer lecture image/scanner (PDF uniquement).
                </p>
              </div>

              {files.length > 0 && files.every((entry) => detectDocumentType(entry) === "excel") ? (
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">
                    Excel: position des intitulés
                  </label>
                  <select
                    value={analyzeExcelHeaderAxis}
                    onChange={(e) =>
                      setAnalyzeExcelHeaderAxis(
                        e.target.value as "first_row" | "first_column",
                      )
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  >
                    <option value="first_row">Première ligne</option>
                    <option value="first_column">Première colonne</option>
                  </select>
                </div>
              ) : null}

              <button
                type="submit"
                disabled={loading}
                className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
              >
                {loading ? "Analyse en cours..." : "Lancer l'analyse"}
              </button>

              {loading && analyzeProgress ? (
                <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                  <div className="flex items-center justify-between gap-3 text-sm text-slate-200">
                    <p>
                      Documents {analyzeProgress.current} / {analyzeProgress.total}
                    </p>
                    <p className="text-xs text-slate-400">
                      {analyzeProgress.phase === "encoding" ? "Préparation et envoi" : "Traitement backend"}
                    </p>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-emerald-400 transition-all duration-300"
                      style={{
                        width: `${Math.max(
                          8,
                          Math.round((analyzeProgress.current / analyzeProgress.total) * 100),
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              ) : null}

              {error ? <p className="text-sm text-rose-300">{error}</p> : null}
            </form>

            {analyzeTrace.length > 0 ? (
              <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold text-slate-300">Étapes de traitement</p>
                  <button
                    type="button"
                    onClick={() => setShowAnalyzeTrace((v) => !v)}
                    className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200"
                  >
                    {showAnalyzeTrace ? "Masquer" : "Afficher"}
                  </button>
                </div>
                {showAnalyzeTrace ? (
                  <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap text-xs text-slate-400">
                    {analyzeTrace.join("\n")}
                  </pre>
                ) : null}
              </div>
            ) : null}

            {batchResult ? (
              <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/70 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm text-slate-300">
                    <p>
                      Fichiers traités: <b>{batchResult.total_count}</b>
                    </p>
                    <p>
                      Succès: <b>{batchResult.success_count}</b> | Erreurs: <b>{batchResult.error_count}</b>
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={exportAnalyzeSummaryCsv}
                      className="rounded-lg bg-slate-700 px-3 py-2 text-sm font-semibold text-slate-100"
                    >
                      Export CSV
                    </button>
                    <button
                      type="button"
                      onClick={exportAnalyzeSummaryExcel}
                      className="rounded-lg bg-slate-700 px-3 py-2 text-sm font-semibold text-slate-100"
                    >
                      Export Excel
                    </button>
                  </div>
                </div>

                <div className="mt-4 overflow-x-auto rounded-lg border border-slate-800">
                  <table className="min-w-full text-left text-sm text-slate-200">
                    <thead className="bg-slate-950/80 text-xs uppercase tracking-wide text-slate-400">
                      <tr>
                        <th className="px-3 py-2">Fichier</th>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Item</th>
                        <th className="px-3 py-2">Valide</th>
                        <th className="px-3 py-2">Score</th>
                        <th className="px-3 py-2">OCR</th>
                        <th className="px-3 py-2">Temps</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batchResult.results.map((entry, idx) => (
                        <tr
                          key={`${entry.filename || "document"}-${idx}`}
                          onClick={() => {
                            setSelectedBatchIndex(idx);
                            setResult(entry.analysis || null);
                          }}
                          className={`cursor-pointer border-t border-slate-800 ${
                            selectedBatchIndex === idx ? "bg-emerald-400/10" : "bg-transparent"
                          }`}
                        >
                          <td className="px-3 py-2 font-medium">{entry.filename || `Document ${idx + 1}`}</td>
                          <td className="px-3 py-2">{entry.document_type}</td>
                          <td className="px-3 py-2">
                            {entry.analysis?.item || entry.item_requested || "—"}
                            {entry.analysis?.item_auto_detected ? " (auto)" : ""}
                          </td>
                          <td className="px-3 py-2">
                            {entry.analysis ? (entry.analysis.valid ? "oui" : "non") : "erreur"}
                          </td>
                          <td className="px-3 py-2">
                            {entry.analysis ? `${Math.round(entry.analysis.score * 100)}%` : "—"}
                          </td>
                          <td className="px-3 py-2">
                            {entry.analysis ? (entry.analysis.ocr_used ? "oui" : "non") : "—"}
                          </td>
                          <td className="px-3 py-2">
                            {entry.analysis ? `${entry.analysis.processing_time_ms} ms` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {selectedBatchEntry && !selectedBatchEntry.success ? (
                  <div className="mt-4 rounded-lg border border-rose-800/60 bg-rose-950/20 p-4 text-sm text-rose-200">
                    <p className="font-semibold">{selectedBatchEntry.filename || "Document sélectionné"}</p>
                    <p className="mt-1">{selectedBatchEntry.error || "Erreur inconnue"}</p>
                  </div>
                ) : null}
              </div>
            ) : null}

            {selectedAnalysis ? (
              <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/70 p-5">
                {selectedBatchEntry ? (
                  <p className="mb-3 text-sm text-slate-400">
                    Détail du fichier: <b>{selectedBatchEntry.filename || `Document ${selectedBatchIndex + 1}`}</b>
                  </p>
                ) : null}
                <p className="text-sm font-semibold text-slate-200">Score</p>
                <div className="mt-2 space-y-1 text-sm text-slate-300">
                  <p>
                    Score global: <b>{scorePercent}%</b>
                  </p>
                  <p>
                    Validité: <b>{selectedAnalysis.valid ? "valide" : "invalide"}</b>
                  </p>
                  <p>
                    Item: <b>{selectedAnalysis.item}</b>
                    {selectedAnalysis.item_auto_detected ? " (auto-détecté)" : ""}
                  </p>
                  <p>
                    Variant: <b>{selectedAnalysis.variant_detected || "non détectée"}</b> (score{" "}
                    {selectedAnalysis.variant_score.toFixed(2)})
                  </p>
                  <p>
                    Poids détecté: <b>{selectedAnalysis.matched_weight_sum}</b> / {selectedAnalysis.total_weight_sum}
                    {" "}| Seuil: {selectedAnalysis.threshold}
                  </p>
                  <p>
                    Type de document: <b>{selectedAnalysis.document_type}</b>
                  </p>
                  <p>
                    OCR: {selectedAnalysis.ocr_used ? "oui" : "non"} (demandé: {selectedAnalysis.ocr_mode_requested},
                    appliqué: {selectedAnalysis.ocr_mode_applied}, tenté:{" "}
                    {selectedAnalysis.ocr_attempted ? "oui" : "non"}, blocs:{" "}
                    {selectedAnalysis.ocr_blocks_count}) | Temps: {selectedAnalysis.processing_time_ms} ms
                  </p>
                </div>
                {selectedAnalysis.ocr_error ? (
                  <p className="mt-1 text-sm text-rose-300">
                    Erreur OCR: {selectedAnalysis.ocr_error}
                  </p>
                ) : null}
                <p className="mt-2 text-sm text-slate-300">
                  Éléments manquants: {selectedAnalysis.missing_elements.join(", ") || "aucun"}
                </p>
                {selectedAnalysis.elements_found.length > 0 ? (
                  <div className="mt-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-slate-200">Champs détectés</p>
                      <button
                        type="button"
                        onClick={() => setShowAnalyzeDetectedFields((v) => !v)}
                        className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200"
                      >
                        {showAnalyzeDetectedFields ? "Masquer" : "Afficher"}
                      </button>
                    </div>
                    {showAnalyzeDetectedFields ? (
                      <ul className="mt-1 space-y-1 text-sm text-slate-300">
                        {selectedAnalysis.elements_found.map((entry, idx) => (
                          <li key={`${entry.name}-${entry.page}-${idx}`}>
                            <b>{entry.name}</b> (p.{entry.page})
                            {entry.value ? `: ${entry.value}` : ""}
                            {entry.value_position ? ` [${entry.value_position}]` : ""}
                            <div className="pl-3 text-xs text-slate-400">
                              à droite: {entry.right_text || "—"}
                            </div>
                            <div className="pl-3 text-xs text-slate-400">
                              en dessous: {entry.below_text || "—"}
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <div className="mt-3 rounded border border-slate-700/70 bg-slate-900/70 p-3 text-xs text-slate-200">
                      <p className="font-semibold text-slate-100">
                        Résumé des champs détectés (valeurs)
                      </p>
                      <ul className="mt-2 space-y-1">
                        {selectedAnalysis.elements_found.map((entry, idx) => (
                          <li key={`summary-${entry.name}-${entry.page}-${idx}`}>
                            <b>{entry.name}</b>:{" "}
                            {entry.value ||
                              entry.target_right_text ||
                              entry.target_below_text ||
                              entry.target_text ||
                              entry.right_text ||
                              entry.below_text ||
                              "—"}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : null}
                {selectedAnalysis.document_type === "excel" ? (
                  <div className="mt-3 rounded border border-slate-700/70 bg-slate-950/60 p-3 text-xs text-slate-200">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-slate-100">
                        Debug Excel: paires détectées (intitulé: valeur)
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowAnalyzeDebug((v) => !v)}
                        className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200"
                      >
                        {showAnalyzeDebug ? "Masquer" : "Afficher"}
                      </button>
                    </div>
                    {showAnalyzeDebug ? (
                      selectedAnalysis.excel_pairs_preview.length > 0 ? (
                        <ul className="mt-2">
                          {selectedAnalysis.excel_pairs_preview.map((line, idx) => (
                            <li
                              key={`excel-pair-${idx}`}
                              className="border-t border-slate-800 py-2 first:border-t-0 first:pt-0 last:pb-0"
                            >
                              {line}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-slate-400">Aucune paire détectée.</p>
                      )
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}

        {tab === "settings" ? (
          <section className="mt-6 rounded-xl border border-slate-800 bg-slate-900/70 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Réglages des items</h2>
              <button
                type="button"
                onClick={() => setShowConfigHelp((v) => !v)}
                className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200"
              >
                {showConfigHelp ? "Masquer l'aide" : "Aide paramétrage"}
              </button>
            </div>

            {showConfigHelp ? (
              <div className="mt-3 rounded-lg border border-slate-700 bg-slate-950 p-3 text-xs text-slate-300">
                <p className="font-semibold text-slate-200">Required elements</p>
                <p className="mt-1">
                  <b>Mot clé simple</b>: vérifie la présence du mot/phrase dans le document.
                </p>
                <p className="mt-1">
                  <b>Repérage relatif</b>: trouve un mot-clé ancre, descend de X lignes, puis cherche un mot-clé
                  cible (mode contient/exact/regex).
                </p>
                <p className="mt-1">
                  Exemple: ancre <code>Raison sociale</code>, <code>X lignes dessous = 1</code>, cible{" "}
                  <code>OPALHE</code>.
                </p>
                <p className="mt-3 font-semibold text-slate-200">Repérage relatif OCR</p>
                <p className="mt-1">
                  Définit une zone OCR ciblée avec coordonnées relatives en pourcentage de page:
                  <code> x_pct</code>, <code>y_pct</code>, <code>width_pct</code>, <code>height_pct</code>.
                </p>
                <p className="mt-1">
                  <b>Pages</b> permet de limiter la recherche à certaines pages, par exemple <code>1</code>,
                  <code>2-3</code> ou <code>1,4</code>.
                </p>
              </div>
            ) : null}

            <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-4">
              <p className="text-sm font-medium text-slate-100">Gestion des items</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,2fr)_auto_auto]">
                <label className="text-xs text-slate-300">
                  Liste des items
                  <select
                    value={guidedItemName}
                    onChange={(e) => setGuidedItemName(e.target.value)}
                    className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                  >
                    {items.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    loadGuidedItem().catch(() => undefined);
                  }}
                  disabled={guidedBusy}
                  className="self-end rounded-lg bg-slate-700 px-3 py-2 text-sm font-semibold text-slate-100"
                >
                  Modifier
                </button>
                <button
                  type="button"
                  onClick={deleteGuidedItem}
                  disabled={guidedBusy || !guidedItemName}
                  className="self-end rounded-lg bg-rose-800 px-3 py-2 text-sm font-semibold text-slate-100"
                >
                  Supprimer
                </button>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,2fr)_auto]">
                <label className="text-xs text-slate-300">
                  Dupliquer vers un nouvel item
                  <input
                    value={duplicateItemName}
                    onChange={(e) => setDuplicateItemName(e.target.value)}
                    placeholder="nouvel_item"
                    className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                  />
                </label>
                <button
                  type="button"
                  onClick={duplicateGuidedItem}
                  disabled={guidedBusy || !guidedItemConfig}
                  className="self-end rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-slate-100"
                >
                  Dupliquer
                </button>
              </div>

              {guidedMessage ? (
                <p
                  className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
                    guidedMessageTone === "success"
                      ? "border-emerald-700/70 bg-emerald-950/30 text-emerald-200"
                      : guidedMessageTone === "error"
                        ? "border-rose-700/70 bg-rose-950/30 text-rose-200"
                        : "border-slate-700 bg-slate-900 text-slate-300"
                  }`}
                >
                  {guidedMessage}
                </p>
              ) : null}
            </div>

            {guidedItemConfig ? (
              <div className="mt-4 space-y-4 rounded-lg border border-slate-800 bg-slate-950 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
                  <div>
                    <p className="text-sm font-medium text-slate-100">Édition de l&apos;item</p>
                    <p className="mt-1 text-xs text-slate-400">{guidedItemName}</p>
                  </div>
                  <button
                    type="button"
                    onClick={saveGuidedItem}
                    disabled={guidedBusy || !guidedItemConfig}
                    className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950"
                  >
                    Sauvegarder item
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="text-xs text-slate-300">
                    Langue
                    <input
                      value={guidedItemConfig.language || "fr"}
                      onChange={(e) =>
                        setGuidedItemConfig({ ...guidedItemConfig, language: e.target.value })
                      }
                      className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="text-xs text-slate-300">
                    Template
                    <input
                      value={guidedItemConfig.template || "contract"}
                      onChange={(e) =>
                        setGuidedItemConfig({ ...guidedItemConfig, template: e.target.value })
                      }
                      list="template-names"
                      className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                    />
                  </label>
                  <datalist id="template-names">
                    {templates.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                  <label className="text-xs text-slate-300">
                    Seuil
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={guidedItemConfig.threshold ?? 0.7}
                      onChange={(e) =>
                        setGuidedItemConfig({
                          ...guidedItemConfig,
                          threshold: Number(e.target.value),
                        })
                      }
                      className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap gap-2">
                  {([
                    ["required_elements", "Champs"],
                    ["ocr_relative", "Repérage relatif OCR"],
                    ["variants", "Variants"],
                  ] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSettingsEditorTab(key)}
                      className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                        settingsEditorTab === key
                          ? "bg-emerald-400 text-slate-950"
                          : "bg-slate-900 text-slate-200"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {settingsEditorTab === "required_elements" ? (
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-sm font-medium text-slate-200">Required elements</p>
                      <button
                        type="button"
                        onClick={() =>
                          setGuidedItemConfig({
                            ...guidedItemConfig,
                            required_elements: [
                              ...guidedItemConfig.required_elements,
                              { name: "nouvel_element", weight: 1, pages: "", strategy: "keyword" },
                            ],
                          })
                        }
                        className="rounded bg-slate-700 px-2 py-1 text-xs"
                      >
                        + élément
                      </button>
                    </div>
                    <div className="space-y-2">
                      {guidedItemConfig.required_elements.map((element, idx) => (
                        <div key={`required-${idx}`} className="rounded border border-slate-800 p-3">
                          <div className="grid gap-2 sm:grid-cols-6">
                            <label className="sm:col-span-2 text-xs text-slate-300">
                              Nom de la règle
                              <input
                                value={element.name}
                                onChange={(e) => {
                                  const next = [...guidedItemConfig.required_elements];
                                  next[idx] = { ...next[idx], name: e.target.value };
                                  setGuidedItemConfig({ ...guidedItemConfig, required_elements: next });
                                }}
                                placeholder="ex: president_nom"
                                className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                              />
                            </label>
                            <label className="text-xs text-slate-300">
                              Pages
                              <input
                                value={element.pages || ""}
                                onChange={(e) => {
                                  const next = [...guidedItemConfig.required_elements];
                                  next[idx] = { ...next[idx], pages: e.target.value };
                                  setGuidedItemConfig({ ...guidedItemConfig, required_elements: next });
                                }}
                                placeholder="3 ou 3-4"
                                className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                              />
                              <span className="mt-1 block text-[11px] text-slate-500">
                                Optionnel. Ex: `3`, `3-4`, `3,5`.
                              </span>
                            </label>
                            <label className="text-xs text-slate-300">
                              Stratégie
                              <select
                                value={element.strategy || "keyword"}
                                onChange={(e) => {
                                  const strategy = e.target.value as "keyword" | "relative_anchor";
                                  const next = [...guidedItemConfig.required_elements];
                                  next[idx] =
                                    strategy === "relative_anchor"
                                      ? {
                                          ...next[idx],
                                          strategy,
                                          anchor: next[idx].anchor || { keyword: "", occurrence: 1 },
                                          move: next[idx].move || { lines_below: 1, tolerance: 0 },
                                          target: next[idx].target || { keyword: "", mode: "contains" },
                                        }
                                      : { ...next[idx], strategy };
                                  setGuidedItemConfig({ ...guidedItemConfig, required_elements: next });
                                }}
                                className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                              >
                                <option value="keyword">Mot clé simple</option>
                                <option value="relative_anchor">Repérage relatif</option>
                              </select>
                            </label>
                            <label className="text-xs text-slate-300">
                              Poids
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={element.weight}
                                onChange={(e) => {
                                  const next = [...guidedItemConfig.required_elements];
                                  next[idx] = { ...next[idx], weight: Number(e.target.value) };
                                  setGuidedItemConfig({ ...guidedItemConfig, required_elements: next });
                                }}
                                className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => {
                                const next = guidedItemConfig.required_elements.filter((_, i) => i !== idx);
                                setGuidedItemConfig({ ...guidedItemConfig, required_elements: next });
                              }}
                              className="self-end rounded bg-rose-800 px-2 py-2 text-xs"
                            >
                              Suppr
                            </button>
                          </div>

                          {(element.strategy || "keyword") === "relative_anchor" ? (
                            <div className="mt-2 grid gap-2 sm:grid-cols-6">
                              <label className="sm:col-span-2 text-xs text-slate-300">
                                Mot-clé ancre
                                <input
                                  value={element.anchor?.keyword || ""}
                                  onChange={(e) => {
                                    const next = [...guidedItemConfig.required_elements];
                                    next[idx] = {
                                      ...next[idx],
                                      anchor: { ...(next[idx].anchor || {}), keyword: e.target.value },
                                    };
                                    setGuidedItemConfig({ ...guidedItemConfig, required_elements: next });
                                  }}
                                  className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                                />
                              </label>
                              <label className="text-xs text-slate-300">
                                Occurrence
                                <input
                                  type="number"
                                  min="1"
                                  value={element.anchor?.occurrence || 1}
                                  onChange={(e) => {
                                    const next = [...guidedItemConfig.required_elements];
                                    next[idx] = {
                                      ...next[idx],
                                      anchor: { ...(next[idx].anchor || {}), occurrence: Number(e.target.value) },
                                    };
                                    setGuidedItemConfig({ ...guidedItemConfig, required_elements: next });
                                  }}
                                  className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                                />
                              </label>
                              <label className="text-xs text-slate-300">
                                X lignes dessous
                                <input
                                  type="number"
                                  value={element.move?.lines_below || 0}
                                  onChange={(e) => {
                                    const next = [...guidedItemConfig.required_elements];
                                    next[idx] = {
                                      ...next[idx],
                                      move: { ...(next[idx].move || {}), lines_below: Number(e.target.value) },
                                    };
                                    setGuidedItemConfig({ ...guidedItemConfig, required_elements: next });
                                  }}
                                  className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                                />
                              </label>
                              <label className="text-xs text-slate-300">
                                Tolérance ± lignes
                                <input
                                  type="number"
                                  min="0"
                                  value={element.move?.tolerance || 0}
                                  onChange={(e) => {
                                    const next = [...guidedItemConfig.required_elements];
                                    next[idx] = {
                                      ...next[idx],
                                      move: { ...(next[idx].move || {}), tolerance: Number(e.target.value) },
                                    };
                                    setGuidedItemConfig({ ...guidedItemConfig, required_elements: next });
                                  }}
                                  className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                                />
                              </label>
                              <label className="sm:col-span-2 text-xs text-slate-300">
                                Mot-clé cible
                                <input
                                  value={element.target?.keyword || ""}
                                  onChange={(e) => {
                                    const next = [...guidedItemConfig.required_elements];
                                    next[idx] = {
                                      ...next[idx],
                                      target: { ...(next[idx].target || {}), keyword: e.target.value },
                                    };
                                    setGuidedItemConfig({ ...guidedItemConfig, required_elements: next });
                                  }}
                                  className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                                  placeholder="nom, direction"
                                />
                                <span className="mt-1 block text-[11px] text-slate-500">
                                  Plusieurs mots-clés possibles, séparés par des virgules.
                                </span>
                              </label>
                              <label className="text-xs text-slate-300">
                                Mode de match
                                <select
                                  value={element.target?.mode || "contains"}
                                  onChange={(e) => {
                                    const next = [...guidedItemConfig.required_elements];
                                    next[idx] = {
                                      ...next[idx],
                                      target: {
                                        ...(next[idx].target || {}),
                                        mode: e.target.value as "contains" | "exact" | "regex",
                                      },
                                    };
                                    setGuidedItemConfig({ ...guidedItemConfig, required_elements: next });
                                  }}
                                  className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                                >
                                  <option value="contains">contient</option>
                                  <option value="exact">exact</option>
                                  <option value="regex">regex</option>
                                </select>
                              </label>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {settingsEditorTab === "ocr_relative" ? (
                  <div>
                    <div className="mb-4 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-slate-200">Calibration visuelle</p>
                          <p className="mt-1 text-xs text-slate-500">
                            Charge un PDF de référence, dessine une zone, puis ajoute-la aux régions OCR.
                          </p>
                        </div>
                        {ocrCalibrationFile && ocrCalibrationPageCount > 0 ? (
                          <div className="flex items-center gap-2 text-xs text-slate-400">
                            <button
                              type="button"
                              onClick={() => {
                                goToOcrCalibrationPage(Math.max(1, ocrCalibrationPage - 1)).catch(() => undefined);
                              }}
                              disabled={ocrCalibrationBusy || ocrCalibrationPage <= 1}
                              className="rounded bg-slate-800 px-2 py-1 disabled:opacity-50"
                            >
                              Page -
                            </button>
                            <span>
                              Page {ocrCalibrationPage} / {ocrCalibrationPageCount}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                goToOcrCalibrationPage(
                                  Math.min(ocrCalibrationPageCount, ocrCalibrationPage + 1),
                                ).catch(() => undefined);
                              }}
                              disabled={ocrCalibrationBusy || ocrCalibrationPage >= ocrCalibrationPageCount}
                              className="rounded bg-slate-800 px-2 py-1 disabled:opacity-50"
                            >
                              Page +
                            </button>
                          </div>
                        ) : null}
                      </div>

                      <div className="mt-3 flex flex-wrap items-end gap-3">
                        <label className="text-xs text-slate-300">
                          PDF de référence
                          <input
                            type="file"
                            accept=".pdf,application/pdf"
                            onChange={(e) => {
                              onOcrCalibrationFileChange(e).catch(() => undefined);
                            }}
                            className="mt-1 block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-sky-500 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-950"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={addCalibrationDraftToRegions}
                          disabled={!ocrCalibrationDraft || !guidedItemConfig}
                          className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
                        >
                          Ajouter la sélection
                        </button>
                      </div>

                      {ocrCalibrationError ? (
                        <p className="mt-2 text-sm text-rose-300">{ocrCalibrationError}</p>
                      ) : null}

                      {ocrCalibrationImageUrl ? (
                        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-2">
                          <p className="mb-2 text-xs text-slate-500">
                            La zone ci-dessous se scrolle indépendamment de la page. Trace la zone avec clic gauche,
                            puis relâche pour finaliser. Les zones rouges existantes peuvent aussi etre deplacees ou
                            redimensionnees directement.
                          </p>
                          <div className="mb-3 flex flex-wrap gap-3 text-[11px] text-slate-400">
                            <span className="inline-flex items-center gap-2">
                              <span className="h-3 w-3 rounded-sm border border-emerald-400 bg-emerald-400/20" />
                              Zone de recherche
                            </span>
                            <span className="inline-flex items-center gap-2">
                              <span className="h-3 w-3 rounded-sm border border-rose-400 bg-rose-400/15" />
                              Zone de lecture OCR
                            </span>
                          </div>
                          <div
                            className="max-h-[75vh] overflow-auto overscroll-contain rounded border border-slate-900"
                          >
                            <div
                              ref={calibrationCanvasRef}
                              className="relative inline-block cursor-crosshair select-none"
                              onDragStart={(event) => event.preventDefault()}
                              onPointerDown={beginOcrCalibrationSelection}
                              onPointerMove={updateOcrCalibrationSelection}
                              onPointerUp={stopOcrCalibrationSelection}
                              onPointerCancel={stopOcrCalibrationSelection}
                              style={{
                                touchAction: ocrCalibrationPointerId === null ? "auto" : "none",
                                userSelect: "none",
                              }}
                            >
                              <Image
                                ref={calibrationImageRef}
                                src={ocrCalibrationImageUrl}
                                alt={`Aperçu OCR page ${ocrCalibrationPage}`}
                                width={1200}
                                height={1600}
                                unoptimized
                                draggable={false}
                                className="block h-auto max-w-full rounded"
                              />
                              {calibrationVisibleRegions.map(({ regionIndex, region, readingRect, searchRect }) => {
                                const isSelected =
                                  selectedOcrRegionIndex === regionIndex ||
                                  activeOcrRegionEdit?.regionIndex === regionIndex;
                                const handleClassName =
                                  "pointer-events-auto absolute h-3 w-3 rounded-full border border-white bg-rose-500 shadow";
                                return (
                                <div key={`ocr-overlay-${regionIndex}`} className="pointer-events-none absolute inset-0">
                                  <div
                                    className="absolute border border-emerald-400/90 bg-emerald-400/15"
                                    style={{
                                      left: `${searchRect.leftPct}%`,
                                      top: `${searchRect.topPct}%`,
                                      width: `${searchRect.widthPct}%`,
                                      height: `${searchRect.heightPct}%`,
                                    }}
                                  />
                                  <div
                                    className={`pointer-events-auto absolute border-2 ${
                                      isSelected ? "border-sky-300 bg-rose-400/15" : "border-rose-400/95 bg-rose-400/10"
                                    }`}
                                    style={{
                                      left: `${readingRect.leftPct}%`,
                                      top: `${readingRect.topPct}%`,
                                      width: `${readingRect.widthPct}%`,
                                      height: `${readingRect.heightPct}%`,
                                      cursor: activeOcrRegionEdit?.regionIndex === regionIndex ? "grabbing" : "grab",
                                    }}
                                    onPointerDown={(event) => {
                                      beginOcrRegionEdit(
                                        event,
                                        regionIndex,
                                        readingRect,
                                        Math.max(0, region.margin_pct ?? 0),
                                        "move",
                                      );
                                    }}
                                  />
                                  <div
                                    className="absolute rounded bg-slate-950/90 px-1.5 py-0.5 text-[10px] font-medium text-slate-200 shadow"
                                    style={{
                                      left: `${readingRect.leftPct}%`,
                                      top: `max(0px, calc(${readingRect.topPct}% - 20px))`,
                                    }}
                                  >
                                    {region.name || `zone_${regionIndex + 1}`}
                                  </div>
                                  {isSelected ? (
                                    <>
                                      <div
                                        className={handleClassName}
                                        style={{
                                          left: `calc(${readingRect.leftPct}% - 6px)`,
                                          top: `calc(${readingRect.topPct}% - 6px)`,
                                          cursor: "nwse-resize",
                                        }}
                                        onPointerDown={(event) => {
                                          beginOcrRegionEdit(
                                            event,
                                            regionIndex,
                                            readingRect,
                                            Math.max(0, region.margin_pct ?? 0),
                                            "nw",
                                          );
                                        }}
                                      />
                                      <div
                                        className={handleClassName}
                                        style={{
                                          left: `calc(${readingRect.leftPct + readingRect.widthPct}% - 6px)`,
                                          top: `calc(${readingRect.topPct}% - 6px)`,
                                          cursor: "nesw-resize",
                                        }}
                                        onPointerDown={(event) => {
                                          beginOcrRegionEdit(
                                            event,
                                            regionIndex,
                                            readingRect,
                                            Math.max(0, region.margin_pct ?? 0),
                                            "ne",
                                          );
                                        }}
                                      />
                                      <div
                                        className={handleClassName}
                                        style={{
                                          left: `calc(${readingRect.leftPct}% - 6px)`,
                                          top: `calc(${readingRect.topPct + readingRect.heightPct}% - 6px)`,
                                          cursor: "nesw-resize",
                                        }}
                                        onPointerDown={(event) => {
                                          beginOcrRegionEdit(
                                            event,
                                            regionIndex,
                                            readingRect,
                                            Math.max(0, region.margin_pct ?? 0),
                                            "sw",
                                          );
                                        }}
                                      />
                                      <div
                                        className={handleClassName}
                                        style={{
                                          left: `calc(${readingRect.leftPct + readingRect.widthPct}% - 6px)`,
                                          top: `calc(${readingRect.topPct + readingRect.heightPct}% - 6px)`,
                                          cursor: "nwse-resize",
                                        }}
                                        onPointerDown={(event) => {
                                          beginOcrRegionEdit(
                                            event,
                                            regionIndex,
                                            readingRect,
                                            Math.max(0, region.margin_pct ?? 0),
                                            "se",
                                          );
                                        }}
                                      />
                                    </>
                                  ) : null}
                                </div>
                                );
                              })}
                              {ocrCalibrationDraft ? (
                                <div
                                  className="pointer-events-none absolute border-2 border-emerald-400 bg-emerald-400/15"
                                  style={{
                                    left: ocrCalibrationDraft.x,
                                    top: ocrCalibrationDraft.y,
                                    width: ocrCalibrationDraft.width,
                                    height: ocrCalibrationDraft.height,
                                  }}
                                />
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="mb-2 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-slate-200">Repérage relatif OCR</p>
                        <p className="mt-1 text-xs text-slate-500">
                          Zones OCR ciblées, exprimées en pourcentage de la page.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          appendOcrRegion({
                            name: "zone_ocr",
                            pages: "",
                            x_pct: 0,
                            y_pct: 0,
                            width_pct: 25,
                            height_pct: 10,
                            margin_pct: 2,
                            anchor_text: "",
                            anchor_mode: "contains",
                            anchor_search_radius_pct: 0,
                            notes: "",
                          })
                        }
                        className="rounded bg-slate-700 px-2 py-1 text-xs"
                      >
                        + zone OCR
                      </button>
                    </div>

                    {(guidedItemConfig.ocr_regions || []).length === 0 ? (
                      <div className="rounded border border-dashed border-slate-700 p-4 text-sm text-slate-400">
                        Aucune zone OCR relative définie.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {(guidedItemConfig.ocr_regions || []).map((region, idx) => (
                          <div key={`ocr-region-${idx}`} className="rounded border border-slate-800 p-3">
                            <div className="grid gap-2 sm:grid-cols-6">
                              <label className="sm:col-span-2 text-xs text-slate-300">
                                Nom de la zone
                                <input
                                  ref={(element) => {
                                    ocrRegionNameInputRefs.current[idx] = element;
                                  }}
                                  value={region.name}
                                  onChange={(e) => {
                                    const next = [...(guidedItemConfig.ocr_regions || [])];
                                    next[idx] = { ...next[idx], name: e.target.value };
                                    setGuidedItemConfig({ ...guidedItemConfig, ocr_regions: next });
                                  }}
                                  placeholder="ex: signature_bloc"
                                  className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                                />
                              </label>
                              <label className="text-xs text-slate-300">
                                Pages
                                <input
                                  value={region.pages || ""}
                                  onChange={(e) => {
                                    const next = [...(guidedItemConfig.ocr_regions || [])];
                                    next[idx] = { ...next[idx], pages: e.target.value };
                                    setGuidedItemConfig({ ...guidedItemConfig, ocr_regions: next });
                                  }}
                                  placeholder="1 ou 2-3"
                                  className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                                />
                                <span className="mt-1 block text-[11px] text-slate-500">
                                  Ex: `1`, `2-3`, `1,4`.
                                </span>
                              </label>
                              <label className="text-xs text-slate-300">
                                x %
                                <DecimalInput
                                  value={region.x_pct}
                                  min={0}
                                  max={100}
                                  onValueChange={(nextValue) => {
                                    const next = [...(guidedItemConfig.ocr_regions || [])];
                                    next[idx] = { ...next[idx], x_pct: nextValue };
                                    setGuidedItemConfig({ ...guidedItemConfig, ocr_regions: next });
                                  }}
                                  className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                                />
                              </label>
                              <label className="text-xs text-slate-300">
                                y %
                                <DecimalInput
                                  value={region.y_pct}
                                  min={0}
                                  max={100}
                                  onValueChange={(nextValue) => {
                                    const next = [...(guidedItemConfig.ocr_regions || [])];
                                    next[idx] = { ...next[idx], y_pct: nextValue };
                                    setGuidedItemConfig({ ...guidedItemConfig, ocr_regions: next });
                                  }}
                                  className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                                />
                              </label>
                              <button
                                type="button"
                                onClick={() => {
                                  const next = (guidedItemConfig.ocr_regions || []).filter((_, i) => i !== idx);
                                  setGuidedItemConfig({ ...guidedItemConfig, ocr_regions: next });
                                }}
                                className="self-end rounded bg-rose-800 px-2 py-2 text-xs"
                              >
                                Suppr
                              </button>
                            </div>

                            <div className="mt-2 grid gap-2 sm:grid-cols-5">
                              <label className="text-xs text-slate-300">
                                Largeur %
                                <DecimalInput
                                  value={region.width_pct}
                                  min={0}
                                  max={100}
                                  onValueChange={(nextValue) => {
                                    const next = [...(guidedItemConfig.ocr_regions || [])];
                                    next[idx] = { ...next[idx], width_pct: nextValue };
                                    setGuidedItemConfig({ ...guidedItemConfig, ocr_regions: next });
                                  }}
                                  className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                                />
                              </label>
                              <label className="text-xs text-slate-300">
                                Hauteur %
                                <DecimalInput
                                  value={region.height_pct}
                                  min={0}
                                  max={100}
                                  onValueChange={(nextValue) => {
                                    const next = [...(guidedItemConfig.ocr_regions || [])];
                                    next[idx] = { ...next[idx], height_pct: nextValue };
                                    setGuidedItemConfig({ ...guidedItemConfig, ocr_regions: next });
                                  }}
                                  className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                                />
                              </label>
                              <label className="text-xs text-slate-300">
                                Marge %
                                <DecimalInput
                                  value={region.margin_pct ?? 2}
                                  min={0}
                                  max={100}
                                  onValueChange={(nextValue) => {
                                    const next = [...(guidedItemConfig.ocr_regions || [])];
                                    next[idx] = { ...next[idx], margin_pct: nextValue };
                                    setGuidedItemConfig({ ...guidedItemConfig, ocr_regions: next });
                                  }}
                                  className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                                />
                              </label>
                              <label className="text-xs text-slate-300">
                                Ancre texte
                                <input
                                  value={region.anchor_text || ""}
                                  onChange={(e) => {
                                    const next = [...(guidedItemConfig.ocr_regions || [])];
                                    next[idx] = { ...next[idx], anchor_text: e.target.value };
                                    setGuidedItemConfig({ ...guidedItemConfig, ocr_regions: next });
                                  }}
                                  placeholder="ex: signature du souscripteur"
                                  className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                                />
                              </label>
                              <label className="text-xs text-slate-300">
                                Mode ancre
                                <select
                                  value={region.anchor_mode || "contains"}
                                  onChange={(e) => {
                                    const next = [...(guidedItemConfig.ocr_regions || [])];
                                    next[idx] = {
                                      ...next[idx],
                                      anchor_mode: e.target.value as "contains" | "exact" | "regex",
                                    };
                                    setGuidedItemConfig({ ...guidedItemConfig, ocr_regions: next });
                                  }}
                                  className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                                >
                                  <option value="contains">contient</option>
                                  <option value="exact">exact</option>
                                  <option value="regex">regex</option>
                                </select>
                              </label>
                              <label className="text-xs text-slate-300">
                                Rayon recherche ancre %
                                <DecimalInput
                                  value={region.anchor_search_radius_pct ?? 0}
                                  min={0}
                                  max={100}
                                  onValueChange={(nextValue) => {
                                    const next = [...(guidedItemConfig.ocr_regions || [])];
                                    next[idx] = {
                                      ...next[idx],
                                      anchor_search_radius_pct: nextValue,
                                    };
                                    setGuidedItemConfig({ ...guidedItemConfig, ocr_regions: next });
                                  }}
                                  className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                                />
                              </label>
                              <label className="sm:col-span-2 text-xs text-slate-300">
                                Notes
                                <input
                                  value={region.notes || ""}
                                  onChange={(e) => {
                                    const next = [...(guidedItemConfig.ocr_regions || [])];
                                    next[idx] = { ...next[idx], notes: e.target.value };
                                    setGuidedItemConfig({ ...guidedItemConfig, ocr_regions: next });
                                  }}
                                  placeholder="ex: signature en bas à droite"
                                  className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                                />
                              </label>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}

                {settingsEditorTab === "variants" ? (
                  <div>
                    <div className="mb-4 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                      <label className="inline-flex items-center gap-3 text-sm text-slate-200">
                        <input
                          type="checkbox"
                          checked={guidedItemConfig.variant_required ?? true}
                          onChange={(e) =>
                            setGuidedItemConfig({
                              ...guidedItemConfig,
                              variant_required: e.target.checked,
                            })
                          }
                        />
                        Exiger un match de variant pour déclarer le document valide
                      </label>
                      <p className="mt-2 text-xs text-slate-500">
                        Désactive cette option si tu veux baser la validité uniquement sur la complétude des champs.
                      </p>
                    </div>

                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-sm font-medium text-slate-200">Variant signatures</p>
                      <button
                        type="button"
                        onClick={() =>
                          setGuidedItemConfig({
                            ...guidedItemConfig,
                            variant_signatures: [
                              ...guidedItemConfig.variant_signatures,
                              {
                                name: "new_variant",
                                page_count: 1,
                                dominant_keywords: [],
                                table_presence: false,
                                title_patterns: [],
                              },
                            ],
                          })
                        }
                        className="rounded bg-slate-700 px-2 py-1 text-xs"
                      >
                        + variant
                      </button>
                    </div>

                    <div className="space-y-3">
                      {guidedItemConfig.variant_signatures.map((variant, idx) => (
                        <div key={`variant-${idx}`} className="rounded border border-slate-800 p-3">
                          <div className="grid gap-2 sm:grid-cols-4">
                            <label className="text-xs text-slate-300">
                              Nom
                              <input
                                value={variant.name}
                                onChange={(e) => {
                                  const next = [...guidedItemConfig.variant_signatures];
                                  next[idx] = { ...next[idx], name: e.target.value };
                                  setGuidedItemConfig({ ...guidedItemConfig, variant_signatures: next });
                                }}
                                className="mt-1 h-10 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                              />
                            </label>
                            <label className="text-xs text-slate-300">
                              Nombre de pages
                              <input
                                type="number"
                                min="1"
                                value={variant.page_count}
                                onChange={(e) => {
                                  const next = [...guidedItemConfig.variant_signatures];
                                  next[idx] = { ...next[idx], page_count: Number(e.target.value) };
                                  setGuidedItemConfig({ ...guidedItemConfig, variant_signatures: next });
                                }}
                                className="mt-1 h-10 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                              />
                            </label>
                            <label className="inline-flex items-center gap-2 text-xs text-slate-300">
                              <input
                                type="checkbox"
                                checked={variant.table_presence}
                                onChange={(e) => {
                                  const next = [...guidedItemConfig.variant_signatures];
                                  next[idx] = { ...next[idx], table_presence: e.target.checked };
                                  setGuidedItemConfig({ ...guidedItemConfig, variant_signatures: next });
                                }}
                              />
                              table_presence
                            </label>
                            <button
                              type="button"
                              onClick={() => {
                                const next = guidedItemConfig.variant_signatures.filter((_, i) => i !== idx);
                                setGuidedItemConfig({ ...guidedItemConfig, variant_signatures: next });
                              }}
                              className="self-end rounded bg-rose-800 px-2 py-2 text-xs"
                            >
                              Suppr
                            </button>
                          </div>
                          <label className="mt-2 block text-xs text-slate-300">
                            Mots-clés dominants (séparés par virgule)
                            <input
                              value={variant.dominant_keywords.join(", ")}
                              onChange={(e) => {
                                const next = [...guidedItemConfig.variant_signatures];
                                next[idx] = {
                                  ...next[idx],
                                  dominant_keywords: e.target.value
                                    .split(",")
                                    .map((v) => v.trim())
                                    .filter(Boolean),
                                };
                                setGuidedItemConfig({ ...guidedItemConfig, variant_signatures: next });
                              }}
                              className="mt-1 h-10 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                            />
                          </label>
                          <label className="mt-2 block text-xs text-slate-300">
                            Titres repères (séparés par virgule)
                            <input
                              value={variant.title_patterns.join(", ")}
                              onChange={(e) => {
                                const next = [...guidedItemConfig.variant_signatures];
                                next[idx] = {
                                  ...next[idx],
                                  title_patterns: e.target.value
                                    .split(",")
                                    .map((v) => v.trim())
                                    .filter(Boolean),
                                };
                                setGuidedItemConfig({ ...guidedItemConfig, variant_signatures: next });
                              }}
                              className="mt-1 h-10 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                            />
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="mt-6 border-t border-slate-800 pt-4">
              <button
                type="button"
                onClick={() => setShowAdvancedConfig((v) => !v)}
                className="rounded-lg bg-slate-800 px-3 py-2 text-sm"
              >
                {showAdvancedConfig ? "Masquer JSON avancé" : "Afficher JSON avancé"}
              </button>
            </div>

            {showAdvancedConfig ? (
              <div className="mt-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="text-xs text-slate-300">
                    Type de configuration
                    <select
                      value={configKind}
                      onChange={(e) => setConfigKind(e.target.value as ConfigKind)}
                      className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                    >
                      <option value="item">item</option>
                      <option value="template">template</option>
                      <option value="global">global rules</option>
                    </select>
                  </label>

                  <label className="text-xs text-slate-300">
                    Nom
                    <select
                      value={configKind === "global" ? "rules" : configName}
                      onChange={(e) => setConfigName(e.target.value)}
                      disabled={configKind === "global"}
                      className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm disabled:opacity-40"
                    >
                      {configKind === "global" ? (
                        <option value="rules">rules</option>
                      ) : (
                        optionList.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))
                      )}
                    </select>
                  </label>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={loadConfig}
                      disabled={configBusy}
                      className="rounded-lg bg-slate-700 px-3 py-2 text-sm"
                    >
                      Charger
                    </button>
                    <button
                      type="button"
                      onClick={saveConfig}
                      disabled={configBusy}
                      className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950"
                    >
                      Sauvegarder
                    </button>
                  </div>
                </div>

                <label className="mt-4 block text-xs text-slate-300">
                  JSON configuration
                  <textarea
                    value={configText}
                    onChange={(e) => setConfigText(e.target.value)}
                    className="mt-1 min-h-[320px] w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs"
                  />
                </label>
                {configMessage ? (
                  <p className="mt-2 text-sm text-slate-300">{configMessage}</p>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}

        {tab === "training" ? (
          <section className="mt-6 rounded-xl border border-slate-800 bg-slate-900/70 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-slate-300">
                Nom de l&apos;item
                <input
                  value={trainingItem}
                  onChange={(e) => setTrainingItem(e.target.value)}
                  placeholder="nouvel_item"
                  className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                />
              </label>
            </div>

            <label className="mt-4 block text-xs text-slate-300">
              Documents (PDF ou Excel natif) (multi-sélection)
              <input
                ref={trainingInputRef}
                type="file"
                accept=".pdf,.xlsx,.xlsm,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12"
                multiple
                onChange={onTrainingFiles}
                className="mt-1 block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-emerald-500 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-950"
              />
            </label>
            <p className="mt-2 text-xs text-slate-400">
              {trainingFiles.length} fichier(s) sélectionné(s)
            </p>
            {trainingFiles.length > 0 &&
            new Set(trainingFiles.map((f) => detectDocumentType(f))).size === 1 &&
            detectDocumentType(trainingFiles[0]) === "excel" ? (
              <label className="mt-3 block text-xs text-slate-300">
                Excel: position des intitulés
                <select
                  value={trainingExcelHeaderAxis}
                  onChange={(e) =>
                    setTrainingExcelHeaderAxis(
                      e.target.value as "first_row" | "first_column",
                    )
                  }
                  className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                >
                  <option value="first_row">Première ligne</option>
                  <option value="first_column">Première colonne</option>
                </select>
              </label>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={runTraining}
                disabled={trainingBusy}
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
              >
                {trainingBusy ? "Training en cours..." : "Générer un item"}
              </button>
              <button
                type="button"
                onClick={clearTrainingFiles}
                disabled={trainingBusy || trainingFiles.length === 0}
                className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-slate-100 disabled:opacity-50"
              >
                Supprimer les fichiers chargés
              </button>
            </div>

            {trainingMessage ? (
              <p className="mt-2 text-sm text-slate-300">{trainingMessage}</p>
            ) : null}

            {trainingTrace.length > 0 ? (
              <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950 p-3">
                <p className="mb-2 text-xs font-semibold text-slate-300">Trace training</p>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap text-xs text-slate-400">
                  {trainingTrace.join("\n")}
                </pre>
              </div>
            ) : null}

            {trainingResult ? (
              <div className="mt-3 rounded-lg border border-emerald-700/50 bg-emerald-950/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-emerald-200">
                    Résultat: item <b>{trainingResult.item}</b> sauvegardé dans{" "}
                    <code>{trainingResult.saved_to}</code>
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowTrainingResult((v) => !v)}
                    className="rounded-lg bg-emerald-900/60 px-3 py-1.5 text-xs font-semibold text-emerald-100"
                  >
                    {showTrainingResult ? "Masquer" : "Afficher"}
                  </button>
                </div>
                {showTrainingResult ? (
                  <>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-emerald-100">
                      {JSON.stringify(trainingResult.config, null, 2)}
                    </pre>
                    {trainingResult.config.audit?.document_type === "excel" ? (
                      <div className="mt-3 rounded border border-emerald-700/50 bg-slate-950/60 p-3 text-xs text-emerald-100">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-semibold">
                            Debug Excel (training): paires détectées (intitulé: valeur)
                          </p>
                          <button
                            type="button"
                            onClick={() => setShowTrainingDebug((v) => !v)}
                            className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200"
                          >
                            {showTrainingDebug ? "Masquer" : "Afficher"}
                          </button>
                        </div>
                        {showTrainingDebug ? (
                          trainingResult.config.audit?.excel_pairs_preview &&
                          trainingResult.config.audit.excel_pairs_preview.length > 0 ? (
                            <ul className="mt-2">
                              {trainingResult.config.audit.excel_pairs_preview.map((line, idx) => (
                                <li
                                  key={`training-excel-pair-${idx}`}
                                  className="border-t border-slate-800 py-2 first:border-t-0 first:pt-0 last:pb-0"
                                >
                                  {line}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="mt-2 text-emerald-200/80">Aucune paire détectée.</p>
                          )
                        ) : null}
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}
      </section>
    </main>
  );
}
