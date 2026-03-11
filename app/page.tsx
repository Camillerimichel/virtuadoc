export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <section className="mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-6 text-center">
        <p className="mb-3 inline-flex items-center rounded-full border border-emerald-400/40 bg-emerald-400/10 px-4 py-1 text-sm font-medium text-emerald-300">
          VirtuaDoc • Production
        </p>
        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
          VirtuaDoc is live
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-slate-300">
          Frontend and document engine are deployed successfully on the VPS.
        </p>
        <div className="mt-10 grid w-full max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
          <a
            className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm hover:border-slate-500"
            href="/api/document-engine/health"
          >
            API Health
          </a>
          <a
            className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm hover:border-slate-500"
            href="https://github.com/Camillerimichel/virtuadoc"
            target="_blank"
            rel="noreferrer"
          >
            GitHub Repository
          </a>
        </div>
      </section>
    </main>
  );
}
