import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { hostname, networkInterfaces } from 'node:os'
import { classify, makePreview } from '@shared/classify'
import type {
  CrossDeviceSendResult,
  CrossDeviceStatus,
} from '@shared/types'

const MAX_TEXT_BYTES = 100_000
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const CONNECTED_WINDOW_MS = 5_000

interface SharedItem {
  revision: number
  kind: 'text' | 'image'
  text: string | null
  image: Buffer | null
  preview: string
  sentAt: number
  source: 'desktop' | 'phone'
}

interface CrossDeviceDeps {
  onPhoneText(text: string): void
  onStatusChanged(): void
}

export class CrossDeviceService {
  private server: Server | null = null
  private token: string | null = null
  private port: number | null = null
  private address: string | null = null
  private lastSeenAt: number | null = null
  private latest: SharedItem | null = null
  private revision = 0

  constructor(private readonly deps: CrossDeviceDeps) {}

  async start(): Promise<CrossDeviceStatus> {
    if (this.server) return this.status()

    this.token = randomBytes(24).toString('hex')
    this.address = preferredLanAddress()
    if (!this.address) {
      this.token = null
      throw new Error('没有检测到可用的局域网 IPv4 地址')
    }
    const server = createServer((req, res) => this.handle(req, res))
    this.server = server

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => reject(error)
        server.once('error', onError)
        server.listen(0, '0.0.0.0', () => {
          server.off('error', onError)
          resolve()
        })
      })
      const info = server.address()
      if (!info || typeof info === 'string') throw new Error('无法取得跨设备服务端口')
      this.port = info.port
      this.deps.onStatusChanged()
      return this.status()
    } catch (error) {
      this.server = null
      this.token = null
      this.port = null
      this.address = null
      throw error
    }
  }

  async stop(): Promise<CrossDeviceStatus> {
    const server = this.server
    this.server = null
    this.token = null
    this.port = null
    this.address = null
    this.lastSeenAt = null
    this.latest = null
    this.revision = 0

    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    this.deps.onStatusChanged()
    return this.status()
  }

  status(): CrossDeviceStatus {
    const running = Boolean(this.server?.listening && this.token && this.port)
    const url =
      running && this.address && this.port && this.token
        ? `http://${this.address}:${this.port}/pair/${this.token}`
        : null
    return {
      running,
      url,
      pairCode: running && this.token ? this.token.slice(-6).toUpperCase() : null,
      connected:
        running &&
        this.lastSeenAt !== null &&
        Date.now() - this.lastSeenAt < CONNECTED_WINDOW_MS,
      lastSeenAt: this.lastSeenAt,
      lastSentAt: this.latest?.sentAt ?? null,
      lastSentPreview: this.latest?.preview ?? null,
    }
  }

  publishText(text: string, source: 'desktop' | 'phone' = 'desktop'): CrossDeviceSendResult {
    if (!this.server?.listening) return { ok: false, reason: 'not-running' }
    if (isSensitiveSyncText(text)) return { ok: false, reason: 'sensitive' }
    if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) {
      return { ok: false, reason: 'too-large' }
    }
    if (this.latest?.kind === 'text' && this.latest.text === text && this.latest.source === source) {
      return { ok: true }
    }

    this.latest = {
      revision: ++this.revision,
      kind: 'text',
      text,
      image: null,
      preview: makePreview(text),
      sentAt: Date.now(),
      source,
    }
    this.deps.onStatusChanged()
    return { ok: true }
  }

  publishImage(
    png: Buffer,
    preview = '剪贴板图片',
    source: 'desktop' | 'phone' = 'desktop',
  ): CrossDeviceSendResult {
    if (!this.server?.listening) return { ok: false, reason: 'not-running' }
    if (png.byteLength === 0 || png.byteLength > MAX_IMAGE_BYTES) {
      return { ok: false, reason: 'too-large' }
    }
    if (
      this.latest?.kind === 'image' &&
      this.latest.image?.equals(png) &&
      this.latest.source === source
    ) {
      return { ok: true }
    }
    this.latest = {
      revision: ++this.revision,
      kind: 'image',
      text: null,
      image: Buffer.from(png),
      preview,
      sentAt: Date.now(),
      source,
    }
    this.deps.onStatusChanged()
    return { ok: true }
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    applySecurityHeaders(res)
    const requestUrl = new URL(req.url ?? '/', 'http://localhost')
    const token = this.token
    if (!token || !constantTimeTextEqual(requestUrl.pathname.split('/').pop() ?? '', token)) {
      respondText(res, 404, '配对已失效，请回到电脑重新生成二维码。')
      return
    }

    if (req.method === 'GET' && requestUrl.pathname.startsWith('/pair/')) {
      respondHtml(res, mobilePage(hostname(), token.slice(-6).toUpperCase()))
      return
    }

    if (req.method === 'GET' && requestUrl.pathname.startsWith('/api/state/')) {
      const wasConnected = this.status().connected
      this.lastSeenAt = Date.now()
      if (!wasConnected) this.deps.onStatusChanged()
      respondJson(res, 200, {
        ok: true,
        pairCode: token.slice(-6).toUpperCase(),
        latest: this.latest
          ? {
              revision: this.latest.revision,
              kind: this.latest.kind,
              text: this.latest.text,
              preview: this.latest.preview,
              sentAt: this.latest.sentAt,
              source: this.latest.source,
              imageUrl:
                this.latest.kind === 'image'
                  ? `/api/image/${token}?revision=${this.latest.revision}`
                  : null,
            }
          : null,
      })
      return
    }

    if (req.method === 'GET' && requestUrl.pathname.startsWith('/api/image/')) {
      const requestedRevision = Number(requestUrl.searchParams.get('revision'))
      if (
        this.latest?.kind !== 'image' ||
        !this.latest.image ||
        requestedRevision !== this.latest.revision
      ) {
        respondText(res, 404, '图片已经失效')
        return
      }
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': this.latest.image.byteLength,
        'Content-Disposition': 'inline; filename="witchcat-clipboard.png"',
      })
      res.end(this.latest.image)
      return
    }

    if (req.method === 'POST' && requestUrl.pathname.startsWith('/api/send/')) {
      void this.readPhoneText(req, res)
      return
    }

    respondText(res, 404, 'Not found')
  }

  private async readPhoneText(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await readBody(req, MAX_TEXT_BYTES + 1_024)
      const payload = JSON.parse(body) as { text?: unknown }
      const text = typeof payload.text === 'string' ? payload.text : ''
      if (!text.trim()) {
        respondJson(res, 400, { ok: false, reason: 'empty' })
        return
      }
      const result = this.publishText(text, 'phone')
      if (!result.ok) {
        respondJson(res, result.reason === 'sensitive' ? 403 : 413, result)
        return
      }
      this.lastSeenAt = Date.now()
      this.deps.onPhoneText(text)
      respondJson(res, 200, { ok: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      respondJson(res, message === 'payload-too-large' ? 413 : 400, {
        ok: false,
        reason: message === 'payload-too-large' ? 'too-large' : 'invalid',
      })
    }
  }
}

export function isSensitiveSyncText(text: string): boolean {
  if (classify(text) === 'key') return true
  if (/(?:password|passwd|pwd|密码)\s*[:=：]\s*\S{4,}/i.test(text)) return true
  return text.split(/\r?\n/).some((line) => classify(line) === 'key')
}

function preferredLanAddress(): string | null {
  const candidates: { address: string; score: number }[] = []
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    for (const info of addresses ?? []) {
      if (info.family !== 'IPv4' || info.internal || !isPrivateIpv4(info.address)) continue
      let score = 0
      if (/wi-?fi|wlan|ethernet|以太网/i.test(name)) score += 50
      if (/virtual|vmware|vethernet|wsl|hyper-v|tailscale|loopback/i.test(name)) score -= 100
      if (info.address.startsWith('192.168.')) score += 20
      else if (info.address.startsWith('10.')) score += 10
      else score += 5
      candidates.push({ address: info.address, score })
    }
  }
  return candidates.sort((a, b) => b.score - a.score)[0]?.address ?? null
}

function isPrivateIpv4(address: string): boolean {
  if (/^10\./.test(address) || /^192\.168\./.test(address)) return true
  const match = /^172\.(\d+)\./.exec(address)
  if (!match) return false
  const second = Number(match[1])
  return second >= 16 && second <= 31
}

function constantTimeTextEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let mismatch = 0
  for (let i = 0; i < left.length; i++) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i)
  return mismatch === 0
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.byteLength
    if (bytes > maxBytes) throw new Error('payload-too-large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function applySecurityHeaders(res: ServerResponse): void {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
  )
}

function respondJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

function respondText(res: ServerResponse, status: number, value: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end(value)
}

function respondHtml(res: ServerResponse, value: string): void {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(value)
}

function mobilePage(computerName: string, pairCode: string): string {
  const safeComputer = escapeHtml(computerName)
  const safeCode = escapeHtml(pairCode)
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#203638">
  <title>Witch Clipboard · 跨设备剪贴板</title>
  <style>
    :root{color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;overflow-x:hidden;background:linear-gradient(145deg,#dce9e7 0%,#edf1ef 44%,#d7e1e4 100%);color:#172326}
    body:before,body:after{content:"";position:fixed;border-radius:999px;filter:blur(4px);pointer-events:none}
    body:before{width:270px;height:270px;right:-90px;top:-70px;background:linear-gradient(145deg,#91c6c0aa,#e8f4f1aa)}
    body:after{width:230px;height:230px;left:-100px;bottom:6%;background:linear-gradient(145deg,#9db9c3aa,#e3ecee88)}
    main{position:relative;z-index:1;width:min(100%,460px);margin:auto;padding:30px 18px 42px}
    .brand{margin:6px 4px 22px}.eyebrow{font-size:10px;font-weight:750;letter-spacing:.18em;color:#52706f;margin-bottom:6px}
    h1{font-size:25px;line-height:1.15;letter-spacing:-.03em;margin:0}.sub{font-size:12px;color:#657577;margin-top:8px}
    .dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#2f9b83;box-shadow:0 0 0 4px #2f9b8318;margin-right:8px}
    .card{background:#ffffff70;border:1px solid #ffffffa8;border-radius:24px;padding:18px;margin:14px 0;box-shadow:0 20px 55px #31484918,inset 0 1px 0 #ffffffb8;backdrop-filter:blur(26px) saturate(135%);-webkit-backdrop-filter:blur(26px) saturate(135%)}
    .label{font-size:11px;font-weight:700;letter-spacing:.08em;color:#617173;margin-bottom:11px}.content{min-height:104px;white-space:pre-wrap;word-break:break-word;font-size:16px;line-height:1.6;color:#162326}.received-image{display:block;width:100%;max-height:300px;object-fit:contain;border-radius:16px;background:#ffffff55;box-shadow:inset 0 0 0 1px #ffffff88}
    textarea{width:100%;min-height:116px;resize:vertical;border:1px solid #ffffffb5;border-radius:16px;padding:14px;font:inherit;color:#162326;outline:none;background:#ffffff68;box-shadow:inset 0 1px 4px #3348490b}
    textarea::placeholder{color:#849193}textarea:focus{border-color:#76a5a0;box-shadow:0 0 0 3px #4a8b8418;background:#ffffff88}
    button{width:100%;height:47px;border:1px solid #ffffff35;border-radius:15px;background:#203638;color:#fff;font-size:14px;font-weight:700;margin-top:13px;box-shadow:0 10px 26px #20363826;transition:transform .15s,background .15s}
    button:active{transform:scale(.985);background:#16292b}.meta{font-size:11px;color:#728184;margin-top:10px}
    .notice{font-size:11px;line-height:1.65;color:#68787a;text-align:center;padding:6px 20px}.toast{position:fixed;z-index:3;left:50%;bottom:24px;transform:translateX(-50%) translateY(20px);opacity:0;background:#17292be8;color:#fff;padding:11px 17px;border:1px solid #ffffff30;box-shadow:0 12px 36px #23363835;backdrop-filter:blur(18px);border-radius:999px;font-size:13px;transition:.2s;pointer-events:none}.toast.on{opacity:1;transform:translateX(-50%)}
    @media(prefers-color-scheme:dark){body{background:linear-gradient(145deg,#142224,#1c292b 48%,#182729);color:#eef5f4}body:before{background:#366b6770}body:after{background:#3d596570}.card{background:#ffffff12;border-color:#ffffff20;box-shadow:0 22px 60px #0005,inset 0 1px 0 #ffffff16}.eyebrow{color:#8cb7b2}h1,.content{color:#edf5f4}.sub,.label,.meta,.notice{color:#9eafaf}textarea{background:#ffffff10;border-color:#ffffff1c;color:#eff6f5}textarea:focus{background:#ffffff17;border-color:#679d97}textarea::placeholder{color:#829190}button{background:#dbe9e7;color:#172729;border-color:#fff8}}
  </style>
</head>
<body>
  <main>
    <header class="brand"><div class="eyebrow">WITCHCAT CONNECT</div><h1>跨设备剪贴板</h1><div class="sub"><span class="dot"></span>已连接 ${safeComputer} · 配对码 ${safeCode}</div></header>
    <section class="card">
      <div class="label">来自电脑</div>
      <div id="received" class="content">等待电脑发送文字、链接或图片…</div>
      <button id="copy">复制到手机</button>
      <div id="receivedMeta" class="meta">保持页面打开即可自动接收</div>
    </section>
    <section class="card">
      <div class="label">发送到电脑</div>
      <textarea id="outgoing" placeholder="在这里长按粘贴或输入文字"></textarea>
      <button id="send">发送并写入电脑剪贴板</button>
    </section>
    <div class="notice">仅在当前 Wi‑Fi 内传输；Key、Token 和密码默认拒绝发送。关闭电脑端跨设备功能后，本地址立即失效。</div>
  </main>
  <div id="toast" class="toast"></div>
  <script>
    const token = location.pathname.split('/').pop();
    const received = document.getElementById('received');
    const receivedMeta = document.getElementById('receivedMeta');
    const outgoing = document.getElementById('outgoing');
    const copyButton = document.getElementById('copy');
    let latestText = '';
    let latestKind = 'text';
    let latestImageUrl = '';
    let revision = -1;
    let toastTimer;
    function toast(text){const el=document.getElementById('toast');el.textContent=text;el.classList.add('on');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('on'),1800)}
    async function poll(){
      try{
        const res=await fetch('/api/state/'+token,{cache:'no-store'});
        if(!res.ok)throw new Error();
        const data=await res.json();
        if(data.latest&&data.latest.revision!==revision){
          revision=data.latest.revision;latestKind=data.latest.kind||'text';latestText=data.latest.text||'';latestImageUrl=data.latest.imageUrl||'';
          if(latestKind==='image'){
            const img=document.createElement('img');img.src=latestImageUrl;img.alt='来自电脑的剪贴板图片';img.className='received-image';
            received.replaceChildren(img);copyButton.textContent='打开或保存图片';
          }else{
            received.textContent=latestText;copyButton.textContent='复制到手机';
          }
          receivedMeta.textContent=(data.latest.source==='phone'?'已发送到电脑':'电脑刚刚发送')+' · '+new Date(data.latest.sentAt).toLocaleTimeString();
        }
      }catch{receivedMeta.textContent='连接已断开，请回到电脑重新配对'}
      setTimeout(poll,1200);
    }
    document.getElementById('copy').onclick=async()=>{
      if(latestKind==='image'){
        if(!latestImageUrl){toast('图片已经失效');return}
        const link=document.createElement('a');link.href=latestImageUrl;link.download='witchcat-clipboard.png';link.target='_blank';document.body.appendChild(link);link.click();link.remove();
        toast('已打开图片，也可以长按图片保存');return
      }
      if(!latestText){toast('还没有收到内容');return}
      try{
        if(navigator.clipboard&&window.isSecureContext)await navigator.clipboard.writeText(latestText);
        else{const box=document.createElement('textarea');box.value=latestText;box.style.position='fixed';box.style.opacity='0';document.body.appendChild(box);box.select();document.execCommand('copy');box.remove()}
        toast('已复制到手机剪贴板');
      }catch{toast('请长按上方文字手动复制')}
    };
    document.getElementById('send').onclick=async()=>{
      const text=outgoing.value.trim();if(!text){toast('请先粘贴或输入内容');return}
      try{
        const res=await fetch('/api/send/'+token,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
        const data=await res.json();
        if(res.status===403)toast('Key 或 Token 已被安全拦截');
        else if(!res.ok)toast('发送失败，请稍后重试');
        else{outgoing.value='';toast('已发送到电脑剪贴板')}
      }catch{toast('连接已断开')}
    };
    poll();
  </script>
</body>
</html>`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }
    return entities[char]
  })
}
