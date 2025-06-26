# Spike RISC-V 可视化调试器

这是一个基于Web的RISC-V Spike模拟器可视化调试器，提供实时的处理器状态监控和性能分析功能。

## 功能特性

- **实时调试**: 与Spike模拟器实时交互，支持单步执行、继续运行等调试操作
- **可视化监控**: 实时显示寄存器、内存、程序计数器等处理器状态
- **性能分析**: CPU性能监控和热点分析
- **反汇编视图**: 代码反汇编显示和执行跟踪
- **拖拽界面**: 支持窗口拖拽和自定义布局

## 系统要求

- Node.js 16+
- 已编译的Spike模拟器 (位于 `../build/spike`)

## 安装和运行

1. 安装依赖:
```bash
npm install
```

2. 启动服务器:
```bash
npm start
```

```
npm install multer uuid
npm install node-pty
```

### 3. 访问Web界面

打开浏览器访问：http://localhost:3000

## 使用方法

1. 加载ELF文件到调试器
2. 选择需要的监控面板 (寄存器、内存、CPU监控、热点分析等)
3. 使用调试控制按钮进行单步执行或连续运行
4. 实时查看执行状态和性能数据

## 技术架构

- **前端**: 原生JavaScript + Socket.IO客户端
- **后端**: Node.js + Express + Socket.IO
- **模拟器接口**: 通过node-pty与Spike进程交互

## 开发

开发模式 (自动重启):
```bash
npm run dev
```
