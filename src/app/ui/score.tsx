import type { Recommendation } from "@/server/agents/verify";
import type { Scorecard } from "@/server/stores/scorecard";

const LABEL_COLOR: Record<Recommendation, string> = { recommended: "var(--ok)", caution: "var(--warn)", avoid: "var(--bad)", excluded: "var(--bad)" };
const tone = (n: number) => (n >= 70 ? "var(--ok)" : n >= 50 ? "var(--warn)" : "var(--bad)");

/** The overall score as a seal: the ring fills to the score in the label's colour. */
export function ScoreSeal({ score, label, size = 48 }: { score: number; label: Recommendation; size?: number }) {
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  return (
    <svg className="seal-score" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Score ${score} of 100`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="var(--card)" stroke="var(--rule)" strokeWidth="3" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={LABEL_COLOR[label]} strokeWidth="3" strokeLinecap="round"
        strokeDasharray={`${(c * score) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={size * 0.38} fill="var(--ink)">{score}</text>
    </svg>
  );
}

/** Five bars, one per part of the score, with where each number came from. */
export function ScoreCard({ card }: { card: Scorecard }) {
  return (
    <details className="scorecard">
      <summary><span style={{ color: tone(card.overall) }}>{card.overall}</span>/100 · {card.grade}</summary>
      <ul>
        {card.rows.map((r) => (
          <li key={r.key}>
            <span className="part">{r.label}</span>
            <span className="bar" aria-hidden>{r.score !== null && <span style={{ width: `${r.score}%`, background: tone(r.score) }} />}</span>
            <span className="num">{r.score ?? "–"}</span>
            <span className="why">{r.note}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
