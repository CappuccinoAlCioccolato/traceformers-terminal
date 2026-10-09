import { CATALOG_DATA } from "./catalog-data";

export type Role = "character" | "base" | "encoder";
export type Dialect = "base64" | "binary" | "punched";
export type BaseForm = "classic" | "inverted" | "blink";
export type Trait = { type: string; value: string };

export type Piece = {
  id: string;
  tokenId: number;
  role: Role;
  traits: Trait[];
  image: string;
  opensea: string;
  dialect: Dialect | null;
  form: BaseForm | null;
};

export const TRACE_CONTRACT = "0x691bd9fd56fdd24831b3c3068d4a10ec00341e40";
export const TRACE_COLLECTION = "https://opensea.io/collection/traceart";
export const TRACE_SITE = "https://traceforms.xyz";

const PREFIX: Record<Role, string> = { character: "c", base: "b", encoder: "e" };

export function pieceId(role: Role, tokenId: number): string {
  return `${PREFIX[role]}-${tokenId}`;
}

function trait(traits: Trait[], type: string): string {
  return traits.find((item) => item.type === type)?.value ?? "";
}

function dialectOf(method: string): Dialect | null {
  const value = method.toLowerCase();
  if (value === "binary") return "binary";
  if (value === "base64") return "base64";
  if (value.startsWith("punched")) return "punched";
  return null;
}

function formOf(form: string): BaseForm {
  const value = form.toLowerCase();
  if (value === "blink") return "blink";
  if (value === "inverted") return "inverted";
  return "classic";
}

export const PIECES: Piece[] = CATALOG_DATA.map(([tokenId, role, pairs, ext]) => {
  const traits = pairs.map(([type, value]) => ({ type, value }));
  return {
    id: pieceId(role, tokenId),
    tokenId,
    role,
    traits,
    image: `${import.meta.env.BASE_URL}trace/${tokenId}.${ext}`,
    opensea: `https://opensea.io/item/ethereum/${TRACE_CONTRACT}/${tokenId}`,
    dialect: role === "encoder" ? dialectOf(trait(traits, "Method")) : null,
    form: role === "base" ? formOf(trait(traits, "Form")) : null,
  };
});

const BY_ID = new Map(PIECES.map((piece) => [piece.id, piece]));

export function piece(id: string): Piece | undefined {
  return BY_ID.get(id);
}

export function traitOf(target: Piece, type: string): string {
  return trait(target.traits, type);
}

export function padId(tokenId: number): string {
  return `#${String(tokenId).padStart(4, "0")}`;
}

export function label(id: string | null | undefined): string {
  if (!id) return "—";
  const found = BY_ID.get(id);
  return found ? padId(found.tokenId) : id;
}

export function roleName(role: string): string {
  if (role === "character") return "character";
  if (role === "base") return "base";
  if (role === "encoder") return "encoder";
  return "wallet";
}

/** One short line that summarizes the visual traits of a piece. */
export function epithet(target: Piece): string {
  if (target.role === "character") {
    return target.traits.map((item) => item.value.toLowerCase()).join(" · ");
  }
  const parts = [traitOf(target, "Method"), traitOf(target, "Form"), traitOf(target, "Motion"), traitOf(target, "Palette")];
  return parts.filter(Boolean).join(" · ").toLowerCase();
}
