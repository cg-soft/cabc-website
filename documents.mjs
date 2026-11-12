import { HttpError, transaction } from "./db.mjs";

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENT_STORAGE = 250 * 1024 * 1024;
const columns = "id,title,description,filename,visibility,size,revision,created_at,updated_at";
const administrator = user => {
  if (user.role !== "admin") throw new HttpError(403, "Administrator access required.");
};
export function documentsAvailable(db) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='documents'").get();
}
async function readBody(req, max) {
  if (req.headers["content-length"] && (!/^\d+$/.test(req.headers["content-length"]) ||
      Number(req.headers["content-length"]) > max)) {
    req.resume();
    throw new HttpError(413, max === MAX_DOCUMENT_BYTES ? "PDF files must be 10 MB or smaller." : "Request too large.");
  }
  const chunks = []; let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > max) {
      req.resume();
      throw new HttpError(413, max === MAX_DOCUMENT_BYTES ? "PDF files must be 10 MB or smaller." : "Request too large.");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function metadata(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Invalid document details.");
  const { title, description = "", visibility = "admin" } = body;
  if (typeof title !== "string" || !title.trim() || title.trim().length > 120 ||
      /[\u0000-\u001f\u007f]/.test(title))
    throw new HttpError(400, "Enter a document title of 1 to 120 characters.");
  if (typeof description !== "string" || description.length > 1000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(description))
    throw new HttpError(400, "Use a description of at most 1,000 characters.");
  if (!["admin", "members"].includes(visibility)) throw new HttpError(400, "Choose a valid document visibility.");
  return { title: title.trim(), description: description.trim(), visibility };
}
function revision(body, row) {
  if (!Number.isSafeInteger(body.revision) || body.revision !== row.revision)
    throw new HttpError(409, "This document changed. Close the form and refresh Documents before retrying.");
}
function sharing(body, required) {
  if (required && body.confirmPublish !== true)
    throw new HttpError(400, "Confirm that all active members may view and download this document.");
}
function pdf(bytes, filename) {
  if (typeof filename !== "string" || filename.length > 180 || !/\.pdf$/i.test(filename) ||
      /[\\/\u0000-\u001f\u007f]/.test(filename))
    throw new HttpError(400, "Choose a PDF file with a valid .pdf filename.");
  if (!/^%PDF-(1\.[0-7]|2\.0)[\r\n ]/.test(bytes.subarray(0, 16).toString("latin1")) ||
      !/%%EOF\s*$/.test(bytes.subarray(-1024).toString("latin1")))
    throw new HttpError(400, "This file does not have a valid PDF header and ending.");
  // Basic active-content screening is NOT antivirus or full PDF sanitization.
  const names = bytes.toString("latin1").replace(/#([a-f0-9]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  if (/\/(?:JavaScript|JS|Launch|EmbeddedFile|RichMedia|OpenAction|AA|Encrypt)\b/.test(names))
    throw new HttpError(400, "Use an unencrypted PDF without scripts, attachments or automatic actions.");
}
export function createDocumentHandler({ db, authenticate }) {
  let uploads = 0;
  return async function handle(req, res, url, user, reply) {
    if (!documentsAvailable(db)) throw new HttpError(503, "Documents are not installed yet. Run the documents migration and reload.");
    const match = /^\/api\/documents\/(\d+)(\/file)?$/.exec(url.pathname);
    const id = match ? Number(match[1]) : null;
    if (id !== null && (!Number.isSafeInteger(id) || id <= 0)) throw new HttpError(404, "Document not found.");
    function document(includeContent = false) {
      const row = db.prepare(`SELECT ${columns}${includeContent ? ",content" : ""} FROM documents WHERE id=?${user.role === "admin" ? "" : " AND visibility='members'"}`).get(id);
      if (!row)
        throw new HttpError(404, "Document not found.");
      return row;
    }
    function audit(actor, action, documentId, before, after) {
      db.prepare("INSERT INTO document_audit(created_at,actor_id,document_id,action,old_visibility,new_visibility) VALUES(?,?,?,?,?,?)")
        .run(new Date().toISOString(), actor.id, documentId, action, before || null, after || null);
    }
    if (!match && req.method === "GET") {
      const documents = db.prepare(`SELECT ${columns} FROM documents ${user.role === "admin" ? "" : "WHERE visibility='members'"} ORDER BY updated_at DESC,id DESC`).all();
      return reply(200, { documents, maxBytes: MAX_DOCUMENT_BYTES });
    }
    if (match?.[2] && ["GET", "HEAD"].includes(req.method)) {
      const row = document(req.method === "GET");
      res.writeHead(200, { "Content-Type": "application/pdf", "Content-Length": row.size,
        "Content-Disposition": `${url.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="document-${id}.pdf"; filename*=UTF-8''${encodeURIComponent(row.filename).replace(/['()*]/g, c => "%" + c.charCodeAt(0).toString(16))}`,
        "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'", "Cross-Origin-Resource-Policy": "same-origin" });
      return res.end(req.method === "HEAD" ? undefined : Buffer.from(row.content));
    }
    administrator(user);
    if ((!match && req.method === "POST") || (match?.[2] && req.method === "PUT")) {
      if (req.headers["content-type"]?.split(";")[0].trim() !== "application/pdf")
        throw new HttpError(415, "Upload a PDF file.");
      if (uploads >= 2) throw new HttpError(429, "Two uploads are already in progress. Please retry shortly.");
      let body;
      try {
        if (typeof req.headers["x-document-metadata"] !== "string" || req.headers["x-document-metadata"].length > 14000) throw new Error();
        body = JSON.parse(decodeURIComponent(req.headers["x-document-metadata"]));
      } catch { throw new HttpError(400, "Invalid document details."); }
      const fields = metadata(body);
      sharing(body, fields.visibility === "members");
      if (match) revision(body, document());
      uploads++;
      try {
        const bytes = await readBody(req, MAX_DOCUMENT_BYTES);
        pdf(bytes, body.filename);
        const result = transaction(db, () => {
          const actor = authenticate(req); administrator(actor);
          const old = match ? document() : null;
          if (old) revision(body, old);
          const used = db.prepare("SELECT coalesce(sum(size),0) AS n FROM documents").get().n;
          if (!old && db.prepare("SELECT count(*) AS n FROM documents").get().n >= 1000)
            throw new HttpError(409, "The 1,000 document limit has been reached. Remove unneeded documents first.");
          if (used - (old?.size || 0) + bytes.length > MAX_DOCUMENT_STORAGE)
            throw new HttpError(409, "The 250 MB document storage limit has been reached. Remove unneeded documents first.");
          const now = new Date().toISOString();
          const values = [fields.title, fields.description, body.filename, fields.visibility, bytes, bytes.length, now];
          let savedId = id;
          if (old) db.prepare("UPDATE documents SET title=?,description=?,filename=?,visibility=?,content=?,size=?,updated_at=?,revision=revision+1 WHERE id=?").run(...values, id);
          else savedId = Number(db.prepare("INSERT INTO documents(title,description,filename,visibility,content,size,updated_at,created_at,uploaded_by) VALUES(?,?,?,?,?,?,?,?,?)")
            .run(...values, now, actor.id).lastInsertRowid);
          audit(actor, old ? "replace" : "upload", savedId, old?.visibility, fields.visibility);
          return db.prepare(`SELECT ${columns} FROM documents WHERE id=?`).get(savedId);
        });
        return reply(match ? 200 : 201, { document: result });
      } finally { uploads--; }
    }
    if (match && !match[2] && ["PATCH", "DELETE"].includes(req.method)) {
      if (!req.headers["content-type"]?.startsWith("application/json")) throw new HttpError(415, "JSON required.");
      let body;
      try { body = JSON.parse((await readBody(req, 16384)).toString()); }
      catch (error) { if (error.status) throw error; throw new HttpError(400, "Invalid document details."); }
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Invalid document details.");
      const fields = req.method === "PATCH" ? metadata(body) : null;
      const result = transaction(db, () => {
        const actor = authenticate(req); administrator(actor);
        const row = document(); revision(body, row);
        if (fields) {
          sharing(body, row.visibility === "admin" && fields.visibility === "members");
          db.prepare("UPDATE documents SET title=?,description=?,visibility=?,updated_at=?,revision=revision+1 WHERE id=?")
            .run(fields.title, fields.description, fields.visibility, new Date().toISOString(), id);
          audit(actor, "edit", id, row.visibility, fields.visibility);
          return { document: db.prepare(`SELECT ${columns} FROM documents WHERE id=?`).get(id) };
        }
        if (body.confirm !== true) throw new HttpError(400, "Confirm document deletion first.");
        db.prepare("DELETE FROM documents WHERE id=?").run(id);
        audit(actor, "delete", id, row.visibility, null);
        return { ok: true };
      });
      return reply(200, result);
    }
    throw new HttpError(405, "Method not allowed.");
  };
}
