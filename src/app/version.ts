import { readFileSync } from "node:fs";
/** Shared runtime version works in src/ and dist/, including portable app/. */
export const APP_VERSION: string = JSON.parse(readFileSync(new URL("../../package.json",import.meta.url),"utf8")).version;
