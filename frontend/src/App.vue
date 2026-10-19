<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'

const inputUrl = ref('')
const isParsing = ref(false)
const errorMsg = ref('')
const parseResult = ref(null)
const parseDuration = ref(0) // 解析用时记录
const activeTab = ref('video') // 'video' | 'copywriting' | 'summary'

// 豆包 API 配置存储
const showSettings = ref(false)
const doubaoApiKey = ref(localStorage.getItem('doubaoApiKey') || '')
const doubaoEndpointId = ref(localStorage.getItem('doubaoEndpointId') || '')
const enableDoubao = ref(localStorage.getItem('enableDoubao') === 'true' || !!localStorage.getItem('doubaoApiKey'))

// ASR 语音识别配置存储
const asrApiKey = ref(localStorage.getItem('asrApiKey') || 'sk-zxvocsyeqoligfhfnkabtdblpfhvnrpznrfofxgvgvubpkxp')
const asrEndpoint = ref(localStorage.getItem('asrEndpoint') || 'https://api.siliconflow.cn/v1')
const asrModel = ref(localStorage.getItem('asrModel') || 'FunAudioLLM/SenseVoiceSmall')
const enableAsr = ref(localStorage.getItem('enableAsr') !== 'false')

// AI 核心总结大模型配置存储
const summaryProvider = ref(localStorage.getItem('summaryProvider') || 'siliconflow') // 'siliconflow' | 'doubao'
const siliconflowLlApiKey = ref(localStorage.getItem('siliconflowLlApiKey') || '')
const siliconflowLlModel = ref(localStorage.getItem('siliconflowLlModel') || 'Qwen/Qwen2.5-7B-Instruct')

// 设置访问密码验证状态
const showPasswordModal = ref(false)
const settingsPassword = ref('')
const passwordErrorMsg = ref('')

// ==================== 登录、账户管理与操作审计状态 ====================
const token = ref(localStorage.getItem('authToken') || '')
const tokenExpireAt = ref(localStorage.getItem('authTokenExpireAt') || '')
const currentUser = ref(null)
const currentPage = ref('main') // 'main' | 'settings' | 'profile' | 'admin' | 'auth'

// 登录与注册表单
const showAuthModal = ref(true)
const authTab = ref('login') // 'login' | 'register'
const loginUsername = ref('')
const loginPassword = ref('')
const regUsername = ref('')
const regPassword = ref('')
const regNickname = ref('')

// 邮箱验证、验证码与图形验证码状态
const captchaText = ref('')
const userCaptchaInput = ref('')
const captchaCanvasRef = ref(null)
const regCode = ref('')
const resetEmail = ref('')
const resetCode = ref('')
const resetPassword = ref('')
const countdown = ref(0)

// 表单校验错误状态提示
const authErrors = ref({
  loginUsername: '',
  loginPassword: '',
  regUsername: '',
  regPassword: '',
  regNickname: '',
  regCaptcha: '',
  regCode: '',
  resetEmail: '',
  resetCaptcha: '',
  resetCode: '',
  resetPassword: ''
})

// SMTP 邮件服务器配置状态 (Admin 专属)
const smtpHost = ref('')
const smtpPort = ref(465)
const smtpSecure = ref(true)
const smtpUser = ref('')
const smtpPass = ref('')
const smtpSenderName = ref('VidFetch')

const fetchSmtpSettings = async () => {
  if (currentUser.value && currentUser.value.role === 'admin') {
    try {
      const res = await fetchWithAuth(`${ENGINE_API_URL}/api/admin/smtp-settings`)
      const data = await res.json()
      if (res.ok && data.success) {
        smtpHost.value = data.smtp.host || ''
        smtpPort.value = data.smtp.port || 465
        smtpSecure.value = data.smtp.secure !== false
        smtpUser.value = data.smtp.user || ''
        smtpPass.value = data.smtp.pass || ''
        smtpSenderName.value = data.smtp.senderName || 'VidFetch'
      }
    } catch (e) {
      console.error('获取 SMTP 配置失败:', e)
    }
  }
}

// 个人简介、邮箱脱敏与修改密码弹框状态
const editBio = ref('')

const maskedEmail = computed(() => {
  if (!currentUser.value) return ''
  const email = currentUser.value.username || ''
  if (!email.includes('@')) return email // 内置非邮箱账号
  const parts = email.split('@')
  const local = parts[0]
  const domain = parts[1]
  if (local.length >= 3) {
    return local.slice(0, 3) + '***@' + domain
  } else {
    return local.slice(0, 1) + '***@' + domain
  }
})

const showChangePasswordModal = ref(false)
const changePwTab = ref('normal') // 'normal' | 'code'

const changePwOld = ref('')
const changePwNew = ref('')
const changePwConfirm = ref('')

const changePwCode = ref('')
const changePwResetNew = ref('')
const changePwResetConfirm = ref('')

const changePwErrors = ref({
  old: '',
  new: '',
  confirm: '',
  code: '',
  resetNew: '',
  resetConfirm: '',
  captcha: ''
})

const isEditingProfile = ref(false)

// 自定义 confirm 模态框状态
const showConfirmModal = ref(false)
const confirmMessage = ref('')
let confirmResolve = null

const triggerConfirm = (message) => {
  confirmMessage.value = message
  showConfirmModal.value = true
  return new Promise((resolve) => {
    confirmResolve = resolve
  })
}

const handleConfirmYes = () => {
  showConfirmModal.value = false
  if (confirmResolve) confirmResolve(true)
}

const handleConfirmNo = () => {
  showConfirmModal.value = false
  if (confirmResolve) confirmResolve(false)
}

const openChangePasswordModal = () => {
  changePwOld.value = ''
  changePwNew.value = ''
  changePwConfirm.value = ''
  changePwCode.value = ''
  changePwResetNew.value = ''
  changePwResetConfirm.value = ''
  userCaptchaInput.value = ''
  
  // Clear all errors
  Object.keys(changePwErrors.value).forEach(k => changePwErrors.value[k] = '')
  
  changePwTab.value = 'normal'
  showChangePasswordModal.value = true
}

const switchChangePwTab = (tab) => {
  changePwTab.value = tab
  userCaptchaInput.value = ''
  // Clear all errors
  Object.keys(changePwErrors.value).forEach(k => changePwErrors.value[k] = '')
  if (tab === 'code') {
    setTimeout(drawCaptcha, 50)
  }
}

// 常规修改密码提交
const handleChangePasswordNormal = async () => {
  changePwErrors.value.old = ''
  changePwErrors.value.new = ''
  changePwErrors.value.confirm = ''

  let hasErr = false
  if (!changePwOld.value.trim()) {
    changePwErrors.value.old = '请输入原密码！'
    hasErr = true
  }
  if (!changePwNew.value.trim()) {
    changePwErrors.value.new = '请输入新密码！'
    hasErr = true
  } else if (changePwNew.value.trim().length < 6) {
    changePwErrors.value.new = '新密码长度不能少于6位！'
    hasErr = true
  }
  if (!changePwConfirm.value.trim()) {
    changePwErrors.value.confirm = '请确认新密码！'
    hasErr = true
  } else if (changePwConfirm.value.trim() !== changePwNew.value.trim()) {
    changePwErrors.value.confirm = '两次输入的新密码不一致！'
    hasErr = true
  }

  if (hasErr) return

  try {
    const res = await fetchWithAuth(`${ENGINE_API_URL}/api/auth/profile/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        oldPassword: changePwOld.value.trim(),
        newPassword: changePwNew.value.trim()
      })
    })
    const data = await res.json()
    if (res.ok && data.success) {
      showChangePasswordModal.value = false
      showToast('密码修改成功，请重新登录！', 'success')
      handleLogout()
    } else {
      showToast(data.message || '密码修改失败！', 'error')
      if (data.message && data.message.includes('原密码')) {
        changePwErrors.value.old = data.message
      } else {
        changePwErrors.value.new = data.message || '密码修改失败！'
      }
    }
  } catch (e) {
    showToast('密码修改接口请求错误！', 'error')
  }
}

// 验证码重置密码提交
const handleChangePasswordCode = async () => {
  changePwErrors.value.code = ''
  changePwErrors.value.resetNew = ''
  changePwErrors.value.resetConfirm = ''

  let hasErr = false
  if (!changePwCode.value.trim()) {
    changePwErrors.value.code = '请输入验证码！'
    hasErr = true
  } else if (changePwCode.value.trim().length !== 6) {
    changePwErrors.value.code = '验证码格式错误！'
    hasErr = true
  }

  if (!changePwResetNew.value.trim()) {
    changePwErrors.value.resetNew = '请输入新密码！'
    hasErr = true
  } else if (changePwResetNew.value.trim().length < 6) {
    changePwErrors.value.resetNew = '新密码长度不能少于6位！'
    hasErr = true
  }

  if (!changePwResetConfirm.value.trim()) {
    changePwErrors.value.resetConfirm = '请确认新密码！'
    hasErr = true
  } else if (changePwResetConfirm.value.trim() !== changePwResetNew.value.trim()) {
    changePwErrors.value.resetConfirm = '两次输入的新密码不一致！'
    hasErr = true
  }

  if (hasErr) return

  try {
    const res = await fetch(`${ENGINE_API_URL}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: currentUser.value.username,
        code: changePwCode.value.trim(),
        newPassword: changePwResetNew.value.trim()
      })
    })
    const data = await res.json()
    if (res.ok && data.success) {
      showChangePasswordModal.value = false
      showToast('密码重置成功，请使用新密码重新登录！', 'success')
      handleLogout()
    } else {
      showToast(data.message || '密码重置失败！', 'error')
      if (data.message && data.message.includes('验证码')) {
        changePwErrors.value.code = data.message
      } else {
        changePwErrors.value.resetNew = data.message || '密码重置失败！'
      }
    }
  } catch (e) {
    showToast('重置密码接口请求失败！', 'error')
  }
}

// 专门为修改密码弹框内发送验证码
const handleSendCodeInModal = async () => {
  changePwErrors.value.captcha = ''
  
  if (!userCaptchaInput.value.trim()) {
    changePwErrors.value.captcha = '请输入图形验证码！'
    return
  }
  if (userCaptchaInput.value.trim().toLowerCase() !== captchaText.value.toLowerCase()) {
    changePwErrors.value.captcha = '图形验证码不正确！'
    drawCaptcha()
    userCaptchaInput.value = ''
    return
  }

  try {
    const res = await fetch(`${ENGINE_API_URL}/api/auth/send-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        email: currentUser.value.username, 
        type: 'reset' 
      })
    })
    const data = await res.json()
    if (res.ok && data.success) {
      showToast('验证码已发送！请检查邮箱（本地运行请看后台控制台）', 'success')
      startCountdown()
      userCaptchaInput.value = ''
    } else {
      showToast(data.message || '验证码发送失败！', 'error')
      drawCaptcha()
    }
  } catch (err) {
    showToast('发送验证码请求失败！', 'error')
  }
}

// 个人资料修改
const showProfileDropdown = ref(false)
const editNickname = ref('')
const editPassword = ref('')
const editAvatarSeed = ref('')

// 管理员后台面板
const adminTab = ref('users') // 'users' | 'logs'
const adminUsers = ref([])
const adminLogs = ref([])

// 新增用户与角色编辑相关变量
const createEmail = ref('')
const searchUserQuery = ref('')
const editRole = ref('user')
const editValidityType = ref('permanent')
const editValidityValue = ref(1)

const filteredAdminUsers = computed(() => {
  const query = searchUserQuery.value.trim().toLowerCase()
  if (!query) return adminUsers.value
  return adminUsers.value.filter(u => 
    u.username.toLowerCase().includes(query) || 
    (u.nickname && u.nickname.toLowerCase().includes(query)) ||
    (u.email && u.email.toLowerCase().includes(query))
  )
})

// 审计日志筛选与用户详情查看状态
const filterLogStartDate = ref('')
const filterLogEndDate = ref('')
const filterLogUsername = ref('')
const filterLogNickname = ref('')
const filterLogAction = ref('')
const filterLogUrl = ref('')
const inspectedUser = ref(null)

const clearLogFilters = () => {
  filterLogStartDate.value = ''
  filterLogEndDate.value = ''
  filterLogUsername.value = ''
  filterLogNickname.value = ''
  filterLogAction.value = ''
  filterLogUrl.value = ''
}

const inspectUser = (user) => {
  inspectedUser.value = user
  editRole.value = user.role
  editValidityType.value = 'permanent'
  editValidityValue.value = 1
}

const quickViewLogs = (username, timeScope) => {
  clearLogFilters()
  filterLogUsername.value = username
  if (timeScope === 'today') {
    const d = new Date()
    const pad = (n) => n.toString().padStart(2, '0')
    const todayStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    filterLogStartDate.value = `${todayStr}T00:00`
    filterLogEndDate.value = `${todayStr}T23:59`
  }
  adminTab.value = 'logs'
  inspectedUser.value = null
}

const filteredLogs = computed(() => {
  return adminLogs.value.filter(log => {
    // 1. 操作时间筛选 (起止区间时间戳对比)
    const logTime = new Date(log.timestamp).getTime()
    if (filterLogStartDate.value) {
      const start = new Date(filterLogStartDate.value).getTime()
      if (logTime < start) return false
    }
    if (filterLogEndDate.value) {
      const end = new Date(filterLogEndDate.value).getTime()
      if (logTime > end) return false
    }
    // 2. 账号筛选
    if (filterLogUsername.value.trim()) {
      const uQuery = filterLogUsername.value.trim().toLowerCase()
      if (!log.username || !log.username.toLowerCase().includes(uQuery)) return false
    }
    // 3. 昵称筛选
    if (filterLogNickname.value.trim()) {
      const nQuery = filterLogNickname.value.trim().toLowerCase()
      const user = adminUsers.value.find(u => u.username === log.username)
      const nickname = user ? user.nickname : ''
      if (!nickname || !nickname.toLowerCase().includes(nQuery)) return false
    }
    // 4. 操作动作筛选
    if (filterLogAction.value.trim()) {
      const aQuery = filterLogAction.value.trim().toLowerCase()
      if (!log.action || !log.action.toLowerCase().includes(aQuery)) return false
    }
    // 5. 提取链接筛选
    if (filterLogUrl.value.trim()) {
      const urlQuery = filterLogUrl.value.trim().toLowerCase()
      if (!log.targetUrl || !log.targetUrl.toLowerCase().includes(urlQuery)) return false
    }
    return true
  })
})

// 新增用户表单 (管理员创建账号使用)
const showCreateUserForm = ref(false)
const createUsername = ref('')
const createPassword = ref('')
const createNickname = ref('')
const createRole = ref('user')

// 外网访问密钥配置
const showAccessKeyModal = ref(false)
const tempAccessKey = ref('')
const accessKey = ref(sessionStorage.getItem('accessKey') || '')

// ==================== 登录、账户管理与审计接口调用 ====================

// 封装带 Token 自动验证的 fetch 请求
const fetchWithAuth = async (url, options = {}) => {
  if (!options.headers) {
    options.headers = {}
  }
  if (token.value) {
    options.headers['Authorization'] = `Bearer ${token.value}`
  }
  
  try {
    const res = await fetch(url, options)
    if (res.status === 401) {
      handleLogout()
      showToast('登录会话已失效，请重新登录！', 'error')
      throw new Error('UNAUTHORIZED')
    }
    return res
  } catch (err) {
    if (err.message !== 'UNAUTHORIZED') {
      console.error('API 请求失败:', err)
    }
    throw err
  }
}

// 用户登录
const handleLogin = async () => {
  authErrors.value.loginUsername = ''
  authErrors.value.loginPassword = ''
  
  let hasErr = false
  if (!loginUsername.value.trim()) {
    authErrors.value.loginUsername = '请输入用户名或邮箱！'
    hasErr = true
  } else if (loginUsername.value.includes('@')) {
    const emailRegex = /^\S+@\S+\.\S+$/
    if (!emailRegex.test(loginUsername.value.trim())) {
      authErrors.value.loginUsername = '请输入有效的邮箱地址，例如 user@example.com！'
      hasErr = true
    }
  }
  
  if (!loginPassword.value.trim()) {
    authErrors.value.loginPassword = '请输入密码！'
    hasErr = true
  }
  
  if (hasErr) return

  try {
    const res = await fetch(`${ENGINE_API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: loginUsername.value.trim(),
        password: loginPassword.value.trim()
      })
    })
    const data = await res.json()
    if (res.ok && data.success) {
      token.value = data.token
      tokenExpireAt.value = data.expireAt.toString()
      localStorage.setItem('authToken', data.token)
      localStorage.setItem('authTokenExpireAt', data.expireAt.toString())
      currentUser.value = data.user
      currentPage.value = 'main'
      showToast(`欢迎回来，${data.user.nickname || data.user.username}！`, 'success')
      loginPassword.value = ''
    } else {
      showToast(data.message || '登录失败，请检查账号密码！', 'error')
      if (data.message && (data.message.includes('密码') || data.message.includes('错误'))) {
        authErrors.value.loginPassword = data.message
      } else {
        authErrors.value.loginUsername = data.message || '登录失败，请检查账号密码！'
      }
    }
  } catch (err) {
    showToast('网络连接失败，请确保本地后端已启动！', 'error')
  }
}

// 图形验证码绘制
const drawCaptcha = () => {
  const canvas = captchaCanvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const chars = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz23456789'
  let code = ''
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  captchaText.value = code
  
  ctx.fillStyle = '#1e293b'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  
  ctx.font = 'bold 24px monospace'
  ctx.textBaseline = 'middle'
  for (let i = 0; i < code.length; i++) {
    ctx.save()
    const x = 15 + i * 20
    const y = canvas.height / 2 + (Math.random() - 0.5) * 8
    const angle = (Math.random() - 0.5) * 0.4
    ctx.translate(x, y)
    ctx.rotate(angle)
    ctx.fillStyle = Math.random() > 0.5 ? '#8b5cf6' : '#d946ef'
    ctx.fillText(code[i], 0, 0)
    ctx.restore()
  }
  
  for (let i = 0; i < 4; i++) {
    ctx.beginPath()
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'
    ctx.moveTo(Math.random() * canvas.width, Math.random() * canvas.height)
    ctx.lineTo(Math.random() * canvas.width, Math.random() * canvas.height)
    ctx.stroke()
  }
  
  for (let i = 0; i < 30; i++) {
    ctx.fillStyle = 'rgba(255,255,255,0.2)'
    ctx.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 1.5, 1.5)
  }
}

// 切换 Auth Tab
const switchAuthTab = (tab) => {
  authTab.value = tab
  userCaptchaInput.value = ''
  
  // 彻底清空所有表单字段，防止信息泄露
  loginUsername.value = ''
  loginPassword.value = ''
  regUsername.value = ''
  regPassword.value = ''
  regNickname.value = ''
  regCode.value = ''
  resetEmail.value = ''
  resetCode.value = ''
  resetPassword.value = ''
  
  // 清空错误提示
  Object.keys(authErrors.value).forEach(key => {
    authErrors.value[key] = ''
  })
  if (tab === 'register' || tab === 'forgot') {
    setTimeout(drawCaptcha, 50)
  }
}

// 邮箱验证码倒计时
let countdownTimer = null
const startCountdown = () => {
  countdown.value = 60
  if (countdownTimer) clearInterval(countdownTimer)
  countdownTimer = setInterval(() => {
    if (countdown.value > 0) {
      countdown.value--
    } else {
      clearInterval(countdownTimer)
    }
  }, 1000)
}

// 发送邮箱验证码
const handleSendCode = async (type) => {
  // 清空本表单相关错误提示
  if (type === 'register') {
    authErrors.value.regUsername = ''
    authErrors.value.regCaptcha = ''
  } else {
    authErrors.value.resetEmail = ''
    authErrors.value.resetCaptcha = ''
  }

  const email = type === 'register' ? regUsername.value.trim() : resetEmail.value.trim()
  let hasErr = false

  if (!email) {
    if (type === 'register') {
      authErrors.value.regUsername = '请输入邮箱地址！'
    } else {
      authErrors.value.resetEmail = '请输入邮箱地址！'
    }
    hasErr = true
  } else {
    const emailRegex = /^\S+@\S+\.\S+$/
    if (!emailRegex.test(email)) {
      if (type === 'register') {
        authErrors.value.regUsername = '请输入有效的邮箱地址，例如 user@example.com！'
      } else {
        authErrors.value.resetEmail = '请输入有效的邮箱地址，例如 user@example.com！'
      }
      hasErr = true
    }
  }

  // 校验图形验证码
  if (!userCaptchaInput.value.trim()) {
    if (type === 'register') {
      authErrors.value.regCaptcha = '请输入图形验证码！'
    } else {
      authErrors.value.resetCaptcha = '请输入图形验证码！'
    }
    hasErr = true
  } else if (userCaptchaInput.value.trim().toLowerCase() !== captchaText.value.toLowerCase()) {
    if (type === 'register') {
      authErrors.value.regCaptcha = '图形验证码不正确！'
    } else {
      authErrors.value.resetCaptcha = '图形验证码不正确！'
    }
    drawCaptcha()
    userCaptchaInput.value = ''
    hasErr = true
  }

  if (hasErr) return

  try {
    const res = await fetch(`${ENGINE_API_URL}/api/auth/send-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, type })
    })
    const data = await res.json()
    if (res.ok && data.success) {
      showToast('验证码已发送！请检查邮箱（本地运行请看后台控制台）', 'success')
      startCountdown()
      userCaptchaInput.value = ''
    } else {
      showToast(data.message || '验证码发送失败！', 'error')
      if (type === 'register') {
        authErrors.value.regUsername = data.message || '验证码发送失败！'
      } else {
        authErrors.value.resetEmail = data.message || '验证码发送失败！'
      }
      drawCaptcha()
    }
  } catch (err) {
    showToast('发送验证码请求失败！', 'error')
  }
}

// 普通用户注册 (升级为邮箱 + 验证码验证)
const handleRegister = async () => {
  authErrors.value.regUsername = ''
  authErrors.value.regPassword = ''
  authErrors.value.regNickname = ''
  authErrors.value.regCode = ''

  let hasErr = false
  const email = regUsername.value.trim()
  if (!email) {
    authErrors.value.regUsername = '请输入邮箱地址！'
    hasErr = true
  } else {
    const emailRegex = /^\S+@\S+\.\S+$/
    if (!emailRegex.test(email)) {
      authErrors.value.regUsername = '请输入有效的邮箱地址，例如 user@example.com！'
      hasErr = true
    }
  }

  const password = regPassword.value.trim()
  if (!password) {
    authErrors.value.regPassword = '请输入密码！'
    hasErr = true
  } else if (password.length < 6) {
    authErrors.value.regPassword = '密码长度不能少于6位！'
    hasErr = true
  }

  const nickname = regNickname.value.trim()
  if (!nickname) {
    authErrors.value.regNickname = '请输入昵称！'
    hasErr = true
  }

  const code = regCode.value.trim()
  if (!code) {
    authErrors.value.regCode = '请输入邮箱验证码！'
    hasErr = true
  } else if (code.length !== 6 || !/^\d+$/.test(code)) {
    authErrors.value.regCode = '验证码必须是6位数字！'
    hasErr = true
  }

  if (hasErr) return

  try {
    const res = await fetch(`${ENGINE_API_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: email,
        password: password,
        nickname: nickname,
        code: code
      })
    })
    const data = await res.json()
    if (res.ok && data.success) {
      showToast(data.message || '注册成功！请登录。', 'success')
      authTab.value = 'login'
      loginUsername.value = regUsername.value
      regUsername.value = ''
      regPassword.value = ''
      regNickname.value = ''
      regCode.value = ''
    } else {
      showToast(data.message || '注册失败！', 'error')
      if (data.message && data.message.includes('验证码')) {
        authErrors.value.regCode = data.message
      } else if (data.message && data.message.includes('邮箱')) {
        authErrors.value.regUsername = data.message
      } else {
        authErrors.value.regUsername = data.message || '注册失败！'
      }
    }
  } catch (err) {
    showToast('注册接口请求失败！', 'error')
  }
}

// 重置密码
const handleResetPassword = async () => {
  authErrors.value.resetEmail = ''
  authErrors.value.resetCode = ''
  authErrors.value.resetPassword = ''

  let hasErr = false
  const email = resetEmail.value.trim()
  if (!email) {
    authErrors.value.resetEmail = '请输入邮箱地址！'
    hasErr = true
  } else {
    const emailRegex = /^\S+@\S+\.\S+$/
    if (!emailRegex.test(email)) {
      authErrors.value.resetEmail = '请输入有效的邮箱地址，例如 user@example.com！'
      hasErr = true
    }
  }

  const code = resetCode.value.trim()
  if (!code) {
    authErrors.value.resetCode = '请输入安全验证码！'
    hasErr = true
  } else if (code.length !== 6 || !/^\d+$/.test(code)) {
    authErrors.value.resetCode = '验证码必须是6位数字！'
    hasErr = true
  }

  const password = resetPassword.value.trim()
  if (!password) {
    authErrors.value.resetPassword = '请输入新密码！'
    hasErr = true
  } else if (password.length < 6) {
    authErrors.value.resetPassword = '新密码长度不能少于6位！'
    hasErr = true
  }

  if (hasErr) return

  try {
    const res = await fetch(`${ENGINE_API_URL}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email,
        code: code,
        newPassword: password
      })
    })
    const data = await res.json()
    if (res.ok && data.success) {
      showToast('密码重置成功，请使用新密码登录！', 'success')
      authTab.value = 'login'
      loginUsername.value = resetEmail.value
      resetEmail.value = ''
      resetCode.value = ''
      resetPassword.value = ''
    } else {
      showToast(data.message || '重置密码失败，请检查验证码！', 'error')
      if (data.message && data.message.includes('验证码')) {
        authErrors.value.resetCode = data.message
      } else if (data.message && data.message.includes('邮箱')) {
        authErrors.value.resetEmail = data.message
      } else {
        authErrors.value.resetEmail = data.message || '重置密码失败！'
      }
    }
  } catch (err) {
    showToast('请求重置密码失败！', 'error')
  }
}

// 退出登录
const handleLogout = () => {
  token.value = ''
  tokenExpireAt.value = ''
  localStorage.removeItem('authToken')
  localStorage.removeItem('authTokenExpireAt')
  currentUser.value = null
  currentPage.value = 'auth'
  showProfileDropdown.value = false
  parseResult.value = null
  errorMsg.value = ''
  
  // 清空所有表单项以防止会话残留信息泄露
  loginUsername.value = ''
  loginPassword.value = ''
  regUsername.value = ''
  regPassword.value = ''
  regNickname.value = ''
  regCode.value = ''
  resetEmail.value = ''
  resetCode.value = ''
  resetPassword.value = ''
}

// 校验登录态
const checkAuthSession = async () => {
  if (!token.value) {
    currentPage.value = 'auth'
    return
  }
  if (tokenExpireAt.value && Date.now() > parseInt(tokenExpireAt.value)) {
    handleLogout()
    showToast('您的登录已过期，请重新登录！', 'warning')
    return
  }

  try {
    const res = await fetch(`${ENGINE_API_URL}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${token.value}` }
    })
    const data = await res.json()
    if (res.ok && data.success) {
      currentUser.value = data.user
      currentPage.value = 'main'
    } else {
      handleLogout()
    }
  } catch (e) {
    console.error('会话校验错误:', e)
    currentPage.value = currentUser.value ? 'main' : 'auth'
  }
}

// 开启编辑个人资料
const openEditProfile = () => {
  if (!currentUser.value) return
  isEditingProfile.value = false
  editNickname.value = currentUser.value.nickname || ''
  editBio.value = currentUser.value.bio || ''
  editPassword.value = ''
  
  // 从头像 URL 中解析种子，若包含邮箱/用户名则替换为安全随机种子
  const currentAvatar = currentUser.value.avatar || ''
  const urlMatch = currentAvatar.match(/seed=([^&]+)/)
  let seedVal = urlMatch ? decodeURIComponent(urlMatch[1]) : ''
  if (!seedVal || seedVal.includes('@') || seedVal === currentUser.value.username) {
    seedVal = Math.random().toString(36).substring(2, 10)
  }
  editAvatarSeed.value = seedVal
  
  currentPage.value = 'profile'
  showProfileDropdown.value = false
}

// 更新个人资料
const handleProfileUpdate = async () => {
  if (!editNickname.value.trim()) {
    showToast('昵称不能为空！', 'error')
    return
  }
  
  const avatarUrl = `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(editAvatarSeed.value.trim() || currentUser.value.username)}`
  
  try {
    const res = await fetchWithAuth(`${ENGINE_API_URL}/api/auth/profile/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nickname: editNickname.value.trim(),
        avatar: avatarUrl,
        bio: editBio.value.trim()
      })
    })
    const data = await res.json()
    if (res.ok && data.success) {
      currentUser.value.nickname = data.user.nickname
      currentUser.value.avatar = data.user.avatar
      currentUser.value.bio = data.user.bio
      isEditingProfile.value = false
      showToast('个人资料更新成功！', 'success')
    } else {
      showToast(data.message || '更新失败！', 'error')
    }
  } catch (e) {
    showToast('更新失败，网络接口错误！', 'error')
  }
}

// 权益与套餐页面相关逻辑
const userLogsForChart = ref([])
const hoveredPoint = ref(null)

const fetchUserLogsForChart = async () => {
  try {
    const res = await fetchWithAuth(`${ENGINE_API_URL}/api/user/logs`)
    const data = await res.json()
    if (res.ok && data.success) {
      userLogsForChart.value = data.logs || []
    }
  } catch (e) {
    console.error('获取用户日志失败:', e)
  }
}

const openBenefits = () => {
  currentPage.value = 'benefits'
  showProfileDropdown.value = false
  hoveredPoint.value = null
  fetchUserLogsForChart()
}

const showPaymentModal = ref(false)
const selectedPlan = ref('') // 'pro_monthly' | 'pro_lifetime'
const selectedPlanTitle = computed(() => {
  return selectedPlan.value === 'pro_monthly' ? 'Pro 专业版 (月付)' : 'Pro 永久版 (一次性)'
})
const selectedPlanPrice = computed(() => {
  return selectedPlan.value === 'pro_monthly' ? '20' : '199'
})
const paymentMethod = ref('wechat') // 'wechat' | 'alipay'

const closePaymentModal = () => {
  showPaymentModal.value = false
}

const upgradePlan = (plan) => {
  if (plan === 'free') return
  selectedPlan.value = plan
  showPaymentModal.value = true
}

const simulatePaymentSuccess = async () => {
  try {
    const res = await fetch(`${ENGINE_API_URL}/api/user/simulate-upgrade`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token.value}`
      },
      body: JSON.stringify({ plan: selectedPlan.value })
    })
    const data = await res.json()
    if (res.ok && data.success) {
      showToast(data.message, 'success')
      if (currentUser.value) {
        currentUser.value.role = 'pro'
      }
      showPaymentModal.value = false
    } else {
      showToast(data.message || '模拟支付升级失败！', 'error')
    }
  } catch (err) {
    showToast('请求模拟支付升级接口失败，请检查后端！', 'error')
  }
}

// 从真实日志计算 30 天的使用数据
const usageHistory = computed(() => {
  const stats = []
  const now = new Date()
  
  // 建立以本地日期格式 YYYY-MM-DD 为 Key 的映射表
  const logsByDate = {}
  userLogsForChart.value.forEach(log => {
    if (!log.timestamp) return
    const d = new Date(log.timestamp)
    
    // 转换为本地 YYYY-MM-DD
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const dateStr = `${year}-${month}-${day}`
    
    if (!logsByDate[dateStr]) {
      logsByDate[dateStr] = []
    }
    logsByDate[dateStr].push(log)
  })

  for (let i = 29; i >= 0; i--) {
    const d = new Date()
    d.setDate(now.getDate() - i)
    
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const dateStr = `${year}-${month}-${day}`
    
    // 折线图 X 轴的简短展示格式
    const shortDate = `${d.getMonth() + 1}/${d.getDate()}`
    const dayLogs = logsByDate[dateStr] || []
    
    // 按操作动作进行分组统计
    const actionGroups = {}
    dayLogs.forEach(log => {
      const act = log.action || '未知操作'
      actionGroups[act] = (actionGroups[act] || 0) + 1
    })
    
    const details = Object.entries(actionGroups)
      .map(([act, cnt]) => `${act} ${cnt}次`)
      .join(', ')

    stats.push({
      dateStr,
      shortDate,
      count: dayLogs.length,
      details: details || '无操作记录'
    })
  }
  return stats
})

const maxUsageValue = computed(() => {
  if (usageHistory.value.length === 0) return 10
  const maxVal = Math.max(...usageHistory.value.map(h => h.count))
  return maxVal < 5 ? 5 : maxVal
})

const chartPoints = computed(() => {
  const points = []
  const totalPoints = usageHistory.value.length
  if (totalPoints === 0) return []
  
  const svgW = 500
  const svgH = 200
  const padL = 40
  const padR = 20
  const padT = 20
  const padB = 30
  
  const w = svgW - padL - padR
  const h = svgH - padT - padB
  const maxVal = maxUsageValue.value
  
  usageHistory.value.forEach((item, index) => {
    const x = padL + index * (w / (totalPoints - 1))
    const y = padT + h - (item.count / maxVal) * h
    
    const pctX = (x / svgW) * 100
    const pctY = (y / svgH) * 100

    points.push({ 
      x, 
      y, 
      pctX, 
      pctY,
      dateStr: item.dateStr, 
      shortDate: item.shortDate, 
      count: item.count,
      details: item.details
    })
  })
  return points
})

const chartLinePath = computed(() => {
  if (chartPoints.value.length === 0) return ''
  return 'M ' + chartPoints.value.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ')
})

const chartAreaPath = computed(() => {
  if (chartPoints.value.length === 0) return ''
  const first = chartPoints.value[0]
  const last = chartPoints.value[chartPoints.value.length - 1]
  const path = 'M ' + chartPoints.value.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ')
  return `${path} L ${last.x.toFixed(1)},170 L ${first.x.toFixed(1)},170 Z`
})

const chartDots = computed(() => {
  const pts = chartPoints.value
  if (pts.length === 0) return []
  const indexes = [0, 6, 12, 18, 24, 29]
  return indexes.map(idx => pts[idx]).filter(Boolean)
})

const chartXLabels = computed(() => {
  return chartDots.value.map(pt => pt.shortDate)
})

// 获取系统用户列表 (Admin 权限)
const fetchAdminUsers = async () => {
  try {
    const res = await fetchWithAuth(`${ENGINE_API_URL}/api/admin/users`)
    const data = await res.json()
    if (res.ok && data.success) {
      adminUsers.value = data.users
    }
  } catch (e) {
    showToast('获取账号列表失败！', 'error')
  }
}

// 获取系统审计日志 (Admin 权限)
const fetchAdminLogs = async () => {
  try {
    const res = await fetchWithAuth(`${ENGINE_API_URL}/api/admin/logs`)
    const data = await res.json()
    if (res.ok && data.success) {
      adminLogs.value = data.logs
    }
  } catch (e) {
    showToast('获取审计日志失败！', 'error')
  }
}

// 开启管理员后台
const openAdminDashboard = async () => {
  showProfileDropdown.value = false
  adminTab.value = 'users'
  showCreateUserForm.value = false
  inspectedUser.value = null
  clearLogFilters()
  currentPage.value = 'admin'
  await fetchAdminUsers()
  await fetchAdminLogs()
}

// 管理员创建账号
const handleCreateUser = async () => {
  if (!createUsername.value.trim() || !createPassword.value.trim()) {
    showToast('用户名和密码不能为空！', 'error')
    return
  }
  const emailVal = createEmail.value.trim()
  if (emailVal) {
    const emailRegex = /^\S+@\S+\.\S+$/
    if (!emailRegex.test(emailVal)) {
      showToast('请输入有效的邮箱地址！', 'error')
      return
    }
  }
  try {
    const res = await fetchWithAuth(`${ENGINE_API_URL}/api/admin/users/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: createUsername.value.trim(),
        password: createPassword.value.trim(),
        nickname: createNickname.value.trim() || createUsername.value.trim(),
        role: createRole.value,
        email: emailVal || undefined
      })
    })
    const data = await res.json()
    if (res.ok && data.success) {
      showToast('账号创建成功！', 'success')
      createUsername.value = ''
      createPassword.value = ''
      createNickname.value = ''
      createEmail.value = ''
      createRole.value = 'user'
      showCreateUserForm.value = false
      await fetchAdminUsers()
    } else {
      showToast(data.message || '创建账号失败！', 'error')
    }
  } catch (e) {
    showToast('创建账号接口错误！', 'error')
  }
}

// 管理员修改用户角色与有效期
const handleUpdateRole = async () => {
  if (!inspectedUser.value) return
  if (inspectedUser.value.username === 'mediaAdmin' || inspectedUser.value.username === 'mediaSuper') {
    showToast('系统内置账号角色无法修改！', 'error')
    return
  }
  try {
    const res = await fetchWithAuth(`${ENGINE_API_URL}/api/admin/users/update-role`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: inspectedUser.value.username,
        role: editRole.value,
        validityType: editValidityType.value,
        validityValue: editValidityValue.value
      })
    })
    const data = await res.json()
    if (res.ok && data.success) {
      showToast('用户角色及有效期设置成功！', 'success')
      // 更新本地数据
      inspectedUser.value.role = editRole.value
      if (editRole.value === 'user' || editValidityType.value === 'permanent') {
        inspectedUser.value.roleExpireAt = null
      } else {
        const val = parseInt(editValidityValue.value) || 1
        let ms = val * 24 * 60 * 60 * 1000
        if (editValidityType.value === 'month') ms = val * 30 * 24 * 60 * 60 * 1000
        else if (editValidityType.value === 'year') ms = val * 365 * 24 * 60 * 60 * 1000
        inspectedUser.value.roleExpireAt = new Date(Date.now() + ms).toISOString()
      }
      await fetchAdminUsers()
    } else {
      showToast(data.message || '设置角色失败！', 'error')
    }
  } catch (e) {
    showToast('修改角色接口错误！', 'error')
  }
}

// 管理员删除账号
const handleDeleteUser = async (username) => {
  const confirmed = await triggerConfirm(`确认要永久删除账号 "${username}" 吗？此操作不可逆！`)
  if (!confirmed) {
    return
  }
  try {
    const res = await fetchWithAuth(`${ENGINE_API_URL}/api/admin/users/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    })
    const data = await res.json()
    if (res.ok && data.success) {
      showToast('账号删除成功！', 'success')
      await fetchAdminUsers()
    } else {
      showToast(data.message || '删除账号失败！', 'error')
    }
  } catch (e) {
    showToast('删除账号接口错误！', 'error')
  }
}

const formatDate = (isoStr) => {
  if (!isoStr) return '-'
  try {
    const d = new Date(isoStr)
    const pad = (n) => n.toString().padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  } catch (e) {
    return isoStr
  }
}

// Canvas 粒子背景引用
const canvasRef = ref(null)
let animationId = null

// 关闭头像下拉菜单的全局监听
const closeDropdown = () => {
  showProfileDropdown.value = false
}

// 初始化 Canvas 交互星空粒子网格
onMounted(() => {
  checkAuthSession()
  window.addEventListener('click', closeDropdown)
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  let width = canvas.width = window.innerWidth
  let height = canvas.height = window.innerHeight

  const handleResize = () => {
    if (!canvas) return
    width = canvas.width = window.innerWidth
    height = canvas.height = window.innerHeight
  }
  window.addEventListener('resize', handleResize)

  // 粒子配置
  const particles = []
  const particleCount = 75
  const connectionDistance = 110
  const mouse = { x: null, y: null, radius: 120 }

  const handleMouseMove = (e) => {
    mouse.x = e.clientX
    mouse.y = e.clientY
  }

  const handleMouseLeave = () => {
    mouse.x = null
    mouse.y = null
  }

  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseleave', handleMouseLeave)

  class Particle {
    constructor() {
      this.reset()
      // 初始分布遍布全屏
      this.x = Math.random() * width
      this.y = Math.random() * height
    }

    reset() {
      this.x = Math.random() * width
      this.y = Math.random() * height
      this.vx = (Math.random() - 0.5) * 0.4
      this.vy = (Math.random() - 0.5) * 0.4
      this.radius = Math.random() * 2 + 1
      this.color = Math.random() > 0.45 ? '#8b5cf6' : '#d946ef'
      this.alpha = Math.random() * 0.5 + 0.25
    }

    update() {
      this.x += this.vx
      this.y += this.vy

      // 边缘弹回
      if (this.x < 0 || this.x > width) this.vx = -this.vx
      if (this.y < 0 || this.y > height) this.vy = -this.vy

      // 鼠标交互排斥效果
      if (mouse.x !== null && mouse.y !== null) {
        const dx = this.x - mouse.x
        const dy = this.y - mouse.y
        const dist = Math.hypot(dx, dy)
        if (dist < mouse.radius) {
          const force = (mouse.radius - dist) / mouse.radius
          const angle = Math.atan2(dy, dx)
          // 产生阻尼推力
          this.x += Math.cos(angle) * force * 1.5
          this.y += Math.sin(angle) * force * 1.5
        }
      }
    }

    draw() {
      ctx.save()
      ctx.beginPath()
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2)
      ctx.fillStyle = this.color
      ctx.globalAlpha = this.alpha
      
      // 产生微弱发光阴影效果
      ctx.shadowBlur = 10
      ctx.shadowColor = this.color
      ctx.fill()
      ctx.restore()
    }
  }

  // 初始化粒子
  for (let i = 0; i < particleCount; i++) {
    particles.push(new Particle())
  }

  // 绘制粒子连线网格 (星座网格)
  const drawLines = () => {
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x
        const dy = particles[i].y - particles[j].y
        const dist = Math.hypot(dx, dy)

        if (dist < connectionDistance) {
          // 距离越近，连线越亮
          const alpha = (1 - dist / connectionDistance) * 0.13
          ctx.strokeStyle = '#8b5cf6'
          ctx.lineWidth = 0.6
          ctx.globalAlpha = alpha
          ctx.beginPath()
          ctx.moveTo(particles[i].x, particles[i].y)
          ctx.lineTo(particles[j].x, particles[j].y)
          ctx.stroke()
        }
      }
    }
  }

  // 循环渲染
  const animate = () => {
    ctx.clearRect(0, 0, width, height)
    
    particles.forEach(p => {
      p.update()
      p.draw()
    })

    drawLines()
    animationId = requestAnimationFrame(animate)
  }

  animate()

  onUnmounted(() => {
    window.removeEventListener('resize', handleResize)
    window.removeEventListener('mousemove', handleMouseMove)
    window.removeEventListener('mouseleave', handleMouseLeave)
    window.removeEventListener('click', closeDropdown)
    cancelAnimationFrame(animationId)
  })
})

// 自定义 Toast 系统
const toast = ref({ show: false, message: '', type: 'success' })
const showToast = (message, type = 'success') => {
  toast.value = { show: true, message, type }
  setTimeout(() => {
    toast.value.show = false
  }, 3000)
}

// 保存豆包与 ASR 语音识别配置设置
const saveSettings = async () => {
  localStorage.setItem('doubaoApiKey', doubaoApiKey.value)
  localStorage.setItem('doubaoEndpointId', doubaoEndpointId.value)
  localStorage.setItem('enableDoubao', enableDoubao.value ? 'true' : 'false')
  
  localStorage.setItem('asrApiKey', asrApiKey.value)
  localStorage.setItem('asrEndpoint', asrEndpoint.value)
  localStorage.setItem('asrModel', asrModel.value)
  localStorage.setItem('enableAsr', enableAsr.value ? 'true' : 'false')

  localStorage.setItem('summaryProvider', summaryProvider.value)
  localStorage.setItem('siliconflowLlApiKey', siliconflowLlApiKey.value)
  localStorage.setItem('siliconflowLlModel', siliconflowLlModel.value)

  // System Administrator also saves SMTP configurations to database
  if (currentUser.value && currentUser.value.role === 'admin') {
    try {
      const res = await fetchWithAuth(`${ENGINE_API_URL}/api/admin/smtp-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: smtpHost.value,
          port: smtpPort.value,
          secure: smtpSecure.value,
          user: smtpUser.value,
          pass: smtpPass.value,
          senderName: smtpSenderName.value
        })
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        showToast(data.message || 'SMTP 邮箱配置保存失败！', 'error')
        return
      }
    } catch (e) {
      showToast('SMTP 邮箱配置保存请求失败！', 'error')
      return
    }
  }

  currentPage.value = 'main'
  showToast('配置设置已成功保存并生效！', 'success')
}

// 备份配置与重置恢复配置 (限 Admin/Super)
const handleBackupSettings = async () => {
  try {
    const res = await fetchWithAuth(`${ENGINE_API_URL}/api/admin/config-backup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doubaoApiKey: doubaoApiKey.value,
        doubaoEndpointId: doubaoEndpointId.value,
        enableDoubao: enableDoubao.value,
        asrApiKey: asrApiKey.value,
        asrEndpoint: asrEndpoint.value,
        asrModel: asrModel.value,
        enableAsr: enableAsr.value,
        summaryProvider: summaryProvider.value,
        siliconflowLlApiKey: siliconflowLlApiKey.value,
        siliconflowLlModel: siliconflowLlModel.value
      })
    })
    const data = await res.json()
    if (res.ok && data.success) {
      showToast('AI 配置已成功备份到服务器！', 'success')
    } else {
      showToast(data.message || '备份失败！', 'error')
    }
  } catch (e) {
    showToast('备份请求发送失败！', 'error')
  }
}

const handleRestoreSettings = async () => {
  const confirmed = await triggerConfirm('确认要从备份文件恢复所有 AI 配置吗？这将会覆盖您当前的所有配置！')
  if (!confirmed) {
    return
  }
  try {
    const res = await fetchWithAuth(`${ENGINE_API_URL}/api/admin/config-backup`)
    const data = await res.json()
    if (res.ok && data.success && data.config) {
      const c = data.config
      doubaoApiKey.value = c.doubaoApiKey || ''
      doubaoEndpointId.value = c.doubaoEndpointId || ''
      enableDoubao.value = !!c.enableDoubao
      asrApiKey.value = c.asrApiKey || ''
      asrEndpoint.value = c.asrEndpoint || ''
      asrModel.value = c.asrModel || ''
      enableAsr.value = !!c.enableAsr
      summaryProvider.value = c.summaryProvider || 'siliconflow'
      siliconflowLlApiKey.value = c.siliconflowLlApiKey || ''
      siliconflowLlModel.value = c.siliconflowLlModel || ''
      
      // Save directly to localStorage
      localStorage.setItem('doubaoApiKey', doubaoApiKey.value)
      localStorage.setItem('doubaoEndpointId', doubaoEndpointId.value)
      localStorage.setItem('enableDoubao', enableDoubao.value ? 'true' : 'false')
      localStorage.setItem('asrApiKey', asrApiKey.value)
      localStorage.setItem('asrEndpoint', asrEndpoint.value)
      localStorage.setItem('asrModel', asrModel.value)
      localStorage.setItem('enableAsr', enableAsr.value ? 'true' : 'false')
      localStorage.setItem('summaryProvider', summaryProvider.value)
      localStorage.setItem('siliconflowLlApiKey', siliconflowLlApiKey.value)
      localStorage.setItem('siliconflowLlModel', siliconflowLlModel.value)
      
      showToast('已成功从服务器备份文件重置并恢复所有配置！', 'success')
    } else {
      showToast(data.message || '恢复备份配置失败！', 'error')
    }
  } catch (e) {
    showToast('读取备份配置文件请求失败！', 'error')
  }
}

// 触发设置齿轮点击
const triggerSettingsClick = () => {
  showProfileDropdown.value = false // 立即关闭右上角下拉菜单
  if (!currentUser.value) {
    showToast('请先登录账号！', 'error')
    return
  }

  if (currentUser.value.role === 'admin') {
    if (currentPage.value !== 'settings') {
      fetchSmtpSettings()
      currentPage.value = 'settings'
    } else {
      currentPage.value = 'main'
    }
    return
  }

  if (currentUser.value.role === 'super') {
    if (currentPage.value === 'settings') {
      currentPage.value = 'main'
      return
    }
    settingsPassword.value = ''
    passwordErrorMsg.value = ''
    showPasswordModal.value = true
    return
  }

  showToast('普通用户无权查看或修改系统配置！', 'error')
}

// 验证设置访问密码
const verifySettingsPassword = () => {
  passwordErrorMsg.value = ''
  if (settingsPassword.value === 'jikelby05') {
    showPasswordModal.value = false
    currentPage.value = 'settings'
    settingsPassword.value = ''
    showToast('验证通过，已开启配置面板！', 'success')
  } else {
    passwordErrorMsg.value = '访问密码错误，请输入正确的设置访问密码！'
    showToast('访问密码错误，拒绝开启配置！', 'error')
  }
}

// 关闭外网密钥配置弹框
const closeAccessKeyModal = () => {
  showAccessKeyModal.value = false
  isParsing.value = false
  stopProgress()
}

// 保存外网密钥配置
const saveAccessKey = () => {
  if (!tempAccessKey.value.trim()) {
    showToast('请输入有效的密钥', 'error')
    return
  }
  accessKey.value = tempAccessKey.value.trim()
  sessionStorage.setItem('accessKey', accessKey.value)
  showAccessKeyModal.value = false
  showToast('密钥已保存，正在重新解析...', 'success')
  handleParse()
}

// 嗅探步骤模拟
const currentStep = ref(0)
const steps = [
  '正在唤醒后台无头浏览器引擎...',
  '正在进行指纹伪装，绕过平台安全护盾...',
  '正在注入拦截探针，实时嗅探数据流并提取原文字幕...',
  '正在解析视频物理直链并唤起 AI 深度大模型...'
]

let stepInterval = null

const startProgress = () => {
  currentStep.value = 0
  stepInterval = setInterval(() => {
    if (currentStep.value < steps.length - 1) {
      currentStep.value++
    } else {
      clearInterval(stepInterval)
    }
  }, 3000)
}

const stopProgress = () => {
  clearInterval(stepInterval)
  currentStep.value = steps.length
}

const ENGINE_API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3000'
  : window.location.origin

const extractUrl = (text) => {
  const match = text.match(/(https?:\/\/[^\s]+)/g)
  return match ? match[0] : null
}

const isSummarizing = ref(false)
const hasSummarized = ref(false)

const handleParse = async () => {
  if (currentUser.value && currentUser.value.role === 'user' && currentUser.value.remaining <= 0) {
    showToast('今日已达到免费提取上限！无法继续解析新视频。', 'error')
    return
  }

  const rawUrl = inputUrl.value.trim()
  const cleanUrl = extractUrl(rawUrl)

  if (!cleanUrl) {
    errorMsg.value = '未检测到有效的视频链接，请输入包含 http/https 的网址'
    showToast('请输入有效的视频链接', 'error')
    return
  }

  // 🔑 外网密钥本地检查 (仅针对 YouTube/TikTok 等海外平台)
  const isOverseas = cleanUrl.includes('youtube.com') || cleanUrl.includes('youtu.be') || cleanUrl.includes('tiktok.com')
  if (isOverseas && !accessKey.value) {
    showAccessKeyModal.value = true
    tempAccessKey.value = ''
    showToast('解析海外平台视频需要配置密钥！', 'warning')
    return
  }

  isParsing.value = true
  errorMsg.value = ''
  parseResult.value = null
  activeTab.value = 'video' // 默认回到视频播放标签
  hasSummarized.value = false
  isSummarizing.value = false
  const startTime = performance.now()
  startProgress()

  try {
    const res = await fetchWithAuth(`${ENGINE_API_URL}/api/parse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        url: cleanUrl,
        apiKey: enableDoubao.value ? doubaoApiKey.value : '',
        endpointId: enableDoubao.value ? doubaoEndpointId.value : '',
        accessKey: accessKey.value
      })
    })

    const data = await res.json()

    if (res.status === 403 || data.error === 'KEY_REQUIRED' || data.error === 'INVALID_KEY') {
      showAccessKeyModal.value = true
      tempAccessKey.value = accessKey.value
      throw new Error(data.message || '解析此平台视频需要输入外网访问密钥')
    }

    if (!res.ok || !data.success) {
      throw new Error(data.error || '解析失败，请检查链接是否正确')
    }

    const endTime = performance.now()
    parseDuration.value = ((endTime - startTime) / 1000).toFixed(2)

    parseResult.value = {
      title: data.title || '已解析视频',
      cover: data.cover || '',
      videoUrl: data.videoUrl,
      targetUrl: data.targetUrl,
      platform: data.platform || '未知平台',
      description: data.description || '该视频未提供额外的文案描述。',
      author: data.author || '',
      duration: data.duration || 0,
      stats: data.stats || null,
      hotListViews: data.hotListViews || null,
      isImageNote: data.isImageNote || false,
      aiSummary: {
        category: '综合创作',
        points: ['已提取高清视频物理流直链。', '点击下方的按钮可直接高速下载。', '若要转写人声文案与 AI 总结，请点击上方相应页签。'],
        suggestion: '提示：请点击上方“提取文案”或“AI核心总结”以按需调用 ASR 服务转写语音。',
        isRealAI: false
      }
    }

    // 成功后扣减可用次数 (仅普通用户)
    if (currentUser.value && currentUser.value.role === 'user') {
      currentUser.value.remaining = Math.max(0, currentUser.value.remaining - 1)
    }

    showToast('视频流提取成功，可立即下载！', 'success')
  } catch (err) {
    errorMsg.value = err.message || '网络连接失败，请确保本地后端已启动！'
    showToast('解析失败，请查看报错信息', 'error')
  } finally {
    isParsing.value = false
    stopProgress()
  }
}

// 异步按需提取语音字幕与 AI 总结
const fetchSummaryAndTranscript = async () => {
  if (hasSummarized.value || isSummarizing.value || !parseResult.value) return

  isSummarizing.value = true
  showToast('正在异步请求 ASR 识别与 AI 深度总结，请稍候...', 'success')

  try {
    const res = await fetchWithAuth(`${ENGINE_API_URL}/api/summarize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        videoUrl: parseResult.value.videoUrl,
        targetUrl: parseResult.value.targetUrl,
        title: parseResult.value.title,
        platform: parseResult.value.platform,
        description: parseResult.value.description,
        summaryProvider: summaryProvider.value,
        apiKey: summaryProvider.value === 'doubao' ? doubaoApiKey.value : '',
        endpointId: summaryProvider.value === 'doubao' ? doubaoEndpointId.value : '',
        asrApiKey: enableAsr.value ? asrApiKey.value : '',
        asrEndpoint: enableAsr.value ? asrEndpoint.value : '',
        asrModel: enableAsr.value ? asrModel.value : '',
        llmApiKey: summaryProvider.value === 'siliconflow' ? (siliconflowLlApiKey.value || asrApiKey.value) : '',
        llmModel: summaryProvider.value === 'siliconflow' ? siliconflowLlModel.value : ''
      })
    })
    const data = await res.json()
    if (res.ok && data.success) {
      parseResult.value.aiSummary = data.aiSummary
      parseResult.value.description = data.transcript || parseResult.value.description
      hasSummarized.value = true
      showToast('AI 核心总结与文案提取成功！', 'success')
    } else {
      showToast(data.message || 'AI 总结提取失败！', 'error')
    }
  } catch (err) {
    showToast('AI 总结请求失败！', 'error')
  } finally {
    isSummarizing.value = false
  }
}

const switchTab = (tab) => {
  activeTab.value = tab
  if (tab === 'copywriting' || tab === 'summary') {
    fetchSummaryAndTranscript()
  }
}

const platformClass = computed(() => {
  if (!parseResult.value) return ''
  const p = parseResult.value.platform.toLowerCase()
  if (p === 'bilibili') return 'bilibili'
  if (p === '抖音' || p === 'douyin') return 'douyin'
  if (p === '小红书' || p === 'xhs') return 'xhs'
  if (p === 'tiktok') return 'tiktok'
  if (p === 'youtube') return 'youtube'
  return 'generic'
})

// ===== 播放量/互动数据展示（结构化 stats）=====
// 后端返回的 stats 结构：
//   { metrics: { play:{value,source}, like:{...}, ... }, missing: [...], note: '' }
//   同时保留了便捷字段 stats.play / stats.like ... 直接是数字或 null
// 原则：只展示真实存在的数字；平台不提供的指标不渲染，并在 missing 里说明
const formatStatCount = (n) => {
  if (n === null || n === undefined || n === '') return ''
  const num = Number(n)
  if (Number.isNaN(num)) return String(n)
  if (num >= 100000000) return (num / 100000000).toFixed(1) + '亿'
  if (num >= 10000) return (num / 10000).toFixed(1) + '万'
  return String(num)
}

// 各平台实际能提供的指标（顺序即展示顺序）
const STAT_ORDER = ['play', 'danmaku', 'like', 'comment', 'collect', 'coin', 'share', 'recommend']
const STAT_LABEL = {
  play: '播放', danmaku: '弹幕', like: '点赞', comment: '评论',
  collect: '收藏', coin: '投币', share: '分享', recommend: '推荐'
}

const displayStats = computed(() => {
  const s = parseResult.value && parseResult.value.stats
  if (!s) return []
  const items = []
  for (const key of STAT_ORDER) {
    // 优先读结构化 metrics，回退到便捷字段
    let value = null
    let source = null
    if (s.metrics && s.metrics[key]) {
      value = s.metrics[key].value
      source = s.metrics[key].source
    } else if (s[key] !== null && s[key] !== undefined) {
      value = s[key]
    }
    if (value === null || value === undefined) continue
    items.push({ key, label: STAT_LABEL[key] || key, value, source })
  }
  return items
})

// 这个平台明确不提供哪些指标（用于给用户一个诚实的说明）
const missingStatLabels = computed(() => {
  const s = parseResult.value && parseResult.value.stats
  if (!s || !Array.isArray(s.missing)) return []
  const shown = new Set(displayStats.value.map(i => i.key))
  return s.missing
    .filter(k => !shown.has(k) && STAT_LABEL[k])
    .map(k => STAT_LABEL[k])
})

const formatDuration = (ms) => {
  if (!ms || Number(ms) <= 0) return ''
  const total = Math.round(Number(ms) / 1000)
  const m = Math.floor(total / 60)
  const sec = total % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}

// 解析提取文案中的话题标签与主体文本
const parsedCopywriting = computed(() => {
  if (!parseResult.value) {
    return { tags: [], text: '' }
  }
  
  const desc = parseResult.value.description || ''
  const tags = []
  
  // 提取 #话题
  const hashtagRegex = /#([^\s#]+)/g
  const matches = desc.match(hashtagRegex)
  if (matches) {
    matches.forEach(m => {
      if (!tags.includes(m)) {
        tags.push(m)
      }
    })
  }

  // 提取 B站 格式的 "视频标签: xxx、yyy"
  const biliTagRegex = /视频标签:\s*([^\n。；\uff1b]+)/
  const biliTagMatch = desc.match(biliTagRegex)
  if (biliTagMatch) {
    const biliTags = biliTagMatch[1].split(/[、\s\uff0c,]/).filter(t => t.trim().length > 0)
    biliTags.forEach(t => {
      const formatted = t.startsWith('#') ? t : `#${t}`
      if (!tags.includes(formatted)) {
        tags.push(formatted)
      }
    })
  }

  // 清洗纯文本描述以防描述重复显示标签
  let cleanedText = desc
    .replace(hashtagRegex, '')
    .replace(/视频标签:\s*[^\n。；\uff1b]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  // 移出开头的多余标点
  cleanedText = cleanedText.replace(/^[。，、；:：\s]+|[。，、；:：\s]+$/g, '')

  const isNoContent = !cleanedText || 
                      cleanedText === '该视频未提供额外的文案描述。' || 
                      cleanedText === '暂无详细描述文案' || 
                      cleanedText === '未获取到视频的语音字幕文本。' ||
                      cleanedText.length < 3

  return {
    tags,
    text: isNoContent ? '' : cleanedText
  }
})

const clearInput = () => {
  inputUrl.value = ''
}

const proxyVideoUrl = computed(() => {
  if (!parseResult.value) return ''
  return `${ENGINE_API_URL}/api/download?videoUrl=${encodeURIComponent(parseResult.value.videoUrl)}&referer=${encodeURIComponent(parseResult.value.targetUrl)}&title=${encodeURIComponent(parseResult.value.title)}&accessKey=${encodeURIComponent(accessKey.value)}&token=${encodeURIComponent(token.value)}`
})

const copyUrl = (url, msg = '高清直链已复制到剪贴板！') => {
  navigator.clipboard.writeText(url)
  showToast(msg, 'success')
}

const fillExample = (url) => {
  inputUrl.value = url
  showToast('已载入示例链接，按 Enter 开始', 'success')
}
</script>

<template>
  <!-- Global Canvas Particles and Glows -->
  <canvas ref="canvasRef" class="particle-canvas"></canvas>
  <div class="glow-bg-node node-1"></div>
  <div class="glow-bg-node node-2"></div>

  <!-- Custom Toast Alert Component -->
  <Transition name="toast-fade">
    <div v-if="toast.show" class="custom-toast" :class="toast.type">
      <span class="toast-icon">
        <svg v-if="toast.type === 'success'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      </span>
      <span class="toast-message">{{ toast.message }}</span>
    </div>
  </Transition>

  <!-- Pro Upgrade Payment Modal -->
  <Transition name="toast-fade">
    <div v-if="showPaymentModal" class="settings-overlay" @click.self="closePaymentModal">
      <div class="settings-modal change-pw-modal" style="max-width: 460px; position: relative; overflow: visible; padding: 30px;">
        <!-- Card glows inside modal -->
        <div class="auth-card-glow glow-1" style="opacity: 0.15; width: 200px; height: 200px; filter: blur(50px);"></div>
        <div class="auth-card-glow glow-2" style="opacity: 0.15; width: 200px; height: 200px; filter: blur(50px);"></div>

        <button class="settings-close" @click="closePaymentModal">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="20" height="20"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>

        <h3 class="settings-title" style="margin-bottom: 5px; text-align: center; font-size: 1.35rem;">💎 升级 VidFetch Pro 账号</h3>
        <p style="text-align: center; color: var(--text-muted); font-size: 0.9rem; margin-bottom: 24px;">获取每日无限次、极客高速通道及 AI 字幕核心要点提取</p>

        <!-- Selected Plan Details -->
        <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); border-radius: 12px; padding: 16px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-size: 0.85rem; color: var(--text-muted);">所选套餐</div>
            <div style="font-size: 1.1rem; font-weight: 800; color: #a78bfa; margin-top: 4px;">{{ selectedPlanTitle }}</div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 0.85rem; color: var(--text-muted);">支付金额</div>
            <div style="font-size: 1.35rem; font-weight: 800; color: #06b6d4; margin-top: 4px;">¥{{ selectedPlanPrice }}</div>
          </div>
        </div>

        <!-- WeChat Recharge Customer Service Block -->
        <div style="display: flex; flex-direction: column; align-items: center; background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); border-radius: 16px; padding: 24px 16px; text-align: center; position: relative; margin-bottom: 24px;">
          <!-- WeChat Icon -->
          <div style="width: 50px; height: 50px; border-radius: 50%; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.25); display: flex; align-items: center; justify-content: center; margin-bottom: 14px; box-shadow: 0 4px 15px rgba(16, 185, 129, 0.15);">
            <svg viewBox="0 0 24 24" fill="currentColor" style="width: 26px; height: 26px; color: #10b981;">
              <path d="M8.5 14c-.28 0-.5-.22-.5-.5V13c0-.28.22-.5.5-.5h.01c.28 0 .5.22.5.5v.5c0 .28-.22.5-.5.5zm7 0c-.28 0-.5-.22-.5-.5V13c0-.28.22-.5.5-.5h.01c.28 0 .5.22.5.5v.5c0 .28-.22.5-.5.5zm.37-6.28A6.47 6.47 0 0 0 12 6c-3.59 0-6.5 2.46-6.5 5.5 0 1.77.99 3.36 2.55 4.4a.5.5 0 0 1 .19.46l-.37 1.48c-.06.24.16.44.38.35l1.82-.73a.5.5 0 0 1 .36.03c.66.33 1.39.51 2.14.51.35 0 .7-.04 1.05-.12A5.46 5.46 0 0 1 13 17.5c0-3.04 2.91-5.5 6.5-5.5a6.4 6.4 0 0 1 2.37.45 6.52 6.52 0 0 0-6-4.73zm4.63 7.78A4.47 4.47 0 0 0 19 14.5c-2.48 0-4.5 1.57-4.5 3.5 0 1.12.68 2.13 1.76 2.8a.3.3 0 0 1 .11.29l-.21.84a.26.26 0 0 0 .26.31l1.04-.42c.1-.04.2-.04.3.01.39.2.86.31 1.33.31 2.48 0 4.5-1.57 4.5-3.5a4.44 4.44 0 0 0-3.09-3.76z"/>
            </svg>
          </div>

          <div style="font-size: 1.05rem; font-weight: 700; color: var(--text-primary); margin-bottom: 8px;">
            扫码快捷充值暂停维护
          </div>
          
          <div style="font-size: 0.85rem; color: var(--text-muted); line-height: 1.6; margin-bottom: 20px; max-width: 340px; padding: 0 10px;">
            因扫码充值功能调整升级，当前已暂停自动充值。如需充值升级 Pro 会员，请复制下方微信号添加好友，我们将为您人工手动开通升级。
          </div>

          <!-- WeChat ID Card -->
          <div style="width: 100%; max-width: 300px; background: rgba(255, 255, 255, 0.03); border: 1px dashed rgba(167, 139, 250, 0.3); border-radius: 12px; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; box-shadow: inset 0 2px 4px rgba(0,0,0,0.2);">
            <div style="display: flex; flex-direction: column; align-items: flex-start;">
              <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">客服微信号</span>
              <span style="font-size: 1.15rem; font-weight: 800; color: #a78bfa; font-family: monospace; text-shadow: 0 0 10px rgba(167, 139, 250, 0.3);">qsyr199qy</span>
            </div>
            <button 
              @click="copyUrl('qsyr199qy', '微信号已成功复制！请打开微信添加好友。')"
              style="padding: 8px 14px; font-size: 0.8rem; font-weight: 700; border-radius: 8px; background: rgba(167, 139, 250, 0.15); color: #c084fc; border: 1px solid rgba(167, 139, 250, 0.2); cursor: pointer; transition: all 0.2s;"
              onmouseover="this.style.background='rgba(167, 139, 250, 0.25)';"
              onmouseout="this.style.background='rgba(167, 139, 250, 0.15)';"
            >
              复制微信号
            </button>
          </div>
        </div>

        <!-- Payment Method Selector (Temporarily Hidden)
        <div style="margin-bottom: 24px;">
          <div style="font-size: 0.9rem; font-weight: 700; color: var(--text-primary); margin-bottom: 12px;">选择支付方式</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <button 
              class="pay-method-btn" 
              :class="{ active: paymentMethod === 'wechat' }"
              @click="paymentMethod = 'wechat'"
              style="display: flex; align-items: center; justify-content: center; gap: 8px; border: 1px solid var(--border-color); border-radius: 10px; height: 48px; cursor: pointer; transition: all 0.2s;"
            >
              <span style="font-size: 1.25rem;">🟢</span>
              <span style="font-weight: 700;">微信支付</span>
            </button>
            <button 
              class="pay-method-btn" 
              :class="{ active: paymentMethod === 'alipay' }"
              @click="paymentMethod = 'alipay'"
              style="display: flex; align-items: center; justify-content: center; gap: 8px; border: 1px solid var(--border-color); border-radius: 10px; height: 48px; cursor: pointer; transition: all 0.2s;"
            >
              <span style="font-size: 1.25rem;">🔵</span>
              <span style="font-weight: 700;">支付宝</span>
            </button>
          </div>
        </div>
        -->

        <!-- QR Code Area (Temporarily Hidden)
        <div style="display: flex; flex-direction: column; align-items: center; background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); border-radius: 16px; padding: 24px; position: relative;">
          <div style="width: 160px; height: 160px; background: white; padding: 8px; border-radius: 12px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 15px rgba(0,0,0,0.2);">
            <svg viewBox="0 0 100 100" style="width: 100%; height: 100%; color: #1e1e2f;">
              <rect x="0" y="0" width="30" height="30" fill="none" stroke="currentColor" stroke-width="6"/>
              <rect x="6" y="6" width="18" height="18" fill="currentColor"/>
              <rect x="70" y="0" width="30" height="30" fill="none" stroke="currentColor" stroke-width="6"/>
              <rect x="76" y="6" width="18" height="18" fill="currentColor"/>
              <rect x="0" y="70" width="30" height="30" fill="none" stroke="currentColor" stroke-width="6"/>
              <rect x="6" y="76" width="18" height="18" fill="currentColor"/>
              <rect x="40" y="10" width="10" height="10" fill="currentColor"/>
              <rect x="50" y="20" width="10" height="10" fill="currentColor"/>
              <rect x="40" y="40" width="20" height="20" fill="currentColor"/>
              <rect x="10" y="40" width="10" height="20" fill="currentColor"/>
              <rect x="70" y="40" width="20" height="10" fill="currentColor"/>
              <rect x="40" y="70" width="20" height="10" fill="currentColor"/>
              <rect x="70" y="70" width="10" height="20" fill="currentColor"/>
              <rect x="35" y="35" width="30" height="30" rx="6" fill="white"/>
              <text x="50" y="56" font-size="18" font-weight="900" text-anchor="middle" fill="#8b5cf6">V</text>
            </svg>
          </div>
          
          <div style="margin-top: 16px; font-size: 0.85rem; color: var(--text-secondary); text-align: center;">
            请使用{{ paymentMethod === 'wechat' ? '微信' : '支付宝' }}扫一扫完成支付
          </div>
        </div>
        -->

        <!-- Dev Simulator Button (Commented Out)
        <button 
          class="settings-save-btn" 
          @click="simulatePaymentSuccess"
          style="margin-top: 24px; width: 100%; height: 44px; display: flex; align-items: center; justify-content: center; gap: 6px; font-weight: 700; border-radius: 12px; background: linear-gradient(90deg, #10b981, #059669); color: white; border: none; cursor: pointer; box-shadow: 0 4px 15px rgba(16, 185, 129, 0.25);"
        >
          ⚙️ 模拟支付成功 (开发环境测试)
        </button>
        -->
      </div>
    </div>
  </Transition>

  <!-- Change Password Modal (Dual mode: Normal vs Email Verification Code Reset) -->
  <Transition name="toast-fade">
    <div v-if="showChangePasswordModal" class="settings-overlay" @click.self="showChangePasswordModal = false">
      <div class="settings-modal change-pw-modal" style="max-width: 440px; position: relative; overflow: visible;">
        <!-- Card glows inside modal -->
        <div class="auth-card-glow glow-1" style="opacity: 0.1; width: 180px; height: 180px; filter: blur(50px);"></div>
        <div class="auth-card-glow glow-2" style="opacity: 0.1; width: 180px; height: 180px; filter: blur(50px);"></div>

        <button class="settings-close" @click="showChangePasswordModal = false">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="20" height="20"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        
        <h3 class="settings-title" style="margin-bottom: 5px;">🔐 修改账号登录密码</h3>
        
        <div class="admin-tabs" style="margin-top: 15px; margin-bottom: 20px;">
          <button 
            class="admin-tab-btn" 
            :class="{ 'active': changePwTab === 'normal' }"
            @click="switchChangePwTab('normal')"
          >
            常规修改
          </button>
          <button 
            class="admin-tab-btn" 
            :class="{ 'active': changePwTab === 'code' }"
            @click="switchChangePwTab('code')"
            v-if="currentUser?.username.includes('@')"
          >
            邮箱验证重置
          </button>
        </div>

        <!-- Mode 1: Normal Password Change -->
        <div v-if="changePwTab === 'normal'" class="auth-form animate-fade-in" style="gap: 12px; text-align: left;">
          <div class="form-group">
            <label class="form-label">原密码</label>
            <div class="input-wrapper" :class="{ 'has-error': changePwErrors.old }">
              <span class="input-icon">🔒</span>
              <input 
                type="password" 
                v-model="changePwOld" 
                placeholder="请输入当前账号的原密码" 
                class="form-input"
                @input="changePwErrors.old = ''"
              />
            </div>
            <Transition name="slide-fade">
              <span v-if="changePwErrors.old" class="field-error-msg">
                <span class="error-msg-icon">⚠️</span> {{ changePwErrors.old }}
              </span>
            </Transition>
          </div>

          <div class="form-group">
            <label class="form-label">输入新密码</label>
            <div class="input-wrapper" :class="{ 'has-error': changePwErrors.new }">
              <span class="input-icon">🔑</span>
              <input 
                type="password" 
                v-model="changePwNew" 
                placeholder="请输入新密码 (不少于6位)" 
                class="form-input"
                @input="changePwErrors.new = ''"
              />
            </div>
            <Transition name="slide-fade">
              <span v-if="changePwErrors.new" class="field-error-msg">
                <span class="error-msg-icon">⚠️</span> {{ changePwErrors.new }}
              </span>
            </Transition>
          </div>

          <div class="form-group">
            <label class="form-label">确认新密码</label>
            <div class="input-wrapper" :class="{ 'has-error': changePwErrors.confirm }">
              <span class="input-icon">✅</span>
              <input 
                type="password" 
                v-model="changePwConfirm" 
                placeholder="请再次输入新密码" 
                class="form-input"
                @input="changePwErrors.confirm = ''"
                @keyup.enter="handleChangePasswordNormal"
              />
            </div>
            <Transition name="slide-fade">
              <span v-if="changePwErrors.confirm" class="field-error-msg">
                <span class="error-msg-icon">⚠️</span> {{ changePwErrors.confirm }}
              </span>
            </Transition>
          </div>

          <button class="settings-save-btn" style="margin-top: 15px; width: 100%;" @click="handleChangePasswordNormal">确认修改密码</button>
        </div>

        <!-- Mode 2: Reset Password via Email Code -->
        <div v-else-if="changePwTab === 'code'" class="auth-form animate-fade-in" style="gap: 12px; text-align: left;">
          <p style="color: var(--text-muted); font-size: 0.85rem; margin-top: -5px; margin-bottom: 10px; line-height: 1.4;">
            验证码将发送到发信邮箱绑定的 <strong style="color: var(--color-violet)">{{ maskedEmail }}</strong>。验证通过可直接重置密码。
          </p>

          <!-- 图形验证码 -->
          <div class="form-group">
            <label class="form-label">人机验证码</label>
            <div style="display: flex; gap: 12px; align-items: flex-start;">
              <div style="flex: 1; display: flex; flex-direction: column;">
                <div class="input-wrapper" :class="{ 'has-error': changePwErrors.captcha }">
                  <span class="input-icon">🛡️</span>
                  <input 
                    type="text" 
                    v-model="userCaptchaInput" 
                    placeholder="图形验证码" 
                    class="form-input" 
                    @input="changePwErrors.captcha = ''"
                  />
                </div>
                <Transition name="slide-fade">
                  <span v-if="changePwErrors.captcha" class="field-error-msg">
                    <span class="error-msg-icon">⚠️</span> {{ changePwErrors.captcha }}
                  </span>
                </Transition>
              </div>
              <canvas 
                ref="captchaCanvasRef" 
                width="100" 
                height="46" 
                style="border-radius: 12px; cursor: pointer; border: 1px solid var(--border-color); background: #111224; flex-shrink: 0; box-shadow: 0 4px 10px rgba(0,0,0,0.3); transition: all 0.2s;" 
                @click="drawCaptcha"
                title="点击刷新验证码"
              ></canvas>
            </div>
          </div>

          <!-- 邮箱验证码 -->
          <div class="form-group">
            <label class="form-label">邮箱验证码</label>
            <div style="display: flex; gap: 12px; align-items: flex-start;">
              <div style="flex: 1; display: flex; flex-direction: column;">
                <div class="input-wrapper" :class="{ 'has-error': changePwErrors.code }">
                  <span class="input-icon">🔑</span>
                  <input 
                    type="text" 
                    v-model="changePwCode" 
                    placeholder="6位邮箱验证码" 
                    class="form-input" 
                    @input="changePwErrors.code = ''"
                  />
                </div>
                <Transition name="slide-fade">
                  <span v-if="changePwErrors.code" class="field-error-msg">
                    <span class="error-msg-icon">⚠️</span> {{ changePwErrors.code }}
                  </span>
                </Transition>
              </div>
              <button 
                class="send-code-btn" 
                :disabled="countdown > 0" 
                @click="handleSendCodeInModal"
              >
                {{ countdown > 0 ? `${countdown}s` : '获取验证码' }}
              </button>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">设置新密码</label>
            <div class="input-wrapper" :class="{ 'has-error': changePwErrors.resetNew }">
              <span class="input-icon">🔒</span>
              <input 
                type="password" 
                v-model="changePwResetNew" 
                placeholder="请输入新密码 (不少于6位)" 
                class="form-input"
                @input="changePwErrors.resetNew = ''"
              />
            </div>
            <Transition name="slide-fade">
              <span v-if="changePwErrors.resetNew" class="field-error-msg">
                <span class="error-msg-icon">⚠️</span> {{ changePwErrors.resetNew }}
              </span>
            </Transition>
          </div>

          <div class="form-group">
            <label class="form-label">确认新密码</label>
            <div class="input-wrapper" :class="{ 'has-error': changePwErrors.resetConfirm }">
              <span class="input-icon">✅</span>
              <input 
                type="password" 
                v-model="changePwResetConfirm" 
                placeholder="请再次输入新密码" 
                class="form-input"
                @input="changePwErrors.resetConfirm = ''"
                @keyup.enter="handleChangePasswordCode"
              />
            </div>
            <Transition name="slide-fade">
              <span v-if="changePwErrors.resetConfirm" class="field-error-msg">
                <span class="error-msg-icon">⚠️</span> {{ changePwErrors.resetConfirm }}
              </span>
            </Transition>
          </div>

          <button class="settings-save-btn" style="margin-top: 15px; width: 100%;" @click="handleChangePasswordCode">确认重置密码</button>
        </div>
      </div>
    </div>
  </Transition>


  <!-- Custom Confirm Modal -->
  <Transition name="toast-fade">
    <div v-if="showConfirmModal" class="settings-overlay" style="z-index: 9999;" @click.self="handleConfirmNo">
      <div class="settings-modal" style="max-width: 400px; padding: 24px; border-radius: 16px; background: linear-gradient(135deg, rgba(16, 18, 35, 0.95) 0%, rgba(10, 11, 22, 0.98) 100%); border: 1px solid rgba(255, 255, 255, 0.08); box-shadow: 0 20px 50px rgba(0, 0, 0, 0.8);">
        <div style="font-size: 1.15rem; font-weight: 700; color: var(--text-primary); text-align: left; line-height: 1.5; display: flex; align-items: flex-start; gap: 12px; margin-bottom: 24px;">
          <span style="font-size: 1.5rem; line-height: 1; color: var(--color-violet);">❓</span>
          <span>{{ confirmMessage }}</span>
        </div>
        <div style="display: flex; gap: 12px; justify-content: flex-end;">
          <button 
            style="padding: 8px 18px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.15); color: var(--text-muted); background: rgba(255, 255, 255, 0.02); font-weight: 600; cursor: pointer; transition: all 0.2s;"
            onmouseover="this.style.background='rgba(255, 255, 255, 0.08)';"
            onmouseout="this.style.background='rgba(255, 255, 255, 0.02)';"
            @click="handleConfirmNo"
          >
            取消
          </button>
          <button 
            style="padding: 8px 18px; border-radius: 8px; border: none; color: white; background: var(--color-violet); font-weight: 700; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 12px rgba(139, 92, 246, 0.25);"
            onmouseover="this.style.opacity='0.9';"
            onmouseout="this.style.opacity='1';"
            @click="handleConfirmYes"
          >
            确认
          </button>
        </div>
      </div>
    </div>
  </Transition>

  <!-- Settings Password Verification Modal (Security gate modal overlay, remains as modal) -->
  <Transition name="toast-fade">
    <div v-if="showPasswordModal" class="settings-overlay" @click.self="showPasswordModal = false">
      <div class="settings-modal" style="max-width: 360px;">
        <button class="settings-close" @click="showPasswordModal = false">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="20" height="20"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <h3 class="settings-title">🔑 访问授权验证</h3>
        <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 20px; line-height: 1.5; text-align: left;">
          该模块为高级配置面板。请输入管理员密码进行身份授权。
        </p>
        
        <div class="form-group" style="text-align: left;">
          <label class="form-label">访问密码 (Password)</label>
          <input 
            type="password" 
            v-model="settingsPassword" 
            placeholder="请输入设置访问密码" 
            class="form-input"
            @keyup.enter="verifySettingsPassword"
          />
          <span v-if="passwordErrorMsg" class="err-text" style="display: block; font-size: 0.8rem; color: var(--color-rose); margin-top: 6px;">
            {{ passwordErrorMsg }}
          </span>
        </div>

        <button class="settings-save-btn" @click="verifySettingsPassword">确认授权</button>
      </div>
    </div>
  </Transition>

  <!-- Access Key Modal (for Overseas Platforms download validation, remains as modal) -->
  <Transition name="toast-fade">
    <div v-if="showAccessKeyModal" class="settings-overlay" @click.self="closeAccessKeyModal">
      <div class="settings-modal">
        <button class="settings-close" @click="closeAccessKeyModal">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="20" height="20"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <h3 class="settings-title">🔑 输入外网访问密钥</h3>
        <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 20px; line-height: 1.5; text-align: left;">
          检测到您正在解析或下载海外平台（如 YouTube、TikTok）视频。请配置外网访问密钥以授权下载。
        </p>
        
        <div class="form-group" style="text-align: left;">
          <label class="form-label">访问密钥 (Access Key)</label>
          <input 
            type="password" 
            v-model="tempAccessKey" 
            placeholder="该平台需外网密钥，请输入：" 
            class="form-input"
            @keyup.enter="saveAccessKey"
          />
        </div>

        <button class="settings-save-btn" @click="saveAccessKey">确认提交</button>
      </div>
    </div>
  </Transition>

  <!-- ==================== PAGE: AUTH ==================== -->
    <div v-if="currentPage === 'auth' || !currentUser" class="auth-overlay">
    <div class="auth-card animate-slide-up">
      <!-- Glow decoration elements inside card -->
      <div class="auth-card-glow glow-1"></div>
      <div class="auth-card-glow glow-2"></div>

      <div class="auth-logo">
        <span class="logo-text">VidFetch</span>
        <span class="badge-pro">ULTRA</span>
      </div>
      <p class="auth-subtitle">视频嗅探下载与 AI 智能提取专家</p>
      
      <div class="auth-tabs" v-if="authTab !== 'forgot'">
        <button 
          class="auth-tab-btn" 
          :class="{ 'active': authTab === 'login' }"
          @click="switchAuthTab('login')"
        >
          <span class="tab-btn-icon">🔑</span> 登录
        </button>
        <button 
          class="auth-tab-btn" 
          :class="{ 'active': authTab === 'register' }"
          @click="switchAuthTab('register')"
        >
          <span class="tab-btn-icon">⚡</span> 注册用户
        </button>
      </div>
      <div class="auth-tabs" v-else>
        <button 
          class="auth-tab-btn active"
          @click="switchAuthTab('forgot')"
        >
          🔑 找回密码
        </button>
      </div>
      
      <!-- Login Form -->
      <div v-if="authTab === 'login'" class="auth-form animate-fade-in">
        <div class="form-group">
          <label class="form-label">邮箱 / 用户名</label>
          <div class="input-wrapper" :class="{ 'has-error': authErrors.loginUsername }">
            <span class="input-icon">👤</span>
            <input 
              type="text" 
              v-model="loginUsername" 
              placeholder="请输入邮箱或管理员账号" 
              class="form-input"
              @input="authErrors.loginUsername = ''"
              @keyup.enter="handleLogin"
            />
          </div>
          <Transition name="slide-fade">
            <span v-if="authErrors.loginUsername" class="field-error-msg">
              <span class="error-msg-icon">⚠️</span> {{ authErrors.loginUsername }}
            </span>
          </Transition>
        </div>
        <div class="form-group">
          <label class="form-label">密码</label>
          <div class="input-wrapper" :class="{ 'has-error': authErrors.loginPassword }">
            <span class="input-icon">🔒</span>
            <input 
              type="password" 
              v-model="loginPassword" 
              placeholder="请输入密码" 
              class="form-input"
              @input="authErrors.loginPassword = ''"
              @keyup.enter="handleLogin"
            />
          </div>
          <Transition name="slide-fade">
            <span v-if="authErrors.loginPassword" class="field-error-msg">
              <span class="error-msg-icon">⚠️</span> {{ authErrors.loginPassword }}
            </span>
          </Transition>
        </div>
        <div style="text-align: right; margin-top: -4px; margin-bottom: 8px;">
          <a href="javascript:;" style="color: var(--color-violet); font-size: 0.85rem; text-decoration: none;" @click="switchAuthTab('forgot')">忘记密码？</a>
        </div>
        <button class="auth-submit-btn" @click="handleLogin">登录 VidFetch</button>
      </div>
      
      <!-- Register Form -->
      <div v-else-if="authTab === 'register'" class="auth-form animate-fade-in register-form-compact">
        <div class="form-group">
          <label class="form-label">邮箱地址</label>
          <div class="input-wrapper no-icon" :class="{ 'has-error': authErrors.regUsername }">
            <input 
              type="text" 
              v-model="regUsername" 
              placeholder="请输入您的邮箱" 
              class="form-input"
              @input="authErrors.regUsername = ''"
              @keyup.enter="handleRegister"
            />
          </div>
          <Transition name="slide-fade">
            <span v-if="authErrors.regUsername" class="field-error-msg">
              <span class="error-msg-icon">⚠️</span> {{ authErrors.regUsername }}
            </span>
          </Transition>
        </div>
        <div class="form-group">
          <label class="form-label">设置密码</label>
          <div class="input-wrapper no-icon" :class="{ 'has-error': authErrors.regPassword }">
            <input 
              type="password" 
              v-model="regPassword" 
              placeholder="请输入注册密码 (不少于6位)" 
              class="form-input"
              @input="authErrors.regPassword = ''"
              @keyup.enter="handleRegister"
            />
          </div>
          <Transition name="slide-fade">
            <span v-if="authErrors.regPassword" class="field-error-msg">
              <span class="error-msg-icon">⚠️</span> {{ authErrors.regPassword }}
            </span>
          </Transition>
        </div>
        <div class="form-group">
          <label class="form-label">昵称 (显示名称)</label>
          <div class="input-wrapper no-icon" :class="{ 'has-error': authErrors.regNickname }">
            <input 
              type="text" 
              v-model="regNickname" 
              placeholder="设置您的显示昵称" 
              class="form-input"
              @input="authErrors.regNickname = ''"
              @keyup.enter="handleRegister"
            />
          </div>
          <Transition name="slide-fade">
            <span v-if="authErrors.regNickname" class="field-error-msg">
              <span class="error-msg-icon">⚠️</span> {{ authErrors.regNickname }}
            </span>
          </Transition>
        </div>
        <!-- 图形验证码 -->
        <div class="form-group">
          <label class="form-label">人机验证码</label>
          <div style="display: flex; gap: 12px; align-items: flex-start;">
            <div style="flex: 1; display: flex; flex-direction: column;">
              <div class="input-wrapper no-icon" :class="{ 'has-error': authErrors.regCaptcha }">
                <input 
                  type="text" 
                  v-model="userCaptchaInput" 
                  placeholder="图形验证码" 
                  class="form-input" 
                  @input="authErrors.regCaptcha = ''"
                  @keyup.enter="handleRegister"
                />
              </div>
              <Transition name="slide-fade">
                <span v-if="authErrors.regCaptcha" class="field-error-msg">
                  <span class="error-msg-icon">⚠️</span> {{ authErrors.regCaptcha }}
                </span>
              </Transition>
            </div>
            <canvas 
              ref="captchaCanvasRef" 
              width="100" 
              height="46" 
              style="border-radius: 12px; cursor: pointer; border: 1px solid var(--border-color); background: #111224; flex-shrink: 0; box-shadow: 0 4px 10px rgba(0,0,0,0.3); transition: all 0.2s;" 
              @click="drawCaptcha"
              title="点击刷新验证码"
            ></canvas>
          </div>
        </div>
        <!-- 邮箱验证码 -->
        <div class="form-group">
          <label class="form-label">邮箱验证码</label>
          <div style="display: flex; gap: 12px; align-items: flex-start;">
            <div style="flex: 1; display: flex; flex-direction: column;">
              <div class="input-wrapper no-icon" :class="{ 'has-error': authErrors.regCode }">
                <input 
                  type="text" 
                  v-model="regCode" 
                  placeholder="6位邮箱验证码" 
                  class="form-input" 
                  @input="authErrors.regCode = ''"
                  @keyup.enter="handleRegister"
                />
              </div>
              <Transition name="slide-fade">
                <span v-if="authErrors.regCode" class="field-error-msg">
                  <span class="error-msg-icon">⚠️</span> {{ authErrors.regCode }}
                </span>
              </Transition>
            </div>
            <button 
              class="send-code-btn" 
              :disabled="countdown > 0" 
              @click="handleSendCode('register')"
            >
              {{ countdown > 0 ? `${countdown}s` : '获取验证码' }}
            </button>
          </div>
        </div>
        <button class="auth-submit-btn" @click="handleRegister">确认注册账号</button>
      </div>

      <!-- Forgot Password Form -->
      <div v-else-if="authTab === 'forgot'" class="auth-form animate-fade-in">
        <div class="form-group">
          <label class="form-label">注册邮箱</label>
          <div class="input-wrapper" :class="{ 'has-error': authErrors.resetEmail }">
            <span class="input-icon">✉️</span>
            <input 
              type="text" 
              v-model="resetEmail" 
              placeholder="请输入您绑定的注册邮箱" 
              class="form-input"
              @input="authErrors.resetEmail = ''"
              @keyup.enter="handleResetPassword"
            />
          </div>
          <Transition name="slide-fade">
            <span v-if="authErrors.resetEmail" class="field-error-msg">
              <span class="error-msg-icon">⚠️</span> {{ authErrors.resetEmail }}
            </span>
          </Transition>
        </div>
        <!-- 图形验证码 -->
        <div class="form-group">
          <label class="form-label">人机验证码</label>
          <div style="display: flex; gap: 12px; align-items: flex-start;">
            <div style="flex: 1; display: flex; flex-direction: column;">
              <div class="input-wrapper" :class="{ 'has-error': authErrors.resetCaptcha }">
                <span class="input-icon">🛡️</span>
                <input 
                  type="text" 
                  v-model="userCaptchaInput" 
                  placeholder="图形验证码" 
                  class="form-input" 
                  @input="authErrors.resetCaptcha = ''"
                  @keyup.enter="handleResetPassword"
                />
              </div>
              <Transition name="slide-fade">
                <span v-if="authErrors.resetCaptcha" class="field-error-msg">
                  <span class="error-msg-icon">⚠️</span> {{ authErrors.resetCaptcha }}
                </span>
              </Transition>
            </div>
            <canvas 
              ref="captchaCanvasRef" 
              width="100" 
              height="46" 
              style="border-radius: 12px; cursor: pointer; border: 1px solid var(--border-color); background: #111224; flex-shrink: 0; box-shadow: 0 4px 10px rgba(0,0,0,0.3); transition: all 0.2s;" 
              @click="drawCaptcha"
              title="点击刷新验证码"
            ></canvas>
          </div>
        </div>
        <!-- 邮箱验证码 -->
        <div class="form-group">
          <label class="form-label">邮箱验证码</label>
          <div style="display: flex; gap: 12px; align-items: flex-start;">
            <div style="flex: 1; display: flex; flex-direction: column;">
              <div class="input-wrapper" :class="{ 'has-error': authErrors.resetCode }">
                <span class="input-icon">🔑</span>
                <input 
                  type="text" 
                  v-model="resetCode" 
                  placeholder="6位安全验证码" 
                  class="form-input" 
                  @input="authErrors.resetCode = ''"
                  @keyup.enter="handleResetPassword"
                />
              </div>
              <Transition name="slide-fade">
                <span v-if="authErrors.resetCode" class="field-error-msg">
                  <span class="error-msg-icon">⚠️</span> {{ authErrors.resetCode }}
                </span>
              </Transition>
            </div>
            <button 
              class="send-code-btn" 
              :disabled="countdown > 0" 
              @click="handleSendCode('reset')"
            >
              {{ countdown > 0 ? `${countdown}s` : '获取验证码' }}
            </button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">重置新密码</label>
          <div class="input-wrapper" :class="{ 'has-error': authErrors.resetPassword }">
            <span class="input-icon">🔒</span>
            <input 
              type="password" 
              v-model="resetPassword" 
              placeholder="请输入您的新登录密码" 
              class="form-input"
              @input="authErrors.resetPassword = ''"
              @keyup.enter="handleResetPassword"
            />
          </div>
          <Transition name="slide-fade">
            <span v-if="authErrors.resetPassword" class="field-error-msg">
              <span class="error-msg-icon">⚠️</span> {{ authErrors.resetPassword }}
            </span>
          </Transition>
        </div>
        <button class="auth-submit-btn" @click="handleResetPassword">确认重置密码</button>
        <div style="text-align: center; margin-top: 14px;">
          <a href="javascript:;" style="color: var(--text-muted); font-size: 0.85rem; text-decoration: none; transition: color 0.2s;" @click="switchAuthTab('login')">返回登录</a>
        </div>
      </div>
    </div>
  </div>
  <!-- ==================== MAIN PAGES WRAPPER ==================== -->
  <div class="vidfetch-container" v-else>
    <!-- Top Nav / User Profile Bar -->
    <div class="top-nav-bar" v-if="currentPage === 'main'">
      <div class="nav-user-profile" @click.stop="showProfileDropdown = !showProfileDropdown">
        <img :src="currentUser.avatar" class="nav-avatar" alt="Avatar" />
        <span class="nav-nickname">{{ currentUser.nickname || currentUser.username }}</span>
        <span class="nav-role-badge" :class="currentUser.role">
          {{ currentUser.role === 'admin' ? '管理员' : currentUser.role === 'super' ? '超级用户' : currentUser.role === 'pro' ? 'Pro用户' : '普通用户' }}
        </span>
        <svg class="dropdown-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
        
        <!-- Profile Dropdown Menu -->
        <Transition name="toast-fade">
          <div v-if="showProfileDropdown" class="profile-dropdown-menu">
            <div class="dropdown-header">
              <p class="dropdown-nickname">{{ currentUser.nickname }}</p>
              <p class="dropdown-username">@{{ currentUser.username }}</p>
            </div>
            <div class="dropdown-divider"></div>
            <button class="dropdown-item" @click="openEditProfile">
              👤 个人信息
            </button>
            <button class="dropdown-item" @click="openBenefits">
              💎 查看权益
            </button>
            <button class="dropdown-item" v-if="currentUser.role === 'admin'" @click="openAdminDashboard">
              🖥️ 账号与日志管理
            </button>
            <button class="dropdown-item" @click="triggerSettingsClick" v-if="currentUser.role !== 'user'">
              ⚙️ AI 配置中心
            </button>
            <div class="dropdown-divider"></div>
            <button class="dropdown-item logout" @click="handleLogout">
              🚪 退出登录
            </button>
          </div>
        </Transition>
      </div>
    </div>

    <!-- ==================== currentPage: settings ==================== -->
    <main class="main-card animate-slide-up sub-page" v-if="currentPage === 'settings'">
      <div class="page-header">
        <button class="back-btn" @click="currentPage = 'main'">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="back-icon"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          返回主页
        </button>
        <h2 class="page-title">⚙️ AI 核心配置面板</h2>
      </div>
      
      <div class="settings-page-content animate-fade-in" style="text-align: left; margin-top: 20px;">
        <div class="form-group">
          <label class="form-label">AI 总结大模型服务商选择</label>
          <select v-model="summaryProvider" class="form-input">
            <option value="siliconflow" style="background:#0f1123; color:#f1f5f9;">硅基流动 SiliconFlow (推荐 - 100%免费模型)</option>
            <option value="doubao" style="background:#0f1123; color:#f1f5f9;">火山引擎 (豆包 AI - 需自备 Key/Endpoint)</option>
          </select>
        </div>

        <!-- SiliconFlow LLM Settings -->
        <div v-if="summaryProvider === 'siliconflow'">
          <div class="form-group">
            <label class="form-label">总结 API Key (留空则共用下方 ASR Key)</label>
            <input type="password" v-model="siliconflowLlApiKey" placeholder="输入 SiliconFlow Key，留空则默认共用下方 ASR Key" class="form-input" />
          </div>

          <div class="form-group">
            <label class="form-label">总结模型名称 (Model Name)</label>
            <input type="text" v-model="siliconflowLlModel" placeholder="例如: Qwen/Qwen2.5-7B-Instruct" class="form-input" />
            <span class="form-tip">提示：推荐使用免费高速模型 `Qwen/Qwen2.5-7B-Instruct` 或 `THUDM/glm-4-9b-chat`</span>
          </div>
        </div>

        <!-- Doubao LLM Settings -->
        <div v-if="summaryProvider === 'doubao'">
          <div class="form-group">
            <label class="form-label">火山引擎 API Key</label>
            <input type="password" v-model="doubaoApiKey" placeholder="输入火山引擎以 Bearer 开头的 API Key" class="form-input" />
          </div>

          <div class="form-group">
            <label class="form-label">接入点 Endpoint ID</label>
            <input type="text" v-model="doubaoEndpointId" placeholder="例如: ep-202409xxxx-xxxx" class="form-input" />
            <span class="form-tip">提示：在火山引擎 Ark 控制台部署豆包模型获取 Endpoint ID。</span>
          </div>
        </div>

        <h3 class="settings-title" style="margin-top: 30px; border-top: 1px solid var(--border-color); padding-top: 20px;">🎙️ ASR 语音识别转写配置</h3>
        
        <div class="form-group">
          <label class="form-label">启用语音转文字 (提取视频文案)</label>
          <div class="switch-group">
            <span class="switch-label-status">{{ enableAsr ? '已开启 (切换页签时调用 ASR 服务)' : '未开启 (默认采用原始视频描述)' }}</span>
            <input type="checkbox" v-model="enableAsr" class="glow-checkbox" />
          </div>
        </div>

        <div class="form-group" v-if="enableAsr">
          <label class="form-label">ASR API Key (可使用硅基流动 Key)</label>
          <input type="password" v-model="asrApiKey" placeholder="输入以 Bearer 开头的 ASR Key" class="form-input" />
        </div>

        <div class="form-group" v-if="enableAsr">
          <label class="form-label">ASR Endpoint 接口节点</label>
          <input type="text" v-model="asrEndpoint" placeholder="例如: https://api.siliconflow.cn/v1" class="form-input" />
          <span class="form-tip">提示：兼容 OpenAI 格式。国内服务器部署推荐 `https://api.siliconflow.cn/v1`</span>
        </div>

        <div class="form-group" v-if="enableAsr">
          <label class="form-label">ASR Model 识别模型</label>
          <input type="text" v-model="asrModel" placeholder="例如: FunAudioLLM/SenseVoiceSmall" class="form-input" />
          <span class="form-tip">提示：硅基流动的 `FunAudioLLM/SenseVoiceSmall` 模型完全免费！</span>
        </div>

        <!-- SMTP Mail Server Settings (Only Admin can view/edit) -->
        <div v-if="currentUser && currentUser.role === 'admin'">
          <h3 class="settings-title" style="margin-top: 30px; border-top: 1px solid var(--border-color); padding-top: 20px;">📧 SMTP 系统邮箱验证服务</h3>
          
          <div class="form-group">
            <label class="form-label">SMTP 服务器地址 (Host)</label>
            <input type="text" v-model="smtpHost" placeholder="例如: smtp.qq.com 或 smtp.163.com" class="form-input" />
            <span class="form-tip">提示：如果留空，验证码将以模拟形式打印至后端 Node 控制台终端（开发环境专用）。</span>
          </div>

          <div class="form-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
            <div class="form-group">
              <label class="form-label">SMTP 端口 (Port)</label>
              <input type="number" v-model="smtpPort" placeholder="例如: 465 或 587" class="form-input" />
            </div>
            <div class="form-group">
              <label class="form-label">发件人显示名称 (Sender Name)</label>
              <input type="text" v-model="smtpSenderName" placeholder="例如: VidFetch 验证服务" class="form-input" />
            </div>
          </div>

          <div class="form-group" style="margin-top: 10px; display: flex; align-items: center;">
            <label class="form-label" style="display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none;">
              <input type="checkbox" v-model="smtpSecure" style="width: 16px; height: 16px;" />
              <span>使用 SSL 安全连接 (Secure)</span>
            </label>
          </div>
          <span class="form-tip" style="margin-top: -10px; display: block; margin-bottom: 15px;">提示：通常 465 端口需要勾选 SSL。如果是 587 或 25 端口则不勾选。</span>

          <div class="form-group">
            <label class="form-label">邮箱账号 (SMTP User)</label>
            <input type="text" v-model="smtpUser" placeholder="您的发件邮箱地址，例如: myusername@qq.com" class="form-input" />
          </div>

          <div class="form-group">
            <label class="form-label">邮箱授权码 / 密码 (SMTP Pass)</label>
            <input type="password" v-model="smtpPass" placeholder="请输入 SMTP 授权码或独立密码" class="form-input" />
            <span class="form-tip">提示：网易 163 邮箱和腾讯 QQ 邮箱通常需要前往设置 -> 账户开启 SMTP 并生成“授权码”填入此处，而非邮箱原始密码。</span>
          </div>
        </div>

        <button class="settings-save-btn" style="margin-top: 20px;" @click="saveSettings">保存配置并生效</button>
        
        <div style="display: flex; gap: 12px; margin-top: 24px; align-items: center; border-top: 1px dashed var(--border-color); padding-top: 20px;" v-if="currentUser && currentUser.role === 'admin'">
          <button 
            class="ex-btn" 
            style="flex: 1; max-width: 200px; height: 42px; display: flex; justify-content: center; align-items: center; gap: 6px; border: 1px solid rgba(244, 63, 94, 0.3); color: #f43f5e; background: rgba(244, 63, 94, 0.05); font-weight: 700; cursor: pointer; border-radius: 10px; transition: all 0.2s;"
            onmouseover="this.style.background='rgba(244, 63, 94, 0.15)';"
            onmouseout="this.style.background='rgba(244, 63, 94, 0.05)';"
            @click="handleRestoreSettings"
          >
            🔄 重置系统配置
          </button>
        </div>
      </div>
    </main>

    <!-- ==================== currentPage: profile ==================== -->
    <main class="main-card animate-slide-up sub-page" v-else-if="currentPage === 'profile'">
      <div class="page-header">
        <button class="back-btn" @click="currentPage = 'main'">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="back-icon"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          返回主页
        </button>
        <h2 class="page-title">{{ isEditingProfile ? '👤 编辑个人信息' : '👤 个人信息' }}</h2>
      </div>
      
      <!-- Read-only View Mode -->
      <div v-if="!isEditingProfile" class="settings-page-content animate-fade-in" style="text-align: left; margin-top: 20px;">
        <div style="display: flex; align-items: center; gap: 20px; margin-bottom: 30px; background: rgba(255,255,255,0.02); padding: 20px; border-radius: 16px; border: 1px solid var(--border-color);">
          <img :src="currentUser?.avatar" style="width: 72px; height: 72px; border-radius: 50%; background: rgba(255,255,255,0.05); border: 2px solid var(--color-violet);" alt="用户头像" />
          <div>
            <div style="font-size: 1.4rem; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
              {{ currentUser?.nickname }}
              <span class="role-badge" :class="currentUser?.role">
                {{ currentUser?.role === 'admin' ? '管理员' : currentUser?.role === 'super' ? '超级用户' : currentUser?.role === 'pro' ? 'Pro用户' : '普通用户' }}
              </span>
            </div>
            <div style="font-size: 0.9rem; color: var(--text-muted); margin-top: 4px;">用户名: {{ currentUser?.username }}</div>
          </div>
        </div>

        <div class="profile-view-list" style="display: flex; flex-direction: column; gap: 16px;">
          <div style="border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 12px;">
            <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 4px;">注册邮箱 (脱敏保护)</div>
            <div style="font-size: 1.05rem; font-weight: 500; color: var(--text-primary);">{{ maskedEmail }}</div>
          </div>
          
          <div style="border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 12px;">
            <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 4px;">个人简介</div>
            <div style="font-size: 1.05rem; font-weight: 500; color: var(--text-primary); line-height: 1.5; min-height: 24px;">
              {{ currentUser?.bio || '这家伙很懒，什么都没有留下。' }}
            </div>
          </div>
          
          <div style="border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 12px;">
            <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 4px;">头像随机种子</div>
            <div style="font-size: 1.05rem; font-weight: 500; color: var(--text-primary); font-family: monospace;">
              {{ editAvatarSeed }}
            </div>
          </div>
        </div>

        <div style="display: flex; gap: 16px; margin-top: 35px; align-items: center;">
          <button 
            class="ex-btn" 
            style="width: 150px; height: 42px; display: flex; justify-content: center; align-items: center; gap: 6px; border: 1px solid rgba(139, 92, 246, 0.4); color: #c084fc; background: rgba(139, 92, 246, 0.08); font-weight: 700; cursor: pointer; border-radius: 10px; transition: all 0.2s;"
            onmouseover="this.style.background='rgba(139, 92, 246, 0.18)';"
            onmouseout="this.style.background='rgba(139, 92, 246, 0.08)';"
            @click="isEditingProfile = true"
          >
            ✍️ 编辑个人资料
          </button>
          <button class="change-pw-trigger-btn" style="height: 42px; border-radius: 10px;" @click="openChangePasswordModal">🔐 修改登录密码</button>
        </div>
      </div>

      <!-- Edit Mode -->
      <div v-else class="settings-page-content animate-fade-in" style="text-align: left; margin-top: 20px;">
        <div class="form-group">
          <label class="form-label">注册账号 (不可编辑)</label>
          <input type="text" :value="maskedEmail" disabled class="form-input" style="opacity: 0.6; cursor: not-allowed; background: rgba(255,255,255,0.02);" />
        </div>

        <div class="form-group">
          <label class="form-label">昵称 (显示昵称)</label>
          <input type="text" v-model="editNickname" placeholder="请输入您的昵称" class="form-input" />
        </div>

        <div class="form-group">
          <label class="form-label">个人简介</label>
          <textarea v-model="editBio" placeholder="用一句话介绍自己吧..." class="form-input" style="height: 80px; resize: none; padding: 10px 14px; line-height: 1.5; font-family: inherit;"></textarea>
        </div>
        
        <div class="form-group">
          <label class="form-label">头像随机种子 (基于 Dicebear 生成)</label>
          <div style="display: flex; gap: 12px; align-items: center;">
            <input type="text" v-model="editAvatarSeed" placeholder="输入文字生成专属头像" class="form-input" style="flex: 1;" />
            <img :src="`https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(editAvatarSeed || currentUser?.username)}`" style="width: 48px; height: 48px; border-radius: 8px; background: rgba(255,255,255,0.05); border: 1px solid var(--border-color);" alt="头像预览" />
          </div>
        </div>
        
        <div style="display: flex; gap: 16px; margin-top: 30px; align-items: center;">
          <button class="settings-save-btn" style="margin-top: 0; width: 150px;" @click="handleProfileUpdate">保存修改</button>
          <button 
            class="ex-btn" 
            style="width: 100px; height: 42px; display: flex; justify-content: center; align-items: center; gap: 6px; border: 1px solid rgba(255, 255, 255, 0.15); color: var(--text-muted); background: rgba(255, 255, 255, 0.02); font-weight: 600; cursor: pointer; border-radius: 10px; transition: all 0.2s;"
            onmouseover="this.style.background='rgba(255,255,255,0.08)';"
            onmouseout="this.style.background='rgba(255,255,255,0.02)';"
            @click="isEditingProfile = false"
          >
            取消
          </button>
        </div>
      </div>
    </main>

    <!-- ==================== currentPage: benefits ==================== -->
    <main class="main-card animate-slide-up sub-page" v-else-if="currentPage === 'benefits'">
      <div class="page-header">
        <button class="back-btn" @click="currentPage = 'main'">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="back-icon"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          返回主页
        </button>
        <h2 class="page-title">💎 我的权益与升级套餐</h2>
      </div>

      <div class="benefits-container animate-fade-in" style="text-align: left; margin-top: 20px;">
        <!-- Top Summary Cards -->
        <div class="bento-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px;">
          <!-- Card 1: Role -->
          <div class="bento-card" style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); padding: 18px; border-radius: 14px;">
            <div style="font-size: 0.85rem; color: var(--text-muted);">当前账号角色</div>
            <div style="font-size: 1.4rem; font-weight: 700; margin-top: 8px; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
              {{ currentUser?.role === 'admin' ? '系统管理员' : currentUser?.role === 'super' ? '超级普通用户' : currentUser?.role === 'pro' ? 'Pro专业用户' : '普通免费用户' }}
              <span class="role-badge" :class="currentUser?.role">
                {{ currentUser?.role === 'admin' ? '管理员' : currentUser?.role === 'super' ? '超级用户' : currentUser?.role === 'pro' ? 'Pro用户' : '普通用户' }}
              </span>
            </div>
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 6px;">
              {{ currentUser?.role === 'user' ? '升级为 Pro 账号可享无限制下载' : '已享受无限制解析权限' }}
            </div>
          </div>
          
          <!-- Card 2: Quota & Usage -->
          <div class="bento-card" style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); padding: 18px; border-radius: 14px;">
            <div style="font-size: 0.85rem; color: var(--text-muted);">今日已用解析额度</div>
            <div style="font-size: 1.4rem; font-weight: 700; margin-top: 8px; color: var(--text-primary);">
              <span style="color: var(--color-violet);">{{ currentUser?.role === 'user' ? (5 - currentUser?.remaining) : (currentUser?.usage?.[new Date().toISOString().split('T')[0]] || 0) }}</span> 
              <span style="color: var(--text-muted); font-weight: normal; font-size: 1rem;"> / </span>
              <span>{{ currentUser?.role === 'admin' || currentUser?.role === 'super' || currentUser?.role === 'pro' ? '∞ (无限制)' : '5 次' }}</span>
            </div>
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 6px;">
              {{ currentUser?.role === 'user' ? `今天剩余可用 ${currentUser?.remaining} 次` : '无限量高速提取专线可用' }}
            </div>
          </div>
        </div>

        <!-- Package Upgrade Grid -->
        <h3 style="font-size: 1.25rem; font-weight: 800; margin-top: 10px; margin-bottom: 20px; color: var(--text-primary); text-align: center;">⚡ 套餐升级与对比</h3>
        
        <div class="benefits-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; margin-bottom: 35px;">
          <!-- 1. Free Plan -->
          <div class="pkg-card" style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); padding: 28px; border-radius: 20px; display: flex; flex-direction: column; justify-content: space-between;">
            <div>
              <div style="font-size: 1.2rem; font-weight: 700; color: var(--text-secondary);">免费基础版</div>
              <div style="margin-top: 15px; display: flex; align-items: baseline;">
                <span style="font-size: 2.2rem; font-weight: 800; color: var(--text-primary);">¥0</span>
                <span style="color: var(--text-muted); margin-left: 4px; font-size: 0.9rem;">/ 永久</span>
              </div>
              <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 8px; line-height: 1.4;">适合轻度自媒体创作者日常临时解析下载。</div>
              <div style="margin-top: 24px; border-top: 1px dashed rgba(255,255,255,0.05); padding-top: 20px;">
                <ul style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; font-size: 0.9rem;">
                  <li style="display: flex; align-items: center; gap: 8px;">
                    <span style="color: #10b981;">✓</span> <span>每日限制解析提取 5 次</span>
                  </li>
                  <li style="display: flex; align-items: center; gap: 8px;">
                    <span style="color: #10b981;">✓</span> <span>主流短视频平台无水印解析</span>
                  </li>
                  <li style="display: flex; align-items: center; gap: 8px;">
                    <span style="color: #10b981;">✓</span> <span>ASR 语音转文字 (最大 30MB)</span>
                  </li>
                  <li style="display: flex; align-items: center; gap: 8px; color: var(--text-muted); opacity: 0.5;">
                    <span style="color: #f43f5e;">✗</span> <span>不支持高并发快速下载通道</span>
                  </li>
                  <li style="display: flex; align-items: center; gap: 8px; color: var(--text-muted); opacity: 0.5;">
                    <span style="color: #f43f5e;">✗</span> <span>无企业级管理员审计与系统配置</span>
                  </li>
                </ul>
              </div>
            </div>
            
            <button 
              disabled 
              style="margin-top: 30px; width: 100%; height: 42px; background: rgba(255,255,255,0.05); color: var(--text-muted); border: 1px solid rgba(255,255,255,0.08); font-weight: 700; border-radius: 12px; cursor: not-allowed;"
            >
              当前套餐
            </button>
          </div>

          <!-- 2. Pro Plan (Monthly) -->
          <div class="pkg-card pro-card" style="background: linear-gradient(135deg, rgba(139, 92, 246, 0.05) 0%, rgba(6, 182, 212, 0.05) 100%); border: 2px solid #8b5cf6; padding: 28px; border-radius: 20px; display: flex; flex-direction: column; justify-content: space-between; position: relative; box-shadow: 0 10px 30px rgba(139, 92, 246, 0.15);">
            <div style="position: absolute; top: -12px; right: 20px; background: linear-gradient(90deg, #8b5cf6, #06b6d4); color: white; padding: 4px 12px; border-radius: 20px; font-size: 0.75rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">最常用</div>
            <div>
              <div style="font-size: 1.25rem; font-weight: 800; color: #a78bfa; display: flex; align-items: center; gap: 6px;">
                💎 Pro 专业版
              </div>
              <div style="margin-top: 15px; display: flex; align-items: baseline;">
                <span style="font-size: 2.2rem; font-weight: 800; color: var(--text-primary);">¥20</span>
                <span style="color: var(--text-muted); margin-left: 4px; font-size: 0.9rem;">/ 月</span>
              </div>
              <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 8px; line-height: 1.4;">适合高频自媒体创作者、剪辑团队、文案提炼研究者。</div>
              <div style="margin-top: 24px; border-top: 1px dashed rgba(139, 92, 246, 0.2); padding-top: 20px;">
                <ul style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; font-size: 0.9rem;">
                  <li style="display: flex; align-items: center; gap: 8px;">
                    <span style="color: #a78bfa; font-weight: 900;">★</span> <span><strong>无任何解析次数限制 (无限次)</strong></span>
                  </li>
                  <li style="display: flex; align-items: center; gap: 8px;">
                    <span style="color: #10b981;">✓</span> <span>极速并发下载与提取 (满速不限流)</span>
                  </li>
                  <li style="display: flex; align-items: center; gap: 8px;">
                    <span style="color: #10b981;">✓</span> <span>超长 ASR 语音识别 (支持最大 200MB 视频)</span>
                  </li>
                  <li style="display: flex; align-items: center; gap: 8px;">
                    <span style="color: #10b981;">✓</span> <span>尊享 DeepSeek/Qwen 核心总结大模型通道</span>
                  </li>
                  <li style="display: flex; align-items: center; gap: 8px;">
                    <span style="color: #10b981;">✓</span> <span>享有个人尊贵权益 Pro 星环标识</span>
                  </li>
                </ul>
              </div>
            </div>
            
            <button 
              @click="upgradePlan('pro_monthly')"
              style="margin-top: 30px; width: 100%; height: 42px; background: linear-gradient(90deg, #8b5cf6, #06b6d4); color: white; border: none; font-weight: 700; border-radius: 12px; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 15px rgba(139, 92, 246, 0.3);"
              onmouseover="this.style.opacity='0.9'; this.style.transform='translateY(-1px)';"
              onmouseout="this.style.opacity='1'; this.style.transform='translateY(0)';"
            >
              {{ currentUser?.role === 'pro' ? '已是 Pro 权益' : '立即升级 Pro 专业版' }}
            </button>
          </div>

          <!-- 3. Lifetime Plan -->
          <div class="pkg-card" style="background: rgba(255,255,255,0.02); border: 2px solid rgba(56, 189, 248, 0.4); padding: 28px; border-radius: 20px; display: flex; flex-direction: column; justify-content: space-between; position: relative; box-shadow: 0 10px 30px rgba(56, 189, 248, 0.05);">
            <div style="position: absolute; top: -12px; right: 20px; background: #0284c7; color: white; padding: 4px 12px; border-radius: 20px; font-size: 0.75rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">超值</div>
            <div>
              <div style="font-size: 1.25rem; font-weight: 800; color: #38bdf8; display: flex; align-items: center; gap: 6px;">
                👑 Pro 永久版
              </div>
              <div style="margin-top: 15px; display: flex; align-items: baseline;">
                <span style="font-size: 2.2rem; font-weight: 800; color: var(--text-primary);">¥199</span>
                <span style="color: var(--text-muted); margin-left: 4px; font-size: 0.9rem;">/ 永久</span>
              </div>
              <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 8px; line-height: 1.4;">一次购买，终身享有。适合高产自媒体工作室、极客玩家。</div>
              <div style="margin-top: 24px; border-top: 1px dashed rgba(56, 189, 248, 0.2); padding-top: 20px;">
                <ul style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; font-size: 0.9rem;">
                  <li style="display: flex; align-items: center; gap: 8px;">
                    <span style="color: #38bdf8; font-weight: 900;">★</span> <span><strong>终身无任何解析次数限制 (无限次)</strong></span>
                  </li>
                  <li style="display: flex; align-items: center; gap: 8px;">
                    <span style="color: #10b981;">✓</span> <span>享有所有 Pro 尊享级全部权益</span>
                  </li>
                  <li style="display: flex; align-items: center; gap: 8px;">
                    <span style="color: #10b981;">✓</span> <span>永久免费享用后续所有新版功能更新</span>
                  </li>
                  <li style="display: flex; align-items: center; gap: 8px;">
                    <span style="color: #10b981;">✓</span> <span>尊享物理宽带独立 VIP 嗅探专线通道</span>
                  </li>
                  <li style="display: flex; align-items: center; gap: 8px;">
                    <span style="color: #10b981;">✓</span> <span>24小时全天候专属技术群极速支持</span>
                  </li>
                </ul>
              </div>
            </div>
            
            <button 
              @click="upgradePlan('pro_lifetime')"
              style="margin-top: 30px; width: 100%; height: 42px; background: rgba(56, 189, 248, 0.12); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.35); font-weight: 700; border-radius: 12px; cursor: pointer; transition: all 0.2s;"
              onmouseover="this.style.background='rgba(56, 189, 248, 0.22)'; this.style.transform='translateY(-1px)';"
              onmouseout="this.style.background='rgba(56, 189, 248, 0.12)'; this.style.transform='translateY(0)';"
            >
              {{ currentUser?.role === 'pro' ? '已是 Pro 权益' : '立即开通永久版' }}
            </button>
          </div>
        </div>

        <!-- Visual Analytics Usage Chart (Moved Below Packages) -->
        <div class="benefits-chart-card" style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); padding: 20px; border-radius: 16px; margin-bottom: 30px;">
          <h3 style="font-size: 1.1rem; font-weight: 700; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; color: var(--text-primary);">
            <span>📈 近 30 天提取频率趋势 (每日解析次数)</span>
          </h3>
          
          <div class="chart-container" style="position: relative; width: 100%;">
            <!-- SVG Line Chart -->
            <svg viewBox="0 0 500 200" class="svg-chart" style="width: 100%; height: auto; display: block; overflow: visible;">
              <!-- Gradients -->
              <defs>
                <linearGradient id="chart-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="rgba(139, 92, 246, 0.4)"/>
                  <stop offset="100%" stop-color="rgba(139, 92, 246, 0)"/>
                </linearGradient>
                <linearGradient id="line-grad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stop-color="#8b5cf6"/>
                  <stop offset="100%" stop-color="#06b6d4"/>
                </linearGradient>
              </defs>
              
              <!-- Grid lines -->
              <line x1="40" y1="20" x2="480" y2="20" stroke="rgba(255,255,255,0.04)" stroke-dasharray="3,3" />
              <line x1="40" y1="70" x2="480" y2="70" stroke="rgba(255,255,255,0.04)" stroke-dasharray="3,3" />
              <line x1="40" y1="120" x2="480" y2="120" stroke="rgba(255,255,255,0.04)" stroke-dasharray="3,3" />
              <line x1="40" y1="170" x2="480" y2="170" stroke="rgba(255,255,255,0.08)" stroke-width="1.5" />

              <!-- Y axis labels -->
              <text x="12" y="24" fill="rgba(255,255,255,0.3)" font-size="10" font-weight="600" text-anchor="start">{{ maxUsageValue }}</text>
              <text x="12" y="99" fill="rgba(255,255,255,0.3)" font-size="10" font-weight="600" text-anchor="start">{{ Math.round(maxUsageValue / 2) }}</text>
              <text x="12" y="174" fill="rgba(255,255,255,0.3)" font-size="10" font-weight="600" text-anchor="start">0</text>

              <!-- SVG Path for Area -->
              <path :d="chartAreaPath" fill="url(#chart-grad)" />
              <!-- SVG Path for Line -->
              <path :d="chartLinePath" fill="none" stroke="url(#line-grad)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
              
              <!-- Dots for all data points (interactive on hover) -->
              <g v-for="(pt, idx) in chartPoints" :key="idx"
                 @mouseenter="hoveredPoint = pt"
                 @mouseleave="hoveredPoint = null"
                 style="cursor: pointer;"
              >
                <!-- Invisible larger hit area for easier hover -->
                <circle :cx="pt.x" :cy="pt.y" r="10" fill="transparent" />
                <!-- Visible circle -->
                <circle :cx="pt.x" :cy="pt.y" :r="hoveredPoint?.dateStr === pt.dateStr ? 6 : 4" :fill="hoveredPoint?.dateStr === pt.dateStr ? '#22d3ee' : '#06b6d4'" :stroke="hoveredPoint?.dateStr === pt.dateStr ? '#fff' : '#0f1123'" stroke-width="2" />
              </g>
            </svg>
            
            <!-- X-axis Labels below SVG -->
            <div class="chart-x-labels" style="display: flex; justify-content: space-between; margin-left: 40px; margin-right: 20px; margin-top: 8px;">
              <span v-for="lbl in chartXLabels" :key="lbl" style="font-size: 0.75rem; color: var(--text-muted); font-weight: 500;">{{ lbl }}</span>
            </div>

            <!-- Hover Tooltip -->
            <div v-if="hoveredPoint" class="chart-tooltip" :style="{ left: hoveredPoint.pctX + '%', top: (hoveredPoint.pctY - 12) + '%' }">
              <div style="font-weight: 700; font-size: 0.85rem; color: var(--text-primary); margin-bottom: 2px;">{{ hoveredPoint.dateStr }}</div>
              <div style="font-size: 0.8rem; color: #c084fc; font-weight: 700;">总解析次数: {{ hoveredPoint.count }} 次</div>
              <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px; line-height: 1.3; white-space: normal; word-break: break-all;">
                {{ hoveredPoint.details }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- ==================== currentPage: admin ==================== -->
    <main class="main-card animate-slide-up sub-page" v-else-if="currentPage === 'admin'">
      <div class="page-header">
        <button class="back-btn" @click="currentPage = 'main'">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="back-icon"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          返回主页
        </button>
        <h2 class="page-title">🖥️ VidFetch 管理员后台</h2>
      </div>
      
      <div class="admin-tabs" style="margin-top: 20px;">
        <button 
          class="admin-tab-btn" 
          :class="{ 'active': adminTab === 'users' }"
          @click="adminTab = 'users'; inspectedUser = null"
        >
          👥 账号管理
        </button>
        <button 
          class="admin-tab-btn" 
          :class="{ 'active': adminTab === 'logs' }"
          @click="adminTab = 'logs'; inspectedUser = null"
        >
          📋 操作日志审计
        </button>
      </div>
      
      <!-- Users Tab -->
      <div v-if="adminTab === 'users'" class="admin-pane animate-fade-in">
        <!-- User Detail Panel -->
        <div v-if="inspectedUser" class="user-detail-panel animate-fade-in">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; border-bottom: 1px solid var(--border-color); padding-bottom: 14px;">
            <h3 style="margin: 0; font-size: 1.15rem; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
              👤 用户详情: {{ inspectedUser.nickname || inspectedUser.username }}
            </h3>
            <button class="back-btn" style="padding: 6px 12px; font-size: 0.8rem;" @click="inspectedUser = null">
              返回列表
            </button>
          </div>
          
          <div style="display: flex; gap: 24px; align-items: flex-start; flex-wrap: wrap;">
            <!-- Left part: Avatar and role -->
            <div style="display: flex; flex-direction: column; align-items: center; gap: 12px; width: 120px; flex-shrink: 0;">
              <img :src="inspectedUser.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(inspectedUser.username)}`" style="width: 80px; height: 80px; border-radius: 50%; background: rgba(255,255,255,0.05); border: 2px solid var(--border-color);" alt="头像" />
              <span class="role-badge" :class="inspectedUser.role">
                {{ inspectedUser.role === 'admin' ? '管理员' : inspectedUser.role === 'super' ? '超级用户' : inspectedUser.role === 'pro' ? 'Pro用户' : '普通用户' }}
              </span>
            </div>
            
            <!-- Right part: Profile information fields -->
            <div style="flex: 1; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
              <div>
                <label style="color: var(--text-muted); font-size: 0.8rem; display: block; margin-bottom: 4px;">账号 (用户名 / 邮箱)</label>
                <div style="color: var(--text-primary); font-weight: 600; font-size: 0.95rem; word-break: break-all;">{{ inspectedUser.username }}</div>
              </div>
              <div>
                <label style="color: var(--text-muted); font-size: 0.8rem; display: block; margin-bottom: 4px;">显示昵称</label>
                <div style="color: var(--text-primary); font-weight: 600; font-size: 0.95rem;">{{ inspectedUser.nickname }}</div>
              </div>
              <div>
                <label style="color: var(--text-muted); font-size: 0.8rem; display: block; margin-bottom: 4px;">绑定邮箱</label>
                <div style="color: var(--text-primary); font-weight: 600; font-size: 0.95rem; word-break: break-all;">{{ inspectedUser.email || '未绑定邮箱' }}</div>
              </div>
              <div>
                <label style="color: var(--text-muted); font-size: 0.8rem; display: block; margin-bottom: 4px;">角色有效期</label>
                <div v-if="inspectedUser.roleExpireAt" style="color: #f43f5e; font-weight: 700; font-size: 0.95rem;">
                  📅 过期时间: {{ formatDate(inspectedUser.roleExpireAt) }}
                </div>
                <div v-else-if="inspectedUser.role !== 'user'" style="color: #10b981; font-weight: 700; font-size: 0.95rem;">
                  ♾️ 永久有效
                </div>
                <div v-else style="color: var(--text-secondary); font-size: 0.95rem;">
                  -
                </div>
              </div>
              <div>
                <label style="color: var(--text-muted); font-size: 0.8rem; display: block; margin-bottom: 4px;">今日已提取次数</label>
                <div style="color: var(--text-primary); font-weight: 700; font-size: 1.1rem;">
                  {{ inspectedUser.usage[new Date().toISOString().split('T')[0]] || 0 }} 
                  <span style="font-size: 0.85rem; font-weight: normal; color: var(--text-secondary);"> / {{ inspectedUser.role === 'admin' || inspectedUser.role === 'super' || inspectedUser.role === 'pro' ? '∞' : '5' }}</span>
                </div>
              </div>
              <div style="grid-column: 1 / -1;">
                <label style="color: var(--text-muted); font-size: 0.8rem; display: block; margin-bottom: 4px;">个人简介</label>
                <div style="color: var(--text-secondary); font-size: 0.9rem; line-height: 1.5; background: rgba(255,255,255,0.01); padding: 10px 14px; border-radius: 8px; border: 1px solid var(--border-color); min-height: 50px; white-space: pre-wrap;">
                  {{ inspectedUser.bio || '这家伙很懒，什么都没有留下。' }}
                </div>
              </div>
            </div>
          </div>
          
          <!-- Role Update Section -->
          <div v-if="inspectedUser.username !== 'mediaAdmin' && inspectedUser.username !== 'mediaSuper'" class="role-update-section">
            <h4 style="margin: 0 0 16px 0; font-size: 0.95rem; color: var(--text-primary); font-weight: 700; display: flex; align-items: center; gap: 6px;">
              🔑 修改用户角色及有效期
            </h4>
            <div style="display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-end;">
              <div class="form-group" style="margin-bottom: 0; min-width: 160px; flex: 1;">
                <label class="form-label" style="font-size: 0.8rem; margin-bottom: 4px;">目标角色</label>
                <select v-model="editRole" class="form-input" style="padding: 8px 12px; font-size: 0.85rem; margin-bottom: 0; height: 38px;">
                  <option value="user" style="background:#0f1123; color:#f1f5f9;">普通用户 (日限5次)</option>
                  <option value="pro" style="background:#0f1123; color:#f1f5f9;">Pro用户 (无限提取)</option>
                  <option value="super" style="background:#0f1123; color:#f1f5f9;">超级用户 (无限，限1个)</option>
                  <option value="admin" style="background:#0f1123; color:#f1f5f9;">系统管理员 (无限，限1个)</option>
                </select>
              </div>
              
              <div v-if="editRole !== 'user'" class="form-group" style="margin-bottom: 0; min-width: 140px; flex: 1;">
                <label class="form-label" style="font-size: 0.8rem; margin-bottom: 4px;">有效期类型</label>
                <select v-model="editValidityType" class="form-input" style="padding: 8px 12px; font-size: 0.85rem; margin-bottom: 0; height: 38px;">
                  <option value="permanent" style="background:#0f1123; color:#f1f5f9;">永久有效</option>
                  <option value="day" style="background:#0f1123; color:#f1f5f9;">按天数设置</option>
                  <option value="month" style="background:#0f1123; color:#f1f5f9;">按月份设置</option>
                  <option value="year" style="background:#0f1123; color:#f1f5f9;">按年份设置</option>
                </select>
              </div>
              
              <div v-if="editRole !== 'user' && editValidityType !== 'permanent'" class="form-group" style="margin-bottom: 0; max-width: 100px; flex: 1;">
                <label class="form-label" style="font-size: 0.8rem; margin-bottom: 4px;">有效期数值</label>
                <input type="number" min="1" v-model.number="editValidityValue" class="form-input" style="padding: 8px 12px; font-size: 0.85rem; margin-bottom: 0; height: 38px;" />
              </div>
              
              <button 
                class="settings-save-btn" 
                style="margin-top: 0; height: 38px; padding: 0 16px; font-size: 0.85rem; font-weight: 700; background: linear-gradient(90deg, #8b5cf6, #d946ef);" 
                @click="handleUpdateRole"
              >
                保存并生效
              </button>
            </div>
          </div>
          
          <div style="display: flex; gap: 12px; margin-top: 30px; border-top: 1px solid var(--border-color); padding-top: 20px; flex-wrap: wrap;">
            <button 
              class="settings-save-btn" 
              style="margin-top: 0; padding: 10px 18px; font-size: 0.88rem; background: var(--gradient-glow); border: none; border-radius: 8px; color: white; pointer-events: auto; cursor: pointer; font-weight: 700; display: flex; align-items: center; gap: 6px;"
              @click="quickViewLogs(inspectedUser.username, 'all')"
            >
              📅 查看历史操作日志
            </button>
            <button 
              class="settings-save-btn" 
              style="margin-top: 0; padding: 10px 18px; font-size: 0.88rem; background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); color: #34d399; border-radius: 8px; cursor: pointer; font-weight: 700; display: flex; align-items: center; gap: 6px;"
              onmouseover="this.style.background='rgba(16, 185, 129, 0.25)';"
              onmouseout="this.style.background='rgba(16, 185, 129, 0.15)';"
              @click="quickViewLogs(inspectedUser.username, 'today')"
            >
              ⚡ 查看今日筛选日志
            </button>
            <button 
              class="ex-btn" 
              style="padding: 10px 18px; border-radius: 8px; font-size: 0.88rem; font-weight: 700;" 
              @click="inspectedUser = null"
            >
              返回列表
            </button>
          </div>
        </div>

        <div v-else class="animate-fade-in" style="display: flex; flex-direction: column; width: 100%;">
          <div class="admin-action-row" style="text-align: left; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px; width: 100%;">
            <button class="create-user-toggle-btn" @click="showCreateUserForm = !showCreateUserForm">
              {{ showCreateUserForm ? '❌ 取消创建' : '➕ 创建新账号' }}
            </button>
            <div style="position: relative; width: 260px;">
              <input 
                type="text" 
                v-model="searchUserQuery" 
                placeholder="🔍 搜索昵称、账号或邮箱..." 
                class="form-input" 
                style="height: 38px; padding-left: 36px; padding-right: 12px; font-size: 0.85rem; border-radius: 8px; margin-bottom: 0;"
              />
              <span style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-muted); font-size: 0.9rem; pointer-events: none;">
                🔍
              </span>
            </div>
          </div>
          
          <!-- Create User Form -->
          <div v-if="showCreateUserForm" class="create-user-form animate-fade-in" style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); padding: 20px; border-radius: 12px; margin-bottom: 20px; text-align: left;">
            <div class="form-grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px;">
              <div class="form-group">
                <label class="form-label">用户名</label>
                <input type="text" v-model="createUsername" placeholder="用户名" class="form-input" />
              </div>
              <div class="form-group">
                <label class="form-label">密码</label>
                <input type="password" v-model="createPassword" placeholder="密码" class="form-input" />
              </div>
              <div class="form-group">
                <label class="form-label">昵称</label>
                <input type="text" v-model="createNickname" placeholder="显示昵称" class="form-input" />
              </div>
              <div class="form-group">
                <label class="form-label">角色类型</label>
                <select v-model="createRole" class="form-input">
                  <option value="user" style="background:#0f1123; color:#f1f5f9;">普通用户 (日限5次)</option>
                  <option value="pro" style="background:#0f1123; color:#f1f5f9;">Pro用户 (无限制，不限个数)</option>
                  <option value="super" style="background:#0f1123; color:#f1f5f9;">超级用户 (无限制，限1个)</option>
                  <option value="admin" style="background:#0f1123; color:#f1f5f9;">系统管理员 (无限制，限1个)</option>
                </select>
              </div>
              <div class="form-group" style="grid-column: span 2;">
                <label class="form-label">邮箱 (可用于找回重置密码，选填)</label>
                <input type="text" v-model="createEmail" placeholder="例如: user@example.com" class="form-input" />
              </div>
            </div>
            <button class="settings-save-btn" style="margin-top: 10px;" @click="handleCreateUser">确认创建账号</button>
          </div>
          
          <!-- Users List Table -->
          <div class="table-container">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>用户昵称</th>
                  <th>账号名</th>
                  <th>角色</th>
                  <th>今日已提取</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="user in filteredAdminUsers" :key="user.username">
                  <td>
                    <div class="table-user-cell" style="display: flex; align-items: center; gap: 8px;">
                      <img :src="user.avatar" class="table-avatar" style="width: 28px; height: 28px; border-radius: 50%; background: rgba(255,255,255,0.05);" />
                      <span style="font-weight: 600;">{{ user.nickname }}</span>
                    </div>
                  </td>
                  <td>{{ user.username }}</td>
                  <td>
                    <span class="role-badge" :class="user.role">
                      {{ user.role === 'admin' ? '管理员' : user.role === 'super' ? '超级用户' : user.role === 'pro' ? 'Pro用户' : '普通用户' }}
                    </span>
                  </td>
                  <td>
                    <span style="font-weight: 700; color: var(--text-primary);">{{ user.usage[new Date().toISOString().split('T')[0]] || 0 }}</span> / 
                    <span>{{ user.role === 'admin' || user.role === 'super' || user.role === 'pro' ? '∞' : '5' }}</span>
                  </td>
                  <td>
                    <div style="display: flex; gap: 8px; align-items: center; justify-content: flex-start;">
                      <button 
                        class="inspect-user-btn" 
                        @click="inspectUser(user)"
                        style="background: rgba(139, 92, 246, 0.15); border: 1px solid rgba(139, 92, 246, 0.3); padding: 4px 10px; border-radius: 6px; color: #a78bfa; cursor: pointer; font-size: 0.8rem; font-weight: 700; transition: all 0.2s;"
                        onmouseover="this.style.background='rgba(139, 92, 246, 0.25)';"
                        onmouseout="this.style.background='rgba(139, 92, 246, 0.15)';"
                      >
                        查看
                      </button>
                      <button 
                        class="delete-user-btn" 
                        v-if="user.username !== 'mediaAdmin' && user.username !== 'mediaSuper'"
                        @click="handleDeleteUser(user.username)"
                      >
                        删除
                      </button>
                      <span v-else style="color: var(--text-muted); font-size: 0.8rem;">内置保护</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      
      <!-- Logs Tab -->
      <div v-else class="admin-pane animate-fade-in">
        <!-- Filter Panel -->
        <div class="logs-filter-panel" style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); padding: 16px; border-radius: 12px; margin-bottom: 16px; display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; text-align: left; align-items: flex-end;">
          <div class="form-group" style="margin-bottom: 0; grid-column: span 2;">
            <label class="form-label" style="font-size: 0.8rem; margin-bottom: 4px;">操作时间范围 (起止时间)</label>
            <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
              <input type="datetime-local" v-model="filterLogStartDate" class="form-input" style="padding: 6px 12px; font-size: 0.85rem; flex: 1; min-width: 150px;" />
              <span style="color: var(--text-muted); font-size: 0.85rem;">至</span>
              <input type="datetime-local" v-model="filterLogEndDate" class="form-input" style="padding: 6px 12px; font-size: 0.85rem; flex: 1; min-width: 150px;" />
            </div>
          </div>
          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label" style="font-size: 0.8rem; margin-bottom: 4px;">账号 (用户名)</label>
            <input type="text" v-model="filterLogUsername" placeholder="搜索用户名" class="form-input" style="padding: 6px 12px; font-size: 0.85rem;" />
          </div>
          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label" style="font-size: 0.8rem; margin-bottom: 4px;">用户昵称</label>
            <input type="text" v-model="filterLogNickname" placeholder="搜索昵称" class="form-input" style="padding: 6px 12px; font-size: 0.85rem;" />
          </div>
          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label" style="font-size: 0.8rem; margin-bottom: 4px;">操作动作</label>
            <input type="text" v-model="filterLogAction" placeholder="如: 视频提取" class="form-input" style="padding: 6px 12px; font-size: 0.85rem;" />
          </div>
          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label" style="font-size: 0.8rem; margin-bottom: 4px;">视频提取链接</label>
            <input type="text" v-model="filterLogUrl" placeholder="搜索链接" class="form-input" style="padding: 6px 12px; font-size: 0.85rem;" />
          </div>
          <div>
            <button class="ex-btn" style="width: 100%; height: 36px; padding: 0; display: flex; justify-content: center; align-items: center; border-radius: 8px; border: 1px solid var(--border-color); color: var(--text-primary); cursor: pointer;" @click="clearLogFilters">
              🧹 重置筛选
            </button>
          </div>
        </div>

        <div class="table-container logs-table-container">
          <table class="admin-table">
            <thead>
              <tr>
                <th style="width: 140px;">操作时间</th>
                <th>账号 (角色)</th>
                <th>操作动作</th>
                <th>视频提取链接</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(log, idx) in filteredLogs" :key="idx">
                <td class="log-time-cell">{{ formatDate(log.timestamp) }}</td>
                <td>
                  <span style="font-weight: 600; color: var(--text-primary);">{{ log.username }}</span>
                  <span class="role-badge-mini" :class="log.role">{{ log.role }}</span>
                </td>
                <td style="color: var(--color-emerald); font-weight: 600;">{{ log.action }}</td>
                <td class="log-url-cell">
                  <a v-if="log.targetUrl" :href="log.targetUrl" target="_blank" class="log-url-link" :title="log.targetUrl">
                    {{ log.targetUrl }}
                  </a>
                  <span v-else>-</span>
                </td>
              </tr>
              <tr v-if="filteredLogs.length === 0">
                <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 30px;">
                  暂无符合筛选条件的操作日志记录
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </main>

    <!-- ==================== currentPage: main ==================== -->
    <div class="page-content-wrapper animate-fade-in" v-else-if="currentPage === 'main'">
      <!-- Header -->
      <header class="hero-header animate-fade-in">
        <div class="logo-wrapper">
          <span class="logo-text">VidFetch</span>
          <span class="badge-pro">ULTRA</span>
          <span class="badge-author">BY LBY</span>
          <!-- Settings Gear Button -->
          <button v-if="currentUser && currentUser.role !== 'user'" class="action-settings-btn" @click="triggerSettingsClick" title="AI 配置">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="gear-icon"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
        </div>
        <p class="subtitle">全面支持抖音、B站、小红书、TikTok、YouTube，已深度接入 B站语音字幕转写及豆包 LLM 大模型！</p>
      </header>

      <!-- Main Card -->
      <main class="main-card animate-slide-up">
        <!-- User Usage Banner for normal users -->
        <div v-if="currentUser?.role === 'user'" class="usage-banner" :class="{ 'warning': currentUser.remaining <= 0 }">
          <div class="usage-info">
            <span v-if="currentUser.remaining > 0">🎁 免费用户今日剩余额度：<strong>{{ currentUser.remaining }}</strong> / 5 次</span>
            <span v-else>⚠️ 今日已达免费提取上限！无法继续提取/下载</span>
          </div>
          <div class="usage-progress" v-if="currentUser.remaining > 0">
            <div class="usage-bar" :style="{ width: `${(currentUser.remaining / 5) * 100}%` }"></div>
          </div>
        </div>

        <!-- Input Panel -->
        <section class="input-panel">
          <div class="input-glow-wrapper" :class="{ 'disabled': currentUser?.role === 'user' && currentUser?.remaining <= 0 }">
            <input 
              type="text" 
              v-model="inputUrl" 
              placeholder="粘贴抖音、B站、小红书、TikTok、YouTube等链接或分享口令..." 
              class="glow-input"
              @keyup.enter="handleParse"
              :disabled="isParsing || (currentUser?.role === 'user' && currentUser?.remaining <= 0)"
            />
            <!-- Clear Button -->
            <button v-if="inputUrl && !isParsing && !(currentUser?.role === 'user' && currentUser?.remaining <= 0)" class="clear-btn" @click="clearInput">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
            <button 
              @click="handleParse" 
              :disabled="isParsing || (currentUser?.role === 'user' && currentUser?.remaining <= 0)" 
              class="glow-button"
              :class="{ 'loading': isParsing, 'disabled': currentUser?.role === 'user' && currentUser?.remaining <= 0 }"
            >
              <span v-if="!isParsing">提取并总结</span>
              <span v-else class="spinner"></span>
            </button>
          </div>

          <div class="quick-examples">
            <span class="label">快速测试:</span>
            <button class="ex-btn" @click="fillExample('https://www.bilibili.com/video/BV1GJ411x7h7/')">
              <span class="plat-mini-dot bilibili"></span>B站示例
            </button>
            <button class="ex-btn" @click="fillExample('https://v.douyin.com/idK1o93q/')">
              <span class="plat-mini-dot douyin"></span>抖音示例
            </button>
            <button class="ex-btn" @click="fillExample('https://www.xiaohongshu.com/explore/65cf0bfd000000000701b7a2')">
              <span class="plat-mini-dot xhs"></span>小红书示例
            </button>
            <button class="ex-btn" @click="fillExample('https://www.youtube.com/watch?v=dQw4w9WgXcQ')">
              <span class="plat-mini-dot youtube"></span>YouTube示例
            </button>
          </div>
        </section>

        <!-- Progress Panel -->
        <section v-if="isParsing" class="progress-panel animate-fade-in">
          <div class="stepper-title-wrapper">
            <div class="stepper-title">正在执行底层多维度抓取...</div>
            <div class="loading-wave">
              <span></span><span></span><span></span><span></span>
            </div>
          </div>
          <div class="stepper-wrapper">
            <div 
              v-for="(step, index) in steps" 
              :key="index" 
              class="step-item"
              :class="{ 
                'active': currentStep === index, 
                'completed': currentStep > index 
              }"
            >
              <div class="step-indicator">
                <span v-if="currentStep > index">
                  <svg class="check-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>
                </span>
                <span v-else>{{ index + 1 }}</span>
              </div>
              <div class="step-content">{{ step }}</div>
            </div>
          </div>
        </section>

        <!-- Error Message -->
        <div v-if="errorMsg" class="error-banner animate-shake">
          <span class="err-icon">⚠️</span>
          <span class="err-text">{{ errorMsg }}</span>
        </div>

        <!-- Result Panel -->
        <section v-if="parseResult" class="result-panel animate-fade-in">
          <div class="result-grid">
            <!-- Left: Preview Cover or Player -->
            <div class="media-container-wrapper">
              <div class="media-container">
                <div class="badge-platform" :class="platformClass">
                  <!-- Dynamic Platform Badge SVG Icon -->
                  <svg v-if="parseResult.platform === 'Bilibili'" class="badge-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M17.87 2.65a.75.75 0 0 1 .53.22c.28.28.29.74.02 1.03l-1.8 1.8h2.09c1.9 0 3.44 1.54 3.44 3.44v7.41c0 1.9-1.54 3.45-3.44 3.45H5.33c-1.9 0-3.44-1.55-3.44-3.45V9.14c0-1.9 1.54-3.44 3.44-3.44h2.1l-1.8-1.8a.74.74 0 0 1 .02-1.03c.3-.28.75-.27 1.03.02l2.42 2.42c.28.28.29.74.02 1.03l-.02.02H15l2.4-2.4c.14-.14.34-.22.47-.22M5.33 7.15c-.9 0-1.63.73-1.63 1.63v7.41c0 .9.73 1.63 1.63 1.63h13.34c.9 0 1.63-.73 1.63-1.63V8.78c0-.9-.73-1.63-1.63-1.63H5.33M9.75 10.5c.62 0 1.12.5 1.12 1.13v1.5c0 .62-.5 1.12-1.12 1.12s-1.13-.5-1.13-1.12v-1.5c0-.63.5-1.13 1.13-1.13m4.5 0c.62 0 1.13.5 1.13 1.13v1.5c0 .62-.5 1.12-1.13 1.12s-1.12-.5-1.12-1.12v-1.5c0-.63.5-1.13 1.12-1.13Z"/></svg>
                  <svg v-else-if="parseResult.platform === '抖音'" class="badge-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12.53 2.24a5.3 5.3 0 0 0 4.15 2.1c.07.97-.24 1.93-.86 2.7a5.5 5.5 0 0 1-2.9-1.9c-.1-.08-.13-.23-.07-.34l.07-.1c.32-.47.53-1 .6-1.57.01-.2-.14-.36-.34-.37l-2-.02c-.22 0-.4.18-.4.4V14c0 1.65-1.34 3-3 3s-3-1.35-3-3 1.34-3 3-3c.4 0 .8.09 1.16.26.18.09.4 0 .43-.2l.33-1.92c.03-.22-.12-.42-.34-.46A5 5 0 0 0 8.5 8c-3.87 0-7 3.13-7 7s3.13 7 7 7 7-3.13 7-7v-6.7c1.37.94 3.01 1.48 4.76 1.52.22 0 .4-.18.4-.4V6.52c0-.2-.15-.37-.35-.4a3.3 3.3 0 0 1-2.8-2.86c-.03-.2-.2-.34-.4-.34h-2.15c-.22 0-.4.18-.4.4Z"/></svg>
                  <svg v-else-if="parseResult.platform === '小红书'" class="badge-icon" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/><path d="M12 7a5 5 0 1 0 5 5 5 5 0 0 0-5-5zm0 8a3 3 0 1 1 3-3 3 3 0 0 1-3 3z" fill-rule="evenodd"/></svg>
                  <svg v-else-if="parseResult.platform === 'TikTok'" class="badge-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M16.6 5.82a5 5 0 0 1-3.6-2.1V14.5a4.5 4.5 0 1 1-9-1.8 4.5 4.5 0 0 1 8.2-2.3v-6.1A6.7 6.7 0 0 0 16.6 9V5.82z"/></svg>
                  <svg v-else-if="parseResult.platform === 'YouTube'" class="badge-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.163a3.003 3.003 0 0 0-2.11-2.11C19.518 3.545 12 3.545 12 3.545s-7.518 0-9.388.508a3.003 3.003 0 0 0-2.11 2.11C0 8.033 0 12 0 12s0 3.967.502 5.837a3.003 3.003 0 0 0 2.11 2.11c1.87.508 9.388.508 9.388.508s7.518 0 9.388-.508a3.003 3.003 0 0 0 2.11-2.11C24 15.967 24 12 24 12s0-3.967-.502-5.837zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                  <svg v-else class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/></svg>
                  {{ parseResult.platform }}
                </div>
                
                <!-- Custom Embedded Player using CORS proxy -->
                <video 
                  controls 
                  :src="proxyVideoUrl" 
                  class="video-preview" 
                  :poster="parseResult.cover"
                  preload="metadata"
                ></video>
              </div>
            </div>

            <!-- Right: Tabs panel (Bento Architecture) -->
            <div class="meta-container">
              <div>
                <h2 class="video-title">{{ parseResult.title }}</h2>
                
                <!-- Bento-styled high-tech tabs -->
                <div class="tabs-header">
                  <button 
                    class="tab-btn" 
                    :class="{ 'active': activeTab === 'video' }"
                    @click="switchTab('video')"
                  >
                    🎥 视频下载
                  </button>
                  <button 
                    class="tab-btn" 
                    :class="{ 'active': activeTab === 'copywriting' }"
                    @click="switchTab('copywriting')"
                  >
                    ✍️ 提取文案
                  </button>
                  <button 
                    class="tab-btn" 
                    :class="{ 'active': activeTab === 'summary' }"
                    @click="switchTab('summary')"
                  >
                    🧠 AI 核心总结
                  </button>
                </div>

                <!-- Tab Contents -->
                <div class="tabs-content">
                  <!-- Tab 1: Video Info -->
                  <div v-if="activeTab === 'video'" class="tab-pane animate-fade-in">
                    <!-- 播放量 / 互动数据（全部为真实值，平台不提供的指标不渲染） -->
                    <div v-if="displayStats.length > 0" class="stats-panel">
                      <div
                        v-for="item in displayStats"
                        :key="item.key"
                        class="stat-cell"
                        :class="'stat-' + item.key"
                        :title="item.source ? '数据来源: ' + item.source : ''"
                      >
                        <div class="stat-value">{{ formatStatCount(item.value) }}</div>
                        <div class="stat-label">{{ item.label }}</div>
                      </div>
                    </div>
                    <p v-if="parseResult.stats && parseResult.stats.note" class="stats-note">
                      {{ parseResult.stats.note }}
                    </p>
                    <p v-else-if="missingStatLabels.length > 0" class="stats-note">
                      该平台未公开：{{ missingStatLabels.join('、') }}
                    </p>
                    <!-- 抖音热榜字段：口径未核验，单独列出，不冒充播放量 -->
                    <p v-if="parseResult.hotListViews" class="stats-note stats-note-warn">
                      热榜字段值 {{ formatStatCount(parseResult.hotListViews.value) }}
                      （来源 {{ parseResult.hotListViews.source }}，统计口径未核验，不等同于播放量）
                    </p>

                    <div class="diagnostic-grid">
                      <div class="diag-item">
                        <div class="diag-label">嗅探解析耗时</div>
                        <div class="diag-value highlight">{{ parseDuration }} 秒</div>
                      </div>
                      <div class="diag-item">
                        <div class="diag-label">画质规格</div>
                        <div class="diag-value">高清 (1080P/720P)</div>
                      </div>
                      <div class="diag-item">
                        <div class="diag-label">代理模式</div>
                        <div class="diag-value">CORS Bypass Proxy</div>
                      </div>
                    </div>

                    <div class="meta-info">
                      <div class="info-row" v-if="parseResult.author">
                        <span class="info-label">作者:</span>
                        <span class="info-text">{{ parseResult.author }}</span>
                      </div>
                      <div class="info-row" v-if="formatDuration(parseResult.duration)">
                        <span class="info-label">时长:</span>
                        <span class="info-text">{{ formatDuration(parseResult.duration) }}</span>
                      </div>
                      <div class="info-row" v-if="parseResult.isImageNote">
                        <span class="info-label">笔记类型:</span>
                        <span class="info-text">图文笔记（无视频流，仅展示封面与互动数据）</span>
                      </div>
                      <div class="info-row">
                        <span class="info-label">源网页链接:</span>
                        <a :href="parseResult.targetUrl" target="_blank" class="info-link">{{ parseResult.targetUrl }}</a>
                      </div>
                    </div>

                    <div class="action-buttons">
                      <a :href="proxyVideoUrl" class="action-btn download-btn">
                        <svg class="icon animate-bounce-y" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                        下载高清 MP4 视频
                      </a>
                      <button class="action-btn copy-btn" @click="copyUrl(parseResult.videoUrl, '高清直链已复制到剪贴板！')">
                        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                        复制物理流直链
                      </button>
                    </div>
                  </div>

                  <!-- Tab 2: Copywriting Text -->
                  <div v-else-if="activeTab === 'copywriting'" class="tab-pane animate-fade-in">
                    <div v-if="isSummarizing" class="asr-loading-box">
                      <span class="asr-spinner"></span>
                      <p class="asr-loading-text">正在通过 ASR 语音识别转写文案，请稍候...</p>
                    </div>
                    <div v-else>
                      <div class="copywriting-box">
                        <!-- 话题与标签展示 (带高亮颜色且在最顶部展示) -->
                        <div v-if="parsedCopywriting.tags.length > 0" class="copy-tags-container">
                          <span v-for="tag in parsedCopywriting.tags" :key="tag" class="copy-highlight-tag">{{ tag }}</span>
                        </div>
                        
                        <!-- 文案详情 -->
                        <p v-if="parsedCopywriting.text" class="copy-text">{{ parsedCopywriting.text }}</p>
                        <p v-else class="copy-text-empty">💡 该视频无额外人声文案，已为您提取顶部话题与标签。</p>
                        
                        <button class="copy-box-btn" @click="copyUrl(parseResult.description, '视频完整文案已复制！')">
                          一键复制视频文案
                        </button>
                      </div>
                      <div class="copywriting-tip">
                        <span v-if="hasSummarized">✨ 该文案已由 ASR 服务从视频人声中实时转写提取。</span>
                        <span v-else>💡 提示：当前展示的为网页原始简介，启用 ASR 可以提取视频内说话的完整文案。</span>
                      </div>
                    </div>
                  </div>

                  <!-- Tab 3: AI Summary -->
                  <div v-else-if="activeTab === 'summary'" class="tab-pane animate-fade-in">
                    <div v-if="isSummarizing" class="asr-loading-box">
                      <span class="asr-spinner"></span>
                      <p class="asr-loading-text">正在读取人声字幕并请求大模型提炼核心看点，请稍候...</p>
                    </div>
                    <div v-else class="ai-summary-card">
                      <div class="ai-header">
                        <span class="ai-category-badge">📂 视频内容领域: {{ parseResult.aiSummary.category }}</span>
                        <span class="ai-tag" :class="{ 'real-ai': parseResult.aiSummary.isRealAI }">
                          {{ parseResult.aiSummary.isRealAI ? '✨ AI 核心深度提炼' : '💡 本地启发总结' }}
                        </span>
                      </div>
                      
                      <ul class="ai-points-list">
                        <li v-for="(point, idx) in parseResult.aiSummary.points" :key="idx" class="ai-point-item">
                          <span class="point-bullet"></span>
                          <span class="point-text">{{ point }}</span>
                        </li>
                      </ul>

                      <div class="ai-suggestion-box">
                        <div class="sugg-header">💡 极客智能建议：</div>
                        <p class="sugg-text">{{ parseResult.aiSummary.suggestion }}</p>
                      </div>

                      <div class="ai-settings-banner-tip" v-if="!parseResult.aiSummary.isRealAI">
                        💡 提示：当前为本地启发式总结。点击右上角设置配置并启用 AI 大模型与 ASR 识别可获得极速精准的 AI 提炼。
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>

    <!-- Footer -->
    <footer class="footer animate-fade-in">
      <p>仅供技术交流学习，请勿用于商业及非法用途</p>
      <p class="engine-status"><span class="pulse-indicator"></span> 引擎接口运行于: <code>{{ ENGINE_API_URL }}</code></p>
      <p class="credits" style="font-size: 0.95rem; font-weight: 700; background: linear-gradient(135deg, #a78bfa 0%, #f472b6 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; filter: drop-shadow(0 2px 8px rgba(167, 139, 250, 0.3)); margin-top: 8px; letter-spacing: 1px;">⚡ Created & Designed by LBY</p>
    </footer>
  </div>
</template>
<style scoped>
.vidfetch-container {
  max-width: 1000px;
  margin: 0 auto;
  padding: 60px 20px;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  justify-content: center;
  position: relative;
  z-index: 1;
}

/* Interactive Canvas Particle Field */
.particle-canvas {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: 0;
  pointer-events: none;
}

/* Background animated glow objects */
.glow-bg-node {
  position: fixed;
  width: 450px;
  height: 450px;
  border-radius: 50%;
  filter: blur(120px);
  z-index: -1;
  opacity: 0.15;
  pointer-events: none;
  animation: floatNode 25s infinite alternate ease-in-out;
}

.node-1 {
  background: var(--color-violet);
  top: -10%;
  left: -5%;
}

.node-2 {
  background: var(--color-fuchsia);
  bottom: -10%;
  right: -5%;
  animation-delay: -6s;
}

@keyframes floatNode {
  0% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(60px, 40px) scale(1.15); }
  100% { transform: translate(-40px, 60px) scale(0.9); }
}

/* Settings Overlay Modal */
.settings-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(5, 5, 10, 0.7);
  backdrop-filter: blur(8px);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
}

.settings-modal {
  background: rgba(15, 17, 33, 0.85);
  border: 1px solid var(--border-color);
  backdrop-filter: blur(20px);
  border-radius: 20px;
  width: 90%;
  max-width: 440px;
  padding: 30px;
  box-shadow: 0 20px 50px rgba(0,0,0,0.6);
  position: relative;
  animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.settings-close {
  position: absolute;
  top: 20px;
  right: 20px;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  transition: all 0.2s ease;
}

.settings-close:hover {
  color: var(--text-primary);
}

.settings-title {
  font-size: 1.3rem;
  font-weight: 800;
  color: var(--text-primary);
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.form-group {
  margin-bottom: 20px;
}

.form-label {
  display: block;
  font-size: 0.88rem;
  color: var(--text-secondary);
  margin-bottom: 8px;
  font-weight: 600;
}

.form-input {
  width: 100%;
  background: rgba(10, 11, 22, 0.6) !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  border-radius: 10px;
  padding: 12px 16px;
  color: var(--text-primary) !important;
  font-size: 0.92rem;
  outline: none;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.2);
}

.form-input:focus {
  border-color: #c084fc !important;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.2), 0 0 15px rgba(167, 139, 250, 0.25) !important;
  background: rgba(10, 11, 22, 0.8) !important;
}

.form-tip {
  display: block;
  font-size: 0.78rem;
  color: var(--text-muted);
  margin-top: 6px;
  line-height: 1.4;
}

.switch-group {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(255,255,255,0.02);
  border: 1px solid var(--border-color);
  padding: 12px;
  border-radius: 10px;
}

.switch-label-status {
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.glow-checkbox {
  width: 20px;
  height: 20px;
  cursor: pointer;
  accent-color: var(--color-violet);
}

.settings-save-btn {
  width: 100%;
  background: var(--gradient-glow);
  color: white;
  border: none;
  border-radius: 10px;
  padding: 12px;
  font-weight: 700;
  cursor: pointer;
  margin-top: 10px;
  transition: all 0.2s ease;
}

.settings-save-btn:hover {
  box-shadow: 0 0 15px rgba(139, 92, 246, 0.4);
}

/* Custom Toast Alert Component */
.custom-toast {
  position: fixed;
  top: 30px;
  right: 30px;
  background: rgba(15, 17, 33, 0.85);
  border: 1px solid var(--border-color);
  backdrop-filter: blur(15px);
  padding: 14px 24px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  gap: 12px;
  z-index: 20000;
  box-shadow: 0 10px 30px rgba(0,0,0,0.5);
  max-width: 320px;
  transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

/* Pay Method Selector Buttons */
.pay-method-btn {
  background: rgba(255, 255, 255, 0.02) !important;
  color: var(--text-secondary) !important;
  border: 1px solid var(--border-color) !important;
}
.pay-method-btn:hover {
  background: rgba(255, 255, 255, 0.05) !important;
  color: var(--text-primary) !important;
}
.pay-method-btn.active {
  border-color: var(--color-violet) !important;
  background: rgba(139, 92, 246, 0.1) !important;
  color: var(--text-primary) !important;
  box-shadow: 0 0 12px rgba(139, 92, 246, 0.2);
}

.custom-toast.success {
  border-left: 4px solid var(--color-emerald);
  color: var(--color-emerald);
}

.custom-toast.error {
  border-left: 4px solid var(--color-rose);
  color: var(--color-rose);
}

.toast-icon {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
}

.toast-message {
  color: var(--text-primary);
  font-size: 0.95rem;
  font-weight: 600;
}

.toast-fade-enter-from {
  opacity: 0;
  transform: translateY(-20px) scale(0.9);
}
.toast-fade-enter-to {
  opacity: 1;
  transform: translateY(0) scale(1);
}
.toast-fade-leave-from {
  opacity: 1;
}
.toast-fade-leave-to {
  opacity: 0;
  transform: scale(0.9);
}

/* Header */
.hero-header {
  text-align: center;
  margin-bottom: 40px;
  position: relative;
  z-index: 10;
}

.logo-wrapper {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  position: relative;
}

.logo-text {
  font-size: 3.5rem;
  font-weight: 800;
  letter-spacing: -2px;
  background: linear-gradient(135deg, #a78bfa 0%, #f472b6 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 4px 12px rgba(139, 92, 246, 0.2));
}

.badge-pro {
  background: var(--gradient-glow);
  color: white;
  font-size: 0.75rem;
  font-weight: 900;
  padding: 4px 8px;
  border-radius: 6px;
  letter-spacing: 1px;
  box-shadow: 0 0 12px rgba(217, 70, 239, 0.4);
}

.badge-author {
  background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
  color: white;
  font-size: 0.72rem;
  font-weight: 800;
  padding: 4px 8px;
  border-radius: 6px;
  letter-spacing: 1px;
  box-shadow: 0 0 12px rgba(99, 102, 241, 0.4);
}

.action-settings-btn {
  background: rgba(255,255,255,0.05);
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  width: 38px;
  height: 38px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  margin-left: 10px;
}

.action-settings-btn:hover {
  background: rgba(255,255,255,0.1);
  color: var(--text-primary);
  transform: rotate(30deg);
}

.gear-icon {
  width: 20px;
  height: 20px;
}

.subtitle {
  font-size: 1.1rem;
  color: var(--text-secondary);
  max-width: 600px;
  margin: 0 auto;
  line-height: 1.6;
}

/* Main Card */
.main-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  backdrop-filter: blur(20px);
  border-radius: 24px;
  padding: 40px;
  box-shadow: 0 20px 40px rgba(0,0,0,0.3);
  margin-bottom: 40px;
  position: relative;
  z-index: 10;
}

/* Input Panel */
.input-panel {
  margin-bottom: 30px;
}

.input-glow-wrapper {
  display: flex;
  position: relative;
  border-radius: 16px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  transition: all 0.3s ease;
  padding: 6px;
  align-items: center;
}

.input-glow-wrapper:focus-within {
  border-color: var(--color-violet);
  box-shadow: 0 0 20px var(--border-glow);
}

.glow-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text-primary);
  font-size: 1.1rem;
  padding: 14px 20px;
}

.glow-input::placeholder {
  color: var(--text-muted);
}

.clear-btn {
  background: transparent;
  border: none;
  outline: none;
  color: var(--text-muted);
  width: 32px;
  height: 32px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 8px;
  transition: all 0.2s ease;
}

.clear-btn:hover {
  background: rgba(255,255,255,0.08);
  color: var(--text-primary);
}

.clear-btn svg {
  width: 18px;
  height: 18px;
}

.glow-button {
  background: var(--gradient-glow);
  border: none;
  outline: none;
  color: white;
  font-size: 1rem;
  font-weight: 700;
  height: 48px;
  padding: 0 32px;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.glow-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 0 15px rgba(139, 92, 246, 0.4);
}

.glow-button:active {
  transform: translateY(1px);
}

.quick-examples {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
  font-size: 0.9rem;
}

.quick-examples .label {
  color: var(--text-muted);
}

.ex-btn {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.05);
  color: var(--text-secondary);
  padding: 6px 14px;
  border-radius: 20px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.ex-btn:hover {
  background: rgba(255,255,255,0.1);
  color: var(--text-primary);
  border-color: rgba(255,255,255,0.1);
}

.plat-mini-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
}

.plat-mini-dot.bilibili {
  background: #fb7299;
  box-shadow: 0 0 6px #fb7299;
}

.plat-mini-dot.douyin {
  background: #25f4ee;
  box-shadow: 0 0 6px #25f4ee;
}

.plat-mini-dot.xhs {
  background: #ff2442;
  box-shadow: 0 0 6px #ff2442;
}

.plat-mini-dot.youtube {
  background: #ff0000;
  box-shadow: 0 0 6px #ff0000;
}

/* Progress Panel */
.progress-panel {
  background: rgba(255, 255, 255, 0.01);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 24px;
  margin-top: 30px;
}

.stepper-title-wrapper {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.stepper-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--color-violet);
}

/* loading wave animation */
.loading-wave {
  display: flex;
  gap: 3px;
}

.loading-wave span {
  width: 3px;
  height: 12px;
  background: var(--color-violet);
  border-radius: 2px;
  animation: wave 1.2s infinite ease-in-out;
}

.loading-wave span:nth-child(2) { animation-delay: 0.15s; }
.loading-wave span:nth-child(3) { animation-delay: 0.3s; }
.loading-wave span:nth-child(4) { animation-delay: 0.45s; }

@keyframes wave {
  0%, 100% { transform: scaleY(1); }
  50% { transform: scaleY(2.2); }
}

.stepper-wrapper {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.step-item {
  display: flex;
  align-items: center;
  gap: 16px;
  opacity: 0.25;
  transition: all 0.3s ease;
}

.step-item.active {
  opacity: 1;
}

.step-item.completed {
  opacity: 0.7;
}

.step-indicator {
  width: 28px;
  height: 28px;
  border-radius: 50px;
  border: 2px solid var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
  font-weight: 700;
  transition: all 0.3s ease;
  color: var(--text-muted);
}

.step-item.active .step-indicator {
  border-color: var(--color-violet);
  background: rgba(139, 92, 246, 0.15);
  color: var(--color-violet);
  box-shadow: 0 0 10px rgba(139, 92, 246, 0.3);
}

.step-item.completed .step-indicator {
  border-color: var(--color-emerald);
  background: var(--color-emerald);
  color: #05050a;
}

.check-svg {
  width: 14px;
  height: 14px;
}

.step-content {
  font-size: 0.95rem;
  font-weight: 500;
}

/* Error Banner */
.error-banner {
  background: rgba(244, 63, 94, 0.08);
  border: 1px solid rgba(244, 63, 94, 0.2);
  border-radius: 16px;
  padding: 16px 24px;
  margin-top: 30px;
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--color-rose);
}

/* Result Panel */
.result-panel {
  margin-top: 40px;
  border-top: 1px solid var(--border-color);
  padding-top: 40px;
}

.result-grid {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 40px;
}

.media-container-wrapper {
  perspective: 1000px;
}

.media-container {
  position: relative;
  border-radius: 18px;
  overflow: hidden;
  background: black;
  border: 1px solid var(--border-color);
  aspect-ratio: 9/16;
  max-height: 480px;
  box-shadow: 0 15px 35px rgba(0,0,0,0.6);
  transition: all 0.5s cubic-bezier(0.165, 0.84, 0.44, 1);
  transform-style: preserve-3d;
}

.media-container:hover {
  transform: rotateY(-3deg) rotateX(3deg) translateY(-5px);
  box-shadow: 0 20px 45px rgba(139, 92, 246, 0.25);
  border-color: rgba(139, 92, 246, 0.4);
}

.video-preview {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.badge-platform {
  position: absolute;
  top: 16px;
  left: 16px;
  padding: 6px 14px;
  border-radius: 30px;
  font-size: 0.8rem;
  font-weight: 800;
  letter-spacing: 0.5px;
  z-index: 10;
  box-shadow: 0 4px 10px rgba(0,0,0,0.3);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.badge-icon {
  width: 16px;
  height: 16px;
}

.badge-platform.bilibili {
  background: #fb7299;
  color: white;
  box-shadow: 0 0 10px rgba(251, 114, 153, 0.4);
}

.badge-platform.douyin {
  background: linear-gradient(135deg, #25f4ee 0%, #fe2c55 100%);
  color: black;
  font-weight: 900;
}

.badge-platform.xhs {
  background: #ff2442;
  color: white;
  box-shadow: 0 0 10px rgba(255, 36, 66, 0.5);
}

.badge-platform.tiktok {
  background: #000000;
  color: white;
  border: 1px solid rgba(255,255,255,0.15);
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.8);
}

.badge-platform.youtube {
  background: #ff0000;
  color: white;
  box-shadow: 0 0 10px rgba(255, 0, 0, 0.5);
}

.meta-container {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
}

.video-title {
  font-size: 1.4rem;
  font-weight: 700;
  line-height: 1.4;
  color: var(--text-primary);
  margin-bottom: 24px;
}

/* Bento Style Tabs Navigation */
.tabs-header {
  display: flex;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border-color);
  padding: 4px;
  border-radius: 12px;
  gap: 4px;
  margin-bottom: 20px;
}

.tab-btn {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  padding: 10px 14px;
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.tab-btn:hover {
  color: var(--text-primary);
  background: rgba(255,255,255,0.03);
}

.tab-btn.active {
  background: rgba(139, 92, 246, 0.15);
  color: var(--color-violet);
  border: 1px solid rgba(139, 92, 246, 0.2);
}

.tabs-content {
  min-height: 220px;
}

/* Tab 2: Copywriting styling */
.copywriting-box {
  background: rgba(255,255,255,0.01);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 20px;
  position: relative;
  margin-bottom: 12px;
  max-height: 350px;
  overflow-y: auto;
}

.copy-text {
  font-size: 0.98rem;
  line-height: 1.7;
  color: var(--text-primary);
  margin-bottom: 20px;
  word-break: break-all;
  white-space: pre-wrap;
}

.copy-box-btn {
  background: var(--gradient-glow);
  color: white;
  border: none;
  outline: none;
  font-size: 0.9rem;
  font-weight: 700;
  padding: 10px 20px;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.copy-box-btn:hover {
  box-shadow: 0 0 12px rgba(139, 92, 246, 0.4);
  transform: translateY(-1px);
}

.copywriting-tip {
  font-size: 0.85rem;
  color: var(--text-muted);
}

/* Tab 3: AI Summary Card */
.ai-summary-card {
  background: rgba(255, 255, 255, 0.01);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 20px;
}

.ai-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 12px;
  margin-bottom: 16px;
}

.ai-category-badge {
  font-size: 0.9rem;
  font-weight: 800;
  color: var(--color-emerald);
}

.ai-tag {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 6px;
}

.ai-tag.real-ai {
  background: rgba(16, 185, 129, 0.15);
  border-color: rgba(16, 185, 129, 0.3);
  color: var(--color-emerald);
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.2);
}

.ai-points-list {
  list-style: none;
  padding: 0;
  margin: 0 0 20px 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ai-point-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.point-bullet {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-violet);
  box-shadow: 0 0 6px var(--color-violet);
  margin-top: 8px;
  flex-shrink: 0;
}

.point-text {
  font-size: 0.95rem;
  line-height: 1.5;
  color: var(--text-secondary);
}

.ai-suggestion-box {
  background: rgba(16, 185, 129, 0.05);
  border: 1px solid rgba(16, 185, 129, 0.15);
  border-radius: 10px;
  padding: 14px;
}

.sugg-header {
  font-size: 0.88rem;
  font-weight: 800;
  color: var(--color-emerald);
  margin-bottom: 6px;
}

.sugg-text {
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--text-secondary);
}

.ai-settings-banner-tip {
  background: rgba(255,255,255,0.02);
  border: 1px dashed var(--border-color);
  border-radius: 10px;
  padding: 12px;
  margin-top: 16px;
  font-size: 0.8rem;
  color: var(--text-muted);
  line-height: 1.4;
}

/* Diagnostic Metrics Grid */
.diagnostic-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

.diag-item {
  background: rgba(255,255,255,0.02);
  border: 1px solid rgba(255,255,255,0.04);
  border-radius: 12px;
  padding: 12px;
  text-align: center;
}

.diag-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-bottom: 4px;
  font-weight: 600;
}

.diag-value {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--text-secondary);
}

.diag-value.highlight {
  color: var(--color-emerald);
}

.meta-info {
  background: rgba(255,255,255,0.02);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 24px;
}

.info-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
}

.info-row:last-child {
  margin-bottom: 0;
}

.info-text {
  font-size: 0.9rem;
  color: var(--text-secondary);
  word-break: break-all;
}

/* ===== 播放量 / 互动数据面板 ===== */
.stats-panel {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(84px, 1fr));
  gap: 10px;
  margin-bottom: 16px;
}

.stat-cell {
  background: linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02));
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 12px;
  padding: 12px 8px;
  text-align: center;
  transition: transform 0.2s ease, border-color 0.2s ease;
}

.stat-cell:hover {
  transform: translateY(-2px);
  border-color: rgba(255,255,255,0.18);
}

.stat-value {
  font-size: 1.15rem;
  font-weight: 800;
  color: var(--text-primary, #fff);
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}

.stat-label {
  font-size: 0.72rem;
  color: var(--text-muted);
  margin-top: 4px;
  font-weight: 600;
  letter-spacing: 0.03em;
}

.stat-play .stat-value { color: #4ade80; }
.stat-like .stat-value { color: #f472b6; }
.stat-comment .stat-value { color: #60a5fa; }
.stat-collect .stat-value { color: #fbbf24; }
.stat-coin .stat-value { color: #f59e0b; }
.stat-share .stat-value { color: #a78bfa; }
.stat-danmaku .stat-value { color: #22d3ee; }

.stats-note {
  font-size: 0.75rem;
  color: var(--text-muted);
  background: rgba(251,191,36,0.08);
  border-left: 3px solid rgba(251,191,36,0.5);
  border-radius: 6px;
  padding: 8px 12px;
  margin: -6px 0 18px;
  line-height: 1.5;
}

/* 口径未核验的字段：更醒目地区分，避免被误读为真实播放量 */
.stats-note-warn {
  background: rgba(167,139,250,0.10);
  border-left-color: rgba(167,139,250,0.65);
  margin-top: -10px;
}

.info-label {
  font-size: 0.85rem;
  color: var(--text-muted);
  font-weight: 600;
}

.info-link {
  color: var(--color-violet);
  text-decoration: none;
  font-size: 0.9rem;
  word-break: break-all;
  transition: all 0.2s ease;
}

.info-link:hover {
  text-decoration: underline;
  color: #a78bfa;
}

.action-buttons {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 16px 24px;
  border-radius: 14px;
  font-size: 1rem;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
}

.download-btn {
  background: var(--gradient-emerald);
  color: white;
  box-shadow: 0 4px 15px rgba(16, 185, 129, 0.2);
}

.download-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 20px rgba(16, 185, 129, 0.4);
}

.copy-btn {
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
}

.copy-btn:hover {
  background: rgba(255,255,255,0.08);
}

.icon {
  width: 18px;
  height: 18px;
}

/* Animations */
.animate-bounce-y {
  animation: bounceY 2s infinite;
}

@keyframes bounceY {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}

/* Footer */
.footer {
  text-align: center;
  font-size: 0.85rem;
  color: var(--text-muted);
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: auto;
  position: relative;
  z-index: 10;
}

.engine-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.pulse-indicator {
  width: 8px;
  height: 8px;
  border-radius: 10px;
  background: var(--color-emerald);
  box-shadow: 0 0 8px var(--color-emerald);
  display: inline-block;
  animation: pulse 2s infinite;
}

/* Animations */
.animate-fade-in {
  animation: fadeIn 0.8s ease forwards;
}

.animate-slide-up {
  animation: slideUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.animate-shake {
  animation: shake 0.4s ease forwards;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-6px); }
  75% { transform: translateX(6px); }
}

@keyframes pulse {
  0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
  70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
  100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
}

/* Spinner */
.spinner {
  width: 20px;
  height: 20px;
  border: 3px solid rgba(255,255,255,0.3);
  border-radius: 50%;
  border-top-color: white;
  animation: spin 1s ease-in-out infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Responsive */
@media (max-width: 768px) {
  .result-grid {
    grid-template-columns: 1fr;
    gap: 30px;
  }
  .media-container {
    aspect-ratio: 16/9;
    max-height: 240px;
  }
  .diagnostic-grid {
    grid-template-columns: 1fr;
    gap: 10px;
  }
}

/* ASR Asynchronous Loading Box */
.asr-loading-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  background: rgba(15, 17, 33, 0.4);
  border: 1px dashed var(--border-color);
  border-radius: 12px;
  text-align: center;
}

.asr-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(139, 92, 246, 0.2);
  border-radius: 50%;
  border-top-color: var(--color-violet);
  animation: spin 0.8s cubic-bezier(0.5, 0.1, 0.4, 0.9) infinite;
  margin-bottom: 16px;
}

.asr-loading-text {
  font-size: 0.9rem;
  color: var(--text-muted);
  line-height: 1.6;
}

/* ==================== 登录、账户管理与审计样式 ==================== */

/* Profile Page Password Change & Modal Overlay Styles */
.change-pw-trigger-btn {
  background: rgba(139, 92, 246, 0.12);
  color: var(--color-violet);
  border: 1px solid rgba(139, 92, 246, 0.35);
  padding: 10px 18px;
  border-radius: 12px;
  font-size: 0.92rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
  height: 42px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.change-pw-trigger-btn:hover {
  background: rgba(139, 92, 246, 0.22);
  border-color: var(--color-violet);
  color: var(--text-primary);
  transform: translateY(-1px);
}

.change-pw-modal {
  padding: 30px !important;
  border-radius: 20px !important;
  background: linear-gradient(135deg, rgba(16, 18, 35, 0.95) 0%, rgba(10, 11, 22, 0.98) 100%) !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.8), 0 0 30px rgba(139, 92, 246, 0.1) !important;
}


/* Premium Auth Overlay Design */
/* Compact styling for Register form */
.register-form-compact {
  gap: 12px !important;
}
.register-form-compact .form-group {
  gap: 6px !important;
}
.register-form-compact .form-label {
  margin-bottom: 2px !important;
}
.register-form-compact .field-error-msg {
  margin-top: 4px !important;
}
.input-wrapper.no-icon .form-input {
  padding-left: 14px !important;
}

.auth-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(4, 5, 12, 0.82);
  backdrop-filter: blur(18px);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.auth-card {
  background: linear-gradient(135deg, rgba(16, 18, 35, 0.85) 0%, rgba(10, 11, 22, 0.9) 100%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(25px);
  border-radius: 28px;
  width: 90%;
  max-width: 440px;
  padding: 40px;
  box-shadow: 
    0 30px 70px rgba(0, 0, 0, 0.7), 
    0 0 50px rgba(139, 92, 246, 0.15), 
    inset 0 1px 2px rgba(255, 255, 255, 0.15);
  text-align: center;
  position: relative;
  overflow: hidden;
}

.auth-card-glow {
  position: absolute;
  width: 250px;
  height: 250px;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.12;
  z-index: 0;
  pointer-events: none;
}
.auth-card-glow.glow-1 {
  background: var(--color-violet);
  top: -80px;
  left: -80px;
}
.auth-card-glow.glow-2 {
  background: var(--color-fuchsia);
  bottom: -80px;
  right: -80px;
}

.auth-logo, .auth-subtitle, .auth-tabs, .auth-form {
  position: relative;
  z-index: 1;
}

.auth-tabs {
  display: flex;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 14px;
  padding: 4px;
  gap: 6px;
  margin-bottom: 28px;
}

.auth-tab-btn {
  flex: 1;
  background: transparent;
  border: none;
  padding: 12px;
  border-radius: 10px;
  color: var(--text-secondary);
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.auth-tab-btn:hover {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.02);
}

.auth-tab-btn.active {
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.25) 0%, rgba(217, 70, 239, 0.25) 100%);
  color: #c084fc;
  border: 1px solid rgba(139, 92, 246, 0.35);
  box-shadow: 0 4px 15px rgba(139, 92, 246, 0.2);
  text-shadow: 0 0 10px rgba(139, 92, 246, 0.5);
}

.tab-btn-icon {
  font-size: 1.05rem;
}

/* Premium Form Inputs with Icons & Validation States */
.input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.02);
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.2);
  height: 46px;
}
.input-wrapper:focus-within {
  border-color: var(--color-violet);
  background: rgba(255, 255, 255, 0.04);
  box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.25), inset 0 2px 4px rgba(0, 0, 0, 0.1);
}
.input-wrapper.has-error {
  border-color: var(--color-rose) !important;
  background: rgba(244, 63, 94, 0.02) !important;
  box-shadow: 0 0 0 3px rgba(244, 63, 94, 0.25) !important;
}
.input-wrapper .input-icon {
  padding-left: 14px;
  font-size: 1.1rem;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
}
.input-wrapper .form-input {
  border: none !important;
  background: transparent !important;
  padding-left: 10px !important;
  box-shadow: none !important;
  width: 100%;
  height: 100%;
}

.field-error-msg {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-rose);
  font-size: 0.82rem;
  font-weight: 600;
  margin-top: 6px;
  text-shadow: 0 0 6px rgba(244, 63, 94, 0.2);
}

.error-msg-icon {
  font-size: 0.9rem;
}

/* slide-fade transition styles */
.slide-fade-enter-active {
  transition: all 0.25s ease-out;
}
.slide-fade-leave-active {
  transition: all 0.2s cubic-bezier(1, 0.5, 0.8, 1);
}
.slide-fade-enter-from,
.slide-fade-leave-to {
  transform: translateY(-6px);
  opacity: 0;
}


/* Auth Overlay */
.auth-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(5, 5, 10, 0.85);
  backdrop-filter: blur(12px);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.auth-card {
  background: rgba(15, 17, 33, 0.85);
  border: 1px solid var(--border-color);
  backdrop-filter: blur(20px);
  border-radius: 24px;
  width: 90%;
  max-width: 420px;
  padding: 40px;
  box-shadow: 0 30px 60px rgba(0, 0, 0, 0.6), 0 0 40px rgba(139, 92, 246, 0.1);
  text-align: center;
  position: relative;
}

.auth-logo {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  justify-content: center;
}

.auth-subtitle {
  font-size: 0.95rem;
  color: var(--text-secondary);
  margin-bottom: 30px;
}

.auth-tabs {
  display: flex;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 4px;
  gap: 4px;
  margin-bottom: 24px;
}

.auth-tab-btn {
  flex: 1;
  background: transparent;
  border: none;
  padding: 10px;
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
}

.auth-tab-btn:hover {
  color: var(--text-primary);
}

.auth-tab-btn.active {
  background: rgba(139, 92, 246, 0.15);
  color: var(--color-violet);
  border: 1px solid rgba(139, 92, 246, 0.2);
}

.auth-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  text-align: left;
}

.auth-submit-btn {
  background: var(--gradient-glow);
  color: white;
  border: none;
  border-radius: 12px;
  padding: 14px;
  font-size: 1rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-top: 10px;
  width: 100%;
}

.auth-submit-btn:hover {
  box-shadow: 0 0 20px rgba(139, 92, 246, 0.5);
  transform: translateY(-1px);
}

/* Top Nav User profile */
.top-nav-bar {
  position: absolute;
  top: 24px;
  right: 24px;
  z-index: 999;
}

.nav-user-profile {
  background: rgba(15, 17, 33, 0.7);
  border: 1px solid var(--border-color);
  backdrop-filter: blur(10px);
  padding: 6px 14px 6px 6px;
  border-radius: 30px;
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  position: relative;
  transition: all 0.2s ease;
  user-select: none;
}

.nav-user-profile:hover {
  background: rgba(15, 17, 33, 0.9);
  border-color: rgba(139, 92, 246, 0.3);
}

.nav-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.05);
}

.nav-nickname {
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--text-primary);
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-role-badge {
  font-size: 0.72rem;
  font-weight: 800;
  padding: 2px 6px;
  border-radius: 4px;
  line-height: 1;
}

.nav-role-badge.admin {
  background: rgba(244, 63, 94, 0.15);
  color: var(--color-rose);
  border: 1px solid rgba(244, 63, 94, 0.2);
}

.nav-role-badge.super {
  background: rgba(217, 70, 239, 0.15);
  color: var(--color-fuchsia);
  border: 1px solid rgba(217, 70, 239, 0.2);
}

.nav-role-badge.pro {
  background: rgba(139, 92, 246, 0.15);
  color: var(--color-violet);
  border: 1px solid rgba(139, 92, 246, 0.2);
}

.nav-role-badge.user {
  background: rgba(16, 185, 129, 0.15);
  color: var(--color-emerald);
  border: 1px solid rgba(16, 185, 129, 0.2);
}

.dropdown-chevron {
  width: 16px;
  height: 16px;
  color: var(--text-muted);
}

/* Profile Dropdown Menu */
.profile-dropdown-menu {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  background: rgba(15, 17, 33, 0.95);
  border: 1px solid var(--border-color);
  backdrop-filter: blur(20px);
  border-radius: 16px;
  width: 220px;
  box-shadow: 0 15px 35px rgba(0, 0, 0, 0.5);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  animation: slideUp 0.2s ease forwards;
}

.dropdown-header {
  padding: 12px 16px;
  text-align: left;
}

.dropdown-nickname {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text-primary);
  word-break: break-all;
}

.dropdown-username {
  font-size: 0.78rem;
  color: var(--text-muted);
  margin-top: 2px;
}

.dropdown-divider {
  height: 1px;
  background: var(--border-color);
  margin: 4px 0;
}

.dropdown-item {
  background: transparent;
  border: none;
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 0.88rem;
  color: var(--text-secondary);
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s ease;
  width: 100%;
  text-align: left;
}

.dropdown-item:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
}

.dropdown-item.logout:hover {
  background: rgba(244, 63, 94, 0.1);
  color: var(--color-rose);
}

/* User Limit/Usage Progress Bar in Card */
.usage-banner {
  background: rgba(15, 17, 33, 0.5);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 16px 20px;
  margin-bottom: 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  text-align: left;
}

.usage-banner.warning {
  border-color: rgba(244, 63, 94, 0.25);
  background: rgba(244, 63, 94, 0.03);
}

.usage-info {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-secondary);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.usage-info strong {
  color: var(--color-emerald);
}

.usage-banner.warning .usage-info {
  color: var(--color-rose);
}

.usage-progress {
  height: 6px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 3px;
  overflow: hidden;
}

.usage-bar {
  height: 100%;
  background: linear-gradient(90deg, var(--color-emerald) 0%, #34d399 100%);
  border-radius: 3px;
  transition: width 0.4s ease;
}

.usage-banner.warning .usage-bar {
  background: var(--color-rose);
}

/* Input block overlay when limit reached */
.input-glow-wrapper.disabled {
  border-color: rgba(244, 63, 94, 0.3) !important;
  box-shadow: none !important;
  opacity: 0.6;
}

.glow-button.disabled {
  background: rgba(255, 255, 255, 0.05) !important;
  color: var(--text-muted) !important;
  cursor: not-allowed !important;
  box-shadow: none !important;
}

/* Admin Dashboard Modal Styling */
.admin-dashboard-modal {
  max-width: 800px !important;
  width: 95% !important;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.admin-tabs {
  display: flex;
  background: rgba(255, 255, 255, 0.01);
  border: 1px solid rgba(255, 255, 255, 0.06);
  padding: 4px;
  border-radius: 14px;
  gap: 6px;
  margin-bottom: 24px;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.15);
}

.admin-tab-btn {
  flex: 1;
  background: transparent;
  border: 1px solid transparent;
  padding: 12px;
  border-radius: 10px;
  color: var(--text-secondary);
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.admin-tab-btn:hover {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.02);
}

.admin-tab-btn.active {
  background: rgba(167, 139, 250, 0.12);
  color: #c084fc;
  border-color: rgba(167, 139, 250, 0.25);
  box-shadow: 0 0 15px rgba(167, 139, 250, 0.15);
}

.admin-tab-btn:active {
  transform: scale(0.97);
}

.admin-pane {
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.create-user-toggle-btn {
  background: rgba(167, 139, 250, 0.1);
  color: #c084fc;
  border: 1px dashed rgba(167, 139, 250, 0.3);
  padding: 10px 20px;
  border-radius: 10px;
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.create-user-toggle-btn:hover {
  background: rgba(167, 139, 250, 0.2);
  border-color: #c084fc;
  border-style: solid;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(167, 139, 250, 0.15);
}

.create-user-toggle-btn:active {
  transform: translateY(1px) scale(0.98);
}

.table-container {
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 16px;
  overflow: hidden;
  background: rgba(15, 17, 33, 0.3);
  backdrop-filter: blur(10px);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
  transition: all 0.3s ease;
}

.table-container:hover {
  border-color: rgba(255, 255, 255, 0.09);
  box-shadow: 0 15px 40px rgba(0, 0, 0, 0.3);
}

.logs-table-container {
  max-height: 400px;
  overflow-y: auto;
}

.admin-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  font-size: 0.88rem;
}

.admin-table th {
  background: rgba(255, 255, 255, 0.02);
  color: var(--text-secondary);
  font-weight: 600;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
  font-size: 0.85rem;
}

.admin-table td {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-secondary);
  vertical-align: middle;
}

.admin-table tr:last-child td {
  border-bottom: none;
}

.admin-table tr:hover td {
  background: rgba(255, 255, 255, 0.01);
  color: var(--text-primary);
}

.role-badge {
  font-size: 0.72rem;
  font-weight: 800;
  padding: 4px 10px;
  border-radius: 8px;
  display: inline-block;
  letter-spacing: 0.5px;
  text-shadow: 0 0 8px currentColor;
  transition: all 0.3s ease;
}

.role-badge.admin {
  background: rgba(244, 63, 94, 0.12);
  color: #ff4d6d;
  border: 1px solid rgba(244, 63, 94, 0.25);
  box-shadow: 0 0 10px rgba(244, 63, 94, 0.15);
}

.role-badge.super {
  background: rgba(217, 70, 239, 0.12);
  color: #f472b6;
  border: 1px solid rgba(217, 70, 239, 0.25);
  box-shadow: 0 0 10px rgba(217, 70, 239, 0.15);
}

.role-badge.pro {
  background: rgba(167, 139, 250, 0.12);
  color: #c084fc;
  border: 1px solid rgba(167, 139, 250, 0.25);
  box-shadow: 0 0 10px rgba(167, 139, 250, 0.15);
}

.role-badge.user {
  background: rgba(16, 185, 129, 0.12);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.25);
  box-shadow: 0 0 10px rgba(16, 185, 129, 0.15);
}

.role-badge-mini {
  font-size: 0.65rem;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
  margin-left: 6px;
  text-transform: uppercase;
}

.role-badge-mini.admin {
  background: rgba(244, 63, 94, 0.1);
  color: var(--color-rose);
}

.role-badge-mini.super {
  background: rgba(217, 70, 239, 0.1);
  color: var(--color-fuchsia);
}

.role-badge-mini.pro {
  background: rgba(139, 92, 246, 0.1);
  color: var(--color-violet);
}

.role-badge-mini.user {
  background: rgba(16, 185, 129, 0.1);
  color: var(--color-emerald);
}

.user-detail-panel {
  background: rgba(15, 17, 33, 0.35) !important;
  backdrop-filter: blur(12px) !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  padding: 28px !important;
  border-radius: 20px !important;
  text-align: left !important;
  box-shadow: 0 15px 35px rgba(0, 0, 0, 0.25), inset 0 2px 4px rgba(255, 255, 255, 0.02) !important;
  transition: all 0.3s ease !important;
  position: relative !important;
  overflow: hidden !important;
}

.user-detail-panel::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 4px;
  background: var(--gradient-glow);
}

.role-update-section {
  margin-top: 24px !important;
  background: rgba(255, 255, 255, 0.01) !important;
  border: 1px dashed rgba(255, 255, 255, 0.1) !important;
  border-radius: 14px !important;
  padding: 20px !important;
  transition: all 0.3s ease !important;
}

.role-update-section:hover {
  background: rgba(255, 255, 255, 0.02) !important;
  border-color: rgba(167, 139, 250, 0.35) !important;
  box-shadow: 0 4px 15px rgba(167, 139, 250, 0.05) !important;
}

/* Benefits and Packages Layout */
.benefits-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.pkg-card {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.pkg-card:hover {
  transform: translateY(-4px);
  border-color: rgba(255, 255, 255, 0.15) !important;
  box-shadow: 0 15px 30px rgba(0, 0, 0, 0.4);
}
.pkg-card.pro-card:hover {
  border-color: #a78bfa !important;
  box-shadow: 0 15px 35px rgba(139, 92, 246, 0.25);
}
.svg-chart {
  background: rgba(10, 11, 22, 0.4);
  border-radius: 12px;
  padding: 10px;
}
.chart-tooltip {
  position: absolute;
  transform: translate(-50%, -100%);
  background: rgba(15, 17, 35, 0.95);
  border: 1px solid rgba(139, 92, 246, 0.3);
  padding: 10px 14px;
  border-radius: 10px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.6), 0 0 15px rgba(139, 92, 246, 0.15);
  pointer-events: none;
  z-index: 100;
  min-width: 160px;
  max-width: 240px;
  text-align: left;
  backdrop-filter: blur(10px);
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.delete-user-btn {
  background: rgba(244, 63, 94, 0.15);
  color: var(--color-rose);
  border: 1px solid rgba(244, 63, 94, 0.2);
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 700;
  transition: all 0.2s ease;
}

.delete-user-btn:hover {
  background: var(--color-rose);
  color: white;
}

.log-time-cell {
  font-family: var(--font-mono);
  color: var(--text-muted);
  font-size: 0.8rem;
}

.log-url-cell {
  max-width: 250px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-url-link {
  color: var(--color-violet);
  text-decoration: none;
  transition: all 0.2s ease;
}

.log-url-link:hover {
  text-decoration: underline;
  color: #a78bfa;
}

/* Responsive top bar adjustment */
@media (max-width: 768px) {
  .top-nav-bar {
    position: static;
    margin-bottom: 20px;
    display: flex;
    justify-content: center;
  }
}

/* ==================== 子页面与返回按钮样式 ==================== */

.page-header {
  display: flex;
  align-items: center;
  gap: 20px;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 20px;
  margin-bottom: 24px;
  text-align: left;
}

.back-btn {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  padding: 8px 16px;
  border-radius: 10px;
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s ease;
}

.back-btn:hover {
  background: rgba(139, 92, 246, 0.15);
  color: var(--color-violet);
  border-color: rgba(139, 92, 246, 0.3);
  transform: translateX(-2px);
}

.back-icon {
  width: 16px;
  height: 16px;
}

.page-title {
  font-size: 1.3rem;
  font-weight: 800;
  color: var(--text-primary);
  margin: 0;
}

.sub-page {
  text-align: left;
}

.settings-page-content {
  margin-top: 20px;
}

/* 邮箱验证码发送按钮与图形验证码样式 */
.send-code-btn {
  background: rgba(139, 92, 246, 0.15);
  color: var(--color-violet);
  border: 1px solid rgba(139, 92, 246, 0.3);
  border-radius: 10px;
  padding: 12px;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 700;
  transition: all 0.2s ease;
  height: 46px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 110px;
  flex-shrink: 0;
}
.send-code-btn:hover:not(:disabled) {
  background: rgba(139, 92, 246, 0.25);
  border-color: var(--color-violet);
  color: var(--text-primary);
}
.send-code-btn:disabled {
  background: rgba(255, 255, 255, 0.02);
  color: var(--text-muted);
  border-color: var(--border-color);
  cursor: not-allowed;
}

/* 视频话题与标签展示高亮样式 */
.copy-tags-container {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
  border-bottom: 1px dashed var(--border-color);
  padding-bottom: 12px;
}
.copy-tags-container:only-child {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}
.copy-highlight-tag {
  background: rgba(217, 70, 239, 0.12);
  color: #d946ef;
  border: 1px solid rgba(217, 70, 239, 0.25);
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 0.88rem;
  font-weight: 700;
  text-shadow: 0 0 8px rgba(217, 70, 239, 0.3);
  display: inline-block;
}
.copy-text-empty {
  color: var(--text-muted);
  font-size: 0.95rem;
  text-align: center;
  padding: 20px 0;
  margin: 0;
}
</style>
