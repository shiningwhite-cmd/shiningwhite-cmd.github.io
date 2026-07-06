const LUMA = [0.299, 0.587, 0.114];

export async function processPhotoModifier({
  landscapeFile,
  polaroidFile,
  options,
}) {
  const landscapeImage = await loadImageElement(landscapeFile);
  const polaroidImage = await loadImageElement(polaroidFile);

  const normalized = normalizeOptions(options);
  const landscapeCanvas = imageToCanvas(landscapeImage);
  const polaroidCanvas = trimScannedObject(imageToCanvas(polaroidImage));
  const sceneLight = analyzeSceneLight(landscapeCanvas);

  const processedPolaroid = rebuildPolaroidScene(polaroidCanvas, landscapeCanvas, sceneLight, normalized);
  const composed = composeForegroundBackground(landscapeCanvas, processedPolaroid, sceneLight, normalized);

  const blob = await canvasToBlob(composed, "image/jpeg", 0.94);
  return {
    blob,
    objectUrl: URL.createObjectURL(blob),
  };
}

function normalizeOptions(options) {
  return {
    focusTarget: options.focusTarget === "background" ? "background" : "polaroid",
    placementCorner: options.placementCorner === "right" ? "right" : "left",
    polaroidHeightRatio: clamp(Number(options.polaroidHeightRatio) || 0.5, 1 / 16, 1 / 2),
    centerPullStrength: clamp(Number(options.centerPullStrength) || 0.1, 0, 1),
    perspectiveStrength: clamp(Number(options.perspectiveStrength) || 0.01, 0, 0.1),
    lightMatchStrength: clamp(Number(options.lightMatchStrength) || 0.7, 0, 1),
    ambientTintStrength: clamp(Number(options.ambientTintStrength) || 0.35, 0, 1),
    reflectionStrength: clamp(Number(options.reflectionStrength) || 0.55, 0, 1),
    filmStrength: clamp(Number(options.filmStrength) || 0.5, 0, 1),
    edgeDepthStrength: clamp(Number(options.edgeDepthStrength) || 0.55, 0, 1),
    rotationDegrees: -5,
    edgeOverflowRatio: 0.035,
    bottomOverflowRatio: 0.035,
  };
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(value, maximum));
}

function createCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function imageToCanvas(image) {
  const canvas = createCanvas(image.naturalWidth || image.width, image.naturalHeight || image.height);
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("浏览器未能生成输出图片。"));
      }
    }, type, quality);
  });
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片读取失败。"));
    };
    image.src = url;
  });
}

function getImageData(canvas) {
  return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
}

function putImageData(canvas, imageData) {
  canvas.getContext("2d").putImageData(imageData, 0, 0);
  return canvas;
}

function resizeCanvas(source, width, height, smoothing = true) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = smoothing;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function cropCanvas(source, left, top, width, height) {
  const canvas = createCanvas(width, height);
  canvas.getContext("2d").drawImage(source, left, top, width, height, 0, 0, width, height);
  return canvas;
}

function fitCanvas(source, width, height, centerX = 0.5, centerY = 0.5) {
  const scale = Math.max(width / source.width, height / source.height);
  const drawWidth = source.width * scale;
  const drawHeight = source.height * scale;
  const offsetX = (width - drawWidth) * centerX;
  const offsetY = (height - drawHeight) * centerY;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(source, offsetX, offsetY, drawWidth, drawHeight);
  return canvas;
}

function trimScannedObject(canvas) {
  const imageData = getImageData(canvas);
  const { data, width, height } = imageData;
  const rgb = new Int16Array(width * height * 3);
  const alpha = new Uint8Array(width * height);

  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    rgb[j] = data[i];
    rgb[j + 1] = data[i + 1];
    rgb[j + 2] = data[i + 2];
    alpha[j / 3] = data[i + 3];
  }

  const sampleSize = Math.min(20, width, height);
  const cornerSamples = [];
  pushCornerSamples(cornerSamples, rgb, width, 0, 0, sampleSize, sampleSize);
  pushCornerSamples(cornerSamples, rgb, width, width - sampleSize, 0, width, sampleSize);
  pushCornerSamples(cornerSamples, rgb, width, 0, height - sampleSize, sampleSize, height);
  pushCornerSamples(cornerSamples, rgb, width, width - sampleSize, height - sampleSize, width, height);
  const bg = medianTriplet(cornerSamples);

  let hasRealAlpha = false;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      const rIdx = idx * 3;
      const a = alpha[idx];
      if (a < 250) {
        hasRealAlpha = true;
      }
      const dr = rgb[rIdx] - bg[0];
      const dg = rgb[rIdx + 1] - bg[1];
      const db = rgb[rIdx + 2] - bg[2];
      const distance = Math.sqrt(dr * dr + dg * dg + db * db);
      const keep = hasRealAlpha ? a > 10 : distance > 18;
      if (keep) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < 0 || maxY < 0) {
    return canvas;
  }

  const pad = 12;
  return cropCanvas(
    canvas,
    Math.max(0, minX - pad),
    Math.max(0, minY - pad),
    Math.min(width, maxX + 1 + pad) - Math.max(0, minX - pad),
    Math.min(height, maxY + 1 + pad) - Math.max(0, minY - pad),
  );
}

function pushCornerSamples(target, rgb, width, startX, startY, endX, endY) {
  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const idx = (y * width + x) * 3;
      target.push([rgb[idx], rgb[idx + 1], rgb[idx + 2]]);
    }
  }
}

function medianTriplet(samples) {
  const channels = [[], [], []];
  for (const sample of samples) {
    channels[0].push(sample[0]);
    channels[1].push(sample[1]);
    channels[2].push(sample[2]);
  }
  return channels.map((channel) => {
    channel.sort((a, b) => a - b);
    return channel[Math.floor(channel.length / 2)] || 255;
  });
}

function analyzeSceneLight(landscapeCanvas) {
  const sample = fitCanvas(landscapeCanvas, 96, 96, 0.5, 0.5);
  const imageData = getImageData(sample);
  const arr = imageData.data;
  const pixelCount = sample.width * sample.height;
  const ambient = [0, 0, 0];
  const luma = new Float32Array(pixelCount);
  const saturation = new Float32Array(pixelCount);

  for (let i = 0, p = 0; i < arr.length; i += 4, p += 1) {
    const r = arr[i];
    const g = arr[i + 1];
    const b = arr[i + 2];
    ambient[0] += r;
    ambient[1] += g;
    ambient[2] += b;
    luma[p] = r * LUMA[0] + g * LUMA[1] + b * LUMA[2];
    saturation[p] = (Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(Math.max(r, g, b), 1);
  }

  ambient[0] /= pixelCount;
  ambient[1] /= pixelCount;
  ambient[2] /= pixelCount;
  const illuminant = estimateIlluminantColor(arr, sample.width, sample.height, luma, saturation);

  const lumaMean = averageArray(luma);
  let weightSum = 0;
  let weightedX = 0;
  let weightedY = 0;
  for (let y = 0; y < sample.height; y += 1) {
    for (let x = 0; x < sample.width; x += 1) {
      const idx = y * sample.width + x;
      const weight = Math.max(0, luma[idx] - lumaMean);
      weightSum += weight;
      weightedX += x * weight;
      weightedY += y * weight;
    }
  }

  let lightDirection = [-0.35, -0.9];
  if (weightSum > 1e-3) {
    const centerX = weightedX / weightSum;
    const centerY = weightedY / weightSum;
    const lightX = (centerX / Math.max(1, sample.width - 1) - 0.5) * 2;
    const lightY = (centerY / Math.max(1, sample.height - 1) - 0.5) * 2;
    const length = Math.max(Math.hypot(lightX, lightY), 1e-3);
    lightDirection = [lightX / length, lightY / length];
  }

  return {
    ambientRgb: ambient,
    illuminantRgb: illuminant,
    lightDirection,
  };
}

function estimateIlluminantColor(data, width, height, luma, saturation) {
  const lumaValues = Array.from(luma);
  const p65 = percentile(lumaValues, 65);
  const p98 = percentile(lumaValues, 98);
  const weights = new Float32Array(width * height);
  let weightSum = 0;
  const direction = [0, 0, 0];
  const bright = [0, 0, 0];

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const brightnessWeight = clamp((luma[p] - p65) / Math.max(p98 - p65, 1), 0, 1);
    const neutralityWeight = 1 - saturation[p] * 0.65;
    const weight = clamp(brightnessWeight * neutralityWeight, 0, 1);
    weights[p] = weight;
    weightSum += weight;

    const maxChannel = Math.max(r, g, b, 1);
    direction[0] += (r / maxChannel) * weight;
    direction[1] += (g / maxChannel) * weight;
    direction[2] += (b / maxChannel) * weight;
    bright[0] += r * weight;
    bright[1] += g * weight;
    bright[2] += b * weight;
  }

  if (weightSum < 1e-3) {
    return [244, 242, 238];
  }

  direction[0] /= weightSum;
  direction[1] /= weightSum;
  direction[2] /= weightSum;
  const directionMean = Math.max((direction[0] + direction[1] + direction[2]) / 3, 1e-3);
  direction[0] /= directionMean;
  direction[1] /= directionMean;
  direction[2] /= directionMean;

  bright[0] /= weightSum;
  bright[1] /= weightSum;
  bright[2] /= weightSum;
  const brightLuma = dot(bright, LUMA);
  let illuminant = direction.map((value) => value * Math.max(brightLuma, 160));
  const neutralWhite = [244, 242, 238];
  illuminant = illuminant.map((value, index) => clamp(value * 0.72 + neutralWhite[index] * 0.28, 0, 255));
  return illuminant;
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[index];
}

function averageArray(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function dot(vector, weights) {
  return vector[0] * weights[0] + vector[1] * weights[1] + vector[2] * weights[2];
}

function detectPhotoWindow(canvas) {
  const imageData = getImageData(canvas);
  const { data, width, height } = imageData;
  const margin = Math.max(4, Math.floor(Math.min(width, height) / 80));
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = margin; y < height - margin; y += 1) {
    for (let x = margin; x < width - margin; x += 1) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const gray = (r + g + b) / 3;
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      const content = gray < 238 || sat > 18;
      if (content) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < 0 || maxY < 0) {
    return fallbackPhotoWindow(width, height);
  }

  const box = { left: minX, top: minY, right: maxX + 1, bottom: maxY + 1 };
  if (box.right - box.left < width * 0.3 || box.bottom - box.top < height * 0.25) {
    return fallbackPhotoWindow(width, height);
  }
  return box;
}

function fallbackPhotoWindow(width, height) {
  const insetX = Math.floor(width * 0.12);
  const insetTop = Math.floor(height * 0.08);
  const insetBottom = Math.floor(height * 0.22);
  return {
    left: insetX,
    top: insetTop,
    right: width - insetX,
    bottom: height - insetBottom,
  };
}

function insetPhotoWindow(box) {
  const width = Math.max(1, box.right - box.left);
  const height = Math.max(1, box.bottom - box.top);
  const inset = Math.max(2, Math.floor(Math.min(width, height) * 0.02));
  const safeInsetX = Math.min(inset, Math.max(0, Math.floor((width - 1) / 2)));
  const safeInsetY = Math.min(inset, Math.max(0, Math.floor((height - 1) / 2)));
  return {
    left: box.left + safeInsetX,
    top: box.top + safeInsetY,
    right: box.right - safeInsetX,
    bottom: box.bottom - safeInsetY,
  };
}

function rebuildPolaroidScene(polaroidCanvas, landscapeCanvas, sceneLight, options) {
  const photoBox = insetPhotoWindow(detectPhotoWindow(polaroidCanvas));
  const innerPhoto = extractAndStylePolaroidPhoto(polaroidCanvas, photoBox, landscapeCanvas, sceneLight, options);
  return addGlossyReflection(innerPhoto, sceneLight, options.reflectionStrength);
}

function extractAndStylePolaroidPhoto(polaroidCanvas, photoBox, landscapeCanvas, sceneLight, options) {
  const width = Math.max(1, photoBox.right - photoBox.left);
  const height = Math.max(1, photoBox.bottom - photoBox.top);
  const photoCrop = cropCanvas(polaroidCanvas, photoBox.left, photoBox.top, width, height);
  const shifted = createTimeOffsetPhoto(photoCrop, options.filmStrength);
  let fitted = fitCanvas(shifted, width, height, 0.52, 0.48);
  fitted = harmonizePhotoWithLandscape(
    fitted,
    landscapeCanvas,
    sceneLight,
    options.lightMatchStrength,
    options.ambientTintStrength,
  );
  fitted = adjustSaturation(fitted, 1 - 0.08 * options.filmStrength);
  fitted = adjustContrast(fitted, 1 - 0.04 * options.filmStrength);
  fitted = adjustWarmBias(fitted, 0.02 * options.filmStrength);
  fitted = blurCanvas(fitted, 0.15 + 0.6 * options.filmStrength);
  fitted = addGrain(fitted, Math.round(1 + 7 * options.filmStrength));
  fitted = addVignette(fitted, 0.05 + 0.2 * options.filmStrength);
  return applyCornerRounding(fitted, 0.035);
}

function createTimeOffsetPhoto(photoCanvas, filmStrength) {
  const zoomFactor = 1.01 + 0.06 * filmStrength;
  const zoomed = resizeCanvas(photoCanvas, photoCanvas.width * zoomFactor, photoCanvas.height * zoomFactor);
  const centerX = clamp(0.5 + 0.08 * filmStrength, 0, 1);
  const centerY = clamp(0.5 - 0.06 * filmStrength, 0, 1);
  return fitCanvas(zoomed, photoCanvas.width, photoCanvas.height, centerX, centerY);
}

function harmonizePhotoWithLandscape(photoCanvas, landscapeCanvas, sceneLight, lightMatchStrength, ambientTintStrength) {
  const result = resizeCanvas(photoCanvas, photoCanvas.width, photoCanvas.height);
  const imageData = getImageData(result);
  const landscapeFit = fitCanvas(landscapeCanvas, photoCanvas.width, photoCanvas.height, 0.5, 0.5);
  const landscapeData = getImageData(landscapeFit).data;
  const data = imageData.data;
  const ambient = sceneLight.ambientRgb;
  const illuminant = sceneLight.illuminantRgb;

  const photoMean = meanRgb(data);
  const landscapeMean = meanRgb(landscapeData);
  const photoLuma = dot(photoMean, LUMA);
  const landscapeLuma = dot(landscapeMean, LUMA);
  const brightnessScale = clamp(1 + ((landscapeLuma / Math.max(photoLuma, 1)) - 1) * 0.35 * lightMatchStrength, 0.9, 1.1);

  const photoNorm = normalizeMean(photoMean);
  const landscapeNorm = normalizeMean(landscapeMean);
  const channelScale = landscapeNorm.map((value, index) => 1 + ((value / Math.max(photoNorm[index], 1e-3)) - 1) * 0.22 * lightMatchStrength);
  const illuminantShift = illuminant.map((value, index) => (value - photoMean[index]) * 0.16 * lightMatchStrength);
  const sceneShift = landscapeMean.map((value, index) => (value - photoMean[index]) * 0.025 * lightMatchStrength);
  const ambientShift = ambient.map((value, index) => (value - photoMean[index]) * 0.08 * ambientTintStrength);

  for (let i = 0; i < data.length; i += 4) {
    data[i] = clamp(data[i] * brightnessScale * channelScale[0] + illuminantShift[0] + sceneShift[0] + ambientShift[0], 0, 255);
    data[i + 1] = clamp(data[i + 1] * brightnessScale * channelScale[1] + illuminantShift[1] + sceneShift[1] + ambientShift[1], 0, 255);
    data[i + 2] = clamp(data[i + 2] * brightnessScale * channelScale[2] + illuminantShift[2] + sceneShift[2] + ambientShift[2], 0, 255);
  }

  putImageData(result, imageData);
  const photoSat = meanSaturation(data);
  const landscapeSat = meanSaturation(landscapeData);
  const saturationDriver = Math.max(lightMatchStrength * 0.7, ambientTintStrength * 0.5);
  const saturationScale = clamp(1 + ((landscapeSat / Math.max(photoSat, 1)) - 1) * 0.18 * saturationDriver, 0.92, 1.08);
  return adjustSaturation(result, saturationScale);
}

function meanRgb(data) {
  const rgb = [0, 0, 0];
  const count = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    rgb[0] += data[i];
    rgb[1] += data[i + 1];
    rgb[2] += data[i + 2];
  }
  return rgb.map((value) => value / Math.max(count, 1));
}

function normalizeMean(mean) {
  const meanValue = Math.max((mean[0] + mean[1] + mean[2]) / 3, 1);
  return mean.map((value) => value / meanValue);
}

function meanSaturation(data) {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
    count += 1;
  }
  return sum / Math.max(count, 1);
}

function adjustSaturation(canvas, scale) {
  const result = resizeCanvas(canvas, canvas.width, canvas.height);
  const imageData = getImageData(result);
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    const gray = dot([data[i], data[i + 1], data[i + 2]], LUMA);
    data[i] = clamp(gray + (data[i] - gray) * scale, 0, 255);
    data[i + 1] = clamp(gray + (data[i + 1] - gray) * scale, 0, 255);
    data[i + 2] = clamp(gray + (data[i + 2] - gray) * scale, 0, 255);
  }
  return putImageData(result, imageData);
}

function adjustContrast(canvas, scale) {
  const result = resizeCanvas(canvas, canvas.width, canvas.height);
  const imageData = getImageData(result);
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clamp((data[i] - 128) * scale + 128, 0, 255);
    data[i + 1] = clamp((data[i + 1] - 128) * scale + 128, 0, 255);
    data[i + 2] = clamp((data[i + 2] - 128) * scale + 128, 0, 255);
  }
  return putImageData(result, imageData);
}

function adjustWarmBias(canvas, warmBias) {
  const result = resizeCanvas(canvas, canvas.width, canvas.height);
  const imageData = getImageData(result);
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clamp(data[i] * (1 + warmBias), 0, 255);
    data[i + 2] = clamp(data[i + 2] * (1 - warmBias), 0, 255);
  }
  return putImageData(result, imageData);
}

function blurCanvas(canvas, radius) {
  if (radius <= 0.01) {
    return resizeCanvas(canvas, canvas.width, canvas.height);
  }
  const result = createCanvas(canvas.width, canvas.height);
  const ctx = result.getContext("2d");
  ctx.filter = `blur(${radius}px)`;
  ctx.drawImage(canvas, 0, 0);
  ctx.filter = "none";
  return result;
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (1664525 * value + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function addGrain(canvas, amount) {
  if (amount <= 0) {
    return resizeCanvas(canvas, canvas.width, canvas.height);
  }
  const result = resizeCanvas(canvas, canvas.width, canvas.height);
  const imageData = getImageData(result);
  const { data } = imageData;
  const random = seededRandom(7);
  for (let i = 0; i < data.length; i += 4) {
    const noise = (random() * 2 - 1) * amount;
    data[i] = clamp(data[i] + noise, 0, 255);
    data[i + 1] = clamp(data[i + 1] + noise, 0, 255);
    data[i + 2] = clamp(data[i + 2] + noise, 0, 255);
  }
  return putImageData(result, imageData);
}

function addVignette(canvas, strength) {
  const result = resizeCanvas(canvas, canvas.width, canvas.height);
  const imageData = getImageData(result);
  const { data, width, height } = imageData;
  for (let y = 0; y < height; y += 1) {
    const yNorm = (y / Math.max(1, height - 1)) * 2 - 1;
    for (let x = 0; x < width; x += 1) {
      const xNorm = (x / Math.max(1, width - 1)) * 2 - 1;
      const distance = Math.hypot(xNorm, yNorm);
      const mask = 1 - clamp((distance - 0.15) / 0.95, 0, 1) * strength;
      const idx = (y * width + x) * 4;
      data[idx] *= mask;
      data[idx + 1] *= mask;
      data[idx + 2] *= mask;
    }
  }
  return putImageData(result, imageData);
}

function applyCornerRounding(canvas, radiusRatio) {
  const width = canvas.width;
  const height = canvas.height;
  const base = Math.min(width, height);
  const scale = 4;
  const largeWidth = width * scale;
  const largeHeight = height * scale;
  const maskCanvas = createCanvas(largeWidth, largeHeight);
  const maskCtx = maskCanvas.getContext("2d");
  maskCtx.fillStyle = "#000";
  const chamferBase = Math.max(2, Math.round(base * radiusRatio * scale));
  const points = [
    [Math.round(chamferBase * 0.92), 0],
    [largeWidth - Math.round(chamferBase * 1.06), 0],
    [largeWidth, Math.round(chamferBase * 0.9)],
    [largeWidth, largeHeight - Math.round(chamferBase * 1.08)],
    [largeWidth - Math.round(chamferBase * 0.98), largeHeight],
    [Math.round(chamferBase * 1.12), largeHeight],
    [0, largeHeight - Math.round(chamferBase * 0.94)],
    [0, Math.round(chamferBase * 1.1)],
  ];

  maskCtx.beginPath();
  maskCtx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) {
    maskCtx.lineTo(points[i][0], points[i][1]);
  }
  maskCtx.closePath();
  maskCtx.fill();

  const softenRadius = Math.max(2, Math.round(chamferBase * 0.38));
  for (const [x, y] of points) {
    maskCtx.beginPath();
    maskCtx.arc(x, y, softenRadius, 0, Math.PI * 2);
    maskCtx.fill();
  }

  const reducedMask = resizeCanvas(blurCanvas(maskCanvas, scale * 0.45), width, height);
  const result = createCanvas(width, height);
  const ctx = result.getContext("2d");
  ctx.drawImage(canvas, 0, 0);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(reducedMask, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  return result;
}

function addGlossyReflection(canvas, sceneLight, reflectionStrength) {
  if (reflectionStrength <= 0) {
    return resizeCanvas(canvas, canvas.width, canvas.height);
  }
  const result = resizeCanvas(canvas, canvas.width, canvas.height);
  const imageData = getImageData(result);
  const { data, width, height } = imageData;
  const [lightX, lightY] = sceneLight.lightDirection;

  for (let y = 0; y < height; y += 1) {
    const yNorm = y / Math.max(1, height - 1) - 0.5;
    for (let x = 0; x < width; x += 1) {
      const xNorm = x / Math.max(1, width - 1) - 0.5;
      const projection = xNorm * lightX + yNorm * lightY;
      let highlight = Math.exp(-((projection + 0.08) ** 2) / 0.02);
      highlight *= 0.85 + clamp(-(yNorm * lightY), 0, 1) * 0.15;
      const idx = (y * width + x) * 4;
      const luminance = (data[idx] * LUMA[0] + data[idx + 1] * LUMA[1] + data[idx + 2] * LUMA[2]) / 255;
      const darknessMask = 1 - luminance;
      const reflection = highlight * darknessMask * (18 + 62 * reflectionStrength) / 255;
      data[idx] = clamp(data[idx] + (255 - data[idx]) * reflection, 0, 255);
      data[idx + 1] = clamp(data[idx + 1] + (255 - data[idx + 1]) * reflection, 0, 255);
      data[idx + 2] = clamp(data[idx + 2] + (255 - data[idx + 2]) * reflection, 0, 255);
    }
  }

  return putImageData(result, imageData);
}

function padCanvas(canvas, padding) {
  if (padding <= 0) {
    return resizeCanvas(canvas, canvas.width, canvas.height);
  }
  const padded = createCanvas(canvas.width + padding * 2, canvas.height + padding * 2);
  padded.getContext("2d").drawImage(canvas, padding, padding);
  return padded;
}

function addEdgeDepthEffects(canvas, sceneLight, edgeDepthStrength) {
  if (edgeDepthStrength <= 0) {
    return resizeCanvas(canvas, canvas.width, canvas.height);
  }
  const padding = Math.max(2, Math.round(Math.min(canvas.width, canvas.height) * (0.012 + 0.028 * edgeDepthStrength)));
  const padded = padCanvas(canvas, padding);
  const alpha = alphaMaskFromCanvas(padded);
  const thicknessPixels = 1 + edgeDepthStrength * 6;
  const [lightX, lightY] = sceneLight.lightDirection;
  const depthDx = Math.round(-lightX * thicknessPixels);
  const depthDy = Math.round(Math.max(1, -lightY * thicknessPixels + thicknessPixels * 0.5));
  let outer = expandMask(alpha, padded.width, padded.height, Math.max(1, Math.round(1 + edgeDepthStrength * 2)));
  let outerRing = subtractMask(outer, alpha);
  let thicknessMask = offsetMaskWithoutWrap(outerRing, padded.width, padded.height, depthDx, depthDy);
  thicknessMask = subtractMask(thicknessMask, alpha);
  thicknessMask = blurMask(thicknessMask, padded.width, padded.height, Math.max(1, edgeDepthStrength * 1.6));
  thicknessMask = brightenMask(thicknessMask, 0.55 + edgeDepthStrength * 0.75);

  const thicknessLayer = createCanvas(padded.width, padded.height);
  drawColorMask(thicknessLayer, [10, 8, 8], thicknessMask);

  let rim = subtractMask(
    blurMask(expandMask(alpha, padded.width, padded.height, 2), padded.width, padded.height, 1 + edgeDepthStrength * 1.2),
    blurMask(alpha, padded.width, padded.height, 1),
  );

  const highlightMask = directionalHighlightMask(rim, padded.width, padded.height, lightX, lightY, edgeDepthStrength);
  const highlightLayer = createCanvas(padded.width, padded.height);
  drawColorMask(highlightLayer, [250, 248, 242], highlightMask);

  const result = createCanvas(padded.width, padded.height);
  const ctx = result.getContext("2d");
  ctx.drawImage(thicknessLayer, 0, 0);
  ctx.drawImage(padded, 0, 0);
  ctx.drawImage(highlightLayer, 0, 0);
  return result;
}

function alphaMaskFromCanvas(canvas) {
  const data = getImageData(canvas).data;
  const alpha = new Uint8ClampedArray(canvas.width * canvas.height);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    alpha[p] = data[i + 3];
  }
  return alpha;
}

function expandMask(mask, width, height, radius) {
  const expanded = new Uint8ClampedArray(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let maxValue = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          maxValue = Math.max(maxValue, mask[yy * width + xx]);
        }
      }
      expanded[y * width + x] = maxValue;
    }
  }
  return expanded;
}

function subtractMask(a, b) {
  const result = new Uint8ClampedArray(a.length);
  for (let i = 0; i < a.length; i += 1) {
    result[i] = Math.max(0, a[i] - b[i]);
  }
  return result;
}

function blurMask(mask, width, height, radius) {
  const maskCanvas = createCanvas(width, height);
  const imageData = maskCanvas.getContext("2d").createImageData(width, height);
  for (let i = 0, p = 0; p < mask.length; i += 4, p += 1) {
    imageData.data[i + 3] = mask[p];
  }
  putImageData(maskCanvas, imageData);
  const blurred = blurCanvas(maskCanvas, radius);
  const blurredData = getImageData(blurred).data;
  const result = new Uint8ClampedArray(mask.length);
  for (let i = 0, p = 0; p < result.length; i += 4, p += 1) {
    result[p] = blurredData[i + 3];
  }
  return result;
}

function brightenMask(mask, scale) {
  const result = new Uint8ClampedArray(mask.length);
  for (let i = 0; i < mask.length; i += 1) {
    result[i] = clamp(mask[i] * scale, 0, 255);
  }
  return result;
}

function directionalHighlightMask(mask, width, height, lightX, lightY, edgeDepthStrength) {
  const result = new Uint8ClampedArray(mask.length);
  for (let y = 0; y < height; y += 1) {
    const yNorm = y / Math.max(1, height - 1) - 0.5;
    for (let x = 0; x < width; x += 1) {
      const xNorm = x / Math.max(1, width - 1) - 0.5;
      const projection = xNorm * lightX + yNorm * lightY;
      let lightWeight = clamp(projection + 0.55, 0, 1);
      lightWeight = lightWeight ** 1.35;
      const idx = y * width + x;
      result[idx] = clamp(mask[idx] * lightWeight * (0.55 + edgeDepthStrength * 0.85), 0, 255);
    }
  }
  return blurMask(result, width, height, Math.max(0.8, edgeDepthStrength * 0.9));
}

function drawColorMask(canvas, rgb, mask) {
  const imageData = canvas.getContext("2d").createImageData(canvas.width, canvas.height);
  for (let i = 0, p = 0; p < mask.length; i += 4, p += 1) {
    imageData.data[i] = rgb[0];
    imageData.data[i + 1] = rgb[1];
    imageData.data[i + 2] = rgb[2];
    imageData.data[i + 3] = mask[p];
  }
  putImageData(canvas, imageData);
}

function trimTransparentPadding(canvas, padding = 0) {
  const alpha = alphaMaskFromCanvas(canvas);
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if (alpha[y * canvas.width + x] > 0) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < 0 || maxY < 0) {
    return canvas;
  }
  const left = Math.max(0, minX - padding);
  const top = Math.max(0, minY - padding);
  const right = Math.min(canvas.width, maxX + 1 + padding);
  const bottom = Math.min(canvas.height, maxY + 1 + padding);
  return cropCanvas(canvas, left, top, right - left, bottom - top);
}

function composeForegroundBackground(landscapeCanvas, polaroidCanvas, sceneLight, options) {
  let background = resizeCanvas(landscapeCanvas, landscapeCanvas.width, landscapeCanvas.height);
  if (options.focusTarget === "polaroid") {
    background = blurCanvas(background, 1.6);
  }

  const targetHeight = Math.max(1, Math.round(background.height * options.polaroidHeightRatio));
  const targetWidth = Math.max(1, Math.round(polaroidCanvas.width * (targetHeight / polaroidCanvas.height)));
  let foreground = resizeCanvas(polaroidCanvas, targetWidth, targetHeight);
  if (options.focusTarget !== "polaroid") {
    foreground = blurCanvas(foreground, 0.8);
  }

  foreground = applyPerspectiveTilt(foreground, options.placementCorner, options.perspectiveStrength);
  const geometryPadding = Math.max(2, Math.round(2 + options.edgeDepthStrength * 6));
  foreground = trimTransparentPadding(foreground, geometryPadding);
  const rotation = options.placementCorner === "left" ? -Math.abs(options.rotationDegrees) : Math.abs(options.rotationDegrees);
  foreground = rotateCanvas(foreground, rotation);
  foreground = trimTransparentPadding(foreground, geometryPadding);
  foreground = addEdgeDepthEffects(foreground, sceneLight, options.edgeDepthStrength);
  foreground = trimTransparentPadding(foreground, Math.max(1, Math.floor(geometryPadding / 2)));

  const horizontalOverflow = Math.round(background.width * options.edgeOverflowRatio);
  const bottomOverflow = Math.round(background.height * options.bottomOverflowRatio);
  const inwardShiftX = Math.round(background.width * 0.14 * options.centerPullStrength);
  const inwardShiftY = Math.round(background.height * 0.12 * options.centerPullStrength);
  const x = options.placementCorner === "right"
    ? background.width - foreground.width + horizontalOverflow - inwardShiftX
    : -horizontalOverflow + inwardShiftX;
  const y = background.height - foreground.height + bottomOverflow - inwardShiftY;

  const { dropShadow, contactShadow } = createShadows(
    foreground,
    sceneLight,
    Math.max(18, Math.floor(background.width / 55)),
    options.edgeDepthStrength,
    rotation,
    options.perspectiveStrength,
  );

  const result = createCanvas(background.width, background.height);
  const ctx = result.getContext("2d");
  ctx.drawImage(background, 0, 0);
  ctx.drawImage(dropShadow, x, y);
  ctx.drawImage(contactShadow, x, y);
  ctx.drawImage(foreground, x, y);
  return result;
}

function applyPerspectiveTilt(canvas, placementCorner, perspectiveStrength) {
  const strength = perspectiveStrength / 0.1;
  const width = canvas.width;
  const height = canvas.height;
  const insetX = width * (0.008 + 0.03 * strength);
  const insetY = height * (0.012 + 0.05 * strength);
  const warped = createCanvas(width + insetX * 2, height + insetY * 2);
  const ctx = warped.getContext("2d");

  const slices = Math.max(24, Math.floor(width / 8));
  for (let i = 0; i < slices; i += 1) {
    const t0 = i / slices;
    const t1 = (i + 1) / slices;
    const sx = t0 * width;
    const sWidth = Math.max(1, (t1 - t0) * width);

    const topLeft = interpolatePoint(
      placementCorner === "right" ? [insetX, 0] : [0, insetY],
      placementCorner === "right" ? [width - insetX * 0.45, insetY] : [width - insetX, 0],
      t0,
    );
    const topRight = interpolatePoint(
      placementCorner === "right" ? [insetX, 0] : [0, insetY],
      placementCorner === "right" ? [width - insetX * 0.45, insetY] : [width - insetX, 0],
      t1,
    );
    const bottomLeft = interpolatePoint(
      placementCorner === "right" ? [0, height] : [insetX * 0.45, height - insetY * 0.3],
      placementCorner === "right" ? [width, height - insetY * 0.3] : [width, height],
      t0,
    );
    const bottomRight = interpolatePoint(
      placementCorner === "right" ? [0, height] : [insetX * 0.45, height - insetY * 0.3],
      placementCorner === "right" ? [width, height - insetY * 0.3] : [width, height],
      t1,
    );

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(topLeft[0], topLeft[1]);
    ctx.lineTo(topRight[0], topRight[1]);
    ctx.lineTo(bottomRight[0], bottomRight[1]);
    ctx.lineTo(bottomLeft[0], bottomLeft[1]);
    ctx.closePath();
    ctx.clip();

    const dx = topLeft[0];
    const dy = topLeft[1];
    const ux = (topRight[0] - topLeft[0]) / sWidth;
    const uy = (topRight[1] - topLeft[1]) / sWidth;
    const vx = (bottomLeft[0] - topLeft[0]) / height;
    const vy = (bottomLeft[1] - topLeft[1]) / height;
    ctx.setTransform(ux, uy, vx, vy, dx - sx * ux, dy - sx * uy);
    ctx.drawImage(canvas, 0, 0);
    ctx.restore();
  }

  return warped;
}

function interpolatePoint(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function rotateCanvas(canvas, degrees) {
  const radians = (degrees * Math.PI) / 180;
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));
  const width = canvas.width;
  const height = canvas.height;
  const rotated = createCanvas(width * cos + height * sin, width * sin + height * cos);
  const ctx = rotated.getContext("2d");
  ctx.translate(rotated.width / 2, rotated.height / 2);
  ctx.rotate(radians);
  ctx.drawImage(canvas, -width / 2, -height / 2);
  return rotated;
}

function createShadows(canvas, sceneLight, blurRadius, edgeDepthStrength, rotationDegrees, perspectiveStrength) {
  const alpha = alphaMaskFromCanvas(canvas);
  const [lightX, lightY] = sceneLight.lightDirection;
  const shadowDx = Math.round(-lightX * Math.max(8, canvas.width * 0.035));
  const shadowDy = Math.round(-lightY * Math.max(10, canvas.height * 0.045));
  const rotationFactor = Math.min(Math.abs(rotationDegrees) / 8, 1);
  const perspectiveFactor = Math.min(perspectiveStrength / 0.1, 1);
  const geometryFactor = 0.35 + 0.35 * rotationFactor + 0.3 * perspectiveFactor;

  let contactMask = blurMask(alpha, canvas.width, canvas.height, Math.max(1, 1 + edgeDepthStrength * 2 + geometryFactor * 1.5));
  contactMask = brightenMask(contactMask, 0.12 + edgeDepthStrength * 0.48);
  contactMask = offsetMaskWithoutWrap(
    contactMask,
    canvas.width,
    canvas.height,
    Math.round(shadowDx * (0.18 + geometryFactor * 0.12)),
    Math.round(Math.max(1, shadowDy * (0.18 + geometryFactor * 0.12)) + edgeDepthStrength * 2.2),
  );

  let dropMask = blurMask(alpha, canvas.width, canvas.height, blurRadius);
  dropMask = brightenMask(dropMask, 0.16 + edgeDepthStrength * 0.16);
  dropMask = offsetMaskWithoutWrap(dropMask, canvas.width, canvas.height, shadowDx, shadowDy);

  const dropShadow = createCanvas(canvas.width, canvas.height);
  const contactShadow = createCanvas(canvas.width, canvas.height);
  drawColorMask(dropShadow, [28, 22, 18], dropMask);
  drawColorMask(contactShadow, [24, 20, 18], contactMask);
  return { dropShadow, contactShadow };
}

function offsetMaskWithoutWrap(mask, width, height, offsetX, offsetY) {
  const result = new Uint8ClampedArray(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const srcX = x - offsetX;
      const srcY = y - offsetY;
      if (srcX >= 0 && srcX < width && srcY >= 0 && srcY < height) {
        result[y * width + x] = mask[srcY * width + srcX];
      }
    }
  }
  return result;
}
