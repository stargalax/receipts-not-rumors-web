import { useState, useRef } from "react";
import { createWorker } from "tesseract.js";
import { CreateMLCEngine } from "@mlc-ai/web-llm";
import "./App.css";

const MODEL = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";

const SYSTEM_PROMPT = `
You are Receipts, Not Rumors, an evidence research assistant.

Analyze screenshots, copied posts, notes, and web search results.
Never invent dates, quotations, facts, or URLs.
Distinguish direct evidence from claims and interpretations.
Treat search snippets as leads, not proof.
Do not infer private relationships or intentions from ambiguous posts.

Return valid JSON only:
{
  "summary": "Brief overview",
  "timeline": [
    {
      "sourceId": "S1",
      "event": "What the source says",
      "date": null,
      "status": "reported claim",
      "explanation": "Context and limitations",
      "confidence": "low"
    }
  ],
  "connections": [
    {
      "title": "Possible connection",
      "sourceIds": ["S1", "S2"],
      "reason": "Why these sources may be related",
      "caveat": "What this does not establish"
    }
  ],
  "unknowns": ["What remains unverified"],
  "bottomLine": "Careful overall conclusion"
}

Use only supplied source IDs. Use null for unknown dates.
Confidence describes support in the provided material, not objective truth.
`;

function TimelineTrack({ items }) {
  const [tip, setTip] = useState(null);

  const dated = items.filter((i) => i.ts != null).sort((a, b) => a.ts - b.ts);
  const undated = items.filter((i) => i.ts == null);
  const ordered = [...dated, ...undated];

  if (ordered.length === 0) return null;

  function show(item, el) {
    const r = el.getBoundingClientRect();
    const width = 240;
    const left = Math.min(
      Math.max(r.left + r.width / 2 - width / 2, 8),
      window.innerWidth - width - 8
    );
    setTip({ item, left, top: r.top - 10 });
  }

  function open(item) {
    if (item.url) {
      window.open(item.url, "_blank", "noopener,noreferrer");
    } else {
      document
        .getElementById(`source-${item.sourceId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  return (
    <div className="track-wrap">
      <div className="track" onScroll={() => setTip(null)}>
        <div className="track-line" />
        {ordered.map((item, i) => (
          <div className="track-slot" key={`${item.sourceId}-${i}`}>
            <button
              className={`blob conf-${(item.confidence || "low").toLowerCase()} ${item.ts == null ? "undated" : ""
                }`}
              onMouseEnter={(e) => show(item, e.currentTarget)}
              onMouseLeave={() => setTip(null)}
              onFocus={(e) => show(item, e.currentTarget)}
              onBlur={() => setTip(null)}
              onClick={() => open(item)}
              aria-label={item.event}
            />
            <div className="blob-date">{item.date || "undated"}</div>
          </div>
        ))}
      </div>

      {tip && (
        <div className="blob-tip" role="tooltip" style={{ left: tip.left, top: tip.top }}>
          <strong>{tip.item.event}</strong>
          <span>
            {[tip.item.sourceId, `${tip.item.confidence || "low"} confidence`, tip.item.status]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <small>
            {tip.item.url ? "Click to open source ↗" : "Click to jump to source"}
          </small>
        </div>
      )}

      <div className="track-legend">
        <span><i className="conf-high" /> high</span>
        <span><i className="conf-medium" /> medium</span>
        <span><i className="conf-low" /> low</span>
        <span><i className="undated" /> date unknown (hollow)</span>
      </div>
    </div>
  );
}

export default function App() {
  const [question, setQuestion] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState([]);
  const [sources, setSources] = useState([]);
  const [report, setReport] = useState(null);
  const [status, setStatus] = useState("Ready when you are");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [modelStatus, setModelStatus] = useState("Qwen not loaded");
  const [analyzing, setAnalyzing] = useState(false);
  const engineRef = useRef(null);

  function loadDemo() {
    setQuestion(
      "What happened first? Which connections are supported by evidence, and what remains speculation?"
    );
    setNotes(
      "FICTIONAL DEMO ONLY. A fan account shares a public post. Another account interprets it as referring to someone else. We need to distinguish original evidence from speculation."
    );
    setFiles([]);
    setSources([]);
    setReport(null);
    setError("");
  }
  async function getQwenEngine() {
    if (engineRef.current) return engineRef.current;

    if (!navigator.gpu) {
      throw new Error(
        "WebGPU is unavailable. Try a recent version of Chrome or Edge."
      );
    }

    setModelStatus("Downloading Qwen model...");

    const engine = await CreateMLCEngine(MODEL, {
      initProgressCallback: (progress) => {
        setModelStatus(progress.text || "Loading Qwen...");
      },
    });

    engineRef.current = engine;
    setModelStatus("Qwen ready");
    return engine;
  }



  async function analyzeEvidence() {
    if (sources.length === 0) {
      setError("Collect some screenshots or text first.");
      return;
    }

    setAnalyzing(true);
    setError("");
    setReport(null);

    try {
      const engine = await getQwenEngine();
      let webSources = [];

      // 1. Ask Qwen to create focused search queries.
      setModelStatus("Preparing web searches...");

      if (question.trim()) {
        try {
          const queryResponse = await engine.chat.completions.create({
            messages: [
              {
                role: "system",
                content: `You are a research assistant.
Generate up to three concise Google search queries to find original sources
and credible reporting about the supplied evidence.
Do not assume any allegation or rumor is true.
Return JSON only in this format: {"queries":["query one","query two"]}.`,
              },
              {
                role: "user",
                content: JSON.stringify({
                  question,
                  evidence: sources.map((source) => ({
                    id: source.id,
                    title: source.title,
                    text: source.text.slice(0, 700),
                  })),
                }),
              },
            ],
            temperature: 0.1,
            max_tokens: 250,
          });

          const queryText = queryResponse.choices?.[0]?.message?.content
            ?.trim()
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/, "");

          const queryPlan = JSON.parse(queryText || '{"queries":[]}');
          const queries = (queryPlan.queries || [])
            .filter((query) => typeof query === "string" && query.trim())
            .slice(0, 3);

          // 2. Call our backend, which keeps the API key private.
          if (queries.length > 0) {
            setModelStatus("Searching public web sources...");

            const response = await fetch("/api/search", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ queries }),
            });

            const data = await response.json();

            if (!response.ok) {
              throw new Error(data.error || "Web search failed.");
            }

            const seenUrls = new Set(
              sources.map((source) => source.url).filter(Boolean)
            );

            webSources = (data.results || [])
              .filter((item) => item.url && !seenUrls.has(item.url))
              .map((item, index) => ({
                id: `S${sources.length + index + 1}`,
                kind: "Web search result",
                title: item.title || "Untitled result",
                text: [
                  item.snippet || "No search snippet provided.",
                  item.date ? `Search result date: ${item.date}` : "",
                  `Search query: ${item.query || ""}`,
                  "This is a search snippet, not independently verified article text.",
                ].filter(Boolean).join("\n"),
                date: item.date || null,
                url: item.url,
              }));
          }
        } catch (searchError) {
          console.warn("Web search unavailable:", searchError);
          setModelStatus("Web search unavailable; analyzing supplied evidence.");
        }
      }

      // 3. Combine uploaded evidence and search results.
      const allSources = [...sources, ...webSources];
      setSources(allSources);

      // 4. Ask Qwen to build the timeline from all available sources.
      setModelStatus("Building your evidence timeline...");

      const response = await engine.chat.completions.create({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: JSON.stringify({
              question,
              evidence: allSources.map((source) => ({
                id: source.id,
                kind: source.kind,
                title: source.title,
                text: source.text.slice(0, 2500),
                date: source.date,
                url: source.url,
              })),
              instructions: `
Build a chronological evidence timeline.
Use only supplied source IDs.
Separate direct evidence, reported claims, and interpretations.
Search snippets are leads, not proof.
Do not invent dates or infer private relationships.
Explicitly explain what remains unknown.
`,
            }),
          },
        ],
        temperature: 0.1,
        max_tokens: 1400,
      });

      const content = response.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error("Qwen returned an empty response.");
      }

      const cleaned = content
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");

      const parsed = JSON.parse(cleaned);
      const validIds = new Set(allSources.map((source) => source.id));
      const sourceById = new Map(allSources.map((s) => [s.id, s]));

      parsed.timeline = (parsed.timeline || []).map((item) => {
        const src = sourceById.get(item.sourceId);
        const date = src?.date || item.date || null;
        const ts = date ? Date.parse(date) : NaN;

        return {
          ...item,
          sourceId: src ? item.sourceId : "Unknown source",
          date,
          ts: Number.isNaN(ts) ? null : ts, // null = can't be placed chronologically
          url: src?.url || "",
          sourceTitle: src?.title || "",
        };
      });

      parsed.connections = (parsed.connections || []).map((item) => ({
        ...item,
        sourceIds: (item.sourceIds || []).filter((id) => validIds.has(id)),
      }));

      setReport(parsed);
      setModelStatus(
        `Analysis complete · ${allSources.length} sources collected`
      );
    } catch (err) {
      setError(`Analysis failed: ${err.message}`);
      setModelStatus("Analysis needs attention");
    } finally {
      setAnalyzing(false);
    }
  }



  async function investigate() {
    if (!question.trim() && !notes.trim() && files.length === 0) {
      setError("Add a question, screenshot, link, or text first.");
      return;
    }

    setBusy(true);
    setError("");
    setReport(null);
    setSources([]);

    try {
      setStatus("Preparing your evidence...");

      // Store all evidence collected during this investigation.
      const evidence = [];

      // 1. Read uploaded screenshots and text files.
      for (const file of files) {
        if (file.type.startsWith("image/")) {
          setStatus(`Reading screenshot: ${file.name}`);

          const worker = await createWorker("eng");

          try {
            const result = await worker.recognize(file);
            const extractedText = result.data.text.trim();

            evidence.push({
              id: `S${evidence.length + 1}`,
              kind: "Screenshot / OCR",
              title: file.name,
              text: extractedText || "No readable text detected. Inspect the image.",
              image: URL.createObjectURL(file),
              date: null,
              url: "",
              ocrConfidence: Math.round(result.data.confidence || 0),
            });
          } finally {
            await worker.terminate();
          }
        } else {
          const text = await file.text();

          evidence.push({
            id: `S${evidence.length + 1}`,
            kind: "Uploaded text",
            title: file.name,
            text,
            date: null,
            url: "",
          });
        }
      }

      // 2. Collect pasted URLs.
      const urls = [
        ...new Set(notes.match(/https?:\/\/[^\s<>"']+/g) || []),
      ];

      // 3. Collect the user's notes separately.
      const plainText = notes
        .replace(/https?:\/\/[^\s<>"']+/g, "")
        .trim();

      if (plainText) {
        evidence.push({
          id: `S${evidence.length + 1}`,
          kind: "Your notes",
          title: "Investigation notes",
          text: plainText,
          date: null,
          url: "",
        });
      }

      // 4. Add links as individual sources.
      for (const url of urls) {
        evidence.push({
          id: `S${evidence.length + 1}`,
          kind: "Pasted URL",
          title: "User-provided link",
          text: "Page content has not been retrieved yet.",
          date: null,
          url,
        });
      }

      // 5. Display the collected evidence.
      setSources(evidence);
      setStatus(
        `Collected ${evidence.length} sources. Ready for AI analysis.`
      );
    } catch (err) {
      setError(err.message || "Something went wrong.");
      setStatus("Could not finish collecting evidence.");
    } finally {
      setBusy(false);
    }
  }


  return (
    <main className="shell">
      <header className="hero">
        <div className="eyebrow">LOCAL-FIRST RESEARCH WORKSPACE</div>
        <h1>Receipts, <em>Not Rumors.</em></h1>
        <p>Drop the mess. Get the evidence trail.</p>
        <div className="model-status">{status}</div>
      </header>

      <section className="privacy">
        <strong>Your evidence. Your investigation.</strong>
        <p>
          Bring screenshots, public links, copied posts, translations,
          and your own thoughts. The app will organize them into sources
          and, in the next steps, build a research timeline.
        </p>
      </section>

      <section className="section-head">
        <div>
          <div className="eyebrow">01 / START ANYWHERE</div>
          <h2>What are we investigating?</h2>
        </div>
        <button className="quiet" onClick={loadDemo}>Try demo</button>
      </section>

      <label className="field-label">
        Your question
      </label>
      <textarea
        rows={3}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Why are people connecting these posts? What happened first? Is there an original source?"
      />

      <label className="upload-zone">
        <span className="upload-icon">＋</span>
        <strong>Drop screenshots or browse files</strong>
        <span>Images · TXT · Markdown · JSON</span>
        <input
          type="file"
          multiple
          accept="image/*,.txt,.md,.json,text/plain"
          onChange={(e) => setFiles(Array.from(e.target.files || []))}
        />
      </label>

      {files.length > 0 && (
        <div className="file-list">
          {files.map((file) => (
            <div key={`${file.name}-${file.size}`}>
              {file.type.startsWith("image/") ? "▧" : "≡"} {file.name}
            </div>
          ))}
        </div>
      )}

      <label className="field-label">
        Dump links, copied posts, translations, or your thoughts
      </label>
      <textarea
        rows={6}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Paste everything here. You don't need to organize it first."
      />


      <button
        className="primary main-action"
        onClick={investigate}
        disabled={busy}
      >
        {busy ? "Working on your evidence..." : "Organize my evidence →"}
      </button>

      {(busy || error) && (
        <div
          className={`action-status ${error ? "action-error" : ""}`}
          role="status"
          aria-live="polite"
        >
          {error ? `⚠ ${error}` : `◌ ${status}`}
        </div>
      )}


      {sources.length > 0 && (
        <button
          className="primary main-action"
          onClick={analyzeEvidence}
          disabled={analyzing}
        >
          {analyzing ? "Qwen is investigating..." : "Analyze with Qwen →"}
        </button>
      )}

      {sources.length > 0 && (
        <p className="action-status" role="status">
          {modelStatus}
        </p>
      )}



      {error && <div className="error">{error}</div>}

      {sources.length > 0 && (
        <section className="report">
          <div className="eyebrow">02 / YOUR MATERIAL</div>
          <h2>Evidence inbox</h2>
          <div className="source-list">
            {sources.map((source) => (
              <article className="source-card" id={`source-${source.id}`} key={source.id}>
                <div className="source-meta">
                  <span className="source-id">{source.id}</span>
                  <span>{source.kind}</span>
                </div>
                <h3>{source.title}</h3>
                <p>{source.text}</p>
                {source.image && (
                  <img
                    src={source.image}
                    alt={source.title}
                    style={{ width: "100%", borderRadius: 8 }}
                  />
                )}
                {source.url && (
                  <a href={source.url} target="_blank" rel="noreferrer">
                    Open link ↗
                  </a>
                )}
                {source.ocrConfidence != null && (
                  <small className="caveat">
                    OCR confidence: {source.ocrConfidence}%. Check the extracted text.
                  </small>
                )}
              </article>
            ))}
          </div>
        </section>
      )}


      {report && (
        <section className="report">
          <div className="eyebrow">03 / THE EVIDENCE TRAIL</div>
          <h2>What the evidence supports</h2>

          <div className="bottom-line">
            <div className="eyebrow">BOTTOM LINE</div>
            <p>{report.bottomLine}</p>
          </div>

          <h3>Overview</h3>
          <p>{report.summary}</p>

          <h3>Visual timeline</h3>
          <TimelineTrack items={report.timeline || []} />

          <h3>Timeline</h3>
          <div className="timeline">
            {(report.timeline || []).map((item, index) => (
              <article
                className="timeline-item"
                key={`${item.sourceId}-${index}`}
              >
                <span className="timeline-dot" />
                <div className="timeline-date">
                  {item.date || "Date unknown"}
                </div>
                <h3>{item.event}</h3>
                <p>{item.explanation}</p>
                <div className="source-chips">
                  <span>{item.sourceId}</span>
                  {item.status && <span>{item.status}</span>}
                  <span>{item.confidence || "low"} confidence</span>
                </div>
              </article>
            ))}
          </div>

          <h3>Possible connections</h3>
          {(report.connections || []).map((item, index) => (
            <article className="finding" key={`${item.title}-${index}`}>
              <h3>{item.title}</h3>
              <p>{item.reason}</p>
              <div className="source-chips">
                {(item.sourceIds || []).map((id) => (
                  <span key={id}>{id}</span>
                ))}
              </div>
              <p className="caveat">
                What this doesn't establish: {item.caveat}
              </p>
            </article>
          ))}

          <h3>What remains unknown</h3>
          <ul>
            {(report.unknowns || []).map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </section>
      )}


      <footer>
        <span>RECEIPTS, NOT RUMORS</span>
        <span>Evidence first. Conclusions second.</span>
      </footer>
    </main>
  );
}
