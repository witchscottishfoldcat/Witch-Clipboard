/**
 * 自检：在真实 Electron 运行时里跑一遍存储层。
 * 用临时 userData 目录，不碰用户真实数据。入口：npm run selftest
 */
import { app, nativeImage } from 'electron'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { classify, makePreview } from '@shared/classify'

let passed = 0
let failed = 0

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name} ${detail}`)
  }
}

export async function runSelfTest(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'ztb-selftest-'))
  app.setPath('userData', dir)
  await app.whenReady()

  console.log(`\nZTB 自检 · 临时数据目录 ${dir}\n`)

  // 动态导入：必须在 setPath 之后，模块里会用到 userData
  const { sealBuffer, openBuffer, sha256, isOsProtected } = await import('../data/crypto')
  const { SqliteStore } = await import('../data/store-sqlite')
  const blobs = await import('../data/blobs')

  console.log('加密')
  const secret = Buffer.from('剪贴板里可能有很敏感的东西')
  const sealed = sealBuffer(secret)
  check('sealBuffer/openBuffer 往返一致', openBuffer(sealed).equals(secret))
  check('密文不含明文', !sealed.subarray(4).includes(secret))
  check('篡改后解密失败', (() => {
    const bad = Buffer.from(sealed)
    bad[bad.length - 1] ^= 0xff
    try {
      openBuffer(bad)
      return false
    } catch {
      return true
    }
  })())
  check('主密钥受 DPAPI 保护', isOsProtected())

  console.log('\n内容分类')
  check('URL', classify('https://example.com/a?b=1') === 'url')
  check('邮箱', classify('a.b@example.com') === 'email')
  check('颜色', classify('#8b5cf6') === 'color')
  check('Windows 路径', classify('D:\\ADM\\ZTB\\package.json') === 'path')
  check('数字', classify('1234567890') === 'number')
  check('代码', classify('export const a = 1;\nfunction b() {\n  return a\n}') === 'code')
  check('普通中文不误判为代码', classify('今天下午三点开会，讨论剪贴板的保留策略') === 'plain')
  check('摘要取首个非空行', makePreview('\n\n  第一行  内容\n第二行') === '第一行 内容')

  console.log('\n存储')
  const store = new SqliteStore()

  const a = store.add({
    kind: 'text',
    text: '会议要点：剪贴板面板默认 Alt+V 唤出，失焦即收',
    preview: '会议要点：剪贴板面板默认 Alt+V 唤出，失焦即收',
    autoKind: 'plain',
    hash: sha256('item-a'),
    blobName: null,
    thumb: null,
    width: null,
    height: null,
    bytes: 60,
    sourceApp: 'test.exe',
  })
  check('新增返回 created', a.created)

  const again = store.add({
    kind: 'text',
    text: '会议要点：剪贴板面板默认 Alt+V 唤出，失焦即收',
    preview: '会议要点：剪贴板面板默认 Alt+V 唤出，失焦即收',
    autoKind: 'plain',
    hash: sha256('item-a'),
    blobName: null,
    thumb: null,
    width: null,
    height: null,
    bytes: 60,
    sourceApp: 'test.exe',
  })
  check('同内容去重（hash 命中）', !again.created && again.id === a.id)
  check('去重后总数仍为 1', store.stats().total === 1)
  check('去重会累加使用次数', (store.get(a.id)?.useCount ?? 0) >= 1)

  console.log('\n搜索')
  check('三字中文走 FTS5 trigram', store.list({ q: '剪贴板' }).total === 1)
  check('两字中文走 LIKE 回退', store.list({ q: '会议' }).total === 1)
  check('ASCII 混排', store.list({ q: 'Alt+V' }).total === 1)
  check('无关键词返回全部', store.list({ q: '' }).total === 1)
  check('搜不到的词返回 0', store.list({ q: '不存在的内容xyz' }).total === 0)
  check('含引号的关键词不炸', (() => {
    try {
      store.list({ q: 'a"b"c' })
      return true
    } catch {
      return false
    }
  })())
  check('LIKE 通配符被转义', store.list({ q: '%' }).total === 0)

  console.log('\n标签')
  store.setTags(a.id, ['工作', '会议', '工作'])
  const tagged = store.get(a.id)
  check('标签去重后写入', tagged?.tags.length === 2)
  check('标签能被列出', store.tags().includes('会议'))
  check('按标签筛选', store.list({ tag: '工作' }).total === 1)
  check('筛选不存在的标签为空', store.list({ tag: '不存在' }).total === 0)
  store.setTags(a.id, [])
  check('清空标签后不再出现在标签列表', !store.tags().includes('会议'))

  console.log('\n图片')
  const png = nativeImage
    .createFromPath(join(app.getAppPath(), 'resources', 'icon.png'))
    .toPNG()
  const imgHash = sha256(png)
  blobs.put(imgHash, png)
  const img = store.add({
    kind: 'image',
    text: null,
    preview: '图片 256×256',
    autoKind: 'plain',
    hash: imgHash,
    blobName: imgHash,
    thumb: Buffer.from([1, 2, 3]),
    width: 256,
    height: 256,
    bytes: png.byteLength,
    sourceApp: null,
  })
  check('图片入库', img.created)
  check('原图解密后与写入一致', store.imagePng(img.id)?.equals(png) === true)
  check('同图再次写入不重复落盘', blobs.listAll().length === 1)
  check('按 kind 筛选图片', store.list({ kind: 'image' }).total === 1)

  console.log('\n置顶与保留策略')
  store.togglePin(a.id)
  check('置顶生效', store.get(a.id)?.pinned === true)
  check('置顶排在前面', store.list({}).items[0]?.id === a.id)

  for (let i = 0; i < 5; i++) {
    store.add({
      kind: 'text',
      text: `临时条目 ${i}`,
      preview: `临时条目 ${i}`,
      autoKind: 'plain',
      hash: sha256(`tmp-${i}`),
      blobName: null,
      thumb: null,
      width: null,
      height: null,
      bytes: 10,
      sourceApp: null,
    })
  }
  const beforePrune = store.stats().total
  const removed = store.prune({ maxItems: 2, maxDays: 0 })
  const after = store.stats()
  check(`超量清理（${beforePrune} → ${after.total}）`, removed > 0 && after.total === 3)
  check('置顶条目不会被清理', store.get(a.id) !== undefined)
  // 不变量：落盘的 blob 数必须等于仍在库里的图片条目数
  check(
    '清理后 blob 数与图片条目数一致',
    blobs.listAll().length === store.list({ kind: 'image' }).total,
  )

  store.clearAll()
  check('清空后只剩置顶', store.stats().total === 1 && store.stats().pinned === 1)

  console.log('\n删除')
  store.remove(a.id)
  check('删除后为空', store.stats().total === 0)
  check('孤儿 blob 已回收', blobs.listAll().length === 0)

  store.close()
  check('数据库文件存在', existsSync(join(dir, 'ztb.db')))

  console.log(`\n结果：${passed} 通过 / ${failed} 失败\n`)

  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* Windows 上文件句柄可能还没释放，留着让系统清 */
  }

  app.exit(failed === 0 ? 0 : 1)
}
