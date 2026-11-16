/**
 * Kuroba Lite — Chan Site Registry & Normalized Adapters
 * Supports 4chan, 8kun, Lainchan, 2ch.hk, Arisuchan, Wizardchan, Sushigirl, and Kohlchan.
 */
(function (global) {
  let customProxyTemplate = "";

  function isExtensionEnv() {
    return typeof location !== "undefined" && location.protocol === "chrome-extension:";
  }

  function setCustomProxyTemplate(tpl) {
    customProxyTemplate = (tpl || "").trim();
  }

  function resolveUrl(url) {
    if (!url) return "";
    if (customProxyTemplate) {
      const encoded = encodeURIComponent(url);
      if (customProxyTemplate.includes("{url}")) {
        return customProxyTemplate.replace(/\{url\}/g, encoded);
      }
      const sep = customProxyTemplate.includes("?") ? "&url=" : "?url=";
      return `${customProxyTemplate}${sep}${encoded}`;
    }
    if (isExtensionEnv()) return url;
    return `/api/proxy?url=${encodeURIComponent(url)}`;
  }

  async function fetchJson(url) {
    const res = await fetch(resolveUrl(url));
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${url}`);
    }
    return res.json();
  }

  async function fetchBinary(url) {
    const res = await fetch(resolveUrl(url));
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} downloading ${url}`);
    }
    return res.arrayBuffer();
  }

  function vichanThumbExt(ext) {
    if (!ext) return ".jpg";
    const lower = ext.toLowerCase();
    if (lower === ".png") return ".png";
    if (lower === ".gif") return ".gif";
    return ".jpg";
  }

  function normalize4chanMedia(board, post, mediaBase, thumbBase) {
    if (!post.tim || !post.ext) return [];
    return [
      {
        thumbUrl: `${thumbBase}/${board}/${post.tim}s.jpg`,
        url: `${mediaBase}/${board}/${post.tim}${post.ext}`,
        filename: `${post.filename || post.tim}${post.ext}`,
        ext: post.ext.toLowerCase(),
        w: post.w || 0,
        h: post.h || 0,
        fsize: post.fsize || 0,
      },
    ];
  }

  function normalizeVichanMedia(baseUrl, board, post) {
    const items = [];
    const pushFile = (f) => {
      if (!f || !f.tim || !f.ext) return;
      if (f.ext === "deleted") return;
      const tExt = vichanThumbExt(f.ext);
      items.push({
        thumbUrl: `${baseUrl}/${board}/thumb/${f.tim}${tExt}`,
        url: `${baseUrl}/${board}/src/${f.tim}${f.ext}`,
        filename: `${f.filename || f.tim}${f.ext}`,
        ext: f.ext.toLowerCase(),
        w: f.w || 0,
        h: f.h || 0,
        fsize: f.fsize || 0,
      });
    };
    pushFile(post);
    if (Array.isArray(post.extra_files)) {
      post.extra_files.forEach(pushFile);
    }
    return items;
  }

  function normalize8kunMedia(board, post) {
    const items = [];
    const pushFile = (f) => {
      if (!f || !f.tim || !f.ext || f.ext === "deleted") return;
      const isHash = String(f.tim).length >= 32;
      const mediaUrl = isHash
        ? `https://media.128ducks.com/file_store/${f.tim}${f.ext}`
        : `https://8kun.top/${board}/src/${f.tim}${f.ext}`;
      const thumbUrl = isHash
        ? `https://media.128ducks.com/file_store/thumb/${f.tim}${vichanThumbExt(f.ext)}`
        : `https://8kun.top/${board}/thumb/${f.tim}${vichanThumbExt(f.ext)}`;
      items.push({
        thumbUrl,
        url: mediaUrl,
        filename: `${f.filename || f.tim}${f.ext}`,
        ext: f.ext.toLowerCase(),
        w: f.w || 0,
        h: f.h || 0,
        fsize: f.fsize || 0,
      });
    };
    pushFile(post);
    if (Array.isArray(post.extra_files)) {
      post.extra_files.forEach(pushFile);
    }
    return items;
  }

  function normalizeCatalogFromVichan(pages, mediaFn, board) {
    const threads = [];
    for (const page of pages || []) {
      for (const t of page.threads || []) {
        const media = mediaFn(board, t);
        threads.push({
          no: t.no,
          sub: t.sub || "",
          com: t.com || "",
          time: t.time || 0,
          replies: t.replies || 0,
          images: t.images || 0,
          sticky: Boolean(t.sticky),
          closed: Boolean(t.closed),
          media: media[0] || null,
        });
      }
    }
    return threads;
  }

  function normalizePostsFromVichan(posts, mediaFn, board) {
    return (posts || []).map((p) => ({
      no: p.no,
      resto: p.resto || 0,
      time: p.time || 0,
      name: p.name || "Anonymous",
      trip: p.trip || "",
      id: p.id || "",
      capcode: p.capcode || "",
      country: p.country || "",
      countryName: p.country_name || "",
      sub: p.sub || "",
      com: p.com || "",
      media: mediaFn(board, p),
    }));
  }

  const SITES = [
    {
      id: "4chan",
      name: "4chan",
      homeUrl: "https://www.4chan.org",
      defaultEnabled: true,
      async fetchBoards() {
        const data = await fetchJson("https://a.4cdn.org/boards.json");
        return (data.boards || []).map((b) => ({
          code: b.board,
          title: b.title,
          nsfw: b.ws_board === 0,
        }));
      },
      async fetchCatalog(board) {
        const pages = await fetchJson(`https://a.4cdn.org/${board}/catalog.json`);
        return normalizeCatalogFromVichan(
          pages,
          (brd, p) => normalize4chanMedia(brd, p, "https://i.4cdn.org", "https://i.4cdn.org"),
          board
        );
      },
      async fetchThread(board, threadNo) {
        const data = await fetchJson(`https://a.4cdn.org/${board}/thread/${threadNo}.json`);
        return normalizePostsFromVichan(
          data.posts,
          (brd, p) => normalize4chanMedia(brd, p, "https://i.4cdn.org", "https://i.4cdn.org"),
          board
        );
      },
    },
    {
      id: "lainchan",
      name: "Lainchan",
      homeUrl: "https://lainchan.org",
      defaultEnabled: true,
      async fetchBoards() {
        return [
          { code: "λ", title: "Programming", nsfw: false },
          { code: "diy", title: "Do It Yourself", nsfw: false },
          { code: "sec", title: "Security", nsfw: false },
          { code: "tech", title: "Technology", nsfw: false },
          { code: "inter", title: "Games & Interactive Media", nsfw: false },
          { code: "lit", title: "Literature", nsfw: false },
          { code: "music", title: "Music", nsfw: false },
          { code: "vis", title: "Visual Arts", nsfw: false },
          { code: "hum", title: "Humanity", nsfw: false },
          { code: "drg", title: "Drugs & 3.0", nsfw: true },
          { code: "zzz", title: "Consciousness & Dreams", nsfw: false },
          { code: "r", title: "Random", nsfw: true },
          { code: "q", title: "Questions & Complaints", nsfw: false },
          { code: "lain", title: "Lain", nsfw: false },
        ];
      },
      async fetchCatalog(board) {
        const pages = await fetchJson(`https://lainchan.org/${encodeURIComponent(board)}/catalog.json`);
        return normalizeCatalogFromVichan(
          pages,
          (brd, p) => normalizeVichanMedia("https://lainchan.org", encodeURIComponent(brd), p),
          board
        );
      },
      async fetchThread(board, threadNo) {
        const data = await fetchJson(`https://lainchan.org/${encodeURIComponent(board)}/res/${threadNo}.json`);
        return normalizePostsFromVichan(
          data.posts,
          (brd, p) => normalizeVichanMedia("https://lainchan.org", encodeURIComponent(brd), p),
          board
        );
      },
    },
    {
      id: "8kun",
      name: "8kun",
      homeUrl: "https://8kun.top",
      defaultEnabled: true,
      async fetchBoards() {
        try {
          const data = await fetchJson("https://8kun.top/boards.json");
          if (Array.isArray(data) && data.length > 0) {
            return data.slice(0, 80).map((b) => ({
              code: b.uri,
              title: b.title || b.uri,
              nsfw: b.sfw === "0" || b.sfw === 0 || Boolean(b.nsfw),
            }));
          }
        } catch {
          // Fallback to curated boards if boards.json is unavailable
        }
        return [
          { code: "v", title: "Video Games", nsfw: false },
          { code: "tech", title: "Technology", nsfw: false },
          { code: "pnd", title: "Politics, News, & Debate", nsfw: false },
          { code: "pol", title: "Politically Incorrect", nsfw: true },
          { code: "a", title: "Anime & Manga", nsfw: false },
          { code: "b", title: "Random", nsfw: true },
          { code: "wx", title: "Weather & Earth", nsfw: false },
        ];
      },
      async fetchCatalog(board) {
        const pages = await fetchJson(`https://8kun.top/${encodeURIComponent(board)}/catalog.json`);
        return normalizeCatalogFromVichan(pages, normalize8kunMedia, board);
      },
      async fetchThread(board, threadNo) {
        const data = await fetchJson(`https://8kun.top/${encodeURIComponent(board)}/res/${threadNo}.json`);
        return normalizePostsFromVichan(data.posts, normalize8kunMedia, board);
      },
    },
    {
      id: "2ch",
      name: "2ch.hk (Dvach)",
      homeUrl: "https://2ch.hk",
      defaultEnabled: true,
      async fetchBoards() {
        const data = await fetchJson("https://2ch.hk/api/mobile/v2/boards");
        const list = Array.isArray(data) ? data : (data.boards || []);
        return list.map((b) => ({
          code: b.id,
          title: b.name,
          nsfw: Boolean(b.is_nsfw) || b.category === "Взрослым" || b.id === "b",
        }));
      },
      async fetchCatalog(board) {
        const data = await fetchJson(`https://2ch.hk/${encodeURIComponent(board)}/catalog.json`);
        return (data.threads || []).map((t) => {
          const f = Array.isArray(t.files) && t.files[0];
          return {
            no: t.num,
            sub: t.subject || "",
            com: t.comment || "",
            time: t.timestamp || 0,
            replies: t.posts_count || 0,
            images: t.files_count || 0,
            sticky: Boolean(t.sticky),
            closed: Boolean(t.closed),
            media: f
              ? {
                  thumbUrl: `https://2ch.hk${f.thumbnail}`,
                  url: `https://2ch.hk${f.path}`,
                  filename: f.fullname || f.name || `file${f.path.slice(f.path.lastIndexOf("."))}`,
                  ext: f.path.slice(f.path.lastIndexOf(".")).toLowerCase(),
                  w: f.width || 0,
                  h: f.height || 0,
                  fsize: (f.size || 0) * 1024,
                }
              : null,
          };
        });
      },
      async fetchThread(board, threadNo) {
        const data = await fetchJson(`https://2ch.hk/${encodeURIComponent(board)}/res/${threadNo}.json`);
        const posts = (data.threads && data.threads[0] && data.threads[0].posts) || [];
        return posts.map((p) => ({
          no: p.num,
          resto: p.parent === 0 ? 0 : p.parent,
          time: p.timestamp || 0,
          name: p.name || "Аноним",
          trip: p.trip || "",
          id: "",
          capcode: "",
          country: "",
          countryName: "",
          sub: p.subject || "",
          com: p.comment || "",
          media: (p.files || []).map((f) => ({
            thumbUrl: `https://2ch.hk${f.thumbnail}`,
            url: `https://2ch.hk${f.path}`,
            filename: f.fullname || f.name || "file",
            ext: f.path.slice(f.path.lastIndexOf(".")).toLowerCase(),
            w: f.width || 0,
            h: f.height || 0,
            fsize: (f.size || 0) * 1024,
          })),
        }));
      },
    },
    {
      id: "arisuchan",
      name: "Arisuchan",
      homeUrl: "https://arisuchan.jp",
      defaultEnabled: true,
      async fetchBoards() {
        return [
          { code: "cyb", title: "Cyberpunk", nsfw: false },
          { code: "diy", title: "DIY", nsfw: false },
          { code: "tech", title: "Technology", nsfw: false },
          { code: "art", title: "Art & Design", nsfw: false },
          { code: "z", title: "General", nsfw: true },
          { code: "x", title: "Paranormal", nsfw: false },
        ];
      },
      async fetchCatalog(board) {
        const pages = await fetchJson(`https://arisuchan.jp/${board}/catalog.json`);
        return normalizeCatalogFromVichan(
          pages,
          (brd, p) => normalizeVichanMedia("https://arisuchan.jp", brd, p),
          board
        );
      },
      async fetchThread(board, threadNo) {
        const data = await fetchJson(`https://arisuchan.jp/${board}/res/${threadNo}.json`);
        return normalizePostsFromVichan(
          data.posts,
          (brd, p) => normalizeVichanMedia("https://arisuchan.jp", brd, p),
          board
        );
      },
    },
    {
      id: "sushigirl",
      name: "Sushigirl",
      homeUrl: "https://sushigirl.us",
      defaultEnabled: false,
      async fetchBoards() {
        return [
          { code: "lounge", title: "Lounge", nsfw: false },
          { code: "arcade", title: "Arcade", nsfw: false },
          { code: "kawaii", title: "Kawaii", nsfw: false },
          { code: "kitchen", title: "Kitchen", nsfw: false },
          { code: "hell", title: "Hell", nsfw: true },
        ];
      },
      async fetchCatalog(board) {
        const pages = await fetchJson(`https://sushigirl.us/${board}/catalog.json`);
        return normalizeCatalogFromVichan(
          pages,
          (brd, p) => normalizeVichanMedia("https://sushigirl.us", brd, p),
          board
        );
      },
      async fetchThread(board, threadNo) {
        const data = await fetchJson(`https://sushigirl.us/${board}/res/${threadNo}.json`);
        return normalizePostsFromVichan(
          data.posts,
          (brd, p) => normalizeVichanMedia("https://sushigirl.us", brd, p),
          board
        );
      },
    },
    {
      id: "wizchan",
      name: "Wizardchan",
      homeUrl: "https://wizchan.org",
      defaultEnabled: false,
      async fetchBoards() {
        return [
          { code: "wiz", title: "Wizardry", nsfw: false },
          { code: "dep", title: "Depression", nsfw: false },
          { code: "hob", title: "Hobbies", nsfw: false },
          { code: "jp", title: "Otaku Culture", nsfw: false },
          { code: "meta", title: "Meta", nsfw: false },
        ];
      },
      async fetchCatalog(board) {
        const pages = await fetchJson(`https://wizchan.org/${board}/catalog.json`);
        return normalizeCatalogFromVichan(
          pages,
          (brd, p) => normalizeVichanMedia("https://wizchan.org", brd, p),
          board
        );
      },
      async fetchThread(board, threadNo) {
        const data = await fetchJson(`https://wizchan.org/${board}/res/${threadNo}.json`);
        return normalizePostsFromVichan(
          data.posts,
          (brd, p) => normalizeVichanMedia("https://wizchan.org", brd, p),
          board
        );
      },
    },
    {
      id: "kohlchan",
      name: "Kohlchan",
      homeUrl: "https://kohlchan.net",
      defaultEnabled: false,
      async fetchBoards() {
        return [
          { code: "b", title: "Bernd", nsfw: true },
          { code: "int", title: "International", nsfw: false },
          { code: "pol", title: "Politik", nsfw: false },
          { code: "prog", title: "Programmieren", nsfw: false },
          { code: "med", title: "Medizin", nsfw: false },
        ];
      },
      async fetchCatalog(board) {
        const data = await fetchJson(`https://kohlchan.net/${board}/catalog.json`);
        const list = Array.isArray(data) ? data : (data.threads || []);
        return list.map((t) => {
          const f = Array.isArray(t.files) && t.files[0];
          return {
            no: t.threadId || t.no,
            sub: t.subject || "",
            com: t.message || t.markdown || "",
            time: t.creation ? Math.floor(new Date(t.creation).getTime() / 1000) : 0,
            replies: t.postCount || 0,
            images: t.fileCount || 0,
            sticky: Boolean(t.pinned),
            closed: Boolean(t.locked),
            media: f
              ? {
                  thumbUrl: `https://kohlchan.net${f.thumb}`,
                  url: `https://kohlchan.net${f.path}`,
                  filename: f.originalName || "file",
                  ext: (f.path || "").slice((f.path || "").lastIndexOf(".")).toLowerCase(),
                  w: f.width || 0,
                  h: f.height || 0,
                  fsize: f.size || 0,
                }
              : null,
          };
        });
      },
      async fetchThread(board, threadNo) {
        const data = await fetchJson(`https://kohlchan.net/${board}/res/${threadNo}.json`);
        const posts = [data, ...(data.posts || [])];
        return posts.map((p) => ({
          no: p.postId || p.threadId,
          resto: p.postId ? data.threadId : 0,
          time: p.creation ? Math.floor(new Date(p.creation).getTime() / 1000) : 0,
          name: p.name || "Bernd",
          trip: "",
          id: p.id || "",
          capcode: "",
          country: "",
          countryName: "",
          sub: p.subject || "",
          com: p.message || p.markdown || "",
          media: (p.files || []).map((f) => ({
            thumbUrl: `https://kohlchan.net${f.thumb}`,
            url: `https://kohlchan.net${f.path}`,
            filename: f.originalName || "file",
            ext: (f.path || "").slice((f.path || "").lastIndexOf(".")).toLowerCase(),
            w: f.width || 0,
            h: f.height || 0,
            fsize: f.size || 0,
          })),
        }));
      },
    },
  ];

  global.KurobaSites = {
    SITES,
    resolveUrl,
    setCustomProxyTemplate,
    fetchJson,
    fetchBinary,
    isExtensionEnv,
  };
})(window);
