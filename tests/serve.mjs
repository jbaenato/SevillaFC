import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tipos = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png"
};

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    const relativa = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    const archivo = path.resolve(raiz, relativa);
    if (archivo !== raiz && !archivo.startsWith(raiz + path.sep)) throw new Error("Ruta no permitida");
    const contenido = await readFile(archivo);
    res.writeHead(200, {
      "Content-Type": tipos[path.extname(archivo)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(contenido);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("No encontrado");
  }
}).listen(4173, "127.0.0.1");
