// tools/models/meshy.mjs
// One Meshy (meshy.ai) image-to-3D job, from a photograph on disk or from a prompt drawn first with Nano Banana
// (Meshy's text-to-image). Saves model.glb, the four preview renders and the tasks' JSON in <out-dir>.
//   node tools/models/meshy.mjs <job.json> <out-dir>
// job.json: { image?: "path.jpg" | prompt?: "...", imageOptions?: {...text-to-image}, model: {...image-to-3d} }
// (the API's parameters: https://docs.meshy.ai/en/api/image-to-3d; see tools/models/jobs/ for the ones used)
// The key comes from MESHY_API_KEY, or from ~/.config/meshy/env (MESHY_API_KEY=msy_...), never from the repository.
// Every job spends credits (~15-35 a model, 3 an image): check the balance first with --balance.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { homedir } from 'node:os';

const API = 'https://api.meshy.ai/openapi/v1';
function apiKey() {
  if (process.env.MESHY_API_KEY) return process.env.MESHY_API_KEY;
  const file = join(homedir(), '.config/meshy/env');
  const line = existsSync(file) && readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith('MESHY_API_KEY='));
  if (!line) throw new Error('No Meshy key: set MESHY_API_KEY or write it to ~/.config/meshy/env');
  return line.slice('MESHY_API_KEY='.length).trim();
}
const auth = { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' };

if (process.argv[2] === '--balance') {
  console.log(await (await fetch(`${API}/balance`, { headers: auth })).json());
  process.exit(0);
}
const [jobPath, outDir] = process.argv.slice(2);
if (!jobPath || !outDir) throw new Error('usage: node tools/models/meshy.mjs <job.json> <out-dir> | --balance');
const job = JSON.parse(readFileSync(jobPath, 'utf8'));
mkdirSync(outDir, { recursive: true });

// a task to its end, its progress every few seconds
async function run(kind, body) {
  const created = await (await fetch(`${API}/${kind}`, { method: 'POST', headers: auth, body: JSON.stringify(body) })).json();
  if (!created.result) throw new Error(`${kind}: ${JSON.stringify(created)}`);
  for (;;) {
    await new Promise((r) => setTimeout(r, 6000));
    const task = await (await fetch(`${API}/${kind}/${created.result}`, { headers: auth })).json();
    console.log(kind, task.status, `${task.progress}%`);
    if (task.status === 'SUCCEEDED') return task;
    if (task.status === 'FAILED' || task.status === 'CANCELED') throw new Error(`${kind}: ${JSON.stringify(task.task_error)}`);
  }
}
async function save(url, name) {
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  writeFileSync(join(outDir, name), buf);
  console.log('saved', name, buf.length, 'bytes');
}

const input = {};
let credits = 0;
if (job.image) {
  const mime = extname(job.image).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
  input.image_url = `data:${mime};base64,${readFileSync(job.image).toString('base64')}`;
} else if (job.prompt) {
  const img = await run('text-to-image', { ai_model: 'nano-banana', prompt: job.prompt, ...job.imageOptions });
  writeFileSync(join(outDir, 'image-task.json'), JSON.stringify(img, null, 2));
  await save(img.image_urls[0], 'image.png');
  input.input_task_id = img.id;
  credits += img.consumed_credits || 0;
} else throw new Error('a job needs an image or a prompt');

const model = await run('image-to-3d', { ...input, target_formats: ['glb'], multi_view_thumbnails: true, ...job.model });
writeFileSync(join(outDir, 'model-task.json'), JSON.stringify(model, null, 2));
await save(model.model_urls.glb, 'model.glb');
for (const [view, url] of Object.entries(model.thumbnail_urls || {})) await save(url, `preview_${view}.png`);
console.log('credits', credits + (model.consumed_credits || 0));
