var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache"
};
var KEY = "jump-config";
var LOBBY_PREFIX = "lobby:";
var KV_PROFILE_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
function bindingName(base, profile) {
  return profile ? `${base}_${profile}` : base;
}
__name(bindingName, "bindingName");
function readKvProfile(url) {
  const raw = (url.searchParams.get("kv") || "").trim();
  if (!raw) return "";
  if (!KV_PROFILE_RE.test(raw)) return null;
  return raw;
}
__name(readKvProfile, "readKvProfile");
function pickNs(env, base, profile) {
  const name = bindingName(base, profile);
  return { name, ns: env[name] ?? null };
}
__name(pickNs, "pickNs");
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" }
  });
}
__name(json, "json");
var EMPTY = { updatedAt: 0, items: [] };
function lobbyKey(id) {
  return `${LOBBY_PREFIX}${id}`;
}
__name(lobbyKey, "lobbyKey");
function parseLobbyId(pathname) {
  const m = pathname.match(/^\/lobby\/([^/]+)\/?$/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}
__name(parseLobbyId, "parseLobbyId");
async function listAllKeys(ns) {
  const names = [];
  let cursor;
  do {
    const page = await ns.list(cursor ? { cursor, limit: 1e3 } : { limit: 1e3 });
    for (const k of page.keys) names.push(k.name);
    cursor = page.list_complete ? void 0 : page.cursor;
  } while (cursor);
  return names;
}
__name(listAllKeys, "listAllKeys");
async function lobbyKeysFromConfig(configKv) {
  if (!configKv) return [];
  const raw = await configKv.get(KEY);
  if (!raw) return [];
  try {
    const cfg = JSON.parse(raw);
    const items = Array.isArray(cfg.items) ? cfg.items : [];
    return items.filter((i) => i && i.kind === "lobby" && typeof i.id === "string" && i.id).map((i) => lobbyKey(i.id));
  } catch {
    return [];
  }
}
__name(lobbyKeysFromConfig, "lobbyKeysFromConfig");
async function snapshotKv(src, dest, extraKeys = []) {
  if (!src || !dest) {
    throw new Error("\u5907\u4EFD KV \u672A\u7ED1\u5B9A");
  }
  const srcKeys = await listAllKeys(src);
  for (const k of extraKeys) {
    if (k && !srcKeys.includes(k)) srcKeys.push(k);
  }
  const destKeys = await listAllKeys(dest);
  const srcSet = new Set(srcKeys);
  let copied = 0;
  for (const name of srcKeys) {
    const val = await src.get(name);
    if (val === null) continue;
    await dest.put(name, val);
    copied += 1;
  }
  for (const name of destKeys) {
    if (!srcSet.has(name)) await dest.delete(name);
  }
  return copied;
}
__name(snapshotKv, "snapshotKv");
var worker_default = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    const url = new URL(request.url);
    const { pathname } = url;
    const profile = readKvProfile(url);
    if (profile === null) {
      return json({ error: "\u65E0\u6548\u7684 kv \u53C2\u6570" }, 400);
    }
    const configStore = pickNs(env, "JUMP_CONFIG", profile);
    const lobbyStore = pickNs(env, "JUMP_LOBBY", profile);
    const configBackupStore = pickNs(env, "JUMP_CONFIG_BACKUP", profile);
    const lobbyBackupStore = pickNs(env, "JUMP_LOBBY_BACKUP", profile);
    const itemLayoutStore = pickNs(env, "JUMP_ITEM_LAYOUT", profile);
    const fieldLayoutStore = pickNs(env, "JUMP_FIELD_LAYOUT", profile);
    try {
      if (pathname === "/lobbies" || pathname === "/lobbies/") {
        if (request.method !== "GET") {
          return json({ error: "Method Not Allowed" }, 405);
        }
        const lobbyKv = lobbyStore.ns;
        if (!lobbyKv) {
          return json({ error: `\u672A\u7ED1\u5B9A ${lobbyStore.name} KV` }, 500);
        }
        const names = await listAllKeys(lobbyKv);
        const lobbies = {};
        for (const name of names) {
          const id = name.startsWith(LOBBY_PREFIX) ? name.slice(LOBBY_PREFIX.length) : name;
          const raw = await lobbyKv.get(name);
          if (!raw) continue;
          try {
            lobbies[id] = JSON.parse(raw);
          } catch {
          }
        }
        return json({ lobbies });
      }
      if (pathname === "/backup" || pathname === "/backup/") {
        if (request.method !== "POST") {
          return json({ error: "Method Not Allowed" }, 405);
        }
        const configKeys = await snapshotKv(configStore.ns, configBackupStore.ns, [KEY]);
        const lobbyKeys = await snapshotKv(
          lobbyStore.ns,
          lobbyBackupStore.ns,
          await lobbyKeysFromConfig(configStore.ns)
        );
        return json({
          ok: true,
          backedAt: Date.now(),
          configKeys,
          lobbyKeys
        });
      }
      const mediaFileMatch = pathname.match(/^\/screenshot\/file\/([a-zA-Z0-9._-]+)$/);
      if (mediaFileMatch && request.method === "GET") {
        const fname = mediaFileMatch[1];
        if (configStore.ns) {
          const raw = await configStore.ns.get(`media:${fname}`);
          if (raw) {
            const parsed = JSON.parse(raw);
            const bin = atob(parsed.base64Content || "");
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
            return new Response(bytes, {
              status: 200,
              headers: {
                ...CORS,
                "Content-Type": parsed.mimeType || "video/mp4",
                "Content-Length": String(bytes.byteLength)
              }
            });
          }
        }
        return json({ error: "\u6587\u4EF6\u4E0D\u5B58\u5728\u6216\u5DF2\u8FC7\u671F" }, 404);
      }
      if (pathname === "/screenshot/email" || pathname === "/screenshot/email/") {
        if (request.method !== "POST") {
          return json({ error: "Method Not Allowed" }, 405);
        }
        const body = await request.json();
        const to = (typeof body?.to === "string" ? body.to.trim() : "") || "gcdxdy666@gmail.com";
        const imageDataUrl = typeof body?.imageDataUrl === "string" ? body.imageDataUrl : "";
        const pageUrl = typeof body?.pageUrl === "string" ? body.pageUrl : "";
        const content = typeof body?.content === "string" ? body.content.trim() : "";
        const b64Marker = ";base64,";
        const b64Idx = imageDataUrl.indexOf(b64Marker);
        const header = b64Idx > 0 ? imageDataUrl.slice(0, b64Idx) : "";
        if (b64Idx === -1 || !header.startsWith("data:image/") && !header.startsWith("data:video/")) {
          return json({ error: "\u5A92\u4F53\u6570\u636E\u683C\u5F0F\u65E0\u6548\uFF08\u9700\u4E3A\u56FE\u7247\u6216\u89C6\u9891 base64\uFF09" }, 400);
        }
        const mimeType = header.slice(5).split(";")[0] || "image/png";
        const isVideo = mimeType.startsWith("video/");
        const subject = typeof body?.subject === "string" && body.subject.trim() ? body.subject.trim() : `${isVideo ? "\u7F51\u9875\u5F55\u5C4F" : "\u7F51\u9875\u622A\u56FE"} (${(/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")})`;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
          return json({ error: "\u8BF7\u586B\u5199\u6709\u6548\u7684\u6536\u4EF6\u90AE\u7BB1\u5730\u5740" }, 400);
        }
        const base64Content = imageDataUrl.slice(b64Idx + b64Marker.length);
        const stamp = Date.now();
        const ext = isVideo ? mimeType.includes("mp4") ? "mp4" : "webm" : "png";
        const mediaFilename = `${isVideo ? "recording" : "screenshot"}-${stamp}.${ext}`;
        const contentHtml = content ? `<p>\u90AE\u4EF6\u5185\u5BB9\uFF1A${content}</p>` : "";
        const contentText = content ? `\u90AE\u4EF6\u5185\u5BB9\uFF1A${content}
` : "";
        let publicFileUrl = "";
        if (isVideo) {
          try {
            const bin = atob(base64Content);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
            const videoBlob = new Blob([bytes], { type: mimeType });
            try {
              const fd = new FormData();
              fd.append("file", videoBlob, mediaFilename);
              const upRes = await fetch("https://tmpfiles.org/api/v1/upload", {
                method: "POST",
                body: fd
              });
              if (upRes.ok) {
                const j = await upRes.json();
                const rawUrl = typeof j?.data?.url === "string" ? j.data.url : "";
                if (rawUrl) {
                  publicFileUrl = rawUrl.replace("://tmpfiles.org/", "://tmpfiles.org/dl/");
                }
              }
            } catch {
            }
            if (!publicFileUrl) {
              try {
                const fd = new FormData();
                fd.append("reqtype", "fileupload");
                fd.append("time", "72h");
                fd.append("fileToUpload", videoBlob, mediaFilename);
                const upRes = await fetch("https://litterbox.catbox.moe/resources/internals/api.php", {
                  method: "POST",
                  body: fd
                });
                if (upRes.ok) {
                  const text = (await upRes.text()).trim();
                  if (/^https?:\/\//i.test(text)) publicFileUrl = text;
                }
              } catch {
              }
            }
            if (!publicFileUrl && configStore.ns && base64Content.length < 22 * 1024 * 1024) {
              await configStore.ns.put(
                `media:${mediaFilename}`,
                JSON.stringify({ mimeType, base64Content }),
                { expirationTtl: 86400 * 3 }
              );
              publicFileUrl = `${url.origin}/screenshot/file/${mediaFilename}`;
            }
          } catch {
          }
        }
        const urlHtml = publicFileUrl ? `<p>\u89C6\u9891\u5728\u7EBF\u64AD\u653E/\u4E0B\u8F7D\u94FE\u63A5 (publicFileUrl)\uFF1A<a href="${publicFileUrl}">${publicFileUrl}</a></p>` : "";
        if (env.EMAIL && typeof env.EMAIL.send === "function" && env.MAIL_FROM) {
          try {
            await env.EMAIL.send({
              from: { email: env.MAIL_FROM, name: "Jumpl Screenshot" },
              to: [to],
              subject,
              text: `${contentText}\u9875\u9762\u5730\u5740\uFF1A${pageUrl || "\u672A\u77E5"}
${publicFileUrl ? `publicFileUrl: ${publicFileUrl}
` : ""}${isVideo ? "\u5F55\u5C4F\u89C6\u9891" : "\u622A\u56FE"}\u89C1\u9644\u4EF6\u3002`,
              html: `${contentHtml}<p>\u9875\u9762\u5730\u5740\uFF1A${pageUrl || "\u672A\u77E5"}</p>${urlHtml}<p>${isVideo ? "\u5F55\u5C4F\u89C6\u9891" : "\u622A\u56FE"}\u89C1\u9644\u4EF6\u3002</p>`,
              attachments: [
                {
                  filename: mediaFilename,
                  content: base64Content,
                  type: mimeType,
                  disposition: "attachment"
                }
              ]
            });
          } catch {
            await env.EMAIL.send({
              from: { email: env.MAIL_FROM, name: "Jumpl Screenshot" },
              to: [to],
              subject,
              text: `${contentText}\u9875\u9762\u5730\u5740\uFF1A${pageUrl || "\u672A\u77E5"}
\u89C6\u9891\u5728\u7EBF\u94FE\u63A5 (publicFileUrl): ${publicFileUrl}`,
              html: `${contentHtml}<p>\u9875\u9762\u5730\u5740\uFF1A${pageUrl || "\u672A\u77E5"}</p>${urlHtml}`
            });
          }
          return json({
            ok: true,
            mode: "cloudflare_email",
            publicFileUrl: publicFileUrl || void 0,
            fileUrl: publicFileUrl || void 0,
            message: `${isVideo ? "\u5F55\u5C4F" : "\u622A\u56FE"}\u5DF2\u53D1\u9001\u81F3 ${to}`
          });
        }
        if (env.RESEND_API_KEY) {
          const mailFrom = env.MAIL_FROM || "Jumpl Screenshot <onboarding@resend.dev>";
          let resp = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.RESEND_API_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              from: mailFrom,
              to: [to],
              subject,
              html: `${contentHtml}<p>\u9875\u9762\u5730\u5740\uFF1A${pageUrl || "\u672A\u77E5"}</p>${urlHtml}<p>${isVideo ? "\u5F55\u5C4F\u89C6\u9891" : "\u622A\u56FE"}\u89C1\u9644\u4EF6\u3002</p>`,
              attachments: [{ filename: mediaFilename, content: base64Content }]
            })
          }).catch(() => null);
          if (!resp || !resp.ok) {
            resp = await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${env.RESEND_API_KEY}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                from: mailFrom,
                to: [to],
                subject,
                html: `${contentHtml}<p>\u9875\u9762\u5730\u5740\uFF1A${pageUrl || "\u672A\u77E5"}</p>${urlHtml}`
              })
            });
          }
          if (!resp.ok) {
            const errText = await resp.text().catch(() => "");
            return json(
              { error: `\u90AE\u4EF6\u670D\u52A1\u8FD4\u56DE\u9519\u8BEF (${resp.status}) ${errText.slice(0, 120)}` },
              502
            );
          }
          return json({
            ok: true,
            mode: "resend",
            publicFileUrl: publicFileUrl || void 0,
            fileUrl: publicFileUrl || void 0,
            message: `${isVideo ? "\u5F55\u5C4F" : "\u622A\u56FE"}\u5DF2\u53D1\u9001\u81F3 ${to}`
          });
        }
        if (env.EMAIL_WEBHOOK_URL) {
          let resp = await fetch(env.EMAIL_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              to,
              subject,
              content,
              pageUrl,
              publicFileUrl,
              imageDataUrl,
              filename: mediaFilename
            })
          }).catch(() => null);
          if (!resp || !resp.ok) {
            resp = await fetch(env.EMAIL_WEBHOOK_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                to,
                subject,
                content,
                pageUrl,
                publicFileUrl,
                filename: mediaFilename
              })
            });
          }
          if (!resp.ok) {
            return json({ error: `\u90AE\u4EF6 Webhook \u8FD4\u56DE\u9519\u8BEF (${resp.status})` }, 502);
          }
          return json({
            ok: true,
            mode: "webhook",
            publicFileUrl: publicFileUrl || void 0,
            fileUrl: publicFileUrl || void 0,
            message: `${isVideo ? "\u5F55\u5C4F" : "\u622A\u56FE"}\u5DF2\u53D1\u9001\u81F3 ${to}`
          });
        }
        return json({
          ok: true,
          mode: "client_relay",
          publicFileUrl: publicFileUrl || void 0,
          fileUrl: publicFileUrl || void 0,
          message: "\u4F7F\u7528\u514D\u5BC6\u94A5\u90AE\u4EF6\u7F51\u5173\u6295\u9012"
        });
      }
      const layoutMatch = pathname.match(/^\/layout\/(items|fields)\/?$/);
      if (layoutMatch) {
        const which = layoutMatch[1];
        const layoutStore = which === "items" ? itemLayoutStore : fieldLayoutStore;
        const ns = layoutStore.ns;
        if (!ns) {
          return json({ error: `\u672A\u7ED1\u5B9A ${layoutStore.name} KV` }, 500);
        }
        if (request.method === "GET") {
          const raw = await ns.get("layout");
          if (!raw) return json({});
          try {
            return json(JSON.parse(raw));
          } catch {
            return json({ error: "\u5E03\u5C40\u635F\u574F" }, 500);
          }
        }
        if (request.method === "PUT") {
          const body = await request.json();
          if (!body || typeof body !== "object") {
            return json({ error: "body \u987B\u4E3A\u5BF9\u8C61" }, 400);
          }
          await ns.put("layout", JSON.stringify(body));
          return json(body);
        }
        return json({ error: "Method Not Allowed" }, 405);
      }
      const lobbyId = parseLobbyId(pathname);
      if (lobbyId) {
        const lobbyKv = lobbyStore.ns;
        if (!lobbyKv) {
          return json({ error: `\u672A\u7ED1\u5B9A ${lobbyStore.name} KV` }, 500);
        }
        if (request.method === "GET") {
          const raw = await lobbyKv.get(lobbyKey(lobbyId));
          if (!raw) return json({ error: "\u5927\u5385\u914D\u7F6E\u4E0D\u5B58\u5728" }, 404);
          try {
            return json(JSON.parse(raw));
          } catch {
            return json({ error: "\u5927\u5385\u914D\u7F6E\u635F\u574F" }, 500);
          }
        }
        if (request.method === "PUT") {
          const body = await request.json();
          if (!body || typeof body !== "object") {
            return json({ error: "body \u987B\u4E3A\u5BF9\u8C61" }, 400);
          }
          await lobbyKv.put(lobbyKey(lobbyId), JSON.stringify(body));
          return json(body);
        }
        if (request.method === "DELETE") {
          await lobbyKv.delete(lobbyKey(lobbyId));
          return json({ ok: true });
        }
        return json({ error: "Method Not Allowed" }, 405);
      }
      if (pathname !== "/" && pathname !== "/config") {
        return json({ error: "Not Found" }, 404);
      }
      if (request.method === "GET") {
        if (!configStore.ns) {
          return json({ error: `\u672A\u7ED1\u5B9A ${configStore.name} KV` }, 500);
        }
        const raw = await configStore.ns.get(KEY);
        if (!raw) return json(EMPTY);
        try {
          return json(JSON.parse(raw));
        } catch {
          return json({ error: "\u914D\u7F6E\u635F\u574F" }, 500);
        }
      }
      if (request.method === "PUT") {
        const body = await request.json();
        if (!body || typeof body !== "object" || !Array.isArray(body.items)) {
          return json({ error: "body \u987B\u5305\u542B items \u6570\u7EC4" }, 400);
        }
        if (!configStore.ns) {
          return json({ error: `\u672A\u7ED1\u5B9A ${configStore.name} KV` }, 500);
        }
        const force = url.searchParams.get("force") === "1";
        const currentRaw = await configStore.ns.get(KEY);
        const current = currentRaw ? JSON.parse(currentRaw) : EMPTY;
        const clientUpdatedAt = typeof body.updatedAt === "number" ? body.updatedAt : 0;
        if (!force && clientUpdatedAt !== (current.updatedAt || 0)) {
          return json(
            {
              error: "\u914D\u7F6E\u5DF2\u88AB\u4ED6\u4EBA\u66F4\u65B0\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5\u6216\u5F3A\u5236\u8986\u76D6",
              serverConfig: current
            },
            409
          );
        }
        const next = {
          updatedAt: Date.now(),
          items: body.items
        };
        await configStore.ns.put(KEY, JSON.stringify(next));
        return json(next);
      }
      return json({ error: "Method Not Allowed" }, 405);
    } catch (err) {
      return json(
        { error: err instanceof Error ? err.message : "Internal Error" },
        500
      );
    }
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
