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
  processing_time_ms: number;
};

type Tab = "analyze" | "config" | "training";
type ConfigKind = "item" | "template" | "global";

type RequiredElement = {
  name: string;
  weight: number;
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
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);

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

  const [trainingItem, setTrainingItem] = useState("nouvel_item");
  const [trainingTemplate, setTrainingTemplate] = useState("contract");
  const [trainingFiles, setTrainingFiles] = useState<File[]>([]);
  const [trainingBusy, setTrainingBusy] = useState(false);
  const [trainingMessage, setTrainingMessage] = useState<string | null>(null);
  const [trainingTrace, setTrainingTrace] = useState<string[]>([]);
  const [trainingResult, setTrainingResult] = useState<TrainingBuildResponse | null>(null);
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

  useEffect(() => {
    if (templates.length === 0) return;
    if (!templates.includes(trainingTemplate)) {
      setTrainingTemplate(templates[0]);
    }
  }, [templates, trainingTemplate]);

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] ?? null;
    setFile(nextFile);
    setResult(null);
    setError(null);
  };

  const onAnalyzeSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setResult(null);

    if (!file) {
      setError("Sélectionne un PDF avant de lancer l'analyse.");
      return;
    }

    if (file.type !== "application/pdf") {
      setError("Le fichier doit être un PDF.");
      return;
    }

    setLoading(true);
    try {
      const base64 = await fileToBase64(file);
      const body = await fetchJson<AnalyzeResponse>(
        "/api/document-engine/analyze",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ item, documents: [base64] }),
        },
      );
      setResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
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
      cfg.required_elements = cfg.required_elements || [];
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

  const onTrainingFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []).filter(
      (f) => f.type === "application/pdf",
    );
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
    try {
      pushTrainingTrace("Début du training");
      if (trainingFiles.length < 3) {
        pushTrainingTrace(`Validation échouée: ${trainingFiles.length} PDF fourni(s)`);
        throw new Error("Ajoute au moins 3 PDF (idéalement 5 à 10).");
      }
      pushTrainingTrace(`Validation OK: ${trainingFiles.length} PDF`);

      const docs: string[] = [];
      for (let i = 0; i < trainingFiles.length; i += 1) {
        const file = trainingFiles[i];
        pushTrainingTrace(`Encodage PDF ${i + 1}/${trainingFiles.length}: ${file.name}`);
        docs.push(await fileToBase64(file));
      }
      pushTrainingTrace("Encodage terminé, envoi au backend");

      const response = await fetch("/api/document-engine/training/build-item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item: trainingItem,
          template: trainingTemplate,
          language: "fr",
          threshold: 0.7,
          documents: docs,
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
      setGuidedItemConfig(result.config);
      await refreshLists();
      clearTrainingFiles();
      setGuidedItemName(result.item);
      setTab("config");
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
            ["config", "Paramétrage"],
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
                  PDF
                </label>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={onFileChange}
                  className="block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-emerald-500 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-950"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
              >
                {loading ? "Analyse en cours..." : "Lancer l'analyse"}
              </button>

              {error ? <p className="text-sm text-rose-300">{error}</p> : null}
            </form>

            {result ? (
              <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/70 p-5">
                <p className="text-sm text-slate-300">
                  Score: <b>{scorePercent}%</b> | Validité:{" "}
                  <b>{result.valid ? "valide" : "invalide"}</b>
                </p>
                <p className="mt-1 text-sm text-slate-300">
                  Variant: <b>{result.variant_detected || "non détectée"}</b>
                  {" "}(score {result.variant_score.toFixed(2)})
                </p>
                <p className="mt-1 text-sm text-slate-300">
                  Poids détecté: <b>{result.matched_weight_sum}</b> / {result.total_weight_sum}
                  {" "}| Seuil: {result.threshold}
                </p>
                <p className="mt-1 text-sm text-slate-300">
                  OCR: {result.ocr_used ? "oui" : "non"} | Temps:{" "}
                  {result.processing_time_ms} ms
                </p>
                <p className="mt-2 text-sm text-slate-300">
                  Éléments manquants: {result.missing_elements.join(", ") || "aucun"}
                </p>
              </div>
            ) : null}
          </section>
        ) : null}

        {tab === "config" ? (
          <section className="mt-6 rounded-xl border border-slate-800 bg-slate-900/70 p-5">
            <h2 className="text-lg font-semibold">Éditeur guidé d&apos;item</h2>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <select
                value={guidedItemName}
                onChange={(e) => {
                  const nextItem = e.target.value;
                  setGuidedItemName(nextItem);
                  loadGuidedItem(nextItem).catch(() => undefined);
                }}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              >
                {items.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  loadGuidedItem().catch(() => undefined);
                }}
                disabled={guidedBusy}
                className="rounded-lg bg-slate-700 px-3 py-2 text-sm"
              >
                Charger item
              </button>
              <button
                type="button"
                onClick={saveGuidedItem}
                disabled={guidedBusy || !guidedItemConfig}
                className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950"
              >
                Sauvegarder item
              </button>
            </div>

            {guidedItemConfig ? (
              <div className="mt-4 space-y-4 rounded-lg border border-slate-800 bg-slate-950 p-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <input
                    value={guidedItemConfig.language || "fr"}
                    onChange={(e) =>
                      setGuidedItemConfig({ ...guidedItemConfig, language: e.target.value })
                    }
                    placeholder="language"
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                  />
                  <input
                    value={guidedItemConfig.template || "contract"}
                    onChange={(e) =>
                      setGuidedItemConfig({ ...guidedItemConfig, template: e.target.value })
                    }
                    placeholder="template"
                    list="template-names"
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                  />
                  <datalist id="template-names">
                    {templates.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
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
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                  />
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
                            { name: "nouvel_element", weight: 1 },
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
                      <div key={`${element.name}-${idx}`} className="grid gap-2 sm:grid-cols-6">
                        <input
                          value={element.name}
                          onChange={(e) => {
                            const next = [...guidedItemConfig.required_elements];
                            next[idx] = { ...next[idx], name: e.target.value };
                            setGuidedItemConfig({ ...guidedItemConfig, required_elements: next });
                          }}
                          className="sm:col-span-4 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                        />
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
                          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const next = guidedItemConfig.required_elements.filter((_, i) => i !== idx);
                            setGuidedItemConfig({ ...guidedItemConfig, required_elements: next });
                          }}
                          className="rounded bg-rose-800 px-2 py-1 text-xs"
                        >
                          Suppr
                        </button>
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
                      <div key={`${variant.name}-${idx}`} className="rounded border border-slate-800 p-3">
                        <div className="grid gap-2 sm:grid-cols-4">
                          <input
                            value={variant.name}
                            onChange={(e) => {
                              const next = [...guidedItemConfig.variant_signatures];
                              next[idx] = { ...next[idx], name: e.target.value };
                              setGuidedItemConfig({ ...guidedItemConfig, variant_signatures: next });
                            }}
                            className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                            placeholder="name"
                          />
                          <input
                            type="number"
                            min="1"
                            value={variant.page_count}
                            onChange={(e) => {
                              const next = [...guidedItemConfig.variant_signatures];
                              next[idx] = { ...next[idx], page_count: Number(e.target.value) };
                              setGuidedItemConfig({ ...guidedItemConfig, variant_signatures: next });
                            }}
                            className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                            placeholder="page_count"
                          />
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
                            className="rounded bg-rose-800 px-2 py-1 text-xs"
                          >
                            Suppr
                          </button>
                        </div>
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
                          className="mt-2 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                          placeholder="dominant_keywords (comma-separated)"
                        />
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
                          className="mt-2 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                          placeholder="title_patterns (comma-separated)"
                        />
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
                  <select
                    value={configKind}
                    onChange={(e) => setConfigKind(e.target.value as ConfigKind)}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  >
                    <option value="item">item</option>
                    <option value="template">template</option>
                    <option value="global">global rules</option>
                  </select>

                  <select
                    value={configKind === "global" ? "rules" : configName}
                    onChange={(e) => setConfigName(e.target.value)}
                    disabled={configKind === "global"}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm disabled:opacity-40"
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

                <textarea
                  value={configText}
                  onChange={(e) => setConfigText(e.target.value)}
                  className="mt-4 min-h-[320px] w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs"
                />
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
              <input
                value={trainingItem}
                onChange={(e) => setTrainingItem(e.target.value)}
                placeholder="nouvel_item"
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              />
              <select
                value={trainingTemplate}
                onChange={(e) => setTrainingTemplate(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              >
                {templates.length === 0 ? (
                  <option value="contract">contract</option>
                ) : (
                  templates.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))
                )}
              </select>
            </div>

            <input
              ref={trainingInputRef}
              type="file"
              accept="application/pdf"
              multiple
              onChange={onTrainingFiles}
              className="mt-4 block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-emerald-500 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-950"
            />
            <p className="mt-2 text-xs text-slate-400">
              {trainingFiles.length} PDF sélectionné(s)
            </p>

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
                Supprimer les PDF chargés
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
                <p className="text-xs text-emerald-200">
                  Résultat: item <b>{trainingResult.item}</b> sauvegardé dans{" "}
                  <code>{trainingResult.saved_to}</code>
                </p>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-emerald-100">
                  {JSON.stringify(trainingResult.config, null, 2)}
                </pre>
              </div>
            ) : null}
          </section>
        ) : null}
      </section>
    </main>
  );
}
