import React from "react";
import ChatWidget from "./ChatWidget.jsx";

export default function App() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-200">
      <header className="border-b border-slate-200 bg-white px-8 py-5">
        <p className="font-display text-lg font-semibold text-harbor-deep">
          Harbor
        </p>
      </header>

      <main className="mx-auto max-w-3xl px-8 py-16">
        <h1 className="font-display text-3xl font-semibold text-harbor-deep">
          Group chat widget demo
        </h1>
        <p className="mt-3 max-w-xl text-slate-600">
          Open the widget in the corner. Then open this same URL in two or
          three more tabs, each with a different <code className="rounded bg-slate-200 px-1.5 py-0.5">name</code> prop
          set below, to simulate several people in one group — messages,
          per-person name colors, and the "X is typing…" status all sync
          live across every tab.
        </p>
        <p className="mt-2 max-w-xl text-sm text-slate-500">
          All tabs join the same room ({" "}
          <code className="rounded bg-slate-200 px-1.5 py-0.5">demo-room</code>
          ) by default. Edit the <code className="rounded bg-slate-200 px-1.5 py-0.5">name</code> prop
          passed to <code className="rounded bg-slate-200 px-1.5 py-0.5">ChatWidget</code> in each tab's dev
          session to give each "participant" a distinct identity.
        </p>
      </main>

      <ChatWidget
        roomId="demo-room"
        name="You"
        role="visitor"
        groupName="Support Group"
      />
    </div>
  );
}
