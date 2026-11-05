# ResearchCopilot web app

The Next.js interface for ResearchCopilot: ask a question, read the answer with page citations, open the page with the passage highlighted, follow Scout's searches step by step and see where the answer sits on the knowledge map.

It runs in **demo mode** for now: it replays answers recorded by the real Python pipeline, so it needs no backend or API key. The FastAPI backend will replace the demo data through the same interface (`src/lib/api.ts`).

## Run it

1. Record demo answers from the project folder (uses your OpenAI key, costs a few cents):
   ```bash
   python eval/export_demo.py eval/papers/your_paper.pdf eval/demo_questions.txt
   ```
   This writes `web/public/demo/demo_data.json`, which is ignored by git.
2. Start the app:
   ```bash
   cd web
   npm install
   npm run dev
   ```
3. Open http://localhost:3000

## Structure

```
src/
├── app/                 # layout, global styles and theme
├── components/
│   ├── Workspace.tsx    # app state: questions, mode, which page is shown
│   ├── Thread.tsx       # answers with page tags, fact-check and passages
│   ├── ScoutSteps.tsx   # Scout's plan and searches, with match strength
│   ├── Viewer.tsx       # the page with highlights, and the knowledge map
│   ├── AskBar.tsx       # question input and Fast / Scout switch
│   ├── Sidebar.tsx      # library and question history
│   └── TopBar.tsx
└── lib/
    ├── api.ts           # the backend interface and the demo implementation
    ├── text.ts          # citation parsing and page highlighting
    └── types.ts         # shared types, mirroring the Python output
```
