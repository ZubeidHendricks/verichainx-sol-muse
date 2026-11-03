import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { explorerTx } from "@/lib/chains";
import { formatUsdc } from "@/lib/money";
import { Fiat } from "@/app/ui/fiat";
import { getApp } from "@/server/app";
import { NotFound } from "@/server/catalog";
import { boardView, inviteKey, memberFromToken, teamCookie } from "@/server/procure";
import type { Scorecard } from "@/server/stores/scorecard";

import { AskForm, JoinForm, PolicyForm, TopUp } from "../forms";
import { Kanban, type BoardCard } from "./kanban";

export const metadata: Metadata = { title: "Company board" };

type Params = Promise<{ companyId: string }>;
type Search = Promise<{ k?: string }>;

export default function Page({ params, searchParams }: { params: Params; searchParams: Search }) {
  return (
    <Suspense fallback={<p className="muted">Loading the board…</p>}>
      <Board params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Board({ params, searchParams }: { params: Params; searchParams: Search }) {
  await connection();
  const [{ companyId }, { k }] = await Promise.all([params, searchParams]);
  const app = await getApp();
  const me = await memberFromToken(app, companyId, (await cookies()).get(teamCookie(companyId))?.value);
  const v = await boardView(app, companyId, me).catch((e) => { if (e instanceof NotFound) notFound(); throw e; });
  const { company } = v;

  if (!me) {
    const role = k === inviteKey(app, companyId, "approver") ? "approver" : k === inviteKey(app, companyId, "member") ? "member" : null;
    return (
      <div className="board stack">
        <p className="eyebrow">Company board</p>
        <h1 className="title">{company.name}</h1>
        {role ? (
          <section className="panel stack" style={{ maxWidth: 480 }}>
            <p style={{ margin: 0 }}>You&apos;ve been invited to {company.name}&apos;s procurement board as {role === "approver" ? "an approver" : "a member"}.</p>
            <JoinForm companyId={companyId} inviteKey={k!} role={role} />
          </section>
        ) : (
          <p className="muted">This board is private to {company.name}&apos;s team. Ask a teammate for the invite link.</p>
        )}
      </div>
    );
  }

  const base = `${app.config.appUrl}/teams/${companyId}`;
  const approver = me.role === "approver";
  const cards: BoardCard[] = v.cards.map((c) => {
    const sig = [...c.history].reverse().find((h) => h.sig)?.sig;
    return {
      id: c.id, column: c.column, kind: c.kind, title: c.title, seller: c.seller, image: c.image, productUrl: c.productUrl,
      unitPrice: c.unitPrice, quantity: c.quantity, available: c.available, label: c.label, reasons: c.reasons, policy: c.policy,
      total: c.kind === "maker" ? formatUsdc(c.total) : null, scorecard: c.scorecard as Scorecard | null, consensus: c.consensus,
      orderId: c.orderId, tx: sig ? explorerTx(sig, app.config.cluster) : null, history: c.history,
      request: v.requests.find((r) => r.id === c.requestId)?.text ?? "",
    };
  });
  const latest = v.requests[0];
  const monthly = Number(company.policy.monthly_usdc) || 0;
  const used = monthly ? Math.min(100, Math.round((Number(formatUsdc(v.spent)) / monthly) * 100)) : 0;

  return (
    <div className="board stack">
      <header className="team-head">
        <div>
          <p className="eyebrow">Company board · {v.people.length} {v.people.length === 1 ? "person" : "people"}</p>
          <h1 className="title">{company.name}</h1>
          <p className="small muted" style={{ margin: 0 }}>You&apos;re {me.name}, {approver ? "an approver" : "a member"}.</p>
        </div>
        <dl className="ledger">
          <div><dt>Wallet</dt><dd>{v.balance === null ? "–" : formatUsdc(v.balance)} <small>USDC</small>{v.balance !== null && <Fiat usdc={formatUsdc(v.balance)} />}</dd></div>
          <div className="month">
            <dt>Spent this month</dt>
            <dd>{formatUsdc(v.spent)} <small>of {company.policy.monthly_usdc}</small><Fiat usdc={formatUsdc(v.spent)} /></dd>
            <span className="gauge" role="img" aria-label={`${used}% of the monthly limit used`}><span style={{ width: `${used}%` }} /></span>
          </div>
          <div><dt>Per order</dt><dd>{company.policy.per_order_usdc} <small>USDC max</small><Fiat usdc={company.policy.per_order_usdc} /></dd></div>
        </dl>
      </header>

      <section className="panel stack">
        <h2 className="eyebrow">Ask the procurement agent</h2>
        <AskForm companyId={companyId} />
        {latest && (
          <div className="agent-say">
            <p className="who">Procurement agent · {latest.engine === "scripted" ? "built-in rules" : latest.engine} · for “{latest.text}” ×{latest.quantity}</p>
            <p>{latest.answer}</p>
            {latest.runId && <Link className="small" href={`/runs/${latest.runId}`}>See every check the agent ran</Link>}
          </div>
        )}
      </section>

      <Kanban companyId={companyId} cards={cards} approver={approver} />

      <div className="split">
        <section className="panel stack">
          <h2 className="eyebrow">Spending policy</h2>
          <p className="small muted" style={{ margin: 0 }}>Checked by code when the agent sources and again at payment.</p>
          <PolicyForm companyId={companyId} policy={company.policy} approver={approver} />
        </section>
        <section className="panel stack">
          <h2 className="eyebrow">Team and wallet</h2>
          <ul className="people">
            {v.people.map((p) => <li key={p.id}>{p.name} <span className="small muted">{p.role}</span></li>)}
          </ul>
          <div className="small">
            <p style={{ margin: "0 0 4px" }}>Invite a teammate:</p>
            <code className="invite">{`${base}?k=${inviteKey(app, companyId, "member")}`}</code>
            {approver && (
              <>
                <p style={{ margin: "12px 0 4px" }}>Invite an approver (they can pay):</p>
                <code className="invite">{`${base}?k=${inviteKey(app, companyId, "approver")}`}</code>
              </>
            )}
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Company wallet <a href={`https://explorer.solana.com/address/${company.wallet}?cluster=${app.config.cluster}`}><code>{company.wallet.slice(0, 6)}…{company.wallet.slice(-6)}</code></a>,
            held by the service on devnet.
          </p>
          <TopUp companyId={companyId} />
        </section>
      </div>
    </div>
  );
}
