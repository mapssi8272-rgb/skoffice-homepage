// 네이버 블로그 최근 글을 가져와 홈페이지 "블로그 소식" 칸에 쓸 파일을 만든다.
//
//   node scripts/fetch-blog.mjs
//
// 만드는 것
//   - blog-posts.js        : 최근 글 목록 (제목, 날짜, 글 주소, 사진 경로)
//   - images/blog/*.jpg    : 글마다 대표 사진 한 장 (네이버 사진은 다른 사이트에서 바로 띄우면 막히는 일이 있어 내려받아 둔다)
// 목록이 바뀌지 않았으면 파일을 건드리지 않는다.
// Node.js 18 이상이면 따로 설치할 것 없이 돌아간다.

import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BLOG_ID = 'mapssi8274';
const COUNT = 6;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_JS = path.join(ROOT, 'blog-posts.js');
const IMG_DIR = path.join(ROOT, 'images', 'blog');
const RSS_URL = `https://rss.blog.naver.com/${BLOG_ID}.xml`;
const UA = 'Mozilla/5.0 (compatible; skoffice-homepage-blog-fetch)';

function cdata(s) {
  return (s ?? '').replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim();
}
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? cdata(m[1]) : '';
}
function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}
function kstDate(pubDate) {
  const d = new Date(pubDate);
  if (Number.isNaN(d.getTime())) return '';
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${k.getUTCFullYear()}.${p(k.getUTCMonth() + 1)}.${p(k.getUTCDate())}`;
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

async function downloadImage(url, file) {
  // 홈페이지 카드에 맞게 큰 사진(가로 400)으로 받는다
  const big = url.replace(/([?&])type=[^&]*/, '$1type=w400');
  for (const u of [big, url]) {
    try {
      const res = await fetch(u, { headers: { 'User-Agent': UA, Referer: 'https://blog.naver.com/' } });
      const type = res.headers.get('content-type') || '';
      if (!res.ok || !type.startsWith('image/')) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 500) continue;
      await writeFile(file, buf);
      return true;
    } catch { /* 다음 주소로 */ }
  }
  return false;
}

async function main() {
  const xml = await fetchText(RSS_URL);
  const blogTitle = decodeEntities(tag(xml.split('<item>')[0], 'title'));
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, COUNT).map((m) => m[1]);
  if (items.length === 0) throw new Error('블로그 글을 하나도 찾지 못했습니다. 블로그가 공개 상태인지 확인하세요.');

  await mkdir(IMG_DIR, { recursive: true });
  const posts = [];
  for (const it of items) {
    const guid = tag(it, 'guid') || tag(it, 'link');
    const logNo = (guid.match(/(\d{6,})/) || [])[1];
    if (!logNo) continue;
    const link = `https://blog.naver.com/${BLOG_ID}/${logNo}`;
    const title = decodeEntities(tag(it, 'title')).replace(/\s+/g, ' ');
    const date = kstDate(tag(it, 'pubDate'));
    const imgSrc = (tag(it, 'description').match(/<img[^>]+src="([^"]+)"/) || [])[1];

    let image = null;
    const file = path.join(IMG_DIR, `${logNo}.jpg`);
    if (existsSync(file)) image = `images/blog/${logNo}.jpg`;
    else if (imgSrc && (await downloadImage(decodeEntities(imgSrc), file))) image = `images/blog/${logNo}.jpg`;

    posts.push({ title, date, link, image });
  }

  // 목록에서 빠진 글의 사진은 지운다
  const keep = new Set(posts.filter((p) => p.image).map((p) => path.basename(p.image)));
  for (const f of await readdir(IMG_DIR)) {
    if (!keep.has(f)) await unlink(path.join(IMG_DIR, f));
  }

  const data = { blog: { title: blogTitle, url: `https://blog.naver.com/${BLOG_ID}` }, posts };
  const js =
    '// 이 파일은 scripts/fetch-blog.mjs 가 자동으로 만듭니다. 직접 고치지 마세요.\n' +
    `window.BLOG_POSTS = ${JSON.stringify(data, null, 2)};\n`;
  const old = existsSync(OUT_JS) ? await readFile(OUT_JS, 'utf8') : '';
  if (old === js) {
    console.log(`바뀐 것 없음 (글 ${posts.length}개)`);
  } else {
    await writeFile(OUT_JS, js, 'utf8');
    console.log(`blog-posts.js 를 새로 만들었습니다 (글 ${posts.length}개)`);
  }
  for (const p of posts) console.log(`  ${p.date}  ${p.image ? '사진O' : '사진X'}  ${p.title}`);
}

main().catch((e) => {
  console.error('블로그 글을 가져오지 못했습니다:', e.message);
  process.exit(1);
});
