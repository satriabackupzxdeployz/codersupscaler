import express from 'express';
import cors from 'cors';
import { readFile, writeFile } from "node:fs/promises";
import { basename, extname } from "node:path";

const BASE = "https://sparkpix.ai";
const REFERER = "https://sparkpix.ai/aitools/free-hd-upscaler";

const API_UPLOAD_URL = `${BASE}/api/upload-url`;
const API_UPSCALE = `${BASE}/api/free-hd-upscale`;
const API_DOWNLOAD = `${BASE}/api/download-image`;

const DEFAULT_IMAGE =
  "https://images.unsplash.com/photo-1503023345310-bd7c1de61c7d?w=900&q=90";

const UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36";

function mimeFromPath(file = "") {
  const ext = extname(file).toLowerCase();

  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";

  return "image/jpeg";
}

function parseQuality(input = "4k") {
  const raw = String(input).toLowerCase().replace(/\s+/g, "");

  if (["8k", "4", "4x"].includes(raw)) return { quality: "8K", scale: 4 };
  if (["6k", "3", "3x"].includes(raw)) return { quality: "6K", scale: 3 };

  return { quality: "4K", scale: 2 };
}

function parseBool(value) {
  const raw = String(value ?? "false").toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

async function readJsonSafe(res) {
  const text = await res.text();

  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
}

async function inputToBuffer(input, options = {}) {
  if (/^https?:\/\//i.test(input)) {
    const res = await fetch(input, {
      headers: {
        accept: "image/*,*/*;q=0.8",
        "user-agent": UA
      }
    });

    if (!res.ok) throw new Error(`Gagal fetch image URL: ${res.status}`);

    const arr = await res.arrayBuffer();
    const mime = res.headers.get("content-type") || "image/jpeg";

    return {
      buffer: Buffer.from(arr),
      filename: options.fileName || "image.jpg",
      mime,
      size: arr.byteLength,
      source: input
    };
  }

  const buffer = await readFile(input);
  const mime = options.mimeType || mimeFromPath(input);

  return {
    buffer,
    filename: options.fileName || basename(input),
    mime,
    size: buffer.length,
    source: input
  };
}

async function getUploadUrl(file) {
  const payload = {
    contentType: file.mime,
    size: file.size,
    fileName: file.filename
  };

  const res = await fetch(API_UPLOAD_URL, {
    method: "POST",
    headers: {
      accept: "*/*",
      "content-type": "application/json",
      origin: BASE,
      referer: REFERER,
      "user-agent": UA
    },
    body: JSON.stringify(payload)
  });

  const { json, text } = await readJsonSafe(res);

  if (!res.ok || !json?.success || !json?.uploadUrl || !json?.publicUrl) {
    throw new Error(JSON.stringify({
      step: "upload-url",
      status_code: res.status,
      request: payload,
      response: json || text.slice(0, 500)
    }));
  }

  return json;
}

async function uploadToR2(uploadUrl, file) {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "content-type": file.mime,
      "content-length": String(file.size)
    },
    body: file.buffer
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");

    throw new Error(JSON.stringify({
      step: "put-upload-url",
      status_code: res.status,
      response: text.slice(0, 500)
    }));
  }

  return true;
}

async function upscaleImage(imageUrl, options = {}) {
  const { quality, scale } = parseQuality(options.quality || options.resolution || "4k");
  const faceEnhance = parseBool(options.faceEnhance);

  const payload = {
    imageUrl,
    scale,
    face_enhance: faceEnhance
  };

  const started = Date.now();

  const res = await fetch(API_UPSCALE, {
    method: "POST",
    headers: {
      accept: "*/*",
      "content-type": "application/json",
      origin: BASE,
      referer: REFERER,
      "user-agent": UA
    },
    body: JSON.stringify(payload)
  });

  const { json, text } = await readJsonSafe(res);

  if (!res.ok || !json?.success || !json?.resultUrl) {
    throw new Error(JSON.stringify({
      step: "free-hd-upscale",
      status_code: res.status,
      request: payload,
      response: json || text.slice(0, 500)
    }));
  }

  return {
    quality,
    scale,
    face_enhance: faceEnhance,
    resultUrl: json.resultUrl,
    processingTime: json.processingTime ?? Date.now() - started
  };
}

async function saveResult(url, output = "sparkpix-output.png") {
  const res = await fetch(url, {
    headers: {
      "user-agent": UA
    }
  });

  if (!res.ok) throw new Error(`Gagal download result: ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(output, buffer);

  return {
    file: output,
    size: buffer.length
  };
}

export function sparkpixDownloadUrl(resultUrl) {
  return `${API_DOWNLOAD}?url=${encodeURIComponent(resultUrl)}`;
}

export async function sparkpixHdUpscale(input = DEFAULT_IMAGE, options = {}) {
  const file = await inputToBuffer(input, options);

  const upload = await getUploadUrl(file);
  await uploadToR2(upload.uploadUrl, file);

  const result = await upscaleImage(upload.publicUrl, options);

  const output = {
    status: true,
    code: 200,
    service: "sparkpix-free-hd-upscale",
    flow: "upload-url -> put -> free-hd-upscale",
    input: {
      source: file.source,
      filename: file.filename,
      mime: file.mime,
      size: file.size
    },
    upload: {
      public_url: upload.publicUrl,
      key: upload.key || null,
      content_type: upload.contentType || file.mime
    },
    options: {
      quality: result.quality,
      scale: result.scale,
      face_enhance: result.face_enhance
    },
    result_url: result.resultUrl,
    download_url: sparkpixDownloadUrl(result.resultUrl),
    processing_time: result.processingTime
  };

  if (options.save) {
    output.saved = await saveResult(
      result.resultUrl,
      typeof options.save === "string"
        ? options.save
        : `sparkpix-${result.quality.toLowerCase()}.png`
    );
  }

  return output;
}

function parseArgs(argv) {
  const input = argv[2] || process.env.IMAGE_URL || DEFAULT_IMAGE;
  const quality = argv[3] || process.env.QUALITY || "4k";

  return {
    input,
    quality,
    faceEnhance:
      argv.includes("--face") ||
      argv.includes("--face-enhance") ||
      process.env.FACE_ENHANCE === "true",
    save: argv.includes("--save")
      ? `sparkpix-${String(quality).toLowerCase()}.png`
      : false
  };
}

async function main() {
  try {
    const args = parseArgs(process.argv);
    const result = await sparkpixHdUpscale(args.input, args);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.log(JSON.stringify({
      status: false,
      code: 500,
      service: "sparkpix-free-hd-upscale",
      error: err.message
    }, null, 2));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

const app = express();

app.use(cors());
app.use(express.json());

app.post('/api/index', async (req, res) => {
  try {
    const { url, resolution } = req.body;
    if (!url) {
      return res.status(400).json({ status: false, message: "URL gambar tidak boleh kosong" });
    }
    
    const result = await sparkpixHdUpscale(url, { quality: resolution });
    
    res.json({
      status: true,
      message: "Image berhasil diproses",
      result: result.result_url,
      download: result.download_url
    });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: "Terjadi kesalahan saat memproses gambar",
      error: error.message || error
    });
  }
});

export default app;import