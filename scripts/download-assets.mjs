import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
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

async function polyHavenModel(id) {
  const response = await fetch(`https://api.polyhaven.com/files/${id}`);
  if (!response.ok) throw new Error(`Poly Haven API failed for ${id}`);
  const files = await response.json();
  const gltf = files.gltf?.["1k"]?.gltf;
  if (!gltf) throw new Error(`No 1K glTF found for ${id}`);

  const base = `models/polyhaven/${id}/`;
  await Promise.all([
    download(gltf.url, `${base}${basename(new URL(gltf.url).pathname)}`),
    ...Object.entries(gltf.include).map(([path, entry]) => download(entry.url, `${base}${path}`)),
  ]);
}

const models = [
  "WoodenTable_01",
  "WoodenChair_01",
  "Lantern_01",
  "handsaw_wood",
  "cigarette_pack",
  "magnifying_glass_01",
  "vintage_radio_transceiver",
  "chemistry_set",
];

await Promise.all(models.map(polyHavenModel));

await Promise.all([
  download("https://static.poly.pizza/08f27141-8e64-425a-9161-1bbd6956dfca.glb", "models/shotgun.glb"),
  download("https://static.poly.pizza/3746be88-6799-4817-929b-6bc067c47caa.glb", "models/dealer.glb"),
  download("https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/abandoned_tiled_room_2k.hdr", "environment/abandoned_tiled_room_2k.hdr"),
  download("https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/wood_table/wood_table_diff_2k.jpg", "textures/wood_table_diff_2k.jpg"),
  download("https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/wood_table/wood_table_nor_gl_2k.jpg", "textures/wood_table_nor_gl_2k.jpg"),
  download("https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/wood_table/wood_table_rough_2k.jpg", "textures/wood_table_rough_2k.jpg"),
  download("https://opengameart.org/sites/default/files/freezer_0.ogg", "audio/abandoned_passages.ogg"),
  download("https://opengameart.org/sites/default/files/sound_click.wav", "audio/ui_click.wav"),
  download("https://opengameart.org/sites/default/files/gunshots.zip", "source-zips/gunshots.zip"),
  download("https://opengameart.org/sites/default/files/shotgunsounds.zip", "source-zips/shotgunsounds.zip"),
]);

const assetsPath = fileURLToPath(root);
await mkdir(new URL("audio/gunshots/", root), { recursive: true });
await mkdir(new URL("audio/reload/", root), { recursive: true });
execFileSync("unzip", ["-o", join(assetsPath, "source-zips/gunshots.zip"), "-d", join(assetsPath, "audio/gunshots")]);
execFileSync("unzip", ["-o", join(assetsPath, "source-zips/shotgunsounds.zip"), "-d", join(assetsPath, "audio/reload")]);

console.log("Asset download complete.");
