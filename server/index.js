import express from "express";
import "dotenv/config";
import * as cheerio from "cheerio";
import dns from "node:dns/promises";
import net from "node:net";


const app = express();
const PORT = process.env.API_PORT || 3001;

app.use(express.json({ limit: "1mb" }));

// Health check: confirms the backend is running.
app.get("/api/health", (req, res) => {
    res.json({
        status: "ok",
        message: "Receipts API is running!",
    });
});

// Web search endpoint.
app.post("/api/search", async (req, res) => {
    try {
        const key = process.env.SERPAPI_KEY;

        if (!key) {
            return res.status(503).json({
                error: "SERPAPI_KEY is missing from your .env file.",
            });
        }

        const queries = Array.isArray(req.body.queries)
            ? req.body.queries
            : [];

        if (queries.length === 0 || queries.length > 3) {
            return res.status(400).json({
                error: "Provide between one and three search queries.",
            });
        }

        const results = [];

        for (const query of queries) {
            const url = new URL("https://serpapi.com/search.json");

            url.searchParams.set("engine", "google");
            url.searchParams.set("q", String(query).slice(0, 300));
            url.searchParams.set("api_key", key);

            const response = await fetch(url);
            const data = await response.json();

            if (!response.ok || data.error) {
                throw new Error(
                    data.error || `Search provider returned HTTP ${response.status}`
                );
            }

            for (const item of (data.organic_results || []).slice(0, 5)) {
                if (!item.link) continue;

                results.push({
                    title: item.title || "Untitled result",
                    snippet: item.snippet || "",
                    url: item.link,
                    date: toIso(item.date),
                    query,
                });
            }
        }
        // Try to find dates for results Google didn't date (max 6, in parallel).
        await Promise.allSettled(
            results
                .filter((r) => !r.date)
                .slice(0, 6)
                .map(async (r) => {
                    const { html } = await fetchHtml(r.url, 6000);
                    r.date = extractDate(cheerio.load(html));
                })
        );

        res.json({ results });

    } catch (error) {
        console.error("Search error:", error.message);

        res.status(502).json({
            error: "Web search failed. Check the API key, quota, and connection.",
        });
    }
});

// ---------- Page fetching ----------

// Block localhost / private network addresses so the endpoint can't be abused.
function isPrivateIp(ip) {
    if (net.isIPv6(ip)) {
        const lower = ip.toLowerCase();
        // IPv4 addresses written in IPv6 form, e.g. ::ffff:127.0.0.1
        if (lower.startsWith("::ffff:")) return isPrivateIp(lower.slice(7));
        return (
            lower === "::1" ||
            lower === "::" ||
            lower.startsWith("fc") ||
            lower.startsWith("fd") ||
            lower.startsWith("fe80")
        );
    }
    const [a, b] = ip.split(".").map(Number);
    return (
        a === 10 || a === 127 || a === 0 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168)
    );
}

async function assertPublicUrl(raw) {
    const u = new URL(raw);
    if (!["http:", "https:"].includes(u.protocol)) {
        throw new Error("Only http(s) links are supported.");
    }
    const addrs = await dns.lookup(u.hostname, { all: true });
    if (addrs.some((a) => isPrivateIp(a.address))) {
        throw new Error("That address isn't a public website.");
    }
    return u;
}

app.post("/api/fetch-page", async (req, res) => {
    try {
        const { html, finalUrl } = await fetchHtml(req.body.url);
        const $ = cheerio.load(html);

        const meta = (name) =>
            $(`meta[property="${name}"]`).attr("content") ||
            $(`meta[name="${name}"]`).attr("content") ||
            "";

        const title =
            meta("og:title") || $("title").text().trim() || "Untitled page";
        const description = meta("og:description") || meta("description");
        const date = extractDate($); // must run before scripts are removed

        $("script, style, noscript, nav, header, footer, aside, form, iframe").remove();

        const root = $("article").length
            ? $("article").first()
            : $("main").length
                ? $("main")
                : $("body");
        const bodyText = root.text().replace(/\s+/g, " ").trim();

        const text = (
            bodyText.length > 200
                ? bodyText
                : [description, bodyText].filter(Boolean).join("\n\n")
        ).slice(0, 4000);

        if (!text) {
            return res.status(422).json({
                error: "The page loaded but contained no readable text (it may need JavaScript or a login).",
            });
        }

        res.json({ title, text, date, finalUrl });
    } catch (error) {
        console.error("Fetch error:", error.message);
        res.status(502).json({
            error: error.message || "Could not fetch that page.",
        });
    }
});

// Turn "Mar 5, 2020" or "3 days ago" into "YYYY-MM-DD" (or null).
function toIso(raw) {
    if (!raw) return null;
    const s = String(raw).trim();

    const rel = s.match(/(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago/i);
    if (rel) {
        const n = Number(rel[1]);
        const d = new Date();
        const unit = rel[2].toLowerCase();
        if (unit === "minute") d.setMinutes(d.getMinutes() - n);
        if (unit === "hour") d.setHours(d.getHours() - n);
        if (unit === "day") d.setDate(d.getDate() - n);
        if (unit === "week") d.setDate(d.getDate() - n * 7);
        if (unit === "month") d.setMonth(d.getMonth() - n);
        if (unit === "year") d.setFullYear(d.getFullYear() - n);
        return d.toISOString().slice(0, 10);
    }

    const t = Date.parse(s);
    return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

// Look for a publish date in a page's metadata. Call BEFORE removing <script> tags.
function extractDate($) {
    const candidates = [
        $('meta[property="article:published_time"]').attr("content"),
        $('meta[property="og:article:published_time"]').attr("content"),
        $('meta[itemprop="datePublished"]').attr("content"),
        $('meta[name="date"]').attr("content"),
        $('meta[name="pubdate"]').attr("content"),
        $("time[datetime]").first().attr("datetime"),
    ];

    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const json = JSON.parse($(el).text());
            const nodes = Array.isArray(json)
                ? json
                : [json, ...(json["@graph"] || [])];
            for (const node of nodes) {
                if (node?.datePublished) candidates.push(node.datePublished);
            }
        } catch {
            /* ignore malformed JSON-LD */
        }
    });

    for (const c of candidates) {
        const iso = toIso(c);
        if (iso) return iso;
    }
    return null;
}

// Fetch a public page, checking every redirect hop.
async function fetchHtml(raw, timeoutMs = 12000) {
    let current = await assertPublicUrl(String(raw || ""));
    let response;

    for (let hop = 0; hop < 5; hop++) {
        response = await fetch(current, {
            redirect: "manual",
            signal: AbortSignal.timeout(timeoutMs),
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (compatible; ReceiptsBot/1.0; research tool)",
                Accept: "text/html,application/xhtml+xml",
            },
        });
        if (
            response.status >= 300 &&
            response.status < 400 &&
            response.headers.get("location")
        ) {
            current = await assertPublicUrl(
                new URL(response.headers.get("location"), current).href
            );
            continue;
        }
        break;
    }

    if (!response.ok) {
        throw new Error(`The site returned HTTP ${response.status}.`);
    }

    return {
        html: (await response.text()).slice(0, 2_000_000),
        finalUrl: current.href,
    };
}

app.listen(PORT, () => {
    console.log(`Search API running at http://localhost:${PORT}`);
});