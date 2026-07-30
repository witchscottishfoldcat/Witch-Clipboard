/**
 * 自检：在真实 Electron 运行时里跑一遍存储层。
 * 用临时 userData 目录，不碰用户真实数据。入口：npm run selftest
 */
import { app, nativeImage } from 'electron'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { classify, makePreview } from '@shared/classify'
import { CrossDeviceService, isSensitiveSyncText } from './cross-device'

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
  const dir = mkdtempSync(join(tmpdir(), 'witchcat-selftest-'))
  app.setPath('userData', dir)
  // 自检不走 bootstrap，得自己挡住「最后一个窗口销毁就退出应用」的默认行为，
  // 否则销毁测试窗口之后进程会在下一个 await 处直接结束，后面的断言全都不会跑
  app.on('window-all-closed', () => {})
  await app.whenReady()

  console.log(`\nWitch Clipboard 自检 · 临时数据目录 ${dir}\n`)

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
  check('API Key', classify('sk-proj-1234567890abcdefghijklmnop') === 'key')
  check('命名 Key', classify('API_KEY=abc123xyz789secret') === 'key')
  check('许可证 Key', classify('ABCD-1234-EFGH-5678') === 'key')
  check('模型名称', classify('gpt-4o-mini') === 'model')
  check('带字段的模型名称', classify('model=claude-3-7-sonnet') === 'model')
  check('邮箱', classify('a.b@example.com') === 'email')
  check('颜色', classify('#8b5cf6') === 'color')
  check('Windows 路径', classify('D:\\ADM\\Witch Clipboard\\package.json') === 'path')
  check('数字', classify('1234567890') === 'number')
  check('代码', classify('export const a = 1;\nfunction b() {\n  return a\n}') === 'code')
  check('普通中文不误判为代码', classify('今天下午三点开会，讨论剪贴板的保留策略') === 'plain')
  check('摘要取首个非空行', makePreview('\n\n  第一行  内容\n第二行') === '第一行 内容')
  check('跨设备拦截单行 Key', isSensitiveSyncText('sk-proj-1234567890abcdefghijklmnop'))
  check('跨设备拦截多行中的 Key', isSensitiveSyncText('账号配置\nAPI_KEY=abc123xyz789secret'))
  check('跨设备拦截密码字段', isSensitiveSyncText('password: hunter2026'))
  check('跨设备允许普通文字', !isSensitiveSyncText('手机和电脑之间发送这段文字'))

  console.log('\n跨设备')
  let phoneText = ''
  const crossDevice = new CrossDeviceService({
    onPhoneText: (text) => {
      phoneText = text
    },
    onStatusChanged: () => {},
  })
  const crossStatus = await crossDevice.start()
  check('局域网服务启动', crossStatus.running && Boolean(crossStatus.url))
  if (crossStatus.url) {
    const pairUrl = new URL(crossStatus.url)
    const loopback = new URL(crossStatus.url)
    loopback.hostname = '127.0.0.1'
    const token = pairUrl.pathname.split('/').pop()
    const page = await fetch(loopback)
    check(
      '手机配对页可访问',
      page.ok && (await page.text()).includes('Witch Clipboard · 跨设备剪贴板'),
    )

    const sent = crossDevice.publishText('从电脑发到手机的测试文字')
    check('电脑文字允许发送', sent.ok)
    const state = await fetch(`http://127.0.0.1:${pairUrl.port}/api/state/${token}`).then((res) =>
      res.json() as Promise<{ latest?: { text?: string } }>,
    )
    check('手机可以收到电脑文字', state.latest?.text === '从电脑发到手机的测试文字')

    const syncPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X2Y7WQAAAABJRU5ErkJggg==',
      'base64',
    )
    const imageSent = crossDevice.publishImage(syncPng, '测试图片')
    check(
      '电脑图片允许发送',
      imageSent.ok,
      `reason=${imageSent.reason ?? 'unknown'}, bytes=${syncPng.byteLength}`,
    )
    const imageState = await fetch(
      `http://127.0.0.1:${pairUrl.port}/api/state/${token}`,
    ).then(
      (res) =>
        res.json() as Promise<{
          latest?: { kind?: string; imageUrl?: string }
        }>,
    )
    const imageResponse = imageState.latest?.imageUrl
      ? await fetch(`http://127.0.0.1:${pairUrl.port}${imageState.latest.imageUrl}`)
      : null
    check(
      '手机可以收到电脑图片',
      imageState.latest?.kind === 'image' &&
        Boolean(imageResponse?.ok) &&
        Boolean(imageResponse && Buffer.from(await imageResponse.arrayBuffer()).equals(syncPng)),
    )

    const phoneResponse = await fetch(`http://127.0.0.1:${pairUrl.port}/api/send/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '从手机发到电脑的测试文字' }),
    })
    check('手机文字允许发送', phoneResponse.ok && phoneText === '从手机发到电脑的测试文字')

    const keyResponse = await fetch(`http://127.0.0.1:${pairUrl.port}/api/send/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'API_KEY=abc123xyz789secret' }),
    })
    check('手机 Key 被拒绝', keyResponse.status === 403)
  }
  const stopped = await crossDevice.stop()
  check('局域网服务关闭', !stopped.running)

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
  check('按来源应用搜索', store.list({ q: 'test.exe' }).items[0]?.id === a.id)
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

  const keyItem = store.add({
    kind: 'text',
    text: 'sk-proj-1234567890abcdefghijklmnop',
    preview: 'sk-proj-1234567890abcdefghijklmnop',
    autoKind: 'key',
    hash: sha256('item-key'),
    blobName: null,
    thumb: null,
    width: null,
    height: null,
    bytes: 36,
    sourceApp: 'test.exe',
  })
  check('按链接类型筛选', store.list({ autoKind: 'url' }).total === 0)
  check('按 Key 类型筛选', store.list({ autoKind: 'key' }).items[0]?.id === keyItem.id)
  const urlItem = store.add({
    kind: 'text',
    text: 'https://api.example.com/v1',
    preview: 'https://api.example.com/v1',
    autoKind: 'url',
    hash: sha256('item-url'),
    blobName: null,
    thumb: null,
    width: null,
    height: null,
    bytes: 26,
    sourceApp: 'test.exe',
  })
  const modelItem = store.add({
    kind: 'text',
    text: 'gpt-4o-mini',
    preview: 'gpt-4o-mini',
    autoKind: 'model',
    hash: sha256('item-model'),
    blobName: null,
    thumb: null,
    width: null,
    height: null,
    bytes: 11,
    sourceApp: 'test.exe',
  })
  const plainItem = store.add({
    kind: 'text',
    text: '47d0a59a9dec164a2cd2e01cc92f1601',
    preview: '47d0a59a9dec164a2cd2e01cc92f1601',
    autoKind: 'plain',
    hash: sha256('item-plain-config'),
    blobName: null,
    thumb: null,
    width: null,
    height: null,
    bytes: 32,
    sourceApp: 'test.exe',
  })
  const relatedIds = new Set(store.related(plainItem.id).map((item) => item.id))
  check('普通文字也能触发时间关联', relatedIds.has(keyItem.id))
  check('关联检索找到 URL', relatedIds.has(urlItem.id))
  check('关联检索找到模型', relatedIds.has(modelItem.id))
  check('关联结果上限为 5 条', store.related(plainItem.id, 99).length <= 5)
  check('按模型类型筛选', store.list({ autoKind: 'model' }).items[0]?.id === modelItem.id)
  store.remove(keyItem.id)
  store.remove(urlItem.id)
  store.remove(modelItem.id)
  store.remove(plainItem.id)

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
  check('数据库文件存在', existsSync(join(dir, 'clipboard.db')))

  // CF_HDROP 的写入是手搓 DROPFILES 结构体 + GlobalAlloc，最容易出错，做一次真实往返。
  // 注意：这一步会覆盖系统剪贴板，跑完会把原来的文本放回去。
  console.log('\n剪贴板文件列表（CF_HDROP）')
  const win32 = await import('./win32')
  const { clipboard } = await import('electron')
  if (!win32.hasNative()) {
    console.log('  - 原生能力不可用，跳过')
  } else {
    const before = clipboard.readText()
    const probe = [join(app.getAppPath(), 'resources', 'icon.png'), join(dir, 'clipboard.db')]

    check('写入文件列表', win32.writeClipboardFiles(probe))
    const readBack = win32.readClipboardFiles()
    check('读回的路径与写入一致', JSON.stringify(readBack) === JSON.stringify(probe), String(readBack))

    clipboard.writeText(before)
    check('写文本后不再报告文件列表', win32.readClipboardFiles() === null)
  }

  // 托盘单击的关键竞态：点托盘时面板会先因失焦收起，紧接着才收到 click 事件。
  // 没有冷却判断的话，用户点托盘想收起面板，面板会立刻又弹回来。
  console.log('\n面板与托盘单击')
  const { createPanel, showPanel, hidePanel, toggleFromTray, hiddenRecently } = await import(
    './window'
  )
  const win = createPanel()
  showPanel()
  check('showPanel 后可见', win.isVisible())
  check('刚显示时不在冷却期', !hiddenRecently())

  hidePanel()
  check('hidePanel 后不可见', !win.isVisible())
  check('刚隐藏后处于冷却期', hiddenRecently())

  toggleFromTray()
  check('失焦刚收起时，托盘那一下点击不会又把面板弹回来', !win.isVisible())

  await new Promise((r) => setTimeout(r, 450))
  check('冷却期过后不再抑制', !hiddenRecently())

  toggleFromTray()
  await new Promise((r) => setTimeout(r, 200))
  check('冷却后托盘点击能弹出面板', win.isVisible(), `isVisible=${win.isVisible()}`)

  toggleFromTray()
  await new Promise((r) => setTimeout(r, 200))
  check('面板可见时托盘点击收起面板', !win.isVisible(), `isVisible=${win.isVisible()}`)
  win.destroy()

  // 自动更新：不能自动下载、不能逼着更新、说过「暂不」就别再提同一个版本
  console.log('\n自动更新')
  process.env['WCC_FAKE_UPDATE'] = '99.0.0'
  const updater = await import('./updater')
  const { getSettings: readSettings, saveSettings: writeSettings } = await import('./settings')
  writeSettings({ skippedVersion: null })

  const first = await updater.checkForUpdate(false)
  check('查到新版本', first.state === 'available' && first.version === '99.0.0', JSON.stringify(first))
  check('检查完不会自动开始下载', first.state !== 'downloading' && first.percent === undefined)

  updater.skipVersion('99.0.0')
  check('「暂不更新」会记住版本号', readSettings().skippedVersion === '99.0.0')
  check('「暂不更新」后状态回到 idle', updater.currentStatus().state === 'idle')

  const silent = await updater.checkForUpdate(true)
  check('启动时的自动检查不再提示被跳过的版本', silent.state === 'idle', JSON.stringify(silent))

  const manual = await updater.checkForUpdate(false)
  check('手动检查仍然如实报告有新版本', manual.state === 'available')

  const downloaded = await updater.downloadUpdate()
  check('下载后进入可安装状态', downloaded.state === 'ready')
  updater.installUpdate() // 假更新下不会真的重启
  check('假更新调用安装不会退出进程', true)

  writeSettings({ skippedVersion: null })
  delete process.env['WCC_FAKE_UPDATE']

  // 「点到别处就收起」：注入假的前台 pid，把三种情况都测掉
  console.log('\n点到别处自动收起')
  const { watchOutsideClick } = await import('./dismiss')
  const SELF = 1000
  const OTHER = 2000

  const scenario = async (
    name: string,
    pids: (number | null)[],
    expectHidden: boolean,
  ): Promise<void> => {
    let visible = true
    let step = 0
    const target = { isDestroyed: () => false, isVisible: () => visible }
    const stop = watchOutsideClick(
      target,
      () => {
        visible = false
      },
      {
        pollMs: 15,
        graceMs: 40,
        selfPid: SELF,
        force: true,
        getPid: () => pids[Math.min(step++, pids.length - 1)],
      },
    )
    await new Promise((r) => setTimeout(r, 260))
    stop()
    check(name, visible === !expectHidden, `visible=${visible}`)
  }

  // 先拿到前台，用户再切走 → 应该收起
  await scenario('先在前台、之后切到别的进程 → 收起', [SELF, SELF, SELF, OTHER], true)
  // 从头到尾没拿到前台（被 Windows 的前台抢占限制挡住）→ 绝不能自己消失
  await scenario('从来没拿到前台 → 不收起（不会自己消失）', [OTHER], false)
  // 原生能力不可用 → 不做判定，交给 blur
  await scenario('拿不到前台进程信息 → 不收起', [null], false)
  // 自己的另一个窗口在前台（迷你面板 ↔ 完整面板）→ 不收起
  await scenario('自己的窗口在前台 → 不收起', [SELF], false)

  // 窗口已经隐藏时看门狗要自己停掉，不能空转
  let ticks = 0
  const stopIdle = watchOutsideClick(
    { isDestroyed: () => false, isVisible: () => false },
    () => {},
    { pollMs: 15, graceMs: 0, selfPid: SELF, force: true, getPid: () => ++ticks && OTHER },
  )
  await new Promise((r) => setTimeout(r, 120))
  stopIdle()
  check('窗口已隐藏时看门狗自动停止', ticks === 0, `ticks=${ticks}`)

  // 退出流程必须放最后：markQuitting() 是不可逆的全局状态
  console.log('\n退出流程')
  const { createPanel: makePanel, markQuitting } = await import('./window')
  const { createMini: makeMini } = await import('./mini')

  const panelWin = makePanel()
  const miniWin = makeMini()
  panelWin.close()
  miniWin.close()
  await new Promise((r) => setTimeout(r, 150))
  check('退出前：完整面板点关闭只隐藏、不销毁', !panelWin.isDestroyed())
  check('退出前：迷你面板点关闭只隐藏、不销毁', !miniWin.isDestroyed())

  markQuitting()
  panelWin.close()
  miniWin.close()
  await new Promise((r) => setTimeout(r, 250))
  check('退出时：完整面板放行关闭', panelWin.isDestroyed())
  // 少了这条判断，app.quit() 会被迷你面板一直否决，应用只能上任务管理器杀
  check('退出时：迷你面板放行关闭', miniWin.isDestroyed())

  console.log(`\n结果：${passed} 通过 / ${failed} 失败\n`)

  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* Windows 上文件句柄可能还没释放，留着让系统清 */
  }

  app.exit(failed === 0 ? 0 : 1)
}
