import path from "node:path";
import {fileURLToPath} from "node:url";
const root=fileURLToPath(new URL("../../",import.meta.url));
export const projectPath=(relative:string):string=>path.resolve(root,relative);
