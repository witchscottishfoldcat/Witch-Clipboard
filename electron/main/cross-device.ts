import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { hostname, networkInterfaces } from 'node:os'
import { classify, makePreview } from '@shared/classify'
import type {
  CrossDeviceSendResult,
  CrossDeviceStatus,
} from '@shared/types'

const MAX_TEXT_BYTES = 100_000
const CONNECTED_WINDOW_MS = 5_000

interface SharedItem {
  revision: number
  text: string
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
    if (this.latest?.text === text && this.latest.source === source) return { ok: true }

    this.latest = {
      revision: ++this.revision,
      text,
      preview: makePreview(text),
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
        latest: this.latest,
      })
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
  <meta name="theme-color" content="#7c3aed">
  <title>WitchCat 跨设备剪贴板</title>
  <style>
    :root{color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:linear-gradient(155deg,#f4f0ff,#fff 45%,#f7f4ff);color:#201a2c}
    main{width:min(100%,460px);margin:auto;padding:24px 18px 40px}.brand{display:flex;align-items:center;gap:12px;margin:8px 0 24px}
    .logo{display:grid;place-items:center;width:44px;height:44px;border-radius:14px;background:#7c3aed;color:#fff;font-size:24px;box-shadow:0 10px 28px #7c3aed45}
    h1{font-size:20px;margin:0}.sub{font-size:12px;color:#756d82;margin-top:3px}.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#22c55e;margin-right:6px}
    .card{background:#ffffffdd;border:1px solid #7c3aed18;border-radius:20px;padding:18px;margin:14px 0;box-shadow:0 16px 40px #4c1d9512}
    .label{font-size:12px;color:#766d83;margin-bottom:9px}.content{min-height:94px;white-space:pre-wrap;word-break:break-word;font-size:16px;line-height:1.55}
    textarea{width:100%;min-height:110px;resize:vertical;border:1px solid #ded8e8;border-radius:14px;padding:13px;font:inherit;outline:none;background:#fff}
    textarea:focus{border-color:#8b5cf6;box-shadow:0 0 0 3px #8b5cf622}
    button{width:100%;height:46px;border:0;border-radius:14px;background:#7c3aed;color:#fff;font-size:15px;font-weight:650;margin-top:12px}
    button:active{transform:scale(.985)}button.secondary{background:#eee9f7;color:#5b4774}.meta{font-size:11px;color:#9990a5;margin-top:10px}
    .notice{font-size:12px;line-height:1.6;color:#766d83;text-align:center;padding:4px 20px}.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(20px);opacity:0;background:#21182d;color:#fff;padding:10px 16px;border-radius:999px;font-size:13px;transition:.2s;pointer-events:none}.toast.on{opacity:1;transform:translateX(-50%)}
  </style>
</head>
<body>
  <main>
    <div class="brand"><div class="logo">🐱</div><div><h1>WitchCat 跨设备剪贴板</h1><div class="sub"><span class="dot"></span>已连接 ${safeComputer} · 配对码 ${safeCode}</div></div></div>
    <section class="card">
      <div class="label">来自电脑</div>
      <div id="received" class="content">等待电脑复制文字或链接…</div>
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
    let latestText = '';
    let revision = -1;
    let toastTimer;
    function toast(text){const el=document.getElementById('toast');el.textContent=text;el.classList.add('on');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('on'),1800)}
    async function poll(){
      try{
        const res=await fetch('/api/state/'+token,{cache:'no-store'});
        if(!res.ok)throw new Error();
        const data=await res.json();
        if(data.latest&&data.latest.revision!==revision){
          revision=data.latest.revision;latestText=data.latest.text;received.textContent=latestText;
          receivedMeta.textContent=(data.latest.source==='phone'?'已发送到电脑':'电脑刚刚发送')+' · '+new Date(data.latest.sentAt).toLocaleTimeString();
        }
      }catch{receivedMeta.textContent='连接已断开，请回到电脑重新配对'}
      setTimeout(poll,1200);
    }
    document.getElementById('copy').onclick=async()=>{
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
