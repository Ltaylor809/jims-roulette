import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../public/assets/", import.meta.url);

async function download(url, relativePath) {
  const output = new URL(relativePath, root);
  await mkdir(dirname(fileURLToPath(output)), { recursive: true });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  await writeFile(output, Buffer.from(await response.arrayBuffer()));
  console.log(`downloaded ${relativePath}`);
  return fileURLToPath(output);
}

await download(
  "https://static.poly.pizza/08f27141-8e64-425a-9161-1bbd6956dfca.glb",
  "models/shotgun.glb",
);

console.log("Asset download complete.");
