# Web security review — semesters branch (sql-console-security-reviewer, opus)

No Critical/High/Medium. 4 Low.

- L1 `/semester` 500s on a non-Latin-1 `next` (`/s/%C5%BC`): Location header can't hold `ż`. Fix: encode the path per segment like `modeTarget` (`enc`). (app/semester/route.ts:22)
- L2 cross-site GET can change a victim's semester filter (same as /mode). Fix: ignore cross-site `Sec-Fetch-Site` before setting the cookie.
- L3 feed mask shows the last 4 characters of the secret token. Fix: host + short sha256 tag instead.
- L4 studies_rw can UPDATE class_sessions.feed_semester / source (integrity only). Fix: column-restrict them like the other link columns.

Checked safe: switcher/cookie parsing, bound parameters everywhere, views-only reads as studies_ro, unitime_feeds absent from every RO/RW grant and from schema/Designer/CSV/audit, logs scrubbed, v_class_sessions doesn't expose feed_semester, caches are user-independent.
