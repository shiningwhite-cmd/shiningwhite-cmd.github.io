import { processPhotoModifier } from "./photo-processor.js";

const form = document.getElementById("process-form");
const statusNode = document.getElementById("status");
const resultImage = document.getElementById("result-image");
const downloadLink = document.getElementById("download-link");
const submitButton = document.getElementById("submit-button");
const previewNote = document.getElementById("preview-note");
const sizeRange = document.getElementById("size-range");
const sizeRangeLabel = document.getElementById("size-range-label");
const centerPullRange = document.getElementById("center-pull-range");
const centerPullRangeLabel = document.getElementById("center-pull-range-label");
const perspectiveRange = document.getElementById("perspective-range");
const perspectiveRangeLabel = document.getElementById("perspective-range-label");
const lightMatchRange = document.getElementById("light-match-range");
const lightMatchRangeLabel = document.getElementById("light-match-range-label");
const ambientTintRange = document.getElementById("ambient-tint-range");
const ambientTintRangeLabel = document.getElementById("ambient-tint-range-label");
const reflectionRange = document.getElementById("reflection-range");
const reflectionRangeLabel = document.getElementById("reflection-range-label");
const filmRange = document.getElementById("film-range");
const filmRangeLabel = document.getElementById("film-range-label");
const edgeDepthRange = document.getElementById("edge-depth-range");
const edgeDepthRangeLabel = document.getElementById("edge-depth-range-label");

let currentResultUrl = "";

downloadLink.hidden = true;

function updateSizeLabel() {
  const percentage = Math.round(Number(sizeRange.value) * 100);
  sizeRangeLabel.textContent = `当前高度约为背景高度的 ${percentage}%`;
}

updateSizeLabel();
sizeRange.addEventListener("input", updateSizeLabel);
bindPercentLabel(centerPullRange, centerPullRangeLabel);

function bindPercentLabel(rangeNode, labelNode) {
  function updateLabel() {
    const percentage = Math.round(Number(rangeNode.value) * 100);
    labelNode.textContent = `当前强度 ${percentage}%`;
  }

  updateLabel();
  rangeNode.addEventListener("input", updateLabel);
}

function updatePerspectiveLabel() {
  const percentage = (Number(perspectiveRange.value) * 100).toFixed(1);
  perspectiveRangeLabel.textContent = `当前强度 ${percentage}%`;
}

updatePerspectiveLabel();
perspectiveRange.addEventListener("input", updatePerspectiveLabel);
bindPercentLabel(lightMatchRange, lightMatchRangeLabel);
bindPercentLabel(ambientTintRange, ambientTintRangeLabel);
bindPercentLabel(reflectionRange, reflectionRangeLabel);
bindPercentLabel(filmRange, filmRangeLabel);
bindPercentLabel(edgeDepthRange, edgeDepthRangeLabel);

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const landscapeFile = form.elements.landscape.files[0];
  const polaroidFile = form.elements.polaroid.files[0];
  if (!landscapeFile || !polaroidFile) {
    statusNode.textContent = "请先选择两张图片";
    previewNote.textContent = "需要同时选择风景图和拍立得扫描图。";
    return;
  }

  statusNode.textContent = "正在处理图片...";
  submitButton.disabled = true;
  previewNote.textContent = "正在浏览器中本地处理，不会上传或保存你的图片。";
  downloadLink.hidden = true;

  try {
    const result = await processPhotoModifier({
      landscapeFile,
      polaroidFile,
      options: {
        focusTarget: form.elements.focus_target.value,
        placementCorner: form.elements.placement_corner.value,
        polaroidHeightRatio: Number(form.elements.polaroid_height_ratio.value),
        centerPullStrength: Number(form.elements.center_pull_strength.value),
        perspectiveStrength: Number(form.elements.perspective_strength.value),
        lightMatchStrength: Number(form.elements.light_match_strength.value),
        ambientTintStrength: Number(form.elements.ambient_tint_strength.value),
        reflectionStrength: Number(form.elements.reflection_strength.value),
        filmStrength: Number(form.elements.film_strength.value),
        edgeDepthStrength: Number(form.elements.edge_depth_strength.value),
      },
    });
    if (currentResultUrl) {
      URL.revokeObjectURL(currentResultUrl);
    }
    currentResultUrl = result.objectUrl;

    resultImage.src = result.objectUrl;
    downloadLink.href = result.objectUrl;
    downloadLink.hidden = false;
    previewNote.textContent = "处理完成。结果来自浏览器本地实时生成，不保留数据或图片快照。";
    statusNode.textContent = "处理完成";
  } catch (error) {
    previewNote.textContent = "处理失败，请检查图片格式或重试。";
    statusNode.textContent = error instanceof Error ? error.message : "处理失败";
  } finally {
    submitButton.disabled = false;
  }
});

window.addEventListener("beforeunload", () => {
  if (currentResultUrl) {
    URL.revokeObjectURL(currentResultUrl);
  }
});
