import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Workspace } from "../core/workspace.js";
import { SchemaRegistry } from "../schema/schemaRegistry.js";
import { dispatchGuiApi } from "./api.js";
import type { GuiAuthoringContext } from "./api.js";
import { createProject } from "../app/project.js";
import { projectPreflight } from "../app/preflight.js";
import { projectCoverage } from "../app/coverage.js";

const PUBLIC_ROOT = fileURLToPath(new URL("../../src/gui/public/", import.meta.url));
const MAX_BODY_BYTES = 1_000_000;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  if (!chunks.length) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function serveStatic(pathname: string, response: ServerResponse): Promise<void> {
  const requested = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const absolute = path.resolve(PUBLIC_ROOT, `.${requested}`);
  const relative = path.relative(PUBLIC_ROOT, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    json(response, 403, { error: "Static path escapes GUI root" });
    return;
  }
  try {
    const body = await fs.readFile(absolute);
    response.writeHead(200, {
      "content-type": CONTENT_TYPES[path.extname(absolute).toLowerCase()] ?? "application/octet-stream",
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'",
    });
    response.end(body);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") json(response, 404, { error: "File not found" });
    else throw error;
  }
}

export function createGuiHttpServer(workspace: Workspace, schema: SchemaRegistry, authoring?: GuiAuthoringContext) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname.startsWith("/api/")) {
        const result = await dispatchGuiApi(workspace, schema, {
          method: request.method ?? "GET",
          pathname: url.pathname,
          query: url.searchParams,
          body: request.method === "POST" ? await readBody(request) : undefined,
        }, authoring);
        json(response, result.status, result.body);
        return;
      }
      await serveStatic(url.pathname, response);
    } catch (error) {
      json(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

export async function startGuiServer(options: {
  root: string;
  host?: string;
  port?: number;
}): Promise<{ url: string; close: () => Promise<void> }> {
  const project = await createProject(options.root);
  const server = createGuiHttpServer(project.workspace, project.schema, { ...project, projectStatus: () => projectCoverage(project),projectPreflight:()=>projectPreflight(project) });
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4312;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  return {
    url: `http://${host}:${actualPort}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
