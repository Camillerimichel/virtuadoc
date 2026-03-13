"use client";

import {
  ChangeEvent,
  FormEvent,
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

type DocumentType = "pdf" | "excel";

type Tab = "analyze" | "settings" | "training";
type ConfigKind = "item" | "template" | "global";

type RequiredElement = {
  name: string;
  weight: number;
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

type ItemConfig = {
  item: string;
  language: string;
  template: string;
  threshold: number;
  required_elements: RequiredElement[];
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
    required_elements: [],
    variants: [],
    variant_signatures: [],
  };
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("analyze");

  const [items, setItems] = useState<string[]>(["contrat_assurance_vie"]);
  const [templates, setTemplates] = useState<string[]>([]);

  const [item, setItem] = useState("contrat_assurance_vie");
  const [analyzeOcrMode, setAnalyzeOcrMode] = useState<"auto" | "native" | "ocr">("auto");
  const [analyzeExcelHeaderAxis, setAnalyzeExcelHeaderAxis] =
    useState<"first_row" | "first_column">("first_row");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
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
  const [showConfigHelp, setShowConfigHelp] = useState(false);
  const [duplicateItemName, setDuplicateItemName] = useState("");

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

  const scorePercent = useMemo(() => {
    if (!result) return 0;
    return Math.round(result.score * 100);
  }, [result]);

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
    const nextFile = event.target.files?.[0] ?? null;
    const nextType = nextFile ? detectDocumentType(nextFile) : null;
    if (nextFile && !nextType) {
      setFile(null);
      setError("Formats supportés: PDF, XLSX, XLSM.");
      setResult(null);
      setAnalyzeTrace([]);
      return;
    }
    setFile(nextFile);
    if (nextType === "excel") {
      setAnalyzeOcrMode("native");
    }
    setResult(null);
    setError(null);
    setAnalyzeTrace([]);
    setShowAnalyzeTrace(false);
    setShowAnalyzeDetectedFields(false);
    setShowAnalyzeDebug(false);
  };

  const pushAnalyzeTrace = (message: string) => {
    const stamp = new Date().toISOString().slice(11, 19);
    setAnalyzeTrace((prev) => [...prev, `[${stamp}] ${message}`]);
  };

  const onAnalyzeSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setResult(null);
    setAnalyzeTrace([]);
    setShowAnalyzeTrace(true);
    setShowAnalyzeDetectedFields(false);
    setShowAnalyzeDebug(false);
    pushAnalyzeTrace("Début de l'analyse");

    if (!file) {
      pushAnalyzeTrace("Validation échouée: aucun fichier sélectionné");
      setError("Sélectionne un fichier (PDF ou Excel) avant de lancer l'analyse.");
      setShowAnalyzeTrace(false);
      return;
    }

    const documentType = detectDocumentType(file);
    if (!documentType) {
      pushAnalyzeTrace(`Validation échouée: type invalide (${file.type || "inconnu"})`);
      setError("Le fichier doit être un PDF, XLSX ou XLSM.");
      setShowAnalyzeTrace(false);
      return;
    }

    if (documentType === "excel" && analyzeOcrMode === "ocr") {
      setAnalyzeOcrMode("auto");
    }

    pushAnalyzeTrace(`Validation OK: ${file.name} (${documentType})`);
    setLoading(true);
    try {
      pushAnalyzeTrace("Encodage Base64 du fichier");
      const base64 = await fileToBase64(file);
      pushAnalyzeTrace(`Encodage terminé (${Math.round(base64.length / 1024)} KB Base64)`);
      const modeToSend = documentType === "excel" ? "native" : analyzeOcrMode;
      pushAnalyzeTrace(
        `Envoi au backend (item: ${item}, type: ${documentType}, mode: ${modeToSend}${documentType === "excel" ? `, intitulés=${analyzeExcelHeaderAxis}` : ""})`,
      );
      const body = await fetchJson<AnalyzeResponse>(
        "/api/document-engine/analyze",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            item,
            documents: [base64],
            ocr_mode: modeToSend,
            document_type: documentType,
            excel_header_axis: analyzeExcelHeaderAxis,
          }),
        },
      );
      pushAnalyzeTrace("Réponse backend reçue");
      pushAnalyzeTrace(
        `Résultat: valid=${body.valid ? "oui" : "non"}, score=${Math.round(body.score * 100)}%, OCR=${body.ocr_used ? "oui" : "non"} (demandé=${body.ocr_mode_requested}, appliqué=${body.ocr_mode_applied}, tenté=${body.ocr_attempted ? "oui" : "non"}, blocs=${body.ocr_blocks_count})`,
      );
      if (body.ocr_error) {
        pushAnalyzeTrace(`Erreur OCR: ${body.ocr_error}`);
      }
      pushAnalyzeTrace(
        `Champs détectés: ${body.elements_found.length}, manquants: ${body.missing_elements.length}`,
      );
      setResult(body);
    } catch (err) {
      pushAnalyzeTrace(
        `Erreur attrapée: ${err instanceof Error ? err.message : "Erreur inconnue"}`,
      );
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      pushAnalyzeTrace("Fin de l'analyse");
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
    try {
      const body = await fetchJson<{ config: ItemConfig }>(
        `/api/document-engine/config/items/${targetItem}`,
      );
      const cfg = body.config;
      cfg.required_elements = (cfg.required_elements || []).map((entry) => ({
        ...entry,
        strategy: entry.strategy || "keyword",
      }));
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
    } catch (err) {
      setGuidedMessage(err instanceof Error ? err.message : "Erreur de sauvegarde");
    } finally {
      setGuidedBusy(false);
    }
  };

  const duplicateGuidedItem = async () => {
    if (!guidedItemConfig) return;
    const nextItemName = duplicateItemName.trim();
    if (!nextItemName) {
      setGuidedMessage("Renseigne un nom d'item pour la duplication.");
      return;
    }

    setGuidedBusy(true);
    setGuidedMessage(null);
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
    } catch (err) {
      setGuidedMessage(err instanceof Error ? err.message : "Erreur de duplication");
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
    try {
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
      setGuidedMessage(`Item '${guidedItemName}' supprimé.`);
    } catch (err) {
      setGuidedMessage(err instanceof Error ? err.message : "Erreur de suppression");
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
                  Item
                </label>
                <select
                  value={item}
                  onChange={(e) => setItem(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                >
                  {items.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">
                  Document (PDF ou Excel natif)
                </label>
                <input
                  type="file"
                  accept=".pdf,.xlsx,.xlsm,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12"
                  onChange={onFileChange}
                  className="block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-emerald-500 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-950"
                />
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
                    disabled={file ? detectDocumentType(file) === "excel" : false}
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

              {file && detectDocumentType(file) === "excel" ? (
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

            {result ? (
              <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/70 p-5">
                <p className="text-sm font-semibold text-slate-200">Score</p>
                <div className="mt-2 space-y-1 text-sm text-slate-300">
                  <p>
                    Score global: <b>{scorePercent}%</b>
                  </p>
                  <p>
                    Validité: <b>{result.valid ? "valide" : "invalide"}</b>
                  </p>
                  <p>
                    Variant: <b>{result.variant_detected || "non détectée"}</b> (score{" "}
                    {result.variant_score.toFixed(2)})
                  </p>
                  <p>
                    Poids détecté: <b>{result.matched_weight_sum}</b> / {result.total_weight_sum}
                    {" "}| Seuil: {result.threshold}
                  </p>
                  <p>
                    Type de document: <b>{result.document_type}</b>
                  </p>
                  <p>
                    OCR: {result.ocr_used ? "oui" : "non"} (demandé: {result.ocr_mode_requested},
                    appliqué: {result.ocr_mode_applied}, tenté:{" "}
                    {result.ocr_attempted ? "oui" : "non"}, blocs:{" "}
                    {result.ocr_blocks_count}) | Temps: {result.processing_time_ms} ms
                  </p>
                </div>
                {result.ocr_error ? (
                  <p className="mt-1 text-sm text-rose-300">
                    Erreur OCR: {result.ocr_error}
                  </p>
                ) : null}
                <p className="mt-2 text-sm text-slate-300">
                  Éléments manquants: {result.missing_elements.join(", ") || "aucun"}
                </p>
                {result.elements_found.length > 0 ? (
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
                        {result.elements_found.map((entry, idx) => (
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
                        {result.elements_found.map((entry, idx) => (
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
                {result.document_type === "excel" ? (
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
                      result.excel_pairs_preview.length > 0 ? (
                        <ul className="mt-2">
                          {result.excel_pairs_preview.map((line, idx) => (
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
                            { name: "nouvel_element", weight: 1, strategy: "keyword" },
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

                <div>
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
              </div>
            ) : null}

            {guidedMessage ? (
              <p className="mt-3 text-sm text-slate-300">{guidedMessage}</p>
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
