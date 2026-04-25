const fileInput = document.getElementById('fileInput');
const edgeThresholdInput = document.getElementById('edgeThreshold');
const thresholdValue = document.getElementById('thresholdValue');
const toonifyButton = document.getElementById('toonifyButton');
const demoButton = document.getElementById('demoButton');
const downloadButton = document.getElementById('downloadButton');
const resetButton = document.getElementById('resetButton');
const liveButton = document.getElementById('liveButton');
const statusText = document.getElementById('statusText');
const imageInfo = document.getElementById('imageInfo');
const sourceCanvas = document.getElementById('sourceCanvas');
const resultCanvas = document.getElementById('resultCanvas');
const webcamVideo = document.getElementById('webcamVideo');

const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
const resultContext = resultCanvas.getContext('2d', { willReadFrequently: true });

const settings = {
  maxSize: 640,
  quantizationStep: 64,
  threshold: Number(edgeThresholdInput.value),
};

let sourceReady = false;
let currentImageName = '';
let isLiveMode = false;
let liveStream = null;
let liveLoopTimeout = null;

function updateStatus(message) {
  statusText.textContent = message;
}

function setDownloadReady(ready) {
  downloadButton.disabled = !ready;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function quantize(value, step) {
  return clamp(Math.round(value / step) * step, 0, 255);
}

// ==========================================
// NEW: FAST BOX BLUR (Smooths textures for cartoon look)
// ==========================================
function fastBoxBlur(sourceData, width, height, radius) {
  const tempData = new Uint8ClampedArray(sourceData.length);
  const outputData = new Uint8ClampedArray(sourceData.length);

  //Horizontal Pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, count = 0;
      for (let kx = -radius; kx <= radius; kx++) {
        const nx = Math.min(Math.max(x + kx, 0), width - 1);
        const idx = (y * width + nx) * 4;
        r += sourceData[idx];
        g += sourceData[idx + 1];
        b += sourceData[idx + 2];
        count++;
      }
      const idx = (y * width + x) * 4;
      tempData[idx] = r / count;
      tempData[idx + 1] = g / count;
      tempData[idx + 2] = b / count;
      tempData[idx + 3] = 255;
    }
  }

  //Vertical Pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, count = 0;
      for (let ky = -radius; ky <= radius; ky++) {
        const ny = Math.min(Math.max(y + ky, 0), height - 1);
        const idx = (ny * width + x) * 4;
        r += tempData[idx];
        g += tempData[idx + 1];
        b += tempData[idx + 2];
        count++;
      }
      const idx = (y * width + x) * 4;
      outputData[idx] = r / count;
      outputData[idx + 1] = g / count;
      outputData[idx + 2] = b / count;
      outputData[idx + 3] = 255;
    }
  }

  return outputData;
}

function drawPlaceholder(canvas, context, title, subtitle) {
  const { width, height } = canvas;
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#11192f');
  gradient.addColorStop(1, '#060913');
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  context.strokeStyle = 'rgba(255,255,255,0.08)';
  context.lineWidth = 3;
  context.strokeRect(16, 16, width - 32, height - 32);

  context.fillStyle = 'rgba(102, 227, 196, 0.15)';
  context.beginPath();
  context.arc(width * 0.32, height * 0.42, Math.min(width, height) * 0.19, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = 'rgba(255, 204, 102, 0.14)';
  const boxX = width * 0.58;
  const boxY = height * 0.24;
  const boxWidth = width * 0.2;
  const boxHeight = height * 0.28;
  const radius = 22;

  context.beginPath();
  if (typeof context.roundRect === 'function') {
    context.roundRect(boxX, boxY, boxWidth, boxHeight, radius);
  } else {
    context.moveTo(boxX + radius, boxY);
    context.arcTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + boxHeight, radius);
    context.arcTo(boxX + boxWidth, boxY + boxHeight, boxX, boxY + boxHeight, radius);
    context.arcTo(boxX, boxY + boxHeight, boxX, boxY, radius);
    context.arcTo(boxX, boxY, boxX + boxWidth, boxY, radius);
  }
  context.fill();

  context.fillStyle = '#edf2ff';
  context.font = '700 30px Segoe UI, sans-serif';
  context.fillText(title, 28, 54);

  context.fillStyle = '#a8b3cf';
  context.font = '500 18px Segoe UI, sans-serif';
  const lines = subtitle.split('\n');
  lines.forEach((line, index) => {
    context.fillText(line, 28, 92 + index * 24);
  });
}

function ensureCanvasSize(width, height) {
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  resultCanvas.width = width;
  resultCanvas.height = height;
}

function resetCanvases() {
  drawPlaceholder(
    sourceCanvas,
    sourceContext,
    'Upload an image',
    'Use a portrait, logo, or any high-contrast photo.\nOr load the built-in demo scene.'
  );
  drawPlaceholder(
    resultCanvas,
    resultContext,
    'Toonified output',
    'The processed image appears here after you run the filter.'
  );
}

function resizeDimensions(width, height, maxSize) {
  if (width <= maxSize && height <= maxSize) {
    return { width, height };
  }

  const scale = Math.min(maxSize / width, maxSize / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function drawImageToSourceCanvas(image) {
  const size = resizeDimensions(image.width, image.height, settings.maxSize);
  ensureCanvasSize(size.width, size.height);

  sourceContext.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
  sourceContext.drawImage(image, 0, 0, size.width, size.height);
  resultContext.clearRect(0, 0, resultCanvas.width, resultCanvas.height);

  sourceReady = true;
  setDownloadReady(false);
}

function loadImageFromFile(file) {
  if (!file) {
    return;
  }

  const url = URL.createObjectURL(file);
  const image = new Image();

  image.onload = () => {
    drawImageToSourceCanvas(image);
    currentImageName = file.name.replace(/\.[^.]+$/, '');
    imageInfo.textContent = `${file.name} · ${image.width} × ${image.height}`;
    updateStatus('Image loaded. Click Toonify to generate the effect.');
    URL.revokeObjectURL(url);
  };

  image.onerror = () => {
    updateStatus('That file could not be loaded as an image.');
    URL.revokeObjectURL(url);
  };

  image.src = url;
}

function drawCurrentVideoFrame() {
  const size = resizeDimensions(webcamVideo.videoWidth, webcamVideo.videoHeight, settings.maxSize);
  // ensureCanvasSize(size.width, size.height);
  sourceContext.drawImage(webcamVideo, 0, 0, size.width, size.height);
}

function processCurrentSource(showTiming = true) {
  if (!sourceReady) {
    if (showTiming) {
      updateStatus('Load an image, demo scene, or webcam first.');
    }
    return false;
  }

  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const sourceImage = sourceContext.getImageData(0, 0, width, height);
  const outputImage = resultContext.createImageData(width, height);
  const grayscale = new Float32Array(width * height);
  const outputData = outputImage.data;
  const threshold = Number(edgeThresholdInput.value);

  const startedAt = performance.now();

  // ==========================================
  // NEW: Smooth the image data before processing
  // Running a radius 2 blur 3 times approximates a Bilateral Filter.
  // It crushes micro-textures (skin pores) but keeps shapes intact.
  // ==========================================
  let smoothedData = new Uint8ClampedArray(sourceImage.data);
  smoothedData = fastBoxBlur(smoothedData, width, height, 2);
  smoothedData = fastBoxBlur(smoothedData, width, height, 2);
  smoothedData = fastBoxBlur(smoothedData, width, height, 2);

  // Build grayscale using the SMOOTHED data (creates cleaner edges)
  for (let index = 0, pixel = 0; index < smoothedData.length; index += 4, pixel += 1) {
    grayscale[pixel] = 0.299 * smoothedData[index] + 0.587 * smoothedData[index + 1] + 0.114 * smoothedData[index + 2];
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      const sourceIndex = pixelIndex * 4;

      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        // Quantize the SMOOTHED data
        outputData[sourceIndex] = quantize(smoothedData[sourceIndex], settings.quantizationStep);
        outputData[sourceIndex + 1] = quantize(smoothedData[sourceIndex + 1], settings.quantizationStep);
        outputData[sourceIndex + 2] = quantize(smoothedData[sourceIndex + 2], settings.quantizationStep);
        outputData[sourceIndex + 3] = 255;
        continue;
      }

      const topLeft = grayscale[(y - 1) * width + (x - 1)];
      const top = grayscale[(y - 1) * width + x];
      const topRight = grayscale[(y - 1) * width + (x + 1)];
      const left = grayscale[y * width + (x - 1)];
      const right = grayscale[y * width + (x + 1)];
      const bottomLeft = grayscale[(y + 1) * width + (x - 1)];
      const bottom = grayscale[(y + 1) * width + x];
      const bottomRight = grayscale[(y + 1) * width + (x + 1)];

      const gx = -topLeft - 2 * left - bottomLeft + topRight + 2 * right + bottomRight;
      const gy = -topLeft - 2 * top - topRight + bottomLeft + 2 * bottom + bottomRight;
      const magnitude = Math.sqrt(gx * gx + gy * gy);

      if (magnitude > threshold) {
        outputData[sourceIndex] = 0;
        outputData[sourceIndex + 1] = 0;
        outputData[sourceIndex + 2] = 0;
        outputData[sourceIndex + 3] = 255;
        continue;
      }

      outputData[sourceIndex] = quantize(smoothedData[sourceIndex], settings.quantizationStep);
      outputData[sourceIndex + 1] = quantize(smoothedData[sourceIndex + 1], settings.quantizationStep);
      outputData[sourceIndex + 2] = quantize(smoothedData[sourceIndex + 2], settings.quantizationStep);
      outputData[sourceIndex + 3] = 255;
    }
  }

  resultContext.putImageData(outputImage, 0, 0);
  setDownloadReady(!isLiveMode);

  if (showTiming) {
    const elapsed = (performance.now() - startedAt).toFixed(1);
    updateStatus(`Toonified in ${elapsed} ms. Adjust the threshold and run again to change edge strength.`);
  }

  return true;
}

function createDemoScene() {
  const width = 960;
  const height = 720;
  const demoCanvas = document.createElement('canvas');
  demoCanvas.width = width;
  demoCanvas.height = height;
  const ctx = demoCanvas.getContext('2d');

  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#13264d');
  sky.addColorStop(1, '#3f8bb0');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  for (let index = 0; index < 9; index += 1) {
    ctx.beginPath();
    ctx.arc(110 + index * 92, 115 + (index % 3) * 26, 34 + (index % 2) * 10, 0, Math.PI * 2);
    ctx.fill();
  }

  const ground = ctx.createLinearGradient(0, 410, 0, height);
  ground.addColorStop(0, '#244c36');
  ground.addColorStop(1, '#101b19');
  ctx.fillStyle = ground;
  ctx.fillRect(0, 430, width, 290);

  ctx.fillStyle = '#ffd36e';
  ctx.beginPath();
  ctx.arc(790, 115, 58, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#1b2235';
  ctx.fillRect(82, 290, 190, 195);
  ctx.fillRect(282, 230, 150, 255);
  ctx.fillRect(455, 260, 220, 225);

  ctx.fillStyle = '#f56d91';
  ctx.fillRect(107, 320, 44, 44);
  ctx.fillRect(176, 320, 44, 44);
  ctx.fillRect(317, 260, 36, 36);
  ctx.fillRect(372, 260, 36, 36);
  ctx.fillRect(502, 295, 50, 50);
  ctx.fillRect(573, 295, 50, 50);

  ctx.fillStyle = '#69dcc0';
  ctx.beginPath();
  ctx.arc(735, 455, 120, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e8f1ff';
  ctx.font = '700 68px Segoe UI, sans-serif';
  ctx.fillText('TOONIFY', 76, 640);

  return demoCanvas;
}

function toonifyImage() {
  processCurrentSource(true);
}

function downloadResult() {
  if (!sourceReady) {
    return;
  }

  const link = document.createElement('a');
  const safeName = currentImageName || 'toonified-image';
  link.download = `${safeName}-toonified.png`;
  link.href = resultCanvas.toDataURL('image/png');
  link.click();
}

function stopLiveMode(message = 'Live mode stopped.') {
  isLiveMode = false;

  if (liveLoopTimeout) {
    clearTimeout(liveLoopTimeout);
    liveLoopTimeout = null;
  }

  if (liveStream) {
    liveStream.getTracks().forEach((track) => track.stop());
    liveStream = null;
  }

  webcamVideo.srcObject = null;
  liveButton.textContent = 'Start webcam';
  toonifyButton.disabled = false;
  fileInput.disabled = false;
  demoButton.disabled = false;
  downloadButton.disabled = !sourceReady;

  if (message) {
    updateStatus(message);
  }
}

async function startLiveMode() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    updateStatus('This browser does not support webcam access.');
    return;
  }

  try {
    liveStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });

    webcamVideo.srcObject = liveStream;
    await webcamVideo.play();

    if (!webcamVideo.videoWidth || !webcamVideo.videoHeight) {
      await new Promise((resolve) => {
        webcamVideo.onloadedmetadata = () => resolve();
      });
    }

    isLiveMode = true;
    liveButton.textContent = 'Stop webcam';
    toonifyButton.disabled = true;
    fileInput.disabled = true;
    demoButton.disabled = true;
    downloadButton.disabled = true;

    updateStatus('Webcam active. The preview updates automatically.');

    const loop = () => {
      if (!isLiveMode) {
        return;
      }

      drawCurrentVideoFrame();
      processCurrentSource(false);
      liveLoopTimeout = setTimeout(loop, 50);
    };

    loop();
  } catch (error) {
    stopLiveMode('Webcam access was denied or unavailable.');
  }
}

edgeThresholdInput.addEventListener('input', () => {
  settings.threshold = Number(edgeThresholdInput.value);
  thresholdValue.textContent = edgeThresholdInput.value;

  if (isLiveMode && sourceReady) {
    processCurrentSource(false);
  }
});

fileInput.addEventListener('change', (event) => {
  const [file] = event.target.files;
  if (file) {
    loadImageFromFile(file);
  }
});

toonifyButton.addEventListener('click', toonifyImage);
demoButton.addEventListener('click', () => {
  const demoScene = createDemoScene();
  drawImageToSourceCanvas(demoScene);
  currentImageName = 'demo-scene';
  imageInfo.textContent = 'Built-in demo scene · 960 × 720';
  updateStatus('Demo scene loaded. Click Toonify to see the effect.');
});

liveButton.addEventListener('click', () => {
  if (isLiveMode) {
    stopLiveMode();
    return;
  }

  startLiveMode();
});

downloadButton.addEventListener('click', downloadResult);

resetButton.addEventListener('click', () => {
  if (isLiveMode) {
    stopLiveMode('Live mode stopped.');
  }

  fileInput.value = '';
  currentImageName = '';
  sourceReady = false;
  imageInfo.textContent = '';
  downloadButton.disabled = true;
  resetCanvases();
  updateStatus('Load an image or demo scene to begin.');
});

thresholdValue.textContent = edgeThresholdInput.value;
resetCanvases();
