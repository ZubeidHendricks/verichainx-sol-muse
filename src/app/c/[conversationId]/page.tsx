import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { getApp } from "@/server/app";
import { NotFound } from "@/server/catalog";
import { conversation } from "@/server/chat";

import { Thread } from "../../ui/thread";

export const metadata: Metadata = { title: "Conversation" };

export default function Page({ params }: { params: Promise<{ conversationId: string }> }) {
  return (
    <Suspense fallback={<p className="muted">Loading the conversation…</p>}>
      <Conversation params={params} />
    </Suspense>
  );
}

async function Conversation({ params }: { params: Promise<{ conversationId: string }> }) {
  await connection();
  const { conversationId } = await params;
  const c = await conversation(await getApp(), conversationId).catch((e) => { if (e instanceof NotFound) notFound(); throw e; });
  return (
    <section className="chat">
      <p className="eyebrow">Conversation · {new Date(c.createdAt).toUTCString()}</p>
      <p className="small muted">Verdicts are as they were at the time. Open an offer to check it again now. <Link href="/">Start a new conversation</Link>.</p>
      <Thread messages={c.messages} />
    </section>
  );
}
