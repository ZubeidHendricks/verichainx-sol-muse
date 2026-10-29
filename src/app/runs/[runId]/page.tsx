import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { getApp } from "@/server/app";
import { NotFound } from "@/server/catalog";
import { runPage } from "@/server/views";

import { RunView } from "../../ui/run-view";

export const metadata: Metadata = { title: "Agent run" };

export default function Page({ params }: { params: Promise<{ runId: string }> }) {
  return (
    <Suspense fallback={<p className="muted">Loading the run…</p>}>
      <Run params={params} />
    </Suspense>
  );
}

async function Run({ params }: { params: Promise<{ runId: string }> }) {
  await connection();
  const { runId } = await params;
  const v = await runPage(await getApp(), runId).catch((e) => { if (e instanceof NotFound) notFound(); throw e; });
  return (
    <>
      <p className="eyebrow">Agent run · {new Date(v.createdAt).toUTCString()}</p>
      <h1 className="display title">&ldquo;{v.message}&rdquo;</h1>
      <p className="small muted">The verdicts are as they were when the agent ran. Open an offer to check it again now.</p>
      <RunView reply={v.reply} />
    </>
  );
}
