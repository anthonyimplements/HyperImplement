# Blog

Plain HTML for the HyperImplement blog. GitHub Pages serves this folder at `/blog`. There is no build step and no CMS. Publishing `main` is what puts a new article on hyperimplement.com.

## Add an article

1. Copy `_template.html` to a new file in this folder. Name it with lowercase words and hyphens, for example `ai-ugc-ads-for-shopify.html`. A file that starts with `_` is not published.
2. Replace every `TODO_` value: the title, the description, the date, the canonical URL, the share image, and the article text. Keep a single `h1`. Give each `h2` an `id`, and list those ids in the table of contents.
3. Add a card for the new file in `index.html`.
4. Add the article URL to `sitemap.xml` in this folder, and to `sitemap.xml` in the site root.
5. Add an `<item>` to `feed.xml`.
6. Save a 1200×630 share image as `og/your-file-name.jpg`. Point `og:image` and `twitter:image` at `https://hyperimplement.com/blog/og/your-file-name.jpg`.

Open the file in a browser before you commit.

To drop in a YouTube video without loading the player up front, add this where the video should appear. Use the 11-character video id. The thumbnail loads with the page. The player loads after a click.

```html
<div class="yt" data-yt="VIDEO_ID" data-title="What the video shows"></div>
```
