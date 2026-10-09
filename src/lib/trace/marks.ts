import type { BaseForm, Dialect } from "./catalog";

/** The visual mark of an encoder dialect. */
export function dialectMark(dialect: Dialect): string {
  if (dialect === "binary") return "010110";
  if (dialect === "punched") return "·●·●·";
  return "b64";
}

/** The visual mark of a base form. */
export function formMark(form: BaseForm): string {
  if (form === "blink") return "▒░▒";
  if (form === "inverted") return "▀▄▀";
  return "══";
}

export function visualCipher(dialect: Dialect, ciphertext: string): string {
  if (dialect === "binary") return ciphertext.replace(/ /g, "");
  if (dialect === "punched") return ciphertext.replaceAll("#", "●").replaceAll(".", "·");
  return ciphertext;
}

/** What a blink line turns into once its block has passed. */
export function decayed(ciphertext: string): string {
  return "▒".repeat(Math.max(3, Math.min(12, Math.ceil(ciphertext.length / 3))));
}
