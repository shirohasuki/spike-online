// 语言对照表
const translations = {
    zh: {
        // 标题
        'app.title': 'Spike RISC-V 调试器',
        'connected': '已连接',
        'disconnected': '未连接',
        'debugging': '调试中',
        'not-debugging': '未调试',
        
        // 程序加载
        'config.program': '程序加载',
        'load.file': '选择ELF文件',
        'file.loaded': '文件已加载',
        'file.uploading': '正在上传',
        'file.uploaded': '文件上传成功',
        'file.upload.failed': '文件上传失败',
        
        // 调试控制
        'debug.control': '调试控制',
        'start': '开始',
        'continue': '继续',
        'pause': '暂停',
        'step': '单步',
        'reset': '重置',
        'stop': '停止',
        
        // 执行状态
        'execution.status': '执行状态',
        'pc': '程序计数器',
        'instruction.count': '指令计数',
        'current.instruction': '当前指令',
        'privilege.level': '特权级',
        
        // 调试选项
        'debug.options': '调试选项',
        'auto.step': '自动单步调试',
        'show.log': '显示执行日志',
        'show.memory': '显示内存访问',
        
        // 寄存器
        'registers': '寄存器',
        'integer.regs': '整数寄存器',
        'float.regs': '浮点寄存器',
        'csr.regs': '控制寄存器',
        
        // 内存
        'memory': '内存',
        'memory.address': '内存地址',
        'goto': '跳转',
        'address': '地址',
        'hex.data': '十六进制数据',
        'ascii': 'ASCII',
        
        // 代码视图
        'disassembly': '反汇编',
        'follow.pc': '跟随PC',
        'execution.log': '执行日志',
        'clear': '清空',
        
        // 状态信息
        'loading': '正在加载...',
        'file.not.found': '文件未找到',
        'invalid.file': '无效的ELF文件',
        'debug.started': '调试已开始',
        'debug.stopped': '调试已停止',
        'debug.paused': '调试已暂停',
        'debug.reset': '调试已重置',
        'welcome.title': '欢迎使用 Spike RISC-V 调试器',
        'welcome.message': '请加载ELF文件并选择工具面板开始调试',
        
        // 寄存器名称
        'reg.zero': 'zero (恒为0)',
        'reg.ra': 'ra (返回地址)',
        'reg.sp': 'sp (栈指针)',
        'reg.gp': 'gp (全局指针)',
        'reg.tp': 'tp (线程指针)',
        'reg.fp': 'fp (帧指针)',
    },
    
    en: {
        // 标题
        'app.title': 'Spike RISC-V Debugger',
        'connected': 'Connected',
        'disconnected': 'Disconnected',
        'debugging': 'Debugging',
        'not-debugging': 'Not Debugging',
        
        // 程序加载
        'config.program': 'Program Loading',
        'load.file': 'Choose ELF File',
        'file.loaded': 'File Loaded',
        'file.uploading': 'Uploading',
        'file.uploaded': 'File uploaded successfully',
        'file.upload.failed': 'File upload failed',
        
        // 调试控制
        'debug.control': 'Debug Control',
        'start': 'Start',
        'continue': 'Continue',
        'pause': 'Pause',
        'step': 'Step',
        'reset': 'Reset',
        'stop': 'Stop',
        
        // 执行状态
        'execution.status': 'Execution Status',
        'pc': 'Program Counter',
        'instruction.count': 'Instruction Count',
        'current.instruction': 'Current Instruction',
        'privilege.level': 'Privilege Level',
        
        // 调试选项
        'debug.options': 'Debug Options',
        'auto.step': 'Auto Step Debug',
        'show.log': 'Show Execution Log',
        'show.memory': 'Show Memory Access',
        
        // 寄存器
        'registers': 'Registers',
        'integer.regs': 'Integer Registers',
        'float.regs': 'Float Registers',
        'csr.regs': 'Control Registers',
        
        // 内存
        'memory': 'Memory',
        'memory.address': 'Memory Address',
        'goto': 'Go To',
        'address': 'Address',
        'hex.data': 'Hex Data',
        'ascii': 'ASCII',
        
        // 代码视图
        'disassembly': 'Disassembly',
        'follow.pc': 'Follow PC',
        'execution.log': 'Execution Log',
        'clear': 'Clear',
        
        // 状态信息
        'loading': 'Loading...',
        'file.not.found': 'File not found',
        'invalid.file': 'Invalid ELF file',
        'debug.started': 'Debug started',
        'debug.stopped': 'Debug stopped',
        'debug.paused': 'Debug paused',
        'debug.reset': 'Debug reset',
        'welcome.title': 'Welcome to Spike RISC-V Debugger',
        'welcome.message': 'Please load ELF file and select tool panel to start debugging',
        
        // 寄存器名称
        'reg.zero': 'zero (always 0)',
        'reg.ra': 'ra (return address)',
        'reg.sp': 'sp (stack pointer)',
        'reg.gp': 'gp (global pointer)',
        'reg.tp': 'tp (thread pointer)',
        'reg.fp': 'fp (frame pointer)',
    }
};

// 当前语言
let currentLanguage = 'zh';

// 翻译函数
function t(key) {
    return translations[currentLanguage][key] || key;
}

// 切换语言
function switchLanguage(lang) {
    currentLanguage = lang;
    
    // 更新语言按钮状态
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-lang="${lang}"]`).classList.add('active');
    
    // 更新所有需要翻译的文本
    updateAllTranslations();
    
    // 保存语言偏好
    localStorage.setItem('spike-debugger-lang', lang);
    
    // 触发语言切换事件
    const event = new CustomEvent('languageChanged', { detail: { language: lang } });
    document.dispatchEvent(event);
}

// 更新所有翻译
function updateAllTranslations() {
    // 更新所有具有 data-i18n 属性的元素
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        
        // 特殊处理 select 的 option 元素
        if (element.tagName === 'OPTION') {
            element.textContent = t(key);
        } else {
            element.textContent = t(key);
        }
    });
    
    // 更新所有具有 data-i18n-placeholder 属性的输入框
    document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
        const key = element.getAttribute('data-i18n-placeholder');
        element.placeholder = t(key);
    });
    
    // 更新标题
    document.title = t('app.title');
    
    // 更新页面语言属性
    document.documentElement.lang = currentLanguage === 'zh' ? 'zh-CN' : 'en';
}

// 初始化语言设置
function initializeLanguage() {
    // 从localStorage获取保存的语言设置
    const savedLang = localStorage.getItem('spike-debugger-lang');
    if (savedLang && translations[savedLang]) {
        currentLanguage = savedLang;
    } else {
        // 检测浏览器语言
        const browserLang = navigator.language || navigator.userLanguage;
        if (browserLang.startsWith('zh')) {
            currentLanguage = 'zh';
        } else {
            currentLanguage = 'en';
        }
    }
    
    // 设置初始状态
    switchLanguage(currentLanguage);
}

// 在DOM加载完成后初始化语言
document.addEventListener('DOMContentLoaded', () => {
    initializeLanguage();
    
    // 添加语言切换按钮事件监听器
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const lang = btn.getAttribute('data-lang');
            switchLanguage(lang);
        });
    });
});

// 导出函数供其他脚本使用
window.switchLanguage = switchLanguage;
window.t = t; 