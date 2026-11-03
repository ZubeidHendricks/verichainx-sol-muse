"use client";

import { useActionState, useState } from "react";

import { Fiat } from "../ui/fiat";
import { addFunds, askAgent, joinCompany, savePolicy, startCompany, type TeamState } from "./actions";

export function Result({ state }: { state: TeamState }) {
  if (state.error) return <p className="notice error" role="alert">{state.error}</p>;
  if (state.done) return <p className="status paid" role="status">{state.done}</p>;
  return null;
}

export function StartCompanyForm() {
  const [state, action, pending] = useActionState(startCompany, {});
  return (
    <form action={action}>
      <label>Company<input name="company" required maxLength={60} placeholder="Acme Events" /></label>
      <label>Your name<input name="you" required maxLength={60} placeholder="Thandi" /></label>
      <div className="pair">
        <label>Limit per order (USDC)<input name="per_order" inputMode="decimal" defaultValue="6000" /></label>
        <label>Limit per month (USDC)<input name="monthly" inputMode="decimal" defaultValue="20000" /></label>
      </div>
      <button className="btn" type="submit" disabled={pending}>{pending ? "Setting up the wallet…" : "Start the board"}</button>
      <p className="small muted">You&apos;ll be its first approver. Invite your team from the board.</p>
      <Result state={state} />
    </form>
  );
}

export function JoinForm({ companyId, inviteKey, role }: { companyId: string; inviteKey: string; role: string }) {
  const [state, action, pending] = useActionState(joinCompany.bind(null, companyId, inviteKey), {});
  return (
    <form action={action}>
      <label>Your name<input name="you" required maxLength={60} /></label>
      <button className="btn" type="submit" disabled={pending}>{pending ? "Joining…" : `Join as ${role}`}</button>
      <Result state={state} />
    </form>
  );
}

const EXAMPLES = [
  { what: "woven tote bags for conference speakers", quantity: "40", budget: "6000" },
  { what: "leather wallets as client gifts", quantity: "25", budget: "3000" },
];

export function AskForm({ companyId }: { companyId: string }) {
  const [state, action, pending] = useActionState(askAgent.bind(null, companyId), {});
  const [what, setWhat] = useState("");
  const [quantity, setQuantity] = useState("40");
  const [budget, setBudget] = useState("6000");
  return (
    <form action={action} className="request">
      <label className="what">What does the company need?
        <input name="what" required maxLength={200} placeholder="woven tote bags for conference speakers" value={what} onChange={(e) => setWhat(e.target.value)} />
      </label>
      <label>How many<input name="quantity" required inputMode="numeric" pattern="[0-9]+" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label>
      <label className="budget">Budget, USDC
        <input name="budget" required inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />
        <Fiat usdc={budget} />
      </label>
      <button className="btn" type="submit" disabled={pending}>{pending ? "Sourcing…" : "Ask the agent"}</button>
      {pending
        ? <p className="typing" role="status">The procurement agent is asking every shop and checking each offer</p>
        : (
          <div className="chips examples">
            {EXAMPLES.map((e) => (
              <button key={e.what} type="button" className="chip"
                onClick={() => { setWhat(e.what); setQuantity(e.quantity); setBudget(e.budget); }}>
                {e.quantity} {e.what}
              </button>
            ))}
          </div>
        )}
      <Result state={state} />
    </form>
  );
}

export function PolicyForm({ companyId, policy, approver }: {
  companyId: string; policy: { per_order_usdc: string; monthly_usdc: string; verified_only: boolean }; approver: boolean;
}) {
  const [state, action, pending] = useActionState(savePolicy.bind(null, companyId), {});
  return (
    <form action={action}>
      <div className="pair">
        <label>Per order (USDC)<input name="per_order" defaultValue={policy.per_order_usdc} disabled={!approver} inputMode="decimal" /></label>
        <label>Per month (USDC)<input name="monthly" defaultValue={policy.monthly_usdc} disabled={!approver} inputMode="decimal" /></label>
      </div>
      <label className="check"><input type="checkbox" name="verified_only" defaultChecked={policy.verified_only} disabled={!approver} />
        Only offers that pass every check</label>
      {approver
        ? <button className="btn ghost small" type="submit" disabled={pending}>{pending ? "Saving…" : "Save policy"}</button>
        : <p className="small muted">Only an approver can change the policy.</p>}
      <Result state={state} />
    </form>
  );
}

export function TopUp({ companyId }: { companyId: string }) {
  const [state, action, pending] = useActionState(() => addFunds(companyId), {});
  return (
    <form action={action}>
      <button className="btn ghost small" type="submit" disabled={pending}>{pending ? "Adding…" : "Add 10,000 test USDC"}</button>
      <Result state={state} />
    </form>
  );
}
