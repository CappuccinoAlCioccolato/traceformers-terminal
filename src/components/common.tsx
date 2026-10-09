import { padId, piece } from "@/lib/trace/catalog";
import { dialectMark, formMark } from "@/lib/trace/marks";

export function cx(...items: (string | false | null | undefined)[]): string {
  return items.filter(Boolean).join(" ");
}

export function formatLeft(deadline: number, nowSeconds: number): string {
  const seconds = deadline - nowSeconds;
  if (seconds <= 0) return "expired";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return `${seconds}s`;
  if (minutes < 90) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;
}

export function formatStamp(ms: number): string {
  return new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(ms);
}

/** The trait mark of a piece: dialect for an encoder, form for a base, nothing for a character. */
export function PieceMark({ id }: { id: string | null }) {
  const art = id ? piece(id) : undefined;
  if (!art) return <span className="text-dim">····</span>;
  if (art.dialect) return <span className={`trait trait-${art.dialect}`}>{dialectMark(art.dialect)}</span>;
  if (art.form) return <span className={`form-${art.form}`}>{formMark(art.form)}</span>;
  return null;
}

export function Tok({ id, mine, onClick }: { id: string | null; mine?: boolean; onClick?: () => void }) {
  const art = id ? piece(id) : undefined;
  const text = art ? padId(art.tokenId) : "#····";
  if (onClick && id) {
    return (
      <button type="button" className={cx("tok", mine && "is-mine")} onClick={onClick}>
        {text}
      </button>
    );
  }
  return <span className={cx("tok", mine && "is-mine")}>{text}</span>;
}
