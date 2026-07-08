# Sodalitas

A private digital archive accompanying an NFC membership card. Built with
Eleventy, deployed via GitHub Pages.

## Setup

```
npm install
npm run serve
```

This starts a local dev server with live reload. `npm run build` produces
the final static site in `_site/`.

## Structure

```
src/
  _data/site.json          site-wide constants — title, nav links
  _includes/
    layouts/
      base.njk              HTML shell: head, header, footer, theme script
      page.njk               simple prose pages (Charter, Archive, About…)
      member.njk              the member page template
    partials/
      header.njk              seal mark, wordmark, nav, theme toggle
      footer.njk
  assets/
    css/main.css              all tokens, theme overrides, component styles
    js/theme.js               dark/light toggle logic
    fonts/                    self-hosted font files — see below
  members/
    003-isabelle-marchetti.md  one file per member — front matter only
  index.njk, charter.md, archive.md, expeditions.md, gallery.md, about.md
```

## Adding a member

1. Add their number and public details (`number`, `name`, `memberSince`,
   `role`) to a new file in `src/members/`, copying the front matter
   structure from `003-isabelle-marchetti.md` — but leave out `salt`,
   `iv`, `ciphertext`, and `encrypted`; those get added automatically.
2. Create `private/members-plaintext/<number>/content.json` with their
   real timeline, memories, and personal message (copy the shape from
   `003/content.example.json`).
3. Drop their real photos into
   `private/members-plaintext/<number>/gallery/`.
4. Add their access code to `private/codes.json`.
5. Run `npm run encrypt`.

Only the `.md` file in `src/members/` needs committing afterwards —
everything in `private/` stays on your computer. See
`private/README.md` for the full detail.

## Going live on sodalitas.cc

Correction to an earlier assumption: because this project deploys via a
GitHub Actions workflow rather than publishing straight from a branch,
GitHub **ignores** any `CNAME` file in the repository — the custom domain
has to be set through the repository itself instead. Once the domain is
registered:

1. On GitHub, go to the repository's **Settings → Pages**, and enter
   `sodalitas.cc` under "Custom domain." Save, then wait for the DNS check
   and HTTPS certificate to finish provisioning (can take up to an hour).
2. Configure the DNS records at your registrar as GitHub's own
   instructions specify for an apex domain.
3. In `src/_data/deployment.json`, set `"customDomainActive": true`.
   Commit and push — this is what tells the build to generate links
   without the `/sodalitas/` subpath, since the site now lives at the
   domain root.

## Automatic fallback if the domain lapses

A scheduled workflow (`.github/workflows/domain-watch.yml`) checks
`sodalitas.cc` once a day. If it's unreachable for five consecutive
days — long enough to rule out a temporary DNS hiccup rather than a
genuine lapse — it automatically:

1. Calls GitHub's API to clear the custom domain setting.
2. Sets `customDomainActive` back to `false` in `deployment.json`, which
   makes the next build use the default `github.io/sodalitas/` paths again.
3. Opens an issue in the repository, which triggers GitHub's normal email
   notification to anyone watching it.

This is deliberately one-directional — it will not automatically
reconnect the domain later, even if it starts working again, since
silently re-adopting a domain that may have been re-registered by someone
else would be its own risk. Reconnecting it afterwards is a manual step
(re-enter the domain in Settings → Pages, flip `customDomainActive` back
to `true`, push).

**One-time setup this requires:** a fine-grained Personal Access Token,
scoped only to this repository, with **Pages: read and write** permission,
saved as a repository secret named `PAGES_ADMIN_TOKEN` (Settings →
Secrets and variables → Actions). This is what allows the scheduled check
to actually modify the Pages configuration — the default token GitHub
Actions provides isn't permitted to do that on its own.

You can test the check manually any time via the **Actions** tab →
"Domain health check and automatic fallback" → **Run workflow**, without
waiting for the daily schedule or an actual domain failure.



## Outstanding before going live

1. **Favicon.** A simplified version of the seal mark, sized for 16–32px.
