import type { View } from "@/lib/store";

export function Views({ view }: { view: View }) {
  return <p className="m-0 px-4 py-6 text-dim">{view}: next commit_</p>;
}
