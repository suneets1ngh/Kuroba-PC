(function () {
  const { SITES, resolveUrl, setCustomProxyTemplate, fetchBinary, isExtensionEnv } = window.KurobaSites;
  const STORAGE_KEY = "kuroba_lite_state_v1";

  const defaultSettings = {
    enabledSites: Object.fromEntries(SITES.map((s) => [s.id, s.defaultEnabled])),
    hideNsfwBoards: true,
    blurNsfwMedia: true,
    theme: "dark",
    bgColor: "",
    bgImage: "",
    bgFit: "cover",
    bgDim: 35,
    proxyMode: "none",
    proxyUrl: "",
    viewMode: "grid",
    sortBy: "bump",
    autoRefreshSec: 0,
    activeSiteId: "4chan",
    activeBoard: "g",
    bookmarks: [],
  };

  let state = loadState();
  let boardsCache = {};       // siteId -> [{ code, title, nsfw }]
  let currentThreads = [];    // catalog threads
  let currentPosts = [];      // thread posts
  let currentThreadNo = null; // null = catalog, number = thread
  let currentBoardNsfw = false;
  let lightboxItems = [];
  let lightboxIndex = 0;
  let autoRefreshTimer = null;
  let toastTimer = null;

  const $ = (id) => document.getElementById(id);

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(defaultSettings);
      const parsed = JSON.parse(raw);
      return {
        ...structuredClone(defaultSettings),
        ...parsed,
        enabledSites: { ...defaultSettings.enabledSites, ...(parsed.enabledSites || {}) },
        bookmarks: Array.isArray(parsed.bookmarks) ? parsed.bookmarks : [],
      };
    } catch {
      return structuredClone(defaultSettings);
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function stripHtml(html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = html || "";
    return tmp.textContent || "";
  }

  function sanitizeCommentHtml(html) {
    if (!html) return "";
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const allowedTags = new Set(["BR", "SPAN", "A", "B", "I", "U", "S", "STRONG", "EM", "PRE", "CODE", "WBR"]);

    function cleanNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
      if (node.nodeType !== Node.ELEMENT_NODE) return document.createDocumentFragment();

      if (!allowedTags.has(node.tagName)) {
        const frag = document.createDocumentFragment();
        node.childNodes.forEach((c) => frag.appendChild(cleanNode(c)));
        return frag;
      }

      const el = document.createElement(node.tagName.toLowerCase());
      if (node.className) el.className = node.className;

      if (node.tagName === "A") {
        const href = node.getAttribute("href") || "";
        const text = node.textContent || "";
        const match = text.match(/^>>(\d+)/) || href.match(/#p?(\d+)$/);
        if (match) {
          el.className = "quotelink";
          el.dataset.quoteNo = match[1];
          el.href = `#p${match[1]}`;
        } else if (href.startsWith("http://") || href.startsWith("https://")) {
          el.href = href;
          el.target = "_blank";
          el.rel = "noopener noreferrer";
        }
      }

      node.childNodes.forEach((c) => el.appendChild(cleanNode(c)));
      return el;
    }

    const out = document.createElement("div");
    doc.body.childNodes.forEach((c) => out.appendChild(cleanNode(c)));
    return out.innerHTML;
  }

  function formatBytes(bytes) {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function formatTime(unixSec) {
    if (!unixSec) return "";
    return new Date(unixSec * 1000).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function showToast(msg, duration = 3000) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    if (duration > 0) {
      toastTimer = setTimeout(() => el.classList.add("hidden"), duration);
    }
  }

  function getActiveSite() {
    return SITES.find((s) => s.id === state.activeSiteId) || SITES[0];
  }

  function applyTheme() {
    document.documentElement.setAttribute("data-theme", state.theme);
    $("themeSelect").value = state.theme;
    applyBackground();
  }

  function applyBackground() {
    const root = document.documentElement;
    const layer = $("appBgLayer");
    const dim = $("appBgDim");

    if (state.bgColor) {
      root.style.setProperty("--custom-bg", state.bgColor);
      $("bgColorPicker").value = /^#[0-9a-f]{6}$/i.test(state.bgColor) ? state.bgColor : "#0d1117";
      $("bgColorText").value = state.bgColor;
    } else {
      root.style.removeProperty("--custom-bg");
      $("bgColorText").value = "";
    }

    const img = (state.bgImage || "").trim();
    if (img) {
      layer.style.backgroundImage = `url("${img.replace(/"/g, '\\"')}")`;
      document.body.classList.add("has-bg-image");
    } else {
      layer.style.backgroundImage = "none";
      document.body.classList.remove("has-bg-image");
    }

    if (state.bgFit === "repeat") {
      layer.style.backgroundSize = "auto";
      layer.style.backgroundRepeat = "repeat";
    } else if (state.bgFit === "center") {
      layer.style.backgroundSize = "auto";
      layer.style.backgroundRepeat = "no-repeat";
    } else {
      layer.style.backgroundSize = state.bgFit || "cover";
      layer.style.backgroundRepeat = "no-repeat";
    }

    const dimPct = Math.min(90, Math.max(0, Number(state.bgDim) || 0));
    dim.style.background = img ? `rgba(0, 0, 0, ${dimPct / 100})` : "transparent";

    $("bgImageUrlInput").value = img.startsWith("data:") ? "(Uploaded local image)" : img;
    $("bgFitSelect").value = state.bgFit || "cover";
    $("bgDimRange").value = String(dimPct);
    $("bgDimValue").textContent = `${dimPct}%`;
  }

  function updateProxyUi() {
    $("proxyModeSelect").value = state.proxyMode || "none";
    $("proxyUrlInput").value = state.proxyUrl || "";
    const showUrl = state.proxyMode !== "none";
    $("proxyUrlRow").classList.toggle("hidden", !showUrl);
    if (state.proxyMode === "custom") {
      $("proxyUrlInput").placeholder = "https://your-proxy.example.com/?url={url}";
    } else {
      $("proxyUrlInput").placeholder = "http://127.0.0.1:8080 (or http://user:pass@host:port)";
    }
  }

  async function applyProxySettings(testConnection = false) {
    setCustomProxyTemplate(state.proxyMode === "custom" ? state.proxyUrl : "");
    updateProxyUi();

    const statusEl = $("proxyStatusText");
    if (!isExtensionEnv()) {
      try {
        const upstreamProxy = state.proxyMode === "upstream" ? state.proxyUrl : "";
        const res = await fetch("/api/proxy-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ upstreamProxy }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        statusEl.textContent = upstreamProxy
          ? `Server upstream proxy active: ${upstreamProxy}`
          : state.proxyMode === "custom"
            ? `Custom CORS proxy active`
            : `Using direct local proxy`;
      } catch (err) {
        statusEl.textContent = `Proxy config error: ${err.message}`;
        return;
      }
    } else if (state.proxyMode === "upstream") {
      statusEl.textContent = "Note: Upstream proxy requires local server mode (server.py); Chrome Extension uses browser proxy settings.";
    } else {
      statusEl.textContent = state.proxyMode === "custom" ? "Custom CORS proxy active" : "Direct extension fetch active";
    }

    if (testConnection) {
      statusEl.textContent = "Testing connection...";
      try {
        await window.KurobaSites.fetchJson("https://a.4cdn.org/boards.json");
        statusEl.textContent = "Connected! Proxy test succeeded.";
        showToast("Proxy connected successfully");
      } catch (err) {
        statusEl.textContent = `Test failed: ${err.message}`;
        showToast(`Proxy test failed: ${err.message}`);
      }
    }
  }

  function updateNsfwPill() {
    const btn = $("nsfwToggleBtn");
    const label = $("nsfwToggleLabel");
    if (state.hideNsfwBoards) {
      btn.classList.remove("nsfw-on");
      label.textContent = "SFW";
      btn.title = "NSFW Filter ON (Hiding NSFW boards & blurring NSFW media). Click to allow NSFW.";
    } else {
      btn.classList.add("nsfw-on");
      label.textContent = "NSFW";
      btn.title = "NSFW Filter OFF (Showing all boards). Click to enable SFW mode.";
    }
    $("hideNsfwBoardsChk").checked = state.hideNsfwBoards;
    $("blurNsfwMediaChk").checked = state.blurNsfwMedia;
  }

  function renderSiteSelector() {
    const select = $("siteSelect");
    const enabled = SITES.filter((s) => state.enabledSites[s.id]);
    const list = enabled.length > 0 ? enabled : [SITES[0]];
    if (!list.some((s) => s.id === state.activeSiteId)) {
      state.activeSiteId = list[0].id;
      saveState();
    }
    select.innerHTML = list
      .map((s) => `<option value="${s.id}" ${s.id === state.activeSiteId ? "selected" : ""}>${escapeHtml(s.name)}</option>`)
      .join("");
  }

  function renderSiteToggles() {
    const container = $("siteTogglesList");
    container.innerHTML = SITES.map(
      (s) => `
      <label class="toggle-chip">
        <span>${escapeHtml(s.name)}</span>
        <input type="checkbox" data-site-toggle="${s.id}" ${state.enabledSites[s.id] ? "checked" : ""}>
      </label>`
    ).join("");
  }

  async function loadBoards(siteId, force = false) {
    if (!force && boardsCache[siteId]) return boardsCache[siteId];
    const site = SITES.find((s) => s.id === siteId);
    if (!site) return [];
    const boards = await site.fetchBoards();
    boardsCache[siteId] = boards;
    return boards;
  }

  function getFilteredBoards(siteId) {
    const all = boardsCache[siteId] || [];
    const query = $("boardSearchInput").value.trim().toLowerCase();
    return all.filter((b) => {
      if (state.hideNsfwBoards && b.nsfw) return false;
      if (!query) return true;
      return b.code.toLowerCase().includes(query) || b.title.toLowerCase().includes(query);
    });
  }

  function renderBoardsDropdown() {
    const boards = getFilteredBoards(state.activeSiteId);
    const listEl = $("boardList");
    if (boards.length === 0) {
      listEl.innerHTML = `<div class="empty-state" style="padding:16px">No matching boards</div>`;
      return;
    }
    listEl.innerHTML = boards
      .map(
        (b) => `
      <button type="button" class="board-item ${b.code === state.activeBoard ? "active" : ""}" data-board="${escapeHtml(b.code)}">
        <span class="board-item-code">/${escapeHtml(b.code)}/</span>
        <span class="board-item-title">${escapeHtml(b.title)}</span>
        ${b.nsfw ? `<span class="nsfw-tag">NSFW</span>` : ""}
      </button>`
      )
      .join("");
  }

  function updateBoardButtonLabel() {
    const boards = boardsCache[state.activeSiteId] || [];
    const found = boards.find((b) => b.code === state.activeBoard);
    currentBoardNsfw = found ? found.nsfw : false;
    $("boardBtnLabel").textContent = found ? `/${found.code}/ — ${found.title}` : `/${state.activeBoard}/`;
  }

  async function selectSite(siteId) {
    state.activeSiteId = siteId;
    currentThreadNo = null;
    $("catalogStatus").textContent = "Loading boards...";
    try {
      const boards = await loadBoards(siteId);
      const visible = boards.filter((b) => !state.hideNsfwBoards || !b.nsfw);
      const pool = visible.length > 0 ? visible : boards;
      if (!pool.some((b) => b.code === state.activeBoard) && pool.length > 0) {
        state.activeBoard = pool[0].code;
      }
      saveState();
      updateBoardButtonLabel();
      renderBoardsDropdown();
      await loadCatalog();
    } catch (err) {
      $("catalogStatus").textContent = "Error loading boards";
      showEmpty(`Failed to load ${getActiveSite().name}: ${err.message}`);
    }
  }

  async function selectBoard(boardCode) {
    state.activeBoard = boardCode;
    currentThreadNo = null;
    saveState();
    updateBoardButtonLabel();
    renderBoardsDropdown();
    closeBoardMenu();
    await loadCatalog();
  }

  function showEmpty(message) {
    $("emptyState").textContent = message;
    $("emptyState").classList.remove("hidden");
  }

  function hideEmpty() {
    $("emptyState").classList.add("hidden");
  }

  async function loadCatalog() {
    currentThreadNo = null;
    stopAutoRefresh();
    $("catalogControls").classList.remove("hidden");
    $("threadControls").classList.add("hidden");
    $("catalogView").classList.remove("hidden");
    $("threadView").classList.add("hidden");
    hideEmpty();

    const site = getActiveSite();
    $("catalogStatus").textContent = `Loading ${site.name} /${state.activeBoard}/...`;
    $("catalogView").innerHTML = "";

    try {
      currentThreads = await site.fetchCatalog(state.activeBoard);
      renderCatalog();
    } catch (err) {
      $("catalogStatus").textContent = "Load failed";
      showEmpty(`Could not load /${state.activeBoard}/ on ${site.name}: ${err.message}`);
    }
  }

  function renderCatalog() {
    const view = $("catalogView");
    view.className = state.viewMode === "list" ? "catalog-list" : "catalog-grid";
    $("viewModeBtn").textContent = state.viewMode === "list" ? "List" : "Grid";

    const query = $("searchInput").value.trim().toLowerCase();
    let list = currentThreads.filter((t) => {
      if (!query) return true;
      return (
        stripHtml(t.sub).toLowerCase().includes(query) ||
        stripHtml(t.com).toLowerCase().includes(query) ||
        String(t.no).includes(query)
      );
    });

    if (state.sortBy === "replies") list = [...list].sort((a, b) => b.replies - a.replies);
    else if (state.sortBy === "images") list = [...list].sort((a, b) => b.images - a.images);
    else if (state.sortBy === "newest") list = [...list].sort((a, b) => b.time - a.time);

    $("catalogStatus").textContent = `${list.length} threads in /${state.activeBoard}/`;

    if (list.length === 0) {
      view.innerHTML = "";
      showEmpty("No threads match your filter.");
      return;
    }
    hideEmpty();

    const shouldBlur = currentBoardNsfw && state.blurNsfwMedia;
    view.innerHTML = list
      .map((t) => {
        const subText = stripHtml(t.sub);
        const comText = stripHtml(t.com);
        const thumbHtml = t.media
          ? `<div class="thread-thumb-wrap">
               <img class="thread-thumb ${shouldBlur ? "nsfw-blur" : ""}" loading="lazy" src="${resolveUrl(t.media.thumbUrl)}" alt="">
             </div>`
          : "";
        return `
        <article class="thread-card" data-thread-no="${t.no}">
          ${thumbHtml}
          <div class="thread-card-body">
            <div class="thread-card-meta">
              <span>${t.sticky ? "📌 " : ""}${t.closed ? "🔒 " : ""}R: ${t.replies} / I: ${t.images}</span>
              <span>#${t.no}</span>
            </div>
            ${subText ? `<div class="thread-card-sub">${escapeHtml(subText)}</div>` : ""}
            <div class="thread-card-com">${escapeHtml(comText)}</div>
          </div>
        </article>`;
      })
      .join("");
  }

  async function openThread(threadNo) {
    currentThreadNo = Number(threadNo);
    $("catalogControls").classList.add("hidden");
    $("threadControls").classList.remove("hidden");
    $("catalogView").classList.add("hidden");
    $("threadView").classList.remove("hidden");
    hideEmpty();

    await refreshThread();
    startAutoRefresh();
  }

  async function refreshThread() {
    if (!currentThreadNo) return;
    const site = getActiveSite();
    $("threadTitle").textContent = `/${state.activeBoard}/ #${currentThreadNo}`;
    $("threadStats").textContent = "Loading...";

    try {
      currentPosts = await site.fetchThread(state.activeBoard, currentThreadNo);
      renderThread();
    } catch (err) {
      $("threadStats").textContent = "Error";
      showEmpty(`Could not load thread #${currentThreadNo}: ${err.message}`);
    }
  }

  function renderThread() {
    const query = $("searchInput").value.trim().toLowerCase();
    const backlinks = new Map();
    const postMap = new Map();

    for (const p of currentPosts) {
      postMap.set(String(p.no), p);
      const matches = (p.com || "").matchAll(/&gt;&gt;(\d+)|>>(\d+)/g);
      for (const m of matches) {
        const target = m[1] || m[2];
        if (!backlinks.has(target)) backlinks.set(target, new Set());
        backlinks.get(target).add(p.no);
      }
    }

    const op = currentPosts[0];
    const opSub = op ? stripHtml(op.sub) : "";
    $("threadTitle").textContent = opSub || `/${state.activeBoard}/ #${currentThreadNo}`;
    const totalMedia = currentPosts.reduce((acc, p) => acc + p.media.length, 0);
    $("threadStats").textContent = `${currentPosts.length} posts · ${totalMedia} files`;
    updateBookmarkButton();

    lightboxItems = [];
    const shouldBlur = currentBoardNsfw && state.blurNsfwMedia;

    const filtered = currentPosts.filter((p) => {
      if (!query) return true;
      return (
        stripHtml(p.com).toLowerCase().includes(query) ||
        stripHtml(p.sub).toLowerCase().includes(query) ||
        String(p.no).includes(query)
      );
    });

    const view = $("threadView");
    view.innerHTML = filtered
      .map((p, idx) => {
        const isOp = p.resto === 0 || idx === 0;
        const mediaHtml = p.media
          .map((m) => {
            const lbIdx = lightboxItems.push(m) - 1;
            const info = [m.w && m.h ? `${m.w}×${m.h}` : "", formatBytes(m.fsize)].filter(Boolean).join(" · ");
            return `
            <div class="post-media-item">
              <img class="post-media-thumb ${shouldBlur ? "nsfw-blur" : ""}" loading="lazy"
                   src="${resolveUrl(m.thumbUrl)}" data-lightbox-idx="${lbIdx}" alt="${escapeHtml(m.filename)}">
              <div class="post-media-meta">
                <span class="post-media-name" title="${escapeHtml(m.filename)} ${info}">${escapeHtml(m.filename)}</span>
                <button type="button" class="media-dl-btn" data-dl-url="${escapeHtml(m.url)}" data-dl-name="${escapeHtml(m.filename)}" title="Download file">⬇</button>
              </div>
            </div>`;
          })
          .join("");

        const replies = backlinks.get(String(p.no));
        const backlinksHtml =
          replies && replies.size > 0
            ? `<div class="post-backlinks">
                 <span>Replies:</span>
                 ${Array.from(replies)
                   .map((r) => `<a class="backlink quotelink" data-quote-no="${r}" href="#p${r}">&gt;&gt;${r}</a>`)
                   .join("")}
               </div>`
            : "";

        return `
        <article class="post-card ${isOp ? "op" : ""}" id="p${p.no}" data-post-no="${p.no}">
          <div class="post-header">
            ${p.sub ? `<span class="post-sub">${escapeHtml(stripHtml(p.sub))}</span>` : ""}
            <span class="post-name">${escapeHtml(p.name)}</span>
            ${p.trip ? `<span class="post-trip">${escapeHtml(p.trip)}</span>` : ""}
            ${p.id ? `<span class="post-trip">ID:${escapeHtml(p.id)}</span>` : ""}
            <span class="post-no">No.${p.no}</span>
            <span class="post-time">${formatTime(p.time)}</span>
          </div>
          <div class="post-body-wrap">
            ${mediaHtml ? `<div class="post-media-list">${mediaHtml}</div>` : ""}
            <div class="post-comment">${sanitizeCommentHtml(p.com)}</div>
          </div>
          ${backlinksHtml}
        </article>`;
      })
      .join("");

    view._postMap = postMap;
  }

  async function downloadSingleFile(url, filename) {
    try {
      if (window.chrome && chrome.downloads && typeof chrome.downloads.download === "function") {
        chrome.downloads.download({ url, filename });
        showToast(`Downloading ${filename}...`);
        return;
      }
      showToast(`Fetching ${filename}...`, 0);
      const buf = await fetchBinary(url);
      const blob = new Blob([buf]);
      triggerBlobDownload(blob, filename);
      showToast(`Saved ${filename}`);
    } catch (err) {
      showToast(`Download failed: ${err.message}`);
    }
  }

  function triggerBlobDownload(blob, filename) {
    const a = document.createElement("a");
    const objUrl = URL.createObjectURL(blob);
    a.href = objUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
  }

  async function downloadAllThreadMediaZip() {
    const mediaList = [];
    for (const p of currentPosts) {
      for (const m of p.media) mediaList.push(m);
    }
    if (mediaList.length === 0) {
      showToast("No media files in this thread.");
      return;
    }

    const btn = $("downloadThreadZipBtn");
    btn.disabled = true;
    const usedNames = new Set();
    const entries = [];
    let completed = 0;
    let failed = 0;

    const queue = [...mediaList];
    const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        try {
          const data = await fetchBinary(item.url);
          let name = item.filename.replace(/[\\/:*?"<>|]/g, "_");
          let counter = 1;
          const dot = name.lastIndexOf(".");
          const base = dot > 0 ? name.slice(0, dot) : name;
          const ext = dot > 0 ? name.slice(dot) : "";
          while (usedNames.has(name)) {
            name = `${base}_${counter++}${ext}`;
          }
          usedNames.add(name);
          entries.push({ name, data });
        } catch {
          failed++;
        } finally {
          completed++;
          showToast(`Downloading media ${completed}/${mediaList.length}...`, 0);
        }
      }
    });

    await Promise.all(workers);
    btn.disabled = false;

    if (entries.length === 0) {
      showToast("Failed to download thread media.");
      return;
    }

    showToast("Packaging ZIP...", 0);
    const zipBlob = window.KurobaZip.buildZip(entries);
    const zipName = `${state.activeSiteId}_${state.activeBoard}_${currentThreadNo}.zip`;
    triggerBlobDownload(zipBlob, zipName);
    showToast(`Saved ${zipName} (${entries.length} files${failed ? `, ${failed} failed` : ""})`);
  }

  // Lightbox
  function openLightbox(idx) {
    if (!lightboxItems.length) return;
    lightboxIndex = (idx + lightboxItems.length) % lightboxItems.length;
    const item = lightboxItems[lightboxIndex];
    const isVideo = item.ext === ".webm" || item.ext === ".mp4";
    const resolved = resolveUrl(item.url);

    $("lightboxInfo").textContent = `${item.filename} (${lightboxIndex + 1}/${lightboxItems.length})${item.w ? ` · ${item.w}×${item.h}` : ""} ${formatBytes(item.fsize)}`;
    $("lightboxStage").innerHTML = isVideo
      ? `<video src="${resolved}" controls autoplay loop></video>`
      : `<img src="${resolved}" alt="${escapeHtml(item.filename)}">`;

    $("lightbox").classList.remove("hidden");
  }

  function closeLightbox() {
    $("lightbox").classList.add("hidden");
    $("lightboxStage").innerHTML = "";
  }

  // Bookmarks
  function isBookmarked(siteId, board, no) {
    return state.bookmarks.some((b) => b.siteId === siteId && b.board === board && Number(b.no) === Number(no));
  }

  function updateBookmarkButton() {
    const active = currentThreadNo && isBookmarked(state.activeSiteId, state.activeBoard, currentThreadNo);
    $("bookmarkThreadBtn").textContent = active ? "★ Bookmarked" : "☆ Bookmark";
    const count = state.bookmarks.length;
    $("bookmarksCount").textContent = count;
    $("bookmarksCount").classList.toggle("hidden", count === 0);
  }

  function toggleCurrentBookmark() {
    if (!currentThreadNo) return;
    const idx = state.bookmarks.findIndex(
      (b) => b.siteId === state.activeSiteId && b.board === state.activeBoard && Number(b.no) === Number(currentThreadNo)
    );
    if (idx >= 0) {
      state.bookmarks.splice(idx, 1);
    } else {
      const op = currentPosts[0];
      const title = (op && (stripHtml(op.sub) || stripHtml(op.com).slice(0, 60))) || `Thread #${currentThreadNo}`;
      state.bookmarks.unshift({
        siteId: state.activeSiteId,
        board: state.activeBoard,
        no: currentThreadNo,
        title,
      });
    }
    saveState();
    updateBookmarkButton();
  }

  function renderBookmarksModal() {
    const list = $("bookmarksList");
    if (state.bookmarks.length === 0) {
      list.innerHTML = `<div class="empty-state" style="padding:20px">No saved threads yet.</div>`;
      return;
    }
    list.innerHTML = state.bookmarks
      .map(
        (b, i) => `
      <div class="bookmark-row">
        <button type="button" class="bookmark-link" data-bm-idx="${i}">
          <strong>${escapeHtml(b.siteId)} /${escapeHtml(b.board)}/</strong> — ${escapeHtml(b.title)}
        </button>
        <button type="button" class="icon-btn" data-bm-del="${i}" title="Remove">✕</button>
      </div>`
      )
      .join("");
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    if (state.autoRefreshSec > 0 && currentThreadNo) {
      autoRefreshTimer = setInterval(refreshThread, state.autoRefreshSec * 1000);
    }
  }

  function stopAutoRefresh() {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
  }

  function closeBoardMenu() {
    $("boardDropdownMenu").classList.add("hidden");
    $("boardDropdownBtn").setAttribute("aria-expanded", "false");
  }

  function bindEvents() {
    $("siteSelect").addEventListener("change", (e) => selectSite(e.target.value));

    $("boardDropdownBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      const menu = $("boardDropdownMenu");
      const open = menu.classList.toggle("hidden");
      $("boardDropdownBtn").setAttribute("aria-expanded", String(!open));
      if (!open) {
        $("boardSearchInput").value = "";
        renderBoardsDropdown();
        $("boardSearchInput").focus();
      }
    });

    $("boardSearchInput").addEventListener("input", renderBoardsDropdown);
    $("boardList").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-board]");
      if (btn) selectBoard(btn.dataset.board);
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest("#boardDropdown")) closeBoardMenu();
    });

    $("searchInput").addEventListener("input", () => {
      if (currentThreadNo) renderThread();
      else renderCatalog();
    });

    $("sortSelect").addEventListener("change", (e) => {
      state.sortBy = e.target.value;
      saveState();
      renderCatalog();
    });

    $("viewModeBtn").addEventListener("click", () => {
      state.viewMode = state.viewMode === "grid" ? "list" : "grid";
      saveState();
      renderCatalog();
    });

    $("refreshCatalogBtn").addEventListener("click", loadCatalog);
    $("backToCatalogBtn").addEventListener("click", loadCatalog);
    $("refreshThreadBtn").addEventListener("click", refreshThread);
    $("bookmarkThreadBtn").addEventListener("click", toggleCurrentBookmark);
    $("downloadThreadZipBtn").addEventListener("click", downloadAllThreadMediaZip);

    // NSFW Quick Toggle
    $("nsfwToggleBtn").addEventListener("click", () => {
      state.hideNsfwBoards = !state.hideNsfwBoards;
      saveState();
      updateNsfwPill();
      renderBoardsDropdown();
      if (currentThreadNo) renderThread();
      else renderCatalog();
      showToast(state.hideNsfwBoards ? "SFW Mode enabled (NSFW boards hidden)" : "NSFW boards visible");
    });

    // Catalog click -> open thread
    $("catalogView").addEventListener("click", (e) => {
      const card = e.target.closest("[data-thread-no]");
      if (card) openThread(card.dataset.threadNo);
    });

    // Thread clicks: lightbox, download, quotelinks
    $("threadView").addEventListener("click", (e) => {
      const dlBtn = e.target.closest("[data-dl-url]");
      if (dlBtn) {
        e.stopPropagation();
        downloadSingleFile(dlBtn.dataset.dlUrl, dlBtn.dataset.dlName);
        return;
      }

      const thumb = e.target.closest("[data-lightbox-idx]");
      if (thumb) {
        openLightbox(Number(thumb.dataset.lightboxIdx));
        return;
      }

      const qlink = e.target.closest(".quotelink");
      if (qlink && qlink.dataset.quoteNo) {
        e.preventDefault();
        const target = document.getElementById(`p${qlink.dataset.quoteNo}`);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
          target.classList.add("highlight");
          setTimeout(() => target.classList.remove("highlight"), 1800);
        }
      }
    });

    // Quote hover preview
    $("threadView").addEventListener("mouseover", (e) => {
      const qlink = e.target.closest(".quotelink");
      if (!qlink || !qlink.dataset.quoteNo) return;
      const postMap = $("threadView")._postMap;
      const post = postMap && postMap.get(qlink.dataset.quoteNo);
      if (!post) return;

      const tip = $("quoteTooltip");
      tip.innerHTML = `
        <div class="post-header">
          <span class="post-name">${escapeHtml(post.name)}</span>
          <span class="post-no">No.${post.no}</span>
          <span class="post-time">${formatTime(post.time)}</span>
        </div>
        <div class="post-comment">${sanitizeCommentHtml(post.com)}</div>`;
      tip.classList.remove("hidden");

      const rect = qlink.getBoundingClientRect();
      tip.style.left = `${Math.min(window.innerWidth - 540, Math.max(10, rect.left))}px`;
      tip.style.top = `${Math.min(window.innerHeight - 240, rect.bottom + 6)}px`;
    });

    $("threadView").addEventListener("mouseout", (e) => {
      if (e.target.closest(".quotelink")) {
        $("quoteTooltip").classList.add("hidden");
      }
    });

    // Settings modal
    $("settingsBtn").addEventListener("click", () => {
      renderSiteToggles();
      applyBackground();
      updateProxyUi();
      $("autoRefreshSelect").value = String(state.autoRefreshSec);
      $("settingsModal").classList.remove("hidden");
    });
    $("closeSettingsBtn").addEventListener("click", () => $("settingsModal").classList.add("hidden"));
    $("settingsModal").addEventListener("click", (e) => {
      if (e.target === $("settingsModal")) $("settingsModal").classList.add("hidden");
    });

    $("siteTogglesList").addEventListener("change", (e) => {
      const id = e.target.dataset.siteToggle;
      if (!id) return;
      state.enabledSites[id] = e.target.checked;
      saveState();
      renderSiteSelector();
    });

    $("hideNsfwBoardsChk").addEventListener("change", (e) => {
      state.hideNsfwBoards = e.target.checked;
      saveState();
      updateNsfwPill();
      renderBoardsDropdown();
    });

    $("blurNsfwMediaChk").addEventListener("change", (e) => {
      state.blurNsfwMedia = e.target.checked;
      saveState();
      if (currentThreadNo) renderThread();
      else renderCatalog();
    });

    $("themeSelect").addEventListener("change", (e) => {
      state.theme = e.target.value;
      saveState();
      applyTheme();
    });

    // Background color & image controls
    $("bgColorPicker").addEventListener("input", (e) => {
      state.bgColor = e.target.value;
      saveState();
      applyBackground();
    });

    $("bgColorText").addEventListener("change", (e) => {
      state.bgColor = e.target.value.trim();
      saveState();
      applyBackground();
    });

    $("resetBgColorBtn").addEventListener("click", () => {
      state.bgColor = "";
      saveState();
      applyBackground();
    });

    $("bgImageUrlInput").addEventListener("change", (e) => {
      const val = e.target.value.trim();
      if (val === "(Uploaded local image)") return;
      state.bgImage = val;
      saveState();
      applyBackground();
    });

    $("bgImageFileInput").addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (file.size > 3.5 * 1024 * 1024) {
        showToast("Image too large for local storage (max 3.5 MB). Use an image URL instead.");
        e.target.value = "";
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        state.bgImage = String(reader.result || "");
        saveState();
        applyBackground();
        showToast("Background image updated");
      };
      reader.readAsDataURL(file);
    });

    $("clearBgImageBtn").addEventListener("click", () => {
      state.bgImage = "";
      $("bgImageFileInput").value = "";
      saveState();
      applyBackground();
    });

    $("bgFitSelect").addEventListener("change", (e) => {
      state.bgFit = e.target.value;
      saveState();
      applyBackground();
    });

    $("bgDimRange").addEventListener("input", (e) => {
      state.bgDim = Number(e.target.value);
      saveState();
      applyBackground();
    });

    // Proxy connection controls
    $("proxyModeSelect").addEventListener("change", async (e) => {
      state.proxyMode = e.target.value;
      saveState();
      updateProxyUi();
      if (state.proxyMode === "none") {
        await applyProxySettings(false);
      }
    });

    $("applyProxyBtn").addEventListener("click", async () => {
      state.proxyMode = $("proxyModeSelect").value;
      state.proxyUrl = $("proxyUrlInput").value.trim();
      saveState();
      await applyProxySettings(true);
    });

    $("autoRefreshSelect").addEventListener("change", (e) => {
      state.autoRefreshSec = Number(e.target.value);
      saveState();
      startAutoRefresh();
    });

    // Bookmarks modal
    $("bookmarksBtn").addEventListener("click", () => {
      renderBookmarksModal();
      $("bookmarksModal").classList.remove("hidden");
    });
    $("closeBookmarksBtn").addEventListener("click", () => $("bookmarksModal").classList.add("hidden"));
    $("bookmarksModal").addEventListener("click", (e) => {
      if (e.target === $("bookmarksModal")) $("bookmarksModal").classList.add("hidden");
    });

    $("bookmarksList").addEventListener("click", async (e) => {
      const del = e.target.closest("[data-bm-del]");
      if (del) {
        state.bookmarks.splice(Number(del.dataset.bmDel), 1);
        saveState();
        updateBookmarkButton();
        renderBookmarksModal();
        return;
      }
      const openBtn = e.target.closest("[data-bm-idx]");
      if (openBtn) {
        const bm = state.bookmarks[Number(openBtn.dataset.bmIdx)];
        $("bookmarksModal").classList.add("hidden");
        state.activeSiteId = bm.siteId;
        state.activeBoard = bm.board;
        saveState();
        renderSiteSelector();
        await loadBoards(bm.siteId);
        updateBoardButtonLabel();
        await openThread(bm.no);
      }
    });

    // Lightbox controls
    $("lightboxCloseBtn").addEventListener("click", closeLightbox);
    $("lightboxPrevBtn").addEventListener("click", () => openLightbox(lightboxIndex - 1));
    $("lightboxNextBtn").addEventListener("click", () => openLightbox(lightboxIndex + 1));
    $("lightboxDownloadBtn").addEventListener("click", () => {
      const item = lightboxItems[lightboxIndex];
      if (item) downloadSingleFile(item.url, item.filename);
    });
    $("lightbox").addEventListener("click", (e) => {
      if (e.target === $("lightbox") || e.target === $("lightboxStage")) closeLightbox();
    });

    document.addEventListener("keydown", (e) => {
      if ($("lightbox").classList.contains("hidden")) return;
      if (e.key === "Escape") closeLightbox();
      else if (e.key === "ArrowLeft") openLightbox(lightboxIndex - 1);
      else if (e.key === "ArrowRight") openLightbox(lightboxIndex + 1);
    });
  }

  async function init() {
    applyTheme();
    updateNsfwPill();
    renderSiteSelector();
    updateBookmarkButton();
    $("sortSelect").value = state.sortBy;
    bindEvents();
    await applyProxySettings(false);
    await selectSite(state.activeSiteId);
  }

  init();
})();
