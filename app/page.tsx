"use client";

import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
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

  const [trainingItem, setTrainingItem] = useState("nouvel_item");
  const [trainingTemplate, setTrainingTemplate] = useState("contract");
  const [trainingFiles, setTrainingFiles] = useState<File[]>([]);
  const [trainingBusy, setTrainingBusy] = useState(false);
  const [trainingMessage, setTrainingMessage] = useState<string | null>(null);

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
      const body = await fetchJson<AnalyzeResponse>("/api/document-engine/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item, documents: [base64] }),
      });
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
        body = await fetchJson<{ config: unknown }>("/api/document-engine/config/global-rules");
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

  const onTrainingFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []).filter(
      (f) => f.type === "application/pdf",
    );
    setTrainingFiles(files);
  };

  const runTraining = async () => {
    setTrainingBusy(true);
    setTrainingMessage(null);
    try {
      if (trainingFiles.length < 3) {
        throw new Error("Ajoute au moins 3 PDF (idéalement 5 à 10)."
        );
      }
      const docs = await Promise.all(trainingFiles.map((f) => fileToBase64(f)));
      await fetchJson("/api/document-engine/training/build-item", {
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
      await refreshLists();
      setTrainingMessage(`Item '${trainingItem}' généré et sauvegardé.`);
    } catch (err) {
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
                <label className="mb-2 block text-sm font-medium text-slate-200">Item</label>
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
                <label className="mb-2 block text-sm font-medium text-slate-200">PDF</label>
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
                  Score: <b>{scorePercent}%</b> | Validité: <b>{result.valid ? "valide" : "invalide"}</b>
                </p>
                <p className="mt-1 text-sm text-slate-300">
                  Variant: <b>{result.variant_detected || "non détectée"}</b> (score {result.variant_score.toFixed(2)})
                </p>
                <p className="mt-1 text-sm text-slate-300">
                  Poids détecté: <b>{result.matched_weight_sum}</b> / {result.total_weight_sum} | Seuil: {result.threshold}
                </p>
                <p className="mt-1 text-sm text-slate-300">
                  OCR: {result.ocr_used ? "oui" : "non"} | Temps: {result.processing_time_ms} ms
                </p>
                <p className="mt-2 text-sm text-slate-300">Éléments manquants: {result.missing_elements.join(", ") || "aucun"}</p>
              </div>
            ) : null}
          </section>
        ) : null}

        {tab === "config" ? (
          <section className="mt-6 rounded-xl border border-slate-800 bg-slate-900/70 p-5">
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

              <input
                value={configName}
                onChange={(e) => setConfigName(e.target.value)}
                list="config-names"
                disabled={configKind === "global"}
                placeholder={configKind === "global" ? "rules" : "name"}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm disabled:opacity-40"
              />
              <datalist id="config-names">
                {optionList.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>

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
              className="mt-4 min-h-[420px] w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs"
            />
            {configMessage ? <p className="mt-2 text-sm text-slate-300">{configMessage}</p> : null}
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
              <input
                value={trainingTemplate}
                onChange={(e) => setTrainingTemplate(e.target.value)}
                placeholder="contract"
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              />
            </div>

            <input
              type="file"
              accept="application/pdf"
              multiple
              onChange={onTrainingFiles}
              className="mt-4 block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-emerald-500 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-950"
            />
            <p className="mt-2 text-xs text-slate-400">{trainingFiles.length} PDF sélectionné(s)</p>

            <button
              type="button"
              onClick={runTraining}
              disabled={trainingBusy}
              className="mt-4 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
            >
              {trainingBusy ? "Training en cours..." : "Générer un item"}
            </button>

            {trainingMessage ? <p className="mt-2 text-sm text-slate-300">{trainingMessage}</p> : null}
          </section>
        ) : null}
      </section>
    </main>
  );
}
