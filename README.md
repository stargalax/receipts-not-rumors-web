# Receipts, Not Rumors

**Drop the mess. Get the evidence trail.**

A local-first research workspace for when the internet is arguing and you just want to know what's actually sourced. Paste screenshots, links, copied posts, and notes, and it organizes them into a sourced, chronological timeline, with the uncertainty left in.

<img width="1292" height="845" alt="image" src="https://github.com/user-attachments/assets/607c4f08-820c-4e69-8b63-67d0df64287b" />

<img width="1238" height="698" alt="image" src="https://github.com/user-attachments/assets/c0f612d5-f0de-44ba-be5a-b5b68eaa3ac1" />


## Features

- **Screenshot OCR**: text inside images is extracted in the browser with Tesseract.js.
- **Link fetching**: pasted URLs are fetched server-side and their readable text and publish date are extracted.
- **Web search**: the model writes up to three search queries, and SerpAPI returns public results as extra sources.
- **AI timeline**: a local Qwen model separates direct evidence, reported claims, and interpretations, and lists what remains unknown.
- **Visual timeline**: events appear as dots on a horizontal line. Color shows confidence, hover shows a one-line summary, and click opens the source.
- **Guardrails**: the model must not invent dates, quotes, or URLs. Source IDs it makes up are stripped, search snippets are labeled as unverified, and pages that failed to load are marked as such.

## How it works

1. **Collect**: screenshots go through OCR, files are read, and links are fetched.
2. **Search**: Qwen proposes queries, and the backend runs them through SerpAPI.
3. **Analyze**: Qwen builds the timeline from the supplied sources only.
4. **Validate**: the app checks every source ID the model cites and prefers each source's own date over the model's.

## Tech stack

| Part | Tool |
|------|------|
| Frontend | React + Vite |
| Local LLM | [Qwen2.5-1.5B-Instruct](https://huggingface.co/Qwen) via [WebLLM](https://github.com/mlc-ai/web-llm) (WebGPU) |
| OCR | [Tesseract.js](https://github.com/naptha/tesseract.js) |
| Backend | Express, Cheerio |
| Search | [SerpAPI](https://serpapi.com) |

## Privacy

The model and OCR run **in your browser**. Your screenshots and analysis never go to an AI server. Only the short search queries and the links you paste pass through the backend.

## Requirements

- Node.js 18 or newer
- A browser with **WebGPU** (recent Chrome or Edge)
- A [SerpAPI](https://serpapi.com) key (the free tier works)
- Roughly 1 GB of free disk for the model, downloaded on first run and then cached

## Getting started

```bash
git clone https://github.com/YOUR-USERNAME/YOUR-REPO.git
cd YOUR-REPO
npm install
```

Create a `.env` file in the project root:

```env
SERPAPI_KEY=your_key_here
API_PORT=3001
```

Run the backend and the frontend in two terminals:

```bash
node index.js     # API on http://localhost:3001
npm run dev       # Vite dev server
```

Open the URL Vite prints. The first analysis downloads the model, so expect a wait.

## Deployment

The app is one Node service: Express serves the built frontend and the API.

```bash
npm run build
npm start
```

Set `SERPAPI_KEY` as an environment variable on your host. WebGPU needs HTTPS, which hosts like Render provide by default.

## Limitations

- Qwen 1.5B is small. It may leave dates empty or write generic explanations, so always check the sources.
- Some sites block automated fetching (X/Twitter, Instagram, Facebook), and some pages need JavaScript or a login. Paste the text or a screenshot instead.
- Search snippets are leads, not proof. The timeline's confidence reflects support in the supplied material, not objective truth.
- Event spacing on the timeline is even, not proportional to time.

## Disclaimer

This is a research aid, not a verdict machine. Don't use it to harass anyone or to draw conclusions about people's private lives from ambiguous posts.

## License

MIT
