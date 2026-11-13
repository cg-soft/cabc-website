// PDF bytes remain in memory. No native PDF plugin, iframe, popup, persistent
// browser storage, PDF actions, annotation links or document JavaScript.
let libraryPromise;
async function library() {
  if (!libraryPromise) libraryPromise = (async () => {
    const [pdf, worker] = await Promise.all([
      import("./vendor/pdfjs-6.5.438/pdf.min.mjs"),
      import("./vendor/pdfjs-6.5.438/pdf.worker.min.mjs")
    ]);
    // A deliberate in-process worker also works in opaque-origin previews and
    // avoids blob-worker/CSP exceptions. Pages are rendered one at a time.
    globalThis.pdfjsWorker = worker;
    return pdf;
  })().catch(error => { libraryPromise = null; throw error; });
  return libraryPromise;
}

export function rasterSize(width, height, ratio = 1) {
  if (![width, height, ratio].every(Number.isFinite) || width <= 0 || height <= 0 || ratio <= 0)
    throw new Error("Invalid PDF page dimensions.");
  // Bound backing-store memory, including extreme PDF page aspect ratios.
  const scale = Math.min(ratio, 2, Math.sqrt(8000000 / (width * height)), 8192 / width, 8192 / height);
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)), scale };
}

export function createPdfViewer({ container, title, loadBytes, onClose, onDownload, isCurrent, loadEngine = library }) {
  let disposed = false, loadingTask = null, pdf = null, renderTask = null;
  let pageNumber = 1, renderRevision = 0, resizeFrame = null, lastWidth = 0, initialScrolled = false;
  const alive = () => !disposed && container.isConnected && isCurrent();
  const element = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  const makeButton = (label, action) => {
    const node = element("button", label, "quiet");
    node.type = "button"; node.addEventListener("click", action); return node;
  };
  const reader = element("section", undefined, "pdf-reader");
  reader.setAttribute("aria-label", "PDF reader");
  const top = element("div", undefined, "pdf-reader-heading");
  const back = makeButton("Back to documents", onClose);
  const download = makeButton("Download PDF", async () => {
    if (!alive() || download.disabled) return;
    download.disabled = true;
    try { await onDownload(); } finally { if (alive()) download.disabled = false; }
  });
  top.append(back, download);
  const heading = element("h2", title, "pdf-reader-title");
  heading.tabIndex = -1;
  const toolbar = element("div", undefined, "pdf-reader-toolbar");
  toolbar.setAttribute("aria-label", "PDF page controls");
  const previous = makeButton("Previous", () => { pageNumber--; void render(); });
  const next = makeButton("Next", () => { pageNumber++; void render(); });
  const pageLabel = element("label", "Page", "pdf-page-label");
  const pageInput = element("input");
  pageInput.type = "number"; pageInput.min = "1"; pageInput.value = "1";
  pageInput.inputMode = "numeric"; pageInput.setAttribute("aria-label", "PDF page number");
  pageLabel.append(pageInput);
  const total = element("span", "of …", "pdf-page-total");
  const zoomLabel = element("label", "Zoom", "pdf-zoom-label");
  const zoom = element("select"); zoom.setAttribute("aria-label", "PDF zoom");
  for (const [value, label] of [["fit", "Fit width"], ["1", "100%"], ["1.5", "150%"], ["2", "200%"]]) {
    const option = element("option", label); option.value = value; zoom.append(option);
  }
  zoomLabel.append(zoom);
  toolbar.append(previous, pageLabel, total, next, zoomLabel);
  const status = element("p", "Loading PDF…", "pdf-reader-status small-note");
  status.setAttribute("role", "status");
  const surface = element("div", undefined, "pdf-surface");
  surface.tabIndex = 0; surface.setAttribute("role", "region");
  surface.setAttribute("aria-label", "PDF page; scroll to see enlarged content");
  const sheet = element("div", undefined, "pdf-sheet");
  surface.append(sheet);
  const textDetails = element("details", undefined, "pdf-page-text");
  const textSummary = element("summary", "Read page text");
  const text = element("div");
  textDetails.append(textSummary, text); textDetails.hidden = true;
  reader.append(top, heading, toolbar, status, surface, textDetails);
  container.replaceChildren(reader);
  // The list is no longer an aria-live region while reading a whole PDF.
  container.removeAttribute("aria-live");
  heading.focus({ preventScroll: true });

  function controls(busy) {
    toolbar.setAttribute("aria-busy", String(busy));
    previous.disabled = busy || !pdf || pageNumber <= 1;
    next.disabled = busy || !pdf || pageNumber >= pdf.numPages;
    pageInput.disabled = zoom.disabled = busy || !pdf;
  }
  controls(true);
  function clearCanvas() {
    for (const canvas of sheet.querySelectorAll("canvas")) { canvas.width = 0; canvas.height = 0; }
    sheet.replaceChildren(); text.replaceChildren(); textDetails.hidden = true;
  }
  function fail(error) {
    if (!alive()) return;
    clearCanvas();
    status.setAttribute("role", "alert");
    status.textContent = error?.name === "PasswordException"
      ? "This PDF requires a password and cannot be displayed here. Use Download PDF, or ask an administrator for an unlocked copy."
      : "This PDF could not be displayed. Go back and try again, or use Download PDF to open the original file.";
    controls(false);
  }
  async function render() {
    if (!alive() || !pdf) return;
    const revision = ++renderRevision;
    renderTask?.cancel(); renderTask = null;
    clearCanvas(); controls(true);
    status.setAttribute("role", "status");
    status.textContent = `Loading page ${pageNumber}…`;
    pageInput.value = String(pageNumber);
    total.textContent = `of ${pdf.numPages}`;
    let page;
    try {
      page = await pdf.getPage(pageNumber);
      if (!alive() || revision !== renderRevision) return;
      const base = page.getViewport({ scale: 1 });
      const available = Math.max(1, surface.clientWidth - 32);
      const scale = zoom.value === "fit" ? available / base.width : Number(zoom.value) * 96 / 72;
      const viewport = page.getViewport({ scale });
      const raster = rasterSize(viewport.width, viewport.height, window.devicePixelRatio || 1);
      const canvas = element("canvas");
      canvas.width = raster.width; canvas.height = raster.height;
      canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `${title}, page ${pageNumber} of ${pdf.numPages}. Page text is available below.`);
      sheet.append(canvas);
      const task = renderTask = page.render({ canvasContext: canvas.getContext("2d"), viewport,
        transform: [raster.scale, 0, 0, raster.scale, 0, 0] });
      await task.promise;
      if (!alive() || revision !== renderRevision) return;
      renderTask = null;
      status.textContent = `Page ${pageNumber} of ${pdf.numPages}`;
      controls(false);
      surface.scrollLeft = surface.scrollTop = 0;
      if (!initialScrolled) {
        initialScrolled = true;
        reader.scrollIntoView({ block: "start", behavior: "instant" });
      }
      // Text is a separate, keyboard-accessible disclosure, never interpreted as
      // HTML. Scanned/image-only PDFs may have no selectable text.
      try {
        const content = await page.getTextContent();
        if (!alive() || revision !== renderRevision) return;
        text.textContent = content.items.map(item => (item.str || "") + (item.hasEOL ? "\n" : " ")).join("").trim()
          || "No selectable text on this page.";
        textDetails.hidden = false;
      } catch {
        if (alive() && revision === renderRevision) {
          text.textContent = "Page text is unavailable. Use Download PDF with your preferred PDF reader.";
          textDetails.hidden = false;
        }
      }
    } catch (error) {
      if (alive() && revision === renderRevision && error?.name !== "RenderingCancelledException") fail(error);
    } finally { page?.cleanup(); }
  }
  pageInput.addEventListener("change", () => {
    const requested = Number(pageInput.value);
    if (!pdf || !Number.isInteger(requested) || requested < 1 || requested > pdf.numPages) {
      pageInput.value = String(pageNumber); return;
    }
    pageNumber = requested; void render();
  });
  zoom.addEventListener("change", () => { void render(); });
  const resize = () => {
    if (!alive() || surface.clientWidth === lastWidth) return;
    lastWidth = surface.clientWidth;
    if (zoom.value !== "fit") return;
    if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => { resizeFrame = null; void render(); });
  };
  // ResizeObserver handles changes to the preview's embedded container too.
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
  if (observer) observer.observe(surface);
  else window.addEventListener("resize", resize);

  void (async () => {
    try {
      const [engine, bytes] = await Promise.all([loadEngine(), loadBytes()]);
      if (!alive()) return;
      const assets = new URL("./vendor/pdfjs-6.5.438/", import.meta.url);
      loadingTask = engine.getDocument({ data: new Uint8Array(bytes),
        isEvalSupported: false, useWasm: false, enableXfa: false,
        disableFontFace: true, useSystemFonts: false, useWorkerFetch: false,
        isOffscreenCanvasSupported: false,
        cMapUrl: new URL("cmaps/", assets).href, cMapPacked: true,
        standardFontDataUrl: new URL("standard_fonts/", assets).href,
        wasmUrl: new URL("wasm/", assets).href });
      pdf = await loadingTask.promise;
      if (!alive()) { await loadingTask.destroy(); return; }
      pageInput.max = String(pdf.numPages);
      await render();
    } catch (error) { fail(error); }
  })();
  return {
    destroy() {
      if (disposed) return;
      disposed = true; renderRevision++;
      renderTask?.cancel(); renderTask = null;
      observer?.disconnect(); window.removeEventListener("resize", resize);
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      clearCanvas(); reader.remove();
      if (loadingTask) void loadingTask.destroy().catch(() => {});
      pdf = null;
    }
  };
}
