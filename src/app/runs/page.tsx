import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { getApp } from "@/server/app";
import { recentRuns } from "@/server/views";
import { engineLabel } from "@/lib/engine";

export const metadata: Metadata = { title: "Agent runs" };

export default function Page() {
  return (
    <section className="board">
      <p className="eyebrow">History</p>
      <h1 className="display title">Agent runs</h1>
      <p className="muted" style={{ maxWidth: "58ch" }}>
        Every request to the shopping agent, with the model that ran it and how many offers it turned down.
      </p>
      <Suspense fallback={<p className="muted">Loading runs…</p>}>
        <Runs />
      </Suspense>
    </section>
  );
}

async function Runs() {
  await connection();
  const runs = await recentRuns(await getApp());
  if (runs.length === 0) return <p>No runs yet. <Link href="/">Ask the agent for something</Link>.</p>;
  return (
    <div className="table-scroll">
      <table>
        <thead><tr><th>Request</th><th>Engine</th><th>Offers</th><th>Avoided</th><th>Tokens</th><th>When</th></tr></thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td><Link href={`/runs/${r.id}`}>{r.message}</Link></td>
              <td className="mono">{engineLabel(r.engine)}</td>
              <td>{r.offers}</td>
              <td>{r.avoided}</td>
              <td>{r.tokens ?? "–"}</td>
              <td className="small muted">{new Date(r.createdAt).toUTCString().slice(5, 22)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
